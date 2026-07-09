// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { UniAlignmentVault } from "src/vaults/uni/UniAlignmentVault.sol";
import { UniAlignmentVaultFactory } from "src/vaults/uni/UniAlignmentVaultFactory.sol";
import { UniswapVaultPriceValidator } from "src/peripherals/UniswapVaultPriceValidator.sol";
import { IVaultPriceValidator } from "src/interfaces/IVaultPriceValidator.sol";
import { zRouter } from "src/peripherals/zRouter.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "src/master/interfaces/IAlignmentRegistry.sol";
import { CREATEX } from "src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";

/**
 * @title VaultUniGraduationFork
 * @notice Exit #2 of the vault-flavors task: prove a wired UniswapV4LP vault adds a REAL on-chain V4
 *         liquidity position when its accumulated alignment ETH is converted — the full graduation/LP
 *         round-trip through the actual zRouter + the actual mainnet V4 PoolManager (not a stub).
 * @dev Uses the real Native ETH/USDC V4 0.3% pool (fee 3000 / tickSpacing 60), which exists with deep
 *      liquidity on the fork (see test/fork/v4/V4SwapRouting.t.sol), so no pool seeding is needed. The
 *      vault swaps ~50% of its pending ETH → USDC via the real zRouter, then adds full-range liquidity
 *      to that pool via PoolManager.modifyLiquidity. We assert the position exists on-chain.
 *
 *      Fork-gated: ForkTestBase.loadAddresses() calls vm.skip(true) when WETH has no code (i.e. no
 *      --fork-url), so this is inert in the default `forge test` run.
 *      Run: forge test --mp test/fork/VaultUniGraduationFork.t.sol --fork-url $MAINNET_RPC_URL -vv
 */
contract VaultUniGraduationForkTest is ForkTestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint256 constant TARGET_ID = 1;

    UniAlignmentVault vault;
    IPoolManager poolManager;
    address alignmentToken;
    address alice;

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork

        alignmentToken = USDC; // real token with a Native ETH/USDC V4 0.3% pool on mainnet
        alice = makeAddr("alice");
        vm.etch(alice, "");
        poolManager = IPoolManager(UNISWAP_V4_POOL_MANAGER);

        // CreateX is needed by the factory's CREATE3 deploy path.
        vm.etch(CREATEX, CREATEX_BYTECODE);

        // Real routing + price validator (as production deploys wire them).
        zRouter router = new zRouter();
        UniswapVaultPriceValidator priceValidator = new UniswapVaultPriceValidator(
            WETH, UNISWAP_V2_FACTORY, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800
        );

        MockAlignmentRegistry registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, alignmentToken, true);

        // Deploy the vault through the real factory (matches DeployCore) and wire the pool key the way
        // DeployCore now does — via the factory (the factory owns the vault).
        UniAlignmentVaultFactory factory = new UniAlignmentVaultFactory(
            WETH,
            UNISWAP_V4_POOL_MANAGER,
            address(router),
            FEE,
            TICK_SPACING,
            IVaultPriceValidator(address(priceValidator)),
            IAlignmentRegistry(address(registry)),
            address(0)
        );
        vault = UniAlignmentVault(
            payable(factory.deployVault(
                    keccak256("uni-grad-fork"), alignmentToken, TARGET_ID, IVaultPriceValidator(address(0))
                ))
        );
        factory.setVaultPoolKey(
            address(vault),
            PoolKey({
                currency0: Currency.wrap(address(0)), // native ETH < USDC → currency0
                currency1: Currency.wrap(alignmentToken),
                fee: FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(address(0))
            })
        );

        vm.label(address(vault), "UniAlignmentVault");
        vm.label(address(router), "zRouter");
    }

    /// @notice Full graduation/LP round-trip: contributions → convert → a live V4 position exists.
    function test_uniVaultGraduation_addsLiveV4Position() public {
        // Precondition sanity: the vault reports itself operationally liquidity-ready (O2 gate).
        assertTrue(vault.isLiquidityReady(), "vault must be liquidity-ready");
        assertEq(vault.totalLPUnits(), 0, "no LP position before conversion");

        // Alice routes alignment ETH into the vault (as an instance's alignment tax would).
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{ value: 5 ether }("");
        require(ok, "contribution failed");
        assertEq(vault.totalPendingETH(), 5 ether, "pending ETH tracked");

        // Convert: swap ~50% ETH → USDC via the real zRouter, add full-range liquidity to the real
        // Native ETH/USDC 0.3% V4 pool via PoolManager.modifyLiquidity.
        vault.convertAndAddLiquidity(1);

        // ── The vault booked LP units and Alice earned all the shares. ──
        uint256 lpUnits = vault.totalLPUnits();
        assertGt(lpUnits, 0, "vault must book LP units");
        assertGt(vault.benefactorShares(alice), 0, "contributor earns shares");
        assertEq(vault.totalPendingETH(), 0, "dragnet cleared");

        // ── The position is REAL: read it back from the V4 PoolManager. ──
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(alignmentToken),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        int24 tickLower = TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper = TickMath.maxUsableTick(TICK_SPACING);
        // Owner of the position is the vault (it calls modifyLiquidity in its own unlock callback);
        // salt 0, matching _addToLpPosition.
        (uint128 posLiquidity,,) =
            poolManager.getPositionInfo(key.toId(), address(vault), tickLower, tickUpper, bytes32(0));
        assertGt(posLiquidity, 0, "a live V4 position must exist on-chain for the vault");
        assertEq(uint256(posLiquidity), lpUnits, "on-chain position matches the vault's booked LP units");

        emit log_named_uint("Live V4 position liquidity", posLiquidity);
    }
}
