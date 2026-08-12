# Static Analysis (Slither): Status, Evidence, Manual Procedure

## Status

Slither is **NOT wired into CI**. `.github/workflows/contracts-ci.yml` (see #117)
runs `forge fmt --check`, `forge build`, the EIP-170 size/headroom + storage-layout
gate (`test/factories/erc404/eip170-diet-gate.sh`), `forge test`, and the v4
`RealSettlement` regression only — no Slither job.

Reason: a **whole-tree** Slither pass **crashes** on this tree (a hard abort during
IR construction, not a finding), on every release tested. However, Slither **does**
run successfully when **targeted at individual contracts / sectors** whose import
closure avoids the two files with tuple-returning ternaries (see below). So Slither
is usable as a **manual, sector-targeted advisory tool** — it is simply not wired
into CI (decision 2026-08-02: keep manual, do not build a CI job yet).

## Evidence

Bisect run 2026-08-02 on `origin/main @ c83dbc4`, host Slither via `pipx`.

### Whole-tree pass — crashes on every version

Recipe:

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

  **18 `src/` contracts inherit Solady `ReentrancyGuard`**. Known upstream issue:
  [crytic/slither#2578](https://github.com/crytic/slither/issues/2578).
  `slither.config.json`'s `filter_paths` does **not** help here — it filters
  *results*, not the IR build where the crash occurs.

- **0.10.4:** handles the Solady `ReentrancyGuard` pattern fine (see sector pass
  below) but crashes on tuple-returning ternaries in source —

  ```
  if zeroForOne then (r0,r1) else (r1,r0)
  ```

  at `src/peripherals/zRouter.sol:62` (also `zRouter.sol:151/343/392/898`,
  `src/vaults/cypher/CypherAlignmentVault.sol:289/294`).

- **0.10.0:** will not import under Python 3.14 (`No module named 'pkg_resources'`).

Note: you cannot simply `forge build --skip` the two tuple-ternary files out of a
whole-tree build — `CypherAlignmentVault` is interdependent (imported by
`src/factories/erc404cypher/CypherLiquidityDeployerModule.sol`), so excising it
yields empty/partial ASTs that corrupt the parse and then trip the Solady crash.

### Sector-targeted pass — works on 0.10.4

Pointing **Slither 0.10.4** at a contract (or sector directory) lets it resolve just
that contract's import closure. Closures that do **not** pull in the two tuple-ternary
files (`src/peripherals/zRouter.sol`, `src/vaults/cypher/CypherAlignmentVault.sol`)
analyze cleanly, Solady `ReentrancyGuard` and all. Confirmed example:

```
slither src/factories/erc1155/ERC1155Factory.sol \
  --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/ solady/=lib/solady/src/ v4-core/=lib/v4-core/src/ dn404/=lib/dn404/"
# → analyzed (24 contracts with 87 detectors), 7 result(s) found — no crash
```

The ERC1155 / ERC721 / ERC404 factory families (which contain the 18 Solady-
`ReentrancyGuard` money contracts) are coverable this way. The **uncovered sector**
is `zRouter.sol` (vendored z-fi upstream — audit upstream separately, do not edit
here) plus `CypherAlignmentVault.sol` and anything whose closure includes it; these
stay uncovered until the tuple-ternary crash is resolved (upstream fix, or a
spec-gated rewrite — see triggers).

## Manual Pre-Deploy Procedure (Advisory)

On a working local toolchain (Slither **0.10.4**, Python ≤ 3.12), run Slither
**per sector**, targeting an entry contract (or dir) whose closure avoids the two
tuple-ternary files. Example for the ERC1155 family:

```
slither src/factories/erc1155/ \
  --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/ solady/=lib/solady/src/ v4-core/=lib/v4-core/src/ dn404/=lib/dn404/"
```

Repeat for the erc721 and erc404 factory families. Triage findings by hand.
Do **not** run the whole-tree `slither .` form — it aborts (see Evidence).
For the zRouter/Cypher sector there is no working Slither pass today; rely on
manual review + the existing test/audit gates there.

`contracts/slither.config.json` (`filter_paths`, `detectors_to_exclude`, pinned
`solc 0.8.24`) is retained as-is.

## Revisit Triggers

1. **A new Slither release converts both ternary shapes** (whole-tree runnable).
   Wire it into `contracts-ci.yml` as an advisory job (`fail-on: none`, SARIF
   upload) pinned to that version, then ratchet `fail-on` up once a triage baseline
   is green.
2. **A deliberate, spec-gated, re-audited money-code pass** that rewrites
   `CypherAlignmentVault.sol`'s tuple-ternaries to if/else removes the tuple-ternary
   crash class for the Cypher sector (`zRouter.sol` is vendored — leave it). The
   Solady `ReentrancyGuard` crash class still needs the upstream fix for a
   *whole-tree* run, but sector-targeted 0.10.4 already covers the Solady contracts.
