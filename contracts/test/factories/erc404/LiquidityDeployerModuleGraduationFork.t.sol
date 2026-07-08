// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ForkTestBase } from "../../fork/helpers/ForkTestBase.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { zRouter } from "../../../src/peripherals/zRouter.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/**
 * @title LiquidityDeployerModuleGraduationFork
 * @notice Proves an ERC-404 Uni-V4 graduation completes end-to-end against the REAL mainnet V4
 *         PoolManager: the module initializes a fresh NATIVE-ETH pool, adds full-range liquidity,
 *         settles the owed deltas without reverting, and the pool is immediately tradable through
 *         the exact zRouter.swapV4 path the frontend uses.
 * @dev Covers two fixes in LiquidityDeployerModule:
 *      1. Settle payer — the module (not ctx.instance) holds both currencies at graduation (the
 *         instance transfers the LP tokens to the module; the ETH arrives as msg.value), so the V4
 *         settle must pay from address(this). Before the fix, settle used ctx.instance and
 *         CurrencySettler took the transferFrom branch against an instance holding neither currency,
 *         reverting mid-settlement.
 *      2. Native-ETH pool — graduation now pairs the token against native ETH (V4 currency
 *         address(0)), matching zRouter.swapV4(tokenIn=address(0)) and UniAlignmentVault. A
 *         WETH-keyed pool left the token untradeable (swapV4 reverted PoolNotInitialized) because the
 *         native-ETH pool key did not exist.
 *
 *      Fork-gated: ForkTestBase.loadAddresses() calls vm.skip(true) when WETH has no code (no
 *      --fork-url), so this is inert in the default `forge test` run.
 *      Run: forge test --fork-url "$MAINNET_RPC_URL" \
 *             --match-path test/factories/erc404/LiquidityDeployerModuleGraduationFork.t.sol -vvvv
 */
contract LiquidityDeployerModuleGraduationForkTest is ForkTestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    LiquidityDeployerModule module;
    IPoolManager poolManager;
    MockERC20 token;
    zRouter router;

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork
        poolManager = IPoolManager(UNISWAP_V4_POOL_MANAGER);

        // Fresh ERC-20 standing in for a graduating ERC-404 instance's LP tokens. No pre-existing V4
        // pool exists for it — the module initializes one at graduation, so nothing needs seeding.
        token = new MockERC20("Grad Token", "GRAD");
        // Registry stub returns registered=true for all — the two graduation cases below invoke the
        // module directly as the instance (instance == address(this) == msg.sender), so the strict
        // caller guard passes exactly as a real registered instance would at graduation.
        module = new LiquidityDeployerModule(
            UNISWAP_V4_POOL_MANAGER, WETH, FEE, TICK_SPACING, address(new MockMasterRegistry())
        );
        // Real zRouter (its V4_POOL_MANAGER constant is the mainnet PM) — the exact swap path the UI uses.
        router = new zRouter();

        vm.label(address(module), "LiquidityDeployerModule");
        vm.label(address(token), "GRAD");
        vm.label(address(router), "zRouter");
    }

    /// @notice Graduation creates a real NATIVE-ETH V4 pool, holds the LP, and is tradable via zRouter.
    function test_graduation_createsNativeV4Pool_holdsLP_andIsTradable() public {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1_000_000e18; // liquidityReserve tokens

        // Mirror ERC404BondingInstance.deployLiquidity: LP tokens are transferred to the module, and
        // the ETH reserve is forwarded as msg.value. vault/treasury unset so no fee dispatch occurs.
        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);

        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: address(0),
                vault: address(0),
                token: address(token),
                instance: address(this),
                creator: address(0),
                carveEth: 0
            })
        );

        // The graduated pool is keyed on NATIVE ETH (currency0 == address(0)), NOT WETH. address(0)
        // sorts below any token, so ETH is currency0 and the token is currency1.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        PoolId poolId = key.toId();

        assertEq(Currency.unwrap(key.currency0), address(0), "graduated pool must be native-ETH keyed");

        // The pool was initialized (non-zero price) and holds the deployed liquidity.
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        assertGt(sqrtPriceX96, 0, "native-ETH pool must be initialized");

        uint128 poolLiquidity = poolManager.getLiquidity(poolId);
        assertGt(poolLiquidity, 0, "a live V4 pool must hold the graduated LP");

        // A WETH-keyed pool must NOT exist — proving the deploy no longer creates the wrong pool.
        PoolKey memory wethKey = _wethKey();
        (uint160 wethSqrtPrice,,,) = poolManager.getSlot0(wethKey.toId());
        assertEq(wethSqrtPrice, 0, "no WETH-keyed pool should be created");

        // All LP tokens settled into the pool (a few wei of dust may remain from full-range math).
        assertLt(token.balanceOf(address(module)), 1e6, "LP tokens settled into the pool (dust only)");

        // ── The graduated pool is tradable through the exact frontend path: zRouter.swapV4 with a
        //    native-ETH input (tokenIn=address(0)) and a FINITE deadline (deadline==max is a Sushi
        //    selector in zRouter). This reverted PoolNotInitialized against a WETH-keyed pool. ──
        address buyer = makeAddr("buyer");
        uint256 ethIn = 0.5 ether;
        vm.deal(buyer, ethIn);
        vm.prank(buyer);
        (, uint256 amountOut) = router.swapV4{ value: ethIn }(
            buyer, // to
            false, // exactOut = false (exact ETH in)
            FEE,
            TICK_SPACING,
            address(0), // tokenIn = native ETH
            address(token), // tokenOut = graduated token
            ethIn, // swapAmount
            0, // amountLimit (min out)
            block.timestamp + 1 // finite deadline
        );

        assertGt(amountOut, 0, "swapV4 buy must return tokens from the graduated pool");
        assertEq(token.balanceOf(buyer), amountOut, "buyer received the swapped tokens");

        emit log_named_uint("Live V4 pool liquidity", poolLiquidity);
        emit log_named_uint("swapV4 amountOut (tokens for 0.5 ETH)", amountOut);
    }

    /// @notice Graduating WITH a creator carve on the real V4 PoolManager: the creator receives
    ///         80% of the carve, and the carved graduation still stands up a live pool.
    function test_graduation_withCarve_paysCreator_andPoolStillLive() public {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1_000_000e18;
        uint256 carve = 1 ether;
        address creator = makeAddr("carveCreator");

        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);

        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: address(0),
                vault: address(0),
                token: address(token),
                instance: address(this),
                creator: creator,
                carveEth: carve
            })
        );

        assertEq(creator.balance, 0.8 ether, "creator receives 80% of the carve");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        assertGt(poolManager.getLiquidity(key.toId()), 0, "carved graduation still stands up a live pool");
    }

    function _wethKey() internal view returns (PoolKey memory) {
        bool tokenIsCurrency0 = Currency.wrap(address(token)) < Currency.wrap(WETH);
        return PoolKey({
            currency0: tokenIsCurrency0 ? Currency.wrap(address(token)) : Currency.wrap(WETH),
            currency1: tokenIsCurrency0 ? Currency.wrap(WETH) : Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }
}
