# Mainnet deployment — runbook (dated 2026-10-19, target Tuesday 2026-11-17)

The mainnet sequence is the Sepolia sequence (`docs/SEPOLIA-DEPLOY-RUNBOOK.md`) with the mainnet
script substituted and the mainnet-only steps added. Where a step below says "as Sepolia §N", that
section is the instruction and this page only records what differs. Nothing here is signed before
the fork rehearsal in §3 is green on the exact commit that will be broadcast.

## 0. What is already true, and what is not

Read on 2026-10-19 against `main` at 8a3f798b and live chain state:

- Sepolia is deployed (2026-09-28) from the salt set in `script/SepoliaSalts.sol`; the site is a
  pinned bundle behind a `.gwei` name and answers.
- The deployer `0x000888695d3e361434f67D9dbd110f1A443822b9` has nonce 0 on mainnet. Nothing has
  touched the CREATE3 addresses there.
- `script/DeployMainnet.s.sol` still carries six `bytes32(0)` salts and `cfg.safe = address(0)`.
  Both are code, not mining: the Sepolia set is reusable on mainnet because CreateX's guarded salt
  carries no chain id and the collision proxy is per chain (see the script's own header, TODO 1).
- The two-phase ownership handover (`script/MigrateOwnership.s.sol`) has never been executed on any
  chain: `MasterRegistry.owner()` on Sepolia is still the deployer. `DeployCore` installs a
  `MockSafe` when `cfg.safe` is zero and nothing asserts the registries' owner afterwards
  (`contracts/docs/PRE-MAINNET-CHECKLIST.md`, entry 4).
- Three deploy-time choices are open in `DeployMainnet`: the alignment-target roster, the Safe
  address, and the tithe pair `hookFeeBips` / `lpFeeRate`. The tithe switch ships OFF either way.

## 1. Decisions that gate the date

The target is **Tuesday 2026-11-17**, chosen 2026-10-19: mainnet goes after one tester who is
not the operator has completed a run end to end on Sepolia and after the testnet announcement
has been posted, so the launch lands on an audience rather than ahead of one. The sequence
below keeps that order; the chain work does not wait for it.

| when | what |
| --- | --- |
| week of 10-20 | the four decisions in the table below; the code in §2 on one branch |
| 10-23 | Sepolia ownership handover executed and asserted (the first time on any chain) |
| 10-24 | the Safe created on mainnet, its address committed |
| by 11-06 | one outside tester's end-to-end run observed; the testnet announcement posted |
| 11-09 | fork rehearsal on the merge commit (§3); deployer funded |
| 11-16 | freeze; rehearsal re-run on the exact broadcast commit |
| **11-17, 06:00 to 09:00 UTC** | launch day (§4) |
| 11-18 | first collection created and bought once; announcement for mainnet |


| decision | where it lands |
| --- | --- |
| Safe signers and threshold | `the-safe` decision record; the Safe's address into the deploy config |
| tithe rate, or "OFF at launch, rate decided before the first enable" | `DeployMainnet._mainnetConfig` |
| the first curated alignment target | `DeployMainnet` targets array |
| pinning account on a paid plan | operator's account |

## 2. Code before the rehearsal

One branch, reviewed under the contracts gate:

1. `DeployMainnet` reads the six salts from `SepoliaSalts.sol` and asserts `SepoliaSalts.DEPLOYER`
   in `run()` as `DeploySepolia` does.
2. `cfg.safe` is the real Safe; `test/script/MainnetConfigCompleteness.t.sol` fails on a zero salt
   or a zero Safe.
3. A post-deploy assertion (in the verify step or `DeployCore`) that every registry's `owner()` is
   the Timelock, so a skipped handover fails loudly.
4. The roster entry for the first target.
5. `PRE-MAINNET-CHECKLIST` entries 1 and 2 struck with their evidence (the site has published; the
   scheduled deep-invariant job has completed on 2026-10-04, 10-11 and 10-18).

## 3. Fork rehearsal (the gate)

As Sepolia §4, against an anvil fork of mainnet, from the vanity deployer address, with
`DeployMainnet` itself and not `DeployAnvil`:

- deploy, then Timelock, then `MigrateOwnership` phase 1 and 2, then the owner assertion;
- one ERC-1155 collection created, one mint, one creator withdraw;
- one ERC-404 collection bought to graduation, so the liquidity module's residual (A-C5) is
  measured and checklist entry 3 can be struck;
- gas totals recorded.

Measured 2026-10-19 with `DeployAnvil` on a mainnet fork at block 26,225,916: 104 transactions,
92,541,481 gas. At a 1 gwei effective price that is about 0.09 ETH; at a 30 gwei spike about 2.8 ETH.
Fund the deployer for the spike case with margin (about 4.3 ETH) and do not broadcast into a spike.

Record the run under `contracts/deployments/fork-rehearsal-<date>/` as the 2026-09-28 Sepolia
rehearsal was.

## 4. Launch day

As Sepolia §3 (preflight: salts unspent on this chain, deployer nonce 0, balance), §5.1 (broadcast
with `--slow --verify`), §5.3 (address record, `deployments/mainnet.json`), §5.4 (bindings),
§5.5 (Timelock and handover, executed the same day), §6 (presets, quoter wiring, families, ownership
moved). Mainnet has no showcase seed (§5.2 does not apply) and the tithe stays off (§5.6 does not
apply until the rate is ruled and the first graduation has been watched).

Then §7: `VITE_CHAIN_ID=1`, the art service probed, both targets built from the commit that carries
the address record, the CAR pinned, an independent gateway fetch, the contenthash set, the footer
commit checked, one deep link walked.

## 5. After

- The first collection is created from the live site by its creator and one mint from a second
  wallet is observed. Chosen 2026-10-19: a timed open edition on the ERC-1155 rail, 0.01 ETH a
  piece, a 72-hour window, open supply, created and withdrawn by the operator's own wallet.
- The announcement is posted by the person whose name it goes out under.
- What is irreversible (Sepolia §8) is unchanged here, and one more line belongs on it for mainnet:
  the Safe's signer set is the protocol's root of trust from the handover on.
