#!/usr/bin/env bash
# EIP-170 + storage-layout gate for the reroll externalization diet (noesis-091).
#
# Two hard assertions, both must pass:
#   1. The master ERC404BondingInstance runtime bytecode is < 24,576 (EIP-170). It is the deployable
#      implementation behind every EIP-1167 clone, so its runtime is the EIP-170 subject.
#   2. ERC404BondingInstance and ERC404BondingOps have an IDENTICAL storage layout — i.e. Ops declares
#      ZERO storage outside the shared ERC404BondingStorage base. A var added to Ops (or the instance)
#      outside the base is a storage-collision bug across the delegatecall boundary; this catches it.
#
# Run from the `contracts/` directory (or via CI alongside `forge test`):  bash test/factories/erc404/eip170-diet-gate.sh
set -euo pipefail

LIMIT=24576
INST="src/factories/erc404/ERC404BondingInstance.sol:ERC404BondingInstance"
OPS="src/factories/erc404/ERC404BondingOps.sol:ERC404BondingOps"

hexbytes() { local hx; hx="$(forge inspect "$1" deployedBytecode | tr -d '\n')"; echo $(( (${#hx} - 2) / 2 )); }

isize="$(hexbytes "$INST")"
osize="$(hexbytes "$OPS")"
echo "ERC404BondingInstance runtime: ${isize}B (limit ${LIMIT}, headroom $(( LIMIT - isize ))B)"
echo "ERC404BondingOps          runtime: ${osize}B"

if [ "$isize" -ge "$LIMIT" ]; then
  echo "FAIL: ERC404BondingInstance ${isize}B >= EIP-170 limit ${LIMIT}B" >&2
  exit 1
fi
if [ "$osize" -ge "$LIMIT" ]; then
  echo "FAIL: ERC404BondingOps ${osize}B >= EIP-170 limit ${LIMIT}B" >&2
  exit 1
fi

# Storage-layout equality. `forge inspect ... storageLayout --json` labels each entry with the QUERIED
# contract and embeds compiler AST node-ids in type identifiers; those are not layout. We compare only
# the slot/offset/type/label structure with astId/contract dropped and the numeric AST-id suffixes stripped.
norm() {
  forge inspect "$1" storageLayout --json \
    | jq -S 'walk(if type == "object" then del(.astId, .contract) else . end) | {storage: [.storage[] | {label, offset, slot, type}], types}' \
    | sed -E 's/\)[0-9]+/)/g'
}

if diff -q <(norm "$INST") <(norm "$OPS") >/dev/null; then
  echo "PASS: ERC404BondingInstance and ERC404BondingOps storage layouts are identical (Ops adds zero storage outside the shared base)."
else
  echo "FAIL: storage layouts DIFFER — Ops declared storage outside ERC404BondingStorage (collision risk):" >&2
  diff <(norm "$INST") <(norm "$OPS") >&2 || true
  exit 1
fi

echo "EIP-170 diet gate: PASS"
