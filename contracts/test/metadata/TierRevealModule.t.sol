// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TierRevealModule } from "../../src/metadata/TierRevealModule.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";

contract ToggleRegistry {
    mapping(address => bool) public factories;

    function setFactory(address a, bool v) external {
        factories[a] = v;
    }

    function isFactoryRegistered(address a) external view returns (bool) {
        return factories[a];
    }

    mapping(address => address) public instFactory;

    function setInstanceFactory(address inst, address f) external {
        instFactory[inst] = f;
    }

    function getInstanceInfo(address inst) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = inst;
        info.factory = instFactory[inst];
    }
}

/// @dev Mock ERC404 instance exposing the reads tier needs.
contract MockInstance {
    mapping(address => uint256) public balanceOf;
    address public stakingModule;

    function setBalance(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function setStaking(address s) external {
        stakingModule = s;
    }
}

contract MockStaking {
    mapping(address => mapping(address => uint256)) public stakedBalance;

    function set(address inst, address holder, uint256 v) external {
        stakedBalance[inst][holder] = v;
    }
}

contract TierRevealModuleTest is Test {
    TierRevealModule tier;
    ToggleRegistry registry;
    MockInstance inst;

    address factory = address(0xF1);
    address attacker = address(0xBAD);
    address holder = address(0xB0);

    uint256 constant UNIT = 1e24;

    function setUp() public {
        registry = new ToggleRegistry();
        tier = new TierRevealModule(address(registry));
        registry.setFactory(factory, true);
        inst = new MockInstance();
        registry.setInstanceFactory(address(inst), factory);
    }

    function _oneTier(uint256 minBal) internal pure returns (TierRevealModule.Tier[] memory ts) {
        ts = new TierRevealModule.Tier[](1);
        ts[0] =
            TierRevealModule.Tier({ idStart: 1, idEnd: 3, minBalance: minBal, baseURI: "rare-", lockedURI: "locked-" });
    }

    function _seal(TierRevealModule.Tier[] memory ts) internal {
        vm.prank(factory);
        tier.initTiers(address(inst), ts);
    }

    function test_initTiers_onlyRegisteredFactory() public {
        vm.prank(attacker);
        vm.expectRevert(TierRevealModule.NotRegisteredFactory.selector);
        tier.initTiers(address(inst), _oneTier(UNIT));
    }

    function test_initTiers_sealOnce() public {
        _seal(_oneTier(UNIT));
        vm.prank(factory);
        vm.expectRevert(TierRevealModule.AlreadySealed.selector);
        tier.initTiers(address(inst), _oneTier(UNIT));
    }

    function test_initTiers_rejectsInvalidRange() public {
        TierRevealModule.Tier[] memory ts = new TierRevealModule.Tier[](1);
        ts[0] = TierRevealModule.Tier({ idStart: 5, idEnd: 2, minBalance: UNIT, baseURI: "r", lockedURI: "" });
        vm.prank(factory);
        vm.expectRevert(TierRevealModule.InvalidRange.selector);
        tier.initTiers(address(inst), ts);
    }

    function test_initTiers_rejectsOverlappingOrDescending() public {
        TierRevealModule.Tier[] memory ts = new TierRevealModule.Tier[](2);
        ts[0] = TierRevealModule.Tier({ idStart: 1, idEnd: 5, minBalance: UNIT, baseURI: "a", lockedURI: "" });
        ts[1] = TierRevealModule.Tier({ idStart: 5, idEnd: 9, minBalance: UNIT, baseURI: "b", lockedURI: "" }); // 5 overlaps
        vm.prank(factory);
        vm.expectRevert(TierRevealModule.RangesNotAscending.selector);
        tier.initTiers(address(inst), ts);
    }

    function test_resolve_revealsWhenAboveThreshold() public {
        _seal(_oneTier(2 * UNIT));
        inst.setBalance(holder, 2 * UNIT);
        assertEq(tier.resolve(address(inst), 2, holder), "rare-2");
    }

    function test_resolve_lockedWhenBelowThreshold() public {
        _seal(_oneTier(2 * UNIT));
        inst.setBalance(holder, UNIT); // below threshold
        assertEq(tier.resolve(address(inst), 2, holder), "locked-");
    }

    /// @dev Effective holdings count staked balance (ADR-0007 Decision 3): a holder whose wallet
    ///      balance is below threshold but whose staked balance clears it still reveals.
    function test_resolve_stakedBalanceCountsTowardThreshold() public {
        MockStaking staking = new MockStaking();
        inst.setStaking(address(staking));
        _seal(_oneTier(3 * UNIT));
        inst.setBalance(holder, UNIT); // 1 unit in wallet
        staking.set(address(inst), holder, 2 * UNIT); // +2 staked = 3 effective
        assertEq(tier.resolve(address(inst), 1, holder), "rare-1");
    }

    /// @dev Boundary: eff == minBalance reveals (threshold is inclusive, `>=`).
    function test_resolve_boundaryEqualThresholdReveals() public {
        _seal(_oneTier(2 * UNIT));
        inst.setBalance(holder, 2 * UNIT); // exactly the threshold
        assertEq(tier.resolve(address(inst), 1, holder), "rare-1");
    }

    function test_resolve_idOutsideAnyTier_returnsEmpty() public {
        _seal(_oneTier(UNIT));
        inst.setBalance(holder, 100 * UNIT);
        assertEq(tier.resolve(address(inst), 99, holder), ""); // id 99 not in [1,3]
    }

    /// @dev Unminted id / holder address(0): eff 0 < threshold → lockedURI (teaser for unsold rares).
    function test_resolve_unmintedHolder_showsTeaser() public {
        _seal(_oneTier(UNIT));
        assertEq(tier.resolve(address(inst), 2, address(0)), "locked-");
    }

    /// @dev lockedURI == "" → in-range-but-locked falls through to collection base.
    function test_resolve_emptyLockedFallsThrough() public {
        TierRevealModule.Tier[] memory ts = new TierRevealModule.Tier[](1);
        ts[0] = TierRevealModule.Tier({ idStart: 1, idEnd: 3, minBalance: UNIT, baseURI: "rare-", lockedURI: "" });
        _seal(ts);
        assertEq(tier.resolve(address(inst), 2, holder), ""); // holder under threshold, no teaser
    }

    /// @dev A tiered ladder: ascending thresholds, each range resolves against its own threshold —
    ///      "hold more → reveal rarer."
    function test_resolve_tieredLadder_selectsCorrectTier() public {
        TierRevealModule.Tier[] memory ts = new TierRevealModule.Tier[](2);
        ts[0] =
            TierRevealModule.Tier({ idStart: 1, idEnd: 5, minBalance: 2 * UNIT, baseURI: "rare-", lockedURI: "lo1-" });
        ts[1] = TierRevealModule.Tier({
            idStart: 6, idEnd: 10, minBalance: 10 * UNIT, baseURI: "legend-", lockedURI: "lo2-"
        });
        _seal(ts);

        inst.setBalance(holder, 2 * UNIT); // clears tier 0 only
        assertEq(tier.resolve(address(inst), 3, holder), "rare-3"); // tier 0 revealed
        assertEq(tier.resolve(address(inst), 8, holder), "lo2-"); // tier 1 still locked (needs 10 units)
        assertEq(tier.tierCount(address(inst)), 2);

        inst.setBalance(holder, 10 * UNIT); // now clears both
        assertEq(tier.resolve(address(inst), 8, holder), "legend-8"); // tier 1 revealed
    }

    /// @dev Adjacent (idStart == prev.idEnd + 1) non-overlapping ranges are valid; boundaries inclusive.
    function test_initTiers_adjacentRangesSealOk_boundariesInclusive() public {
        TierRevealModule.Tier[] memory ts = new TierRevealModule.Tier[](2);
        ts[0] = TierRevealModule.Tier({ idStart: 1, idEnd: 5, minBalance: UNIT, baseURI: "a-", lockedURI: "" });
        ts[1] = TierRevealModule.Tier({ idStart: 6, idEnd: 9, minBalance: UNIT, baseURI: "b-", lockedURI: "" });
        _seal(ts); // adjacent, no overlap → seals fine
        inst.setBalance(holder, UNIT);
        assertEq(tier.resolve(address(inst), 5, holder), "a-5"); // idEnd inclusive (tier 0)
        assertEq(tier.resolve(address(inst), 6, holder), "b-6"); // idStart inclusive (tier 1)
    }

    /// @dev D1 least-privilege: a registered factory that is NOT this instance's factory cannot seal it.
    function test_initTiers_rejectsWrongFactory() public {
        address otherFactory = address(0xF2);
        // inst is registered to `factory` in setUp; a different caller must be rejected.
        vm.prank(otherFactory);
        vm.expectRevert(TierRevealModule.NotRegisteredFactory.selector);
        tier.initTiers(address(inst), _oneTier(UNIT));
    }

    function test_setMetadataURI_onlyModuleOwner() public {
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        tier.setMetadataURI("x");
        tier.setMetadataURI("data:application/json,{}"); // owner = this test contract
        assertEq(tier.metadataURI(), "data:application/json,{}");
    }
}
