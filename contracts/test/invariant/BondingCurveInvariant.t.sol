// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { ERC404BondingStorage } from "../../src/factories/erc404/ERC404BondingStorage.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { BondingCurveHandler } from "./handlers/BondingCurveHandler.sol";

contract MockLiqDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title BondingCurveInvariantTest
 * @notice The stateful, multi-actor, fuzzer-sequenced money-code suite over `ERC404BondingInstance`.
 * @dev noesis-152 (Token Tiers T4) SEALED A LADDER on this fixture and put the tier ops in the handler.
 *      Until then every curve invariant here had only ever been evaluated on a tier-free instance, and
 *      no test anywhere interleaved curve ops with tier ops: the two shipped tier suites are bounded
 *      single-purpose loops that never return to the curve once tier ops begin. That interleaving is
 *      exactly the sequence where a tier op could perturb curve accounting — a sell that burns a band
 *      NFT fires the T3 `_afterNFTTransfers` hook in the middle of DN404's reconciliation, and a
 *      subsequent buy then re-evaluates the curve integral on the other side of it.
 *
 *      The four original curve invariants below are UNCHANGED. They now hold under fuzzer-driven
 *      interleavings of buy / sell / mintUp / mintDown / band-burn / escrow-claim.
 */
contract BondingCurveInvariantTest is StdInvariant, Test {
    ERC404BondingInstance public instance;
    BondingCurveHandler public handler;
    BondingCurveMath.Params curveParams;

    address public owner = address(0x1);
    address public protocolTreasury = address(0xFEE);
    address public mockVault = address(0xBEEF);
    address public mockMasterRegistry = address(0x400);
    address public mockGlobalMsgRegistry = address(0x700);
    address public mockLiquidityDeployer;

    address[] public actors;

    // ── Fixture geometry (retuned by noesis-152) ─────────────────────────────────────────────────
    // A tier ladder needs a wide ORDINARY id space: the seal sizes each band `band_N = S / w_N`, where
    // S = idLimit = totalSupply / unit. With the original `UNIT = 1_000_000 ether` this fixture's S was
    // 10, so a weight-10 band would have been ONE id wide and the whole ladder unusable.
    //
    // The retune moves `UNIT`, NOT `MAX_SUPPLY`, deliberately: every curve claim in this file is a
    // function of `totalBondingSupply` in TOKENS and of `curveParams`, so shrinking the unit multiplies
    // the id space by 100 while leaving the curve's operating point — and therefore the four pre-existing
    // money-code invariants — exactly where they were. Raising `MAX_SUPPLY` instead would have moved the
    // curve to a new scale and blended any finding about the curve there into a tier-ops diff.
    //
    // Result: S = 1000, the identical id geometry the two shipped tier suites (TokenTierOps,
    // TierBurnSafety) use, so the ladder below can be the identical known-good 10-to-1 ladder.
    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant UNIT = 10_000 ether; // 10k tokens = 1 NFT  =>  ID_LIMIT = 1000
    uint256 constant ID_LIMIT = MAX_SUPPLY / UNIT;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant BONDING_FEE_BPS = 100; // 1%

    // The ladder: 10-to-1, bands strictly ABOVE ID_LIMIT, each sized `S / w` exactly (the §3 sizing
    // invariant the seal enforces — a wrong `idEnd` is rejected, so these constants are load-bearing).
    uint256 constant TIER_COUNT = 2;
    uint32 constant T1_START = 1001;
    uint32 constant T1_END = 1100; // 1000 / 10  = 100 ids
    uint32 constant T1_WEIGHT = 10;
    uint32 constant T2_START = 1101;
    uint32 constant T2_END = 1110; // 1000 / 100 =  10 ids
    uint32 constant T2_WEIGHT = 100;

    /// @dev Units handed to each actor from the curve in `setUp`, through the HANDLER's own buy leg (so
    ///      its curve ghosts stay authoritative). Every fuzz run starts from this state, which is what
    ///      makes the per-run non-vacuity gate below deterministic rather than seed-luck: a tier-1
    ///      `mintUp` costs `T1_WEIGHT` units and is affordable from the very first handler call, and the
    ///      handler's candidate walk turns affordability at the bottom rung into success (see
    ///      `MINTUP_ATTEMPT_CAP`). The margin over `T1_WEIGHT` is deliberate — an early sell can dump an
    ///      actor's whole position, and the run still has to be able to reach a tier op afterwards.
    uint256 constant SEED_UNITS_PER_ACTOR = 25;

    /// @dev `ghost_buyCount` after seeding, so the non-vacuity gate measures the RUN's own work.
    uint256 public seedBuyCount;

    /// @dev Handler calls a run must have made before the non-vacuity gate judges it. Well under the
    ///      configured `invariant.depth` (500) so any real run is judged, and above the length of a
    ///      minimized replay sequence. See `afterInvariant` for why the distinction matters.
    uint256 constant NONVACUITY_MIN_CALLS = 50;

    function setUp() public {
        mockLiquidityDeployer = address(new MockLiqDeployer());

        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });

        vm.startPrank(owner);

        // A REAL Ops address is load-bearing here. `initializeProtocol`, `setBondingOpenTime` and
        // `setBondingActive` are `_ops.delegatecall(msg.data)` trampolines (noesis-149), and a
        // delegatecall to a CODE-LESS address returns SUCCESS while writing nothing. With `address(0)`
        // this whole setUp silently no-ops: `bondingActive` stays false, every handler `buy` reverts
        // `BondingNotActive`, `totalBondingSupply` never leaves 0, and all four money-code invariants
        // below hold VACUOUSLY on a permanently empty curve while the suite still prints PASS. The
        // non-vacuity assertions at the end of setUp pin that so it can never go silent again.
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));

        ERC404BondingInstance.BondingParams memory bp = ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });

        instance.initialize(owner, mockVault, bp, mockLiquidityDeployer, address(0), address(new DN404Mirror(owner)));

        ERC404BondingInstance.ProtocolParams memory pp = ERC404BondingInstance.ProtocolParams({
            globalMessageRegistry: mockGlobalMsgRegistry,
            protocolTreasury: protocolTreasury,
            masterRegistry: mockMasterRegistry,
            bondingFeeBps: BONDING_FEE_BPS,
            weth: address(0xBEEF)
        });
        instance.initializeProtocol(pp);
        instance.initializeMetadata("Test Token", "TEST", "", "", "");

        // Seal the Token Tiers ladder. `initTierBands` is FACTORY-ONLY, and this fixture's `factory` is
        // whoever called `initialize` (`ERC404BondingInstance.initialize` sets `factory = msg.sender`) —
        // i.e. `owner`, because that call sits inside this prank. It is also a trampoline into Ops, so
        // every seal-invariant rejection collapses into `InitTierBandsFailed()`; the positive assertions
        // after `stopPrank` are what prove the ladder actually landed.
        instance.initTierBands(_ladder());

        instance.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        instance.setBondingActive(true);

        vm.stopPrank();

        // Non-vacuity gate: every invariant below is conditional on the curve actually being buyable.
        // If configuration silently no-ops (see the Ops note above), `buy` reverts on every handler
        // call, supply stays 0 and the invariants pass without testing anything. Assert the config
        // landed so a vacuous run fails LOUDLY in setUp instead of printing a green PASS.
        assertTrue(instance.bondingActive(), "setUp is vacuous: bonding never went active");
        assertEq(instance.bondingFeeBps(), BONDING_FEE_BPS, "setUp is vacuous: protocol params never landed");
        assertEq(instance.protocolTreasury(), protocolTreasury, "setUp is vacuous: no treasury to take fees");

        // The SAME failure mode now applies to the tier half: `initTierBands`, `mintUp` and `mintDown`
        // are trampolines through the same delegatecall seam, so a code-less Ops would no-op the seal
        // too — leaving an unsealed ladder on which every tier op reverts, every tier invariant below
        // holds on a permanently empty ladder, and the suite still prints PASS. Assert the SEALED SHAPE,
        // field by field, not merely that something got stored.
        _assertLadderSealed();

        // Every coin bucket in this fixture, DETERMINED not assumed — the exact conservation identity in
        // `afterInvariant` enumerates holders, so anything that could hold coin outside that list would
        // turn an exact identity into a silent inequality:
        //   * staking is NEVER wired here (`initializeStaking` is not called), so `stake`/`unstake` — the
        //     only other paths that move coin INTO the instance — revert `StakingModuleNotSet`;
        //   * `freeMintAllocation` is 0 (`initializeFreeMint` is not called), so `claimFreeMint` reverts;
        //   * graduation is owner-only and the handler cannot reach it, so the liquidity deployer is
        //     never handed the `liquidityReserve` (it is summed anyway, so a future change cannot make
        //     the identity silently wrong).
        assertEq(address(instance.stakingModule()), address(0), "staking wired: a coin bucket is unaccounted for");
        assertFalse(instance.stakingActive(), "staking active: a coin bucket is unaccounted for");
        assertEq(instance.freeMintAllocation(), 0, "free mint allocated: a coin bucket is unaccounted for");
        assertFalse(instance.graduated(), "graduated before the campaign started");

        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCAFE));
        actors.push(address(0xDEAD));

        handler = new BondingCurveHandler(instance, curveParams, actors, TIER_COUNT);

        // Give every actor a starting position, bought FROM THE CURVE THROUGH THE HANDLER so the
        // handler's curve ghosts (`ghost_expectedReserve` / `ghost_expectedBondingSupply`) account for
        // it exactly as they would mid-run. Without this, whether a run lands any tier op at all
        // depends on the fuzzer first accumulating `T1_WEIGHT` units for one actor, and the per-run
        // non-vacuity gate would be seed-luck. `buy` is bounded to 5 units per call.
        for (uint256 i = 0; i < actors.length; i++) {
            for (uint256 j = 0; j < SEED_UNITS_PER_ACTOR / 5; j++) {
                handler.buy(i, 5 * UNIT);
            }
            assertGe(
                instance.balanceOf(actors[i]),
                uint256(T1_WEIGHT) * UNIT,
                "fixture cannot afford a tier-1 mintUp: the ladder is unreachable from call one"
            );
        }
        // Baseline for the non-vacuity gate: the seeding above must not be able to satisfy it. Fuzz runs
        // all start from this post-setUp state, so a run has to buy PAST this number itself.
        seedBuyCount = handler.ghost_buyCount();
        assertEq(handler.ghost_tierOpCount(), 0, "setUp must not perform tier ops - it would pre-satisfy the gate");

        targetContract(address(handler));
    }

    function _ladder() internal pure returns (ERC404BondingStorage.TierBand[] memory bands) {
        bands = new ERC404BondingStorage.TierBand[](TIER_COUNT);
        bands[0] = ERC404BondingStorage.TierBand({ idStart: T1_START, idEnd: T1_END, weight: T1_WEIGHT });
        bands[1] = ERC404BondingStorage.TierBand({ idStart: T2_START, idEnd: T2_END, weight: T2_WEIGHT });
    }

    /// @dev Not `view`: `vm.expectRevert` is a state-touching cheatcode.
    function _assertLadderSealed() internal {
        (uint32 s1, uint32 e1, uint32 w1) = instance.tierBands(0);
        assertEq(s1, T1_START, "setUp is vacuous: tier-1 idStart never sealed");
        assertEq(e1, T1_END, "setUp is vacuous: tier-1 idEnd never sealed");
        assertEq(w1, T1_WEIGHT, "setUp is vacuous: tier-1 weight never sealed");
        (uint32 s2, uint32 e2, uint32 w2) = instance.tierBands(1);
        assertEq(s2, T2_START, "setUp is vacuous: tier-2 idStart never sealed");
        assertEq(e2, T2_END, "setUp is vacuous: tier-2 idEnd never sealed");
        assertEq(w2, T2_WEIGHT, "setUp is vacuous: tier-2 weight never sealed");
        // `tierBands` has no public length getter; a third band would mean the ladder is not the one
        // asserted above, and `bandOutstanding` is the view that reveals the real length. `TIER_COUNT + 1`
        // is written as a literal so the argument is a uint8 without a truncating cast.
        vm.expectRevert();
        instance.bandOutstanding(3);
        assertEq(instance.bandNextFree(0), T1_START, "tier-1 high-water cursor not initialized to idStart");
        assertEq(instance.bandNextFree(1), T2_START, "tier-2 high-water cursor not initialized to idStart");
        assertEq(instance.bandOutstanding(1), 0, "tier-1 band outstanding before any mintUp");
        assertEq(instance.bandOutstanding(2), 0, "tier-2 band outstanding before any mintUp");
        assertEq(instance.totalTierEscrow(), 0, "escrow before any mintUp");
    }

    // ── Invariant 1: reserve == address(instance).balance during active bonding ──
    // Bonding fees are sent to protocolTreasury immediately, so the contract's
    // ETH balance should always equal the tracked reserve.

    function invariant_reserveEqualsBalance() public view {
        if (instance.graduated()) return;
        assertEq(
            instance.reserve(), address(instance).balance, "reserve != address(this).balance during active bonding"
        );
    }

    // ── Invariant 2: totalBondingSupply <= maxSupply - liquidityReserve - freeMintAllocation * unit ──

    function invariant_bondingSupplyWithinCap() public view {
        uint256 cap =
            instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * instance.unit());
        assertLe(instance.totalBondingSupply(), cap, "totalBondingSupply exceeds bonding cap");
    }

    // ── Invariant 3: calculateRefund(supply, amount) <= calculateCost(supply - amount, amount) ──
    // Selling should never yield more ETH than what buying would cost at the same supply range.
    // Both use the same integral bounds, so with consistent rounding this should be exact equality,
    // but we assert <= to catch any rounding-direction bug that creates arbitrage.

    function invariant_noRoundingArbitrage() public view {
        uint256 supply = instance.totalBondingSupply();
        if (supply == 0) return;

        // Test at the current supply: selling `supply` tokens should refund <= buying them would cost
        // We test with a 1-unit chunk at the current supply level
        uint256 unit_ = instance.unit();
        if (supply < unit_) return;

        uint256 refund = BondingCurveMath.calculateRefund(curveParams, supply, unit_);
        uint256 cost = BondingCurveMath.calculateCost(curveParams, supply - unit_, unit_);

        assertLe(refund, cost, "refund exceeds cost at same supply range - rounding arbitrage possible");
    }

    // ── Invariant 4: reserve == calculateCost(0, totalBondingSupply) — the telescoping integral ──
    // Inv1 (reserve == balance) proves fees left the contract; it does NOT prove the reserve tracks
    // the curve integral over an op-SEQUENCE. Each buy does `reserve += calculateCost(s, a)` =
    // F(s+a) - F(s); each sell does `reserve -= calculateRefund(s, a)` = F(s) - F(s-a), where F is
    // the deterministic pure integral-from-zero. A telescoping sum over any buy/sell interleaving
    // collapses to F(totalBondingSupply) - F(0) = calculateCost(0, totalBondingSupply), with zero
    // cumulative rounding drift — because every intermediate F(s) is evaluated identically on the way
    // up and down. This invariant pins that exact-reserve claim (spec §4.1) that Inv1 leaves untested.
    //
    // noesis-152: this is now the strongest claim in the repo evaluated across TIER interleavings. It is
    // exact, with zero tolerance, and it stays that way — a tolerance or a tier-instance early-return
    // here would delete the only reason the ladder was sealed onto this fixture.

    function invariant_reserveEqualsCurveIntegral() public view {
        if (instance.graduated()) return;
        assertEq(
            instance.reserve(),
            BondingCurveMath.calculateCost(curveParams, 0, instance.totalBondingSupply()),
            "reserve != F(totalBondingSupply) - cumulative curve-integral drift"
        );
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  Token Tiers invariants (noesis-152) — asserted alongside the four above, after EVERY    │
    // │  handler call. Each one names what breaking it would MEAN.                               │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @notice CURVE ISOLATION ACROSS A SEQUENCE. `reserve` and `totalBondingSupply` are perturbed ONLY
    ///         by `buy`/`sell` — never by a tier op, in any interleaving.
    /// @dev The expectations are accumulated by the handler from its OWN pre-computed cost/refund and its
    ///      own bounded amount, so this is independent of the code under test rather than a re-derivation
    ///      of it. This is the stateful version of `TokenTierOps.test_fuzz_curveCountersAreUntouchedByTierOps`,
    ///      whose weakness is that it does its single buy BEFORE the tier loop and never returns to the
    ///      curve afterwards.
    /// @dev BREAKING IT MEANS: the tier surface can reach the curve — escrow could be minted out of the
    ///      curve's own tokens, or a tier op could move the reserve backing every holder's sell.
    function invariant_tierOpsNeverMoveTheCurve() public view {
        assertEq(handler.ghost_curvePerturbedByTierOp(), 0, "a tier op moved reserve or totalBondingSupply");
        assertEq(instance.reserve(), handler.ghost_expectedReserve(), "reserve drifted from the buy/sell legs alone");
        assertEq(
            instance.totalBondingSupply(),
            handler.ghost_expectedBondingSupply(),
            "totalBondingSupply drifted from the buy/sell legs alone"
        );
    }

    /// @notice ESCROW SOLVENCY. The instance's own coin balance always covers both escrow liabilities.
    /// @dev BREAKING IT MEANS: `claimReleasedEscrow`'s solvency revert (`EscrowReleaseFailed`) is
    ///      REACHABLE in production and holders cannot claim coin that is theirs.
    function invariant_escrowIsSolvent() public view {
        assertGe(
            instance.balanceOf(address(instance)),
            instance.totalTierEscrow() + instance.totalPendingEscrowRelease(),
            "instance balance does not cover totalTierEscrow + totalPendingEscrowRelease"
        );
    }

    /// @notice `totalTierEscrow` always equals the escrow derivable from the OUTSTANDING band ids.
    /// @dev Stateful version of `TokenTierOps.test_totalTierEscrowMatchesOutstandingBands`.
    /// @dev BREAKING IT MEANS: the counter and the ids disagree — either escrow is claimed by a counter
    ///      no band backs (a sweep could take holders' coin) or a band exists whose escrow is untracked.
    function invariant_tierEscrowMatchesOutstandingBands() public view {
        uint256 derived = instance.bandOutstanding(1) * (uint256(T1_WEIGHT) - 1) * UNIT + instance.bandOutstanding(2)
            * (uint256(T2_WEIGHT) - 1) * UNIT;
        assertEq(instance.totalTierEscrow(), derived, "totalTierEscrow != escrow derived from outstanding bands");
    }

    /// @notice §5.3 GLOBAL WEIGHT INVARIANT: `Σ_N (outstanding_N · w_N) <= S`.
    /// @dev The design spike calls this STRUCTURAL — band ids live above `idLimit`, so the auto-mint
    ///      queue can never emit one, and every outstanding band is backed by `w_N` units of real coin.
    ///      Asserted anyway: a future change to `_wrapNFTId`'s bounds or to band sizing cannot then break
    ///      §5.3 silently.
    /// @dev BREAKING IT MEANS: more denominated coin exists than there is coin.
    function invariant_globalWeightWithinSupply() public view {
        uint256 weighted =
            instance.bandOutstanding(1) * uint256(T1_WEIGHT) + instance.bandOutstanding(2) * uint256(T2_WEIGHT);
        assertLe(weighted, ID_LIMIT, "sum of outstanding band weights exceeds the total unit supply S");
    }

    /// @notice ESCROW REDEMPTION NEVER FAILS. A holder who owns a band can always `mintDown` it, and a
    ///         holder with a credit can always claim it.
    /// @dev The handler counts a failure only AFTER it has read the enabling state on-chain (live
    ///      ownership of that band id / a non-zero credit), and it never reenters — so no legitimate
    ///      rejection is left. Counted rather than asserted in-call because the runner discards
    ///      reverting handler calls (`fail_on_revert = false`), which would swallow the assertion.
    /// @dev BREAKING IT MEANS: escrowed coin is stuck. That is the whole failure class T3 exists to
    ///      prevent, reached here through a SEQUENCE rather than a single call.
    function invariant_escrowRedemptionAlwaysSucceeds() public view {
        assertEq(handler.ghost_mintDownFailures(), 0, "a band owner could not mintDown their own band");
        assertEq(handler.ghost_claimFailures(), 0, "a holder with a pending credit could not claim it");
    }

    /// @notice ERC20 supply is wholly accounted for by the fixture's KNOWN buckets.
    /// @dev The cheap per-call skeleton of coin conservation (plain `balanceOf` reads). The exact
    ///      identity — the one that splits the instance's balance into escrow / pending / unescrowed and
    ///      credits each holder's band escrow via `coinBalanceOf` — is O(ownedLength) per actor and runs
    ///      in `afterInvariant`, once per completed run, for cost reasons stated there.
    /// @dev BREAKING IT MEANS: coin left the fixture's closed system — minted or burned by a tier op.
    function invariant_erc20SupplyIsAccountedFor() public view {
        uint256 sum = instance.balanceOf(address(instance)) + instance.balanceOf(mockLiquidityDeployer)
            + instance.balanceOf(address(handler));
        for (uint256 i = 0; i < actors.length; i++) {
            sum += instance.balanceOf(actors[i]);
        }
        assertEq(sum, instance.totalSupply(), "ERC20 supply escaped the fixture's known buckets");
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  End of run: non-vacuity + the identities that are too expensive per call                │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @dev Runs once at the end of EVERY fuzz run (all 256 of them), after the whole call sequence.
    ///      Two jobs:
    ///
    ///      (1) NON-VACUITY. Without this, every invariant this item adds passes vacuously the moment a
    ///          handler guard silently rejects every tier call — which is the single most likely way the
    ///          work ships green and worthless. A run that never landed a tier
    ///          op tested nothing about tiers.
    ///
    ///      (2) The EXACT identities, which walk each actor's `owned` array (`coinBalanceOf` is
    ///          O(ownedLength × bandCount)) or the band id space. At ~128k handler calls per campaign
    ///          those are far too expensive to assert after every call; asserting them at the end of
    ///          every run still checks all 256 fuzzer-built end states, and the cheap per-call
    ///          invariants above cover the same ground continuously in weaker form.
    ///
    ///      The non-vacuity half is conditional on the run BEING a sequence, and that condition is
    ///      load-bearing rather than a hedge: when any invariant fails, forge persists the MINIMIZED
    ///      sequence (`cache/invariant/failures/…`) and replays it ahead of fuzzing on every later run —
    ///      frequently a single call. An unconditional "this run landed a tier op" would then fire on that
    ///      one-call replay and REPORT ITSELF INSTEAD OF THE INVARIANT THAT ACTUALLY BROKE, hiding a
    ///      money-code finding behind a vacuity message (and keeping every later local run red). A shrunk
    ///      replay is not a run the fuzzer completed. The exact identities are deliberately NOT
    ///      conditional — they must hold after any sequence, one call or five hundred.
    function afterInvariant() public view {
        if (handler.ghost_calls() >= NONVACUITY_MIN_CALLS) {
            assertGt(handler.ghost_buyCount(), seedBuyCount, "vacuous run: the run itself never bought the curve");
            assertGt(handler.ghost_tierOpCount(), 0, "vacuous run: the fuzzer never landed a single tier op");
        }
        _assertCoinConservedExactly();
        _assertReservedIdSpaceIntact();
    }

    /// @notice COIN CONSERVATION over the handler's full actor set, in the exact shape T2/T3 use
    ///         (`TokenTierOps._assertCoinConserved`), including T3's third bucket:
    ///
    ///             Σ_actors (coinBalanceOf + pendingEscrowRelease) + instanceUnescrowed
    ///                 + module-held balance  ==  totalSupply
    ///
    ///         with `instanceUnescrowed = balanceOf(instance) - totalTierEscrow - totalPendingEscrowRelease`.
    /// @dev EXACT, not an inequality: `setUp` asserts that staking is not wired, no free-mint allocation
    ///      exists and the instance has not graduated, so there is no other bucket coin can sit in. The
    ///      liquidity deployer and the handler are summed/asserted anyway so a future change cannot turn
    ///      the identity silently wrong.
    /// @dev BREAKING IT MEANS: escrow was created or destroyed rather than moved.
    function _assertCoinConservedExactly() internal view {
        assertEq(instance.balanceOf(address(handler)), 0, "the handler holds coin: an unaccounted bucket");
        assertEq(instance.balanceOf(owner), 0, "the owner holds coin: an unaccounted bucket");
        assertEq(instance.balanceOf(protocolTreasury), 0, "the treasury holds coin: an unaccounted bucket");

        uint256 instanceUnescrowed =
            instance.balanceOf(address(instance)) - instance.totalTierEscrow() - instance.totalPendingEscrowRelease();
        uint256 sum = instanceUnescrowed + instance.balanceOf(mockLiquidityDeployer);
        uint256 escrowBehindActorBands;
        for (uint256 i = 0; i < actors.length; i++) {
            uint256 coin = instance.coinBalanceOf(actors[i]);
            sum += coin + instance.pendingEscrowRelease(actors[i]);
            // `coinBalanceOf - balanceOf` is exactly the escrow behind the bands this actor owns.
            escrowBehindActorBands += coin - instance.balanceOf(actors[i]);
        }
        assertEq(sum, instance.totalSupply(), "coin conservation broken");
        // Every unit of outstanding escrow is behind a band an ACTOR owns — no escrow is stranded behind
        // a band nobody holds (which is the orphan T3's hook exists to prevent, in sequence form).
        assertEq(
            escrowBehindActorBands, instance.totalTierEscrow(), "outstanding escrow that no actor's band accounts for"
        );
    }

    /// @notice RESERVED IDS STAY UNBUYABLE. A band id can only ever be owned because `mintUp` issued it.
    /// @dev Stateful version of `TokenTierOps.test_autoMintNeverEmitsABandId`, and the on-chain half of
    ///      §5.6. Two claims per tier: every id at or above the band's high-water cursor was NEVER issued
    ///      and must therefore be unowned; and the number of owned ids inside the issued window equals
    ///      `bandOutstanding` (which also pins that exactly the `bandFreed` ids in that window are free).
    ///      Ownership is read live, so a band burned mid-sequence counts as returned here.
    /// @dev BREAKING IT MEANS: DN404's auto-mint queue handed a reserved, escrow-bearing id to an
    ///      ordinary buyer who never funded its escrow.
    function _assertReservedIdSpaceIntact() internal view {
        // `t` is a uint8 so the 1-based tier number reaches `bandOutstanding` without a truncating cast.
        for (uint8 t = 1; t <= TIER_COUNT; t++) {
            (uint32 idStart, uint32 idEnd,) = instance.tierBands(t - 1);
            uint256 cursor = instance.bandNextFree(t - 1);
            uint256 ownedInWindow;
            for (uint256 id = idStart; id < cursor; id++) {
                address who = _ownerOrZero(id);
                if (who == address(0)) continue;
                assertTrue(handler.isActor(who), "a band id is held by an address no mintUp gave it to");
                ownedInWindow++;
            }
            assertEq(ownedInWindow, instance.bandOutstanding(t), "bandOutstanding != live band ownership");
            for (uint256 id = cursor; id <= idEnd; id++) {
                assertEq(_ownerOrZero(id), address(0), "a NEVER-ISSUED band id is owned: a reserved id was reachable");
            }
        }
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  Deterministic control: the retuned fixture really admits the whole ladder cycle         │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @notice Seed-independent proof that every tier op the handler drives is POSSIBLE here: mintUp on
    ///         both rungs, mintDown, a band burned by an ordinary curve sell, and the escrow claim.
    /// @dev The `afterInvariant` gate proves the FUZZER landed tier ops in each run it completed; this
    ///      proves the FIXTURE admits them at all, with no dependence on a seed. A future retune of the
    ///      supply/unit pair that quietly makes the ladder unusable reds here instead of going green on
    ///      an empty ladder.
    function test_fixtureAdmitsTheWholeTierCycle() public {
        // ── Top rung: mintUp / mintDown on an actor funded up to weight 100 ──
        address a = actors[0];
        for (uint256 i = 0; i < 20; i++) {
            handler.buy(0, 5 * UNIT);
        }
        uint256 heldUnits = instance.balanceOf(a) / UNIT;
        assertGe(heldUnits, T2_WEIGHT, "fixture cannot fund a tier-2 mintUp");

        uint256 reserveBefore = instance.reserve();
        uint256 supplyBefore = instance.totalBondingSupply();

        // Resolve the id BEFORE the prank: `_lowestOrdinaryIdOf` makes `ownerOf` staticcalls, and a prank
        // set first would be consumed by the first of them instead of by `mintUp`.
        uint256 idA = _lowestOrdinaryIdOf(a);
        vm.prank(a);
        instance.mintUp(2, idA);
        assertEq(instance.bandOutstanding(2), 1, "tier-2 band not issued");
        assertEq(instance.ownerOf(T2_START), a, "the first tier-2 id goes to the caller");
        assertEq(instance.totalTierEscrow(), (uint256(T2_WEIGHT) - 1) * UNIT, "tier-2 escrow");
        assertEq(instance.balanceOf(a), (heldUnits - (T2_WEIGHT - 1)) * UNIT, "liquid balance after escrow");
        assertEq(instance.coinBalanceOf(a), heldUnits * UNIT, "true holdings unchanged by a denomination swap");
        assertEq(instance.reserve(), reserveBefore, "mintUp moved reserve");
        assertEq(instance.totalBondingSupply(), supplyBefore, "mintUp moved totalBondingSupply");

        vm.prank(a);
        instance.mintDown(T2_START);
        assertEq(instance.bandOutstanding(2), 0, "tier-2 id not returned");
        assertEq(instance.totalTierEscrow(), 0, "escrow not released");
        assertEq(instance.balanceOf(a), heldUnits * UNIT, "escrow did not come back liquid");

        // ── Bottom rung on a SECOND actor: band burned by an ordinary curve sell, then claimed ──
        // A fresh actor is used deliberately: its `owned` array is still in mint order, so the lowest
        // ordinary id is index 0 and survives the escrow leg's LIFO tail burn without depending on how
        // the ops above reshuffled actor 0's array.
        address b = actors[1];
        uint256 heldB = instance.balanceOf(b) / UNIT;
        assertGe(heldB, T1_WEIGHT, "fixture cannot fund a tier-1 mintUp");

        uint256 idB = _lowestOrdinaryIdOf(b);
        vm.prank(b);
        instance.mintUp(1, idB);
        assertEq(instance.bandOutstanding(1), 1, "tier-1 band not issued");
        uint256 escrow1 = (uint256(T1_WEIGHT) - 1) * UNIT;
        assertEq(instance.totalTierEscrow(), escrow1, "tier-1 escrow");

        // Sell EVERYTHING liquid to the curve. The curve takes no NFTs, so DN404 reconciles the debit by
        // burning every id this actor holds — the band among them — and the T3 hook credits its escrow.
        handler.sell(1, type(uint256).max);
        assertEq(instance.balanceOf(b), 0, "the sell did not clear the liquid balance");
        assertEq(instance.pendingEscrowRelease(b), escrow1, "the burned band did not credit its escrow");
        assertEq(instance.totalTierEscrow(), 0, "escrow did not move out of the counter");
        assertEq(instance.bandOutstanding(1), 0, "the burned band id did not go back on the free list");

        // ── claim the release: the PULL leg, which must not touch the curve ──
        uint256 reserveAfterSell = instance.reserve();
        uint256 supplyAfterSell = instance.totalBondingSupply();
        vm.prank(b);
        instance.claimReleasedEscrow();
        assertEq(instance.balanceOf(b), escrow1, "the holder was not paid their own escrow");
        assertEq(instance.pendingEscrowRelease(b), 0, "credit not cleared");
        assertEq(instance.reserve(), reserveAfterSell, "the claim moved reserve");
        assertEq(instance.totalBondingSupply(), supplyAfterSell, "the claim moved totalBondingSupply");

        // The exact identities the campaign checks at the end of every run must hold here too.
        _assertCoinConservedExactly();
        _assertReservedIdSpaceIntact();
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _ownerOrZero(uint256 id) internal view returns (address who) {
        try instance.ownerOf(id) returns (address o) {
            who = o;
        } catch {
            who = address(0);
        }
    }

    /// @dev The holder's LOWEST ordinary id — the cheapest proxy for a LOW index in `owned[holder]`,
    ///      which is what survives `mintUp`'s escrow leg (that leg burns NFTs LIFO off the TAIL, and an
    ///      id caught by the burn reverts the whole call).
    function _lowestOrdinaryIdOf(address holder) internal view returns (uint256) {
        for (uint256 id = 1; id <= ID_LIMIT; id++) {
            if (_ownerOrZero(id) == holder) return id;
        }
        return 0;
    }
}
