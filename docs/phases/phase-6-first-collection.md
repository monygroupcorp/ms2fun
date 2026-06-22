# Phase 6 — The Victory: First Collection

**Status:** Not started
**Depends on:** Phase 5 (mainnet live)
**Exit gate owner:** Mony

> A real collection is deployed to the pristine, beautiful frontend on mainnet, and editions are
> released. The thing we set out to do.

---

## Goal
Use the platform for its purpose: launch a collection end-to-end on mainnet through the wizard,
and start releasing editions freely.

## Scope
**In:**
- Author the first collection's metadata (account / collection / per-NFT).
- Run the launch wizard on mainnet: choose whitelist / password tiers / pool / Aave vault.
- Deploy the collection; release the first edition(s).
- Confirm the full lifecycle on mainnet: mint → vault accrual → tithe split → scoped messages.

**Out (deferred):**
- Onboarding *other* creators / going to market at scale → post-victory growth.
- NOEMA-driven collection creation → NOEMA integration track (API surface already exists).

## Design decisions
**Locked:**
- The first collection is ours (the platform as creator). *(WAR_PATH / North Star)*

**Open:**
1. What the first collection actually is (art, terms, edition structure, alignment target).
2. Pool + vault parameter choices for it.
3. Public framing / release cadence of editions.

## Task units
- [ ] T1 — First collection metadata authored (3 scopes).
- [ ] T2 — Mainnet wizard run → collection deployed.
- [ ] T3 — First edition(s) released.
- [ ] T4 — Lifecycle confirmation on mainnet (mint → vault → tithe → messages).

## Exit criteria
1. A live collection on mainnet, minted from the production frontend.
2. The Aave vault accrues and the 20/20/1 tithe behaves as designed.
3. Editions are releasable freely going forward.

## Verification
- Mainnet mint of an edition from the production UI.
- Explorer confirmation of vault deposit + tithe split on a real mint.

## Decision log
- _(empty)_

## Open questions
- The first collection's concept — the one genuinely creative decision the whole path is for.
