#!/usr/bin/env bash
# The real-v4 gate: the one place the set of real-PoolManager proofs is written down.
#
# These proofs drive v4-core's real `PoolManager`, whose pragma is exactly 0.8.26, so they
# cannot compile under the default profile's 0.8.28 deploy pin. Every one of them is in
# `foundry.toml`'s `skip=` list and runs under `foundry.v4.toml` or it does not run at all —
# there is no other job, no other profile, and no fallback. A file left out of the set below
# is therefore a proof that nothing ever executes again.
#
# That is not hypothetical. The audit proof for the hook's unbound pool key sat green and
# unrun from the day it was written, because the one invocation that reached these files
# named a single path and nobody noticed the other two were not in it.
#
# TWO MECHANISMS MAKE THAT SILENT, and the assertions below exist for them:
#
#   1. `forge test --match-path <path-that-matches-nothing>` exits 0. It prints "No tests
#      match the provided pattern" and succeeds. So a typo in a path, or a test file renamed
#      without its caller updated, reds nothing — it just stops running. COVER 2 asks forge
#      which files the path actually reaches and refuses unless the answer is exactly the set.
#
#   2. Adding a file to `skip=` removes it from the default compile set, which is a complete
#      and self-consistent act; nothing anywhere asks whether it was added to a path that
#      runs it. COVER 1 makes that question mandatory: every skipped file must be named here,
#      either in RUN or in the OUT table with the reason it is deliberately not run.
#
# This is the same shape as scripts/test-shards-cover.sh, for the same reason: a test file
# that no invocation reaches is worse than a red one, because the board stays green.
#
# Run it before pushing; the `real-settlement` job of .github/workflows/contracts-ci.yml
# runs this same script and nothing else. That is the point of it being a script: when the
# set lived inline in each caller, the two drifted, one running a single file where the
# other ran three, and the difference was invisible from either side.
#
# Usage, from contracts/:
#   ./scripts/real-v4-gate.sh              # assert, then run the proofs
#   ./scripts/real-v4-gate.sh --cover-only # assert and stop, without running them
# --cover-only still compiles: COVER 2 asks forge to resolve the path, which is the same
# compile the run would do. Any other argument is passed through to `forge test`.

set -euo pipefail

cd "$(dirname "$0")/.."

cover_only=
args=()
for a in "$@"; do
    case "$a" in
        --cover-only) cover_only=1 ;;
        *) args+=("$a") ;;
    esac
done

# The proofs this gate runs. Adding a file to foundry.toml's `skip=` means adding it here.
RUN=(
    test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol
    test/audit/HookSecondPoolNotBound.t.sol
    test/audit/HookQueuedFeesMigratedVault.t.sol
    test/audit/UniVaultPoolKeyRotation.t.sol
)

# Skipped AND deliberately not run, each with the reason it is out. A file belongs here only
# while the reason holds; when it stops holding, the file moves up into RUN.
OUT_FILES=(
    test/audit/FreeMintCurveSolvency.t.sol
)
OUT_WHY=(
    "RED BY RULING. H-1 is as designed (2026-09-17), so this proof asserts a solvency property the protocol does not offer and stays red for as long as that ruling stands. Kept as the record of what the mechanism costs: see audits/2026-09-17-pre-testnet.md sections 2 and 4."
)

fail() {
    printf 'real-v4 gate: %s\n' "$1" >&2
    shift
    printf '  %s\n' "$@" >&2
    exit 1
}

# ---- COVER 1: the skip list and this script name the same files ---------------------------
# `forge config` reads foundry.toml directly and compiles nothing.
if ! config_json=$(forge config --json); then
    fail "could not read foundry.toml (forge config failed; its error is above)."
fi
mapfile -t skipped < <(jq -r '.skip[]' <<<"$config_json" | sort)
mapfile -t named < <(printf '%s\n' "${RUN[@]}" "${OUT_FILES[@]}" | sort)

unnamed=$(comm -23 <(printf '%s\n' "${skipped[@]}") <(printf '%s\n' "${named[@]}"))
if [ -n "$unnamed" ]; then
    fail "skipped by foundry.toml and named by nothing — it compiles in no profile and runs in no job:" \
        $unnamed \
        "" \
        "Add it to RUN in this script, or to OUT_FILES with the reason it stays out."
fi

stale=$(comm -13 <(printf '%s\n' "${skipped[@]}") <(printf '%s\n' "${named[@]}"))
if [ -n "$stale" ]; then
    fail "named here but no longer in foundry.toml's skip= list:" \
        $stale \
        "" \
        "It now compiles in the default profile and runs in the sharded suite. Drop it from this script."
fi

for i in "${!OUT_FILES[@]}"; do
    printf 'not run, on purpose: %s\n  %s\n' "${OUT_FILES[$i]}" "${OUT_WHY[$i]}"
done

# ---- COVER 2: the path forge is about to be given reaches exactly RUN ----------------------
# A --match-path that matches nothing exits 0, so this is asked before the run, not after it.
match=$(printf '%s,' "${RUN[@]}")
match="{${match%,}}"

# Asked of forge rather than of the filesystem, so it is the same globbing the run will do.
# This is also the compile: a failure here is a compiler error, and it must read as one rather
# than as an empty file list, so its status is checked instead of being swallowed by the pipe.
if ! listing=$(FOUNDRY_CONFIG=foundry.v4.toml forge test --list --json --match-path "$match"); then
    fail "the real-v4 proofs did not compile under foundry.v4.toml (the error is above)."
fi
mapfile -t reached < <(jq -r 'keys[]' <<<"$listing" | sort)
mapfile -t wanted < <(printf '%s\n' "${RUN[@]}" | sort)

if [ "$(printf '%s\n' "${reached[@]}")" != "$(printf '%s\n' "${wanted[@]}")" ]; then
    fail "the match path does not reach the set this gate is meant to run." \
        "wanted:  ${wanted[*]}" \
        "reached: ${reached[*]:-<nothing>}" \
        "" \
        "A path that reaches nothing still exits 0, which is why this is checked here."
fi

echo "real-v4 gate: ${#RUN[@]} proof file(s), each in foundry.toml's skip= list and reached by this path"

if [ -n "$cover_only" ]; then
    exit 0
fi

# ---- The run -------------------------------------------------------------------------------
exec env FOUNDRY_CONFIG=foundry.v4.toml forge test --match-path "$match" ${args[@]+"${args[@]}"}
