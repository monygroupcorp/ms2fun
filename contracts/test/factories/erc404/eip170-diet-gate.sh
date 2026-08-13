#!/usr/bin/env bash
# EIP-170 + headroom-floor + storage-layout gate for the externalization diet (noesis-091, -142, -148).
#
# Four hard assertions, all must pass:
#   1. The master ERC404BondingInstance runtime bytecode is < 24,576 (EIP-170). It is the deployable
#      implementation behind every EIP-1167 clone, so its runtime is the EIP-170 subject.
#   2. It keeps at least MIN_HEADROOM bytes of EIP-170 headroom. This is a FLOOR, not a line-ball:
#      the pattern in this contract is silent re-accumulation between audits (24,902B pre-091 ->
#      24,511B -> 21,386B after 140 -> back to 24,317B / 259B of headroom by 143). noesis-148's D3
#      move bought the instance back to 22,426B (2,150B of headroom), and rth's D-3 ruling
#      (2026-08-06) hard-codes a 2,000B floor here so the next three items cannot quietly eat it.
#      Tripping this floor is a BLOCK: re-spec against the remaining budget, or take the next diet
#      lever (D2, the 14 init/admin setters). It is NOT to be lowered to make a diff pass.
#   3. ERC404BondingOps runtime bytecode is < 24,576 (EIP-170) AND keeps at least MIN_OPS_HEADROOM
#      bytes of headroom. Ops is the delegatecall target of the externalization diet, so every byte
#      moved off the instance lands here: noesis-188 moved deployLiquidity's body out of the instance
#      (22,459B -> 21,562B) and into Ops (20,895B -> 23,779B), taking Ops from ~3.7k of room to 797B
#      in a single item while a ceiling-only check stayed green. rth's ruling (2026-08-12) sets a 500B
#      floor here: a warning shot that leaves usable Ops budget rather than a freeze, but that trips
#      before the next Ops-side item lands over EIP-170 with no prior signal. The Ops lever is the
#      opposite of the instance's — move something BACK to the instance, which has the free bytes.
#      It is NOT to be lowered to make a diff pass.
#   4. ERC404BondingInstance and ERC404BondingOps have an IDENTICAL storage layout — i.e. Ops declares
#      ZERO storage outside the shared ERC404BondingStorage base. A var added to Ops (or the instance)
#      outside the base is a storage-collision bug across the delegatecall boundary; this catches it.
#
# Run from the `contracts/` directory (or via CI alongside `forge test`):  bash test/factories/erc404/eip170-diet-gate.sh
set -euo pipefail

LIMIT=24576
MIN_HEADROOM=2000
MIN_OPS_HEADROOM=500
INST="src/factories/erc404/ERC404BondingInstance.sol:ERC404BondingInstance"
OPS="src/factories/erc404/ERC404BondingOps.sol:ERC404BondingOps"

hexbytes() { local hx; hx="$(forge inspect "$1" deployedBytecode | tr -d '\n')"; echo $(( (${#hx} - 2) / 2 )); }

isize="$(hexbytes "$INST")"
osize="$(hexbytes "$OPS")"
headroom=$(( LIMIT - isize ))
opsHeadroom=$(( LIMIT - osize ))
echo "ERC404BondingInstance runtime: ${isize}B (limit ${LIMIT}, headroom ${headroom}B, floor ${MIN_HEADROOM}B)"
echo "ERC404BondingOps          runtime: ${osize}B (limit ${LIMIT}, headroom ${opsHeadroom}B, floor ${MIN_OPS_HEADROOM}B)"

if [ "$isize" -ge "$LIMIT" ]; then
  echo "FAIL: ERC404BondingInstance ${isize}B >= EIP-170 limit ${LIMIT}B" >&2
  exit 1
fi
if [ "$headroom" -lt "$MIN_HEADROOM" ]; then
  echo "FAIL: ERC404BondingInstance headroom ${headroom}B < floor ${MIN_HEADROOM}B (noesis-148 D-3 ruling)." >&2
  echo "      Do NOT lower this floor. Re-spec against the remaining budget, or take the next diet" >&2
  echo "      lever (D2: externalize the 14 init/admin setters, measured -3,298B)." >&2
  exit 1
fi
if [ "$osize" -ge "$LIMIT" ]; then
  echo "FAIL: ERC404BondingOps ${osize}B >= EIP-170 limit ${LIMIT}B" >&2
  exit 1
fi
if [ "$opsHeadroom" -lt "$MIN_OPS_HEADROOM" ]; then
  echo "FAIL: ERC404BondingOps headroom ${opsHeadroom}B < floor ${MIN_OPS_HEADROOM}B (rth ruling 2026-08-12)." >&2
  echo "      Do NOT lower this floor. The Ops lever runs the other way: move something back to" >&2
  echo "      ERC404BondingInstance, which currently holds ${headroom}B of free budget." >&2
  exit 1
fi

# Storage-layout equality. `forge inspect ... storageLayout --json` labels each entry with the QUERIED
# contract and embeds compiler AST node-ids in type identifiers; those are not layout. We compare only
# the slot/offset/type/label structure with astId/contract dropped and the numeric AST-id suffixes stripped.
#
# `forge inspect` reads the CACHED artifact, and a plain `forge build` — or a `forge test` run after
# one — can leave that artifact without a `storageLayout` field, at which point the inspect errors.
# This used to pass VACUOUSLY: `norm` ran inside process substitution, so the error went to stderr and
# `diff` compared two EMPTY outputs, which are equal. The gate reported PASS on exactly the item class
# it exists to guard (noesis-143, which adds two state variables). Two fixes below: drop the artifact
# first so `forge inspect` regenerates just that contract (sub-second), and capture into variables so a
# failure is a hard non-zero exit instead of a silent match.
norm() {
  local artifact out
  artifact="out/$(basename "${1%%:*}")/${1##*:}.json"
  rm -f "$artifact"
  out="$(forge inspect "$1" storageLayout --json \
    | jq -S 'walk(if type == "object" then del(.astId, .contract) else . end) | {storage: [.storage[] | {label, offset, slot, type}], types}' \
    | sed -E 's/\)[0-9]+/)/g')"
  if [ -z "$out" ] || [ "$out" = "null" ]; then
    echo "FAIL: could not read a storage layout for $1 (try 'forge clean')" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

instLayout="$(norm "$INST")"
opsLayout="$(norm "$OPS")"

if [ "$instLayout" = "$opsLayout" ]; then
  echo "PASS: ERC404BondingInstance and ERC404BondingOps storage layouts are identical (Ops adds zero storage outside the shared base)."
else
  echo "FAIL: storage layouts DIFFER — Ops declared storage outside ERC404BondingStorage (collision risk):" >&2
  diff <(printf '%s\n' "$instLayout") <(printf '%s\n' "$opsLayout") >&2 || true
  exit 1
fi

echo "EIP-170 diet gate: PASS"
