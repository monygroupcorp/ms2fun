# T4 Handoff — AlignmentEndowmentVault (Aave)

**Phase:** 2 · T4 (the lone open Phase-2 item) · **Status:** ✅ CORE DONE + fork-verified 2026-06-23.
**Spec of record:** [ADR-0003](../decisions/0003-aave-alignment-vault.md) (economics LOCKED). This doc pins
the *code seams* and execution plan; ADR-0003 owns the *why* and the splits.
**Owner:** lead writes the vault + Aave integration + wiring (drift-prone); agents take tests +
boilerplate + deploy wiring. **Verify on the archive mainnet-fork.**

> **🔴 PRE-MAINNET GATE (TODO before Phase 5):** T4 core ships the vault + factory + deploy + 55 tests
> (44 unit / 8 registry / 3 fork) + a manual fork round-trip, but a **deeper security review of the
> vault is required before mainnet** — re-examine: the open (un-gated) `receiveContribution`; ERC-4626
> share/round-trip accounting under multiple benefactors + adversarial donation; the maturity/early
> split edges; `migratePosition` trust; reentrancy across the WETH-unwrap → distribute path; and Aave
> pause/freeze/cap/deprecation handling on a long-lived position. (T4b — mint-path 80%→vault — is DONE.)
>
> **Build outcome:** the lead fork-verify caught a real ERC-4626 1-wei `maxWithdraw` rounding revert
> the clean mock + skipped fork test had missed → fixed by capping `_redeem` at `maxWithdraw`.

## Mission (why this is the keystone)
Everything read/discovery + the wizard option-schema is built and merged. The **entire create/write
half** (wizard submit, mint → vault accrual, the "launch a collection" flow) is blocked on this one
contract: every factory hard-requires an `IAlignmentVault` at `createInstance`, and the wizard's
`vault` slot is `pendingProvider`. Build the Aave endowment vault → the second half unblocks.

## The model (ADR-0003, in one breath)
Each aligned collection is a **perpetual community endowment**. Intake: DN404 `1/19(vault)/80(LP)`;
mints `1/80(vault)/19(creator)`. Principal is a **refundable deposit** (maturity → `80 creator /19
community /1`; early exit → `80 community /19 creator /1`). **Yield auto-compounds in Aave** and
`harvest()` distributes `80 community /19 creator /1`. Inner engine = Aave **`StaticATokenV2`**
(non-rebasing ERC-4626 over WETH); outer = custom `AlignmentEndowmentVault` (NOT ERC-4626 to
depositors — fixed principal claim, redirected yield).

## Prerequisites
1. ✅ **DONE — `aave-dao/aave-address-book` vendored** (the official repo) at
   `contracts/lib/aave-address-book` (shallow clone, gitignored like the other forge libs) + foundry.toml
   remapping `aave-address-book/=lib/aave-address-book/src/`. Import from
   `aave-address-book/AaveV3Ethereum.sol` (`AaveV3Ethereum.POOL`, `AaveV3EthereumAssets.WETH_*`).
   **Never hardcode addresses — use the library constants.**
2. ✅ **DONE — Aave V3 + the official WETH StataTokenV2 verified LIVE on the archive fork** (2026-06-23):
   | Constant | Address | Notes |
   | --- | --- | --- |
   | `AaveV3Ethereum.POOL` | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | NOT the misquoted `…B4dE5E9` |
   | `AaveV3EthereumAssets.WETH_UNDERLYING` | `0xC02aaA39…756Cc2` | WETH |
   | `AaveV3EthereumAssets.WETH_A_TOKEN` | `0x4d5F47FA…514E8` | aWETH |
   | `AaveV3EthereumAssets.WETH_STATA_TOKEN` | `0x0bfc9d54…081202` | **the inner engine** — `symbol "waEthWETH"`, ERC-4626, `asset()`=WETH, `aToken()`=aWETH |
   Deposit path: vault holds WETH → `stataToken.deposit(weth, vault)` → non-rebasing shares; value =
   `stataToken.convertToAssets(shares)` (or `maxWithdraw`). No DEX/swap dependency.
3. **TODO — community payout per target** — `AlignmentRegistry.AlignmentTarget` has **no payout field**.
   Add `mapping(uint256 => address) communityPayout` + `setCommunityPayout(targetId, addr)` (owner-only)
   in `AlignmentRegistryV1` (Option B — no struct migration). `harvest()` + principal-release send the
   community cut here. (Small, well-scoped — good first agent parcel.)

## Resolved decisions — LOCKED 2026-06-23 (Mony + lead). These define the airtight scope.
1. **Aave base = official Aave V3 + `StaticATokenV2` WETH** (verified live on the fork, prereq 2).
   Resolve the stataWETH address from the vendored address-book; fall back to an aWETH wrapper behind
   the same outer interface ONLY if the official instance is absent at our fork block. No raw rebasing
   aToken accounting.
2. **Maturity = a single GLOBAL platform constant**, enforced uniformly across every endowment vault —
   not per-vault, not per-collection. A `MATURITY_DURATION` constant in the vault (MVP default **365
   days**; dialable as a platform-wide constant later). This is the simplest possible surface: nothing
   threaded through `receiveContribution`, `createInstance`, the factory, or deploy. Per-collection
   creator-chosen maturity is explicitly NOT a goal (platform-enforced lock is the product stance).
3. **`harvest()` is permissionless** (keeper/anyone). It only moves the fixed 80/19/1 yield split to
   fixed destinations — no caller benefit, no extraction surface.
4. **Scope SPLIT to keep each slice tight:**
   - **T4 (core, build now):** `AlignmentEndowmentVault` + Aave integration + registration + factory +
     `DeployCore`/`DeployAnvil`/seed + the full Foundry matrix — validated on the **existing DN404
     intake path**, which already calls `receiveContribution` at 19% (UNCHANGED). This ships the
     unblocking, registerable `IAlignmentVault` without touching any settlement economics.
   - **T4b (separate tight slice, after T4 lands):** rewire the ERC1155/ERC721 **mint** settlement to
     route 80% → vault (swap the split + add the `receiveContribution` call). Isolated because it
     changes economics in the mint factories — a distinct, well-bounded follow-on.

## Exact seams (from the T4 seam inventory — all file:line in `contracts/`)
| Seam | Location | What |
| --- | --- | --- |
| **Interface to implement (FULL)** | `src/interfaces/IAlignmentVault.sol:25-252` | `receiveContribution(Currency,uint256,address) payable`, `receive()`, `claimFees()`, `calculateClaimableAmount`, `getBenefactorContribution`, `getBenefactorShares`, `vaultType`, `description`, `accumulatedFees`, `totalShares`, `supportsCapability`, `currentPolicy`, `validateCompliance`, `delegateBenefactor`, `getBenefactorDelegate`, `claimFeesAsDelegate` + 5 events. Implement ALL (no-op/`false`/`""` the irrelevant ones). |
| **Reference impl to mirror** | `src/vaults/uni/UniAlignmentVault.sol` | clone `initialize(...)` pattern; benefactor/share tracking; swap Uni-LP internals for Aave stataToken. |
| **Funding call site (ERC404)** | `src/factories/erc404/LiquidityDeployerModule.sol:172-176` | `IAlignmentVault(payable(p.vault)).receiveContribution{value: r.vaultCut}(Currency.wrap(address(0)), r.vaultCut, p.instance)` — native ETH, `benefactor = instance`. New vault must accept `msg.value == amount`. |
| **Split lib** | `src/shared/libraries/RevenueSplitLib.sol:16-20` | `split(amount) → {protocolCut 1%, vaultCut 19%, remainder 80%}`. Mint path needs the type-specific 80→vault routing. |
| **Registration (+ validations)** | `src/master/MasterRegistryV1.sol:315-350` (+ `_getVaultAlignmentToken` ~400) | `registerVault(vault,creator,name,uri,targetId)`: staticcalls `alignmentToken()`, requires `isTokenInTarget` + `isAlignmentTargetActive` + `code.length>0`. Instance create also checks `instance.vault()==vault`. |
| **Factory + deploy pattern** | `src/vaults/uni/UniAlignmentVaultFactory.sol`; `script/DeployCore.sol:207-294` | new `AlignmentEndowmentVaultFactory` (CREATE3 clone) + Phase-4 factory + Phase-5 per-target `deployVault` then `registerVault`. |
| **Target payout** | `src/master/interfaces/IAlignmentRegistry.sol` (AlignmentTarget struct) | add `communityPayout` mapping (prereq 3). |

`benefactor` = the collection instance; `creator = IOwnable(benefactor).owner()`; `community =
communityPayout[targetId]`. `accumulatedFees()` = harvestable = `stataToken value − totalPrincipal`.

## Deliverables
- [ ] `aave-address-book` vendored + remapped (prereq 1).
- [ ] `AlignmentRegistryV1` community-payout mapping + setter (prereq 3).
- [ ] `src/vaults/aave/AlignmentEndowmentVault.sol` — implements full `IAlignmentVault`; Aave
  stataToken inner; `principal[]` + per-benefactor `depositTime`; a **global `MATURITY_DURATION`
  constant** (decision 2 — maturity = `depositTime + MATURITY_DURATION`); `harvest()`
  (yield 80/19/1) + `withdrawPrincipal()` (maturity 80/19/1, early 80/19/1, swapped); `claimFees()`
  repurposed to matured-principal.
- [ ] `src/vaults/aave/AlignmentEndowmentVaultFactory.sol` (clone-deployable).
- [ ] `DeployCore`/`DeployAnvil` deploy the factory + a per-target endowment vault + `registerVault`;
  set a community payout on the seeded targets so `harvest()` has a destination.
- [ ] `SeedAnvil`/e2e: a **DN404** collection bound to the endowment vault; a graduation intake (19%);
  a simulated yield; a `harvest()`; a principal withdraw — fork-verified.
- [x] **T4b — DONE 2026-06-23:** mint settlement split flipped to 1/80/19. `RevenueSplitLib.splitMint`
  (1% protocol / 80% vault / 19% creator) added alongside the unchanged `split` (1/19/80 for DN404);
  `ERC1155Instance` + `ERC721AuctionInstance` route 80% → vault via the existing `receiveContribution`
  call. ERC721/ERC1155/RevenueSplit tests updated; ERC404 unchanged.
- [ ] (Phase-3 follow-on, NOT T4) add a `VAULT` FeatureUtils tag + ComponentRegistry registration so
  the wizard's `useApprovedModules('vault')` populates — until then the schema slot stays `pendingProvider`.

## Foundry test matrix (T4 exit — from ADR-0003 §"Foundry test plan")
1. **Intake (T4)**: DN404 graduation → `1/19(vault)/80(LP)`; the 19% lands in the stataToken as
   principal for `benefactor=instance`. *(Mint intake `1/80(vault)/19(creator)` is tested with T4b.)*
2. **Yield**: simulate Aave accrual; `harvest()` distributes `80 community /19 creator /1 platform`; principal untouched; remainder auto-compounds.
3. **Principal @ maturity**: `withdrawPrincipal` → `80 creator /19 community /1`.
4. **Principal early exit**: → `80 community /19 creator /1`.
5. **Registration**: `alignmentToken()` + active-target checks pass `registerVault`; `createInstance` vault checks pass.
6. **Aave edge**: reserve pause/freeze/supply-cap revert paths fail cleanly; position migratable; never account against a raw rebasing aToken.

## Agent-dispatch plan
- **Lead (drift-prone, sequential):** the vault contract + Aave stataToken integration + the mint-path
  settlement wiring + the AlignmentRegistry payout change. These are load-bearing and cross-cutting.
- **Fan out (after the contract compiles against the interface):** the Foundry test matrix (one agent
  per test group), the `AlignmentEndowmentVaultFactory` boilerplate, the `DeployCore`/`DeployAnvil`/seed
  wiring. Lead does the integration + fork-verify pass.

## Risks / guards
Use stataToken (non-rebasing) only. Supply-only; never enable as borrow collateral. Handle Aave
pause (blocks withdraw+supply) / freeze (blocks supply, allows withdraw) / supply-cap reverts
gracefully; keep the position migratable. Guard inflation/round math at the outer layer even though
deposits are trusted (only protocol deployers call `receiveContribution`).
