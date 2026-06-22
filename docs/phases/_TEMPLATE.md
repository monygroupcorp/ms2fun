# Phase N — <Name>

**Status:** Not started | Locked | In progress | Done
**Depends on:** <prior phase / preconditions>
**Exit gate owner:** Mony (human acceptance)

> One-sentence statement of what this phase makes true.

---

## Goal
What this phase exists to achieve, in plain terms. Ties back to a `WAR_PATH.md` phase.

## Scope
**In:** the specific things this phase delivers.
**Out (explicitly deferred):** things that look in-scope but aren't — with where they go instead.

## Design decisions
**Locked** — decisions made, with the one-line why. (Mirror into the Decision Log as they land.)
**Open** — decisions that MUST be resolved before/at the lock gate. Each is a real fork.

## Task units
Agent-runnable, as independent as possible. Note which can run in parallel and which touch
shared files (→ worktree-isolate or serialize).

- [ ] T1 — …
- [ ] T2 — …

## Exit criteria
The hard, checkable conditions. Each phrased as a *runnable proof*, not an assertion.

## Verification
How each exit criterion is proven (anvil fork run, test command, `/verify`, review).

## Decision log
Dated record of decisions made during the phase. Append-only.

## Open questions
Unknowns not yet decisions. Promote to Locked (Decision log) or resolve before the gate.
