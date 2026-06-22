# Phase 2 — Reconciliation: the API + the Crux

**Status:** Not started
**Depends on:** Phase 1 (stack proven)
**Exit gate owner:** Mony

> A documented, typed domain model + API exists over the (mostly-built) contracts; the Aave
> vault is in on the fork; and the information-architecture + 3-scope metadata problem is solved
> on paper and in types.

> **This is the long pole — but it is reconciliation, not greenfield. The contracts mostly
> exist. The hard part is the information architecture and metadata, not Solidity.**

---

## Goal
Turn the existing contract capability into a coherent, typed surface the wizard and NOEMA both
consume, and add the one new economic piece (the Aave vault).

## Scope
**In:**
- **Inventory** the existing collection + modular-component contracts (ERC404/DNT, whitelist,
  password tiers, liquidity-pool selection, vault selection); record what works and the testnet
  bug list.
- **Aave vault**: integrate a simple, defensible (likely off-the-shelf) vault into the existing
  **vault-selection** seam. Economics: 20% in → on withdrawal 20% to creator's alignment target
  + 1% platform; optional maturity / pay-to-unlock-early.
- **The crux — information architecture:** a typed schema for the module option space
  (whitelist, password tiers, pool selection, vault selection, Aave params) that the wizard can
  render — defaults, dependencies, progressive disclosure.
- **The crux — metadata:** the 3-scope model (account / collection / per-NFT) — where each is
  stored (onchain vs IPFS), keying, versioning, edit permissions. (Build on
  `docs/plans/2026-03-28-metadata-uri-separation*.md`.)
- **The typed domain layer / API** over the generated bindings: profiles, collections, metadata
  scopes, modules, and the **unified message system + scopes**. *This is also NOEMA's API surface.*

**Out (deferred):**
- The wizard UI and frontend flows → Phase 3 (this phase produces the model they consume).
- Multiple implementations per module → post-launch (MVP ships one of each; keep the seams).

## Design decisions
**Locked:**
- Contracts are built-out; Phase 2 reconciles + adds Aave, it does not rebuild. *(WAR_PATH)*
- The typed domain layer is the single source for both frontend and NOEMA. *(WAR_PATH)*
- Preserve the unified message system + scopes. *(INVARIANT)*

**Open (the real design work):**
1. **Metadata storage per scope** — onchain vs IPFS for account/collection/NFT; mutable vs frozen; who edits.
2. **Metadata keying/versioning** — how a URI/pointer is structured so 3 scopes stay coherent and updatable.
3. **Module option schema shape** — how factory params are described so the wizard renders them generically.
4. **Off-the-shelf Aave vault choice** — which base; how the 20/20/1 + maturity wraps it.
5. **Domain-layer boundary** — what's generated (bindings) vs hand-authored (semantics); how NOEMA consumes it.
6. **Which testnet bugs are blockers** vs deferrable.

## Task units
- [ ] T1 — Contract inventory + bug list (read-only survey of the existing set).
- [ ] T2 — Metadata model design (3 scopes) → written spec + types.
- [ ] T3 — Module option schema design → written spec + types.
- [ ] T4 — Aave vault: select base, implement 20/20/1 + maturity, Foundry tests.
- [ ] T5 — Typed domain layer over bindings (profiles/collections/metadata/modules/messages).
- [ ] T6 — Deploy the reconciled set + Aave vault to the fork via the existing pipeline + seeds.

## Exit criteria
1. A written, typed **domain model + API** covering profiles, collections, the 3 metadata scopes,
   modules, and the message system — accepted by the human.
2. Aave vault deployed on the fork with passing Foundry tests for the 20/20/1 (+maturity) logic.
3. Existing contracts green on the fork with seed scenarios; bug list triaged (blockers vs deferred).

## Verification
- Doc review of the domain/metadata/module specs.
- `forge test` green for the vault; fork deploy + seed run.

## Decision log
- _(empty)_

## Open questions
- Does "alignment target" as a tithe destination need its own onchain registry, or is it a free-form address per collection?
- Can the existing factory express the Aave vault purely through vault-selection, or does the seam need widening?
