# ADR-0008 — Two vault families (Yield + Liquidity), creator's choice

**Status:** Design LOCKED 2026-07-01 (Mony). Implementation = the "Vault Flavors" task
(`docs/phases/vault-flavors.md`), slotting before / into Phase 4 (testnet).
**Supersedes the retirement framing:** reverses the "retire the Uniswap-LP / alignment-vault model
in favor of a simple Aave vault" direction. The LP vaults are **NOT** retired — they are a
first-class vault family alongside the Aave endowment. See [ADR-0003](0003-aave-alignment-vault.md)
(the Aave endowment economics — unchanged, now one family of two) and
`docs/phases/phase-2-reconciliation.md` §"RETIRE" (the earlier framing this corrects). **Does NOT
un-retire** DAO/governance — GrandCentral/Safe/Timelock voting stays retired; EXEC404 / Cult
Executives stays grandfathered on its live deployment.

## Context
An earlier reconciliation (Phase 2, 2026-06-22/23) read "lean, onchain-only boutique launchpad" as
"one vault: a simple Aave yield vault; retire the Uniswap-LP alignment vaults." That was wrong on the
facts: **the code never removed the LP vaults.** All four vault families still live in
`contracts/src/vaults/{aave,uni,zamm,cypher}`, all implement `IAlignmentVault`, all were re-audited
this cycle, and the Uni V4 vault is already deployed + registered + selectable on the fork.

The motivating use case makes both families necessary. An **LP vault** seeds *real, tradeable
liquidity* in the aligned token — it builds a market (price discovery + exit liquidity). The **Aave
endowment** only parks WETH earning yield; it never builds a market. These are different tools, and
the creator should choose deliberately. So the direction is **two vault families, creator's choice**,
expressed in the wizard as a two-level decision: **family first, venue second.**

## Decisions (locked D1–D4, from `docs/phases/vault-flavors.md`)

- **D1 — Two families, creator's choice.** `Yield` = `AlignmentEndowmentVault` (Aave); `Liquidity` =
  the three LP vaults. All three LP venues are first-class — there is no single blessed LP default,
  and neither family is "the" vault. The creator picks family, then venue.
- **D2 — Grouping key = on-chain `vaultType()`.** Every vault self-reports exactly one of:
  `AaveEndowment` · `UniswapV4LP` · `ZAMMLP` · `CypherLP`. **Discriminator:** suffix `"LP"` → the
  Liquidity family; the prefix names the venue (`Uniswap` / `ZAMM` / `Cypher`); `AaveEndowment` is the
  Yield family. No new registry field, no name-parsing off the human label.
  (`supportsCapability(YIELD_GENERATION)` is a secondary signal if ever needed.)
- **D3 — Economic models stay per-vault, unchanged, and coexist by design.** The LP vaults run the
  **1% / 19% / 80%** graduation split (RevenueSplitLib, unchanged); the Aave endowment runs
  **principal-deposit + tithe-out** ([ADR-0003](0003-aave-alignment-vault.md)). The creator's family
  choice *is* the economic-model choice — the wizard surfaces that tradeoff rather than hiding it.
  There is no unification of the two models; they are per-vault.
- **D4 — Uniswap V4 is the workhorse.** Deepest / most-real liquidity venue; ZAMM and Cypher are
  offered but situational. Wizard ordering + copy reflect that (Uni first).

## Flavor taxonomy
| `vaultType()` | Family | Venue | Contract | Economics |
|---|---|---|---|---|
| `AaveEndowment` | Yield | Aave v3 (WETH) | `AlignmentEndowmentVault` | principal-deposit + tithe-out (ADR-0003) |
| `UniswapV4LP` | Liquidity | Uniswap V4 | `UniAlignmentVault` | 1/19/80 graduation split |
| `ZAMMLP` | Liquidity | ZAMM (constant-product) | `ZAMMAlignmentVault` | 1/19/80 graduation split |
| `CypherLP` | Liquidity | Algebra V2 (concentrated) | `CypherAlignmentVault` | 1/19/80 graduation split |

**Read the family off the suffix, the venue off the prefix.** `"…LP"` → Liquidity family; everything
else (today only `AaveEndowment`) → its own family. The wizard groups the registered vaults for an
alignment target by this key and presents family → venue.

## Per-target LP wiring runbook
An LP venue is *registered* the moment its factory deploys a vault for a target, but it is not
**operationally able to LP** until its pool + price guard are wired — and this is **per alignment
target**, recurring for every new target:

1. **Pool key** — set the venue's pool identity on the vault: Uni `setV4PoolKey(...)`; ZAMM `poolKey`;
   Cypher position-manager/router. Without it, graduation cannot add liquidity.
2. **Price validator** — set a non-zero `IVaultPriceValidator` (anti-sandwich/MEV guard on the
   liquidity add). Uni currently deploys with `address(0)`; ZAMM's validator is never set today
   (audit F5). **This MUST be non-zero before any mainnet LP.**
3. **Gate visibility on wiring completeness.** A target only offers an LP *venue* in the wizard once
   that venue's pool key **and** price validator are set; otherwise the venue is hidden/disabled so a
   creator cannot pick a vault whose graduation would fail (vault-flavors O2).

On the local mainnet-fork the deploy/seed scripts (`DeployCore` / `SeedAnvil`) perform steps 1–2 for
**all three LP venues** (Uni, ZAMM, Cypher) so every family registers + type-checks + reports
`isLiquidityReady()`. Real mainnet-shaped pool-key / validator values are verified on the archive fork
before Phase 4.

### Cypher venue (Algebra Integral)
`CypherLP` is a first-class LP venue backed by **Algebra Integral, which is live on Ethereum mainnet**
and verified present on the fork (positionManager `0x0a984a446A116335ac90425d2D1E69A7199A2f7c`,
swapRouter `0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab`, factory
`0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0` — addresses from the live camel404 mainnet deployment).
`DeployAnvil` wires these real addresses, so the Cypher vault deploys, registers, and self-reports
`vaultType() == "CypherLP"` on the fork alongside Uni/ZAMM/Aave. (A prior draft of this ADR wrongly
stated Cypher was not on mainnet; corrected 2026-07-01.)

## Decision log
- **2026-07-01** — LOCKED: two vault families, creator's choice (D1–D4). Reverses the Phase-2
  "retire LP for Aave" framing — the code never removed the LP vaults; they were re-audited this
  cycle and Uni V4 is live on the fork. Records the `vaultType()` taxonomy (four strings, suffix/prefix
  discriminator) and the per-target LP wiring runbook (pool key + price validator, gated in the
  wizard). DAO/governance stays retired; EXEC404 stays grandfathered. Implementation tracked in
  `docs/phases/vault-flavors.md` (T1–T7).
