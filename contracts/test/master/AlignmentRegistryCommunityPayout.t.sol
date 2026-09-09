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
        registry = new AlignmentRegistryV1(makeAddr("WETH"));
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

    /// A de-curated target's sink stays pinnable. Its vaults may still hold an accrued community cut
    /// whose only exit resolves this address, and `deactivateAlignmentTarget` is one-way — so gating the
    /// setter on `active` would seal that ETH in for the life of the contract.
    function test_SetCommunityPayout_AllowedOnInactiveTarget() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        assertEq(registry.getCommunityPayout(targetId), payoutAddr);
        assertFalse(registry.isAlignmentTargetActive(targetId), "and the target is still de-curated");
    }

    /// The payee — and only the payee — moves a pinned payout onward, with its own event carrying `from`.
    function test_RotateCommunityPayout_Payee() public {
        uint256 targetId = _registerTarget();
        address newPayout = makeAddr("newPayout");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(payoutAddr);
        vm.expectEmit(true, true, true, false);
        emit IAlignmentRegistry.CommunityPayoutRotated(targetId, payoutAddr, newPayout);
        registry.rotateCommunityPayout(targetId, newPayout);

        assertEq(registry.getCommunityPayout(targetId), newPayout);
    }

    /// Rotation chains: authority follows the payout, so yesterday's payee cannot move it back.
    function test_RotateCommunityPayout_AuthorityMovesWithThePayout() public {
        uint256 targetId = _registerTarget();
        address second = makeAddr("second");
        address third = makeAddr("third");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(payoutAddr);
        registry.rotateCommunityPayout(targetId, second);

        vm.prank(second);
        registry.rotateCommunityPayout(targetId, third);
        assertEq(registry.getCommunityPayout(targetId), third);

        vm.prank(payoutAddr);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.rotateCommunityPayout(targetId, payoutAddr);
    }

    /// A de-curated target's community keeps its own hand on its own sink — deactivation is not a freeze.
    function test_RotateCommunityPayout_WorksAfterDeactivation() public {
        uint256 targetId = _registerTarget();
        address newPayout = makeAddr("newPayout");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(payoutAddr);
        registry.rotateCommunityPayout(targetId, newPayout);

        assertEq(registry.getCommunityPayout(targetId), newPayout);
    }

    // ── the capability itself: the owner cannot move a set payout, the payee can ──────────

    /// THE test this whole surface exists for. Revert either guard in `AlignmentRegistryV1` — drop the
    /// `CommunityPayoutAlreadySet` check, or let anyone through `rotateCommunityPayout` — and this fails.
    function test_OwnerCannotRedirectAPinnedPayout_ButThePayeeCan() public {
        uint256 targetId = _registerTarget();
        address attackerSink = makeAddr("attackerSink");
        address communityNewMultisig = makeAddr("communityNewMultisig");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        // The owner, holding every curation authority there is, has no way to move it.
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.CommunityPayoutAlreadySet.selector);
        registry.setCommunityPayout(targetId, attackerSink);

        vm.prank(daoOwner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.rotateCommunityPayout(targetId, attackerSink);

        assertEq(registry.getCommunityPayout(targetId), payoutAddr, "payout unmoved by the owner");

        // The community holding the payout moves it in one call.
        vm.prank(payoutAddr);
        registry.rotateCommunityPayout(targetId, communityNewMultisig);

        assertEq(registry.getCommunityPayout(targetId), communityNewMultisig, "payout moved by its payee");
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

    /// A second set is refused outright — the payout is pinned once, by anyone's hand including the owner's.
    function test_SetCommunityPayout_RevertOnSecondSet() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.CommunityPayoutAlreadySet.selector);
        registry.setCommunityPayout(targetId, makeAddr("otherPayout"));

        assertEq(registry.getCommunityPayout(targetId), payoutAddr);
    }

    /// A stranger cannot rotate.
    function test_RotateCommunityPayout_RevertIfNotPayee() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.rotateCommunityPayout(targetId, alice);
    }

    /// Rotating before anything is pinned reverts — there is no payee yet to be.
    function test_RotateCommunityPayout_RevertIfUnset() public {
        uint256 targetId = _registerTarget();

        vm.prank(alice);
        vm.expectRevert(AlignmentRegistryV1.CommunityPayoutNotSet.selector);
        registry.rotateCommunityPayout(targetId, alice);
    }

    /// Rotating to the zero address reverts — a community cannot burn its own sink by fat finger.
    function test_RotateCommunityPayout_RevertOnZeroAddress() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, payoutAddr);

        vm.prank(payoutAddr);
        vm.expectRevert(AlignmentRegistryV1.InvalidAddress.selector);
        registry.rotateCommunityPayout(targetId, address(0));
    }
}
