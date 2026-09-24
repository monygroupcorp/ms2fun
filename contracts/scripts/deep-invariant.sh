#!/usr/bin/env bash
# Run the stateful invariant suites under the `deep` profile, one suite at a time.
#
# `[profile.deep.invariant] runs = 10000` in foundry.toml raises invariant depth ~39x over the
# default the per-push gate uses. That is hours of CPU, not minutes, so it is deliberately not on
# a per-push gate: `.github/workflows/contracts-deep-invariant.yml` runs it weekly and on demand,
# one hosted runner per suite, and this script is what that workflow calls. It is also what a
# developer runs locally, so there is one copy of the suite list and one copy of the command.
#
# Per suite, not whole-tree, and that is the point. A whole-tree `FOUNDRY_PROFILE=deep forge test`
# reports nothing until every suite is done, and at these depths that has historically meant it
# reports nothing at all: the 2026-08-12 whole-tree attempt on 32 cores was killed at 61 minutes
# with the heaviest suite still running, so it produced no pass/fail for any suite, including the
# six that had in fact finished. A suite that completed is a result that can be quoted; a run still
# going is not. One invocation per suite banks each result as it lands.
#
# Usage (run from contracts/):
#   ./scripts/deep-invariant.sh                 # every suite, one at a time
#   ./scripts/deep-invariant.sh <path>...       # just these suites
#   ./scripts/deep-invariant.sh --list          # print the suite paths, one per line
#   ./scripts/deep-invariant.sh --list --json   # the same set as a JSON array, for a CI matrix
#
# Env:
#   FOUNDRY_THREADS   passed through to forge. Set it when sharing the machine; forge otherwise
#                     takes every core, and these runs hold them for hours.
#
# ONE RED HERE IS NOT AN INVARIANT VIOLATION, AND TELLING THEM APART MATTERS. Observed
# 2026-09-23: UniVaultInvariant reported
#
#   [FAIL: failed to set up invariant testing environment: EVM error; database error:
#    missing bytecode for code hash 0x...] invariant_noPhantomETH() (runs: 0, calls: 0)
#
# while the other four invariants in the same contract, off the same setUp, each completed
# 10,000 runs / 5,000,000 calls. Re-run alone at the same depth it passed: 10,000 runs,
# 5,000,000 calls, 618 reverts. Nothing was wrong with the contract — the campaigns share one
# in-memory backend and raced it. The tell is `runs: 0, calls: 0`: the property never executed,
# so there is no counterexample and the fuzzer found nothing. A real violation names the
# assertion and prints the call sequence that reached it.
#
# THE OTHER SHAPE, so both are on the page. Observed 2026-09-23 on the same host, same profile:
#
#   [FAIL: endowment: harvest distributed more yield than was injected:
#    39387567573988343698 > 39387567573988343697]
#     [Sequence] (original: 19, shrunk: 6)  ... six handler calls ...
#    invariant_harvestFlatSplitConserves() (runs: 42, calls: 21000, reverts: 0)
#
# Named assertion, concrete numbers, a shrunk sequence, and a non-zero run count: the property ran
# and the fuzzer found something. That is a violation, and it stays a violation even though a fresh
# campaign of the same property alone then passed 10,000 runs / 5,000,000 calls — the seed differs
# per invocation, and a property that fails one campaign in several is a property that fails. Do not
# re-roll until it is green.
#
# There is deliberately no retry here. A retry would also paper over a real intermittent
# violation, which is the one result this whole profile exists to catch. Re-run the suite by hand,
# and if it passes alone, say that is what happened rather than calling the first run a pass.
#
# THE SUITE LIST IS NOT WRITTEN DOWN. It is asked of forge: every test file that declares at least
# one `invariant_` function. A hand-kept list drifts, and the way it drifts is silent — a new
# invariant suite that no entry reaches never runs at this depth and nothing goes red to say so.
# Asking forge also catches the suites that are not under test/invariant/: today
# test/factories/erc404/ERC404StakingStreamAndExit.t.sol declares one, and a path glob over
# test/invariant/** would miss it.
set -euo pipefail

export FOUNDRY_PROFILE=deep

suites() {
    # `forge test --list` compiles nothing new once the tree is built. --json gives
    # {file: {contract: [test names]}}; keep the files with a stateful invariant in them.
    forge test --list --json \
        | jq -r 'to_entries[] | select([.value[][]] | any(startswith("invariant_"))) | .key' \
        | sort
}

if [ "${1:-}" = "--list" ]; then
    if [ "${2:-}" = "--json" ]; then
        suites | jq -R . | jq -sc .
    else
        suites
    fi
    exit 0
fi

if [ "$#" -gt 0 ]; then
    targets=("$@")
else
    mapfile -t targets < <(suites)
fi

if [ "${#targets[@]}" -eq 0 ]; then
    echo "deep-invariant: no invariant suites found -- did the build run?" >&2
    exit 1
fi

failed=()
for suite in "${targets[@]}"; do
    name=$(basename "$suite" .t.sol)
    echo "=== $suite (FOUNDRY_PROFILE=deep, FOUNDRY_THREADS=${FOUNDRY_THREADS:-<all cores>})"
    start=$(date +%s)
    if forge test --match-path "$suite"; then
        rc=0
    else
        rc=$?
        failed+=("$suite")
    fi
    echo "=== $name rc=$rc after $(($(date +%s) - start))s"
done

if [ "${#failed[@]}" -gt 0 ]; then
    echo "deep-invariant: ${#failed[@]} suite(s) failed:" >&2
    printf '  %s\n' "${failed[@]}" >&2
    exit 1
fi
echo "deep-invariant: ${#targets[@]} suite(s) passed"
