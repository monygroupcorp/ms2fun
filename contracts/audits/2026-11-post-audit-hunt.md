# ms2fun contracts — post-audit exploit hunt, November 2026

The 2026-09-17 pre-testnet audit (`contracts/audits/2026-09-17-pre-testnet.md`, base `238b0131`) was
followed by changes to 60 production files under `contracts/src` (interfaces excluded): about 4,600 lines
added and 4,600 removed, two contracts no audit has read (`AlignmentHookSwapRouter`, `CurationRegistry`),
and four files deleted. This hunt looked for exploits in that diff only, before mainnet.

**Result: one confirmed finding, Low, in the testnet-only copy of zRouter. No finding on any contract
mainnet deploys.** Three hypotheses were proved defended, two candidate attacks were rejected, and four
rounds produced no usable test. Coverage is thin: 12 of the 56 live files were hunted or exercised by a
proof, 2 more were attempted without a test, and 42 were not hunted at all (table in section 4). Read this report as a spot check of the riskiest
diffs, not as audit coverage of the whole change.

## 1. Method

- **Scope.** `git diff 238b0131 main -- contracts/src`, in four lanes: endowment (Aave endowment vault,
  treasury), bonding (ERC404 curve, graduation trigger, staking), liquidity (graduation deployers, the v4
  alignment hook and its factory, LP vaults), and peripheral (routers, registries, ERC1155/721, query,
  metadata, gating).
- **Hunters.** Four automated hunting agents, one per lane, each on its own branch (`hunt-endowment`,
  `hunt-bonding`, `hunt-liquidity`, `hunt-peripheral`). They ran on an open-weight model from the
  Qwen3-Next family, served from a shared inference host that caps each reply at 8,192 output tokens.
  A separate reviewer set each round's hypothesis and judged every result.
- **What counts as a finding.** A finding is a Foundry test under `contracts/test/hunt/<lane>/` that
  PASSES when the attack works: the attacker gains, a user loses, or a stated invariant breaks. The
  trust levels and accepted classes are the 2026-09-17 audit's section 1.2. "The owner could rug",
  owner-settable numbers, the de-curation freeze and ambassador `execute` spending are not findings.
- **Judging.** Each test was rerun on a clean checkout of `main` (`080d1db9`; the one later merge,
  #521, touches nothing under `contracts/`) with only that test file added. A test that passes for a
  trivial reason, mocks the victim, or pranks a trusted role to carry out the attack was rejected. Each
  claim was also checked against the audit, and where a worker's claim rested on an untested assumption,
  the reviewer wrote a control test to settle it.
- **Baseline.** On `main` before the hunt: `forge build` succeeds (about 11 minutes, `via_ir`) and
  `FOUNDRY_PROFILE=ci forge test` passes 2,616 tests, with 0 failing and 29 skipped. No failure below
  predates the hunt.
- **Stopping rule.** A lane stopped after two rounds in a row with no new confirmed finding. All four
  lanes stopped under it, after 3.68 worker-hours of the 12 budgeted.

## 2. Findings

### Confirmed — Low, testnet copy of zRouter only: `wrap(0)` credits resting ETH to any caller

`src/peripherals/zRouter.sol`, `wrap`. Proof: `contracts/test/hunt/peripheral/H02_ZRouterResting.t.sol`.

The audit's L-9 fix gated `sweep` with `_requireOwnBalance`, so a caller may move only the value the
current transaction credited to the router. `wrap(0)` wraps the router's *whole* ETH balance and then
calls `depositFor(WETH, amount, address(this))`, which credits that whole amount to the current
transaction. That includes ETH resting there from an earlier transaction. A later caller who sends
nothing can multicall `wrap(0)` and then `sweep(WETH, …)` and leave with it. The proof covers two ways
value comes to rest (exact-out change sent to the router, and a deposit that was only partly swept back),
plus a control: the same sequence against an empty router reverts `Unauthorized`.

Value comes to rest only when a caller or front-end builds an incomplete chain. A revert in a later
multicall leg unwinds the whole transaction, so failed trades strand nothing. The impact is the L-9
class: resting value that the owner is meant to recover becomes first-come, first-served.

**Mainnet is not exposed.** `script/DeployMainnet.s.sol` sets `cfg.zrouter` to
`MainnetAddresses.ZROUTER`, the canonical zRouter already deployed on Ethereum. `DeployCore` deploys this
repository's copy only when that address is empty, which happens on Sepolia and Anvil. In the canonical
router's own source (`lib/zRouter/src/zRouter.sol`), `sweep` has no credit check at all, so leftover value
is anyone's by design there. That is the router's documented model, not a defect. The protocol's own
calls into the router (`BestRouteAcquirer`) are single, complete exact-input swaps and never leave value
resting. The fix, if wanted, is to bound `wrap` by the router's existing `_restingEth` baseline:
`amount == 0` means `balance − resting`, and an explicit amount above that reverts.

A follow-up walk of every other `depositFor` site found none that credits value its own leg did not
receive (`H03_ZRouterOtherCredits.t.sol` on `hunt-peripheral`, judged below).

### Defended (each proof passes, and asserts the defense with exact numbers)

| proof | claim tested | why it holds |
|---|---|---|
| `endowment/LateJoinerYield.t.sol` | someone who deposits right after an ambassador deploys most of the corpus takes yield owed to earlier benefactors | shares mint at `amount · shares / principal` and yield is crystallized before the deposit, so the late joiner's yield rate equals the earlier benefactors' (0.8 ETH on 2 ETH each) |
| `bonding/RoundTripRounding.t.sol` | buys split across bucket boundaries, then one sell, drain the reserve through rounding | the bucket floors telescope: gross refund equals gross cost exactly, the attacker loses exactly the sell fee, and the reserve is unchanged |
| `peripheral/H01_HookSwapReentry.t.sol` | a hook re-entering `AlignmentHookSwapRouter.swap` spends the outer caller's ETH | the nested `unlock` reverts `AlreadyUnlocked` in the real PoolManager; the victim pays exactly its own trade |
| `liquidity/PreInitRecoverableRealV4.t.sol` | initializing the graduation pool at a skewed price before graduation blocks graduation forever | on the real PoolManager, a one-wei swap on the empty pool resets the price to the graduation price, both on the hookless key and on the hooked key (the hook can be deployed early by anyone and lets a zero-fill swap through) |

The two real-PoolManager proofs need solc 0.8.26. They sit in `foundry.toml`'s `skip` list and run in
`scripts/real-v4-gate.sh`.

### Rejected

| claim | branch, file | why rejected |
|---|---|---|
| a skewed pre-init of the graduation pool "bricks graduation forever" and traps the raise | `hunt-liquidity`, `SkewedPoolInitBricksGraduation.t.sol` | the revert it shows is the documented defense (`GraduationFrontRunGuard.t.sol`, audit M-1); "forever" rested on a mock PoolManager that has no `swap`, and the real-v4 control above shows the price is recoverable; the revert unwinds graduation, so the raise is never trapped. What remains is a griefing note: an attacker can re-skew before each attempt, which an atomic restore-and-graduate defeats |
| a registered instance seals its POL slot with a dust `receivePOL`, locking out the protocol's graduation fee leg | `hunt-endowment`, `TreasuryDustSealPOLSlot.t.sol` | the test pranks an address as a registered instance; no instance code calls `receivePOL` or makes arbitrary calls, so neither a T4 nor a T3 caller can reach it |
| `snwap` mints a credit the size of the router's resting balance | `hunt-peripheral`, `H03_ZRouterOtherCredits.t.sol` | `snwap` credits `finalBalance − initialBalance`, a delta, which is 0 here; the attack test's `snwap` leg does nothing, and a control with only `wrap(0)` and `sweep` takes the same value (that is the H02 finding) |

The rejected tests stay on their hunt branches as the record. They are not added to `main` because
their names claim more than they prove.

### No result

| lane | hypothesis | what happened |
|---|---|---|
| bonding | someone who stakes just before staking rewards are credited captures rewards accrued before they joined | no test produced; the hunter established that fee rewards are streamed over 7 days (`recordFeesReceived`) rather than credited at once, which generally defeats this, but it is untested |
| liquidity | real-v4 permanence of a skewed pre-init (settled instead by the reviewer's control above) | no test produced |
| peripheral | `AlignmentRegistryV1.requestVault` / `rotateCommunityPayout` let a T3 or T4 caller redirect community money | an unfinished, uncommitted draft only; untested |

## 3. Per lane

| lane | files hunted or exercised | hypotheses tried | confirmed | rejected | defended | no result | worker-hours |
|---|---|---|---|---|---|---|---|
| endowment | 2 of 4 | 2 | 0 | 1 (POL dust seal: unreachable) | 1 | 0 | 0.51 |
| bonding | 4 of 11 (+1 attempted) | 2 | 0 | 0 | 1 | 1 (staking timing) | 1.04 |
| liquidity | 4 of 13 live (3 deleted) | 2 | 0 | 1 (pre-init "forever": recoverable) | 1 (reviewer's control) | 1 | 0.87 |
| peripheral | 2 of 28 live (+1 attempted; 1 deleted) | 4 | 1 (Low, testnet copy only) | 1 (snwap credit: duplicate, claim false) | 1 | 1 (registry writes) | 1.26 |
| **total** | **12 of 56 live (+2 attempted)** | **10** | **1** | **3** | **4** | **3** | **3.68** |

Worker-hours are the wall time of each hunter run, summed across 21 runs. Up to four ran at once, from
10:12 to 12:04 on 2026-11-10.

## 4. Every changed file

Verdicts: *hunted* means a hypothesis aimed at the file was tested. *Exercised* means a proof ran the
file's code without a hypothesis of its own. *Attempted* means a hunter worked on it and produced no
usable test. *Not hunted* means nothing in this hunt looked at it.

#### endowment (4 files)

| file | verdict |
|---|---|
| `treasury/ProtocolOwnedLiquidityV1.sol` | hunted: dust `receivePOL` seals an instance's POL slot — rejected, not reachable (needs a registered instance to make a call no instance code makes) |
| `treasury/ProtocolTreasuryV1.sol` | not hunted |
| `vaults/aave/AlignmentEndowmentVault.sol` | hunted: late-joiner yield after an ambassador deploy — defended (`LateJoinerYield`) |
| `vaults/aave/AlignmentEndowmentVaultFactory.sol` | not hunted |

#### bonding (11 files)

| file | verdict |
|---|---|
| `factories/erc404/CurveParamsComputer.sol` | not hunted |
| `factories/erc404/DeployBondEscrow.sol` | not hunted |
| `factories/erc404/ERC404BondingInstance.sol` | hunted (same proof as Ops): round trip — defended (`RoundTripRounding`) |
| `factories/erc404/ERC404BondingOps.sol` | hunted: buy/sell rounding round trip — defended (`RoundTripRounding`); staking reward timing attempted, no test produced |
| `factories/erc404/ERC404BondingStorage.sol` | exercised by `RoundTripRounding` (storage layout under the Ops delegatecall); no hypothesis of its own |
| `factories/erc404/ERC404Factory.sol` | not hunted |
| `factories/erc404/ERC404StakingModule.sol` | attempted, no test: staking reward timing; rewards are streamed over 7 days, not lump-credited |
| `factories/erc404/LaunchManager.sol` | not hunted |
| `factories/erc404/README.md` | not hunted |
| `factories/erc404/libraries/BondingCurveMath.sol` | exercised by `RoundTripRounding`: bucket floors telescope, gross refund equals gross cost |
| `shared/libraries/RevenueSplitLib.sol` | not hunted |

#### liquidity (16 files)

| file | verdict |
|---|---|
| `factories/erc404cypher/CypherLiquidityDeployerModule.sol` | deleted since the audit — nothing to hunt |
| `vaults/cypher/CypherAlignmentVault.sol` | deleted since the audit — nothing to hunt |
| `vaults/cypher/CypherAlignmentVaultFactory.sol` | deleted since the audit — nothing to hunt |
| `factories/erc404/LiquidityDeployerModule.sol` | hunted: skewed pre-init of the graduation pool — not permanent, recoverable by a one-wei swap (`PreInitRecoverableRealV4`); the revert itself is the documented defense |
| `factories/erc404/hooks/HookAddressMiner.sol` | exercised indirectly through `deployHook` in `PreInitRecoverableRealV4`; no hypothesis of its own |
| `factories/erc404/hooks/IAlignmentHook.sol` | not hunted |
| `factories/erc404/hooks/IAlignmentHookFactory.sol` | not hunted |
| `factories/erc404/hooks/UniAlignmentV4Hook.sol` | exercised by `PreInitRecoverableRealV4`: a zero-fill swap passes the hook on an empty pool; by `H01_HookSwapReentry` only as a hostile stand-in, not this hook |
| `factories/erc404/hooks/UniTitheHookFactory.sol` | exercised by `PreInitRecoverableRealV4`: `deployHook` is permissionless and a pre-deployed hook leaves the pool recoverable |
| `factories/erc404zamm/ZAMMLiquidityDeployerModule.sol` | not hunted |
| `peripherals/UniswapVaultPriceValidator.sol` | not hunted |
| `shared/libraries/BestRouteAcquirer.sol` | not hunted |
| `vaults/uni/UniAlignmentVault.sol` | not hunted |
| `vaults/uni/UniAlignmentVaultFactory.sol` | not hunted |
| `vaults/zamm/ZAMMAlignmentVault.sol` | not hunted |
| `vaults/zamm/ZAMMAlignmentVaultFactory.sol` | not hunted |

#### peripheral (29 files)

| file | verdict |
|---|---|
| `peripherals/AlignmentHookSwapRouter.sol` | hunted: hook re-entry spends the outer caller's ETH — defended by the PoolManager lock (`H01_HookSwapReentry`) |
| `registry/CurationRegistry.sol` | not hunted |
| `shared/SafeOwnable.sol` | not hunted |
| `promotion/PromotionBadges.sol` | deleted since the audit — nothing to hunt |
| `factories/erc1155/ERC1155Factory.sol` | not hunted |
| `factories/erc1155/ERC1155Instance.sol` | not hunted |
| `factories/erc721/ERC721AuctionFactory.sol` | not hunted |
| `factories/erc721/ERC721AuctionInstance.sol` | not hunted |
| `gating/IGatingModule.sol` | not hunted |
| `gating/IMerkleGatingModule.sol` | not hunted |
| `gating/MerkleGatingModule.sol` | not hunted |
| `master/AlignmentRegistryV1.sol` | attempted, no test: `requestVault` / `rotateCommunityPayout` redirecting community money (draft only) |
| `master/AlignmentTargetRequestRegistry.sol` | not hunted |
| `master/FeaturedQueueManager.sol` | not hunted |
| `master/MasterRegistry.sol` | not hunted |
| `master/MasterRegistryV1.sol` | not hunted |
| `metadata/MetadataOverlayModule.sol` | not hunted |
| `metadata/MetadataResolverRouter.sol` | not hunted |
| `metadata/OnchainImageStore.sol` | not hunted |
| `metadata/SafeResolverLib.sol` | not hunted |
| `metadata/TierRevealModule.sol` | not hunted |
| `metadata/TokenTierBandResolver.sol` | not hunted |
| `peripherals/zRouter.sol` | hunted: **confirmed Low, testnet fork only** — `wrap(0)` credits resting ETH to any caller, reopening L-9 in the fork (`H02_ZRouterResting`); mainnet uses the canonical deployed router, whose `sweep` is open by design; every other credit site walked, none credits value it did not receive (H03, on the hunt branch) |
| `query/QueryAggregator.sol` | not hunted |
| `registry/ComponentRegistry.sol` | not hunted |
| `registry/GlobalMessageRegistry.sol` | not hunted |
| `shared/CreateXConstants.sol` | not hunted |
| `shared/SafeOwnableUUPS.sol` | not hunted |
| `shared/libraries/MetadataUtils.sol` | not hunted |

## 5. The hunters, read honestly

**Survival of their claims.** The hunters landed eight tests over ten hypotheses. Of their four attack
claims, one survived the rerun, in the testnet copy only. The other three were rejected: one trusted a
mock that could not express the counter-move, one pranked a trusted role, and one was a duplicate that
misread the code. All three of their defended claims survived, and each asserted exact numbers. In short,
their "this is safe" was reliable and their "this is exploitable" was not, until it was checked.

**Good at:** writing a compiling test against the real contracts quickly when a run went well (the first
took about six minutes); finding the actual defense rather than the one a code comment names (the
PoolManager lock in H01); exact-equality assertions; and adding controls to show a test is not trivially
true (H02, H03).

**Bad at:**

- *Staying inside the output cap.* 10 of 21 runs ended when a reply hit the 8,192-token limit
  mid-thought and the host then refused the next request ("Invalid or unsafe inference payload"). Two
  more ran out their 120-turn budget on lookups without writing a file. Each long session ended the same
  way once it grew large. Lowering the reasoning effort moved the failure from truncation to
  iteration exhaustion; it did not remove it.
- *Overclaiming.* "Forever", "a normal front-end flow", "mints a resting-sized credit": each was a
  stronger sentence than the test behind it.
- *Trusting mocks.* An untested comment said "a swap into an empty pool reverts", and a claim was built
  on it.
- *Following corrections.* A one-line correction to NOTES.md was asked for in two rounds running and was
  not made.
- *Destructive cleanup.* One hunter wrote a file to a doubled path, ran `rm -rf` on the repository's real
  test directory to clean up, and restored it from git. Nothing was lost, but nothing stopped it either.

**Against one frontier-model session in the same hours.** Four of them did not beat one. The decisive
work in this hunt was the reviewer's, not the hunters':
- writing the real-v4 control that refuted the "forever" claim,
- the no-`snwap` control that refuted H03,
- tracing the deploy path that scoped H02 to testnet,
- and rejecting the instance prank.

The hunters' throughput was gated by crashes, and every attack claim needed a rerun and usually a
counter-test. A single frontier session hunting directly would likely have covered as many files with
fewer false claims to unwind. The setup's real advantage is cost: hunter tokens on a shared host are
close to free. That is worth having only once the output-cap failure is fixed at the host or in the
harness. Taking it to new work as it stands is not recommended.

## 6. Reproduce

```sh
cd contracts
export FOUNDRY_THREADS=6
forge test --match-path "test/hunt/**"          # LateJoinerYield, RoundTripRounding, H02
bash scripts/real-v4-gate.sh                    # includes H01 and PreInitRecoverableRealV4
```

The rejected and no-result tests are on branches `hunt-endowment`, `hunt-bonding`, `hunt-liquidity` and
`hunt-peripheral`, each with a `NOTES.md` under `contracts/test/hunt/<lane>/`.

No file under `contracts/src` was changed by this hunt.
