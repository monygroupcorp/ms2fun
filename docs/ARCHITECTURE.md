# ms2fun — Architecture (the Constitution)

**Status:** Phase 0 deliverable — pending human accept.
**Read this first.** Every agent (human or AI) touching `app/` reads this before writing code.
It is prescriptive: where things go, what may import what, and the invariants that must always
hold. If a task seems to require violating this doc, stop and escalate — do not improvise.

Companions: `WAR_PATH.md` (plan), `OPERATIONS.md` (process), `phases/phase-0-*.md` (this phase),
`decisions/0001-web3-stack.md`, `decisions/0002-router.md`.

---

## 1. Stack (locked — see ADRs)

- **React 18 + Vite + TypeScript (strict).**
- **viem + wagmi** for all chain access (injected-only, no vendor). *(ADR-0001)*
- **@tanstack/react-query** — comes with wagmi; the single read-cache layer.
- **wouter** + a validated-param helper for routing. *(ADR-0002)*
- **CSS Modules + CSS-variable design tokens** for styling.
- **@wagmi/cli** generates typed contract bindings from the Foundry ABIs.
- **pnpm**, Vitest + Playwright, GitHub Actions.

---

## 2. Repository layout (monorepo)

```
/app          NEW frontend — the only place new app code is written
/contracts    Foundry project (Solidity, tests, deploy scripts, ABIs in out/)
/legacy       OLD microact frontend — quarantined, never imported, deleted at parity
/scripts      local-chain / anvil-fork dev loop (reused as-is)
/docs         canonical docs (this file, WAR_PATH, OPERATIONS, phases/, decisions/)
```

`app/` and `contracts/` are one domain (monorepo) but distinct trees. `legacy/` is dead weight
kept only until the new app reaches fossil-parity.

## 3. `app/` internal layout

```
app/src/
  generated/   wagmi-CLI output (typed contract hooks). GENERATED ONLY — never hand-edit.
  lib/         framework-agnostic logic: wagmi config, chains, domain helpers, validators.
  components/  reusable view units (brutalist). No route/data orchestration.
  routes/      route-level views; compose components + lib; own data orchestration.
  styles/      tokens.css, reset.css, shared CSS Modules.
  main.tsx     entry: providers (Wagmi, QueryClient) + router shell.
```

## 4. Import rules (the dependency direction — enforced by lint)

- `generated/` imports **nothing** from the app (it's a leaf).
- `lib/` may import `generated/` and external deps. **Not** `components/` or `routes/`.
- `components/` may import `lib/`, `generated/`, `styles/`. **Not** `routes/`.
- `routes/` may import everything below it.
- **Nothing** anywhere imports from `legacy/`. (Invariant **G6**, lint + CI grep.)

Direction is one-way: `routes → components → lib → generated`. No upward or cyclic imports.

---

## 5. Invariants & gates (always hold; CI enforces — see `phases/phase-0-execution.md`)

G1 strict TS, 0 errors · G2 no `any`/unexplained `@ts-ignore` · G3 format clean · G4 unit tests
green · G5 build succeeds · G6 no `legacy/` imports · G7 generated code deterministic & unedited
· G8 hello-chain e2e passes on the fork.

A red gate blocks merge. A gate that can't catch its violation is a bug in the gate.

---

## 6. TypeScript conventions

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `isolatedModules`. No `any`. No non-null `!` to dodge a real check.
- Prefer `type` aliases + discriminated unions over enums. Validate external/URL/chain input at
  the boundary (e.g. `viem.isAddress`) — types are not runtime validation.
- One exported responsibility per module; colocate a `*.test.ts` beside non-trivial logic.

## 7. Chain access & data

- **All** reads/writes go through wagmi hooks built on the generated bindings. No ad-hoc `fetch`
  to RPC, no hand-rolled adapters (that was micro-web3 — gone).
- TanStack Query (via wagmi) is the only read cache. Query keys and the **tx-state convention**
  (pending/success/error UX) are defined in Phase 1 and recorded back here — until then, no
  bespoke caching or tx-state patterns.
- Reads batch via multicall where wagmi supports it. No per-render RPC storms.

## 8. Wallet rule (own the pixels, rent the plumbing, never touch the keys)

- We hand-author the brutalist connect UI on wagmi's **headless** hooks.
- wagmi owns connector logic: EIP-6963 discovery (default-on), reconnect/`rdns` persistence,
  EIP-1193 event→state, multi-tab sync. We do **not** reimplement these.
- We **never** custody keys. Users bring their own wallet via injected/EIP-6963. No embedded
  wallets / hosted enclaves. *(ADR-0001)*

## 9. Contract bindings & the fork bridge

- `wagmi.config.ts` uses the `@wagmi/cli` **foundry** plugin against `/contracts` (ABIs from
  `out/`) + the **react** plugin → typed hooks into `app/src/generated/`.
- Fork/deployment addresses flow in from `contracts.local.json`; `pnpm wagmi:generate` runs in the
  dev loop on (re)deploy so bindings never go stale. Generation is deterministic (G7).
- Bindings are the contract↔frontend seam. The richer typed **domain layer** (profiles,
  collections, the 3 metadata scopes, modules, messages) is designed in Phase 2 and lives in
  `lib/` on top of the generated hooks. *(That domain layer is also NOEMA's API surface.)*

## 10. Styling

- CSS Modules (`*.module.css`) scoped per component; shared values come only from
  `styles/tokens.css` (CSS custom properties). No utility-class soup, no inline style sprawl.
- The Gallery Brutalism demos (`docs/examples/`, `docs/DESIGN_SYSTEM_V2.md`) are the visual
  source of truth. Match structure/spacing/class-names; don't invent conventional decoration.

## 11. Naming

Follow `docs/NAMING_CONVENTIONS.md` (`*Page`/`*Route`, `*View`, `*Panel`, `*Card`, `*Form`,
`*Interface`). Files match their default export.

---

## 12. Anti-patterns (the no-remnant clause)

Banned outright — these are how the last app died:
- ❌ A stub behind a rendered control / `throw "not implemented"` on a live path.
- ❌ `any`, `@ts-ignore` without a written reason, non-null `!` to silence a real error.
- ❌ Manual DOM manipulation, `setTimeout` mount hacks, `shouldUpdate`-style re-render dodges.
- ❌ Hand-rolled RPC/ABI/connector code (use viem/wagmi/generated bindings).
- ❌ Any import from `legacy/`.
- ❌ Editing files in `generated/` by hand.

If it isn't ready, it isn't in the UI. Cut scope; never lower the bar.

---

## 13. The task-agent contract

Before a task: read this doc + the relevant `phases/` spec. During: obey the import rules and
invariants; if a decision is unspecified, **stop and escalate** rather than guess. After: the
task's acceptance command passes and the Definition of Done gates are green. Your output is code
that survives the gates — not a description of code.
