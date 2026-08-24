// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { FeaturedQueueManager } from "../../src/master/FeaturedQueueManager.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

/// @dev Minimal registry stand-in. Mirrors the shape MasterRegistryQueue.t.sol uses.
contract MockListRegistry {
    mapping(address => bool) public registered;

    function register(address instance) external {
        registered[instance] = true;
    }

    function isRegisteredInstance(address instance) external view returns (bool) {
        return registered[instance];
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        require(registered[instance], "Not registered");
        info.instance = instance;
    }
}

/// @title FeaturedListIntegrity
/// @notice Pins the swap-and-pop bookkeeping behind `_featuredList` / `_featuredListIndex`.
///
/// `_featuredList`, `_inList` and `_featuredListIndex` are all private and have no getter, so the
/// invariant they carry is only observable through behaviour: after a removal, the entry that was
/// swapped into the vacated position must still be findable at its NEW index, and must still render.
/// A stale index is the classic swap-and-pop defect and it is silent — the corrupted entry keeps
/// rendering until something tries to remove it, at which point the read is out of bounds.
///
/// The featured-queue suite had no coverage of `pruneExpired` or of the auto-prune inside
/// `_addToList` before this file. A review of the surface found it sound — these tests pin that
/// soundness, they do not assert a defect.
contract FeaturedListIntegrityTest is Test {
    FeaturedQueueManager queue;
    MockListRegistry registry;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address renter = makeAddr("renter");

    address instA = makeAddr("instA");
    address instB = makeAddr("instB");
    address instC = makeAddr("instC");
    address instD = makeAddr("instD");

    function setUp() public {
        vm.warp(1_700_000_000);

        registry = new MockListRegistry();
        registry.register(instA);
        registry.register(instB);
        registry.register(instC);
        registry.register(instD);

        queue = new FeaturedQueueManager();
        queue.initialize(address(registry), owner);

        vm.prank(owner);
        queue.setProtocolTreasury(treasury);
    }

    function _rent(address instance, uint256 duration, uint256 rankBoost) internal {
        uint256 total = queue.quoteDurationCost(duration) + rankBoost;
        vm.deal(renter, renter.balance + total);
        vm.prank(renter);
        queue.rentFeatured{ value: total }(instance, duration, rankBoost);
    }

    // ── pruneExpired: the guard ────────────────────────────────────────────────

    function test_pruneExpired_revertsWhileSlotIsActive() public {
        _rent(instA, 30 days, 0);

        vm.expectRevert(FeaturedQueueManager.SlotStillActive.selector);
        queue.pruneExpired(instA);
    }

    /// @dev An address that was never featured has `expiresAt == 0`, so it passes the expiry guard and
    ///      must be a silent no-op rather than reading `_featuredList[0]` of an empty list.
    function test_pruneExpired_neverFeaturedAddressIsANoOp() public {
        queue.pruneExpired(instA);
        assertEq(queue.queueLength(), 0);
    }

    function test_pruneExpired_isPermissionless() public {
        _rent(instA, 30 days, 0);
        vm.warp(block.timestamp + 31 days);

        vm.prank(makeAddr("stranger"));
        queue.pruneExpired(instA);

        // Idempotent: a second prune of the same instance is a no-op, not a revert.
        queue.pruneExpired(instA);
    }

    // ── pruneExpired: the swap-and-pop invariant ───────────────────────────────

    /// The entry swapped into a vacated slot must survive the move intact — still counted, still
    /// rendered, still carrying its rank.
    function test_pruneExpired_swappedEntrySurvivesAndStillRenders() public {
        _rent(instA, 7 days, 1 ether); // index 0, will expire
        _rent(instB, 7 days, 2 ether); // index 1, will expire
        _rent(instC, 300 days, 3 ether); // index 2, stays active — the one that gets swapped

        // 8 days: past the two short slots' expiry. Geometric decay at 5%/day leaves instC with
        // ~66% of its rank, comfortably non-zero.
        vm.warp(block.timestamp + 8 days);
        queue.pruneExpired(instA); // instC swaps from index 2 into index 0

        (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1, "only the active entry is visible");
        assertEq(shown.length, 1);
        assertEq(shown[0], instC, "the swapped entry is the one still rendered");
        assertGt(queue.getEffectiveRank(instC), 0, "the swapped entry kept its rank");
        assertEq(queue.queueLength(), 1);
    }

    /// The index written for the swapped entry must be its NEW position. Removing that entry later is
    /// the operation that reads the index back, so it is the operation that proves it was correct.
    function test_pruneExpired_swappedEntryCanItselfBePrunedLater() public {
        _rent(instA, 30 days, 0); // index 0
        _rent(instB, 30 days, 0); // index 1
        _rent(instC, 300 days, 0); // index 2

        vm.warp(block.timestamp + 31 days);
        queue.pruneExpired(instA); // instC -> index 0; list is [instC, instB]

        vm.warp(block.timestamp + 300 days); // instC now expired too
        queue.pruneExpired(instC); // reads instC's index — must be 0, not the stale 2

        queue.pruneExpired(instB); // and the list is still coherent afterwards
        assertEq(queue.queueLength(), 0);

        // The strongest proof the list is empty and consistent: every slot re-rents cleanly.
        _rent(instA, 30 days, 0);
        _rent(instB, 30 days, 0);
        _rent(instC, 30 days, 0);
        (, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 3, "all three re-enter after a full drain");
    }

    /// Removing the LAST element is the degenerate case of swap-and-pop: the element swaps with itself.
    function test_pruneExpired_lastElementIsRemovedCleanly() public {
        _rent(instA, 300 days, 0); // index 0, active
        _rent(instB, 30 days, 0); // index 1, last, will expire

        vm.warp(block.timestamp + 31 days);
        queue.pruneExpired(instB);

        (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1);
        assertEq(shown[0], instA, "the untouched entry is unaffected by the pop");
    }

    /// After being pruned, an instance re-enters as a fresh list member rather than a ghost.
    function test_pruneExpired_thenReRentReAddsTheInstance() public {
        _rent(instA, 30 days, 0);
        vm.warp(block.timestamp + 31 days);
        queue.pruneExpired(instA);

        _rent(instA, 30 days, 0);

        (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 1, "re-rent after prune is visible");
        assertEq(shown[0], instA);
        assertEq(queue.queueLength(), 1);
    }

    // ── _addToList: the auto-prune that bounds list growth ─────────────────────

    /// `_addToList` prunes one non-visible entry — expired or revoked — when the list has reached
    /// `maxFeaturedSize`. That prune is only reachable after the cap check has already proved the
    /// visible count is below the list length, so a non-visible entry is guaranteed to exist and the
    /// prune can never silently no-op on this path — the list therefore cannot grow past the cap.
    /// This registry stand-in never revokes, so here the non-visible entry is always the expired one.
    function test_addToList_autoPruneKeepsTheListBounded() public {
        vm.prank(owner);
        queue.setMaxFeaturedSize(2);

        _rent(instA, 30 days, 0);
        _rent(instB, 300 days, 0);

        // Cap reached: a third rent is refused while both are active.
        uint256 cost = queue.quoteDurationCost(30 days);
        vm.deal(renter, renter.balance + cost);
        vm.prank(renter);
        vm.expectRevert(FeaturedQueueManager.QueueFull.selector);
        queue.rentFeatured{ value: cost }(instC, 30 days, 0);

        // instA expires; the slot frees, and the new entry displaces it in the list.
        vm.warp(block.timestamp + 31 days);
        _rent(instC, 30 days, 0);

        (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
        assertEq(total, 2, "both live entries visible");
        assertEq(queue.queueLength(), 2);

        // And the pre-existing active entry was not the one evicted.
        bool sawB;
        bool sawC;
        for (uint256 i = 0; i < shown.length; i++) {
            if (shown[i] == instB) sawB = true;
            if (shown[i] == instC) sawC = true;
        }
        assertTrue(sawB, "the active entry survived the auto-prune");
        assertTrue(sawC, "the new entry was added");
    }

    /// The auto-prune must pick an EXPIRED entry, never an active one — repeated cycling at the cap is
    /// where a wrong choice would show up.
    function test_addToList_autoPruneNeverEvictsAnActiveEntry() public {
        vm.prank(owner);
        queue.setMaxFeaturedSize(2);

        _rent(instA, 365 days, 5 ether); // longest permitted slot, high rank — must never be evicted
        _rent(instB, 7 days, 0);

        // Cycle the second slot three times; each cycle hits the auto-prune at the cap.
        uint256 t = block.timestamp;
        address[3] memory cyclers = [instC, instD, instB];
        for (uint256 i = 0; i < cyclers.length; i++) {
            t += 8 days; // past the 7-day cycler slots, well inside instA's 365-day slot
            vm.warp(t); // explicit cursor: solc hoists TIMESTAMP out of a loop
            _rent(cyclers[i], 7 days, 0);

            (address[] memory shown, uint256 total) = queue.getFeaturedInstances(0, 10);
            assertEq(total, 2, "exactly two live entries at every cycle");
            assertTrue(shown[0] == instA || shown[1] == instA, "the long-lived entry survives every auto-prune");
        }

        // Still active and still rendered after three auto-prune cycles. Its RANK is deliberately not
        // asserted here: 24 days elapse across the cycles and where geometric decay leaves an
        // untouched rank is the decay mechanic's business, not this file's.
        (,,, bool isActive) = queue.getRentalInfo(instA);
        assertTrue(isActive, "the long-lived entry is still active at the end");
    }
}
