#!/usr/bin/env bash
# EIP-170 / EIP-3860 gate for the contracts that EMBED another contract's creation code.
#
# Solidity has two ways to write one contract's creation code into another, and they cost the same
# bytes. `type(<X>).creationCode` hands you the blob to pass to CREATE2; `new X(...)` compiles to the
# same blob plus the CREATE. Both land it as ONE CONTIGUOUS CONSTANT in the enclosing contract — and
# WHICH of that contract's two size budgets pays depends only on where the expression sits:
#
#   in a FUNCTION body  -> the blob is in the deployer's RUNTIME code, against EIP-170's 24,576B.
#   in the CONSTRUCTOR  -> the blob is in the deployer's CREATION code only, against EIP-3860's
#                          49,152B initcode cap. Its runtime never carries it.
#
# Eight embeddings exist in `src/` today. Four are on the EIP-170 clock:
#
#     ERC1155Factory.sol:149        type(ERC1155Instance).creationCode
#     ERC721AuctionFactory.sol:104  type(ERC721AuctionInstance).creationCode
#     UniTitheHookFactory.sol:103   type(UniAlignmentV4Hook).creationCode
#     ERC404Factory.sol:617         new DN404Mirror(address(this))        in _deployAndInitialize
#
# and four are constructor-only, so they spend initcode and not runtime: AlignmentEndowmentVault-
# Factory, ZAMMAlignmentVaultFactory and UniAlignmentVaultFactory each build their implementation in
# their constructor, and zRouter builds its SafeExecutor there.
#
# That is the whole disease: a byte added to an embedded contract is a byte off the EMBEDDER's
# margin, and the embedded contract's own headroom reads large and is not a budget. ERC1155 is the
# tight one, and its margin is spent from BOTH sides while each side's suite measures only its own
# contract. Every merge to main that touched `src/factories/erc1155/` was rebuilt and sized on
# 2026-09-21; ERC1155Factory runtime margin, and where each merge spent it:
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
# WHAT RELOCATION ACTUALLY LOOKS LIKE HERE, because this codebase has already done it once.
# `ERC404Factory._deployAndInitialize` builds the DN404 mirror with `new DN404Mirror(address(this))`
# at the call site, and the comment above that line (ERC404Factory.sol:605) gives the reason in so
# many words: the mirror's creation code "would otherwise have to live inline in the instance's
# runtime bytecode — and the instance is the contract fighting the EIP-170 limit". So 3,100B was
# moved OFF ERC404BondingInstance, which carries rth's 2,000B floor, and ONTO ERC404Factory, which
# carried no size check of any kind until this gate. That is lever B below, taken deliberately and
# for a good reason, landing in an unwatched contract. ERC404Factory has 6,532B of runtime headroom
# and 3,100B of it is the mirror. Nothing was wrong with the move; what was missing was the row.
#
# WHAT THIS ASSERTS, per row:
#   1. The embedder's RUNTIME bytecode is under EIP-170 (24,576B) — it is a deployable contract, so
#      its runtime is the EIP-170 subject whichever budget carries the blob.
#   2. The embedder's CREATION bytecode is under EIP-3860 (49,152B), the cap on the initcode of the
#      transaction that deploys it. A constructor-embedder spends this one and only this one.
#   3. The blob is where the row says it is. A row marked CREATION whose blob turns up in the RUNTIME
#      means a `new X(...)` moved out of a constructor and into a function, which silently moves that
#      contract onto the EIP-170 clock; that is a hard failure naming the row, not a quiet reclassify.
#   4. A headroom FLOOR against the row's own budget, once one is typed below. None is typed today —
#      see the FLOORS block.
#
# WHAT IT ASSERTS ABOUT ITSELF:
#   That the PAIRS table below is complete. Those rows are typed, and a typed table is the same
#   blindness this gate exists to catch one level up: ERC1155Factory ran six weeks with no gate,
#   UniTitheHookFactory had no size guard of ANY kind, and ERC404Factory was handed 3,100B off a
#   floored contract while nothing watched it — none of them because they were hard to measure, all
#   of them because nobody was looking. So the script reads BOTH embedding syntaxes out of `src/`
#   itself and fails on any embedding no row measures. `new Foo[](n)` allocates a memory array and
#   deploys nothing, so a `[` after the type name is not an embedding; that is the only exclusion.
#
# WHAT IT REPORTS AND DOES NOT ASSERT:
#   The embedded blob. The script searches the embedder's bytecode for the embedded contract's
#   creation bytecode as a contiguous substring and counts the occurrences, which is what makes
#
#       logic = code - (blob x occurrences)
#
#   a real number rather than a subtraction of two unrelated sizes. It is also the fact the LEVER
#   rests on: a contiguous blob can be moved out, interleaved code cannot. An embedder whose blob
#   count drops to zero has TAKEN that lever and is not failing this gate — it is the outcome the
#   gate exists to make reachable.
#
# THE LEVER, when a ceiling or a floor trips: get the embedded initcode out. There are two ways to do
# it and THEY ARE NOT INTERCHANGEABLE. Both free the embedder; only one of them ends the coupling.
# Measured on main at 3886044c on 2026-09-21:
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
#      instance reads today. So B buys room and keeps the disease; A ends it. The DN404 mirror move
#      described above is B at small scale, and the disease it kept is the row this gate now carries.
#
# Both change deployed addresses and the deploy scripts, so neither is a diff to land under time
# pressure — which is the reason to see the margin shrink here rather than in a red build on the day
# it runs out. A diet on the embedded contract is the third option and the only one that changes no
# addresses.
#
# Run from the `contracts/` directory:  bash test/factories/eip170-embed-gate.sh
set -euo pipefail

EIP170=24576
EIP3860=49152

# ── FLOORS ────────────────────────────────────────────────────────────────────────────────────────
# A floor is a decision about how much room to keep in reserve, and it is rth's to type, not a
# seat's to invent. The ERC404 family has two, both his: a 2,000B instance floor (2026-08-06) and a
# 500B ERC404BondingOps floor (2026-08-12), enforced in test/factories/erc404/eip170-diet-gate.sh.
#
# NO FLOOR HAS BEEN RULED FOR ANY ROW BELOW. Leave a value empty and this gate checks the ceilings
# only, and says so on every run so the absence stays visible rather than reading as a gate that
# passed. To arm one, put the ruled number here and nothing else changes. A floor is measured
# against the row's OWN budget: EIP-170 headroom for a RUNTIME row, EIP-3860 headroom for a
# CREATION row.
declare -A FLOOR=(
  [ERC1155Factory]=""
  [ERC721AuctionFactory]=""
  [UniTitheHookFactory]=""
  [ERC404Factory]=""
  [AlignmentEndowmentVaultFactory]=""
  [ZAMMAlignmentVaultFactory]=""
  [UniAlignmentVaultFactory]=""
  [zRouter]=""
)

# <label>|<budget>|<embedder artifact>|<embedded contract artifact>
#
# <budget> is RUNTIME or CREATION and says which of the embedder's two sizes carries the blob; the
# script verifies it rather than believing it. DN404Mirror is addressed by bare name because it is a
# library contract and `forge inspect` will not resolve it by path.
PAIRS=(
  "ERC1155Factory|RUNTIME|src/factories/erc1155/ERC1155Factory.sol:ERC1155Factory|src/factories/erc1155/ERC1155Instance.sol:ERC1155Instance"
  "ERC721AuctionFactory|RUNTIME|src/factories/erc721/ERC721AuctionFactory.sol:ERC721AuctionFactory|src/factories/erc721/ERC721AuctionInstance.sol:ERC721AuctionInstance"
  "UniTitheHookFactory|RUNTIME|src/factories/erc404/hooks/UniTitheHookFactory.sol:UniTitheHookFactory|src/factories/erc404/hooks/UniAlignmentV4Hook.sol:UniAlignmentV4Hook"
  "ERC404Factory|RUNTIME|src/factories/erc404/ERC404Factory.sol:ERC404Factory|DN404Mirror"
  "AlignmentEndowmentVaultFactory|CREATION|src/vaults/aave/AlignmentEndowmentVaultFactory.sol:AlignmentEndowmentVaultFactory|src/vaults/aave/AlignmentEndowmentVault.sol:AlignmentEndowmentVault"
  "ZAMMAlignmentVaultFactory|CREATION|src/vaults/zamm/ZAMMAlignmentVaultFactory.sol:ZAMMAlignmentVaultFactory|src/vaults/zamm/ZAMMAlignmentVault.sol:ZAMMAlignmentVault"
  "UniAlignmentVaultFactory|CREATION|src/vaults/uni/UniAlignmentVaultFactory.sol:UniAlignmentVaultFactory|src/vaults/uni/UniAlignmentVault.sol:UniAlignmentVault"
  "zRouter|CREATION|src/peripherals/zRouter.sol:zRouter|src/peripherals/zRouter.sol:SafeExecutor"
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

# Every embedding written in `src/`, as `<file>|<X>`, in both syntaxes. A doc comment that merely
# names one is not an embedding and compiles no blob — HookAddressMiner's `@param` line says
# `type(UniAlignmentV4Hook).creationCode` and embeds nothing — so lines that open a comment are
# dropped and trailing `//` text is cut before the matches are taken. `new Foo[](n)` and
# `new Ns.Foo[](n)` allocate memory arrays, so a `[` after the (dotted) type name is not a match.
embedders() {
  { grep -rEn 'type\([A-Za-z_][A-Za-z0-9_]*\)\.creationCode|(^|[^A-Za-z0-9_.])new[[:space:]]+[A-Z][A-Za-z0-9_]*' src --include='*.sol' || true; } \
    | awk -F: '
        {
          body = $0
          sub(/^[^:]*:[0-9]+:/, "", body)
          stripped = body
          sub(/^[[:space:]]+/, "", stripped)
          if (stripped ~ /^(\*|\/\/|\/\*)/) next
          sub(/\/\/.*$/, "", body)

          rest = body
          while (match(rest, /type\([A-Za-z_][A-Za-z0-9_]*\)\.creationCode/)) {
            m = substr(rest, RSTART, RLENGTH)
            gsub(/^type\(|\)\.creationCode$/, "", m)
            print $1 "|" m
            rest = substr(rest, RSTART + RLENGTH)
          }

          rest = body
          while (match(rest, /(^|[^A-Za-z0-9_.])new[[:space:]]+[A-Z][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)*/)) {
            m = substr(rest, RSTART, RLENGTH)
            rest = substr(rest, RSTART + RLENGTH)
            sub(/^[^A-Za-z0-9_]*new[[:space:]]+/, "", m)
            if (rest ~ /^\[/) continue
            print $1 "|" m
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
    IFS='|' read -r _rowLabel _rowBudget rowEmbedder rowEmbedded <<<"$row"
    if [ "${rowEmbedder%%:*}" = "$srcFile" ] && [ "${rowEmbedded##*:}" = "$embedded_name" ]; then
      covered=1
      break
    fi
  done
  if [ "$covered" -eq 0 ]; then
    echo "FAIL: ${srcFile} embeds the creation code of ${embedded_name} and no row in PAIRS measures it." >&2
    echo "      Its size budget is being spent by ${embedded_name} and nothing is watching, which is" >&2
    echo "      the state ERC1155Factory was in for six weeks and ERC404Factory was in from the day" >&2
    echo "      3,100B of DN404Mirror was moved onto it. Add the row rather than the exception:" >&2
    echo "        \"<label>|RUNTIME|${srcFile}:<embedder contract>|<path>:${embedded_name}\"" >&2
    echo "      Use CREATION instead of RUNTIME if the embedding is in the constructor; the script" >&2
    echo "      checks which one is true, so a wrong guess here is a named failure and not a silence." >&2
    fail=1
  fi
done < <(embedders)

for row in "${PAIRS[@]}"; do
  IFS='|' read -r label budget embedder embedded <<<"$row"

  runtimeHex="$(hex "$embedder" deployedBytecode)"
  creationHex="$(hex "$embedder" bytecode)"
  initHex="$(hex "$embedded" bytecode)"

  rsize=$(((${#runtimeHex}) / 2))
  csize=$(((${#creationHex}) / 2))
  bsize=$(((${#initHex}) / 2))
  rRoom=$((EIP170 - rsize))
  cRoom=$((EIP3860 - csize))
  inRuntime="$(occurrences "$runtimeHex" "$initHex")"
  inCreation="$(occurrences "$creationHex" "$initHex")"

  echo "$label  [$budget]"
  echo "  runtime               ${rsize}B  (EIP-170  limit ${EIP170}B, headroom ${rRoom}B)"
  echo "  creation              ${csize}B  (EIP-3860 limit ${EIP3860}B, headroom ${cRoom}B)"

  if [ "$budget" = "RUNTIME" ]; then
    room=$rRoom
    count=$inRuntime
    logic=$((rsize - bsize * count))
    if [ "$count" -gt 0 ]; then
      echo "  embedded ${embedded##*:} initcode  ${bsize}B x ${count} contiguous in the runtime"
      echo "  embedder logic        ${logic}B  (runtime minus the blob)"
    else
      echo "  embedded ${embedded##*:} initcode  NOT PRESENT in the runtime"
      echo "                        the lever has been taken here, or the embedding moved; ${rsize}B is all logic"
    fi
  else
    room=$cRoom
    count=$inCreation
    logic=$((csize - bsize * count))
    if [ "$inRuntime" -gt 0 ]; then
      echo "  FAIL: ${label} is marked CREATION but ${embedded##*:}'s initcode is in its RUNTIME" >&2
      echo "        (${bsize}B x ${inRuntime}). A \`new ${embedded##*:}(...)\` left the constructor for a" >&2
      echo "        function body, which puts ${label} on the EIP-170 clock with ${rRoom}B of room." >&2
      echo "        Change this row to RUNTIME so the ceiling and any floor are measured there." >&2
      fail=1
    elif [ "$count" -gt 0 ]; then
      echo "  embedded ${embedded##*:} initcode  ${bsize}B x ${count} contiguous in the creation code only"
      echo "  deploy-time logic     ${logic}B  (creation minus the blob)"
    else
      echo "  embedded ${embedded##*:} initcode  NOT PRESENT in either"
      echo "                        the lever has been taken here, or the embedding moved"
    fi
  fi

  if [ "$rsize" -ge "$EIP170" ]; then
    echo "  FAIL: ${label} runtime ${rsize}B >= EIP-170 limit ${EIP170}B — it cannot be deployed." >&2
    if [ "$inRuntime" -gt 0 ]; then
      echo "        ${bsize}B of it is embedded ${embedded##*:} initcode — see THE LEVER above, and" >&2
      echo "        note that only the clone route ends the coupling rather than relocating it." >&2
    fi
    fail=1
    continue
  fi

  if [ "$csize" -ge "$EIP3860" ]; then
    echo "  FAIL: ${label} creation code ${csize}B >= EIP-3860 limit ${EIP3860}B — the transaction" >&2
    echo "        that deploys it is rejected before it runs." >&2
    fail=1
    continue
  fi

  floor="${FLOOR[$label]}"
  if [ -z "$floor" ]; then
    echo "  floor                 NONE TYPED — ceiling only, ${room}B is unreserved"
  else
    floorsTyped=$((floorsTyped + 1))
    echo "  floor                 ${floor}B  (against the ${budget} budget)"
    if [ "$room" -lt "$floor" ]; then
      echo "  FAIL: ${label} ${budget} headroom ${room}B < floor ${floor}B." >&2
      echo "        Do NOT lower this floor to make a diff pass. In rising order of blast radius:" >&2
      echo "        re-spec against the remaining budget; diet the embedded contract (#376 and #383" >&2
      echo "        gave back 183B and moved no addresses); or take the lever and move the initcode" >&2
      echo "        out. If you take the lever, read THE LEVER above first — an EIP-1167 clone ends" >&2
      echo "        this coupling, a separate deployer only moves it to a contract with a smaller" >&2
      echo "        budget, which is what the DN404 mirror move already did once here." >&2
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi

if [ "$floorsTyped" -eq 0 ]; then
  echo "EIP-170 embed gate: PASS (ceilings only — no headroom floor is ruled for any of these"
  echo "                    embedders, so the next item to touch one finds the limit by a red"
  echo "                    build, not by a guard)"
else
  echo "EIP-170 embed gate: PASS"
fi
