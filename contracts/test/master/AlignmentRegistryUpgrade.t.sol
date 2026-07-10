// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { AlignmentRegistryV1Legacy } from "./legacy/AlignmentRegistryV1Legacy.sol";

/// @notice noesis-031 — LOAD-BEARING storage-layout proof.
/// @dev Seeds curated targets/assets/ambassadors/payouts against the PRE-noesis-031 implementation
///      (AlignmentRegistryV1Legacy — the exact layout deployed on origin/main), upgrades the SAME proxy to
///      the post-noesis-031 AlignmentRegistryV1 (which appends `acquireRoutes` as the last state var), and
///      asserts every pre-existing value reads back identical. A layout break in the appended mapping would
///      silently corrupt curated targets behind the UUPS proxy; this test fails loudly if it ever does.
contract AlignmentRegistryUpgradeTest is Test {
    address public daoOwner = makeAddr("dao");
    address public tokenA = makeAddr("CULT");
    address public tokenB = makeAddr("MILADY");
    address public ambassador = makeAddr("amb");
    address public payoutAddr = makeAddr("payout");

    function test_UpgradePreservesCuratedState() public {
        // ── deploy proxy on the OLD implementation ──
        AlignmentRegistryV1Legacy oldImpl = new AlignmentRegistryV1Legacy();
        address proxy = LibClone.deployERC1967(address(oldImpl));
        AlignmentRegistryV1Legacy legacy = AlignmentRegistryV1Legacy(proxy);
        legacy.initialize(daoOwner);

        // ── seed curated state (targets 1 & 2, assets, ambassador, payout) ──
        IAlignmentRegistry.AlignmentAsset[] memory assets1 = new IAlignmentRegistry.AlignmentAsset[](2);
        assets1[0] =
            IAlignmentRegistry.AlignmentAsset({ token: tokenA, symbol: "CULT", info: "cult", metadataURI: "uriA" });
        assets1[1] =
            IAlignmentRegistry.AlignmentAsset({ token: tokenB, symbol: "MIL", info: "milady", metadataURI: "uriB" });

        IAlignmentRegistry.AlignmentAsset[] memory assets2 = new IAlignmentRegistry.AlignmentAsset[](1);
        assets2[0] =
            IAlignmentRegistry.AlignmentAsset({ token: tokenA, symbol: "CULT", info: "second", metadataURI: "uriC" });

        vm.startPrank(daoOwner);
        uint256 t1 = legacy.registerAlignmentTarget("Remilia", "desc1", "meta1", assets1);
        uint256 t2 = legacy.registerAlignmentTarget("Second", "desc2", "meta2", assets2);
        legacy.addAmbassador(t1, ambassador);
        legacy.setCommunityPayout(t1, payoutAddr);
        vm.stopPrank();

        assertEq(t1, 1);
        assertEq(t2, 2);
        assertEq(legacy.nextAlignmentTargetId(), 2);

        // ── upgrade the SAME proxy to the NEW implementation ──
        AlignmentRegistryV1 newImpl = new AlignmentRegistryV1();
        vm.prank(daoOwner);
        legacy.upgradeToAndCall(address(newImpl), "");

        AlignmentRegistryV1 upgraded = AlignmentRegistryV1(proxy);

        // ── every pre-existing value must read back identical ──
        assertEq(upgraded.owner(), daoOwner, "owner preserved");
        assertEq(upgraded.nextAlignmentTargetId(), 2, "counter preserved");

        IAlignmentRegistry.AlignmentTarget memory target1 = upgraded.getAlignmentTarget(t1);
        assertEq(target1.id, 1);
        assertEq(target1.title, "Remilia");
        assertEq(target1.description, "desc1");
        assertEq(target1.metadataURI, "meta1");
        assertTrue(target1.active);

        IAlignmentRegistry.AlignmentTarget memory target2 = upgraded.getAlignmentTarget(t2);
        assertEq(target2.title, "Second");
        assertEq(target2.metadataURI, "meta2");

        IAlignmentRegistry.AlignmentAsset[] memory readAssets = upgraded.getAlignmentTargetAssets(t1);
        assertEq(readAssets.length, 2, "asset array length preserved");
        assertEq(readAssets[0].token, tokenA);
        assertEq(readAssets[0].symbol, "CULT");
        assertEq(readAssets[0].metadataURI, "uriA");
        assertEq(readAssets[1].token, tokenB);
        assertEq(readAssets[1].info, "milady");
        assertEq(readAssets[1].metadataURI, "uriB");

        address[] memory ambs = upgraded.getAmbassadors(t1);
        assertEq(ambs.length, 1);
        assertEq(ambs[0], ambassador);
        assertTrue(upgraded.isAmbassador(t1, ambassador));

        assertEq(upgraded.getCommunityPayout(t1), payoutAddr, "payout preserved");
        assertTrue(upgraded.isTokenInTarget(t1, tokenA));
        assertTrue(upgraded.isTokenInTarget(t1, tokenB));

        // ── the appended mapping is unset for every existing pair (fresh zero slot) ──
        IAlignmentRegistry.AcquireRoute memory unset = upgraded.getAcquireRoute(t1, tokenA);
        assertEq(uint256(unset.venue), uint256(IAlignmentRegistry.Venue.NONE), "appended slot starts empty");

        // ── the new surface works on the migrated proxy without touching old state ──
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: 3000, tickSpacing: 60, feeOrHook: 0
        });
        vm.prank(daoOwner);
        upgraded.setAcquireRoute(t1, tokenA, route);
        assertEq(uint256(upgraded.getAcquireRoute(t1, tokenA).venue), uint256(IAlignmentRegistry.Venue.UNI_V4));

        // old state still intact after writing the appended mapping
        assertEq(upgraded.getCommunityPayout(t1), payoutAddr, "payout intact after route write");
        assertEq(upgraded.getAlignmentTargetAssets(t1).length, 2, "assets intact after route write");
    }
}
