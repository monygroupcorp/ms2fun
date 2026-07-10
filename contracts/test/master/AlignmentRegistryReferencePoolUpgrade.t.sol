// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { AlignmentRegistryV1Pre035 } from "./legacy/AlignmentRegistryV1Pre035.sol";
import { MockUniV3RefPool } from "./AlignmentRegistryReferencePool.t.sol";

/// @notice noesis-035 — LOAD-BEARING storage-layout proof for the appended `referencePools` mapping.
/// @dev Seeds curated targets/assets/ambassadors/payouts AND acquire routes against the PRE-noesis-035
///      implementation (AlignmentRegistryV1Pre035 — the exact layout deployed on origin/main, with
///      `acquireRoutes` as the last state var), upgrades the SAME proxy to the post-noesis-035
///      AlignmentRegistryV1 (which appends `referencePools` strictly after `acquireRoutes`), and asserts every
///      pre-existing value — crucially `getAcquireRoute` — reads back byte-for-byte identical. A layout break
///      in the appended mapping would silently corrupt curated routes behind the UUPS proxy; this fails loudly.
contract AlignmentRegistryReferencePoolUpgradeTest is Test {
    address public daoOwner = makeAddr("dao");
    address public weth = makeAddr("WETH");
    address public tokenA = makeAddr("CULT");
    address public tokenB = makeAddr("MILADY");
    address public ambassador = makeAddr("amb");
    address public payoutAddr = makeAddr("payout");

    function test_UpgradePreservesRoutesAndCuratedState() public {
        // ── deploy proxy on the OLD (pre-035) implementation ──
        AlignmentRegistryV1Pre035 oldImpl = new AlignmentRegistryV1Pre035();
        address proxy = LibClone.deployERC1967(address(oldImpl));
        AlignmentRegistryV1Pre035 legacy = AlignmentRegistryV1Pre035(proxy);
        legacy.initialize(daoOwner);

        // ── seed curated state: targets, assets, ambassador, payout ──
        IAlignmentRegistry.AlignmentAsset[] memory assets1 = new IAlignmentRegistry.AlignmentAsset[](2);
        assets1[0] =
            IAlignmentRegistry.AlignmentAsset({ token: tokenA, symbol: "CULT", info: "cult", metadataURI: "uriA" });
        assets1[1] =
            IAlignmentRegistry.AlignmentAsset({ token: tokenB, symbol: "MIL", info: "milady", metadataURI: "uriB" });

        vm.startPrank(daoOwner);
        uint256 t1 = legacy.registerAlignmentTarget("Remilia", "desc1", "meta1", assets1);
        uint256 t2 = legacy.registerAlignmentTarget("Second", "desc2", "meta2", assets1);
        legacy.addAmbassador(t1, ambassador);
        legacy.setCommunityPayout(t1, payoutAddr);

        // ── seed the LAST pre-035 slot: acquireRoutes (this is the slot the append sits behind) ──
        IAlignmentRegistry.AcquireRoute memory routeA = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: 3000, tickSpacing: 60, feeOrHook: 0
        });
        IAlignmentRegistry.AcquireRoute memory routeB = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.ZAMM, fee: 0, tickSpacing: 0, feeOrHook: 77
        });
        legacy.setAcquireRoute(t1, tokenA, routeA);
        legacy.setAcquireRoute(t1, tokenB, routeB);
        vm.stopPrank();

        assertEq(t1, 1);
        assertEq(t2, 2);

        // ── upgrade the SAME proxy to the NEW (post-035) implementation ──
        AlignmentRegistryV1 newImpl = new AlignmentRegistryV1(weth);
        vm.prank(daoOwner);
        legacy.upgradeToAndCall(address(newImpl), "");

        AlignmentRegistryV1 upgraded = AlignmentRegistryV1(proxy);

        // ── every pre-existing value must read back identical ──
        assertEq(upgraded.owner(), daoOwner, "owner preserved");
        assertEq(upgraded.nextAlignmentTargetId(), 2, "counter preserved");
        assertEq(upgraded.weth(), weth, "weth immutable set from new impl bytecode");

        IAlignmentRegistry.AlignmentTarget memory target1 = upgraded.getAlignmentTarget(t1);
        assertEq(target1.title, "Remilia");
        assertEq(target1.metadataURI, "meta1");
        assertTrue(target1.active);

        IAlignmentRegistry.AlignmentAsset[] memory readAssets = upgraded.getAlignmentTargetAssets(t1);
        assertEq(readAssets.length, 2, "asset array length preserved");
        assertEq(readAssets[0].token, tokenA);
        assertEq(readAssets[1].token, tokenB);
        assertEq(readAssets[1].metadataURI, "uriB");

        address[] memory ambs = upgraded.getAmbassadors(t1);
        assertEq(ambs.length, 1);
        assertEq(ambs[0], ambassador);
        assertEq(upgraded.getCommunityPayout(t1), payoutAddr, "payout preserved");
        assertTrue(upgraded.isTokenInTarget(t1, tokenA));

        // ── the pre-035 LAST slot (acquireRoutes) reads back identical after the append ──
        IAlignmentRegistry.AcquireRoute memory gotA = upgraded.getAcquireRoute(t1, tokenA);
        assertEq(uint256(gotA.venue), uint256(IAlignmentRegistry.Venue.UNI_V4), "acquireRoute A venue intact");
        assertEq(uint256(gotA.fee), 3000, "acquireRoute A fee intact");
        assertEq(int256(gotA.tickSpacing), int256(60), "acquireRoute A tickSpacing intact");

        IAlignmentRegistry.AcquireRoute memory gotB = upgraded.getAcquireRoute(t1, tokenB);
        assertEq(uint256(gotB.venue), uint256(IAlignmentRegistry.Venue.ZAMM), "acquireRoute B venue intact");
        assertEq(gotB.feeOrHook, 77, "acquireRoute B feeOrHook intact");

        // ── the appended mapping is unset for every existing pair (fresh zero slot) ──
        IAlignmentRegistry.ReferencePool memory unset = upgraded.getReferencePool(t1, tokenA);
        assertEq(unset.pool, address(0), "appended referencePools slot starts empty");
        assertEq(uint256(unset.kind), 0);
        assertEq(uint256(unset.twapWindow), 0);

        // ── the new surface works on the migrated proxy without disturbing old state ──
        MockUniV3RefPool pool = new MockUniV3RefPool(tokenA, weth);
        vm.prank(daoOwner);
        upgraded.setReferencePool(
            t1, tokenA, IAlignmentRegistry.ReferencePool({ pool: address(pool), kind: 0, twapWindow: 0 })
        );
        assertEq(upgraded.getReferencePool(t1, tokenA).pool, address(pool));

        // old state — including acquireRoutes — still intact after writing the appended mapping
        assertEq(
            uint256(upgraded.getAcquireRoute(t1, tokenA).venue),
            uint256(IAlignmentRegistry.Venue.UNI_V4),
            "acquireRoute intact after referencePool write"
        );
        assertEq(upgraded.getCommunityPayout(t1), payoutAddr, "payout intact after referencePool write");
        assertEq(upgraded.getAlignmentTargetAssets(t1).length, 2, "assets intact after referencePool write");
    }
}
