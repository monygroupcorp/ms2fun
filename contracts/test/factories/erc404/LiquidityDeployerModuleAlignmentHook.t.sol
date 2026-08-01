// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";

/**
 * @title LiquidityDeployerModuleAlignmentHookTest
 * @notice noesis-117b default-profile unit tests for the alignment-hook TYPE-selection surface on the
 *         singleton LiquidityDeployerModule: the owner-only `setAlignmentHookFactory` / `setHookFeeBips`
 *         / `setLpFeeRate` setters, their defaults (OFF), bounds, events, and access control. The live
 *         graduation wiring (a real v4 pool getting a hook + DYNAMIC_FEE_FLAG) is proven end-to-end in the
 *         v4-profile fork test (test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol); this file needs no
 *         real PoolManager, so it runs in the default `forge test` run (poolManager == address(0)).
 */
contract LiquidityDeployerModuleAlignmentHookTest is Test {
    LiquidityDeployerModule module;
    MockMasterRegistry registry;

    address notOwner = makeAddr("notOwner");
    address factory = makeAddr("alignmentHookFactory");

    event AlignmentHookFactoryUpdated(address indexed factory);
    event HookFeeBipsUpdated(uint256 hookFeeBips);
    event LpFeeRateUpdated(uint24 lpFeeRate);

    function setUp() public {
        registry = new MockMasterRegistry();
        // poolManager address(0): these setters don't touch v4 (owner == this test contract).
        module = new LiquidityDeployerModule(address(0), address(0x3), 3000, 60, address(registry));
    }

    // ── Defaults: ships OFF, no tithe ────────────────────────────────────────

    function test_defaults_hookIsOff() public view {
        assertEq(module.alignmentHookFactory(), address(0), "alignment hook must default OFF (address(0))");
        assertEq(module.hookFeeBips(), 0, "hookFeeBips defaults 0");
        assertEq(module.lpFeeRate(), 0, "lpFeeRate defaults 0");
    }

    // ── setAlignmentHookFactory ──────────────────────────────────────────────

    function test_setAlignmentHookFactory_setsAndEmits() public {
        vm.expectEmit(true, false, false, false);
        emit AlignmentHookFactoryUpdated(factory);
        module.setAlignmentHookFactory(factory);
        assertEq(module.alignmentHookFactory(), factory, "factory selected");
    }

    function test_setAlignmentHookFactory_canDisableBackToOff() public {
        module.setAlignmentHookFactory(factory);
        module.setAlignmentHookFactory(address(0));
        assertEq(module.alignmentHookFactory(), address(0), "factory can be turned back OFF");
    }

    function test_setAlignmentHookFactory_onlyOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.setAlignmentHookFactory(factory);
    }

    // ── setHookFeeBips ───────────────────────────────────────────────────────

    function test_setHookFeeBips_setsAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit HookFeeBipsUpdated(100);
        module.setHookFeeBips(100);
        assertEq(module.hookFeeBips(), 100, "hookFeeBips set");
    }

    function test_setHookFeeBips_acceptsMax() public {
        module.setHookFeeBips(10_000);
        assertEq(module.hookFeeBips(), 10_000, "100% is the accepted ceiling");
    }

    function test_setHookFeeBips_revertsAboveMax() public {
        vm.expectRevert(LiquidityDeployerModule.HookFeeTooHigh.selector);
        module.setHookFeeBips(10_001);
    }

    function test_setHookFeeBips_onlyOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.setHookFeeBips(100);
    }

    // ── setLpFeeRate ─────────────────────────────────────────────────────────

    function test_setLpFeeRate_setsAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit LpFeeRateUpdated(3000);
        module.setLpFeeRate(3000);
        assertEq(module.lpFeeRate(), 3000, "lpFeeRate set");
    }

    function test_setLpFeeRate_acceptsMax() public {
        module.setLpFeeRate(LPFeeLibrary.MAX_LP_FEE);
        assertEq(module.lpFeeRate(), LPFeeLibrary.MAX_LP_FEE, "MAX_LP_FEE is the accepted ceiling");
    }

    function test_setLpFeeRate_revertsAboveMax() public {
        vm.expectRevert(LiquidityDeployerModule.LpFeeRateTooHigh.selector);
        module.setLpFeeRate(LPFeeLibrary.MAX_LP_FEE + 1);
    }

    function test_setLpFeeRate_onlyOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.setLpFeeRate(3000);
    }
}
