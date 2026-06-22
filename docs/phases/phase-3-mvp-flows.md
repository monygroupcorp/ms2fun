# Phase 3 — MVP Frontend Flows

**Status:** Not started
**Depends on:** Phase 2 (typed domain model + Aave vault on fork)
**Exit gate owner:** Mony

> Locally: create a profile → run the launch wizard → launch a collection (whitelist / password
> tiers / pool / vault chosen) → mint → watch the Aave vault accrue → post & read scoped
> messages. All from the new UI, beautiful, zero stubs.

---

## Goal
Build the user-facing MVP on top of Phase 2's domain layer. The **launch wizard is the
centerpiece** — it is where the information architecture and the 3-scope metadata become a real,
legible experience.

## Scope
**In:**
- **Profile page** — onchain account, the collections it owns, account metadata editing.
- **Launch wizard** — surfaces the module option space (whitelist, password tiers, pool, vault
  incl. Aave); writes collection metadata; deploys a collection via the factory.
- **Metadata management UI** across the 3 scopes (account / collection / per-NFT).
- **Collection page** — view + mint/trade + vault/yield display.
- **Unified message feed** with scope controls (account / collection / global). *(INVARIANT)*
- Full Gallery Brutalism treatment across all of the above.

**Out (deferred):**
- Multiple module implementations → post-launch.
- ERC-8244 micro-frontend → separate track.
- Anything not on the create→mint→vault→message happy path → backlog.

## Design decisions
**Locked:**
- Wizard is the centerpiece and consumes Phase 2's option schema directly. *(WAR_PATH)*
- Message feed + scopes preserved as a first-class feature. *(INVARIANT)*

**Open:**
1. Wizard UX — single long form vs stepped flow vs progressive disclosure; save-draft behavior.
2. Per-NFT metadata authoring UX (bulk vs per-token; upload pipeline to IPFS).
3. How much of mint/trade generalizes from Phase 1's EXEC404 page vs is rebuilt generically.
4. Empty/loading/error states convention (brutalist, no decoration).

## Task units
- [ ] T1 — Profile page (read + account metadata edit).
- [ ] T2 — Launch wizard (option schema → form → metadata write → factory deploy).
- [ ] T3 — Metadata management across 3 scopes (incl. IPFS pipeline).
- [ ] T4 — Generic collection page (view + mint/trade + vault/yield).
- [ ] T5 — Unified message feed + scope controls.
- [ ] T6 — Brutalist styling pass across all flows.

## Exit criteria
1. The full local round-trip works on the fork: profile → wizard → launch → mint → vault accrues
   → scoped message posted and read. Zero stubs.
2. Every surface matches the brutalist design intent.
3. Definition of Done gates green.

## Verification
- `/run` of the complete happy path on the fork (recorded).
- Side-by-side vs demos for each surface.

## Decision log
- _(empty)_

## Open questions
- What is the minimum lovable wizard? (Resist surfacing every option; ship the legible core.)
