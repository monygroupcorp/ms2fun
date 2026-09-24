#!/usr/bin/env bash
# Fail on any `vm.expectRevert` whose guarded call reads state externally in its own arguments.
#
# THE DEFECT
# `vm.expectRevert` arms the NEXT call frame, and Solidity evaluates a call's arguments before it
# makes the call. So in
#
#     vm.expectRevert(Hook.RateTooHigh.selector);
#     hook.setLpFeeRate(hook.MAX_CONFIGURABLE_LP_FEE() + 1);
#
# the next call is not `setLpFeeRate`. It is the `MAX_CONFIGURABLE_LP_FEE()` staticcall sitting in
# the argument list, which returns normally — the cheat code is spent on it, the test aborts with
# "next call did not revert as expected", and the rejection the test was written to prove is never
# reached. Every assertion after it in the function is dead too.
#
# WHY IT NEEDS A GATE RATHER THAN A FIX
# The failure is indistinguishable from the one a genuinely missing guard produces: both abort with
# the same message, at the same place. A test in this shape is red whether the contract is right or
# wrong, so it carries no signal in either direction, and reading the diff does not show it — the
# line looks like the assertion it is not making. It reached main once (PR #482, the alignment
# hook's 1% LP-fee ceiling) past review and a green per-push gate, because the suite it lives in is
# fork-only. The fix is one hoisted local; keeping it fixed is what this is for.
#
# WHAT THIS IS NOT
# A lexical gate, not a prover. It reads the statement that follows the cheat code and asks whether
# any argument dereferences a lowercase receiver — Solidity convention makes those variables, and a
# variable holding a contract means a real CALL. Libraries and value types are PascalCase and are
# passed over, as are the language builtins listed in `builtin` below. It does not follow a value
# through a helper or an assembly block. It exists to stop the shape above being introduced by
# accident, which is the only way it has ever arrived.
#
# Usage:
#   ./scripts/expect-revert-gate.sh                 # gate test/
#   ./scripts/expect-revert-gate.sh <path> [...]    # gate the given files or directories
#   ./scripts/expect-revert-gate.sh --self-test     # prove the gate still catches the shape
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

scan_awk='
BEGIN {
  # Lowercase receivers that are language builtins or cheat codes, not contract instances.
  split("abi vm type block msg tx address bytes string super this keccak256 payable", b, " ")
  for (i in b) builtin[b[i]] = 1
  findings = 0
}

# Strip line comments and string bodies so neither can hide or fake a match.
function strip(line,   out, i, c, c2, n) {
  out = ""; n = length(line)
  for (i = 1; i <= n; i++) {
    c = substr(line, i, 1); c2 = substr(line, i, 2)
    if (inblock) { if (c2 == "*/") { inblock = 0; i++ }; continue }
    if (instr)   { if (c == "\\") { i++; continue }; if (c == strq) instr = 0; continue }
    if (c2 == "/*") { inblock = 1; i++; continue }
    if (c2 == "//") break
    if (c == "\"" || c == "'"'"'") { instr = 1; strq = c; continue }
    out = out c
  }
  return out
}

function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }

# The argument list of the outermost call in `s`: everything between its first "(" and the ")"
# that closes it. Empty when the statement makes no call.
function arglist(s,   i, d, n, c, open, out) {
  n = length(s); d = 0; open = 0
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "(") { d++; if (d == 1) { open = i; continue } }
    else if (c == ")") { d--; if (d == 0) return substr(s, open + 1, i - open - 1) }
  }
  return ""
}

# Does this argument list dereference a lowercase receiver, i.e. make a real call?
function externalcall(args,   rest, recv, member) {
  rest = args
  while (match(rest, /[A-Za-z_][A-Za-z0-9_]*[ \t]*\.[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*\(/)) {
    recv = substr(rest, RSTART, RLENGTH)
    rest = substr(rest, RSTART + RLENGTH)
    member = recv
    sub(/[ \t]*\.[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*\($/, "", member)
    if (member ~ /^[a-z_]/ && !(member in builtin)) return member
  }
  return ""
}

{ line[NR] = strip($0) }

END {
  for (n = 1; n <= NR; n++) {
    if (line[n] !~ /vm[ \t]*\.[ \t]*expectRevert/) continue

    # The guarded statement is the next one, gathered to its terminating ";".
    stmt = ""; startline = 0
    for (m = n + 1; m <= NR && m <= n + 12; m++) {
      if (trim(line[m]) == "") continue
      if (startline == 0) startline = m
      stmt = stmt " " line[m]
      if (line[m] ~ /;/) break
    }
    if (startline == 0) continue

    who = externalcall(arglist(stmt))
    if (who == "") continue

    printf "%s:%d: vm.expectRevert is consumed by `%s.…()` in the arguments of the call it guards.\n", FILENAME, startline, who
    printf "%s:%d:   Read it into a local above the cheat code; as written the guarded call is never reached.\n", FILENAME, startline
    findings++
  }
  exit(findings > 0 ? 1 : 0)
}
'

self_test() {
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  cat > "$tmp/Bad.t.sol" <<'BAD'
contract Bad {
    function test_caught() public {
        vm.expectRevert(Hook.RateTooHigh.selector);
        hook.setLpFeeRate(hook.MAX_CONFIGURABLE_LP_FEE() + 1);
    }
}
BAD
  cat > "$tmp/Good.t.sol" <<'GOOD'
contract Good {
    function test_hoisted() public {
        uint24 maxRate = hook.MAX_CONFIGURABLE_LP_FEE();
        vm.expectRevert(Hook.RateTooHigh.selector);
        hook.setLpFeeRate(maxRate + 1);
    }
    function test_libraryArgIsNotACall() public {
        vm.expectRevert(Vault.ZeroAmount.selector);
        vault.receiveContribution(Currency.wrap(address(0)), 0, bob);
    }
    function test_selectorIsNotACall() public {
        vm.expectRevert(Vault.Denied.selector);
        vault.execute(address(registry), 0, abi.encodeWithSelector(registry.getPayout.selector, id));
    }
    function test_internalHelperIsNotACall() public {
        vm.expectRevert(Hook.NotManager.selector);
        hook.afterSwap(alice, key, _sellParams(1 ether), BalanceDelta.wrap(0), bytes(""));
    }
    function test_commentedShapeIsNotACall() public {
        // hook.setLpFeeRate(hook.MAX_CONFIGURABLE_LP_FEE() + 1);
        vm.expectRevert(Hook.RateTooHigh.selector);
        hook.setLpFeeRate(maxRate + 1);
    }
}
GOOD
  fail=0
  if awk "$scan_awk" "$tmp/Bad.t.sol" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: the gate passed a statement whose argument list makes the call." >&2; fail=1
  fi
  if ! out="$(awk "$scan_awk" "$tmp/Good.t.sol" 2>&1)"; then
    echo "SELF-TEST FAILED: the gate flagged a sound statement:" >&2; echo "$out" >&2; fail=1
  fi
  [ "$fail" -eq 0 ] && echo "expect-revert-gate self-test: the gate catches the shape and passes the four it must not."
  return "$fail"
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi

targets=("$@")
[ "${#targets[@]}" -eq 0 ] && targets=("$root/test")

mapfile -t files < <(find "${targets[@]}" -name '*.sol' -type f | sort)
[ "${#files[@]}" -eq 0 ] && { echo "expect-revert-gate: no .sol files under ${targets[*]}" >&2; exit 1; }

if awk "$scan_awk" "${files[@]}"; then
  echo "expect-revert-gate: ${#files[@]} file(s) clean — no vm.expectRevert is spent on its own arguments."
else
  echo "expect-revert-gate: the shape above is red whether the contract is right or wrong. Hoist the read." >&2
  exit 1
fi
