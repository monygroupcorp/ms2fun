# Phase 1 — Prove the Stack on the Fossil

**Status:** Next (Phase 0 accepted 2026-06-22)
**Depends on:** Phase 0 (foundation green)

> **Phase 1, task ZERO (carried from Phase 0):** port the anvil deploy/seed dev loop from
> ethers-v5 to viem, fixing the rot found in Phase 0 (missing root `ethers`, ERC404 seed
> `createInstance(...)` ABI drift, non-deterministic addresses). This unblocks **live G8** (the
> hello-chain read off the fork) AND is the precondition for the EXEC404 trade slice below. The
> fork bridge should consume the freshly-written deploy config, not a committed snapshot.
**Exit gate owner:** Mony

> EXEC404 / Cult Execs can be viewed and traded (buy/sell) from the new frontend on the anvil
> fork — beautiful, zero stubs — proving the entire pipeline against a real deployed contract.

---

## Goal
Validate wallet → typed read → typed write → brutalist UI end-to-end against **real contract
state with zero new contract risk**, by building the first vertical on the grandfathered fossil.

## Scope
**In:**
- EXEC404 collection page: live state (price, supply, reserve, user balance) via generated bindings.
- Trade: **buy and sell** EXEC404 on the bonding curve, with real tx state (pending/success/error).
- Port the Gallery Brutalism design for this surface from `docs/examples/` (CSS Modules + tokens).
- The first real use of the typed domain-layer pattern (even if thin here).

**Out (deferred):**
- New contracts, the Aave vault, the wizard, profiles → Phase 2/3.
- The unified message feed UI → Phase 3 (but don't preclude it).
- Generalized collection page → Phase 3; this one may be EXEC404-specific.

## Design decisions
**Locked:**
- First slice = EXEC404 view + trade. *(WAR_PATH — proves stack on the fossil.)*

**Open:**
1. How much of the design domain layer to build now vs Phase 2 (avoid over-abstracting from one example).
2. Tx UX pattern (optimistic vs confirmed; toast vs inline) — set the convention here, reused everywhere.
3. Read strategy: multicall batching + TanStack Query cache keys convention.

## Task units
- [ ] T1 — EXEC404 read model (typed) + collection page render. *(parallel-safe after bindings)*
- [ ] T2 — Buy flow (approve if needed → buy → tx state). 
- [ ] T3 — Sell flow.
- [ ] T4 — Port brutalist styles for the page from the demo.
- [ ] T5 — Establish tx-state + query-cache conventions (doc them in ARCHITECTURE).

## Exit criteria
1. On the fork, buy and sell EXEC404 from the new UI; balances/price update correctly.
2. The page visually matches the brutalist intent (side-by-side with the demo).
3. Zero stubs on the path; Definition of Done gates green.

## Verification
- `/run` or recording of a buy + sell round-trip on the fork.
- Side-by-side screenshot vs demo.

## Decision log
- _(empty)_

## Open questions
- Is EXEC404 pre- or post-graduation on the fork seed, and does that change which calls the page makes?
