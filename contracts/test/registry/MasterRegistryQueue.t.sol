// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { FeaturedQueueManager } from "../../src/master/FeaturedQueueManager.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

// ── Minimal mock registry ──────────────────────────────────────────────────────

contract MockRegistry {
    mapping(address => bool) public registered;
    mapping(address => bool) public revoked;

    function register(address instance) external {
        registered[instance] = true;
    }

    /// @dev Mirrors MasterRegistryV1: a revoked instance is invisible to both registry reads.
    function revoke(address instance) external {
        revoked[instance] = true;
    }

    /// @dev Restores registry liveness. Used to observe whether the featured list still holds an entry
    ///      that was revoked while it was in the list — a lingering entry becomes visible again.
    function unrevoke(address instance) external {
        revoked[instance] = false;
    }

    function isRegisteredInstance(address instance) external view returns (bool) {
        return registered[instance] && !revoked[instance];
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        require(registered[instance] && !revoked[instance], "Not registered");
        info.instance = instance;
    }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

contract MasterRegistryQueueTest is Test {
    FeaturedQueueManager queue;
    MockRegistry registry;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address treasury = makeAddr("treasury");

    /// Relative tolerance for geometric-decay expectations. `powWad` is an exp/ln pair, so the
    /// retained fraction lands within a few wei per 1e18 of the exact real-valued answer; 1e-9 is
    /// far tighter than the gap between the geometric curve and any straight-line one at the
    /// horizons asserted here.
    uint256 constant DECAY_TOL = 1e9; // 1e-9 relative, in WAD

    // Three registered instances
    address inst1 = makeAddr("inst1");
    address inst2 = makeAddr("inst2");
    address inst3 = makeAddr("inst3");

    function setUp() public {
        registry = new MockRegistry();
        registry.register(inst1);
        registry.register(inst2);
        registry.register(inst3);

        queue = new FeaturedQueueManager();
        queue.initialize(address(registry), owner);

        vm.prank(owner);
        queue.setProtocolTreasury(treasury);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function _rentBasic(address instance, address renter, uint256 rankBoost) internal {
        uint256 duration = queue.minDuration();
        uint256 durationCost = queue.quoteDurationCost(duration);
        uint256 total = durationCost + rankBoost;
        vm.deal(renter, renter.balance + total);
        vm.prank(renter);
        queue.rentFeatured{ value: total }(instance, duration, rankBoost);
    }

    // ── rentFeatured ──────────────────────────────────────────────────────────

    function test_rentFeatured_basic() public {
        _rentBasic(inst1, alice, 0);

        (, uint256 effectiveRank, uint256 expiresAt, bool isActive) = queue.getRentalInfo(inst1);
        assertEq(effectiveRank, 0);
        assertGt(expiresAt, block.timestamp);
        assertTrue(isActive);
    }

    function test_rentFeatured_withRankBoost() public {
        _rentBasic(inst1, alice, 0.01 ether);

        (, uint256 effectiveRank,, bool isActive) = queue.getRentalInfo(inst1);
        assertEq(effectiveRank, 0.01 ether);
        assertTrue(isActive);
    }

    function test_rentFeatured_renterRecorded() public {
        _rentBasic(inst1, alice, 0);
        (address renter,,,) = queue.getRentalInfo(inst1);
        assertEq(renter, alice);
    }

    function test_rentFeatured_refundsExcess() public {
        uint256 duration = queue.minDuration();
        uint256 durationCost = queue.quoteDurationCost(duration);
        uint256 rankBoost = 0.005 ether;
        uint256 excess = 0.001 ether;

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        queue.rentFeatured{ value: durationCost + rankBoost + excess }(inst1, duration, rankBoost);

        assertEq(alice.balance, balanceBefore - durationCost - rankBoost);
    }

    function test_rentFeatured_revert_alreadyActive() public {
        _rentBasic(inst1, alice, 0);

        // Pre-compute all values before vm.expectRevert (external calls reset the expectation)
        uint256 duration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(duration);
        vm.deal(bob, bob.balance + cost);

        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.AlreadyFeatured.selector);
        queue.rentFeatured{ value: cost }(inst1, duration, 0);
    }

    function test_rentFeatured_revert_insufficientPayment() public {
        uint256 duration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(duration);

        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.InsufficientPayment.selector);
        queue.rentFeatured{ value: cost - 1 }(inst1, duration, 0);
    }

    function test_rentFeatured_revert_durationTooShort() public {
        uint256 minDur = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(minDur - 1);

        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.InvalidDuration.selector);
        queue.rentFeatured{ value: cost }(inst1, minDur - 1, 0);
    }

    function test_rentFeatured_revert_durationTooLong() public {
        uint256 maxDur = queue.maxDuration();
        uint256 cost = queue.quoteDurationCost(maxDur + 1 days);

        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.InvalidDuration.selector);
        queue.rentFeatured{ value: cost }(inst1, maxDur + 1 days, 0);
    }

    function test_rentFeatured_revert_unregisteredInstance() public {
        address unknown = makeAddr("unknown");
        uint256 duration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(duration);

        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.InstanceNotRegistered.selector);
        queue.rentFeatured{ value: cost }(unknown, duration, 0);
    }

    function test_rentFeatured_incrementsQueueLength() public {
        assertEq(queue.queueLength(), 0);
        _rentBasic(inst1, alice, 0);
        assertEq(queue.queueLength(), 1);
        _rentBasic(inst2, bob, 0);
        assertEq(queue.queueLength(), 2);
    }

    function test_rentFeatured_afterExpiry_allowsRerent() public {
        _rentBasic(inst1, alice, 0);
        (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt + 1);
        _rentBasic(inst1, bob, 0);
        (address renter,,,) = queue.getRentalInfo(inst1);
        assertEq(renter, bob);
    }

    // ── boostRank ─────────────────────────────────────────────────────────────

    function test_boostRank_increasesRank() public {
        _rentBasic(inst1, alice, 0.01 ether);
        (, uint256 rankBefore,,) = queue.getRentalInfo(inst1);

        vm.prank(bob);
        queue.boostRank{ value: 0.005 ether }(inst1);

        (, uint256 rankAfter,,) = queue.getRentalInfo(inst1);
        assertGt(rankAfter, rankBefore);
    }

    function test_boostRank_anyoneCanBoost() public {
        _rentBasic(inst1, alice, 0);

        vm.prank(charlie);
        queue.boostRank{ value: 0.01 ether }(inst1);

        (, uint256 rank,,) = queue.getRentalInfo(inst1);
        assertEq(rank, 0.01 ether);
    }

    function test_boostRank_revert_slotInactive() public {
        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.SlotNotActive.selector);
        queue.boostRank{ value: 0.01 ether }(inst1);
    }

    function test_boostRank_revert_zeroValue() public {
        _rentBasic(inst1, alice, 0);

        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.MustSendETH.selector);
        queue.boostRank{ value: 0 }(inst1);
    }

    function test_boostRank_revert_revokedInstance() public {
        _rentBasic(inst1, alice, 0);
        registry.revoke(inst1);

        vm.deal(bob, bob.balance + 0.01 ether);
        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.InstanceNotRegistered.selector);
        queue.boostRank{ value: 0.01 ether }(inst1);
    }

    /// @dev Control for the guard above: a still-registered instance is admitted on the same call.
    function test_boostRank_liveInstanceStillAdmitted() public {
        _rentBasic(inst1, alice, 0);
        registry.revoke(inst2);

        vm.deal(bob, bob.balance + 0.01 ether);
        vm.prank(bob);
        queue.boostRank{ value: 0.01 ether }(inst1);

        (, uint256 rank,,) = queue.getRentalInfo(inst1);
        assertEq(rank, 0.01 ether);
    }

    // ── renewDuration ─────────────────────────────────────────────────────────

    function test_renewDuration_extendsExpiry() public {
        _rentBasic(inst1, alice, 0);
        (,, uint256 expiresAtBefore,) = queue.getRentalInfo(inst1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(alice, alice.balance + cost);
        vm.prank(alice);
        queue.renewDuration{ value: cost }(inst1, extra);

        (,, uint256 expiresAtAfter,) = queue.getRentalInfo(inst1);
        assertEq(expiresAtAfter, expiresAtBefore + extra);
    }

    function test_renewDuration_doesNotAffectRank() public {
        _rentBasic(inst1, alice, 0.01 ether);
        (, uint256 rankBefore,,) = queue.getRentalInfo(inst1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);
        vm.prank(bob);
        queue.renewDuration{ value: cost }(inst1, extra);

        (, uint256 rankAfter,,) = queue.getRentalInfo(inst1);
        assertEq(rankAfter, rankBefore);
    }

    function test_renewDuration_anyoneCanRenew() public {
        _rentBasic(inst1, alice, 0);
        (,, uint256 expiresAtBefore,) = queue.getRentalInfo(inst1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(charlie, charlie.balance + cost);
        vm.prank(charlie);
        queue.renewDuration{ value: cost }(inst1, extra);

        (,, uint256 expiresAtAfter,) = queue.getRentalInfo(inst1);
        assertGt(expiresAtAfter, expiresAtBefore);
    }

    function test_renewDuration_revert_slotExpired() public {
        _rentBasic(inst1, alice, 0);
        (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt + 1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);

        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.SlotExpired.selector);
        queue.renewDuration{ value: cost }(inst1, extra);
    }

    function test_renewDuration_refundsExcess() public {
        _rentBasic(inst1, alice, 0);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        uint256 excess = 0.002 ether;

        uint256 balBefore = alice.balance;
        vm.deal(alice, alice.balance + cost + excess);
        vm.prank(alice);
        queue.renewDuration{ value: cost + excess }(inst1, extra);

        assertEq(alice.balance, balBefore + excess);
    }

    function test_renewDuration_revert_revokedInstance() public {
        _rentBasic(inst1, alice, 0);
        registry.revoke(inst1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);

        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.InstanceNotRegistered.selector);
        queue.renewDuration{ value: cost }(inst1, extra);
    }

    /// @dev Control for the guard above: a still-registered instance is admitted on the same call.
    function test_renewDuration_liveInstanceStillAdmitted() public {
        _rentBasic(inst1, alice, 0);
        registry.revoke(inst2);
        (,, uint256 expiresAtBefore,) = queue.getRentalInfo(inst1);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);
        vm.prank(bob);
        queue.renewDuration{ value: cost }(inst1, extra);

        (,, uint256 expiresAtAfter,) = queue.getRentalInfo(inst1);
        assertEq(expiresAtAfter, expiresAtBefore + extra);
    }

    // ── renewDuration: total-occupancy ceiling ────────────────────────────────

    /// @dev Rent for exactly `maxDuration`, leaving zero headroom under the ceiling.
    function _rentForMaxDuration(address instance, address renter) internal returns (uint256 maxDur) {
        maxDur = queue.maxDuration();
        uint256 cost = queue.quoteDurationCost(maxDur);
        vm.deal(renter, renter.balance + cost);
        vm.prank(renter);
        queue.rentFeatured{ value: cost }(instance, maxDur, 0);
    }

    /// Renewal is bounded by total occupancy, not only by the size of one increment: a slot already
    /// sitting at the ceiling cannot be extended past it.
    function test_renewDuration_revert_resultExceedsCeiling() public {
        _rentForMaxDuration(inst1, alice);

        uint256 extra = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);

        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.DurationTooLong.selector);
        queue.renewDuration{ value: cost }(inst1, extra);
    }

    /// Control for the guard above: a renewal that lands EXACTLY on the ceiling is still admitted, so
    /// the cap is a boundary rather than a ban on renewal.
    function test_renewDuration_uptoCeilingStillAdmitted() public {
        _rentBasic(inst1, alice, 0);
        uint256 maxDur = queue.maxDuration();
        (,, uint256 expiresAtBefore,) = queue.getRentalInfo(inst1);

        // Largest increment that lands on the ceiling exactly.
        uint256 extra = block.timestamp + maxDur - expiresAtBefore;
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);
        vm.prank(bob);
        queue.renewDuration{ value: cost }(inst1, extra);

        (,, uint256 expiresAtAfter,) = queue.getRentalInfo(inst1);
        assertEq(expiresAtAfter, block.timestamp + maxDur);
    }

    /// One second past the ceiling is refused — pins the boundary against an off-by-one.
    function test_renewDuration_revert_oneSecondPastCeiling() public {
        _rentBasic(inst1, alice, 0);
        uint256 maxDur = queue.maxDuration();
        (,, uint256 expiresAtBefore,) = queue.getRentalInfo(inst1);

        uint256 extra = block.timestamp + maxDur - expiresAtBefore + 1;
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + cost);

        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.DurationTooLong.selector);
        queue.renewDuration{ value: cost }(inst1, extra);
    }

    /// ACCEPTED COST — the dead zone. Increments have a floor (`minDuration`) and the result has a
    /// ceiling (`maxDuration`), so a slot whose remaining life is within `minDuration` of the ceiling
    /// refuses EVERY legal increment. It becomes renewable again once enough time has burned off.
    /// Documented in the `renewDuration` NatSpec; pinned here so it is a decision, not a discovery.
    function test_renewDuration_deadZoneNearCeiling_thenRenewableAgain() public {
        uint256 maxDur = _rentForMaxDuration(inst1, alice);
        uint256 minDur = queue.minDuration();
        // Derive the rental instant from contract state rather than caching `block.timestamp`, which
        // the optimizer may fold across `vm.warp`.
        (,, uint256 expiresAtRented,) = queue.getRentalInfo(inst1);
        uint256 rentedAt = expiresAtRented - maxDur;

        uint256 cost = queue.quoteDurationCost(minDur);
        vm.deal(bob, bob.balance + 10 * cost);

        // One second before the dead zone closes: the smallest legal increment still overshoots.
        vm.warp(rentedAt + minDur - 1);
        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.DurationTooLong.selector);
        queue.renewDuration{ value: cost }(inst1, minDur);

        // Exactly enough time burned off: the same call now lands on the ceiling and succeeds.
        vm.warp(rentedAt + minDur);
        vm.prank(bob);
        queue.renewDuration{ value: cost }(inst1, minDur);

        // The renewal landed exactly on the ceiling: now (rentedAt + minDur) + maxDur.
        (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
        assertEq(expiresAt, rentedAt + minDur + maxDur);
    }

    /// Repeated renewal cannot compound occupancy: whatever the schedule of calls, the slot never
    /// sits further than `maxDuration` ahead of the current block.
    function test_renewDuration_repeatedRenewalCannotCompoundPastCeiling() public {
        _rentBasic(inst1, alice, 0);
        uint256 maxDur = queue.maxDuration();
        uint256 extra = maxDur / 4;
        uint256 cost = queue.quoteDurationCost(extra);
        vm.deal(bob, bob.balance + 20 * cost);

        // Track the clock locally: a cached `block.timestamp` may be folded across `vm.warp`.
        (,, uint256 expiresAtRented,) = queue.getRentalInfo(inst1);
        uint256 nowTs = expiresAtRented - queue.minDuration();

        for (uint256 i = 0; i < 10; i++) {
            vm.prank(bob);
            // A renewal refused at the ceiling is the expected outcome for part of this schedule.
            try queue.renewDuration{ value: cost }(inst1, extra) { } catch { }

            (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
            assertLe(expiresAt, nowTs + maxDur);

            nowTs += 30 days;
            vm.warp(nowTs);
        }
    }

    // ── Rank decay ─────────────────────────────────────────────────────────────

    /// Geometric decay: rank is multiplied by (1 - rate) per elapsed day. The day-5 reading is the
    /// one that separates the two curves — geometric 0.95^5 = 0.7737809375 ether, a straight-line
    /// step on the same rate would read 0.75 ether.
    function test_rankDecay_reducesOverTime() public {
        _rentBasic(inst1, alice, 1 ether);

        (, uint256 rankDay0,,) = queue.getRentalInfo(inst1);
        assertEq(rankDay0, 1 ether);

        vm.warp(block.timestamp + 1 days);
        (, uint256 rankDay1,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankDay1, 0.95 ether, DECAY_TOL);

        vm.warp(block.timestamp + 4 days); // 5 days total
        (, uint256 rankDay5,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankDay5, 0.7737809375 ether, DECAY_TOL);
        // Two-sided: strictly below the previous reading, strictly above the straight-line answer.
        assertLt(rankDay5, rankDay1);
        assertGt(rankDay5, 0.75 ether);
    }

    /// Geometric decay has no finite wipe point: rank asymptotes and stays strictly positive at
    /// horizons where a straight-line curve on the same rate would have crossed zero.
    function test_rankDecay_asymptotesRatherThanHittingZero() public {
        _rentBasic(inst1, alice, 1 ether);

        // Day 20 is exactly 10000/dailyDecayRate days — the straight-line wipe point.
        vm.warp(block.timestamp + 20 days);
        (, uint256 rankDay20,,) = queue.getRentalInfo(inst1);
        assertGt(rankDay20, 0, "rank is still positive at the straight-line wipe horizon");
        assertApproxEqRel(rankDay20, 0.3584859224085422 ether, DECAY_TOL);

        // Still falling, still positive, an order of magnitude further out.
        vm.warp(block.timestamp + 80 days); // 100 days total
        (, uint256 rankDay100,,) = queue.getRentalInfo(inst1);
        assertLt(rankDay100, rankDay20);
        assertGt(rankDay100, 0);
        assertApproxEqRel(rankDay100, 0.005920529220334 ether, DECAY_TOL);
    }

    /// Rank reaches exactly 0 only once the retained fraction underflows the wei resolution of the
    /// stored rank. The read must floor there, not revert.
    function test_rankDecay_floorsAtZero_atExtremeHorizon() public {
        _rentBasic(inst1, alice, 0.001 ether);

        vm.warp(block.timestamp + 1000 days);
        (, uint256 rank,,) = queue.getRentalInfo(inst1);
        assertEq(rank, 0);
        assertEq(queue.getEffectiveRank(inst1), 0);
    }

    function test_rankDecay_crystallizedOnBoost() public {
        _rentBasic(inst1, alice, 1 ether);

        vm.warp(block.timestamp + 3 days);
        (, uint256 rankBeforeBoost,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankBeforeBoost, 0.857375 ether, DECAY_TOL); // 0.95^3

        vm.prank(bob);
        queue.boostRank{ value: 0.5 ether }(inst1);

        (, uint256 rankAfterBoost,,) = queue.getRentalInfo(inst1);
        assertEq(rankAfterBoost, rankBeforeBoost + 0.5 ether);

        // Decay clock reset — one day of geometric decay from the boost time, on the new rank.
        vm.warp(block.timestamp + 1 days);
        (, uint256 rankNextDay,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankNextDay, (rankAfterBoost * 95) / 100, DECAY_TOL);
        assertLt(rankNextDay, rankAfterBoost);
    }

    // ── Rank carry ────────────────────────────────────────────────────────────

    function test_rankCarry_acrossExpiry() public {
        _rentBasic(inst1, alice, 0.5 ether);

        // Warp just past expiry — minDuration + 1 seconds of decay applied
        (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt + 1);

        // Re-rent — carries geometrically decayed rank, evaluated on elapsed seconds. minDuration is
        // 7 days and the warp adds one second: 0.5 ether * 0.95^(7 + 1/86400).
        _rentBasic(inst1, alice, 0);
        (, uint256 rankSecond,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankSecond, 0.34916844075515117 ether, DECAY_TOL);
    }

    function test_rankCarry_acrossDifferentRenters() public {
        _rentBasic(inst1, alice, 0.5 ether);

        // Expire and re-rent by bob
        (,, uint256 expiresAt,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt + 1);

        _rentBasic(inst1, bob, 0);
        (address renter, uint256 rankBob,,) = queue.getRentalInfo(inst1);
        assertEq(renter, bob);
        assertApproxEqRel(rankBob, 0.34916844075515117 ether, DECAY_TOL); // 0.5e * 0.95^(7+1/86400)
    }

    // ── Geometric decay: the curve's core properties ────────────────────────────

    /// A 10× larger boost decays to the SAME FRACTION in the same time — rank size does not buy a
    /// slower burn.
    function test_rankDecay_proportional_sameFractionRegardlessOfSize() public {
        _rentBasic(inst1, alice, 0.1 ether);
        _rentBasic(inst2, bob, 1 ether); // 10× inst1

        vm.warp(block.timestamp + 5 days); // both retain 0.95^5

        (, uint256 rank1,,) = queue.getRentalInfo(inst1);
        (, uint256 rank2,,) = queue.getRentalInfo(inst2);

        assertApproxEqRel(rank1, 0.07737809375 ether, DECAY_TOL);
        assertApproxEqRel(rank2, 0.7737809375 ether, DECAY_TOL);
        // Same fraction: inst2 stays 10× inst1, to within per-read truncation dust.
        assertApproxEqAbs(rank2, rank1 * 10, 10);
    }

    /// THE CADENCE-INDEPENDENCE PROPERTY. Two slots start from the same 10 ETH rank at the same
    /// instant. One is left untouched for 20 days; the other is boosted by dust once a day for the
    /// same 20 days. Under geometric decay both read the same value — 10 ETH * 0.95^20 — because the
    /// retention factor composes: decaying over a + b equals decaying over a, crystallising, then
    /// decaying over b. Under a straight-line-on-current curve the untouched slot reads exactly 0 at
    /// day 20 while the daily-boosted slot reads 3.5848 ETH, so this test separates the two curves at
    /// full amplitude.
    function test_rankDecay_geometric_isCadenceIndependent() public {
        uint256 maxDur = queue.maxDuration();
        uint256 durationCost = queue.quoteDurationCost(maxDur);

        vm.deal(alice, alice.balance + durationCost + 10 ether);
        vm.prank(alice);
        queue.rentFeatured{ value: durationCost + 10 ether }(inst1, maxDur, 10 ether); // untouched

        vm.deal(bob, bob.balance + durationCost + 10 ether);
        vm.prank(bob);
        queue.rentFeatured{ value: durationCost + 10 ether }(inst2, maxDur, 10 ether); // boosted daily

        // Explicit cursor: solc loads block.timestamp once per call frame, so a loop must carry its
        // own clock rather than re-reading it.
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 20; i++) {
            t += 1 days;
            vm.warp(t);
            vm.prank(charlie);
            queue.boostRank{ value: 1 wei }(inst2);
        }

        (, uint256 untouched,,) = queue.getRentalInfo(inst1);
        (, uint256 boostedDaily,,) = queue.getRentalInfo(inst2);

        // Both read 10 ETH * 0.95^20 = 3.584859224085422 ether.
        assertApproxEqRel(untouched, 3.584859224085422 ether, DECAY_TOL);
        assertApproxEqRel(boostedDaily, 3.584859224085422 ether, DECAY_TOL);

        // Same elapsed time, same start, same answer — cadence buys nothing.
        assertApproxEqRel(untouched, boostedDaily, DECAY_TOL);

        // And the untouched slot did NOT fall off a cliff at the straight-line wipe horizon.
        assertGt(untouched, 3.5 ether);

        // Two-sided on the dust: 20 wei of boosts cannot make the recrystallised slot outrun the
        // undisturbed one by any meaningful amount.
        assertApproxEqAbs(boostedDaily, untouched, 1000);
    }

    /// Anti-permanence: a big initial payer is overtaken by a smaller FRESH bid once enough decay
    /// has accrued. Geometric decay takes 1 ETH below 0.3 ETH after ln(0.3)/ln(0.95) ≈ 23.5 days.
    function test_antiPermanence_freshBidderOvertakesBigOldPayer() public {
        uint256 maxDur = queue.maxDuration();
        uint256 durationCost = queue.quoteDurationCost(maxDur);

        // inst1: big early payer, 1 ETH rank
        vm.deal(alice, alice.balance + durationCost + 1 ether);
        vm.prank(alice);
        queue.rentFeatured{ value: durationCost + 1 ether }(inst1, maxDur, 1 ether);

        // 30 days pass: inst1 decays to 1e * 0.95^30 = 0.2146387639429376 ether
        vm.warp(block.timestamp + 30 days);
        (, uint256 inst1Decayed,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(inst1Decayed, 0.2146387639429376 ether, DECAY_TOL);
        assertLt(inst1Decayed, 0.3 ether);

        // inst2: a much smaller FRESH bid of 0.3 ETH
        vm.deal(bob, bob.balance + durationCost + 0.3 ether);
        vm.prank(bob);
        queue.rentFeatured{ value: durationCost + 0.3 ether }(inst2, maxDur, 0.3 ether);

        // The smaller fresh bid now outranks the big old payer — permanence is gone.
        (, uint256 inst2Rank,,) = queue.getRentalInfo(inst2);
        assertGt(inst2Rank, inst1Decayed);

        (address[] memory result,) = queue.getFeaturedInstances(0, 10);
        assertEq(result[0], inst2);
        assertEq(result[1], inst1);
    }

    /// Decay is prorated by elapsed SECONDS, not floored to whole days: a sub-day gap accrues its
    /// exact share.
    function test_rankDecay_subDayGapAccrues() public {
        _rentBasic(inst1, alice, 1 ether);

        // Half a day retains sqrt(0.95) = 0.974679434480896 — the geometric half-step, not half the
        // straight-line step (which would read 0.975 ether).
        vm.warp(block.timestamp + 12 hours);
        (, uint256 rankHalfDay,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rankHalfDay, 0.974679434480896 ether, DECAY_TOL);
        assertLt(rankHalfDay, 1 ether);
        assertGt(rankHalfDay, 0.95 ether);
    }

    /// Writing rank at a sub-day cadence does NOT reset the decay clock for free: 24 boosts an hour
    /// apart accrue the decay that 24 hours earns. Under day-floored decay every gap rounded to zero
    /// and a dust boost held placement indefinitely.
    function test_rankDecay_subDayCadenceStillAccrues() public {
        uint256 maxDur = queue.maxDuration();
        uint256 durationCost = queue.quoteDurationCost(maxDur);

        vm.deal(alice, alice.balance + durationCost + 10 ether);
        vm.prank(alice);
        queue.rentFeatured{ value: durationCost + 10 ether }(inst1, maxDur, 10 ether);

        // 24 dust boosts, one hour apart — each one restamps lastBoostTime. The cursor is explicit:
        // `block.timestamp` is loaded once per call frame, so reading it inside the loop would not
        // observe the warps.
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 24; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(bob);
            queue.boostRank{ value: 1 wei }(inst1);
        }

        (, uint256 rankAfter,,) = queue.getRentalInfo(inst1);

        // A full day of decay has accrued despite the sub-day write cadence: 24 wei of dust cannot
        // outrun 5%/day on 10 ether.
        assertLt(rankAfter, 10 ether);

        // And it equals what one undisturbed day of decay produces: geometric decay composes exactly
        // across the 24 recrystallisations, leaving only per-write truncation dust.
        uint256 idealOneDay = 9.5 ether; // 10 ether * 0.95
        assertApproxEqRel(rankAfter, idealOneDay, DECAY_TOL);
    }

    /// A dust boost cannot lift a slot above where it started once decay is time-proportional.
    function test_rankDecay_dustBoostDoesNotOutrunDecay() public {
        _rentBasic(inst1, alice, 1 ether);

        vm.warp(block.timestamp + 23 hours + 59 minutes);
        vm.prank(bob);
        queue.boostRank{ value: 1 wei }(inst1);

        (, uint256 rankAfterBoost,,) = queue.getRentalInfo(inst1);
        assertLt(rankAfterBoost, 1 ether);
    }

    /// getEffectiveRank read reflects the proportionally decayed rank.
    function test_getEffectiveRank_reflectsProportionalDecay() public {
        _rentBasic(inst1, alice, 0.4 ether);
        assertEq(queue.getEffectiveRank(inst1), 0.4 ether);

        vm.warp(block.timestamp + 8 days); // retains 0.95^8 = 0.6634204312890625
        assertApproxEqRel(queue.getEffectiveRank(inst1), 0.265368172515625 ether, DECAY_TOL);
    }

    /// Very long idle gap never underflows and never reverts — the read path stays live at horizons
    /// far past any legal slot duration.
    function test_rankDecay_neverNegative_longGap() public {
        _rentBasic(inst1, alice, 1 ether);
        vm.warp(block.timestamp + 40 days); // retains 0.95^40 = 0.1285121565651034
        (, uint256 rank,,) = queue.getRentalInfo(inst1);
        assertApproxEqRel(rank, 0.1285121565651034 ether, DECAY_TOL);
        assertGt(rank, 0);

        vm.warp(block.timestamp + 2000 days);
        assertEq(queue.getEffectiveRank(inst1), 0);
    }

    /// Boundary rates. Zero disables decay outright; 100%/day or more leaves nothing behind at any
    /// non-zero elapsed time. Both are reachable through the owner setter.
    function test_rankDecay_boundaryRates() public {
        _rentBasic(inst1, alice, 1 ether);

        vm.prank(owner);
        queue.setDailyDecayRate(0);
        vm.warp(block.timestamp + 100 days);
        assertEq(queue.getEffectiveRank(inst1), 1 ether, "zero rate retains rank");

        vm.prank(owner);
        queue.setDailyDecayRate(10000);
        assertEq(queue.getEffectiveRank(inst1), 0, "a 100%/day rate leaves nothing");
    }

    // ── getFeaturedInstances ordering ─────────────────────────────────────────

    function test_getFeaturedInstances_sortedByRankDesc() public {
        _rentBasic(inst1, alice, 0.01 ether);
        _rentBasic(inst2, bob, 0.05 ether);
        _rentBasic(inst3, charlie, 0.03 ether);

        (address[] memory result,) = queue.getFeaturedInstances(0, 10);
        assertEq(result.length, 3);
        assertEq(result[0], inst2);
        assertEq(result[1], inst3);
        assertEq(result[2], inst1);
    }

    function test_getFeaturedInstances_excludesExpired() public {
        _rentBasic(inst1, alice, 0);
        vm.warp(block.timestamp + 2); // 2-second gap — inst2 expires 2 seconds after inst1
        _rentBasic(inst2, bob, 0);

        // Warp to inst1 expiry + 1 second — inst1 expired, inst2 has 1 second left
        (,, uint256 expiresAt1,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt1 + 1);

        (address[] memory result, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1);
        assertEq(result.length, 1);
        assertEq(result[0], inst2);
    }

    function test_getFeaturedInstances_pagination() public {
        _rentBasic(inst1, alice, 0.01 ether);
        _rentBasic(inst2, bob, 0.05 ether);
        _rentBasic(inst3, charlie, 0.03 ether);

        // Sorted: inst2 (0.05), inst3 (0.03), inst1 (0.01)
        (address[] memory page0, uint256 total) = queue.getFeaturedInstances(0, 2);
        assertEq(total, 3);
        assertEq(page0.length, 2);
        assertEq(page0[0], inst2);
        assertEq(page0[1], inst3);

        (address[] memory page1,) = queue.getFeaturedInstances(2, 2);
        assertEq(page1.length, 1);
        assertEq(page1[0], inst1);
    }

    function test_getFeaturedInstances_rankBoostUpdatesOrder() public {
        _rentBasic(inst1, alice, 0.05 ether);
        _rentBasic(inst2, bob, 0.01 ether);

        (address[] memory resultBefore,) = queue.getFeaturedInstances(0, 10);
        assertEq(resultBefore[0], inst1);

        vm.prank(charlie);
        queue.boostRank{ value: 0.1 ether }(inst2);

        (address[] memory resultAfter,) = queue.getFeaturedInstances(0, 10);
        assertEq(resultAfter[0], inst2);
        assertEq(resultAfter[1], inst1);
    }

    function test_getFeaturedInstances_decayShiftsOrder() public {
        // Use max duration so slots outlast the decay period
        uint256 maxDur = queue.maxDuration();
        uint256 durationCost = queue.quoteDurationCost(maxDur);
        uint256 rank = 1 ether;

        // Rent inst1 first — decay clock starts at T0
        vm.deal(alice, alice.balance + durationCost + rank);
        vm.prank(alice);
        queue.rentFeatured{ value: durationCost + rank }(inst1, maxDur, rank);

        // Advance 10 days — inst1 has been decaying while inst2 hasn't started
        vm.warp(block.timestamp + 10 days);

        // Rent inst2 with same rank — fresh decay clock at T0+10d
        vm.deal(bob, bob.balance + durationCost + rank);
        vm.prank(bob);
        queue.rentFeatured{ value: durationCost + rank }(inst2, maxDur, rank);

        // inst1 effective = 1e * 0.95^10 = 0.5987e; inst2 effective = 1e → inst2 leads
        (address[] memory result,) = queue.getFeaturedInstances(0, 10);
        assertEq(result.length, 2);
        assertEq(result[0], inst2);
        assertEq(result[1], inst1);
    }

    function test_getFeaturedInstances_emptyWhenNoneActive() public {
        (address[] memory result, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(result.length, 0);
        assertEq(total, 0);
    }

    function test_getFeaturedInstances_offsetBeyondTotal() public {
        _rentBasic(inst1, alice, 0);

        (address[] memory result, uint256 total) = queue.getFeaturedInstances(5, 10);
        assertEq(total, 1);
        assertEq(result.length, 0);
    }

    // ── getFeaturedInstances honors registry revocation ───────────────────────

    function test_getFeaturedInstances_excludesRevoked() public {
        _rentBasic(inst1, alice, 0.05 ether);
        _rentBasic(inst2, bob, 0.01 ether);

        registry.revoke(inst1);

        (address[] memory result, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1);
        assertEq(result.length, 1);
        assertEq(result[0], inst2);
    }

    function test_getFeaturedInstances_keepsLiveWhileAnotherIsRevoked() public {
        _rentBasic(inst1, alice, 0.05 ether);
        _rentBasic(inst2, bob, 0.01 ether);

        // Before revocation both are visible — the filter is not blanket.
        (address[] memory before, uint256 totalBefore) = queue.getFeaturedInstances(0, 10);
        assertEq(totalBefore, 2);
        assertEq(before.length, 2);

        registry.revoke(inst2);

        (address[] memory result, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1);
        assertEq(result.length, 1);
        assertEq(result[0], inst1);
    }

    /// @dev Both passes must apply the same predicate: revoking the top-ranked entry is the case where
    ///      a count/collect mismatch would either overrun the result array or leave a zero-address hole.
    function test_getFeaturedInstances_revokedTopRank_orderAndPaginationHold() public {
        _rentBasic(inst1, alice, 0.05 ether); // rank 1
        _rentBasic(inst2, bob, 0.03 ether); // rank 2
        _rentBasic(inst3, charlie, 0.01 ether); // rank 3

        registry.revoke(inst1);

        (address[] memory all, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 2);
        assertEq(all.length, 2);
        assertEq(all[0], inst2);
        assertEq(all[1], inst3);

        (address[] memory page0, uint256 totalPage0) = queue.getFeaturedInstances(0, 1);
        assertEq(totalPage0, 2);
        assertEq(page0.length, 1);
        assertEq(page0[0], inst2);

        (address[] memory page1,) = queue.getFeaturedInstances(1, 1);
        assertEq(page1.length, 1);
        assertEq(page1[0], inst3);

        // Offset past the post-filter total yields an empty page rather than a stale entry.
        (address[] memory page2,) = queue.getFeaturedInstances(2, 1);
        assertEq(page2.length, 0);
    }

    /// @dev Read-side filter only: the rental itself is untouched by revocation.
    function test_getRentalInfo_unchangedByRevocation() public {
        _rentBasic(inst1, alice, 0.02 ether);

        (address renterBefore, uint256 rankBefore, uint256 expiresBefore, bool activeBefore) =
            queue.getRentalInfo(inst1);

        registry.revoke(inst1);

        (address renterAfter, uint256 rankAfter, uint256 expiresAfter, bool activeAfter) = queue.getRentalInfo(inst1);
        assertEq(renterAfter, renterBefore);
        assertEq(rankAfter, rankBefore);
        assertEq(expiresAfter, expiresBefore);
        assertEq(activeAfter, activeBefore);
        assertTrue(activeAfter);
    }

    // ── queueLength ──────────────────────────────────────────────────────────

    function test_queueLength_onlyCountsActive() public {
        _rentBasic(inst1, alice, 0);
        vm.warp(block.timestamp + 2); // 2-second gap so inst2 expires later
        _rentBasic(inst2, bob, 0);
        assertEq(queue.queueLength(), 2);

        // Expire only inst1
        (,, uint256 expiresAt1,) = queue.getRentalInfo(inst1);
        vm.warp(expiresAt1 + 1);
        assertEq(queue.queueLength(), 1);
    }

    /// `queueLength()` and the `total` from `getFeaturedInstances` describe one queue and must agree.
    /// A revoked instance is dropped by both: it can no longer render, so it is no longer counted.
    function test_queueLength_agreesWithFeaturedTotal_afterRevocation() public {
        _rentBasic(inst1, alice, 0);
        _rentBasic(inst2, bob, 0);

        (, uint256 totalBefore) = queue.getFeaturedInstances(0, 10);
        assertEq(totalBefore, 2);
        assertEq(queue.queueLength(), 2);

        registry.revoke(inst1);

        (address[] memory shown, uint256 totalAfter) = queue.getFeaturedInstances(0, 10);
        assertEq(totalAfter, 1, "the revoked slot is not rendered");
        assertEq(shown.length, 1);
        assertEq(shown[0], inst2);
        assertEq(queue.queueLength(), totalAfter, "both public counts describe the same queue");
        assertEq(queue.queueLength(), 1);
    }

    /// The behaviour change: capacity is spent on slots that can render. Revoking the only occupant of
    /// a size-1 featured set frees the seat for a live instance, rather than holding it until expiry.
    function test_rentFeatured_revokedSlotFreesCapacity() public {
        vm.prank(owner);
        queue.setMaxFeaturedSize(1);

        _rentBasic(inst1, alice, 0);

        // While inst1 is live the single seat is taken.
        uint256 duration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(duration);
        vm.deal(bob, bob.balance + cost);
        vm.prank(bob);
        vm.expectRevert(FeaturedQueueManager.QueueFull.selector);
        queue.rentFeatured{ value: cost }(inst2, duration, 0);

        // Revocation frees it, well before inst1's slot expires.
        registry.revoke(inst1);
        _rentBasic(inst2, bob, 0);

        (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1);
        assertEq(shown[0], inst2, "the live instance took the freed seat");
        assertEq(queue.queueLength(), 1);
    }

    /// The featured list must stay bounded by the cap under repeated rent/revoke cycles. Revoked
    /// entries no longer count toward capacity, so they must be evicted from the list rather than
    /// accumulating in it — otherwise every `getFeaturedInstances` pass walks a longer array.
    ///
    /// The list is private, so eviction is observed by restoring registry liveness at the end: an
    /// entry still held in the list would become visible again and push the count past the cap.
    function test_featuredList_staysBoundedUnderRentRevokeCycles() public {
        vm.prank(owner);
        queue.setMaxFeaturedSize(2);

        address[6] memory pool =
            [inst1, inst2, makeAddr("inst4"), makeAddr("inst5"), makeAddr("inst6"), makeAddr("inst7")];
        for (uint256 i = 2; i < pool.length; i++) {
            registry.register(pool[i]);
        }

        _rentBasic(pool[0], alice, 0);
        _rentBasic(pool[1], bob, 0);
        assertEq(queue.queueLength(), 2);

        // Four cycles, each: revoke the oldest occupant, rent a fresh live instance into its seat.
        // No slot ever expires, so eviction is the only thing that can keep the list at the cap.
        for (uint256 i = 0; i < 4; i++) {
            registry.revoke(pool[i]);
            _rentBasic(pool[i + 2], charlie, 0);
            assertEq(queue.queueLength(), 2, "capacity stays exactly at the cap through every cycle");
        }

        // Restore every revoked instance. Their slots are still unexpired, so any entry the list had
        // kept would render again.
        for (uint256 i = 0; i < 4; i++) {
            registry.unrevoke(pool[i]);
        }

        (, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 2, "the list holds no more entries than the cap allows");
        assertEq(queue.queueLength(), 2);
    }

    // ── maxFeaturedSize cap ───────────────────────────────────────────────────

    function test_rentFeatured_revert_featuredSetFull() public {
        vm.prank(owner);
        queue.setMaxFeaturedSize(2);

        _rentBasic(inst1, alice, 0);
        _rentBasic(inst2, bob, 0);

        address inst4 = makeAddr("inst4");
        registry.register(inst4);

        // Pre-compute values before vm.expectRevert
        uint256 duration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(duration);
        vm.deal(charlie, charlie.balance + cost);

        vm.prank(charlie);
        vm.expectRevert(FeaturedQueueManager.QueueFull.selector);
        queue.rentFeatured{ value: cost }(inst4, duration, 0);
    }

    // ── Treasury forwarding ───────────────────────────────────────────────────

    function test_rentFeatured_forwardsFeeToTreasury() public {
        uint256 duration = queue.minDuration();
        uint256 durationCost = queue.quoteDurationCost(duration);
        uint256 rankBoost = 0.005 ether;
        uint256 total = durationCost + rankBoost;

        uint256 treasuryBefore = treasury.balance;
        vm.deal(alice, alice.balance + total);
        vm.prank(alice);
        queue.rentFeatured{ value: total }(inst1, duration, rankBoost);

        assertEq(treasury.balance, treasuryBefore + total);
        assertEq(address(queue).balance, 0);
    }

    function test_boostRank_forwardsFeeToTreasury() public {
        _rentBasic(inst1, alice, 0);
        uint256 boost = 0.01 ether;

        uint256 treasuryBefore = treasury.balance;
        vm.deal(bob, bob.balance + boost);
        vm.prank(bob);
        queue.boostRank{ value: boost }(inst1);

        assertEq(treasury.balance, treasuryBefore + boost);
        assertEq(address(queue).balance, 0);
    }

    function test_renewDuration_forwardsFeeToTreasury() public {
        _rentBasic(inst1, alice, 0);
        uint256 additionalDuration = queue.minDuration();
        uint256 cost = queue.quoteDurationCost(additionalDuration);

        uint256 treasuryBefore = treasury.balance;
        vm.deal(bob, bob.balance + cost);
        vm.prank(bob);
        queue.renewDuration{ value: cost }(inst1, additionalDuration);

        assertEq(treasury.balance, treasuryBefore + cost);
        assertEq(address(queue).balance, 0);
    }

    function test_rentFeatured_revert_treasuryNotSet() public {
        FeaturedQueueManager q2 = new FeaturedQueueManager();
        q2.initialize(address(registry), owner);
        // No treasury set

        uint256 duration = q2.minDuration();
        uint256 cost = q2.quoteDurationCost(duration);
        vm.deal(alice, alice.balance + cost);
        vm.prank(alice);
        vm.expectRevert(FeaturedQueueManager.TreasuryNotSet.selector);
        q2.rentFeatured{ value: cost }(inst1, duration, 0);
    }

    // ── Admin functions ───────────────────────────────────────────────────────

    function test_setDailyRate_onlyOwner() public {
        vm.prank(owner);
        queue.setDailyRate(0.002 ether);
        assertEq(queue.dailyRate(), 0.002 ether);
    }

    function test_setDailyRate_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        queue.setDailyRate(0.002 ether);
    }

    function test_quoteDurationCost_matchesDailyRate() public view {
        uint256 cost = queue.quoteDurationCost(1 days);
        assertEq(cost, queue.dailyRate());
    }
}
