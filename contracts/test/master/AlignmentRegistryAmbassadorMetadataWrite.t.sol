// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

/// @notice Proves the ambassador metadata-write capability boundary (noesis-054):
///         an appointed ambassador may update ONLY the SAFE metadata field of the target it represents
///         (description/metadataURI) and has NO fund- or price-authority power.
contract AlignmentRegistryAmbassadorMetadataWriteTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("owner");
    address public ambassador = makeAddr("ambassador");
    address public stranger = makeAddr("stranger");
    address public cultToken = makeAddr("CULT");

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

    function _registerTargetWithAmbassador() internal returns (uint256) {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        registry.addAmbassador(targetId, ambassador);
        return targetId;
    }

    // ── the granted capability: metadata write ─────────────────────────────────

    /// An appointed ambassador CAN update its target's description/metadataURI.
    function test_UpdateAlignmentTarget_AmbassadorCan() public {
        uint256 targetId = _registerTargetWithAmbassador();

        vm.prank(ambassador);
        vm.expectEmit(true, false, false, false);
        emit IAlignmentRegistry.AlignmentTargetUpdated(targetId);
        registry.updateAlignmentTarget(targetId, "new blurb", "ipfs://icon");

        IAlignmentRegistry.AlignmentTarget memory t = registry.getAlignmentTarget(targetId);
        assertEq(t.description, "new blurb");
        assertEq(t.metadataURI, "ipfs://icon");
    }

    /// The owner CAN still update (unchanged behaviour).
    function test_UpdateAlignmentTarget_OwnerCan() public {
        uint256 targetId = _registerTargetWithAmbassador();

        vm.prank(daoOwner);
        registry.updateAlignmentTarget(targetId, "owner blurb", "ipfs://owner");

        IAlignmentRegistry.AlignmentTarget memory t = registry.getAlignmentTarget(targetId);
        assertEq(t.description, "owner blurb");
        assertEq(t.metadataURI, "ipfs://owner");
    }

    // ── the boundary: no one else can write metadata ───────────────────────────

    /// A non-owner, non-ambassador CANNOT update metadata.
    function test_UpdateAlignmentTarget_RevertIfStranger() public {
        uint256 targetId = _registerTargetWithAmbassador();

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.updateAlignmentTarget(targetId, "hijack", "ipfs://evil");
    }

    /// An ambassador of a DIFFERENT target cannot update this target.
    function test_UpdateAlignmentTarget_RevertIfWrongTargetAmbassador() public {
        uint256 targetA = _registerTargetWithAmbassador();

        // Register a second target with a different ambassador.
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: makeAddr("OTHER"), symbol: "OTH", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        uint256 targetB = registry.registerAlignmentTarget("Other", "", "", assets);
        address otherAmbassador = makeAddr("otherAmbassador");
        vm.prank(daoOwner);
        registry.addAmbassador(targetB, otherAmbassador);

        // targetB's ambassador may not touch targetA.
        vm.prank(otherAmbassador);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.updateAlignmentTarget(targetA, "cross", "ipfs://cross");
    }

    /// A removed ambassador loses metadata-write power.
    function test_UpdateAlignmentTarget_RevertAfterRemoval() public {
        uint256 targetId = _registerTargetWithAmbassador();

        vm.prank(daoOwner);
        registry.removeAmbassador(targetId, ambassador);

        vm.prank(ambassador);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.updateAlignmentTarget(targetId, "stale", "ipfs://stale");
    }

    // ── the boundary: ambassador has NO fund/price authority ────────────────────

    /// An ambassador CANNOT set the community payout (fund authority stays owner-only).
    function test_SetCommunityPayout_AmbassadorCannot() public {
        uint256 targetId = _registerTargetWithAmbassador();

        vm.prank(ambassador);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setCommunityPayout(targetId, makeAddr("payout"));
    }

    /// An ambassador CANNOT set an acquire route (price/route authority stays owner-only).
    function test_SetAcquireRoute_AmbassadorCannot() public {
        uint256 targetId = _registerTargetWithAmbassador();

        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.ALGEBRA, fee: 0, tickSpacing: 0, feeOrHook: 0
        });

        vm.prank(ambassador);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setAcquireRoute(targetId, cultToken, route);
    }

    /// An ambassador CANNOT set a reference pool (price authority stays owner-only).
    function test_SetReferencePool_AmbassadorCannot() public {
        uint256 targetId = _registerTargetWithAmbassador();

        IAlignmentRegistry.ReferencePool memory ref =
            IAlignmentRegistry.ReferencePool({ pool: makeAddr("pool"), kind: 0, twapWindow: 0 });

        vm.prank(ambassador);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setReferencePool(targetId, cultToken, ref);
    }
}
