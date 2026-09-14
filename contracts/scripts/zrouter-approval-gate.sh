#!/usr/bin/env bash
# Fail on any ERC20 allowance granted to zRouter that is not exact and same-transaction.
#
# THE INVARIANT
# zRouter is a shared, permissionless router: anyone can call it, and every one of its swap legs
# pulls the input token with `transferFrom(payer, …)`. An allowance we leave standing on it is
# therefore spendable by any route any caller can construct, for as long as it stands. The
# invariant the contracts hold today, and the one this gate keeps holding:
#
#   Every approval granted to zRouter is sized to the exact amount that same transaction's swap
#   will pull, and is fully consumed before the transaction ends.
#
# Two ways to break it, and this gate refuses both:
#
#   NON-EXACT   an unbounded allowance (`type(uint256).max`), or one sized to something other than
#               the amount handed to the swap. The surplus is a standing claim on vault-held
#               tokens that no later code has to authorise.
#   CROSS-TX    an approval whose swap is not in the same function. The allowance then survives
#               the transaction that granted it, and the window in which it can be spent is
#               bounded by nothing.
#
# An `exactOut` swap is refused outright rather than analysed: on that path the router does not
# pull `swapAmount`, it pulls the pool-computed input on the V4 leg and the whole `amountLimit`
# on the zAMM leg (docs/spec/ZROUTER_AMOUNTLIMIT.md, "What the router actually pulls"). An
# approval sized to `swapAmount` is the wrong size there in both directions, so a first exact-out
# call site is a decision for a human, not a shape to be waved through. Nothing in the tree takes
# that path today.
#
# WHAT THIS IS NOT
# A lexical gate, not a prover. It reads the approval and the swap that follows it in the same
# function body and checks they agree; it does not follow a value through a helper, an assembly
# block, or a low-level `call`. It exists to stop the shapes above being introduced by accident.
#
# Usage:
#   ./scripts/zrouter-approval-gate.sh                 # gate src/ and script/
#   ./scripts/zrouter-approval-gate.sh <path> [...]    # gate the given files or directories
#   ./scripts/zrouter-approval-gate.sh --self-test     # prove the gate still catches each shape
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

scan_awk='
# ── comment and string stripping, line numbers preserved ────────────────────
function strip(line,   out, i, c, c2, n) {
  out = ""; n = length(line)
  for (i = 1; i <= n; i++) {
    c = substr(line, i, 1); c2 = substr(line, i, 2)
    if (inblock) { if (c2 == "*/") { inblock = 0; i++ }; continue }
    if (instr)   { out = out c; if (c == "\\") { out = out substr(line, i+1, 1); i++ } \
                   else if (c == strq) instr = 0; continue }
    if (c2 == "/*") { inblock = 1; i++; continue }
    if (c2 == "//") break
    if (c == "\"" || c == "'"'"'") { instr = 1; strq = c; out = out c; continue }
    out = out c
  }
  return out
}

# ── argument list of the call whose "(" is at position `open` ───────────────
# Returns the count; fills args[1..count], trimmed. `open` is the index of "(".
function splitargs(s, open, args,   i, d, n, cur, count, c) {
  d = 0; cur = ""; count = 0; n = length(s)
  for (i = open; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "(" || c == "[" || c == "{") { d++; if (d == 1) continue }
    else if (c == ")" || c == "]" || c == "}") {
      d--
      if (d == 0) { count++; args[count] = trim(cur); if (count == 1 && args[1] == "") count = 0; return count }
    }
    else if (c == "," && d == 1) { count++; args[count] = trim(cur); cur = ""; continue }
    cur = cur c
  }
  return -1   # unbalanced
}

function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
function squash(s) { gsub(/[ \t\n]+/, " ", s); return trim(s) }

function report(line, msg) { printf "%s:%d: %s\n", FILENAME, line, msg; findings++ }

# ── per-statement scan of one function body ────────────────────────────────
# body carries "@@<lineno>@@" markers so a finding can name its source line.
function checkbody(body, fnname,   nstmt, stmts, i, j, k, st, line, open, n, args, \
                   spender, amount, swapline, swapargs, nswap, sargs, found) {
  nstmt = split(body, stmts, ";")
  for (i = 1; i <= nstmt; i++) {
    st = stmts[i]
    if (st !~ /zRouter/) continue
    if (st !~ /[.( ](approve|forceApprove|safeApprove|safeApproveWithRetry|increaseAllowance|safeIncreaseAllowance)[ \t]*\(/) continue

    line = 0
    if (match(st, /@@[0-9]+@@/)) line = substr(st, RSTART+2, RLENGTH-4) + 0
    st = squash(stripmarks(st))

    # locate the approve call and split its arguments
    if (!match(st, /(approve|forceApprove|safeApprove|safeApproveWithRetry|increaseAllowance|safeIncreaseAllowance)[ ]*\(/)) continue
    open = RSTART + RLENGTH - 1
    n = splitargs(st, open, args)
    if (n < 2) { report(line, "approval to zRouter could not be parsed: " st); continue }

    spender = 0
    for (j = 1; j < n; j++) if (args[j] == "zRouter" || args[j] == "address(zRouter)") spender = j
    if (!spender) continue          # zRouter appears, but not as the spender
    amount = args[spender + 1]

    # A reset to zero grants nothing; it is how a stale allowance is cleared.
    if (amount == "0") continue

    if (amount ~ /^type\(uint(256)?\)\.max$/ || amount ~ /^2 ?\*\* ?256 ?- ?1$/ \
        || amount ~ /^0[xX][fF]{40,}$/ || amount ~ /MAX_UINT|UINT.*MAX/) {
      report(line, "NON-EXACT: unbounded allowance to zRouter (" amount ") in " fnname "(). " \
                   "Approve the exact amount this transaction swaps.")
      continue
    }

    # the swap that consumes it must be later in this same function body
    found = 0
    for (k = i + 1; k <= nstmt; k++) {
      if (stmts[k] !~ /zRouter/) continue
      if (stmts[k] !~ /swap[A-Za-z0-9]*[ \t\n]*\(/) continue
      swapline = stmts[k]
      found = 1
      break
    }
    if (!found) {
      report(line, "CROSS-TX: allowance granted to zRouter in " fnname "() with no zRouter swap " \
                   "after it in the same function. The allowance outlives the transaction.")
      continue
    }

    swapline = squash(stripmarks(swapline))
    if (!match(swapline, /\.[ ]*swap[A-Za-z0-9]*[ ]*(\{[^}]*\})?[ ]*\(/)) {
      report(line, "approval to zRouter is followed by an unparseable swap call in " fnname "(): " swapline)
      continue
    }
    open = RSTART + RLENGTH - 1
    nswap = splitargs(swapline, open, sargs)
    if (nswap < 2) { report(line, "zRouter swap call could not be parsed in " fnname "(): " swapline); continue }

    # arg 2 is `exactOut` on every typed leg (swapV2/V3/V4/VZ share the (to, exactOut, ...) prefix).
    if (sargs[2] != "false") {
      report(line, "EXACT-OUT: allowance to zRouter paired with a swap whose exactOut is \"" sargs[2] \
                   "\" in " fnname "(). An exact-out leg does not pull swapAmount -- see " \
                   "docs/spec/ZROUTER_AMOUNTLIMIT.md before sizing this approval.")
      continue
    }

    found = 0
    for (j = 1; j <= nswap; j++) if (sargs[j] == amount) found = 1
    if (!found) {
      report(line, "NON-EXACT: allowance to zRouter is \"" amount "\" but no argument of the swap it " \
                   "guards has that value in " fnname "(). Size the approval to the amount swapped.")
    }
  }
}

function stripmarks(s) { gsub(/@@[0-9]+@@/, "", s); return s }

# ── driver: track brace depth, collect one function body at a time ─────────
BEGIN { findings = 0 }

FNR == 1 { depth = 0; infn = 0; body = ""; fnname = ""; inblock = 0; instr = 0; pending = "" }

{
  line = strip($0)
  if (line ~ /^[ \t]*$/ && !infn && pending == "") next

  # A function header may wrap across lines; buffer until we see "{" or ";".
  if (!infn) {
    if (pending != "" || line ~ /(^|[ \t])function[ \t]/) {
      pending = pending " @@" FNR "@@ " line
      if (index(line, "{") > 0) {
        if (match(pending, /function[ \t]+[A-Za-z0-9_$]+/))
          fnname = substr(pending, RSTART+9, RLENGTH-9)
        gsub(/^[ \t]+/, "", fnname)
        infn = 1; depth = 0; body = ""
        pending = ""
      } else if (index(line, ";") > 0) {
        pending = ""      # interface / abstract declaration, no body
        next
      } else next
    }
  }

  if (!infn) next

  body = body " @@" FNR "@@ " line

  n = length(line)
  for (i = 1; i <= n; i++) {
    c = substr(line, i, 1)
    if (c == "{") depth++
    else if (c == "}") {
      depth--
      if (depth == 0) {
        checkbody(body, fnname)
        infn = 0; body = ""; fnname = ""
        break
      }
    }
  }
}

END { exit (findings > 0 ? 1 : 0) }
'

scan() {
  local files=()
  local target
  for target in "$@"; do
    if [ -d "$target" ]; then
      while IFS= read -r f; do files+=("$f"); done < <(find "$target" -name '*.sol' -type f | sort)
    elif [ -f "$target" ]; then
      files+=("$target")
    else
      echo "zrouter-approval-gate: no such path: $target" >&2
      return 2
    fi
  done
  if [ ${#files[@]} -eq 0 ]; then
    echo "zrouter-approval-gate: nothing to scan" >&2
    return 2
  fi
  awk "$scan_awk" "${files[@]}"
}

self_test() {
  local cases="$root/scripts/zrouter-approval-gate.cases"
  local failures=0
  local case_file base expect out rc

  for case_file in "$cases"/*.sol; do
    base="$(basename "$case_file")"
    case "$base" in
      ok-*) expect=0 ;;
      bad-*) expect=1 ;;
      *)
        echo "self-test: $base must be named ok-* or bad-*" >&2
        failures=$((failures + 1))
        continue
        ;;
    esac

    set +e
    out="$(scan "$case_file" 2>&1)"
    rc=$?
    set -e

    if [ "$rc" -ne "$expect" ]; then
      echo "self-test FAILED: $base expected exit $expect, got $rc" >&2
      [ -n "$out" ] && printf '%s\n' "$out" >&2
      failures=$((failures + 1))
    else
      echo "self-test ok: $base (exit $rc)"
      [ "$expect" -eq 1 ] && printf '  %s\n' "$out"
    fi
  done

  if [ "$failures" -gt 0 ]; then
    echo "self-test: $failures case(s) did not behave as declared -- the gate is not trustworthy" >&2
    return 1
  fi
  echo "self-test: every case behaved as declared"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

if [ "$#" -gt 0 ]; then
  targets=("$@")
else
  targets=("$root/src" "$root/script")
fi

if scan "${targets[@]}"; then
  echo "zrouter-approval-gate: every allowance granted to zRouter is exact and same-transaction"
else
  rc=$?
  if [ "$rc" -eq 1 ]; then
    echo "zrouter-approval-gate: the invariant above is broken at the sites listed" >&2
  fi
  exit "$rc"
fi
