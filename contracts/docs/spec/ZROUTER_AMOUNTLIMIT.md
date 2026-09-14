# zRouter `amountLimit`: what it bounds, what it pulls, and where we rely on it

Every swap this protocol routes goes through a zRouter typed leg, and every one of those legs takes
a single `amountLimit` argument as its slippage bound. The argument does not mean the same thing on
every leg, and on one of them it is not only a bound — it is the amount the router pulls from the
caller. This note records what each leg does with it, audits the four call sites that pass it, and
states the allowance invariant the CI gate enforces.

Line references are to the vendored router at `contracts/src/peripherals/zRouter.sol`, read at the
commit that introduced this note. The vendored copy has not been diffed against the deployed
bytecode; see "What this note does not cover".

## 1. `amountLimit == 0` means *unbounded*, on every leg

It is not "a minimum of zero". It is the bound being skipped:

| leg | site | behaviour at `amountLimit == 0` |
|---|---|---|
| `swapV2` exact-out | `:159` | `require(amountLimit == 0 \|\| amountIn <= amountLimit)` — check short-circuits |
| `swapV2` exact-in | `:168` | `require(amountLimit == 0 \|\| amountOut >= amountLimit)` — check short-circuits |
| `swapV3` both | `:233-235` | the whole comparison sits inside `if (amountLimit != 0)` |
| `swapV4` both | `:382-384` | the whole comparison sits inside `amountLimit != 0 && …` |
| `swapVZ` both | `:471`, `:477` | the router enforces nothing; it forwards `amountLimit` to zAMM as that venue's own `amountOutMin` / `amountInMax`, where zero is likewise no bound |

So a caller that computes its own floor and lets it round to zero has not asked for a loose floor —
it has asked for none, and the swap will settle at any price the pool offers. Every one of our call
sites must therefore be judged on whether its floor can reach zero, not merely on whether it passes
*a* floor. Section 3 does that.

## 2. What the router actually pulls

`amountLimit` is a bound on the *output* of an exact-in swap and on the *input* of an exact-out
swap. That asymmetry decides how large an ERC20 allowance the router needs.

**Exact-in (`exactOut == false`) — every leg.** The router pulls exactly `swapAmount`. On `swapV4`
that is `amountIn = !exactOut ? swapAmount : takeAmount` at `:362`, pulled by the
`safeTransferFrom(tokenIn, payer, poolManager, amountIn)` at `:373-378`. On `swapVZ` it is the
`safeTransferFrom(tokenIn, msg.sender, address(this), swapAmount)` at `:449`. An allowance of
exactly `swapAmount` is consumed to the last unit and leaves nothing standing.

One wrinkle worth knowing: on an exact-in call, `swapAmount == 0` is not a no-op. `swapV4:314-317`
and `swapVZ:436-444` both read it as *"spend whatever balance the router already holds"*. None of
our call sites can reach it — each guards on a non-zero amount first — but a future one that passes
a computed amount through without a zero check would be handing the router an open instruction
rather than a swap.

**Exact-out (`exactOut == true`) — and this is the trap.** On `swapVZ` the router pulls the **whole
`amountLimit`** up front (`:446` and `:449`, both reading `!exactOut ? swapAmount : amountLimit`), runs
the swap, and refunds the unspent remainder to the caller at `:486-493`. The exact allowance for an
exact-out zAMM leg is therefore `amountLimit`, not `swapAmount`; an allowance sized to `swapAmount`
under-approves and reverts, and one sized generously over-approves. On `swapV4` the pull is the
pool-computed `takeAmount`, and the slippage comparison at `:382` runs *after* the transfer at
`:373` — safe, because a breach reverts the whole transaction, but it does mean the allowance is
exposed to the pool's own computation before any bound is applied to it.

**Nothing in this tree takes an exact-out path today.** All four call sites pass `false`. The CI
gate in section 4 refuses an approval paired with an exact-out swap outright rather than trying to
size it, so the first exact-out call site has to be a deliberate decision.

## 3. The call sites

Four sites pass `amountLimit` to zRouter. Two of them also grant an ERC20 allowance; the other two
pay in native ETH and grant none.

### 3a. `UniAlignmentVault._convertVaultFeesToEth` — `src/vaults/uni/UniAlignmentVault.sol:554-581`

Sells collected fee tokens for ETH via `swapV4`, exact-in. `amountLimit = minEthOut`, derived at
`:561-566` from the DAO-pinned reference pool for this `(target, token)` through the price
validator's pinned-pool TWAP, then discounted by `maxPriceDeviationBps`. There is no fail-open path:
an unset reference reverts `NoReferencePool` at `:563` and an unusable one reverts inside
`quoteEthForTokensVia`. The allowance at `:568` is `tokenAmount`, the same value passed as
`swapAmount` at `:577` — exact, and consumed in the same call.

### 3b. `ZAMMAlignmentVault._removeFeeLP` — `src/vaults/zamm/ZAMMAlignmentVault.sol:465-488`

Sells the token side of a removed fee LP position for ETH via `swapVZ`, exact-in. `amountLimit =
_floorEthOut(tokRemoved, minEthOut)` at `:471`; `_floorEthOut` (`:593-601`) reads the same pinned
reference and returns `max(callerMin, floor)`, so a caller passing zero still gets the oracle floor
rather than none. The allowance at `:472` is `tokRemoved`, the same value passed as `swapAmount` at
`:482` — exact, and consumed in the same call.

### 3c/3d. `BestRouteAcquirer.acquireViaV4` / `acquireViaVZ` — `src/shared/libraries/BestRouteAcquirer.sol:112-136`, `:148-165`

Buy the alignment token with ETH on the fallback leg, exact-in, paying `{ value: ethAmount }`. ETH
in means no ERC20 allowance is granted at all, so the invariant in section 4 does not reach them.
`amountLimit = minOut`, which the calling vaults derive from the same reference-pool floor
(`_floorTokenOut`, `UniAlignmentVault.sol:543-552`).

### Can any of these floors reach zero?

Structurally, no. All four floors are `expected * (10000 - maxPriceDeviationBps) / 10000`, and
`maxPriceDeviationBps` is bounded at 2000 on both vaults (`UniAlignmentVault.sol:969-972`,
`ZAMMAlignmentVault.sol:567-571`), so the floor is never less than 80% of the oracle quote. It
reaches zero only where the quote itself rounds to zero — a dust amount whose reference-pool value
is under one wei — and in that case the value exposed to an unbounded swap is that same dust. The
floors are sound; recorded here so a future change to either bound is read against what it is
protecting.

## 4. INV-1: the allowance invariant, and the gate that holds it

zRouter is shared and permissionless. Anyone can call it, and every leg pulls its input with
`transferFrom(payer, …)`. An allowance standing on it is a claim on vault-held tokens that any
later caller can spend through any route they can construct. Hence:

> **INV-1.** Every approval granted to zRouter is sized to the exact amount that same
> transaction's swap will pull, and is fully consumed before the transaction ends.

Both allowance sites (3a, 3b) satisfy it. `contracts/scripts/zrouter-approval-gate.sh` keeps them
satisfying it: it walks `src/` and `script/`, and fails on an unbounded allowance, an allowance
whose value is not among the arguments of the swap that follows it, an approval with no zRouter
swap after it in the same function, or an approval paired with an exact-out leg. `--self-test`
scans the fixtures in `scripts/zrouter-approval-gate.cases/`, one per shape, and fails if any of
them stops being detected — so the gate cannot quietly decay into a step that always passes. Both
run in `contracts-ci.yml`.

The gate is lexical, not a prover: it reads an approval and the swap that follows it in the same
function body. It does not follow a value through a helper, an assembly block, or a low-level
`call`. It stops these shapes being introduced by accident; it is not a substitute for reading a
new call site.

## What this note does not cover

- **The vendored router against the deployed bytecode.** Everything above is read from
  `src/peripherals/zRouter.sol`. That file has never been diffed against the code at the router
  address the deploy scripts pin, and this note does not close that gap.
- **zAMM's own enforcement.** On the `swapVZ` leg the bound is enforced inside zAMM, not in the
  router. That `amountLimit == 0` disables it there is read from the router forwarding a zero
  through, not from an audit of zAMM.
- **`multicall`, `snwap` and `snwapMulti`.** Unreachable from this protocol — only typed single
  legs are called — and not examined.
