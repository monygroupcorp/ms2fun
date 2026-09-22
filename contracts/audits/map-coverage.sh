#!/usr/bin/env bash
# Every production file under contracts/src must be named, by its own identifier, somewhere in the
# pre-testnet audit report. The audit's scope sentence is prose; this is the same sentence as a
# command, so "the map covers every contract" is checkable rather than asserted.
#
# In scope: every .sol under src/ that is not an interface directory, a vendored lib, a mock or a
# test. Out of scope by directory (interfaces/, lib/, mocks/, test/) and by name (*.t.sol,
# *Mock*.sol) — the report's own scope line, verbatim.
#
# A file is "named" if any identifier it declares — contract, library, interface, abstract contract
# — appears in the report. A file declaring several is covered when ANY of them is named, because
# the map is organised by the thing that holds value, not by file.
#
# Run from contracts/:  bash audits/map-coverage.sh
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
REPORT=audits/2026-09-17-pre-testnet.md
[ -r "$REPORT" ] || { echo "no report at $REPORT"; exit 2; }

in_scope=$(find src -name '*.sol' \
  -not -path '*/interfaces/*' -not -path '*/lib/*' \
  -not -path '*/mocks/*' -not -path '*/test/*' \
  -not -name '*.t.sol' -not -name '*Mock*.sol' | sort)

total=0
missing=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  total=$((total + 1))
  names=$(grep -oE '^[[:space:]]*(abstract[[:space:]]+contract|contract|library|interface)[[:space:]]+[A-Za-z0-9_]+' "$f" \
          | awk '{print $NF}' | sort -u)
  [ -n "$names" ] || names=$(basename "$f" .sol)
  hit=
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    if grep -qF "$n" "$REPORT"; then hit=1; break; fi
  done <<< "$names"
  if [ -z "$hit" ]; then
    echo "UNMAPPED  $f  (declares: $(echo "$names" | tr '\n' ' '))"
    missing=$((missing + 1))
  fi
done <<< "$in_scope"

echo "in scope: $total file(s); unmapped: $missing"
[ "$missing" -eq 0 ]
