#!/usr/bin/env bash
# Determinism gate for EndowmentBasisZeroInvariant's coverage question.
#
# `afterInvariant` asserts that each run of the campaign REACHED the state the deposit guard exists
# for (`guardFired >= 1`). That is a coverage claim, not an invariant: without it the two-sided ghosts
# beside it are `assertFalse` on a guard that never fired, and the suite is silently vacuous. Because
# it is a claim ABOUT the campaign, a construction that only usually arrives makes the whole contracts
# gate nondeterministic — PR #443 ran the invariants shard twice at one commit, green once and red
# once — and a gate that fails at random teaches a line to re-run rather than to read.
#
# `crunchUnderTheFloor` now builds the state exactly rather than hoping the walk finds it, so this
# script is what holds that: N campaigns at PINNED seeds, all of which must be green. A pinned seed
# makes each campaign reproducible, which a default run is not — so a red here names a seed somebody
# else can run, instead of a coin flip nobody can reproduce.
#
# The seeds are the gate, not a sample: if one goes red, do NOT swap it for a greener number. The
# construction regressed, or the assertion did, and the seed is the reproduction.
#
# It also clears this suite's persisted failure first. Foundry replays a recorded failing sequence
# instead of running a fresh campaign, so a single red would otherwise pin every later run red at
# whatever depth the shrink left behind — which is how the same commit read green locally on a clean
# cache and red on a replayed one.
#
# Run from `contracts/`:  bash test/invariant/endowment-guard-coverage-seeds.sh
# SEEDS overrides the count (measured 2026-09-19: 40 seeds x 256 runs, all green).
set -euo pipefail

cd "$(dirname "$0")/../.."

SEEDS="${SEEDS:-8}"
TARGET="test/invariant/EndowmentBasisZeroInvariant.t.sol"
export FOUNDRY_THREADS="${FOUNDRY_THREADS:-6}"

fails=()
for seed in $(seq 1 "$SEEDS"); do
  rm -rf cache/invariant/failures/EndowmentBasisZeroInvariantTest
  if out="$(forge test --match-path "$TARGET" --fuzz-seed "$seed" 2>&1)" \
     && grep -q "Suite result: ok" <<<"$out"; then
    echo "seed ${seed}: ok"
  else
    fails+=("$seed")
    echo "seed ${seed}: FAILED"
    grep -E "^\[FAIL|never reached the state" <<<"$out" | head -4 >&2 || true
  fi
done

if [ "${#fails[@]}" -ne 0 ]; then
  echo "FAIL: ${#fails[@]} of ${SEEDS} pinned seeds red (${fails[*]})." >&2
  echo "      Reproduce one with: forge test --match-path $TARGET --fuzz-seed ${fails[0]}" >&2
  echo "      Do NOT change the seed list to get a green. Fix the construction in" >&2
  echo "      crunchUnderTheFloor, or the assertion in afterInvariant." >&2
  exit 1
fi
echo "OK: ${SEEDS}/${SEEDS} pinned seeds reached the guarded state in every run."
