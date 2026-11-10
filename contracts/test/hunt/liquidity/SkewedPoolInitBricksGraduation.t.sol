// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";

import { MockVault } from "../../mocks/MockVault.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { RealMathV4PoolManager, FakeERC404Instance } from "../../audit/GraduationLpResidue.t.sol";

/**
 * @title SkewedPoolInitBricksGraduation
 * @notice Hunt hypothesis, liquidity lane. Graduation opens a v4 pool under a key a T4 can predict
 *         in advance: the currencies are fixed (native ETH + the instance token), `fee` and
 *         `tickSpacing` are module immutables, and while `alignmentHookFactory` is unset the hooks
 *         field is `address(0)`. V4 `initialize` is permissionless and one-way: a pool cannot be
 *         re-initialized, and its price cannot move before liquidity exists, because a swap into an
 *         empty pool reverts.
 *
 *         Claim: anyone who initializes that key at a price outside MAX_INIT_PRICE_DEVIATION_BPS
 *         permanently bricks the launch's graduation - every retry hits `PoolPriceMismatch`, and
 *         the raise stays trapped. The within-tolerance profit case is defended (residue returns);
 *         the extreme case is not recoverable by the instance at all.
 */
contract SkewedPoolInitBricksGraduationTest is Test {
    LiquidityDeployerModule internal module;
    RealMathV4PoolManager internal pm;
    FakeERC404Instance internal instance;
    MockVault internal vault;

    address internal treasury = makeAddr("treasury");
    address internal mallory = makeAddr("mallory"); // T4
    address internal constant CREATOR = address(0xC0FFEE);

    uint256 internal constant ETH_RESERVE = 25 ether;
    uint256 internal constant TOKEN_RESERVE = 1_000_000 ether;
    uint256 internal constant ETH_FOR_POOL = (ETH_RESERVE * 80) / 100;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    function setUp() public {
        pm = new RealMathV4PoolManager();
        MockMasterRegistry registry = new MockMasterRegistry();
        vault = new MockVault();
        instance = new FakeERC404Instance();
        module = new LiquidityDeployerModule(address(pm), address(0x3), POOL_FEE, TICK_SPACING, address(registry));
    }

    /// @dev The module's own graduation price for these params (token0IsThis == false).
    function _intendedSqrtPrice() internal pure returns (uint160) {
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(TOKEN_RESERVE, 1 << 192, ETH_FOR_POOL)));
    }

    /// @dev The key the deployer will assemble: public inputs only, so a T4 computes it exactly.
    function _predictedKey() internal view returns (PoolKey memory k) {
        k = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(instance)),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    function _graduate() internal {
        _fundGraduation();
        _callGraduate();
    }

    /// @dev Moves the coin and ETH in, WITHOUT calling graduate, so expectRevert can sit directly
    ///      on the graduation call itself.
    function _fundGraduation() internal {
        instance.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(instance), ETH_RESERVE);
    }

    function _callGraduate() internal {
        ILiquidityDeployerModule.DeployParams memory p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(instance),
            instance: address(instance),
            creator: CREATOR,
            carveEth: 0,
            excessEth: 0
        });
        instance.graduate(address(module), p, ETH_RESERVE);
    }

    /// @notice T4 initializes the predicted graduation pool at 9x the graduation price. Every
    ///         graduation attempt reverts PoolPriceMismatch, on the first try and on every retry,
    ///         and the pool keeps the attacker's price forever: the launch can never graduate.
    function test_T4_preInitSkewedPrice_bricksGraduationForever() public {
        uint160 attackerPrice = uint160(uint256(_intendedSqrtPrice()) * 3); // price x9, far outside 100 bps

        vm.prank(mallory);
        pm.initialize(_predictedKey(), attackerPrice);

        // Funds move in once; the revert leaves them in place, so each retry is a faithful
        // graduation attempt. expectRevert must sit directly on the graduation call.
        _fundGraduation();

        // First graduation: refused by the price band.
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        _callGraduate();

        // Retries, as an operator would after seeing the revert: same refusal, permanently. The
        // PoolPriceMismatch revert (not a fresh-pool success) also proves the predicted key is the
        // exact key the module assembles - a wrong guess would have left slot0 empty and graduation
        // would have succeeded.
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        _callGraduate();
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        _callGraduate();

        // The pool still holds the attacker's price: nothing moved it. slot0 of the mock manager.
        uint160 livePrice = uint160(uint256(vm.load(address(pm), bytes32(0))));
        assertEq(livePrice, attackerPrice, "attacker price is permanent - empty pool, no re-init path");

        // Concrete harm: the entire 25 ETH raise is stuck at the instance, graduated 0 ETH into the
        // venue, and the graduation rail paid nothing.
        assertEq(address(instance).balance, ETH_RESERVE, "raise still trapped at the instance");
        assertEq(address(pm).balance, 0, "no LP ever entered the pool");
        assertEq(address(module).balance, 0, "module holds nothing to salvage");
        assertEq(treasury.balance + address(vault).balance + CREATOR.balance, 0, "rail paid nothing");
    }

    /// @notice Control: with no pre-init, the same launch graduates fully, so the bricking above is
    ///         caused by the attacker's initialize and not by the test wiring.
    function test_control_freshPoolGraduates() public {
        _graduate();
        assertApproxEqAbs(address(pm).balance, ETH_FOR_POOL, 1000, "control: LP leg placed");
        assertEq(address(instance).balance, 0, "control: raise fully deployed");
    }
}
