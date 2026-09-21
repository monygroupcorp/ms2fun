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
# its own contract. Every merge to main that touched `src/factories/erc1155/` was rebuilt and sized
# on 2026-09-21; ERC1155Factory runtime margin, and where each merge spent it:
#
#     merged      PR     factory    margin    blob      logic    this merge cost
#     2026-08-04  #132   22,837B    1,739B    18,082B   4,755B   -
#     2026-08-11  #174   23,506B    1,070B    18,751B   4,755B   +669B  all instance
#     2026-08-15  #197   23,520B    1,056B    18,751B   4,769B    +14B  all factory
#     2026-08-24  #295   23,584B      992B    18,815B   4,769B    +64B  all instance
#     2026-09-05  #344   23,715B      861B    18,946B   4,769B   +131B  all instance
#     2026-09-09  #365   23,715B      861B    18,946B   4,769B      0B
#     2026-09-10  #376   23,622B      954B    18,853B   4,769B    -93B  all instance
#     2026-09-11  #383   23,532B    1,044B    18,763B   4,769B    -90B  all instance
#     2026-09-19  #441   23,952B      624B    19,183B   4,769B   +420B  all instance
#     2026-09-19  #431   24,015B      561B    19,183B   4,832B    +63B  all factory
#
# Three things in that column that a single reading of today's number does not show.
#
# NO MERGE EVER SPENT FROM BOTH SIDES. Seven moved only the blob, two moved only the factory's own
# logic, one moved neither. So every one of them was reviewed by a suite that measured the side it
# happened to touch, and passed — #441 spent 420B through the instance while the instance's own
# 7,820B of apparent room was what got checked, and #431 spent 63B of factory logic and added no
# instance bytes at all. Neither was careless. There was nothing to read.
#
# THE MARGIN IS NOT A RATCHET. #376 and #383 gave back 183B between them. A diet on the instance is
# a real alternative to the lever below, and it is cheaper than either.
#
# THE SPEND IS LUMPY, SO THE AVERAGE LIES. 1,178B went in 46 days, which averages 26B/day and would
# put the remaining 561B some three weeks out. But two merges account for 1,089B of that 1,178B, and
# the largest single one, #174's +669B, is ITSELF larger than the 561B left today. The question a
# floor answers is not how many days remain. It is whether the next ordinary edition-side change is
# allowed to be the size that ordinary edition-side changes have actually been.
#
# WHAT THIS ASSERTS, per factory:
#   1. The factory's RUNTIME bytecode is under EIP-170 (24,576B). The factory is the deployable
#      contract, so its runtime is the EIP-170 subject; a build that passes this line still deploys.
#   2. A headroom FLOOR, once one is typed below. None is typed today — see the FLOORS block.
#
# WHAT IT ASSERTS ABOUT ITSELF:
#   That the PAIRS table below is complete. Those rows are typed, and a typed table is the same
#   blindness this gate exists to catch one level up: ERC1155Factory ran six weeks with no gate and
#   UniTitheHookFactory had no size guard of ANY kind, not because either was hard to measure but
#   because nobody was looking for them. So the script reads `type(<X>).creationCode` out of `src/`
#   itself and fails on any embedding no row measures. A fourth factory that embeds an instance is
#   then a red build naming itself, rather than one more contract whose margin nobody watches.
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
# THE LEVER, when a ceiling or a floor trips: get the instance initcode out of the factory. There are
# two ways to do it and THEY ARE NOT INTERCHANGEABLE. Both free the factory; only one of them ends
# the coupling. Measured on main at 3886044c on 2026-09-21:
#
#   A. EIP-1167 CLONE off a master implementation, the way the ERC404 family already deploys. The
#      factory holds a ~45B proxy template instead of the 19,183B blob, and the instance becomes a
#      normal deployed contract standing on its own EIP-170 budget — its 16,756B runtime and 7,820B
#      of headroom stop being apparent and become real. After this there is no second contract whose
#      size tracks the instance, so this gate has nothing left to watch on the ERC1155 row.
#      What it costs: the instance's `constructor` becomes an `initialize`, and the three values that
#      differ per instance or per cohort — `genesisVault`, plus `protocolTreasury` and `weth`, which
#      `ERC1155Factory.setProtocolTreasury`/`setWeth` may retune between instances today — stop being
#      `immutable` and become storage, so `withdraw` pays three cold SLOADs it does not pay now. The
#      protocol-wide ones can stay `immutable` in the master and be read through the proxy, which is
#      what `ERC404BondingInstance._ops` already does.
#
#   B. A SEPARATE DEPLOYER the factory calls. Built as a spike and sized: the smallest deployer that
#      can hold the blob and make the CreateX call is 19,841B of runtime — 19,183B of blob and 658B
#      of its own logic — leaving it 4,735B of headroom. The factory is freed, but the deployer now
#      carries the coupling on exactly the terms the factory carried it, and with a smaller budget
#      than the instance appears to have: 4,735B of deployer margin is about 4,135B of instance
#      RUNTIME growth at the 1.145 initcode-to-runtime ratio measured here, against the 7,820B the
#      instance reads today. So B buys room and keeps the disease; A ends it.
#
# Both change deployed addresses and the deploy scripts, so neither is a diff to land under time
# pressure — which is the reason to see the margin shrink here rather than in a red build on the day
# it runs out. A diet on the instance is the third option and the only one that changes no addresses.
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

# Every `type(<X>).creationCode` written in `src/`, as `<file>|<X>`. A doc comment that merely names
# one is not an embedding and compiles no blob — HookAddressMiner's `@param` line says
# `type(UniAlignmentV4Hook).creationCode` and embeds nothing — so lines that open a comment are
# dropped before the match is taken.
embedders() {
  { grep -rEn 'type\([A-Za-z_][A-Za-z0-9_]*\)\.creationCode' src --include='*.sol' || true; } \
    | awk -F: '
        {
          body = $0
          sub(/^[^:]*:[0-9]+:/, "", body)
          stripped = body
          sub(/^[[:space:]]+/, "", stripped)
          if (stripped ~ /^(\*|\/\/|\/\*)/) next
          while (match(body, /type\([A-Za-z_][A-Za-z0-9_]*\)\.creationCode/)) {
            m = substr(body, RSTART, RLENGTH)
            gsub(/^type\(|\)\.creationCode$/, "", m)
            print $1 "|" m
            body = substr(body, RSTART + RLENGTH)
          }
        }' \
    | sort -u
}

floorsTyped=0
fail=0

# ── CENSUS ────────────────────────────────────────────────────────────────────────────────────────
# The table checks itself against the source before it measures anything.
while IFS='|' read -r srcFile embedded_name; do
  [ -n "$srcFile" ] || continue
  covered=0
  for row in "${PAIRS[@]}"; do
    IFS='|' read -r _rowLabel rowFactory rowEmbedded <<<"$row"
    if [ "${rowFactory%%:*}" = "$srcFile" ] && [ "${rowEmbedded##*:}" = "$embedded_name" ]; then
      covered=1
      break
    fi
  done
  if [ "$covered" -eq 0 ]; then
    echo "FAIL: ${srcFile} embeds type(${embedded_name}).creationCode and no row in PAIRS measures it." >&2
    echo "      Its EIP-170 margin is being spent by ${embedded_name} and nothing is watching, which" >&2
    echo "      is the state ERC1155Factory was in for six weeks. Add the row rather than the exception:" >&2
    echo "        \"<label>|${srcFile}:<factory contract>|<path>:${embedded_name}\"" >&2
    fail=1
  fi
done < <(embedders)


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
      echo "        ${bsize}B of it is embedded ${embedded##*:} initcode — see THE LEVER above, and" >&2
      echo "        note that only the clone route ends the coupling rather than relocating it." >&2
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
      echo "        Do NOT lower this floor to make a diff pass. In rising order of blast radius:" >&2
      echo "        re-spec against the remaining budget; diet the instance (#376 and #383 gave back" >&2
      echo "        183B and moved no addresses); or take the lever and move the initcode out. If you" >&2
      echo "        take the lever, read THE LEVER above first — an EIP-1167 clone ends this coupling," >&2
      echo "        a separate deployer only moves it to a contract with a smaller budget." >&2
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
