# Phase 5 — Mainnet Launch

**Status:** Not started
**Depends on:** Phase 4 (testnet green, review clean)
**Exit gate owner:** Mony

> Contracts are live on mainnet under the multisig owner + treasury; the static frontend `dist`
> is deployed and serving.

---

## Goal
Ship. Contracts to mainnet, frontend to its static host, with the ownership/treasury wiring that
makes the protocol operable and safe.

## Scope
**In:**
- Mainnet deployment of the reconciled contract set + Aave vault.
- Ownership via the **thin owner-operated governance wrapper**; **multisig treasury** wired.
- Build + deploy the static frontend `dist` (GitHub Pages routing support exists today).
- Production config: mainnet RPC, addresses, IPFS pinning.
- EXEC404 remains untouched and reachable. *(INVARIANT)*

**Out (deferred):**
- Deploying the first *new* collection → Phase 6.
- ERC-8244 micro-frontend → separate track.

## Design decisions
**Locked:**
- Multisig treasury; thin owner-governance wrapper as the protocol's decision interface. *(WAR_PATH)*

**Open:**
1. Multisig signer set + threshold.
2. Static host (GitHub Pages vs alternative) + domain/DNS.
3. RPC provider + fallback; IPFS pinning service.
4. Launch-day runbook + rollback/pause posture.

## Task units
- [ ] T1 — Mainnet deploy scripts + dry run; ownership/treasury wiring.
- [ ] T2 — Production frontend build + static deploy + domain.
- [ ] T3 — Production config (RPC, addresses, IPFS).
- [ ] T4 — Launch runbook (deploy order, verification, pause levers).

## Exit criteria
1. Contracts verified live on mainnet, owned by the multisig via the wrapper.
2. Frontend live at its production URL, talking to mainnet.
3. EXEC404 still reachable and unbroken.

## Verification
- Mainnet explorer verification of contracts + ownership.
- Production frontend smoke (read-only flows) against mainnet.

## Decision log
- _(empty)_

## Open questions
- Any announcement/coordination gating the public URL going live?
