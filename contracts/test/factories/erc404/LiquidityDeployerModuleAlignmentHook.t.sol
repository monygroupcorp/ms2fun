// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { UniAlignmentV4Hook } from "../../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
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

    function test_setLpFeeRate_acceptsTheCeiling() public {
        module.setLpFeeRate(module.MAX_LP_FEE_RATE());
        assertEq(module.lpFeeRate(), 10_000, "the 1% ceiling is the accepted maximum");
    }

    function test_setLpFeeRate_revertsAboveTheCeiling() public {
        uint24 justOver = module.MAX_LP_FEE_RATE() + 1;
        vm.expectRevert(LiquidityDeployerModule.LpFeeRateTooHigh.selector);
        module.setLpFeeRate(justOver);
    }

    /// @notice v4's own bound is a 100% LP fee, and this setter no longer reaches it. A rate that high
    ///         would mint a graduation pool priced shut on its first block.
    function test_setLpFeeRate_revertsAtTheV4Maximum() public {
        vm.expectRevert(LiquidityDeployerModule.LpFeeRateTooHigh.selector);
        module.setLpFeeRate(LPFeeLibrary.MAX_LP_FEE);
    }

    /// @notice The module's ceiling has to be a rate the hook will actually accept at construction. The
    ///         module restates the hook's number rather than importing it, so that it stays able to
    ///         select another hook type through `IAlignmentHookFactory` — and that restatement is only
    ///         safe if something fails when the two drift apart. What would otherwise go unnoticed is
    ///         not cosmetic: the hook's CONSTRUCTOR refuses an initial rate above its own ceiling, so a
    ///         module ceiling above the hook's would let governance store a rate that reverts
    ///         `deployHook` and with it every graduation, from a setter whose whole design is inert.
    ///
    /// @dev Proven by actually building the hook at the module's maximum rather than by comparing two
    ///      literals, so the assertion is "this deploys" and not "these match".
    function test_moduleCeilingIsARateTheHookWillDeployAt() public {
        // 0xCC = beforeSwap|afterSwap|beforeSwapReturnDelta|afterSwapReturnDelta, the permission bits the
        // hook's constructor validates against its own address.
        address hookAddr = address((uint160(0x4242) << 14) | uint160(0x00CC));
        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook",
            abi.encode(
                makeAddr("poolManager"), // the ctor only null-checks it, no call is made
                makeAddr("vault"),
                makeAddr("weth"),
                address(this), // owner
                makeAddr("benefactor"),
                uint256(100), // hookFeeBips — the separate, immutable ETH-leg tithe
                module.MAX_LP_FEE_RATE(), // the rate under test
                address(registry),
                makeAddr("poolToken"),
                int24(60) // poolTickSpacing
            ),
            hookAddr
        );

        UniAlignmentV4Hook hook = UniAlignmentV4Hook(payable(hookAddr));
        assertEq(hook.lpFeeRate(), module.MAX_LP_FEE_RATE(), "the module's maximum is a deployable initial rate");
        assertEq(
            hook.MAX_CONFIGURABLE_LP_FEE(),
            module.MAX_LP_FEE_RATE(),
            "module ceiling and deployed-hook ceiling must not drift"
        );
    }

    function test_setLpFeeRate_onlyOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.setLpFeeRate(3000);
    }
}
