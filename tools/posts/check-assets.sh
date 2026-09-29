#!/usr/bin/env bash
# Every asset URL the rendered queue points at actually resolves.
#
# The failure this catches is invisible by inspection: the page renders, the images have alt text,
# and the Save buttons look like buttons — they just 404. It happened on 2026-09-29, because the
# assets were committed on a branch and the page pointed at main.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAGE="${1:-$ROOT/tools/posts/out/queue.html}"

[ -f "$PAGE" ] || { echo "no rendered queue at $PAGE — run: node tools/posts/render.mjs"; exit 1; }

urls=$(grep -oE 'https://raw\.githubusercontent\.com/[^"]+' "$PAGE" | sort -u)
[ -n "$urls" ] || { echo "no asset URLs in $PAGE — nothing to check"; exit 0; }

fail=0 n=0
while IFS= read -r u; do
  n=$((n+1))
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$u" || echo 000)
  if [ "$code" = "200" ]; then
    echo "ok    ${u##*/}"
  else
    echo "FAIL  $u ($code)"
    fail=1
  fi
done <<< "$urls"

[ "$fail" -eq 0 ] || { echo "asset check: FAILED"; exit 1; }
echo "asset check: $n URL(s), all 200"
