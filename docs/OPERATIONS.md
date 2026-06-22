# ms2fun — Operations

**How we work.** The process constitution. `docs/WAR_PATH.md` is *what* we build and in
what order; this is *how* we execute it. Canonical, living.

---

## Operating model: spec-driven, agent-driven

The ideal: **complete the overhaul through agent-driven development, with the human out of
the way as much as possible.** That only works if the spec is good enough that agents can
execute against it without guessing. So the discipline is front-loaded into the docs.

**The docs are the spec. Agents implement the spec. The human gates design and acceptance.**

| Role | Owns |
|---|---|
| **Human (Mony)** | Vision, scope, taste, **design decisions**, and **acceptance** at phase gates. |
| **Claude (lead)** | Decomposition, implementation, verification, keeping the docs true. Drives agents. |
| **Subagents** | Parallel, well-scoped task units (implementation, search, review, verification). |

The human is in the loop at exactly two kinds of moment: **locking design decisions** (before
a phase runs) and **accepting the exit criterion** (after). Everything between is meant to run
without intervention.

---

## The phase lifecycle

Every phase is a loop with hard edges:

1. **Draft** — the phase doc exists with Goal, Scope, Design Decisions, Task Units, Exit Criteria.
2. **Lock (human gate)** — open design decisions are resolved and written into the Decision Log.
   No implementation starts while a load-bearing decision is open.
3. **Decompose** — Task Units are sized to be agent-runnable and as independent as possible.
4. **Execute** — agents implement task units (parallel + isolated where they touch shared files;
   see Worktrees). Each unit lands behind the Definition of Done.
5. **Verify** — exit criteria are checked with a *runnable proof*, not an assertion (the anvil
   fork, `/verify`, `/run`). Adversarial review before merge (`/code-review`, `solidity-auditor`).
6. **Accept (human gate)** — human signs off the exit criterion. Phase doc's status flips to Done.
7. **Next** — only then does the next phase start.

---

## Definition of Done (the no-remnant gates)

Nothing merges unless ALL hold. These are the armor against repeating the last app's death:

- ✅ **TypeScript strict, zero errors.** No `any`, no `@ts-ignore` without a written reason.
- ✅ **Lint + format clean** (ESLint + Prettier).
- ✅ **CI green.**
- ✅ **No stubs.** No TODO behind a rendered control, no `throw "not implemented"` on a live path.
  If it ships, it works. If it's not ready, it's not in the UI.
- ✅ **Contracts: tests pass.** New/changed Solidity has Foundry tests; suite green.
- ✅ **A runnable proof** exists on the anvil fork for the slice.
- ✅ **Docs updated** — the phase doc's Decision Log and the affected canonical docs reflect reality.

A slice that can't meet the gates is not "almost done" — it's not done. Cut scope instead of
lowering the bar.

---

## Branch & PR strategy

**Trunk-based, small, frequent.** Long-lived branches *are* the remnant problem at the VCS layer.

- `main` is the trunk and stays releasable.
- **`chore/repo-reset` merges to `main` first** (the cleanup is safe and additive-by-deletion).
- Per slice: a short-lived branch → PR → merge to `main` behind the Definition of Done. Prefer
  merging within a day or two over accumulating a giant branch.
- A **phase branch** (`phase-N/...`) is optional — used only when a phase must stay unintegrated
  until its exit criterion; default is to merge slices straight to `main`.
- **Conventional commits.** **No `Co-Authored-By` lines** (project rule).
- Agents doing parallel work that mutates shared files run in **git worktrees** (isolation) to
  avoid stepping on each other, then their branches merge through the same gates.

*(Recommendation to confirm: merge `chore/repo-reset` → main now, then open `phase-0/foundation`.)*

---

## Agent-driven specifics

- **Decompose to independence.** Task units that don't share files run in parallel; those that
  do are serialized or worktree-isolated.
- **Verify adversarially.** Findings (bugs, contract risks) get an independent skeptic pass
  before they're trusted. Use `/code-review` for diffs and `solidity-auditor` for contracts.
- **Prove, don't assert.** Every meaningful slice ends with the app or a test actually running
  on the fork. The `/run` and `/verify` skills exist for this.
- **The human reviews at gates, not keystrokes.** Once a phase doc is locked, batch the work to
  agents and surface a single acceptance review, not a stream of approvals.

---

## Doc system

| Doc | Role | Tracked? |
|---|---|---|
| `docs/WAR_PATH.md` | Master plan, phases, victory condition | canonical |
| `docs/OPERATIONS.md` | This — how we work | canonical |
| `docs/ARCHITECTURE.md` | Technical constitution (stack, boundaries, rules) — Phase 0 deliverable | canonical |
| `docs/phases/phase-N-*.md` | Living per-phase plan: scope, decisions, tasks, exit | canonical |
| `docs/phases/_TEMPLATE.md` | The shape every phase doc takes | canonical |
| `docs/plans/`, `docs/scratch/` | Spikes, agent outputs, working notes | gitignored scratch |

**Living-doc rule:** phase docs are updated *as decisions land* — every locked choice goes in
that phase's Decision Log; every unknown sits in Open Questions until resolved. A phase doc that
disagrees with the code is a bug in the doc.
