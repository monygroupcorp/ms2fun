# Phase 4 — Testnet Launch & Bug Squash

**Status:** Not started
**Depends on:** Phase 3 (full MVP flow green on the fork)
**Exit gate owner:** Mony

> The full MVP flow works on a public testnet (Sepolia); the prior testnet's bugs are squashed;
> the new/changed contracts pass a security review.

---

## Goal
Move from the controlled fork to a real public network, find what only reality surfaces, and
harden the contracts before any mainnet money is involved.

## Scope
**In:**
- Deploy the reconciled contract set + Aave vault to **Sepolia** (deployment plumbing + the
  read-only Sepolia provider support already exist).
- Point the frontend at testnet config; run the real create→mint→vault→message flows.
- Burn down the **bug list** from the earlier testnet pass + anything new.
- **Security review** of the Aave vault and any modified contracts (`solidity-auditor`),
  adversarially verified.

**Out (deferred):**
- Mainnet deploy → Phase 5.
- Non-MVP features surfaced by testing → backlog, not scope creep.

## Design decisions
**Locked:**
- Sepolia is the public testnet. *(existing support)*

**Open:**
1. Scope of the security review — full audit vs focused review of vault + changed surfaces.
2. Bug bar for "squashed" — which severities block Phase 5.
3. Testnet metadata/IPFS pinning strategy (mirror of mainnet plan).

## Task units
- [ ] T1 — Testnet deploy scripts/config + first Sepolia deployment.
- [ ] T2 — Frontend testnet config + smoke of the full flow.
- [ ] T3 — Bug triage board; squash blockers.
- [ ] T4 — Security review pass + fixes.

## Exit criteria
1. The complete MVP flow runs on Sepolia from the deployed frontend.
2. Blocker bug list is empty; deferred items are logged.
3. Security review complete; findings resolved or accepted with rationale.

## Verification
- Live Sepolia run of the happy path.
- Review report + resolution log.

## Decision log
- _(empty)_

## Open questions
- Do we want a small closed group exercising testnet before mainnet, or solo verification?
