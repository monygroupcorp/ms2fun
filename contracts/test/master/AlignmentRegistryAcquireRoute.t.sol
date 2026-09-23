// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

/// @notice noesis-031 — owner-curated acquisition routing (setAcquireRoute / getAcquireRoute).
contract AlignmentRegistryAcquireRouteTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public cultToken = makeAddr("CULT");
    address public otherToken = makeAddr("OTHER");

    function setUp() public {
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(makeAddr("WETH"), address(0));
        address proxy = LibClone.deployERC1967(address(impl));
        registry = AlignmentRegistryV1(proxy);
        registry.initialize(daoOwner);
    }

    function _registerTarget() internal returns (uint256) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: cultToken, symbol: "CULT", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        return registry.registerAlignmentTarget("Remilia", "", "", assets);
    }

    function _uniRoute() internal pure returns (IAlignmentRegistry.AcquireRoute memory) {
        return IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: 3000, tickSpacing: 60, feeOrHook: 0
        });
    }

    // ── happy paths ────────────────────────────────────────────────────────────

    function test_SetAcquireRoute_UniV4_StoresAndEmits() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        vm.expectEmit(true, true, false, true);
        emit IAlignmentRegistry.AcquireRouteSet(targetId, cultToken, IAlignmentRegistry.Venue.UNI_V4);
        registry.setAcquireRoute(targetId, cultToken, _uniRoute());

        IAlignmentRegistry.AcquireRoute memory got = registry.getAcquireRoute(targetId, cultToken);
        assertEq(uint256(got.venue), uint256(IAlignmentRegistry.Venue.UNI_V4));
        assertEq(uint256(got.fee), 3000);
        assertEq(int256(got.tickSpacing), int256(60));
        assertEq(got.feeOrHook, 0);
    }

    function test_SetAcquireRoute_Zamm_Stores() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.ZAMM, fee: 0, tickSpacing: 0, feeOrHook: 100
        });

        vm.prank(daoOwner);
        registry.setAcquireRoute(targetId, cultToken, route);

        IAlignmentRegistry.AcquireRoute memory got = registry.getAcquireRoute(targetId, cultToken);
        assertEq(uint256(got.venue), uint256(IAlignmentRegistry.Venue.ZAMM));
        assertEq(got.feeOrHook, 100);
    }

    /// @dev The venue enum is NONE | UNI_V4 | ZAMM since CYPHER wound down and ALGEBRA was removed.
    ///      A word past the last member is refused in the ABI decode, before `setAcquireRoute` runs —
    ///      so a stale caller still naming the old ALGEBRA ordinal (3) cannot curate a target onto a
    ///      venue this protocol no longer has.
    function test_SetAcquireRoute_RetiredAlgebraOrdinalIsUndecodable() public {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        (bool ok,) = address(registry)
            .call(
                abi.encodeWithSignature(
                    "setAcquireRoute(uint256,address,(uint8,uint24,int24,uint256))",
                    targetId,
                    cultToken,
                    uint8(3),
                    0,
                    0,
                    0
                )
            );
        assertFalse(ok, "the retired ALGEBRA ordinal must not decode into a route");
    }

    function test_SetAcquireRoute_Update() public {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        registry.setAcquireRoute(targetId, cultToken, _uniRoute());

        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.ZAMM, fee: 0, tickSpacing: 0, feeOrHook: 42
        });
        vm.prank(daoOwner);
        registry.setAcquireRoute(targetId, cultToken, route);

        assertEq(uint256(registry.getAcquireRoute(targetId, cultToken).venue), uint256(IAlignmentRegistry.Venue.ZAMM));
    }

    // ── getter default ───────────────────────────────────────────────────────────

    function test_GetAcquireRoute_UnsetReturnsNone() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory got = registry.getAcquireRoute(targetId, cultToken);
        assertEq(uint256(got.venue), uint256(IAlignmentRegistry.Venue.NONE));
        assertEq(uint256(got.fee), 0);
        assertEq(int256(got.tickSpacing), int256(0));
        assertEq(got.feeOrHook, 0);
    }

    // ── auth / existence reverts ─────────────────────────────────────────────────

    function test_SetAcquireRoute_RevertIfNotOwner() public {
        uint256 targetId = _registerTarget();
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setAcquireRoute(targetId, cultToken, _uniRoute());
    }

    function test_SetAcquireRoute_RevertOnUnknownTarget() public {
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setAcquireRoute(999, cultToken, _uniRoute());
    }

    function test_SetAcquireRoute_RevertOnInactiveTarget() public {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setAcquireRoute(targetId, cultToken, _uniRoute());
    }

    function test_SetAcquireRoute_RevertOnTokenNotInTarget() public {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TokenNotInTarget.selector);
        registry.setAcquireRoute(targetId, otherToken, _uniRoute());
    }

    // ── route validation reverts ─────────────────────────────────────────────────

    function test_SetAcquireRoute_RevertUniV4ZeroFee() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: 0, tickSpacing: 60, feeOrHook: 0
        });
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidRoute.selector);
        registry.setAcquireRoute(targetId, cultToken, route);
    }

    function test_SetAcquireRoute_RevertUniV4ZeroTickSpacing() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: 3000, tickSpacing: 0, feeOrHook: 0
        });
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidRoute.selector);
        registry.setAcquireRoute(targetId, cultToken, route);
    }

    function test_SetAcquireRoute_RevertZammZeroFeeOrHook() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.ZAMM, fee: 0, tickSpacing: 0, feeOrHook: 0
        });
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidRoute.selector);
        registry.setAcquireRoute(targetId, cultToken, route);
    }

    function test_SetAcquireRoute_RevertNoneWithParams() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.NONE, fee: 1, tickSpacing: 0, feeOrHook: 0
        });
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidRoute.selector);
        registry.setAcquireRoute(targetId, cultToken, route);
    }
}
