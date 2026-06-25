# ADR-0005 — Module-option schema (the creation-wizard's typed param model)

**Status:** Accepted 2026-06-23 (Mony). Phase 2 / T3.
**Related:** [ADR-0004](0004-metadata-model.md) (metadata), `docs/phases/phase-2-reconciliation.md` (the crux).

## Context
The platform creates collections through three factories, each with fixed `createInstance` params,
plus optional modules (gating, liquidity deployer, staking, vault) curated in `ComponentRegistry`.
Phase 2's "crux" is an **information-architecture** problem: a single typed model the wizard (Phase 3)
and NOEMA both consume to render, validate, and progressively disclose the option space — without a
backend and without drifting from on-chain truth.

The real input surface (inventoried 2026-06-23):
- **ERC404** `createInstance(CreateParams, metadataURI, liquidityDeployer, gatingModule, freeMint)` —
  `CreateParams{ salt, name, symbol, styleUri, tokenBaseURI, owner, vault, nftCount, presetId,
  stakingModule }`; `liquidityDeployer` required (tag `liquidity`); `gatingModule` optional (tag
  `gating`); `freeMint{ allocation, scope }`. Graduation shape comes from a `LaunchManager` preset
  (NICHE/STANDARD/HYPE) — the creator picks `presetId`, not raw curve math.
- **ERC1155** `createInstance(salt, CreateParams{ name, metadataURI, creator, vault, styleUri,
  gatingModule, freeMint })`; editions added post-create (`basePrice, supply, pricingModel,
  priceIncreaseRate, openTime`). Dynamic pricing is a factory-wide singleton (not a per-instance pick).
- **ERC721 auction** `createInstance(salt, CreateParams{ name, metadataURI, creator, vault, symbol,
  lines(1-3), baseDuration, timeBuffer, bidIncrement })`; pieces queued post-create. No modules.
- Modules self-describe: factories expose `features()` / `requiredFeatures()`; `ComponentRegistry`
  exposes `getApprovedComponentsByTag(tag)`; each module's metadata JSON carries
  `{ name, subtitle, description, badge, configType }`. Tags (`keccak256` preimages): `gating`,
  `liquidity`, `dynamic_pricing`, `staking` (+ `vault` for the forthcoming Aave vault).
  Known `configType`s: `password-tier-gating`, `launch-profile`, `merkle-allowlist-gating`.

## Decision
**1. Hybrid source of truth.** The fixed factory params are hand-authored generic `FieldSchema`
descriptors (`projectTypes.ts`) — they're pinned by the ABI. The selectable modules are enumerated
**live** from `ComponentRegistry` by tag; each module's on-chain metadata names a `configType`, and
the client holds the typed config `FieldSchema`s keyed by that `configType` (`configTypes.ts`).
Approving a module on-chain extends the wizard with no app redeploy; backend-free; NOEMA-introspectable.

**2. Generic declarative `FieldSchema`.** One descriptor type (`kind` + `label` + `default` +
`validation` + `visibleWhen`) drives a single renderer and NOEMA introspection. Progressive
disclosure and validation are declarative and evaluated by one shared, pure-TS evaluator
(`isFieldVisible`, `validateField`, `validateFields` in `schema.ts`) — never bespoke per form.

**3. Model the vault slot now; provider pending.** `vault` is a first-class **required** `ModuleSlot`
(`tag: 'vault'`, `pendingProvider: true`). The schema/types are complete today; the option list fills
in when the Aave vault ships (T4). No schema rework later.

## Shape (types in `app/src/lib/wizard/schema.ts`)
- `FieldSchema` — `key` (path into the submit payload), `kind`, `label`, `help`, `default`, `options`
  (select), `item` (list), `fields` (group), `validation`, `visibleWhen`, `unit` (documents ambiguous
  on-chain units: wei/eth/gwei/bps/seconds/tokens/count).
- `ModuleSlot` — `key`, `label`, `tag`, `required`, `pendingProvider?`.
- `ConfigSchema` — `{ configType, title, fields }` (the per-module config form).
- `ProjectTypeSchema` — `{ key, title, factory, summary, coreFields, moduleSlots, postCreate? }`.
- Evaluator — `isFieldVisible`, `validateField`, `validateFields` (pure, lenient, shared).

The wizard composes: pick project type → render `coreFields` → for each `ModuleSlot`, list approved
components (live) + render the chosen module's `configType` form → validate via the evaluator →
assemble the `createInstance` args. NOEMA reads the same descriptors to reason about/drive creation.

## Boundary (generated vs hand-authored)
- **Generated** (wagmi): the ABI, types, and read/write hooks for `createInstance` + `ComponentRegistry`.
- **Hand-authored** (this layer): the *semantics* — labels, defaults, units, dependencies, configType
  forms, and the evaluator. This is the typed domain layer ADR-0004/phase-2 call the single source for
  frontend + NOEMA.

## Out of scope / deferred
- The wizard UI + submit-builder (assembling `key`-paths into ABI args) → Phase 3.
- Multiple curve computers / staking module configs → post-launch (one of each; keep the seams).
- The Aave vault option provider → T4 (the slot is modelled; the list is pending).

## Consequences
- The wizard and NOEMA share one renderable, introspectable, on-chain-anchored model.
- Adding a module = approve it on-chain (+ a `ConfigSchema` if it needs config) — no core rework.
- `unit` annotations capture the inventory's ambiguous fields (`unitPerNFT`, `bidIncrement`) so the
  submit-builder and UI agree on scaling.
