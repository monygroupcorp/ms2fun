// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";

/// @notice Guards the owner gate on `QueryAggregator.initialize`.
/// @dev The aggregator is deployed with a plain `new` and initialized in a following transaction. The
///      constructor makes the deploying account the owner immediately, so the gate costs the deployer
///      nothing while closing the window in which any other account could initialize the instance and
///      install itself (or a chosen address) as owner.
contract QueryAggregatorInitTest is Test {
    address internal registry = makeAddr("registry");
    address internal queueManager = makeAddr("queueManager");
    address internal outsider = makeAddr("outsider");

    /// A non-owner calling `initialize` on a freshly deployed, uninitialized aggregator is refused.
    /// Fails if the `onlyOwner` gate is removed: without it the call succeeds and installs the
    /// caller-supplied owner.
    function test_initialize_reverts_for_non_owner() public {
        QueryAggregator agg = new QueryAggregator();
        assertEq(agg.owner(), address(this), "deployer owns the instance from construction");

        vm.prank(outsider);
        vm.expectRevert(Ownable.Unauthorized.selector);
        agg.initialize(registry, queueManager, address(0), outsider);

        // Ownership is untouched and the instance is still initializable by its owner.
        assertEq(agg.owner(), address(this), "owner unchanged by the refused call");
        agg.initialize(registry, queueManager, address(0), address(this));
        assertEq(address(agg.masterRegistry()), registry, "owner path still initializes");
    }

    /// The deploy-script shape — `new QueryAggregator()` then `initialize(...)` from the same account —
    /// is unchanged, including handing ownership to a different address in the same call.
    function test_deployer_new_then_initialize_still_succeeds() public {
        address admin = makeAddr("admin");

        QueryAggregator agg = new QueryAggregator();
        agg.initialize(registry, queueManager, address(0), admin);

        assertEq(address(agg.masterRegistry()), registry, "masterRegistry set");
        assertEq(address(agg.featuredQueueManager()), queueManager, "featuredQueueManager set");
        assertEq(agg.owner(), admin, "ownership handed to the initialize argument");
    }

    /// Re-initialization stays refused for the owner too — the owner gate is added to the existing
    /// one-shot check, not substituted for it.
    function test_reinitialize_reverts_for_owner() public {
        QueryAggregator agg = new QueryAggregator();
        agg.initialize(registry, queueManager, address(0), address(this));

        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        agg.initialize(registry, queueManager, address(0), address(this));
    }
}
