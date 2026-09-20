#!/usr/bin/env bash
# EIP-170 gate for the factories that EMBED their instance's creation code.
#
# Three factories build their deploy init code as `type(<Instance>).creationCode ++ abi.encode(args)`:
#
#     ERC1155Factory.sol:149        embeds ERC1155Instance
#     ERC721AuctionFactory.sol:104  embeds ERC721AuctionInstance
#     UniTitheHookFactory.sol:103   embeds UniAlignmentV4Hook
#
# The compiler lands that creation code in the FACTORY's runtime as one contiguous constant blob, so
# a byte added to an instance is a byte off the FACTORY's EIP-170 margin and not off the instance's.
# That is the whole disease: the instance's own headroom reads large and is not a budget. ERC1155
# is the tight one, and its margin is spent from BOTH sides while each side's suite measures only
# its own contract. Measured with `forge build --sizes`, factory runtime margin:
#
#     1,044B   before PR #441    factory 23,532B = blob 18,763B + logic 4,769B
#       624B   PR #441 merged    factory 23,952B = blob 19,183B + logic 4,769B
#       561B   PR #431 merged    factory 24,015B = blob 19,183B + logic 4,832B
#
# #441 (open editions) added no factory logic at all: all 420B it cost the factory arrived through
# the instance, while the suite that passed it measured the instance's 7,820B of apparent room. #431
# (the CreateX salt-shape fix) added no instance bytes: its 63B is factory logic, and it is the first
# cost from that side. Both landed green. 63B was priced on 2026-09-20 by reverse-applying #431's
# ERC1155Factory.sol hunk and rebuilding, which returns the factory to exactly 23,952B / 624B.
#
# WHAT THIS ASSERTS, per factory:
#   1. The factory's RUNTIME bytecode is under EIP-170 (24,576B). The factory is the deployable
#      contract, so its runtime is the EIP-170 subject; a build that passes this line still deploys.
#   2. A headroom FLOOR, once one is typed below. None is typed today — see the FLOORS block.
#
# WHAT IT REPORTS AND DOES NOT ASSERT:
#   The embedded blob. The script searches the factory runtime for the instance's creation bytecode
#   as a contiguous substring and counts the occurrences, which is what makes
#
#       factory logic = runtime - (blob x occurrences)
#
#   a real number rather than a subtraction of two unrelated sizes. It is also the fact the LEVER
#   rests on: a contiguous blob can be moved out of the factory, interleaved code cannot. A factory
#   whose blob count drops to zero has TAKEN that lever and is not failing this gate — it is the
#   outcome the gate exists to make reachable.
#
# THE LEVER, when a ceiling or a floor trips: get the instance initcode out of the factory. Either an
# EIP-1167 clone off a master implementation, the way the ERC404 family already deploys, or a separate
# deployer contract the factory calls. Both change deployed addresses and the deploy scripts, so
# neither is a diff to land under time pressure — which is the reason to see the margin shrink here
# rather than in a red build on the day it runs out.
#
# Run from the `contracts/` directory:  bash test/factories/eip170-embed-gate.sh
set -euo pipefail

LIMIT=24576

# ── FLOORS ────────────────────────────────────────────────────────────────────────────────────────
# A floor is a decision about how much room to keep in reserve, and it is rth's to type, not a
# seat's to invent. The ERC404 family has two, both his: a 2,000B instance floor (2026-08-06) and a
# 500B ERC404BondingOps floor (2026-08-12), enforced in test/factories/erc404/eip170-diet-gate.sh.
#
# NO FLOOR HAS BEEN RULED FOR THE THREE FACTORIES BELOW. Leave a value empty and this gate checks the
# EIP-170 ceiling only, and says so on every run so the absence stays visible rather than reading as
# a gate that passed. To arm one, put the ruled number here and nothing else changes.
declare -A FLOOR=(
  [ERC1155Factory]=""
  [ERC721AuctionFactory]=""
  [UniTitheHookFactory]=""
)

# <label>|<factory artifact>|<embedded contract artifact>
PAIRS=(
  "ERC1155Factory|src/factories/erc1155/ERC1155Factory.sol:ERC1155Factory|src/factories/erc1155/ERC1155Instance.sol:ERC1155Instance"
  "ERC721AuctionFactory|src/factories/erc721/ERC721AuctionFactory.sol:ERC721AuctionFactory|src/factories/erc721/ERC721AuctionInstance.sol:ERC721AuctionInstance"
  "UniTitheHookFactory|src/factories/erc404/hooks/UniTitheHookFactory.sol:UniTitheHookFactory|src/factories/erc404/hooks/UniAlignmentV4Hook.sol:UniAlignmentV4Hook"
)

# `forge inspect` reads the CACHED artifact and prints `0x…`; an empty read is a missing artifact and
# must be a hard failure, never a zero size that passes every comparison below.
hex() {
  local out
  out="$(forge inspect "$1" "$2" | tr -d '\n' | sed 's/^0x//')"
  if [ -z "$out" ]; then
    echo "FAIL: could not read $2 for $1 (try 'forge build')" >&2
    return 1
  fi
  printf '%s' "$out"
}

# Non-overlapping occurrences of the needle in the haystack. Both are ~50KB hex strings; node does
# this in one pass, where a bash glob match would only answer yes/no and could not count.
occurrences() {
  node -e '
    const [h, n] = process.argv.slice(1);
    let c = 0, i = 0;
    while ((i = h.indexOf(n, i)) !== -1) { c++; i += n.length; }
    process.stdout.write(String(c));
  ' "$1" "$2"
}

floorsTyped=0
fail=0

for row in "${PAIRS[@]}"; do
  IFS='|' read -r label factory embedded <<<"$row"

  runtimeHex="$(hex "$factory" deployedBytecode)"
  initHex="$(hex "$embedded" bytecode)"

  fsize=$(((${#runtimeHex}) / 2))
  bsize=$(((${#initHex}) / 2))
  headroom=$((LIMIT - fsize))
  count="$(occurrences "$runtimeHex" "$initHex")"
  logic=$((fsize - bsize * count))

  echo "$label"
  echo "  factory runtime       ${fsize}B  (limit ${LIMIT}B, headroom ${headroom}B)"
  if [ "$count" -gt 0 ]; then
    echo "  embedded ${embedded##*:} initcode  ${bsize}B x ${count} contiguous"
    echo "  factory logic         ${logic}B  (runtime minus the blob)"
  else
    echo "  embedded ${embedded##*:} initcode  NOT PRESENT as a contiguous blob"
    echo "                        the lever has been taken here, or the embedding moved; ${fsize}B is all logic"
  fi

  if [ "$fsize" -ge "$LIMIT" ]; then
    echo "  FAIL: ${label} runtime ${fsize}B >= EIP-170 limit ${LIMIT}B — it cannot be deployed." >&2
    if [ "$count" -gt 0 ]; then
      echo "        ${bsize}B of it is embedded ${embedded##*:} initcode. Take the lever above." >&2
    fi
    fail=1
    continue
  fi

  floor="${FLOOR[$label]}"
  if [ -z "$floor" ]; then
    echo "  floor                 NONE TYPED — ceiling only, ${headroom}B is unreserved"
  else
    floorsTyped=$((floorsTyped + 1))
    echo "  floor                 ${floor}B"
    if [ "$headroom" -lt "$floor" ]; then
      echo "  FAIL: ${label} headroom ${headroom}B < floor ${floor}B." >&2
      echo "        Do NOT lower this floor to make a diff pass. Re-spec against the remaining budget," >&2
      echo "        or take the lever: move the embedded initcode out of the factory (EIP-1167 clone" >&2
      echo "        off a master implementation, or a separate deployer the factory calls)." >&2
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi

if [ "$floorsTyped" -eq 0 ]; then
  echo "EIP-170 embed gate: PASS (ceiling only — no headroom floor is ruled for any of these factories,"
  echo "                    so the next item to touch one finds the limit by a red build, not by a guard)"
else
  echo "EIP-170 embed gate: PASS"
fi
