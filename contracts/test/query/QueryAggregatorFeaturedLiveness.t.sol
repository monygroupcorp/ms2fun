// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

/// @notice noesis-312 — the featured badge on a `getProjectCardsBatch` card follows registry liveness.
/// @dev `getHomePageData` is already revocation-safe: its address list comes from
///      `getFeaturedInstances`, which filters on expiry AND registry liveness. `getProjectCardsBatch`
///      hydrates caller-supplied addresses and never passes through that filter, so the badge gate in
///      `_hydrateFeatured` is the only thing standing between a revoked instance and a live-looking
///      `featuredRank`/`featuredExpires`. The rental record itself is untouched — `getRentalInfo` still
///      reports the slot as paid-for and unexpired, which is what these tests hold fixed.
contract QueryAggregatorFeaturedLivenessTest is Test {
    QueryAggregator internal agg;
    MockLivenessRegistry internal registry;
    MockRentedQueueManager internal fqm;

    address internal owner = makeAddr("owner");
    address internal instance = makeAddr("instance");

    uint256 internal constant RANK = 5e18;
    uint256 internal constant EXPIRES = 1_900_000_000;

    function setUp() public {
        registry = new MockLivenessRegistry();
        fqm = new MockRentedQueueManager(RANK, EXPIRES);
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(fqm), address(0), owner);

        registry.setRegistered(instance, true);
    }

    function _card(address target) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory arr = new address[](1);
        arr[0] = target;
        return agg.getProjectCardsBatch(arr)[0];
    }

    /// Control: a live instance with an unexpired rental still gets its badge on the batch path.
    function test_liveInstanceKeepsFeaturedBadge() public view {
        QueryAggregator.ProjectCard memory card = _card(instance);

        assertEq(card.featuredRank, RANK, "live instance must keep its rank");
        assertEq(card.featuredExpires, EXPIRES, "live instance must keep its expiry");
    }

    /// The gate: revoke the instance in the registry and the same call must carry no badge, even though
    /// the rental slot is untouched (still unexpired, still `isActive`).
    /// @dev Vacuity check: drop the liveness term from `_hydrateFeatured` and this test fails.
    function test_revokedInstanceLosesFeaturedBadge() public {
        registry.setRegistered(instance, false);

        (,, uint256 rentalExpires, bool rentalActive) = fqm.getRentalInfo(instance);
        assertTrue(rentalActive, "precondition: the rental record is untouched by revocation");
        assertEq(rentalExpires, EXPIRES, "precondition: the slot is still unexpired");

        QueryAggregator.ProjectCard memory card = _card(instance);

        assertEq(card.featuredRank, 0, "revoked instance must carry no featured rank");
        assertEq(card.featuredExpires, 0, "revoked instance must carry no featured expiry");
    }

    /// A registry that cannot answer the liveness question fails OPEN: the badge is preserved rather
    /// than stripped from every card at once. Same fallback as the queue manager's predicate.
    function test_unreadableRegistryFailsOpen() public {
        registry.setRegistered(instance, false);
        registry.setBroken(true);

        QueryAggregator.ProjectCard memory card = _card(instance);

        assertEq(card.featuredRank, RANK, "unreadable liveness must not strip the badge");
        assertEq(card.featuredExpires, EXPIRES, "unreadable liveness must not strip the expiry");
    }
}

/// @dev Registry stub whose `isRegisteredInstance` models revocation, and can be made to answer with a
///      short, undecodable frame to exercise the fail-open path.
contract MockLivenessRegistry {
    mapping(address => bool) internal registered;
    bool internal broken;

    function setRegistered(address instance, bool v) external {
        registered[instance] = v;
    }

    function setBroken(bool v) external {
        broken = v;
    }

    function isRegisteredInstance(address instance) external view returns (bool) {
        if (broken) {
            // Four bytes of return data — passes the call, fails the returndata-size guard.
            // solhint-disable-next-line no-inline-assembly
            assembly {
                mstore(0, 0)
                return(0, 4)
            }
        }
        return registered[instance];
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        if (!registered[instance]) revert("NotRegistered");
        info.instance = instance;
        info.name = "Sample Collection";
    }
}

/// @dev Queue manager stub holding one unexpired, paid-for rental for every instance. Models the
///      recorded design: the rental record is revocation-blind.
contract MockRentedQueueManager {
    uint256 internal rank;
    uint256 internal expires;

    constructor(uint256 rank_, uint256 expires_) {
        rank = rank_;
        expires = expires_;
    }

    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory instances, uint256 total) {
        return (new address[](0), 0);
    }

    function getRentalInfo(address)
        external
        view
        returns (address renter, uint256 effectiveRank, uint256 expiresAt, bool isActive)
    {
        return (address(0), rank, expires, block.timestamp < expires);
    }
}
