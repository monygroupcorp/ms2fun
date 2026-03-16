# Local Dev Stale State — Problem Spec

**Date:** 2026-03-11
**Status:** Spec only — no implementation yet

---

## Problem Statement

When the local Anvil chain restarts (with or without contract redeployment), the browser accumulates stale state across several independent layers. Each layer fails differently and at different times, producing confusing errors. We have been applying one-off patches to each symptom rather than designing a coherent reset strategy.

This document captures the discrepancies to inform a real solution.

---

## Layers of State and Their Failure Modes

### 1. MetaMask `Web3Provider` — stale block cache

**What it is:** When MetaMask is connected, `walletService.getProviderAndSigner()` returns an ethers `Web3Provider` wrapping MetaMask. MetaMask internally caches the latest known block number.

**How it fails after restart:** After Anvil restarts, the chain's block number resets to the fork block (~24.6M on a mainnet fork). MetaMask still thinks the chain is at whatever block it was at before the restart. When `eth_call` view functions are made through this provider, MetaMask sends its stale block as `blockTag`, and Anvil rejects it.

**Symptoms:** `CALL_EXCEPTION` on any view call (`nextFactoryId`, `getTotalFactories`, etc.) routed through `RealMasterService` or any adapter that uses the MetaMask provider.

**Why home page is immune:** `DataAdapter` uses `this.provider` from Layout, which is also the MetaMask provider — but home page calls only use `eth_getLogs` (event queries). Log queries don't use a block tag in the same way, so they aren't affected by MetaMask's stale block number.

**Affected code path:**
```
ProjectCreationPage._loadFactories()
  → serviceFactory.getMasterRegistryAdapter()
  → RealMasterService._ensureInitialized()
  → RealMasterService._getProvider()          ← returns MetaMask Web3Provider
  → MasterRegistryAdapter.initialize()
  → ContractAdapter (eth_call via MetaMask)   ← FAILS
```

---

### 2. IndexedDB `ProjectIndex` — stale event cache

**What it is:** `ProjectIndex` stores indexed `InstanceRegistered` events in IndexedDB. These include instance addresses from the previous deployment.

**How it fails after restart:** After redeploy, old instance addresses remain in IndexedDB. `DataAdapter` calls `projectIndex.getAllProjects()`, gets stale addresses, and passes them to `QueryAggregator.getProjectCardsBatch()`. The batch call reverts because those addresses don't exist on the new chain.

**Symptoms:** Home page shows no projects; console shows `getProjectCardsBatch` revert.

**Partial fix applied:** `ProjectIndex.sync()` now detects registry address change and clears the index. This works when the page is fresh-loaded after redeploy. But the detection logic is layered on top of the existing sync flow rather than being a first-class concern.

---

### 3. `RealMasterService` singleton — stale contract adapter

**What it is:** `RealMasterService` and `ServiceFactory` cache initialized adapters in module-level singletons. Once `this.initialized = true`, `_ensureInitialized()` skips re-initialization.

**How it fails after restart:** If the user visits the create page, restarts the chain (redeploying to new addresses), and navigates back to the create page without a full page refresh, the singleton still holds adapters pointing at old contract addresses. Every call goes to addresses that no longer exist.

**Symptoms:** All contract calls from the create page fail silently or with `CALL_EXCEPTION`/`BAD_DATA`.

**No fix applied.** This is not triggered by the typical restart workflow (restart → hard refresh), but it's a latent risk.

---

### 4. Layout provider — no chain-change detection

**What it is:** Layout initializes `EnvironmentDetector` and `providerManager` once on mount and stores the result in `this.state`. All child routes receive this provider via props.

**How it fails:** If the chain restarts mid-session (without page refresh), Layout's cached provider/config is stale. Routes inherit this stale state.

**Symptoms:** Subtle — dependent on what each route does with the provider. May not surface immediately.

**No fix applied.**

---

## The Deeper Problem: Two Provider Strategies

The codebase currently has two parallel strategies for obtaining a provider, and they are not consistent:

| Path | Strategy | Local behavior |
|---|---|---|
| `DataAdapter` (home page) | Uses `this.provider` from Layout props | MetaMask `Web3Provider` |
| `RealMasterService` (create page) | Calls `walletService.getProviderAndSigner()` directly | MetaMask `Web3Provider` |
| `ServiceFactory` (create page, other adapters) | Mix of wallet provider + ad-hoc logic | Inconsistent |

Both strategies end up with the MetaMask `Web3Provider` in local mode when a wallet is connected. Neither strategy routes view calls directly to Anvil's RPC in local mode.

The one-off patch considered was to hardcode `StaticJsonRpcProvider` in `RealMasterService._getProvider()` for local mode. This fixes the symptom for that one service but leaves the same problem in `ServiceFactory` and any other place that creates providers.

---

## What a Real Solution Would Address

1. **Single provider source of truth for local dev.** In local mode, view calls should go directly to `http://127.0.0.1:8545` via `StaticJsonRpcProvider`. MetaMask should only be used for signing transactions. This needs to be a consistent policy, not a per-service patch.

2. **Chain restart detection at a single boundary.** When Anvil restarts (detected by block regression, chain ID change, or registry address change), all stale state should be cleared atomically: IndexedDB, cached adapters, and Layout's provider state. Not handled in 3 different places with 3 different signals.

3. **Module singleton invalidation.** Services that cache adapters (`ServiceFactory`, `RealMasterService`) need a way to invalidate on chain restart, so SPA navigation after a restart doesn't silently use stale addresses.

4. **Provider abstraction.** The concept of "a provider for local dev" vs "a provider for mainnet" should be encapsulated in a single place (e.g., `providerManager` or a `LocalProviderFactory`) and consumed uniformly. Today, each service reaches for the wallet provider directly.

---

## Options to Consider

### Option A: LocalProviderManager singleton

A `LocalProviderManager` that:
- Holds a `StaticJsonRpcProvider` to Anvil for read calls in local mode
- Emits `chain:reset` events when block regression or registry address change is detected
- All services subscribe to `chain:reset` to invalidate their caches
- Wallet signer is overlaid only for transaction signing

**Pro:** Unified source of truth. Clean separation of read vs. write providers.
**Con:** Requires refactoring provider acquisition across `ServiceFactory`, `RealMasterService`, `DataAdapter`, `Layout`.

---

### Option B: Extend Layout's chain-reset detection outward

Layout already calls `EnvironmentDetector`. Extend it to:
- Compare config's `deployBlock` + registry address against current chain state on each route mount (or on a polling interval)
- If mismatch: emit `chain:reset` → clear IndexedDB → invalidate `ServiceFactory` singletons → re-run provider initialization

**Pro:** Detection lives at the entry point where config is loaded.
**Con:** Polling adds overhead; detection at mount time only catches resets on navigation, not mid-session.

---

### Option C: Restart-time config hash

Write a `deployHash` into `contracts.local.json` (e.g., hash of registry address + deploy block). On each page load, compare stored `deployHash` in IndexedDB against config. Mismatch triggers full reset.

**Pro:** Simple, zero polling, no provider refactor needed.
**Con:** Only catches resets that go through a page refresh. Doesn't address mid-session restarts or the MetaMask block cache issue.

---

## Recommended Next Step

Before implementing anything, decide:

1. **Which stale-state scenarios actually matter?** Restart + hard refresh is the common case. Mid-session restart is rare in dev. Scope the fix accordingly.

2. **Is the MetaMask block cache issue systemic or a MetaMask version quirk?** Confirm whether `StaticJsonRpcProvider` for local reads is the right permanent stance, or whether MetaMask should be told to re-sync.

3. **Should Option A (LocalProviderManager) be a standalone refactor?** It's the cleanest long-term fix but is more involved. Consider whether it belongs with the local chain overhaul work or as a separate track.

---

## Files Touched by Partial Fixes (This Session)

- `src/services/ProjectIndex.js` — chain reset detection + block chunking
- `src/services/DataAdapter.js` — pass `deployBlock` to sync
- `scripts/local-chain/deploy-contracts.mjs` — capture + return `deployBlock`
- `scripts/local-chain/write-config.mjs` — write `deployBlock` to config
- `src/routes/ProjectCreationPage.js` — name sanitization, view project URL fix
- `src/core/route-create-v2.css` — `.form-hint` style

These are low-risk and address real bugs (invalid name rejection, stale index, block range limit). The `RealMasterService._getProvider()` patch was reverted pending this spec.
