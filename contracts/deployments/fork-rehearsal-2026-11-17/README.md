# Mainnet fork rehearsal — 2026-11-17

The record of the §3 rehearsal in `docs/MAINNET-DEPLOY-RUNBOOK.md`, run by `pnpm chain:rehearse:mainnet`
on commit f5fcfa65 with a clean working tree, against an anvil fork of mainnet at block 26,438,208. It
records that run and nothing more. None of it describes mainnet.

This is a re-run of the 2026-11-13 rehearsal (`../fork-rehearsal-2026-11-13/`) on the head of `main` after
the RPC transport fix (#540) and the bonding open-time menu fix (#541) merged. Neither touches a contract
or a script, and the numbers below match the 2026-11-13 run step for step except where noted.

- `mainnet.json`: the deploy record `DeployMainnet` wrote, moved here from the live record's path and
  stamped `forkRehearsal`.
- `rehearsal.json`: the run, with the Timelock, the registry owners, the gas per step and the
  collection figures.

## Result

Green, exit 0. `DeployMainnet` ran from `0x000888695d3e361434f67D9dbd110f1A443822b9` at nonce 0 with all
six registry addresses empty. `DeployTimelock` ran under the Safe `0xBCE7…d262` and the Timelock's delay
read back as 86,400s. Phase 1 of `MigrateOwnership` was proposed by the Safe and executed by the
Timelock after the delay; phase 2 and `verify()` followed. All six registries are owned by the
Timelock. The ownership sweep read 81 created contracts; the 6 UUPS implementations are the stated
exclusion and none of the other 75 is still owned by the deployer.

## Gas

| step | tx | gas |
| --- | ---: | ---: |
| `DeployMainnet` | 112 | 91,331,334 |
| `DeployTimelock` | 2 | 1,136,798 |
| `MigrateOwnership` phase 2 | 29 | 894,379 |
| **deployer total** | **143** | **93,362,511** |
| phase 1, Safe propose + Timelock execute | 2 | 336,892 |
| tithe on, Safe propose + Timelock execute | 2 | 120,697 |
| collections: create | 5 | 3,466,343 |
| collections: mint, withdraw, buy out, graduate | 4 | 7,653,965 |

The deployer's total is identical to the 2026-11-13 run: 0.093 ETH at 1 gwei, 2.80 ETH at 30 gwei.
The runbook's 4.3 ETH funding covers the 30 gwei case. The graduation step used 7.65M gas against
5.80M on 2026-11-13, inside the 5.02M to 7.64M spread that run recorded for a hooked graduation (the
hook's CREATE2 salt scan is seeded from the block), and the 4x gas multiplier carried it.

## A-C5: the liquidity module's residual

One ERC-404 on preset 0 (a 5 ETH raise), bought out in full and graduated with the alignment hook.

| figure | value |
| --- | ---: |
| LP leg offered to the pool | 4.000000000000000027 ETH |
| taken by the pool | 3.999999999999999684 ETH |
| LP-leg ETH the pool did not take | 343 wei |
| **ETH left in the module** (simulation and on chain) | **0** |
| **coin left in the module** (simulation and on chain) | **0** |
| coin burned at graduation | 59,340,544 base units |

Same figures as 2026-11-13: the module holds nothing after graduation.
