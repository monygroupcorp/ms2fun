// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SeedSepoliaShared } from "../../script/SeedSepoliaShared.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

/// @dev The seed base is abstract only because the two phase scripts are its concrete users; nothing
///      in it is unimplemented. This exposes the wave-3 venue post-conditions to a test.
contract VenueAssertHarness is SeedSepoliaShared {
    function assertVenue(VenueFacts calldata f) external pure {
        _assertVenueShowcase(f);
    }

    function assertStream(StreamFacts calldata f) external pure {
        _assertStakingStream(f);
    }

    function zammPoolId(address token, uint256 feeOrHook) external pure returns (uint256) {
        return _zammPoolId(_zammVenueKey(token, feeOrHook));
    }

    function minVenueLiquidity() external pure returns (uint128) {
        return MIN_VENUE_ACTIVE_LIQUIDITY;
    }

    function referenceReadyAt(address pool, uint32 window) external view returns (uint256) {
        return _v3ReferenceReadyAt(pool, window);
    }
}

/// @dev A Uniswap V3 observation ring, only as much of one as the readiness derivation reads. It is
///      set up by hand rather than by running a pool, so a test can place the oldest observation
///      where the derivation has to go looking for it instead of where it happens to land.
contract ObservationRingStub {
    struct Observation {
        uint32 blockTimestamp;
        int56 tickCumulative;
        uint160 secondsPerLiquidityCumulativeX128;
        bool initialized;
    }

    uint16 public index;
    uint16 public cardinality;

    mapping(uint256 => Observation) internal _obs;

    function set(uint16 i, uint16 c) external {
        index = i;
        cardinality = c;
    }

    function write(uint256 slot, uint32 ts, bool initialized) external {
        _obs[slot] = Observation(ts, 0, 0, initialized);
    }

    function observations(uint256 slot) external view returns (uint32, int56, uint160, bool) {
        Observation memory o = _obs[slot];
        return (o.blockTimestamp, o.tickCumulative, o.secondsPerLiquidityCumulativeX128, o.initialized);
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (0, 0, index, cardinality, 0, 0, true);
    }
}

/// @notice THE VACUITY CHECK FOR THE SEPOLIA SHOWCASE'S VENUES AND ITS STAKING STREAM.
///
///         Phase 2 reports a venue as live only after asserting, on-chain, that its route, its
///         reference pool, its depth and its convert are all real. Those four are independent — none
///         of them reads the others — and each one is a way a venue silently is not one:
///
///           · a vault LPing somewhere the registry curates as something else;
///           · a floor with no pinned price authority behind it;
///           · a pool whose deposit figure is real and whose ACTIVE depth is zero, because the
///             position was minted outside the current tick range;
///           · a "venue" that was configured and never executed anything.
///
///         So this suite states the negative space of each: it removes exactly one of those facts and
///         requires the predicate to go RED. The `passesOn...` cases are the other half — without
///         them the red cases would also be satisfied by a predicate that always reverts.
contract SepoliaShowcaseVenuesTest is Test {
    VenueAssertHarness internal h;

    uint256 internal constant NOW_TS = 1_000_000;
    address internal constant TOKEN = address(0xA11CE);
    address internal constant VAULT_VALIDATOR = address(0xBEEF);
    address internal constant REFERENCE_POOL = address(0xC0FFEE);
    uint256 internal constant TARGET_ID = 7;
    uint32 internal constant WINDOW = 1800;

    function setUp() public {
        h = new VenueAssertHarness();
    }

    // ═══════════════════════ The venue ═══════════════════════

    function _healthyVenue() internal view returns (SeedSepoliaShared.VenueFacts memory f) {
        f = SeedSepoliaShared.VenueFacts({
            label: "uni-v4 (fixture)",
            routeVenue: uint8(IAlignmentRegistry.Venue.UNI_V4),
            expectedVenue: uint8(IAlignmentRegistry.Venue.UNI_V4),
            referencePool: REFERENCE_POOL,
            referenceWindow: WINDOW,
            expectedWindow: WINDOW,
            vaultToken: TOKEN,
            expectedToken: TOKEN,
            vaultTargetId: TARGET_ID,
            expectedTargetId: TARGET_ID,
            vaultPriceValidator: VAULT_VALIDATOR,
            venueLiquidity: uint256(h.minVenueLiquidity()) * 10,
            minVenueLiquidity: h.minVenueLiquidity(),
            pendingBefore: 1 ether,
            pendingAfter: 0,
            lpPositionValue: 0.9 ether
        });
    }

    function test_passesOnALiveVenue() public view {
        h.assertVenue(_healthyVenue());
    }

    /// @dev The divergence the acquire route exists to close: the registry curates one venue and the
    ///      vault LPs on another. Legal on the Uniswap families — nothing on-chain refuses it — which
    ///      is exactly why the seed has to.
    function test_redWhenTheRouteNamesAnotherVenue() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.routeVenue = uint8(IAlignmentRegistry.Venue.ZAMM);
        vm.expectRevert(bytes("venue: uni-v4 (fixture) route is not the venue it LPs on"));
        h.assertVenue(f);
    }

    /// @dev An unset route reads as `Venue.NONE`. A predicate that accepted NONE as "expected" would
    ///      pass on a target nobody has curated at all.
    function test_redWhenTheRouteIsUnset() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.routeVenue = uint8(IAlignmentRegistry.Venue.NONE);
        vm.expectRevert(bytes("venue: uni-v4 (fixture) route is not the venue it LPs on"));
        h.assertVenue(f);
    }

    /// @dev And the mirror: an assertion that EXPECTED `NONE` would be satisfied by every unset
    ///      target on the deployment, which is the vacuous shape this whole suite is written against.
    function test_redWhenTheExpectationItselfIsNone() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.routeVenue = uint8(IAlignmentRegistry.Venue.NONE);
        f.expectedVenue = uint8(IAlignmentRegistry.Venue.NONE);
        vm.expectRevert(bytes("venue: the expected venue is NONE (the assertion would say nothing)"));
        h.assertVenue(f);
    }

    function test_redWhenNoReferencePoolIsPinned() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.referencePool = address(0);
        vm.expectRevert(bytes("venue: uni-v4 (fixture) has no pinned reference pool"));
        h.assertVenue(f);
    }

    /// @dev A reference pinned at a window the validator does not price with is a floor derived from
    ///      a different number than the one the registry probed.
    function test_redWhenTheReferenceWindowDrifted() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.referenceWindow = WINDOW / 2;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) reference window is not the deployment's TWAP window"));
        h.assertVenue(f);
    }

    function test_redWhenTheVaultHoldsAnotherAsset() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.vaultToken = address(0xDEAD);
        vm.expectRevert(bytes("venue: uni-v4 (fixture) vault holds another asset"));
        h.assertVenue(f);
    }

    function test_redWhenTheVaultSitsOnAnotherTarget() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.vaultTargetId = TARGET_ID + 1;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) vault sits on another target"));
        h.assertVenue(f);
    }

    function test_redWhenTheVaultHasNoPriceValidator() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.vaultPriceValidator = address(0);
        vm.expectRevert(bytes("venue: uni-v4 (fixture) vault has no price validator"));
        h.assertVenue(f);
    }

    /// @dev THE ONE A DEPOSIT FIGURE CANNOT STAND IN FOR. A position minted outside the current tick
    ///      range reports liquidity units and contributes none of the depth a swap walks through, so
    ///      the seed reads the pool's ACTIVE liquidity back and this is what that read is for.
    function test_redWhenThePoolCarriesNoActiveDepth() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.venueLiquidity = 0;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) pool is too thin to serve a convert inside the floor"));
        h.assertVenue(f);
    }

    function test_redWhenTheVaultHeldNoTithe() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.pendingBefore = 0;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) vault held no tithe to convert"));
        h.assertVenue(f);
    }

    /// @dev Drop the convert and everything else still reads healthy: the route is curated, the
    ///      reference is pinned, the pool is deep and the vault is bound. This row is what separates a
    ///      configured venue from a venue that has done its job.
    function test_redWhenTheConvertNeverRan() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.pendingAfter = f.pendingBefore;
        f.lpPositionValue = 0;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) convert consumed none of the tithe"));
        h.assertVenue(f);
    }

    function test_redWhenTheConvertReportedNoPosition() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.lpPositionValue = 0;
        vm.expectRevert(bytes("venue: uni-v4 (fixture) convert reported no LP position"));
        h.assertVenue(f);
    }

    /// @dev The Cypher row is the leg the acceptance asks to be vacuity-checked by name, and it is the
    ///      same predicate under a different expectation — which is the point: one venue check, four
    ///      independent facts, and no per-venue special case that could be true by construction.
    function test_passesOnALiveCypherVenue() public view {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.label = "cypher (fixture)";
        f.routeVenue = uint8(IAlignmentRegistry.Venue.ALGEBRA);
        f.expectedVenue = uint8(IAlignmentRegistry.Venue.ALGEBRA);
        h.assertVenue(f);
    }

    /// @dev Removing the PLUGIN wiring from a Cypher pool is what makes it unusable as a price
    ///      authority: the validator's Algebra branch reads the TWAP off `pool.plugin()`, so a pool
    ///      with no plugin cannot be pinned and the pin therefore cannot be present. That surfaces
    ///      here as an unpinnable reference, which is the same red this predicate already states.
    function test_redWhenTheCypherPoolCouldNotBePinned() public {
        SeedSepoliaShared.VenueFacts memory f = _healthyVenue();
        f.label = "cypher (fixture)";
        f.routeVenue = uint8(IAlignmentRegistry.Venue.ALGEBRA);
        f.expectedVenue = uint8(IAlignmentRegistry.Venue.ALGEBRA);
        f.referencePool = address(0);
        vm.expectRevert(bytes("venue: cypher (fixture) has no pinned reference pool"));
        h.assertVenue(f);
    }

    // ═══════════════════════ The staking stream ═══════════════════════

    function _healthyStream() internal pure returns (SeedSepoliaShared.StreamFacts memory f) {
        f = SeedSepoliaShared.StreamFacts({
            feeDelta: 1e12, rewardRate: 1_000_000, periodFinish: NOW_TS + 7 days, totalStaked: 5e18, nowTs: NOW_TS
        });
    }

    function test_passesOnARunningStream() public view {
        h.assertStream(_healthyStream());
    }

    /// @dev THE HONESTY ROW. Without it, the remaining three checks pass on a stream started by any
    ///      ETH from anywhere — including ETH pushed at the module from a fixture, which is exactly
    ///      the shape the earlier wave declined to ship. Requiring a non-zero CLAIMED delta is what
    ///      ties the stream to a fee the vault's own position actually earned.
    function test_redWhenNoFeeDeltaWasClaimed() public {
        SeedSepoliaShared.StreamFacts memory f = _healthyStream();
        f.feeDelta = 0;
        vm.expectRevert(bytes("stream: no fee delta arrived - the stream would have no earned source"));
        h.assertStream(f);
    }

    function test_redWhenNothingIsStaked() public {
        SeedSepoliaShared.StreamFacts memory f = _healthyStream();
        f.totalStaked = 0;
        vm.expectRevert(bytes("stream: nothing is staked (a stream nobody can accrue is not running)"));
        h.assertStream(f);
    }

    function test_redWhenTheModuleRecordsNoRate() public {
        SeedSepoliaShared.StreamFacts memory f = _healthyStream();
        f.rewardRate = 0;
        vm.expectRevert(bytes("stream: the module records no per-second rate"));
        h.assertStream(f);
    }

    /// @dev A stream whose period has already closed is a stream that ran, not one that is running —
    ///      and the restart cadence is an operational fact rather than something a seed can assert away.
    function test_redWhenTheRewardPeriodHasClosed() public {
        SeedSepoliaShared.StreamFacts memory f = _healthyStream();
        f.periodFinish = NOW_TS - 1;
        vm.expectRevert(bytes("stream: the reward period has already finished"));
        h.assertStream(f);
    }

    // ═══════════════════════ The ZAMM pool identity ═══════════════════════

    /// @dev The seed reads a ZAMM pool's reserves back by an id it derives itself, so that derivation
    ///      has to be the vault's. `ZAMMAlignmentVault` computes `keccak256(abi.encode(key))`; if the
    ///      two ever diverge the seed would check the depth of a pool the vault never touches.
    function test_zammPoolIdMatchesTheVaultsOwnDerivation() public view {
        uint256 feeOrHook = 30;
        uint256 expected = uint256(
            keccak256(
                abi.encode(
                    IZAMMKey.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: TOKEN, feeOrHook: feeOrHook })
                )
            )
        );
        assertEq(h.zammPoolId(TOKEN, feeOrHook), expected, "zamm pool id derivation drifted from the vault's");
    }

    // ═══════════════════ When a reference pool can be pinned ═══════════════════

    /// @dev Phase 2 may pin a reference pool only once the pool can answer a window-long TWAP, and
    ///      `observe` decides that against the OLDEST observation the pool still holds. Phase 1 cannot
    ///      compute the instant — it is simulated at one timestamp and broadcast afterwards, so the
    ///      pool is written later than any number phase 1 could record — which is why the derivation
    ///      reads the pool instead. These three cases pin that it reads the right slot.

    /// @dev Before the ring has wrapped, the oldest observation is slot 0 and slot `index + 1` is
    ///      uninitialized. Reading `index + 1` blindly would take a zero timestamp and declare the
    ///      pool ready a full window before it is.
    function test_referenceReadyAtWalksBackToSlotZeroBeforeTheRingWraps() public {
        ObservationRingStub pool = new ObservationRingStub();
        pool.set(0, 1);
        pool.write(0, 1_000_000, true);
        pool.write(1, 0, false); // not yet written

        assertEq(h.referenceReadyAt(address(pool), 1800), 1_000_000 + 1800, "readiness is oldest + window");
    }

    /// @dev Once the ring has wrapped, the oldest observation is the one AFTER the newest. Reading
    ///      slot 0 here would hold the pool back long after it could serve the window.
    function test_referenceReadyAtReadsTheOldestSlotOnceTheRingHasWrapped() public {
        ObservationRingStub pool = new ObservationRingStub();
        pool.set(1, 4); // newest at 1, so oldest at 2
        pool.write(0, 5_000, true);
        pool.write(1, 9_000, true); // newest
        pool.write(2, 6_000, true); // oldest still held
        pool.write(3, 7_000, true);

        assertEq(h.referenceReadyAt(address(pool), 1800), 6_000 + 1800, "readiness must follow the ring, not slot 0");
    }

    /// @dev The window is not baked in: it is the deployment's own, read off the validator, so a
    ///      deployment configured with a different one moves this instant with it.
    function test_referenceReadyAtCarriesTheWindowItIsGiven() public {
        ObservationRingStub pool = new ObservationRingStub();
        pool.set(0, 1);
        pool.write(0, 1_000_000, true);

        assertEq(h.referenceReadyAt(address(pool), 600), 1_000_600, "a shorter window must be honoured");
        assertEq(h.referenceReadyAt(address(pool), 3600), 1_003_600, "a longer window must be honoured");
    }
}

/// @dev A local restatement of the ZAMM key, so the id test above encodes the struct INDEPENDENTLY of
///      the helper it is checking. Sharing the helper's own type would make the assertion agree with
///      itself by construction.
interface IZAMMKey {
    struct PoolKey {
        uint256 id0;
        uint256 id1;
        address token0;
        address token1;
        uint256 feeOrHook;
    }
}
