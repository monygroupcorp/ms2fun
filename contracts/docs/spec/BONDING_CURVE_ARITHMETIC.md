# Bonding Curve Arithmetic Specification

**Scope**: `BondingCurveMath.sol`, `CurveParamsComputer.sol`, `LiquidityDeployerModule.sol`, `RevenueSplitLib.sol`

This is the intent document for the curve. It states what the shape is required to do, where that
requirement comes from, which levers can invalidate it, and what the code asserts at run time.

---

## 1. Price Function

The bonding curve uses a **hyperbolic** price function over **normalized supply**:

```
P(s) = k / (A − s)
```

| Symbol | Param field           | Meaning                                            |
|--------|-----------------------|----------------------------------------------------|
| `k`    | `kCoeff`              | Amplitude, in wei. Scaled at create to hit the raise |
| `A`    | `poleWad`             | Vertical asymptote, WAD, strictly beyond the cap    |
| `N`    | `normalizationFactor` | Supply scaling divisor                              |

**Normalized supply** `s = supply / N`, a WAD quantity. `N` is chosen at create as
`maxBondingSupply / 1e18`, so the top of the bonding range lands at `s ≈ 1e18` (one WAD). The pole
`A` therefore sits at `1 + ε` in those units, and `ε = A − 1e18` is the **only shape parameter**.

Two closed forms drive everything:

```
R = P(1) / P(0)        = (1 + ε) / ε          — last/first price ratio
G = P(1) / averagePrice = (R − 1) / ln R      — graduation multiple
```

---

## 2. Cost & Refund (Definite Integral)

```
I(s)       = −k · ln(1 − s / A)               antiderivative of P
Cost(a, b) = I(b) − I(a)                      for b ≥ a
```

### Implementation (`BondingCurveMath._calculateIntegralFromZero`)

```
s   = supply / normalizationFactor            // integer division, rounds down
require s < poleWad                           // SupplyAtOrBeyondPole
arg = 1e18 − divWad(s, poleWad)               // in [1, 1e18]
I   = mulWad(kCoeff, −lnWad(arg))
```

`divWad` and `mulWad` are Solady's (multiply/divide by 1e18, rounding down); `lnWad` is Solady's
natural log on WAD inputs.

### Buy / Sell

```
buyCost(currentSupply, amount)    = Cost(currentSupply, currentSupply + amount)
sellRefund(currentSupply, amount) = Cost(currentSupply − amount, currentSupply)
```

Sell requires `amount ≤ currentSupply`. Buy and sell share the same integral, so a buy immediately
followed by a sell of the same amount at the same supply refunds exactly what it took in, and split
sells telescope exactly. Both properties are asserted at both boundaries and at the first and last
unit in `test/libraries/BondingCurveMath.t.sol`.

---

## 3. Rounding Behaviour

`divWad` floors, so `arg` rounds **up**, so `ln(arg)` rounds up (toward zero), so `I(s)` rounds
**down**. `mulWad` floors as well, in the same direction. The bias is therefore one-signed and
conservative: **buyers pay no more than the theoretical curve**, which keeps the reserve on the safe
side. This is the same direction the earlier implementation had, and it is deliberate.

Magnitude: bracketing two independently-rounded forms of the same integral bounds the worst endpoint
spread at ~190 wei at the shipped shape, i.e. ~1.5e-14 relative. Because `Cost(a,b)` is a difference
of two floored evaluations, two independent cost evaluations at nearby supplies can disagree by a
few wei on ordering; the monotonicity fuzz tests carry an explicit 8 wei tolerance for exactly that
and nothing larger.

The initial `supply / normalizationFactor` division also floors, so a purchase smaller than
`normalizationFactor` **base units** (not tokens) prices at zero. `ERC404BondingInstance` refuses
those with `PurchaseTooSmall`.

**Domain**: with `s < A` guaranteed by the `SupplyAtOrBeyondPole` check, `arg` is in `[1, 1e18]`, so
`lnWad` is never called in its revert domain. On the shipped call path the buy cap keeps supply at or
below the bonding cap, which is strictly inside the pole, so the check is a guard rather than a
reachable branch.

---

## 4. Parameter Computation

`CurveParamsComputer.computeCurveParams` converts a graduation profile into concrete `Params`.

### Inputs

| Input                 | Example    | Meaning                                 |
|-----------------------|------------|-----------------------------------------|
| `nftCount`            | 10000      | Number of NFTs                          |
| `targetETH`           | 100 ether  | Total ETH the curve should raise        |
| `unitPerNFT`          | 1e6        | Fungible tokens per NFT                 |
| `liquidityReserveBps` | 2000       | Bps of total supply held for post-grad LP |

### Steps

```
totalSupply      = nftCount × unitPerNFT × 1e18
liquidityReserve = totalSupply × liquidityReserveBps / 10000   (round down)
maxBondingSupply = totalSupply − liquidityReserve
normFactor       = maxBondingSupply / 1e18                     (round down, min 1)

targetG   = 0.8 × (10000 − liquidityReserveBps) / liquidityReserveBps      (§5)
poleWad   = solve G(ε) = targetG                                            (§6)
assert |G(poleWad) − targetG| ≤ targetG × 1e-6                              (§6)

referenceParams = Params(kWeight, poleWad, normFactor)
referenceArea   = Cost(referenceParams, 0, maxBondingSupply)
scaleFactor     = targetETH ÷_wad referenceArea
kCoeff          = kWeight ×_wad scaleFactor
```

**Invariant**: `Cost(finalParams, 0, maxBondingSupply) ≈ targetETH`, asserted to 1e-6 relative for
every preset × `nftCount` cell in `test/factories/erc404/CurveParamsComputer.t.sol`.

`kWeight` is an amplitude weight only. It cancels out of the result — the reference area is linear in
it and the params are rescaled to `targetETH` — so it is not a shape knob and cannot move the price
distribution. `poleWad` in storage is the **starting probe** for the solve, not the answer: it is
accepted only if it already satisfies the parity assertion, so it can shorten the solve and cannot
change what the solve is allowed to return.

---

## 5. The parity target, and where each term comes from

The pool opens at a price the curve does not control. Write `r = liquidityReserveBps / 1e4`. The
curve sells `1 − r` of supply for 100% of the raise. At graduation `RevenueSplitLib` splits the
reserve 1% protocol / 19% vault / **80% LP**, and `deployLiquidity` seeds the pool with that 80%
against `r` of supply. So

```
poolOpenPrice / curveAveragePrice = 0.8 · (1 − r) / r  =  G
```

At the shipped presets (`liquidityReserveBps = 1000` on NICHE, STANDARD and HYPE) this is **G = 7.2**.
For the curve to end where the pool opens, its **final price must be G times its own average price** —
which is exactly the `G` of §1. Solving `G(ε) = 7.2` gives `ε ≈ 0.0438`, i.e. `poleWad ≈ 1.0438e18`,
a last/first price ratio of ~23.8×.

**G is set by the LP reserve and the revenue split, not by the curve.** Raising the reserve lowers the
required steepness: at `liquidityReserveBps = 2000`, `G = 3.2` and `ε ≈ 0.156` (ratio ~7.4×).

### The `1/G` bound

For any monotone price under a pinned total: if a fraction φ of supply is priced at or above the
graduation price, then `T ≥ φ · p_grad · S`, so **φ ≤ 1/G**. At `G = 7.2` at most **13.9%** of the
supply can price at or above the graduation price, at any parameters, in any family. A flat curve is
arithmetically incompatible with parity — no tuning escapes this.

### The creator carve moves the realized target, and only downward

`splitGraduation` takes the creator carve out of the LP 80, so the realized multiple is
`G = (0.8 − c)·(1 − r)/r`, where `c` is the carve as a fraction of the raise. At the default brackets
(`ERC404Factory`) the maximum carve is 45% / 26% / 18% of the raise on NICHE / STANDARD / HYPE,
giving realized multiples of 3.15 / 4.86 / 5.58.

**This cannot be designed against.** `declaredMaxAllowanceBps` is fixed at `initialize`, but
`carveRequestBps` is the creator's free choice inside `deployLiquidity`, long after
`computeCurveParams` has run. The curve is therefore solved against the **no-carve** target, and a
carve makes the pool open *below* the curve's end price — the safe direction, but a real exposure to
the last decile of buyers, which under this shape carries ~37.7% of the raise.

### Owner-tunable levers this derivation depends on

- `liquidityReserveBps`, via `LaunchManager.setPreset` — moves `G` directly. The pole is solved from
  it per collection, so a retune stays on parity for collections created after it.
- the carve brackets, via `ERC404Factory.setCarveBrackets` — moves the realized multiple downward by
  as much as the bracket allows.
- `CurveParamsComputer.setCurveWeights` — amplitude and the solve probe only (§6).

---

## 6. The solve, and the parameter band

### Solve

`computeCurveParams` solves `G(ε) = targetG` by **bisection over the band**, with a fixed maximum
iteration count — never an unbounded loop. `G` is strictly decreasing in `poleWad` over the band, so
the bracket is `[MIN_POLE_WAD, MAX_POLE_WAD]` and a target outside the endpoints' multiples reverts
`ParityTargetUnreachable` rather than silently clamping. The band serves reserves from roughly 600 to
3550 bps.

**The result is asserted, not trusted.** After solving, the achieved `G` is recomputed from the
resulting pole and compared to the target; outside `PARITY_TOLERANCE_WAD` (1e-6 relative) the create
reverts `ParityToleranceExceeded`. A create that would produce an off-parity curve fails loudly at
create rather than shipping.

The solve runs once per collection at create. It is not hot-path gas.

### Band

`setCurveWeights` enforces **`poleWad ∈ [1.02e18, 2e18]`**.

A bare `> 1e18` check is not sufficient, and the reason is measured rather than theoretical: at
`poleWad = 1e18 + 1e6` — still strictly beyond the cap — the raise is still exactly right, `lnWad`
stays in domain, nothing overflows and nothing reverts, **and the graduation price is on the order of
1e5 ETH per token**. The bond then stalls short of the cap forever. The library is robust across the
entire pole range, which is precisely why the library cannot catch a bad value and the band must.

---

## 7. Distribution — what the shape does to buyers

At `G = 7.2` (`ε = 0.0438`), preset- and `nftCount`-invariant:

| point | price ÷ average |
|---|---|
| s = 0    | 0.302 |
| s = 50%  | 0.581 |
| s = 90%  | 2.193 |
| s = 100% | 7.200 |

The first decile of supply pays ~3.2% of the raise; the last decile pays ~37.7%. Tokens per ETH for
the first decile versus the last is ~11.9×.

**This transfer is the design, not a defect.** Under a pinned total, early-buyer transfer and early
price discovery are the same quantity with opposite signs: any price the early buyer does not pay,
the late buyer does. Averaging, damping or per-buyer caps would flatten it and, by the `1/G` bound,
break parity.

**Free-mint interaction.** Free-mint allocations are transferred without incrementing
`totalBondingSupply` (`ERC404BondingOps.claimFreeMint`), and `sellBonding` debits the reserve for the
integral at the seller's supply whatever the seller's coin cost them. So a claimant sells at the top
of the curve against a reserve they never funded. The allocation is removed from the curve's span at
create (`ERC404Factory`: full supply, less the LP reserve, less the allocation), so the tranche is
not supply the curve was ever going to sell: what moves is ETH, not oversold coin, and both solvency
claims of §2 hold exactly with an allocation on
(`test/invariant/BondingCurveFreeMintInvariant.t.sol`). That solvency is not free, and what it costs
is at the end of this section — the transfer is sized first because the size is what a creator sets.

Steepening amplifies the transfer, because the allocation is a fraction of **supply** while the
reserve it can take is a fraction of the **raise**, and the top of a steep span holds far more of the
raise than of the supply. With `φ` the allocation's share of the span and `ε = poleWad - 1e18` the
pole gap of §6, the fraction of the raise a full dump removes is

```
drain(φ) = ln((ε + φ) / ε) / ln((1 + ε) / ε)
```

**Sizing, at the reserve every shipped preset carries** (1000 bps, `G = 7.20`):

| allocation (of full supply) | `φ` (share of span) | drain (share of raise) | vs flat |
|---|---|---|---|
| 5%  | 5.88%  | **26.85%** | 4.57× |
| 10% | 12.50% | **42.54%** | 3.40× |
| 25% | 38.46% | **71.91%** | 1.87× |

`φ` exceeds the allocation because the span is supply less the LP reserve **and less the allocation
itself**, so the allocation both shrinks what the curve sells and enlarges what can be dumped into
it. All three shipped rungs carry `liquidityReserveBps: 1000` (`script/LaunchPresets.sol`), and the
reserve is the only preset field the shape depends on — `targetETH` scales `kCoeff` and `unitPerNFT`
scales the id space, neither of which moves the distribution — so this table is the ladder's, not one
rung's.

**Shape sensitivity**, a 10% allocation at the endpoints of the admissible reserve band:

| LP reserve | `G` | `φ` | drain | vs flat |
|---|---|---|---|---|
| 600 bps  | 12.53 | 11.90% | **49.13%** | 4.13× |
| 1000 bps | 7.20  | 12.50% | **42.54%** | 3.40× |
| 3550 bps | 1.45  | 18.34% | **24.43%** | 1.33× |

A flat shape holds the raise uniformly across the span, so it would give up exactly `φ`; the last
column is the amplification over that. **The amplification is not `G`.** `G` is the ratio of the
curve's last price to its average — what an infinitesimal slice at the very endpoint would see. A
finite slice reaches down the curve into cheaper supply and averages well below the endpoint, so
quoting `G` here overstates the drain by better than a factor of two. The drain is largest where the
LP reserve is smallest, because a smaller reserve buys a steeper curve.

**Timing.** Sold early the dump takes a larger share of a smaller reserve: claimants selling the
moment the curve has sold as much as they hold take **every wei** in it, which at the shipped reserve
is 4.02% of the raise. Worst case in ETH is the full curve; worst case as a fraction is the empty
one, and it is small money — neither alone is the figure.

**What the reserve's solvency costs, and who pays it.** `calculateRefund` reverts
`AmountExceedsSupply` above `totalBondingSupply`, so the reserve can never be sold below zero — and
that refusal is exactly how solvency is preserved. It is also where the loss lands. The identity is
exact and holds at every instant:

```
Sum(holder balances)  ==  totalBondingSupply + freeMintsClaimed · unit
```

because a buy raises the counter by its amount, a claim raises it by nothing, and a sell lowers it by
its amount. So of the coin in circulation only `totalBondingSupply` can ever be sold back: once the
tranche is dumped the counter is short by exactly the claimed allocation, and that much coin **cannot
be sold at any price**. The shortfall is not shared pro rata — it falls in reverse exit order, on
whoever is still holding when the counter runs out, and that can be a paid buyer. Solvency and
universal exit are different promises and the curve keeps only the first.

Every number and identity above is measured or asserted, not derived by hand:

    forge test --match-contract 'FreeMintReserveDrain|BondingCurveFreeMintInvariant'

The allocation is the creator's choice; the numbers are stated here so they are known when it is
chosen, and `app/src/lib/learn/concepts.ts` states the same cost — including the unsellable tail — on
the surface the creator actually reads.

---

## 8. Revenue Split

`RevenueSplitLib.split(amount)` applies the canonical 1/19/80 split:

```
protocolCut = amount / 100                    (floor — 1%)
vaultCut    = (amount × 19) / 100             (floor — 19%)
remainder   = amount − protocolCut − vaultCut (~80%, absorbs dust)
```

The remainder is always ≥ `amount × 80 / 100` because both other terms round down. Maximum dust
absorbed: 1 wei from protocolCut + 1 wei from vaultCut = **2 wei** added to remainder.

| Context               | Input amount        | Protocol (1%) | Vault (19%) | Remainder (80%) |
|-----------------------|---------------------|---------------|-------------|-----------------|
| ERC404 graduation     | accumulated reserve | treasury      | vault       | LP deployment   |
| ERC1155 withdrawal    | sale proceeds       | treasury      | vault       | artist          |
| ERC721 settlement     | winning bid         | treasury      | vault       | artist          |
| Vault LP yield        | yield amount        | 1% to treasury| —           | 99% to benefactors |

---

## 9. Bonding Fee

```
totalCost    = BondingCurveMath.calculateCost(params, supply, amount)
bondingFee   = (totalCost × bondingFeeBps) / 10000    (round down)
totalWithFee = totalCost + bondingFee
```

- `bondingFee` goes to the protocol treasury during the buy
- only `totalCost` is added to `reserve`
- slippage check: `totalWithFee ≤ maxCost`
- on sell, no fee — the refund is the raw curve integral

---

## 10. Liquidity Pool Initialization (Uniswap V4)

At graduation the accumulated `reserve` is split and the remainder seeds a V4 pool.

```
numerator    = token0IsThis ? ethForPool : tokensForPool
denominator  = token0IsThis ? tokensForPool : ethForPool
priceX192    = fullMulDiv(numerator, 2^192, denominator)
sqrtPriceX96 = √(priceX192)
sqrtPriceX96 = clamp(sqrtPriceX96, MIN_SQRT_PRICE + 1, MAX_SQRT_PRICE − 1)
```

Full-range liquidity is provided (min/max usable ticks for the configured tick spacing). The price
this opens at is the `poolOpenPrice` of §5 — the number the curve is solved to meet.

---

## 11. Overflow Analysis

### Bonding curve integral

`arg` is in `[1, 1e18]` by construction, so `−lnWad(arg)` is at most ~41.4e18 (the value at `arg = 1`).
The only multiplication is `mulWad(kCoeff, −ln)`, whose largest intermediate is `kCoeff × 41.4e18`;
`kCoeff` is on the order of `targetETH`, so the intermediate stays around 1e38 — far inside uint256
(max ≈ 1.16e77) — and it is **independent of the pole**. `expWad` is never called by this family, so
its overflow ceiling is not reachable at all.

### Revenue split

`amount × 19` overflows only above ~6.1e75. Amounts are ETH-denominated (realistic max ~1e25 wei), so
there is no overflow risk.

---

## 12. Numerical Example

**Profile**: 10,000 NFTs, 1M tokens/NFT, 1000 bps liquidity reserve, target 100 ETH.

```
totalSupply      = 10000 × 10^6 × 10^18 = 10^28
liquidityReserve = 10^28 × 1000 / 10000 = 10^27
maxBondingSupply = 9 × 10^27
normFactor       = 9 × 10^27 / 10^18    = 9 × 10^9

targetG = 0.8 × 9000 / 1000 = 7.2
poleWad ≈ 1.0438e18                      (solved, then asserted)
kCoeff  = kWeight ×_wad (100 ether ÷_wad referenceArea)
```

Buying the whole `maxBondingSupply` costs ~100 ETH. The first token prices at ~0.302× the average and
the last at ~7.2× it, which is where the pool opens:

```
reserve       ≈ 100 ETH
protocolCut   = 1 ETH
vaultCut      = 19 ETH
ethForPool    = 80 ETH
tokensForPool = liquidityReserve = 10^27
poolOpenPrice = 80 ETH / 10^27 base units  ==  the curve's final price
```

---

## 13. What the gates assert

- `test/factories/erc404/CurveParamsComputer.t.sol` — preset × `nftCount` matrix asserting, per cell
  and two-sided: the raise stays pinned to `targetETH`; a normalization quantum is never free; the
  last/first price ratio matches the closed form; and the curve's final price matches the pool's
  opening price. Plus: a reserve other than 1000 bps solves to a different pole and still hits
  parity; the band refuses a pole at either end and refuses `1e18 + 1e6`; the owner probe cannot move
  the solved pole; an unreachable target reverts.
- `test/libraries/BondingCurveMath.t.sol` — the closed forms across the whole band, the pole domain
  guard, sell-side symmetry at both boundaries and the first and last unit, and the price
  distribution.
- `test/factories/erc404/FreeMintReserveDrain.t.sol` — every free-mint figure in §7, measured from the
  library rather than reasoned about: the drain and its amplification at the shipping preset, both
  endpoints of the admissible reserve band (with monotonicity between them, so the endpoints are a
  bound and not two samples), and the early-sale case together with the `AmountExceedsSupply` floor
  under it.
- `test/invariant/BondingCurveFreeMintInvariant.t.sol` — the allocation's own fixture: production
  curve params at `G = 7.2`, an allocation of 10% of supply, twelve wallets chasing ten claims, and
  fuzzer-interleaved paid buys, paid sells, free claims and sales of free coin. `reserve == balance`
  and `reserve == F(totalBondingSupply)` both hold exactly, with zero tolerance, as does the
  circulation identity above. Each run is gated on having actually claimed, sold free coin, and hit
  `FreeMintExhausted` — an allocation nobody claims tests nothing.
- `test/invariant/BondingCurveInvariant.t.sol` — the stateful multi-actor curve-and-tiers suite. It
  carries a small allocation as well, so free coin meets the sealed tier ladder: it can fund a
  `mintUp`, be caught by a band burn, and be sold back down the curve mid-sequence. It previously
  configured the allocation to 0, which left free coin unevaluated against every claim in that file.

Direction-only assertions (`assertGt` on a rising price) are deliberately absent from both: they pass
on a one-wei rise, which is what allowed a flat curve to read green.

---

## 14. Known follow-ups

- `app/src/components/collection/erc404/curveSampler.ts` re-implements the price curve in TypeScript
  for the chart. Nothing pins that implementation to the Solidity one; a divergence means the chart a
  buyer sees is not the price they pay. A cross-implementation gate is not in this document's scope.
The free-mint reserve drain (§7) is **not** on this list. Locking free-mint tokens from `sellBonding`
until graduation, or counting them into `totalBondingSupply`, was considered and declined: the
tranche is a design decision (ruling, rth, 2026-09-17), and what the decision owes is disclosure
rather than a mechanism change. The three surfaces that owe it are §7's figure, the app's learn copy,
and a fixture that actually evaluates the curve with an allocation on — all three named in §7 and
§13.
