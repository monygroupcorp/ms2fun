# Spec — S4 follow-up: spend-denominated BUY on the bonding curve

**Status:** ✅ BUILT 2026-07-03 (`587788f`). Implemented as `costInverse.ts` (`solveBuyAmount`,
unit-tested) + the SwapPanel buy-path rewrite, matching the approach below. Live-fork validated:
for .005/.01/.05/.1 ETH the solve spends 99.7–99.8% of budget, never over, always maximal.

## Problem

On the pre-graduation bonding `SwapPanel`, a BUY takes a **token amount** and the curve computes the
ETH `cost`. The design note (S4) wants the swap-UI convention: *type how much ETH you want to SPEND*,
plus ETH quickfill presets (.005/.01/.05/.1) on buy. The graduated + EXEC cells are already
ETH-denominated so they got presets directly; the bonding buy is the exception because its contract
API is amount-in, cost-out.

## Why it wasn't done inline

There is **no on-chain inverse** (`CurveParamsComputer` exposes only `calculateCost(amount)` /
`calculateRefund(amount)` — both forward). The client-side `curveSampler` is explicitly SHAPE-ONLY
("exact cost quotes still come from on-chain `calculateCost`"), so it must **not** be used to compute
a transaction's ETH `value`. Inverting spend→amount is money-math and deserves its own tested change,
not a rushed float approximation.

## Approach to build

Invert `calculateCost` numerically, keeping the on-chain function as the source of truth:

1. **Bisection on `amount`.** `calculateCost(params, supply, amount)` is monotonic increasing in
   `amount`. Given a target ETH `spend`, binary-search `amount ∈ [0, maxBondingSupply - totalBondingSupply]`
   until `calculateCost(amount) ≈ spend` (within a small tolerance, ~0.5%). Each probe is one
   `eth_call`; cap at ~18 iterations. Run it **on preset click / on debounce of a spend input**, not
   on every keystroke.
2. **Seed the search cheaply.** Use `curvePriceAt(params, totalBondingSupply)` (client float) for an
   initial guess `amount₀ ≈ spend / price`, then bisect around it — cuts iterations.
3. **Exact cost from the resolved amount.** Once `amount` is found, call `calculateCost(amount)` for
   the *real* cost and set `maxCost = applyBuySlippage(cost)` and `value = maxCost` exactly as today.
   The user spends ~`spend` (bounded by slippage); the amount is whatever the curve gives for it.
4. **UI.** Flip the buy input label to `amount (ETH)`, add `buyEthPresets()` (already built in
   `swapPresets.ts`) to the buy branch, and show the resolved token amount + exact cost as the quote.
   Sell is unchanged (it already got %-presets).

## Files

- `app/src/components/collection/erc404/SwapPanel.tsx` — buy branch: spend input + inverse-solve.
- New `app/src/components/collection/erc404/costInverse.ts` — the bisection (pure given a
  `calculateCost` probe fn) + unit tests (monotonic convergence, tolerance, clamp to supply cap).
- Reuse `swapPresets.buyEthPresets()` for the presets.

## Test

- Unit: bisection converges to within tolerance for a mocked monotonic cost fn; clamps at the supply
  cap; handles spend larger than the whole remaining curve (returns the cap).
- Fork e2e: click `0.01 ETH`, confirm the buy costs ≈ 0.01 ETH (± slippage) and mints the expected
  token amount.
