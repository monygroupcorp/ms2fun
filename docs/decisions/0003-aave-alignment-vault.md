# ADR-0003 — Aave Alignment Vault (refundable-deposit, yield-funds-alignment)

**Status:** Economics locked 2026-06-23 (Mony). Architecture proposed; implementation = Phase 2 T4.
**Supersedes:** the legacy alignment-vault + Uniswap-LP model (RETIRE — see
`phases/phase-2-reconciliation.md`). **Does NOT touch** the collection's own bonding→DEX LP, which
stays (lean kills the LP *vault*, not the LP).

## Context
Every collection skims **19% of each raise** into an alignment vault. The old vault bought + LP'd
the *community's* token (durable buy-pressure/liquidity). We're replacing it with a **safe Aave
yield vault**. The design question was who gets the principal and who gets the yield. Decision:

> **The 19% is a REFUNDABLE DEPOSIT, not a tax.** The creator gets the principal back at maturity.
> The **yield** it earns **funds the alignment target** (the community).

Rationale: the platform's real revenue is the **1% at settlement** (volume-based), so the platform
should maximize creator adoption. What repels creators is losing **principal** (concrete), not
**yield** (abstract, small). So return principal, donate yield — "a charitable CD." Creators keep
the part they care about; the community gets a durable, compounding stream (aggregate Aave yield
across all aligned collections, growing with TVL). Honest caveat: early-stage yield is *small*
(~2-4% on the parked 19%); near-term "alignment" is mostly the visible parked TVL + exit penalties.
*(This reverses an earlier "creator keeps the yield" lean — see decision log.)*

## Economic model (the money flows)

| Flow | platform | Aave vault | LP | creator | alignment target |
| --- | --- | --- | --- | --- | --- |
| **Settlement** (raise R, in) | 1% | **19%** (deposit) | 80% | — | — |
| **Yield** (harvested, ongoing) | 1%¹ | — | — | — | **99%** |
| **Principal @ maturity** (out) | — | — | — | **100%** | — |
| **Principal EARLY exit** (out) | 1% | — | — | 19% | **80%** |

¹ Platform yield cut is a small parameter (default 1%); the point of the yield is alignment, not
platform revenue.

- **Settlement split (1/19/80) is UNCHANGED** — `RevenueSplitLib` untouched; existing liquidity
  deployers route the 19% to this vault via `IAlignmentVault.receiveContribution`.
- **Maturity** is a per-collection lock the creator chooses at launch. Before maturity, exiting
  principal costs the **80% alignment / 19% creator / 1% platform** penalty (this IS the
  "pay-to-unlock-early" mechanism — the cost of leaving is forfeiting most principal to alignment).
  At/after maturity, principal returns **100%** to the creator.
- **Yield destination form:** send value (ETH/WETH) to the alignment target for the MVP.
  *Deferred option:* swap the alignment cut into the community's **token** before sending (restores
  the old model's buy-pressure) — more contract surface; ship cash-first.

## Architecture (lean, off-the-shelf where possible)
- **Inner yield engine = Aave `StaticATokenV2` ("stataToken")** — the official, Certora-verified,
  **non-rebasing** ERC-4626 wrapper over the aToken. Do NOT hand-roll aToken accounting (it
  rebases). Asset = **WETH** (wrap ETH on deposit; no swap/DEX dependency). Addresses sourced from
  `bgd-labs/aave-address-book`, never hardcoded.
- **Outer = a custom `AlignmentYieldVault`** (one per alignment target). It is deliberately **NOT**
  an ERC-4626 to depositors: creators hold a **fixed principal claim** (debt-like), not appreciating
  shares — the appreciation (yield) is redirected to alignment. It holds stataToken internally and
  tracks per-benefactor principal + maturity.
  - Deposits arrive only from the protocol's liquidity deployers (trusted, programmatic) — not
    arbitrary users — which lowers the inflation-attack surface; still guard share/round math.
- **`IAlignmentVault` conformance** (so registration + all three collection types + the existing
  deployers work unchanged):
  - `receiveContribution(currency, amount, benefactor)` → wrap ETH→WETH, supply via stataToken,
    record `principal[benefactor] += amount`, start/extend the benefactor's lock.
  - `alignmentToken()` → the target's community token (required by `MasterRegistry.registerVault`).
  - `vaultType()` → `"AaveYield"`.
  - `accumulatedFees()` → harvestable yield = `valueOf(stataToken) − totalPrincipal` (this accrues
    to **alignment**, not benefactors — semantics shift from the old model).
  - `claimFees()` / `calculateClaimableAmount(benefactor)` → **repurposed**: a benefactor's
    claimable = their matured principal (else 0). The yield→alignment path is a separate
    `harvest()` (callable by anyone / keeper; routes to the target).
  - new: `withdrawPrincipal(benefactor)` (maturity → 100%; early → 80/19/1) and `harvest()`.

## Accounting
`vault stataToken value = totalPrincipal + pendingYield`. `totalPrincipal` = Σ benefactor deposits
(fixed, refundable). `pendingYield` = the spread, swept to alignment on `harvest()`. Creator
withdrawals redeem **principal only**; they never capture yield. A benefactor = a collection
instance (the deployer passes `instance` as `benefactor`).

## Parameters
- **Per-collection (creator-chosen at launch):** `maturity` (lock duration), `alignmentTarget`
  (an active AlignmentRegistry target).
- **Platform constants (MVP — opinionated; could become dials later):** settlement 1/19/80,
  early-exit 80/19/1, platform yield cut (default 1%).

## Risks / guards (Aave v3, long-lived position)
- Use stataToken (non-rebasing) — never account against a raw rebasing aToken.
- Reserve **pause** blocks withdraw/supply (temporary) → fail gracefully, no "funds stuck forever"
  assumption. Reserve **freeze** blocks new supply but allows withdraw. **Supply caps** can revert
  deposits → handle gracefully. Keep the position **migratable** if a reserve is deprecated.
- Supply-only; never enable the position as borrow collateral.
- Guard inflation/round math at the outer layer even though deposits are trusted.

## Foundry test plan (Phase 2 T4 exit)
1. Settlement deposit credits benefactor principal; 19% supplied to Aave.
2. Yield harvest sends the spread to the alignment target (− platform cut); principal untouched.
3. Principal @ maturity → 100% creator.
4. Principal early exit → 80% alignment / 19% creator / 1% platform.
5. Registration: `alignmentToken()` + active-target checks pass `MasterRegistry.registerVault`.
6. Aave pause/freeze/cap revert paths fail cleanly.

## Decision log
- **2026-06-23** — Locked: refundable deposit + yield-funds-alignment. Reverses an earlier
  "creator keeps yield" lean once we separated principal (refundable, the part creators fear losing)
  from yield (the painless donation). Honest tradeoff acknowledged: early yield is modest; durable
  alignment value is the parked TVL + compounding stream + exit penalties, not a token-buy firehose
  (the token-buy form is a deferred option).
