# Mainnet fork rehearsal — 2026-11-13

The record of the §3 rehearsal in `docs/MAINNET-DEPLOY-RUNBOOK.md`, run by `pnpm chain:rehearse:mainnet`
on commit 1123d0d0 with a clean working tree, against an anvil fork of mainnet at block 26,408,176. It
records that run and nothing more. None of it describes mainnet.

The six registry proxies are CREATE3 addresses, so they are the same on any chain. Every address below
them, including the Timelock, is fork-ephemeral.

- `mainnet.json`: the deploy record `DeployMainnet` wrote, moved here from the live record's path and
  stamped `forkRehearsal`.
- `rehearsal.json`: the run, with the Timelock, the registry owners, the gas per step and the
  collection figures.

## Result

Green. `DeployMainnet` ran from `0x000888695d3e361434f67D9dbd110f1A443822b9` at nonce 0 with all six
registry addresses empty. Then `DeployTimelock` ran under the Safe `0xBCE7…d262` at the 24h delay.
Phase 1 was proposed by the Safe and executed by the Timelock after the delay; phase 2 and `verify()`
followed. All six registries are owned by the Timelock. Of the 70 contracts the deploy created, the
only ones still owned by the deployer are the 6 UUPS implementations behind the proxies, which are
`MigrateOwnership`'s stated exclusion.

The first run of this rehearsal did **not** come out clean. `ZAMMAlignmentVaultFactory` was still
owned by the deployer after a handover that `verify()` passed, because the deploy record carried no
address for it and `MigrateOwnership` reads `ZAMM_VAULT_FACTORY` as optional. The fix is commit
127dba40 (`factories.ZAMM` in the record), and this run includes it.

## Gas

| step | tx | gas |
| --- | ---: | ---: |
| `DeployMainnet` | 112 | 91,331,334 |
| `DeployTimelock` | 2 | 1,136,798 |
| `MigrateOwnership` phase 2 | 29 | 894,379 |
| **deployer total** | **143** | **93,362,511** |
| phase 1, Safe propose + Timelock execute | 2 | 336,892 |
| tithe on, Safe propose + Timelock execute | 2 | 120,697 |
| collections: create | 5 | 3,466,355 |
| collections: mint, withdraw, buy out, graduate | 4 | 6,214,029 |

The deployer's total costs 0.093 ETH at 1 gwei and 2.80 ETH at 30 gwei. The runbook's 4.3 ETH funding
covers the 30 gwei case. At the fork's own base fee (about 0.07 gwei) the deployer spent 0.0006 ETH.

## A-C5: the liquidity module's residual

The run graduated one ERC-404 on preset 0 (a 5 ETH raise), bought out in full. The tithe was switched
on first through the Timelock, so the pool carries the alignment hook, as pools will from launch.

| figure | value |
| --- | ---: |
| raise | 5.000000000000000033 ETH |
| LP leg offered to the pool (80%) | 4.000000000000000027 ETH |
| taken by the pool | 3.999999999999999684 ETH |
| LP-leg ETH the pool did not take | 343 wei |
| **ETH left in the module** | **0** |
| **coin left in the module** | **0** |
| coin burned at graduation | 59,340,544 base units (about 6e-11 of a token) |

The module holds nothing after graduation. The 343 wei the pool did not take went out on the
1/19/80 rail (the creator received 275 wei of it, the 80% share). That is the measurement checklist
entry 3 asks for, taken against current code.

## Seen along the way

The gas a hooked graduation needs varies from block to block. The tithe hook is deployed at a CREATE2
salt mined from an offset seeded by `block.prevrandao` and `block.number`. Forge set the transaction's
gas limit from a simulation at one block; the transaction landed in the next, the scan ran longer, and
the hook's creation ran out of gas. The same four collection transactions used 5.02M gas on one run
and 6.21M on the next. The rehearsal now sends that step with a 4x gas multiplier. A wallet's gas
estimate has the same exposure.
