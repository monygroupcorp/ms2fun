# Task — Vault Flavors (Yield + LP families in the wizard)

**Status:** Not started (design Locked)
**Depends on:** T4 Aave endowment vault (✅ done), metadata stack (✅ shipped). Slots **before / into
Phase 4** (testnet) — see Open decision O5.
**Exit gate owner:** Mony (human acceptance)

> A creator picks a vault by **family first, venue second** — "Yield vault" (Aave endowment) vs
> "LP vault" (→ Uniswap V4 / ZAMM / Cypher) — and every family is a real, wired, selectable path.

---

## Goal
Promote the three liquidity-provision vaults (Uniswap V4, ZAMM, Cypher) back to **first-class,
supported** alongside the Aave endowment vault, and express the choice in the wizard as a two-level
decision tree. The motivating use case: seeding **real, tradeable liquidity** in the aligned token on
mainnet — an LP vault builds a market (price discovery + exit liquidity), where the Aave endowment only
parks WETH earning yield. Different tools; the creator should choose deliberately.

**This is a promotion + wiring task, not a rebuild.** All four vault families already live in
`contracts/src/vaults/{aave,uni,zamm,cypher}`, all implement `IAlignmentVault`, all were re-audited
this cycle (F1/F4/F7 Uni · F5 ZAMM · #36 Cypher), and the Uni V4 vault is *already* deployed +
registered + selectable on the fork today. The gap is: (a) two LP families are flag-gated off, (b) the
LP vaults register but aren't operationally wired to actually LP, and (c) the wizard shows a flat vault
list instead of the family→venue tree.

## Scope
**In:**
- Deploy + register all four vault families per alignment target (flip the ZAMM/Cypher flags on).
- Per-target **operational wiring** that makes an LP vault actually provide liquidity: pool key +
  price validator for each DEX.
- A two-level wizard picker: alignment target → **family** (Yield / LP) → **venue** (Uni / ZAMM /
  Cypher), grouped off the on-chain `vaultType()`, with a one-line tradeoff per option.
- Tests (forge registration + fork LP round-trip + frontend picker + fork-walk) and the doc/ADR
  un-retirement of the LP model.

**Out (explicitly deferred):**
- The deeper pre-mainnet **vault security review** → Phase 4 (this task only *adds the 3 LP vaults to
  its scope*; it does not run it).
- Any *new* DEX integration beyond the three that already exist → backlog.
- Unifying the two economic models → not happening; they coexist per-vault by design (see D3).

## Design decisions
**Locked:**
- **D1 — Two families, creator's choice.** `Yield` = `AaveEndowment`; `Liquidity` = the three LP
  vaults. All three LP venues are first-class, not one blessed default.
- **D2 — Grouping key = on-chain `vaultType()`.** Every vault self-reports:
  `AaveEndowment` · `UniswapV4LP` · `ZAMMLP` · `CypherLP`. Discriminator: suffix `"LP"` → LP family;
  prefix → venue. No new registry field, no name-parsing. (`supportsCapability(YIELD_GENERATION)` is a
  secondary signal available if needed.)
- **D3 — Economic models stay per-vault, unchanged.** LP vaults run the `1/19/80` graduation split;
  the Aave endowment runs principal-deposit + tithe-out (`ADR-0003`). The creator's family choice
  *is* the economic-model choice; the wizard must surface that tradeoff, not hide it.
- **D4 — Uni V4 is the workhorse.** Deepest/most-real liquidity venue; ZAMM and Cypher are offered but
  situational. Ordering + copy should reflect that (Uni first).

**Open (resolve before the lock gate):**
- **O1 — Per-target LP wiring ownership/flow.** Who calls `setV4PoolKey` / sets ZAMM `poolKey` /
  configures Cypher, and when — deploy-time vs a governance/owner op? It's **per alignment target**
  and recurring (every new target needs its LP pools wired). Proposal: an owner-run runbook step,
  scripted in deploy + seed.
- **O2 — Gate LP availability on wiring completeness.** Recommended: a target only offers an LP
  *venue* in the wizard once that venue's pool key **and** price validator are set — otherwise hide/
  disable it, so a creator can't pick a vault whose graduation would fail. (Alternative: show all,
  accept broken-graduation risk — rejected unless O1 makes wiring guaranteed-at-deploy.)
- **O3 — Price validators for mainnet.** Uni is deployed with `IVaultPriceValidator(address(0))` and
  F5 flagged the ZAMM validator is never set. Which oracle/floor per venue, and it MUST be non-zero
  before mainnet LP (anti-sandwich/MEV on the liquidity add).
- **O4 — Do we require all three per target, or let a target opt into a subset?** (e.g. a target with
  no ZAMM pool just doesn't offer the ZAMM flavor.) Interacts with O2.
- **O5 — Sequencing:** standalone pre-Phase-4 task, or folded into Phase 4 testnet. Adds audit
  surface either way.

## Task units
Agent-runnable where noted; the wiring unit (T2) is lead-owned (drift-prone, like T4 was).

- [ ] **T1 — Deploy/config (mechanical).** Flip `deployCypherVault` + `deployZAMMVault` → `true` in
      `DeployAnvil.s.sol` + `DeploySepolia.s.sol` (and the mainnet config when it lands) so all four
      vaults register per target. Confirm `ValidateSepolia.s.sol` asserts all four are registered per
      target. *(shared: DeployCore config structs — serialize with T2.)*
- [ ] **T2 — LP functional wiring (lead).** Make each LP family actually LP: Uni `setV4PoolKey` +
      price validator; ZAMM `poolKey`; Cypher position-manager/router + validator. Design the
      per-target flow (O1), script it into `DeployCore`/`SeedAnvil` so a fork collection can graduate
      and add liquidity end-to-end. **This is the load-bearing unit.**
- [ ] **T3 — Wizard data (agent).** Extend `app/src/components/wizard/useRegisteredVaults.ts` to read
      `vaultType()` per registered vault and derive `{ family: 'yield' | 'lp', venue }`. Optionally
      read `description()` for the tradeoff copy.
- [ ] **T4 — Wizard UX (agent).** Rework the alignment step (`WizardPage.tsx`) into the two-level
      picker: target → family → venue, with per-option tradeoff copy. Selection still resolves to a
      single `modules.vault` address — **`submit.ts` is unchanged** (it already just takes the vault
      address). Honor O2 (hide/disable un-wired venues).
- [ ] **T5 — Tests (agent).** Forge: all four vaults register per target + `vaultType()` returns the
      four strings + `ValidateSepolia` asserts them. Frontend unit: picker groups correctly from
      `vaultType()`. Fork-walk: create a collection against a Uni LP vault and run to graduation/LP
      add, asserting a live position (off the `anvilWallet` + `@fork` template, like
      `metadata.spec.ts`). ZAMM/Cypher smoke behind their flags.
- [ ] **T6 — Docs (agent).** Un-retire the LP model: `contracts/CLAUDE.md`, `ADR-0003` (or a new ADR
      "two vault families"), and the `new-direction` framing. Document the flavor taxonomy + the
      per-target LP wiring runbook from T2.
- [ ] **T7 — Audit scope (note, → Phase 4).** Fold the three LP vaults + the pool-key/validator
      wiring into the pre-mainnet vault review. Incremental (they were audited once) but the deeper
      pass now covers V4 LP mechanics, not just Aave.

## Exit criteria
Runnable proofs:
1. `pnpm chain:deploy` on the fork registers **four** vaults per alignment target; reading
   `vaultType()` on each returns `AaveEndowment` / `UniswapV4LP` / `ZAMMLP` / `CypherLP`.
2. A fork collection created against a **Uni V4 LP vault** graduates and adds liquidity — a real pool
   position exists on-chain (pool key + validator wired). ZAMM/Cypher at least register + type-check.
3. The wizard renders the **family → venue** tree from `vaultType()`; picking any family produces a
   working create tx; un-wired venues are hidden/disabled (O2).
4. No "retiring LP / LP is legacy" language remains as *current* guidance in the docs.
5. Green bar: `forge test` · frontend tests + lint · the new vault-flavor fork-walk.

## Verification
`cd app && pnpm chain:fork` + `pnpm chain:deploy`; `forge test` (+ `ValidateSepolia` dry-run);
`pnpm test:e2e` incl. the new `app/e2e/vault-flavors.spec.ts`; manual fork round-trip on the LP
graduation path (lead, per T2). Mainnet-shaped price-validator/pool-key values verified on the
archive fork before Phase 4.

## Decision log
- **2026-07-01** — Task opened. Locked D1–D4. Confirmed (source): all four vault families present +
  `IAlignmentVault` + audited; `vaultType()` returns the four discriminator strings; DeployCore
  instantiates all four factories and registers per-target behind `deployUniVault`/`deployCypherVault`/
  `deployZAMMVault` (Anvil + Sepolia currently Uni-only); wizard `useRegisteredVaults` reads
  registration events only (no `vaultType()` yet). Reverses the `new-direction` "retire LP for Aave"
  framing — the code never removed them.

## Open questions
O1–O5 above. O1/O2/O3 are the load-bearing ones — they gate whether an LP vault is *safe to select*,
not just *visible*. Resolve O5 (sequencing) with Mony before starting T2.
