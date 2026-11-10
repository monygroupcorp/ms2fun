// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { PoolSwapTest } from "../../../lib/v4-core/src/test/PoolSwapTest.sol";
import { UniTitheHookFactory } from "../../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { IAlignmentVault } from "../../../src/interfaces/IAlignmentVault.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";

/// @notice A graduation pool key initialized at a skewed price by a third party, before graduation, is
///         not permanent. The pool has no liquidity, so a swap of any size moves its price to the
///         swapper's `sqrtPriceLimitX96` for free, and graduation's 100 bps price band can be met
///         again. This holds for the hookless key and for the hooked key, whose hook anyone may deploy
///         ahead of graduation through the factory (the hook passes a zero-fill swap: the ETH-unspecified
///         shapes are taxed on ETH moved, and a fee that rounds to zero skips the fill check).
contract PreInitRecoverableRealV4Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    PoolSwapTest internal swapRouter;
    MockERC20 internal token;

    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal constant REGISTRY = address(0xDEAD);
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant TARGET = 79_228_162_514_264_337_593_543_950_336 / 32; // a graduation price (sqrt price 1/32)
    uint160 internal constant SKEWED = TARGET * 3; // price x9, far outside the band

    address internal attacker = makeAddr("attacker");
    address internal rescuer = makeAddr("rescuer");

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        token = new MockERC20("Launch", "LNCH");
    }

    function _restore(PoolKey memory key, uint160 target) internal {
        // Price is above target, so the move is price-down: zeroForOne. Exact input of one wei of ETH;
        // on the hooked key its tithe rounds to zero, so the hook's fill check does not apply.
        vm.deal(rescuer, 1 ether);
        vm.startPrank(rescuer);
        swapRouter.swap{ value: 1 }(
            key,
            IPoolManager.SwapParams({ zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: target }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        vm.stopPrank();
    }

    function test_Defended_hooklessSkewedPreInitIsRecoverable() public {
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        vm.prank(attacker);
        manager.initialize(key, SKEWED);

        _restore(key, TARGET);

        (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertEq(price, TARGET, "a one-wei swap on the empty pool resets its price to the graduation price");
    }

    function test_Defended_hookedSkewedPreInitIsRecoverable() public {
        UniTitheHookFactory factory =
            new UniTitheHookFactory(IPoolManager(address(manager)), WETH, address(this), REGISTRY);
        MockVault vault = new MockVault();

        // Anyone may deploy the graduation's hook ahead of it; graduation adopts it by init-code hash.
        vm.prank(attacker);
        address hook = factory.deployHook(
            IAlignmentVault(payable(address(vault))), address(0xBEEF), 100, 3000, address(token), TICK_SPACING
        );
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        vm.prank(attacker);
        manager.initialize(key, SKEWED);

        _restore(key, TARGET);

        (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertEq(price, TARGET, "the hook lets the zero-fill swap through, and the price is reset");
    }
}
