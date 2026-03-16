# Data Pipeline Reliability — Implementation Design

**Date:** 2026-03-11
**Status:** Ready for implementation
**Supersedes:** Partial analysis in `2026-03-11-local-dev-stale-state-spec.md`

---

## Problem Class

Two categories of failure, one root cause family: the data pipeline has no coherent reset strategy when state is invalidated.

1. **SPA navigation failure** — navigating from one page to another shows empty/placeholder data until a hard refresh. Affects all users including auditors on Sepolia.
2. **Post-restart stale state** — after Anvil restarts, `eth_call` view functions fail due to MetaMask's cached block number. Affects local dev only, but blocks validation before Sepolia launch.

---

## Fix 1 — Never permanently cache a degraded `web3Context`

**File:** `src/index.js`
**Root cause:** If `ensureWeb3Ready()` fails on first call (MetaMask not yet connected, RPC not responding, timing issue on cold load), it caches `{ mode: 'PLACEHOLDER_MOCK', config: null, web3Ready: false }`. Every subsequent navigation reuses this degraded object. The home page looks acceptable (hardcoded CULT EXECS), but discovery and other data-driven pages show empty results until a hard refresh restarts initialization.

**Change:** On failure, do not assign `web3Context`. Log the error and return a degraded object for that call only. The next navigation retries from scratch.

```js
// BEFORE
} catch (error) {
    web3Context = { mode: 'PLACEHOLDER_MOCK', config: null, web3Ready: false, ... };
}
return web3Context;

// AFTER
} catch (error) {
    console.error('[ensureWeb3Ready] Web3 initialization failed:', error);
    return { mode: 'PLACEHOLDER_MOCK', config: null, web3Ready: false, web3InitError: error.message };
    // web3Context stays null — next navigation retries
}
```

**Also:** Wire `chain:reset` event (from Fix 4) to clear `web3Context`:

```js
import { eventBus } from './core/EventBus.js';
eventBus.on('chain:reset', () => {
    console.log('[ensureWeb3Ready] chain:reset received, clearing web3 context');
    web3Context = null;
});
```

---

## Fix 2 — Router awaits cleanup before starting new route

**File:** `src/core/Router.js`
**Root cause:** `handleRoute` calls `cleanup()` fire-and-forget. Cleanup removes CSS classes, unloads stylesheets, and calls `unmountRoot` — all of which are synchronous in practice. However as cleanup logic grows more complex (async CSS transitions, component teardown) this becomes a latent race condition. Making it properly async costs nothing now and prevents future issues.

**Change:** `handleRoute` awaits cleanup:

```js
// BEFORE
this.currentHandler.cleanup();

// AFTER
await this.currentHandler.cleanup();
```

All v2 route cleanup functions change from `cleanup: () => { ... }` to `cleanup: async () => { ... }`. No internal changes needed since the body is currently synchronous — the `async` keyword is forward-compatible.

---

## Fix 3 — ProviderManager uses StaticJsonRpcProvider in local mode

**File:** `src/services/ProviderManager.js`
**Root cause:** MetaMask's `Web3Provider` caches the latest known block number internally. After Anvil restarts, the chain resets to the fork block but MetaMask still holds the pre-restart block. Any `eth_call` routed through MetaMask sends the stale block as `blockTag`, which Anvil rejects with `CALL_EXCEPTION`. This is the failure path for `ProjectCreationPage._loadFactories()`.

**Architecture decision:** There are three provider contexts:

| Context | Read provider | Write (signing) |
|---|---|---|
| Local (any wallet state) | `StaticJsonRpcProvider('http://127.0.0.1:8545')` | MetaMask signer via `walletService` |
| Production, no wallet | `StaticJsonRpcProvider` → public RPC cycle | N/A |
| Production, wallet connected | MetaMask `Web3Provider` (Infura) | MetaMask signer via `walletService` |

For local mode, `127.0.0.1:8545` is the most reliable endpoint available (no rate limits, no latency, no stale block cache). Using it unconditionally in local mode is not a workaround — it's using the best tool for the context.

For production, the public RPC fallback is only appropriate when there is no wallet. When a wallet is connected, MetaMask's underlying Infura endpoint is reliable and should be used. Replacing it with public endpoints would be a regression in reliability.

MetaMask remains fully exercised for all signing, transaction approval, account management, and chain switching in every environment.

**Change in `ProviderManager.initialize()`:**

```js
// In the local-mode branch, always use StaticJsonRpcProvider regardless of wallet
if (network.mode === 'local') {
    this.provider = new ethers.providers.StaticJsonRpcProvider(
        network.rpcUrl,
        { name: 'anvil', chainId: network.chainId, ensAddress: null }
    );
    this.providerType = 'static';
    return { provider: this.provider, type: 'static' };
}

// Production: existing wallet-check + public RPC fallback logic unchanged
```

**Consequence for `RealMasterService._getProvider()`:** The `StaticJsonRpcProvider` fallback that already exists for the no-wallet case in local mode becomes the only path — the `if (provider)` guard that returned the MetaMask provider becomes unreachable for local mode. No change needed there beyond potentially simplifying the branch.

---

## Fix 4 — Chain restart emits `chain:reset` event

**File:** `src/services/ProjectIndex.js`
**Root cause:** Stale state detection already exists (block regression, chain ID change, registry address change) but only acts on IndexedDB. The wider app — `web3Context`, `ServiceFactory` singletons — has no way to know a restart happened.

**Change:** After detecting stale state and before clearing the index, emit `chain:reset` on the shared `eventBus`:

```js
if (chainChanged || registryChanged || blockRegression) {
    console.log(`[ProjectIndex] Stale index detected (${reason}), clearing`);
    eventBus.emit('chain:reset', { reason });  // ← add this line
    await this.clearIndex();
}
```

This event is consumed by Fix 1 to clear `web3Context`. When the next navigation runs `ensureWeb3Ready()`, `providerManager.initialize()` re-runs and creates a fresh `StaticJsonRpcProvider` with no stale state. `ServiceFactory` singletons are also invalidated on the next page refresh (the normal dev workflow).

---

## Files Changed

| File | Fix | Change summary |
|---|---|---|
| `src/index.js` | 1, 4 | Don't cache degraded context; listen for `chain:reset` |
| `src/core/Router.js` | 2 | `await this.currentHandler.cleanup()` |
| `src/index.js` (route handlers) | 2 | `cleanup: async () => { ... }` for all v2 routes |
| `src/services/ProviderManager.js` | 3 | Local mode always returns `StaticJsonRpcProvider` |
| `src/services/ProjectIndex.js` | 4 | Emit `chain:reset` on stale detection |

---

## What This Does Not Fix

- **`ServiceFactory` singletons holding stale adapters mid-session** — still requires a hard refresh after Anvil restart. Acceptable: this is already the documented dev workflow, and it doesn't affect Sepolia.
- **MetaMask block cache without a page restart** — Fix 3 addresses this for local mode. In production no restart occurs.
- **Full `ChainStateManager` architecture** — deferred to post-launch as a separate refactor track.

---

## Acceptance Criteria

- [ ] Navigating from home → discovery → portfolio → create loads data without requiring a refresh
- [ ] After Anvil restart + hard refresh, discovery and create both load correctly
- [ ] After Anvil restart without hard refresh, next navigation triggers re-initialization (no permanent degraded mode)
- [ ] `ProjectCreationPage._loadFactories()` succeeds after Anvil restart in local mode
- [ ] MetaMask wallet connect/disconnect/sign flows work identically to pre-change behavior on local
- [ ] No behavior change on Sepolia (StaticJsonRpcProvider path is local-only)
