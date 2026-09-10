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

**Discharges when.** The profile runs on a schedule and a *complete* pass/fail has been observed.

**If that run comes back red, it does not belong on this checklist.** An invariant violation on
money-path contracts wants its own item and an escalation, not a line in a deferral list.

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
