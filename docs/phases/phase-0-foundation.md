# Phase 0 — Foundation & Constitution

**Status:** Not started (planning — nailing down design decisions)
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

**Open (resolve at the lock gate):**
1. **Wallet kit** — RainbowKit vs ConnectKit vs Reown/Web3Modal vs hand-rolled. Trade-off:
   polish/onboarding vs brutalist control + bundle. (Brutalism may favor a themed ConnectKit or
   a thin custom connector over RainbowKit's rounded aesthetic.)
2. **Router** — TanStack Router (type-safe, heavier) vs React Router v6 (standard) vs wouter
   (minimal). Static SPA; type-safety is on-brand.
3. **Package manager / Node** — pnpm (recommended) vs npm; Node version pin.
4. **Test stack** — Vitest (unit/component) + Playwright (e2e against the fork)? Confirm.
5. **CI host** — GitHub Actions (repo deploys to GitHub Pages today). Confirm + what gates block merge.
6. **Bindings + fork bridge** — how `contracts.local.json` (fork addresses) + ABIs become a
   typed, generated config the app imports. (Generate step in dev loop vs committed artifacts.)
7. **Generated code location & boundary** — `app/src/generated/**`, lint-ignored, never edited by hand.

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
- _(empty — populate as Open decisions are locked)_

## Open questions
- See Design decisions → Open (1–7). These are the immediate "nail it down" items.
- Does the existing anvil loop already emit ABIs in a shape wagmi CLI can consume, or is a small
  adapter step needed? (Investigate during T4 planning.)
