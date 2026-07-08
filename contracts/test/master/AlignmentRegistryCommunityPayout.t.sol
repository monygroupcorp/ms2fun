// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

contract AlignmentRegistryCommunityPayoutTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public cultToken = makeAddr("CULT");
    address public payoutAddr = makeAddr("payout");

    function setUp() public {
        registry = new AlignmentRegistryV1();
        registry.initialize(daoOwner);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _registerTarget() internal returns (uint256) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: cultToken, symbol: "CULT", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        return registry.registerAlignmentTarget("Remilia", "", "", assets);
    }

    // ── passing cases ────────────────────────────────────────────────────────

    /// Owner can set a community payout for an active target.
    function test_SetCommunityPayout_Owner() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        vm.expectEmit(true, true, false, false);
        emit IAlignmentRegistry.CommunityPayoutSet(targetId, payoutAddr);
        registry.setCommunityPayout(targetId, payoutAddr);

        assertEq(registry.communityPayout(targetId), payoutAddr);
    }

    /// getCommunityPayout returns the stored address.
    function test_GetCommunityPayout_ReturnsStored() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        assertEq(registry.getCommunityPayout(targetId), payoutAddr);
    }

    /// getCommunityPayout returns zero address before any payout is set.
    function test_GetCommunityPayout_DefaultZero() public {
        uint256 targetId = _registerTarget();
        assertEq(registry.getCommunityPayout(targetId), address(0));
    }

    /// Owner can update payout to a different address.
    function test_SetCommunityPayout_Update() public {
        uint256 targetId = _registerTarget();
        address newPayout = makeAddr("newPayout");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, newPayout);

        assertEq(registry.getCommunityPayout(targetId), newPayout);
    }

    // ── reverting cases ──────────────────────────────────────────────────────

    /// Non-owner cannot set payout.
    function test_SetCommunityPayout_RevertIfNotOwner() public {
        uint256 targetId = _registerTarget();

        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setCommunityPayout(targetId, payoutAddr);
    }

    /// Zero address reverts with InvalidAddress.
    function test_SetCommunityPayout_RevertOnZeroAddress() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidAddress.selector);
        registry.setCommunityPayout(targetId, address(0));
    }

    /// Unknown target (never registered) reverts with TargetNotFound.
    function test_SetCommunityPayout_RevertOnUnknownTarget() public {
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setCommunityPayout(999, payoutAddr);
    }

    /// Deactivated target reverts with TargetNotFound.
    function test_SetCommunityPayout_RevertOnInactiveTarget() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setCommunityPayout(targetId, payoutAddr);
    }
}
