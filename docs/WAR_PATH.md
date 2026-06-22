# ms2fun — War Path

**The plan of record.** This is the path to victory: a clean, elegant, TypeScript
re-platform that ends with **a collection deployed to a pristine, beautiful frontend on
mainnet.** Canonical doc — keep it current.

Companion docs: root `CLAUDE.md` (North Star + rules), `docs/OPERATIONS.md` (how we work —
agent-driven, phase lifecycle, gates, branch strategy), `docs/ARCHITECTURE.md` (the technical
constitution — written in Phase 0). Each phase has its own living doc in `docs/phases/`.
Strategic background: `docs/plans/NEW_DIRECTION_HANDOFF.md`.

---

## Victory condition

> Launch on testnet → squash the last bugs → launch on mainnet → deploy a collection to a
> pristine and beautiful frontend, and start releasing editions freely.

Everything below serves that single end. ms2fun is the opinionated boutique launchpad that
the sister platform **NOEMA** (AI agents creating/managing collections) creates into.

---

## Non-negotiable principle: no remnants

The last app died of remnants — twins, stubs, manual-DOM hacks, half-migrations. Elegance is
not a finish applied at the end; it is a set of constraints chosen up front that make the ugly
path *structurally impossible*:

- **TypeScript, strict to the teeth** (`strict`, `noUncheckedIndexedAccess`, no `any`). The
  compiler refuses half-done work.
- **Generated contract bindings, not hand-rolled adapters** (wagmi CLI from the Foundry ABIs).
  Bindings cannot drift from contracts when they are generated from them.
- **Greenfield, quarantined.** New app imports zero lines from old `src/`. Old `src/` moves to
  `legacy/` immediately and is deleted *wholesale* at fossil-parity — never stranglered into a
  lingering half-state.
- **One slice, complete.** No feature advances on a stub. No TODO behind a rendered button, ever.
- **Written constitution.** Decisions live in `docs/ARCHITECTURE.md`, enforced by lint/CI — not
  vibes.

---

## Stack (decided)

Main app, optimized for *gorgeous + fast-to-ship*:

- **React + Vite + TypeScript (strict)**
- **wagmi + viem** (typed reads/writes/multicall/tx-state), **TanStack Query** (via wagmi)
- **RainbowKit or ConnectKit** for wallet UI, **Framer Motion** for tasteful motion
- **wagmi CLI** generating typed bindings from the Foundry ABIs
- **Styling:** CSS Modules + design tokens as CSS custom properties (port the Gallery Brutalism
  demos near-verbatim). Fast, no new paradigm, on-ethos.
- Static `dist` (no servers; onchain-only; walk-awayable from day 0).

**Why React, not Preact:** size was Preact's only win, and size is now the job of the separate
ERC-8244 micro-frontend. The main app gets the React golden path — wagmi, RainbowKit, Framer
Motion all React-first — which is the fastest route to beautiful-without-wrestling.

The **strict, type-checked token system (vanilla-extract)** is relegated to the ERC-8244
contract-frontend, where rigor pays and there is time. Two apps, two jobs, each opinionated
about its own.

---

## What is already built (we build ON this, not from scratch)

The contracts are substantially further along than the frontend. This is the biggest
de-risking fact in the whole plan.

- **Collection contracts — pretty built out.** ERC404 (DNT) collections and the broader
  instance/factory machinery exist and were exercised on testnet.
- **Modular component system — decently built out.** The composable options are real:
  - **Whitelist** + **password tiers** (tiered, password-gated access)
  - **Liquidity-pool selection** — which pool a DNT/ERC404 deploys liquidity to
  - **Vault selection** — pluggable vault binding
- **Unified message system** — `GlobalMessageRegistry`, the activity/comment feed wired
  directly into instances, **with scope abilities** (account / collection / global scopes).
  **This MUST be preserved and carried forward** — it is core, not optional.
- **The anvil mainnet-fork dev loop** — `scripts/local-chain/*` + `DeployAnvil.s.sol` + seed
  scenarios. The crown jewel. Fully portable; reused as-is.
- **EXEC404 / Cult Executives** — the one live deployment, on the legacy alignment-vault model,
  **grandfathered forever.** Our fossil and our Phase 1 proving ground.

What is *not* yet good: the testnet pass surfaced real bugs and nastiness in the contract set
(to be squashed), and the **Aave vault** is new (but likely a good off-the-shelf base — keep
it simple and defensible).

---

## The crux: information architecture & metadata

This is the heart of the application and the part that was genuinely hard last time — worth
stating plainly because everything routes through it.

Two intertwined problems:

1. **Surfacing the options.** The modular system (whitelist, password tiers, pool selection,
   vault selection, and the Aave vault) exposes a large option space. Organizing that
   information so the **launch wizard** can present it coherently — defaults, dependencies,
   progressive disclosure — is the real design work. The contracts hold the capability; the
   wizard has to make it legible.

2. **Three scopes of metadata.** Metadata exists at three levels and wrangling them is the
   crux of the app:
   - **Account metadata** — the onchain profile (one account → many collections).
   - **Collection metadata** — the collection itself (name, art, terms, modules chosen).
   - **NFT metadata** — the per-token metadata *within* a collection.

   The plan must nail: where each scope is stored (onchain vs IPFS), how it is keyed and
   versioned, who can edit it, and how the typed domain layer + wizard read/write it
   consistently. (Prior friction lives in `docs/plans/2026-03-28-metadata-uri-separation*.md`.)

**This is why Phase 2 exists and why it is a reconciliation, not a build.** The contracts can
already *do* most of this. The win is designing the **contract↔frontend API** — a typed domain
layer over the generated bindings — that expresses profiles, collections, the 3 metadata
scopes, the module options, and the message system *semantically*, so the wizard (and NOEMA)
consume one coherent model instead of raw calls. **This typed domain layer is also NOEMA's API
surface** — building it once serves both.

---

## Invariants (true in every phase)

- **EXEC404 is never broken.** Grandfathered, preserved, no matter what.
- **The unified message system + its scopes survive** into the new stack.
- **Onchain-only, static, no servers.** NOEMA reads/writes chain directly.
- **No remnants.** See the principle above. Enforced, not aspirational.

---

## The phases

Each phase has a hard exit criterion. Nothing is "sort of done." Contracts and frontend advance
together in the monorepo.

### Phase 0 — Foundation & constitution
Lock stack; write canonical `docs/ARCHITECTURE.md`; scaffold `app/` (React + Vite + TS strict,
ESLint + Prettier, CI gate); generate typed bindings from the Foundry ABIs; quarantine old
`src/` → `legacy/`; wire the anvil fork to the new app.
→ **Exit:** new app builds, connects a wallet, reads one value off a forked contract, CI green.

### Phase 1 — Prove the stack on the fossil
Build EXEC404 / Cult Execs **view + trade** end-to-end against the real deployed contract on the
fork. Beautiful, zero stubs.
→ **Exit:** buy/sell EXEC404 from the new frontend, and it looks gorgeous. (Whole pipeline —
wallet, typed reads/writes, design system — validated against real contract state, zero new
contract risk.)

### Phase 2 — Reconciliation: the API + the crux (the long pole)
Not greenfield — reconcile what exists and design the information model.
- Inventory the existing collection + modular-component contracts; confirm what works, list the
  testnet bugs.
- Drop the **Aave vault** (off-the-shelf, simple, defensible) into the existing vault-selection
  seam: 20% in → on withdrawal 20% to the creator's alignment target + 1% platform; optional
  maturity / pay-to-unlock-early.
- **Solve the crux:** the typed information architecture for the module option space, and the
  3-scope metadata model (storage, keying, versioning, permissions).
- Define the **contract↔frontend API** — the typed domain layer over the generated bindings
  (profiles, collections, metadata scopes, modules, messages). This *is* NOEMA's surface.
→ **Exit:** documented, typed domain model + API; Aave vault on the fork; existing contracts
green on the fork with seed scenarios.

### Phase 3 — MVP frontend flows
Profile page; **the launch wizard** (the centerpiece — consumes Phase 2's information model);
metadata management across the 3 scopes; collection page (view + mint/trade + vault/yield
display); the **unified message feed with scopes**. All on the fork, beautiful, zero stubs.
→ **Exit:** locally — create a profile → run the wizard → launch a collection (whitelist /
password tiers / pool / vault chosen) → mint → watch the Aave vault accrue → post & read scoped
messages. All from the new UI.

### Phase 4 — Testnet launch & bug squash
Deploy the contract set to Sepolia (plumbing exists); point the frontend at it; run the real
flows; burn down the bug list from the prior testnet pass; security review of the Aave vault and
any modified contracts (`solidity-auditor`).
→ **Exit:** full MVP flow works on public testnet; bugs squashed; review clean.

### Phase 5 — Mainnet launch
Deploy contracts to mainnet (multisig owner + treasury via the thin owner-governance wrapper);
ship the static frontend `dist`.
→ **Exit:** contracts + frontend live on mainnet.

### Phase 6 — The victory
Deploy a real collection to the pristine frontend and release editions.
→ **Exit:** the thing we set out to do.

### Runs alongside / after
- **ERC-8244 micro-frontend** — the leaner-than-lean on-chain build; home of the strict typed
  token system.
- **NOEMA API** — largely free: it is the Phase 2 typed domain layer + a thin TS SDK extracted
  from the generated bindings. Building the frontend builds NOEMA's hooks.

---

## Honest long-poles & risks

- **Phase 2 is the real risk** — but smaller than feared, because the contracts mostly exist.
  The work is reconciliation, the Aave vault, and *the information-architecture/metadata design*
  (the genuinely hard part). Plus an audit before mainnet. Weeks, not days; gates Phases 4–6.
- **Scope creep via "modular."** For MVP, ship **one** collection type with the module *seams*
  in place but a single implementation of each (one pool path, the Aave vault, whitelist +
  password tiers) — not a plugin marketplace. Modules grow after launch.
- **Metadata is where elegance is won or lost.** Get the 3-scope model right early; it is the
  spine the wizard and NOEMA both hang on.
- Phases 0–1 and 3 (frontend) are comparatively derisked once Phase 1 proves the stack.
