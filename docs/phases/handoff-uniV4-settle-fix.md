# Handoff — fix Uni-V4 graduation settle bug in `LiquidityDeployerModule`

> **Progress (2026-07-02):**
> - **Round 1 — settle payer (DONE, on main branch as cherry-pick `2db2b41`).** Root cause: settled
>   the V4 deltas against `ctx.instance`, but the **module** holds both currencies at graduation →
>   `transferFrom` from an instance holding nothing → revert. Fix: settle/take against `address(this)`.
>   Graduation now succeeds on the fork.
> - **Round 2 — native-ETH pool (DONE, cherry-pick `e382f68`).** The settle fix exposed a second
>   issue: the module created a **WETH-keyed** V4 pool (wrapped ETH→WETH), but the embedded swap +
>   zRouter + `UniAlignmentVault` all use **native-ETH** pools (currency `address(0)`) — so
>   `swapV4(address(0),…)` reverted `PoolNotInitialized()`. Fix: build a native-ETH pool (no WETH wrap;
>   `Currency.wrap(address(0))`; native settle), mirroring `UniAlignmentVault`. Fork test extended to
>   assert currency0==address(0) + a real `swapV4` buy returns amountOut>0.
>
> **RESOLVED.** Both fixes are on `feat/b19-embedded-graduated-swaps`. Uni-V4 graduation + embedded
> swapV4 verified end-to-end on the fork (cinder-ready graduates; UI buy in `graduated-swap.spec.ts`).
> This doc is retained for the root-cause record.
>
> Original brief below.


**Owner:** spun-off agent · **Context:** B19 embedded graduated swaps (see
`docs/phases/design-pass-blockers.md` → STEP 1). ZAMM + fossil verified; **Uni-V4 is the only
gap.** The swapV4 UI (`GraduatedSwapPanel`) is built and encoding-correct — it just can't be
exercised on the fork because a **Uni-V4 ERC-404 instance cannot graduate**: `deployLiquidity()`
reverts inside the LP deployer module during V4 settlement.

## The bug

`contracts/src/factories/erc404/LiquidityDeployerModule.sol` — `unlockCallback()` (~L186). At
graduation the module:
1. wraps the pool's ETH → WETH **into itself** (`address(this)`), approves the v4 PoolManager
   (`_setupPoolAndUnlock`, L135–136),
2. initializes the pool, unlocks, and inside the callback `modifyLiquidity` **succeeds** (liquidity
   is added — confirmed in the trace),
3. then settles the owed deltas via `CurrencySettler.settle(currency, manager, ctx.instance, amt, false)`
   (L212–213) — and **reverts at `manager.sync(WETH)`**.

Trace (graduating `cinder-ready`, a Uni-V4 seeded instance, on the mainnet fork):
```
unlockCallback
  emit ModifyLiquidity(... liquidityDelta: 4.7e20 ...)   <- liquidity added OK
  sync(WETH 0xC02a...)  <- [Revert] EvmError: Revert     <- dies here
```

Two things look wrong; the settle revert is the immediate failure, the payer looks wrong on
inspection:
1. **Payer mismatch.** `CurrencySettler.settle` (`contracts/src/libraries/v4/CurrencySettler.sol`)
   with `payer = ctx.instance` does `transferFrom(payer, manager, amount)` — but the **WETH is held
   by the module** (`address(this)`), not the instance. It should settle WETH from the module (the
   library already special-cases `payer == address(this)` → `transfer` instead of `transferFrom`).
   So `ctx.instance` should almost certainly be `address(this)` for the WETH leg (and the token leg
   is transferred to the module at L613 of `ERC404BondingInstance.deployLiquidity` before the
   unlock, so it's `address(this)` too).
2. **`sync(WETH)` reverting** is the actual EVM revert point and needs root-causing — could be a
   v4-core version mismatch between the module's imported `IPoolManager`/`CurrencySettler` and the
   PoolManager deployed on the mainnet fork, or a settle-ordering issue. Compare against the
   **fork-verified** working V4 LP path in `contracts/src/vaults/uni/UniAlignmentVault.sol` (it LPs
   into V4 successfully on the fork, including a `receive()` fix for native-ETH settle — see its
   `convertAndAddLiquidity` + settle flow) and mirror whatever it does that this module doesn't.

## Reproduce

Fastest is a forge **mainnet-fork test** (independent of the shared anvil dev chain on :8545 — do
NOT rely on / disturb that fork; another agent may be using it):

```
forge test --fork-url "$MAINNET_RPC_URL" --match-path "test/**/LiquidityDeployer*" -vvvv
```
If no such test exists, add one under `contracts/test/factories/erc404/` that constructs a
`LiquidityDeployerModule(v4PoolManager, weth, 3000, 60)` (mainnet V4 PoolManager + WETH — see
`contracts/script/DeployAnvil.s.sol` for the fork addresses), builds an ERC-404 instance bound to
it, buys on the curve so `reserve > 0`, sets maturity, and calls `deployLiquidity()` — assert it
graduates and a V4 pool exists. That test is the deliverable's proof.

Alternatively on a live anvil fork: graduate a Uni-V4 seeded instance (`cinder-ready`) — but prefer
the forge test so you don't depend on a running fork.

## Definition of done

1. `LiquidityDeployerModule.deployLiquidity()` graduates a Uni-V4 ERC-404 instance without reverting;
   a real V4 pool is created and holds the LP.
2. A forge fork test proves it (added or fixed under `contracts/test/`).
3. `forge build --skip test/**` clean; the existing LiquidityDeployerModule/graduation unit tests
   still pass.
4. Do NOT change the frontend — the swapV4 UI is already correct. Once graduation works, extend
   `app/e2e/graduated-swap.spec.ts` to also graduate a Uni-V4 instance (e.g. `cinder-ready`) and
   assert the embedded buy (mirror the ZAMM `molten-ready` case already in that spec).
5. Keep the change minimal + scoped to the V4 settle path. Note the root cause in the PR/commit.

## Pointers
- Real modules are now deployed on anvil (this was previously `MockComponentModule` stubs) — see
  `contracts/script/DeployCore.sol` (Uni-V4 + ZAMM real modules, gated on AMM config).
- zRouter swap encodings + the whole B19 build: `docs/phases/design-pass-blockers.md` STEP 1.
- Working reference V4 LP + settle: `contracts/src/vaults/uni/UniAlignmentVault.sol`.
