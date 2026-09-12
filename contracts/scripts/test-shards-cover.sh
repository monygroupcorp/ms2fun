#!/usr/bin/env bash
# Every test file lands in exactly one shard of scripts/test-shards.json.
#
# contracts-ci runs `forge test` once per shard, each shard a --match-path / --no-match-path
# pair. Two ways that goes quietly wrong: a new test directory that no shard's glob reaches
# (its tests never run and the job stays green), and a glob edit that puts a file in two shards
# (its tests run twice and the wall time the sharding bought is spent again). This script asks
# forge for the file list under each shard's own filter and compares the union and the count
# with the unfiltered list, so either mistake reds the build job before any shard starts.
#
# Run from contracts/ after `forge build`; `forge test --list` compiles nothing new then.
set -euo pipefail

shards=scripts/test-shards.json
export FOUNDRY_PROFILE="${FOUNDRY_PROFILE:-ci}"

list() { forge test --list --json "$@" | jq -r 'keys[]'; }

all=$(list | sort)
total=$(printf '%s\n' "$all" | wc -l)

seen=""
sum=0
while IFS= read -r shard; do
  name=$(jq -r .name <<<"$shard")
  args=()
  m=$(jq -r '.match // empty' <<<"$shard");    [ -n "$m" ] && args+=(--match-path "$m")
  n=$(jq -r '.no_match // empty' <<<"$shard"); [ -n "$n" ] && args+=(--no-match-path "$n")
  files=$(list "${args[@]}")
  count=$(printf '%s\n' "$files" | grep -c . || true)
  echo "shard $name: $count files"
  sum=$((sum + count))
  seen+="$files"$'\n'
done < <(jq -c '.[]' "$shards")

union=$(printf '%s' "$seen" | grep . | sort -u)
missing=$(comm -23 <(printf '%s\n' "$all") <(printf '%s\n' "$union") || true)
if [ -n "$missing" ]; then
  echo "test files no shard reaches:" >&2
  printf '  %s\n' $missing >&2
  exit 1
fi
if [ "$sum" -ne "$total" ]; then
  dup=$(printf '%s' "$seen" | grep . | sort | uniq -d)
  echo "shards overlap: $sum files across shards, $total in the tree" >&2
  printf '  %s\n' $dup >&2
  exit 1
fi
echo "every one of $total test files is in exactly one shard"
