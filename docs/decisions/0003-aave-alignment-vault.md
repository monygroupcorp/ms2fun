# ADR-0003 — Aave Alignment Vault (the endowment model)

**Status:** Economics LOCKED 2026-06-23 (Mony). Architecture proposed; implementation = Phase 2 T4.
**Amended 2026-07-01** ([ADR-0008](0008-two-vault-families.md)): the "Supersedes … (RETIRE)" line
below is **corrected** — the Uniswap-LP alignment vaults are **NOT** retired. This vault (the Aave
endowment) is now the **Yield family**, one of two vault families; the LP vaults are the first-class
**Liquidity family** (`UniswapV4LP` / `ZAMMLP` / `CypherLP`), creator's choice. This ADR's economics
(principal-deposit + tithe-out) stand unchanged as the Yield family's model — it just no longer
replaces the LP model. See ADR-0008 for the two-family taxonomy + `vaultType()` grouping.
**Amended 2026-07-07:** the **mint/bid settlement split is now family-aware**. A collection routes its
mint proceeds by its vault's family: **Liquidity-family** collections (`UniswapV4LP` / `ZAMMLP` /
`CypherLP`) pay **creator-heavy** — 1% protocol / 19% vault / **80% creator** (the heavy leg flips to
the creator, the true cash-now donation case); **Yield-family** (this endowment, `AaveEndowment`)
keeps the **unchanged** 1% protocol / 80% vault / 19% creator (the 80% is refundable principal). A
vault whose `vaultType()` is in neither family reverts (deploy-config error, never a silent default).
The endowment economics below are the Yield-family branch and are byte-unchanged.
**Supersedes (superseded — see amendment above):** the legacy alignment-vault + Uniswap-LP model
(RETIRE). **Does NOT touch** the collection's own bonding→DEX LP, which stays (lean kills the LP
*vault*, not the LP).

## Context & north star
The optimization target is **alignment targets (communities like Cult/Milady) championing ms2fun as
the golden standard** — not just creator adoption. The insight that drives the design: **alignment
is the product, not a tax.** A creator aligns to borrow the community's audience and legitimacy; a
community that genuinely benefits will *promote* its aligned collections; that distribution pulls
more creators → more aligned collections → the flywheel. So we optimize for real, durable,
*visible* community value — while keeping creators in by never threatening their **principal**.

**The model:** every aligned collection is a **perpetual endowment** for its community. A slice of
each raise is parked in a safe Aave position; the **creator gets their principal back at maturity**;
the **yield flows mostly to the community's treasury — forever, compounding with every launch.**
That is the line a community points at as golden standard.
*(This reverses two earlier drafts — "yield→100% alignment" and "yield→creator". The endowment with
a small creator purse is the version that serves the championing goal while keeping creators in.)*

## Economic model

### Intake — split the raise (differs by collection type)
| Raise from | platform | vault | LP | creator |
| --- | --- | --- | --- | --- |
| **DN404 / ERC404** (bonding) | 1% | 19% | **80% → LP** | — |
| **ERC1155 / ERC721** (mints) | 1% | **80% → vault** | — | 19% |

- **DN404** needs liquidity, so 80% → the collection's own DEX LP (unchanged 1/19/80); the 19% is
  the endowment deposit.
- **Mints** don't need liquidity, so their 80% → the vault (heavily aligned); the creator takes 19%
  upfront. **Note:** this CHANGES the ERC1155/ERC721 settlement allocation (today 19% vault / 80%
  creator) — the 80% and 19% destinations swap. DN404 intake is unchanged.
- *Optional toggle (future):* a creator may pre-skim from DN404's 80% LP to themselves — that skim
  taxed **80 creator / 19 alignment / 1 platform**.

### Vault — the parked principal (the 19% or the 80%)
| Event | platform | community | creator |
| --- | --- | --- | --- |
| **@ maturity** (refund) | 1% | 19% | **80%** |
| **early exit** (pre-maturity) | 1% | **80%** | 19% |

Principal is a **refundable deposit**: at maturity the creator gets 80% back (a 19% community tithe
on release); pulling early forfeits 80% to the community — the loyalty lock / "pay-to-unlock-early."
Maturity is a per-collection lock the creator chooses at launch.

### Vault — the yield (auto-compounds in Aave; the endowment)
| | platform | community | creator |
| --- | --- | --- | --- |
| **MVP (shipped)** | 1% | **99%** | **0%** |
| target (fast-follow) | 1% | 80% | 19% |

> **MVP reconciliation (2026-06-23):** the shipped vault distributes yield **99% community / 1%
> platform** — the creator's 19% purse is **deferred**. Attributing a per-creator yield slice in a
> single pooled, multi-benefactor position requires a MasterChef-style accumulator; one community
> per vault makes the 99/1 split exact with zero per-benefactor yield accounting. The creator purse
> (restoring 80/19/1) is the documented fast-follow — it's the only thing the accumulator buys.
> **Principal splits are unchanged and shipped as specced** (maturity 80/19/1, early 80/19/1).

The yield **auto-compounds** in the Aave position (stataToken) — no dribbling — so the endowment
grows; we distribute the larger pot on harvest. It is tracked as the **community's endowment**,
kept SEPARATE from the refundable principal (folding it into the creator-returned principal would
hand 80% of the yield back to the creator and break the endowment). Longer maturity → bigger
endowment (+ a bigger creator purse once the fast-follow lands).

**Net:** community = a growing yield endowment (80% of yield) + 19% of principal at maturity;
creator = principal back (80% at maturity) + a 19% yield purse; platform = 1% at every touchpoint.
**Community-value form:** send value (ETH/WETH) to the community's target address for the MVP.
*Deferred option:* swap the community cut into their **token** (buy-pressure + liquidity, the old
model's best feature) — offered as a second vault type via the existing modular vault selection.

## Architecture (lean, off-the-shelf)
- **Inner yield engine = Aave `StaticATokenV2` ("stataToken")** — official, Certora-verified,
  **non-rebasing** ERC-4626 over the aToken. Asset = **WETH** (wrap ETH on deposit; no swap/DEX
  dependency). Addresses from `bgd-labs/aave-address-book`, never hardcoded.
- **Outer = a custom `AlignmentEndowmentVault`** (one per alignment target). NOT an ERC-4626 to
  depositors — creators hold a **fixed principal claim** (the yield is redirected, so shares must
  not appreciate to them). Holds stataToken internally; tracks per-benefactor principal + maturity.
  Deposits arrive only from the protocol's deployers (trusted), lowering the inflation-attack
  surface; still guard round/share math.
- **`IAlignmentVault` conformance** (so registration + all three collection types + existing
  deployers work unchanged):
  - `receiveContribution(currency, amount, benefactor)` → wrap→WETH, supply via stataToken,
    `principal[benefactor] += amount`, start/extend the lock.
  - `alignmentToken()` → the target's community token (required by `MasterRegistry.registerVault`).
  - `vaultType()` → `"AaveEndowment"`.
  - `accumulatedFees()` → harvestable yield = `valueOf(stataToken) − totalPrincipal`.
  - `claimFees()` / `calculateClaimableAmount(benefactor)` → **repurposed**: a benefactor's claimable
    = matured principal share (else 0). Yield distribution is a separate `harvest()`.
  - new: `harvest()` (yield → 80 community / 19 creator / 1 platform; callable by keeper/anyone) and
    `withdrawPrincipal(benefactor)` (maturity → 80 creator / 19 community / 1 platform; early → 80
    community / 19 creator / 1 platform). `creator = IOwnable(benefactor).owner()`; `community = the
    target's payout address`.

## Accounting
`stataToken value = totalPrincipal + pendingYield`. `totalPrincipal` = Σ benefactor deposits (fixed,
refundable). `pendingYield` = the spread, distributed 80/19/1 on `harvest()`. A benefactor = a
collection instance (the deployer passes `instance` as `benefactor`); the creator is its `owner()`.

## Parameters
- **Per-collection (creator-chosen):** `maturity` (lock duration), `alignmentTarget` (active
  AlignmentRegistry target).
- **Platform constants (MVP — opinionated; dialable later):** intake (type-specific above),
  principal splits, yield split (80/19/1).

## Risks / guards (Aave v3, long-lived position)
- Use stataToken (non-rebasing); never account against a raw rebasing aToken.
- Reserve **pause** blocks withdraw/supply (temporary) → fail gracefully. **Freeze** blocks supply,
  allows withdraw. **Supply caps** can revert deposits → handle gracefully. Keep the position
  **migratable** if a reserve is deprecated. Supply-only; never enable as borrow collateral.
- Guard inflation/round math at the outer layer even though deposits are trusted.

## Foundry test plan (Phase 2 T4 exit)
1. **Intake:** DN404 → 1/19(vault)/80(LP); mint → 1/80(vault)/19(creator). Both wire correctly.
2. Yield auto-compounds; `harvest()` distributes **(MVP) 99 community / 1 platform** — creator purse
   deferred (target: 80/19/1); principal untouched.
3. Principal **@ maturity** → 80 creator / 19 community / 1 platform.
4. Principal **early exit** → 80 community / 19 creator / 1 platform.
5. Registration: `alignmentToken()` + active-target checks pass `MasterRegistry.registerVault`.
6. Aave pause/freeze/cap revert paths fail cleanly; position migratable.

## Decision log
- **2026-06-23 (T4 ship)** — MVP yield split reconciled to **99 community / 1 platform**; the creator
  19% yield purse is deferred (needs a per-benefactor accumulator) → fast-follow toward the 80/19/1
  target. Principal splits shipped as specced. See the "MVP reconciliation" note above + the T4 handoff.
- **2026-06-23** — LOCKED: the endowment model. Type-specific intake (DN404 19%→vault/80%→LP; mints
  80%→vault/19%→creator); principal refundable (maturity 80 creator / 19 community / 1; early 80
  community / 19 creator / 1); yield auto-compounds and distributes 80 community / 19 creator / 1.
  Chosen because the north star is communities championing the platform: alignment is the product
  (the flywheel), so optimize for durable visible community value (the endowment) while protecting
  creator principal. Reverses earlier "yield→100% alignment" and "yield→creator" drafts.
