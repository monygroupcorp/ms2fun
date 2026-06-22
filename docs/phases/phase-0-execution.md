# Phase 0 — Execution & Agent Dispatch Plan

**Companion to** `phase-0-foundation.md` (the what/why). This is the *how*: granular,
Sonnet-proof task specs, the invariants/gates that keep agents honest, and the dispatch waves.

> **Pilot disclaimer.** Phase 0 is mostly *serial bootstrap* — one coherent foundation, not a
> wide fan-out. The fan-out is a small middle wave of file-disjoint config tasks. Treat Phase 0
> as the **proving ground for the agent-driven process itself**: do the gates catch drift, do
> the specs prevent it, where do agents need a lead/human. Those answers shape every later phase.

---

## Roles & models

- **Lead (Opus)** — writes the constitution + the novel/integrative tasks, orchestrates dispatch,
  reviews at gates. *Not* fanned out.
- **Sonnet agents** — the mechanical, tightly-specced tasks. Fanned out where file-disjoint.
- **Human (Mony)** — locks the constitution (one gate) and accepts the exit criterion (one gate).

Each task below is tagged `[lead]`, `[sonnet]`, or `[human]`. A `[sonnet]` task must be
executable from its spec + acceptance command **with no judgment calls left open**. If a task
needs a judgment call, it is mis-specced — escalate to `[lead]`, don't let Sonnet guess.

---

## Invariants & gates (built FIRST, enforced throughout)

These are the tests that keep everyone honest. They exist *before* feature work so every later
task is checked against them. CI runs all of them on every push; a red gate blocks merge.

| # | Invariant | Enforced by | Command |
|---|---|---|---|
| G1 | TypeScript strict, **zero** errors | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `pnpm typecheck` |
| G2 | No `any`, no unexplained `@ts-ignore` | ESLint (`@typescript-eslint/no-explicit-any: error`, `ban-ts-comment`) | `pnpm lint` |
| G3 | Format clean | Prettier `--check` | `pnpm format:check` |
| G4 | Unit tests green | Vitest | `pnpm test` |
| G5 | Production build succeeds | Vite | `pnpm build` |
| G6 | **No `app/` → `legacy/` imports** | ESLint `no-restricted-imports` (pattern `**/legacy/**`) + CI grep | `pnpm lint` + `! grep -rEq "from ['\"].*legacy/" app/src` |
| G7 | **Generated code is deterministic & unedited** | regenerate, then `git diff --exit-code app/src/generated` | `pnpm wagmi:generate && git diff --exit-code app/src/generated` |
| G8 | **Hello-chain proof** passes on the anvil fork | Playwright e2e against `localhost:8545` | `pnpm test:e2e` |

**Invariant tasks are the first real work** (Wave 1 sets up G1–G5; Wave 2 adds G6–G7; Wave 3
adds G8). Nothing in a later wave merges until the gates from earlier waves are green.

---

## Locked tooling (no decisions left for agents)

- **pnpm**, Node pinned via `.nvmrc` + `package.json#engines`.
- Vite **react-ts** template. React 18, React-DOM.
- Runtime deps: `viem`, `wagmi`, `@tanstack/react-query`, `wouter`.
- Dev deps: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`,
  `eslint`, `@typescript-eslint/*`, `eslint-plugin-react-hooks`, `prettier`, `@wagmi/cli`.
- Scripts (exact names — gates depend on them): `dev`, `build`, `preview`, `typecheck`,
  `lint`, `format`, `format:check`, `test`, `test:e2e`, `wagmi:generate`.
- Layout: `app/src/{components,routes,lib,styles,generated}/`; `app/src/generated/**` is
  generated-only (lint-ignored, never hand-edited).

---

## Task specs

### Wave 0 — Constitution (serial, blocks everything)
**P0 `[lead]` — Write `docs/ARCHITECTURE.md`.**
- *Spec:* encode stack, the directory layout above, the module boundaries (`lib/` = framework-
  agnostic logic; `components/` = view; `generated/` = bindings; no cross-imports upward), the
  G1–G8 invariants, the tx-state/query-key conventions (placeholder, filled in Phase 1), and the
  "own pixels / rent plumbing / never keys" wallet rule (ADR-0001).
- *Acceptance:* human review + accept. This is a `[human]` gate.
- *Why lead/human:* it's the spec every Sonnet agent reads. Mis-write it and every downstream
  task inherits the error.

### Wave 1 — Bootstrap (serial, single agent — owns the shared base)
**T1 `[lead]` — Scaffold `app/`.**
- *Spec:* `pnpm create vite app --template react-ts`; install the exact dep set above; write the
  full `package.json` (all deps + **all** scripts) so no later task edits it; strict `tsconfig`
  (G1 flags); `.nvmrc`; base `vite.config.ts` + `vitest` config; one smoke unit test
  (`expect(true).toBe(true)` placeholder so G4 has something to run); `app/src/main.tsx` mounting
  an empty App.
- *Owns:* the whole initial `app/` tree + `package.json`. **Single agent — no parallelism.**
- *Acceptance:* `pnpm i && pnpm typecheck && pnpm test && pnpm build` all green.
- *Why lead:* version/ESM/tooling-interplay subtleties (Vite+Vitest+Playwright) are exactly where
  Sonnet drifts on stale assumptions. Lead does it once, cleanly.

### Wave 2 — Fan-out (parallel, file-disjoint — the actual agent fan-out)
All depend on T1; each owns distinct files; safe to run concurrently in one batch.

| Task | Agent | Owns (files) | Spec | Acceptance |
|---|---|---|---|---|
| **T2a Lint/format** | `[sonnet]` | `eslint.config.js`, `.prettierrc`, `.prettierignore` | ESLint flat config with `@typescript-eslint` strict, `react-hooks`, `no-explicit-any: error`, `ban-ts-comment`, `no-restricted-imports` for `**/legacy/**` (G2, G6) | `pnpm lint` + `pnpm format:check` green on the scaffold |
| **T2b CI** | `[sonnet]` | `.github/workflows/ci.yml` | Run `typecheck`, `lint`, `format:check`, `test`, `build`, the G6 grep, the G7 determinism check; matrix on pinned Node | workflow lints; jobs map 1:1 to G1–G7 |
| **T2c wagmi/viem config** | `[sonnet]` | `app/src/lib/wagmi.ts` | `createConfig`: chains = `[mainnet, anvilFork]` (custom chain, id from the fork, RPC `http://localhost:8545`), `transports` http, `multiInjectedProviderDiscovery: true`, `connectors: [injected()]` | `pnpm typecheck` green; unit test asserts config has both chains |
| **T2d Design tokens** | `[sonnet]` | `app/src/styles/{tokens.css,reset.css}` | Port the Gallery Brutalism tokens (colors, type scale, spacing, borders) from `docs/DESIGN_SYSTEM_V2.md` / `docs/examples/` as CSS custom properties + a minimal reset | imported in `main.tsx`; build green; visual spot-check |

**T3 `[lead]` — Bindings + fork bridge.** *(depends on T1; touches `wagmi.config.ts` +
`app/src/generated/` + dev loop — keep separate from Wave 2 to avoid config races)*
- *Spec:* `wagmi.config.ts` using the `@wagmi/cli` **foundry** plugin pointed at `contracts/`
  (ABIs from `out/`), with `deployments` wired from `contracts.local.json` (fork addresses);
  `react` plugin to emit typed hooks into `app/src/generated/`. Add `wagmi:generate` script. Make
  generation part of the dev loop (run on fork (re)deploy).
- *Acceptance:* `pnpm wagmi:generate` produces typed hooks; G7 determinism check passes; a
  generated hook for a known contract (e.g. EXEC404) type-checks.
- *Why lead:* most novel/integrative task (cli config × foundry artifacts × fork addresses);
  highest drift risk for Sonnet. Lead owns it; later phases may delegate regen once the pattern's set.

### Wave 3 — Integration (serial; depends on Wave 2 + T3)
**T4 `[lead]` — App providers + brutalist connect UI.**
- *Spec:* wrap App in `WagmiProvider` + `QueryClientProvider`; hand-author a brutalist connect
  button/account display on wagmi headless hooks (`useConnect` w/ discovered 6963 connectors,
  `useAccount`, `useDisconnect`); wouter router shell with a single route.
- *Acceptance:* typecheck/lint/build green; connect/disconnect works against a fork wallet.

**T5 `[sonnet]` — Hello-chain view + e2e (G8).**
- *Spec:* a view that, when connected, reads ONE real value off a forked contract via a generated
  hook (e.g. EXEC404 `name()`/`totalSupply`) and renders it. Playwright e2e: start the fork, load
  the app, connect a test wallet, assert the value renders.
- *Acceptance:* `pnpm test:e2e` green (G8).

### Wave 4 — Quarantine + acceptance (serial)
**T6 `[lead]` — Quarantine `legacy/`.** *(isolate; large git move)*
- *Spec:* `git mv src legacy` (old frontend tree); confirm `app/` has zero references; the build
  and all gates stay green. *(Old `legacy/` is not built or imported; deleted wholesale at parity.)*
- *Acceptance:* G6 green; `pnpm build` green; `grep -rE "from ['\"].*legacy/" app/src` empty.

**T7 `[human]` — Accept the exit criterion.** All of `phase-0-foundation.md` Exit Criteria proven.

---

## Dispatch summary

```
Wave 0:  P0 (lead) ─── human accepts ARCHITECTURE.md
Wave 1:  T1 (lead, serial scaffold + all gates G1–G5)
Wave 2:  [ T2a | T2b | T2c | T2d ] (sonnet, parallel)   +   T3 (lead, parallel-but-separate)
Wave 3:  T4 (lead) → T5 (sonnet, adds G8)
Wave 4:  T6 (lead, quarantine) → T7 (human accept)
```

Only **Wave 2's T2a–T2d** is a true parallel Sonnet fan-out (4 agents, disjoint files). Everything
else is serial or lead-owned. That's honest: Phase 0's value is a clean foundation + a working
gate harness, not throughput.

---

## How to read the pilot (evaluating the agent session)

Capture these so we tune the process before the big phases:
- **Did the gates catch what they should?** Introduce one deliberate `any` and one `legacy/`
  import in a throwaway check — G2/G6 must fail. If a gate is silent, it's not a gate.
- **Did any `[sonnet]` task need a judgment call?** If yes, the spec was under-determined — fix the
  *spec template*, not just the task.
- **Where did Sonnet drift?** (stale package APIs, config interplay, ESM.) Those categories get
  pre-empted with version pins / examples in later phase specs.
- **Conflict reality:** did the Wave 2 fan-out stay file-disjoint, or did agents collide on
  `package.json`/config? (T1 owning all of `package.json` is the mitigation — verify it held.)

---

## Decision log
- **Wave 0 done:** `ARCHITECTURE.md` accepted by human.
- **T1 done (lead):** `app/` scaffolded; G1/G4/G5 green (build 190KB/60KB gzip). Resolved versions:
  React **19**, viem 2.53, wagmi **3.6**, TS **6.0**, Vite **8**, Vitest **4**, ESLint **10**.
- **Pilot lesson #1 — latest-everything conflicts on Node 25.** Lead had to fix three things a
  Sonnet would likely have face-planted on: TS 6.0 deprecates `baseUrl` (→ dropped, `paths`
  resolve relative to tsconfig); Vite 8 needs esbuild ≥0.27 but `@wagmi/cli` pins 0.25 (→ pnpm
  `overrides: esbuild ^0.28`); pnpm 10 blocks esbuild's binary build (→ `onlyBuiltDependencies`).
  **Implication for later phases:** pin a coherent set / pre-resolve dep conflicts in the spec
  before fanning out to Sonnet; don't let agents `add` latest blindly.
- **Wave 2 done:** T2a ESLint flat config (lead — encodes G2 no-any + G6/layering import boundaries),
  T2c wagmi/viem config (lead — mainnet + anvil fork, injected-only) + test; T2b CI workflow
  (sonnet) and T2d design tokens from the demos (sonnet). All gates green. **Pilot lesson #2 —
  the Sonnet fan-out worked exactly where predicted:** both Sonnet tasks (isolated, mechanical —
  a YAML mapping to gate commands; CSS values ported from demos) landed clean, file-disjoint, no
  drift. Confirms the split: lead owns load-bearing/drift-prone config, Sonnet owns isolated
  mechanical work.
- **T3 done (lead):** `forge build` (skip test/script) → `wagmi.config.ts` (foundry plugin,
  `forge.build:false`, scoped include of the 9 live contracts) → `pnpm wagmi:generate` → 8137-line
  `app/src/generated/contracts.ts` (typed ABIs + read/write hooks). Fork bridge relocated into the
  app at `app/src/config/local-deployment.json` (+ `lib/addresses.ts`) so it survives the T6
  quarantine; addresses are deterministic across redeploys. **G7 verified** (two generations →
  identical md5). **Pilot lesson #3 — strict TS catches real binding-layer bugs:** fork chain id is
  **1337**, not anvil's 31337 (fixed `lib/wagmi.ts`); JSON-imported addresses type as `string` and
  `noUncheckedIndexedAccess` rejected a `Record` cast → forced explicit per-field `0x${string}`
  typing so no `undefined` leaks to consumers. Exactly the class of bug that ships silently without
  the gates. **CI G7 stays commented** (needs forge in CI); enforced in the dev loop for now.
  **Remaining:** Wave 3 (T4 connect UI, T5 hello-chain+e2e), Wave 4 (T6 quarantine, T7 accept).

## Open questions
- Which forked contract + value is the cheapest reliable hello-chain read? (Likely EXEC404
  `name()` or `totalSupply` — confirm it's present in the fork seed.)
- Does `@wagmi/cli` foundry plugin consume `contracts.local.json` directly, or do we map
  broadcast/deployment artifacts into its `deployments` option? (Resolve in T3.)
