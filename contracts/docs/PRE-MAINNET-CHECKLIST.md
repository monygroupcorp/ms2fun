# Pre-mainnet checklist

**Read this before any mainnet deploy — every entry below, in full, before the first transaction is
signed.** This document exists so that these four things are *read*, not rediscovered. Each was
deliberately accepted for testnet by a dated ruling, and each has a condition that discharges it. An
entry is live until its discharge condition is met and the entry is struck with the date and the
evidence; anything else on this page is still open, whatever anyone remembers.

Four entries, one trigger. This is not a general deferral register — a register nobody reads is the
exact failure this page exists to prevent. Do not add an entry here unless a mainnet deploy is the
thing that makes it matter.

Filed 2026-09-10 (noesis-451).

---

## 1. There is no publish pipeline that has ever published

**Finding.** noesis has no working deploy path. `.github/workflows/deploy.yml` is
`workflow_dispatch`-only and has never once succeeded: it still builds the retired root stack (root
`index.html` → `/src/index.js`), and root `src/` no longer exists, so every run fails at
`Failed to resolve /src/index.js`. The frontend that should actually ship is `app/`, which `app-ci`
typechecks, tests and builds on every commit but never publishes.

**Location.** `.github/workflows/deploy.yml` (header comment and `on:` block).

**Why accepted for testnet.** Ruled 2026-09-02 (rth): a publish pipeline does not block the testnet
deploy and comes after it. Rewriting the workflow to publish `app/dist` was deliberately excluded at
the time, because `ms2.fun` still serves the old pre-quarantine artifact wired to the old contracts,
and swapping what the brand domain serves is itself gated on the testnet deploy landing.

**Discharges when.** A pipeline has actually published, at least once, *observed* — not a workflow
that looks correct, a run that succeeded. Owned by **noesis-449**, which is itself blocked on the
Sepolia testnet deploy landing.

**One thing noesis-449 must also carry, recorded here because it is uncovered today and would
otherwise sit unowned for a stage:** the app's emission guards run on the default build target only.
`pnpm build` runs `app/scripts/check-precache.ts` and `app/scripts/check-share-card.ts`;
`pnpm build:ipfs` runs `app/scripts/ipfs-dist/smoke.ts` and `app/scripts/ipfs-dist/pack.ts` instead.
So `dist/ipfs/` carries no card assertion and no precache assertion. That is correct today — the
hash target ships no service worker, and its share cards are inert behind a fragment no crawler
reads — and it breaks silently the moment either target changes. noesis-449 owns the fix, because
the pipeline that would publish that target is what makes the gap load-bearing.

---

## 2. The deep invariant profile is not run by anything

**Finding.** `[profile.deep.invariant] runs = 10000` is selected by no workflow. It is a hand-run
profile: 10,000 invariant runs per suite across the invariant suites.

**Location.** `contracts/foundry.toml`, the profile comment and the `[profile.deep.*]` tables.

**Why accepted for testnet.** The accept is a cost fact, not negligence. Measured 2026-08-12 on the
pinned forge 1.5.1-stable, 32 cores: the whole-tree run passed 61 minutes **without finishing** — six
invariant suites completed, together roughly 7.9 CPU-hours, with the heaviest still running. A job
that long cannot sit on a per-push gate, and it is not viable at all on a 4-core hosted runner. The
default-profile whole-tree run is about 2 minutes on the same host for comparison. The right shape is
a scheduled nightly or weekly run, which is new CI infrastructure and was not built.

**Status at filing (2026-09-10).** A full run is queued out-of-band. One suite has passed clean at
10,000 runs / 5M calls / zero reverts. **That is one suite, and this document quotes no pass/fail
number for the profile as a whole, because none has been observed.** Nobody else should either.

**First complete run, 2026-09-23 — SUPERSEDED. It did not measure the tree we ship.** It was taken
before the Cypher vault was wound down, and the wind-down deleted `CypherVaultInvariant.t.sol`
outright along with the five properties in it. Kept as history, because it is where the two backend
observations below were first seen and because the heaviest suite's cost is what sizes the CI
timeout. **Do not quote it as the state of the code.**

> **54 invariant properties across 10 suites. 54 passed, 0 failed, 0 skipped.** Each property at
> 10,000 runs × 500 depth = 5,000,000 calls; 270,000,000 calls in total. 12.96 CPU-hours, summed
> per-suite wall time 8,030s, clock 1h26m. The heaviest suite, `BondingCurveInvariant` — the one
> the 2026-08-12 attempt never reached the end of — finished in 2,655.82s wall / 7.37 CPU-hours
> with 11 invariants and 0 reverts.

**Re-measured 2026-09-23 on the wound-down tree, and it is NOT green.** Same toolchain — forge
1.5.1-stable, 32-core host, `FOUNDRY_THREADS` capped at 12 across two queues of six because the
machine was shared. All nine suites ran to completion; one property failed. **This, not the block
above, is the number for the code as it stands:**

> **49 invariant properties across 9 suites. 48 passed, 1 FAILED, 0 skipped.** Each passing
> property at 10,000 runs × 500 depth = 5,000,000 calls; 240,021,000 calls in total. 14.5
> CPU-hours, summed per-suite wall time 8,263s, clock 1h12m.
>
> | suite | result | wall | CPU |
> | --- | --- | --- | --- |
> | `BondingCurveInvariant` | 12 passed | 3,119.96s | 31,327.84s |
> | `BondingCurveFreeMintInvariant` | 9 passed | 1,333.61s | 8,685.48s |
> | `UniVaultInvariant` | 5 passed | 971.02s | 3,452.36s |
> | `DeployBondDeadlineInvariant` | 9 passed | 790.33s | 2,073.52s |
> | `ERC1155EditionInvariant` | 2 passed | 539.66s | 945.29s |
> | `ZAMMVaultInvariant` | 5 passed | 515.49s | 2,210.60s |
> | `EndowmentBasisZeroInvariant` | 4 passed | 442.25s | 1,715.18s |
> | `ERC404StakingStreamAndExit` | 5 passed | 293.39s | 293.39s |
> | `EndowmentImpairmentInvariant` | 7 passed, **1 failed** | 257.73s | 1,550.88s |

The suite count fell by one because the Cypher suite was deleted with the vault, not because a
suite was dropped from a list: `scripts/deep-invariant.sh` asks forge which files declare an
`invariant_` function, and there is no written-down list to drift from. The same question also
correctly passes over `test/invariant/RevenueSplitInvariant.t.sol`, which despite its name and its
directory declares no invariant and is a unit-test file.

Reproduce it with `contracts/scripts/deep-invariant.sh`, which is also what CI runs.

**The failure.** `EndowmentImpairmentInvariant.invariant_harvestFlatSplitConserves`, at
`runs: 42, calls: 21000, reverts: 0`:

> `endowment: harvest distributed more yield than was injected:`
> `39387567573988343698 > 39387567573988343697`

One wei more paid out of a harvest than was ever injected, reached by a six-call shrunk sequence
of `deposit → accrueYield → harvest → execute → deposit → harvest`. This is a real counterexample
and not the backend flake described below: the property executed, the assertion is named, and the
sequence that reached it was printed. It is seed-dependent — a fresh campaign of that property
alone, 10,000 runs / 5,000,000 calls, came back green in 173.41s, and the per-push `ci` depth
(256 runs / 128,000 calls) passes, so the per-push gate does not reach it. **A property that fails
one campaign in several is a property that fails.** Per the closing rule of this entry it is not
carried here as a deferral; it is escalated on its own.

Two backend observations worth carrying forward, neither of them a contract defect:

- `UniVaultInvariant.invariant_noPhantomETH` reported, in the first run only, `failed to set up
  invariant testing environment: EVM error; database error: missing bytecode for code hash 0x…` at
  `runs: 0, calls: 0`, while the other four invariants in the same contract each completed
  5,000,000 calls. Re-run alone at the same depth it passed: 10,000 runs, 5,000,000 calls, 618
  reverts, 618.41s. That is the fuzzing backend racing itself, not a violation — `runs: 0` means
  the property never executed and so found nothing. It did not recur in the re-measurement, where
  the suite was 5/5 clean. `scripts/deep-invariant.sh` documents the tell, because a reader who
  mistakes it for a violation will chase a defect that is not there, and a reader who assumes
  every red is that flake will wave a real one through — the endowment failure above is exactly
  the red that must not be waved through.
- `ZAMMVaultInvariant` passes, but roughly 808,000 of each property's 5,000,000 calls revert
  (~16%), unchanged across both runs. `fail_on_revert = false`, so those calls are discarded and
  the depth they were supposed to buy is not bought. The suite is green and this is not a defect;
  it is a handler that could explore more state for the same money.

**Still open, and this is why the entry is not struck.** The scheduled job
(`.github/workflows/contracts-deep-invariant.yml`) has not yet run once on a schedule. Entry 1 of
this document sets the standard and it applies here: a workflow that looks correct is not a
workflow that ran.

**Discharges when.** The scheduled job has completed at least one run, *observed* — not merged,
run. The profile now produces a complete result on demand, which is the half of this condition
that was missing at filing; it has not yet produced a clean one, and the entry cannot be struck on
a red run.

**If a future run comes back red, it does not belong on this checklist.** An invariant violation on
money-path contracts wants its own item and an escalation, not a line in a deferral list. The
2026-09-23 endowment failure is recorded above as part of the measurement it came out of, and is
escalated on its own; it is not accepted here.

---

## 3. A-C5 — unmeasured dust in the liquidity module

**Finding.** Audit finding A-C5 (unconsumed LP side stranded in the module) is closed in substance
with a small residual. The closed half: `_sizePoolAtCurvePrice` sizes the pool from the *actual*
stopping supply, clamps ETH rather than parity, and burns the residual placeable coin outright
(`GraduationSupplyBurned`). The residual: the module still sizes the position with
`LiquidityAmounts.getLiquidityForAmounts(...)`, which takes the smaller of the two single-sided
liquidity amounts, so whichever side is over-supplied at the pool price leaves a remainder in the
singleton.

**Location.** `contracts/src/factories/erc404/LiquidityDeployerModule.sol:364` (the sizing call; the
min itself is inside the Uniswap library, not this repo). The closed half is
`contracts/src/factories/erc404/ERC404BondingOps.sol:709` (`_sizePoolAtCurvePrice`).

**Why accepted for testnet.** Triaged 2026-08-13. The magnitude is now bounded by rounding rather
than by the curve/pool price gap — but it is **unmeasured**, and the audit that filed it says in its
own text that one measurement is worth taking before mainnet, not before testnet. Accepting it for
this launch is what that finding asks for; that is why nothing was built.

**Discharges when.** The measurement has been redone against then-current code and read.

**Re-read the finding before measuring — the code under it has already moved.** As filed, A-C5
pointed at line 357 of the module; on the code current at this filing (2026-09-10) line 357 is
inside `unlockCallback` and the sizing call is at 364. The mechanism is unchanged, the line number
was not. A number taken against the old shape, or against a stale line reference, would not answer
the question that was asked.

---

## 4. The ownership handover, which is a required step and not a deferred concern

**Finding.** This is the one entry on this page that is a **required step** rather than an accepted
deferral, and it carries a live trap.

`contracts/script/MigrateOwnership.s.sol` implements the two-phase handover and is covered by
`contracts/test/script/MigrateOwnershipTest.t.sol`. Nothing in the deploy path calls it. Worse, a
deploy that skipped the handover is **indistinguishable from one that completed it**:
`contracts/script/DeployCore.sol:330` resolves `safe = cfg.safe != address(0) ? cfg.safe : address(new MockSafe())`,
and `contracts/script/DeploySepolia.s.sol:181` sets `cfg.safe = address(0)` — deploying a `MockSafe`.
There is no post-deploy assertion that the registries' owner is the Timelock rather than an EOA, so
nothing fails, nothing warns, and the deploy looks clean either way.

**Location.** `contracts/script/DeployCore.sol:330`, `contracts/script/DeploySepolia.s.sol:181`,
`contracts/script/MigrateOwnership.s.sol`. Also, by absence: at this filing no deploy runbook in
this repository calls the script — the only runbooks checked in are app-side
(`app/scripts/*/RUNBOOK.md`), so the Sepolia and mainnet handover steps have nowhere here to be
ticked yet.

**Why it is here.** Carried from the 2026-09-02 ruling on protocol ownership: rth will run a
Safe/multisig/Timelock as the protocol matures, and in the meantime the redirect capability is
removed rather than relying on wallet security. The handover is required **regardless of either of
those**, which is why it is a checklist entry and not a comment.

**Discharges when both are true.**

1. The two-phase `MigrateOwnership` handover is a **checked step** in both the Sepolia and the
   mainnet runbooks — written down and ticked, not remembered.
2. A **post-deploy assertion** exists that the registries' owner is the Timelock and not an EOA, so
   that a skipped handover fails loudly instead of resembling a completed one.

Item 2 is the live trap. It is not a future concern and it does not wait for the multisig.

---

## How to strike an entry

Do not delete it. Mark it struck in place, with the date, who read it, and the evidence that
discharged it — a run that succeeded, a measurement that was taken, an assertion that now exists. A
deleted entry is indistinguishable from an entry that was never written, which puts the next reader
back where this page started.
