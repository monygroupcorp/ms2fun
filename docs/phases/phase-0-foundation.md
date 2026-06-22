# Phase 0 — Foundation & Constitution

**Status:** ✅ DONE — accepted by human 2026-06-22 (live G8 carried to Phase 1; see execution doc)
**Depends on:** repo cleanup landed on `main`
**Exit gate owner:** Mony (human acceptance)

> A clean `app/` exists that connects a wallet, reads a real value off a forked contract via
> generated typed bindings, with strict TS + CI green — and the technical constitution is written.

---

## Goal
Stand up the new stack so that every later phase is built on enforced rigor, not good
intentions. This phase produces almost no user-facing feature — its output is **a foundation
that makes remnants structurally impossible** plus the written rules that keep it that way.

## Scope
**In:**
- `docs/ARCHITECTURE.md` — the technical constitution (stack, module boundaries, naming, the
  no-remnant rules, where generated code lives, how the fork/config flows in).
- Scaffold `app/`: React + Vite + TypeScript (strict), ESLint + Prettier, test runner.
- CI pipeline enforcing the Definition of Done (typecheck, lint, test, build).
- **Generated contract bindings** from the Foundry ABIs (wagmi CLI) → typed reads/writes.
- wagmi + viem config with two chains: mainnet + the anvil fork (`localhost:8545`).
- Wallet connection (chosen kit) rendering once, app-wide.
- **Quarantine:** move old frontend `src/` → `legacy/` (nothing in `app/` imports it).
- Wire the existing anvil mainnet-fork loop to feed addresses/ABIs into `app/`.

**Out (deferred):**
- Any real feature flow → Phase 1+.
- Styling system beyond design-token scaffolding (tokens file + reset) → demos ported in Phase 1.
- The ERC-8244 micro-frontend → later track.

## Design decisions
**Locked:**
- React + Vite + TS (strict) + wagmi + viem + TanStack Query. *(WAR_PATH)*
- Generated bindings via wagmi CLI from Foundry ABIs — no hand-rolled adapters. *(WAR_PATH)*
- CSS Modules + CSS-variable design tokens for the main app. *(WAR_PATH)*
- New app lives at `app/` in this monorepo; old `src/` quarantined to `legacy/`, deleted at parity.
- **Wallet:** wagmi's built-in connectors (EIP-6963-native multi-injected discovery) + a
  hand-authored brutalist connect UI. **No ConnectKit/RainbowKit; do not port the old custom
  6963 connector** (wagmi covers it). Add `walletConnect` connector only if/when mobile/remote
  wallets are needed. *Rationale: leanest path, full aesthetic control, less code than porting.*
- **viem + wagmi confirmed** as the foundation — the ecosystem standard (wevm), actively
  maintained; explicitly de-risks the bus-factor problem that killed bespoke micro-web3.
- **Package manager:** pnpm (+ pinned Node version).
- **Test stack:** Vitest (unit/component) + Playwright (e2e against the fork).
- **CI:** GitHub Actions, gating the Definition of Done (typecheck + lint + test + build).
- **Bindings ↔ fork bridge:** generate bindings/typed config in the dev loop from
  `contracts.local.json` + ABIs (live, never stale) — not committed artifacts.
- **Generated code:** `app/src/generated/**`, lint-ignored, never hand-edited.
- **Router:** **wouter** (~1.5KB). URL-state capability (shareable links, refs, refresh-survival)
  comes from any router; TanStack Router's type-safety premium is small for our ~2–3 params and
  doesn't cover the one case that matters (runtime-validating a money-bearing `ref`), which we
  hand-write regardless. Pair wouter with a tiny **validated-param helper** (zod / viem
  validators) on params that matter. See ADR-0002.

**Open (resolve at the lock gate):**
- _None — all Phase 0 decisions locked. Ready to execute on human go._

## Task units
- [ ] T0 — Write `docs/ARCHITECTURE.md` (depends on the Open decisions being locked).
- [ ] T1 — Scaffold `app/` (Vite + React + TS strict, ESLint, Prettier, Vitest). *(parallel-safe)*
- [ ] T2 — CI workflow: typecheck + lint + test + build. *(after T1)*
- [ ] T3 — wagmi/viem config: mainnet + anvil fork chains. *(after T1)*
- [ ] T4 — wagmi CLI bindings generation from ABIs + the fork-config bridge. *(after T3; touches dev loop)*
- [ ] T5 — Wallet kit integration (chosen in Open #1). *(after T3)*
- [ ] T6 — "Hello chain" view: connect wallet, read one value off a forked contract via bindings. *(after T4,T5)*
- [ ] T7 — Quarantine `src/` → `legacy/`; ensure `app/` has zero imports from it; build still green. *(isolate)*

## Exit criteria
1. `app/` builds clean; **typecheck, lint, test all green in CI.**
2. From a browser on the anvil fork, connect a wallet and **read a real value off a deployed
   contract through generated typed bindings** (the "hello chain" proof).
3. `app/` contains **zero imports** from `legacy/` (grep-proven).
4. `docs/ARCHITECTURE.md` exists and the team (human) accepts it as the constitution.

## Verification
- CI run link (gates green).
- Screen/recording or `/run` of the hello-chain view reading fork state.
- `grep -r "legacy/" app/src` returns nothing.
- Human review of `ARCHITECTURE.md`.

## Decision log
- Wallet: wagmi native 6963 connectors + custom brutalist UI; no kit, no ported connector. (ADR-0001)
- Web3 stack: viem + wagmi (injected-only, no vendor), defended vs alternatives. (ADR-0001)
- Tooling: pnpm, Vitest + Playwright, GitHub Actions.
- Bindings generated in the dev loop (live); generated code isolated to `app/src/generated/**`.
- Router: wouter + validated-param helper. (ADR-0002)
- **All Phase 0 decisions locked 2026-06-22 — ready to execute.**
- Wave 0: `docs/ARCHITECTURE.md` **accepted by human 2026-06-22**. Executing Wave 1.

## Open questions
- See Design decisions → Open (1–7). These are the immediate "nail it down" items.
- Does the existing anvil loop already emit ABIs in a shape wagmi CLI can consume, or is a small
  adapter step needed? (Investigate during T4 planning.)
