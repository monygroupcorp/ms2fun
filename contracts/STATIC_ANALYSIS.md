# Static Analysis (Slither): Status, Evidence, Manual Procedure

## Status

Slither is **NOT wired into CI**. `.github/workflows/contracts-ci.yml` (see #117)
runs `forge fmt --check`, `forge build`, `forge test`, and the v4 `RealSettlement`
regression only — no Slither job.

Reason: every current Slither release **crashes** on this tree (a hard abort during
IR construction, not a finding). There is nothing to gate on yet.

## Evidence

Bisect run 2026-08-02 on `origin/main @ c83dbc4`, host Slither via `pipx`.

Recipe each time:

```
forge build --build-info --skip "*/test/**" "*/script/**" "src/vaults/zamm/**" --force
slither . --foundry-ignore-compile
```

Every version aborts with `SlithIRError` — exit 255, **zero findings emitted**:

- **0.11.5 / 0.11.3 / 0.11.1** (0.11.5 is what `crytic/slither-action@v0.4.0` installs
  by default): crash converting Solady `ReentrancyGuard`'s compile-time slot assertion —

  ```
  Ternary operator are not convertible to SlithIR if _RG_SLOT == uint256(uint72(bytes9(keccak256(_REENTRANCY_GUARD_SLOT)))) then 1 else 0
  ```

  **18 `src/` contracts inherit Solady `ReentrancyGuard`** → this cannot be filtered
  out; they are the core money contracts. Known upstream issue:
  [crytic/slither#2578](https://github.com/crytic/slither/issues/2578).
  `slither.config.json`'s `filter_paths` does **not** help here — it filters
  *results*, not the IR build where the crash occurs.

- **0.10.4:** clears the Solady crash but crashes earlier on tuple-returning
  ternaries in source —

  ```
  if zeroForOne then (r0,r1) else (r1,r0)
  ```

  at `src/peripherals/zRouter.sol:62` (also `zRouter.sol:151/343/392/898`,
  `src/vaults/cypher/CypherAlignmentVault.sol:289/294`).

- **0.10.0:** will not import under Python 3.14 (`No module named 'pkg_resources'`).

Two independent, cross-version SlithIR limitations (constant-ternary + tuple-ternary)
make a clean pass impossible without either an as-yet-unreleased upstream fix or
money-code source rewrites (spec-gated, out of scope here). Corollary: the old
nested `slither` job (removed in #117) would have crash-failed too.

## Manual Pre-Deploy Procedure (Advisory)

On a working local toolchain, run:

```
forge build --build-info --skip "*/test/**" "*/script/**" "src/vaults/zamm/**" --force
slither . --foundry-ignore-compile
```

and triage the output by hand. Expect it to **abort at the crash** until a fix
lands — so today the practical advisory tool is **manual review plus the existing
test/audit gates**, not Slither. Slither does not currently produce output on this
tree; do not treat an absence of a Slither run as a clean bill of health.

`contracts/slither.config.json` (`filter_paths`, `detectors_to_exclude`, pinned
`solc 0.8.24`) is retained as-is, ready for when a runnable version exists.

## Revisit Triggers

1. **A new Slither release converts both ternary shapes.** Wire it into
   `contracts-ci.yml` as an advisory job (`fail-on: none`, SARIF upload) pinned to
   that version, then ratchet `fail-on` up once a triage baseline is green. (This is
   where the "start advisory and ratchet" decision re-activates — it was moot until
   a runnable version exists.)
2. **A deliberate, spec-gated, re-audited money-code pass** that rewrites
   `CypherAlignmentVault.sol`'s (and `zRouter.sol`'s) tuple-ternaries to if/else
   removes the tuple-ternary crash class. The Solady `ReentrancyGuard` crash class
   still needs the upstream fix regardless.
