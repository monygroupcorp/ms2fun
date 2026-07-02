// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ForkTestBase } from "../../fork/helpers/ForkTestBase.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/**
 * @title LiquidityDeployerModuleGraduationFork
 * @notice Proves an ERC-404 Uni-V4 graduation completes end-to-end against the REAL mainnet V4
 *         PoolManager: the module wraps the raise into WETH, initializes a fresh pool, adds
 *         full-range liquidity, and settles the owed deltas without reverting.
 * @dev Reproduces the graduation settle bug fixed in LiquidityDeployerModule.unlockCallback: the
 *      module — not the bonding instance — holds both the LP tokens (transferred to it by
 *      ERC404BondingInstance.deployLiquidity) and the WETH (wrapped into itself before the unlock),
 *      so the V4 settle must pay from address(this). Before the fix, settle used ctx.instance and
 *      CurrencySettler took the transferFrom branch against an instance holding neither currency,
 *      reverting mid-settlement. This test drives deployLiquidity directly (minting the LP tokens to
 *      the module to mirror the instance transfer) and asserts a live V4 pool holds the liquidity.
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

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork
        poolManager = IPoolManager(UNISWAP_V4_POOL_MANAGER);

        // Fresh ERC-20 standing in for a graduating ERC-404 instance's LP tokens. No pre-existing V4
        // pool exists for it — the module initializes one at graduation, so nothing needs seeding.
        token = new MockERC20("Grad Token", "GRAD");
        module = new LiquidityDeployerModule(UNISWAP_V4_POOL_MANAGER, WETH, FEE, TICK_SPACING);

        vm.label(address(module), "LiquidityDeployerModule");
        vm.label(address(token), "GRAD");
    }

    /// @notice Graduating a Uni-V4 ERC-404 instance creates a real V4 pool that holds the LP.
    function test_graduation_createsLiveV4Pool_andSettlesWithoutReverting() public {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1_000_000e18; // liquidityReserve tokens

        // Mirror ERC404BondingInstance.deployLiquidity: LP tokens are transferred to the module, and
        // the ETH reserve is forwarded as msg.value. vault/treasury unset so no fee dispatch occurs.
        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);

        module.deployLiquidity{value: ethReserve}(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: address(0),
                vault: address(0),
                token: address(token),
                instance: address(this)
            })
        );

        // Rebuild the pool key exactly as the module orders currencies (token vs WETH by address).
        bool token0IsThis = Currency.wrap(address(token)) < Currency.wrap(WETH);
        PoolKey memory key = PoolKey({
            currency0:   token0IsThis ? Currency.wrap(address(token)) : Currency.wrap(WETH),
            currency1:   token0IsThis ? Currency.wrap(WETH)           : Currency.wrap(address(token)),
            fee:         FEE,
            tickSpacing: TICK_SPACING,
            hooks:       IHooks(address(0))
        });
        PoolId poolId = key.toId();

        // The pool was initialized (non-zero price) and holds the deployed liquidity.
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        assertGt(sqrtPriceX96, 0, "pool must be initialized");

        uint128 poolLiquidity = poolManager.getLiquidity(poolId);
        assertGt(poolLiquidity, 0, "a live V4 pool must hold the graduated LP");

        // Settlement transferred the module's WETH and LP tokens into the PoolManager. Full-range
        // liquidity math leaves at most a few wei of token dust on the module; effectively all of the
        // reserve was settled (this is what reverted before the payer fix).
        assertLt(token.balanceOf(address(module)), 1e6, "LP tokens settled into the pool (dust only)");

        emit log_named_uint("Live V4 pool liquidity", poolLiquidity);
    }
}
