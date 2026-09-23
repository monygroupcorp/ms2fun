// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { FeatureUtils } from "../../src/master/libraries/FeatureUtils.sol";
import { IComponentRegistry } from "../../src/registry/interfaces/IComponentRegistry.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ZAMMLiquidityDeployerModule } from "../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { zRouter, mainnetChainConfig } from "../../src/peripherals/zRouter.sol";

/**
 * @title LaunchDeployerWiring
 * @notice The audit invariant for noesis-039: a production-shaped deploy must NEVER approve a
 *         MockComponentModule under the functional LIQUIDITY_DEPLOYER tag — an approved stub in a
 *         functional slot bricks ERC404 graduation. Also proves:
 *           - a configured zRouter singleton is REUSED (not a freshly-deployed throwaway).
 */
contract LaunchDeployerWiringTest is Test {
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    // Stub external addresses (no code needed at deploy time except WETH, which the price validator
    // ctor probes with a self-guarded code.length check).
    address constant WETH = address(0x7E7);
    address constant V4_PM = address(1);
    address constant ZAMM = address(0x2A11);

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint256 constant ZAMM_FEE_OR_HOOK = 30;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(WETH, RETURN_TRUE);
    }

    // ── Mainnet-shaped config: WETH + V4 + zamm + zrouter all configured. ──
    function _mainnetLikeConfig(address zrouterAddr) internal pure returns (DeployCore.NetworkConfig memory cfg) {
        cfg.chainId = 1;
        cfg.weth = WETH;
        cfg.v4PoolManager = V4_PM;
        cfg.zamm = ZAMM;
        cfg.zrouter = zrouterAddr;
        cfg.saltMasterRegistry = bytes32(uint256(1));
        cfg.saltTreasury = bytes32(uint256(2));
        cfg.saltQueueManager = bytes32(uint256(3));
        cfg.saltGlobalMsgReg = bytes32(uint256(4));
        cfg.saltAlignmentReg = bytes32(uint256(5));
        cfg.saltComponentReg = bytes32(uint256(6));
        cfg.priceDeviationBps = 500;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = FEE;
        cfg.zrouterTickSpacing = TICK_SPACING;
        cfg.zammFeeOrHook = ZAMM_FEE_OR_HOOK;
        cfg.alignmentTargets = new DeployCore.AlignmentTargetConfig[](0);
        cfg.jsonOutputPath = "";
    }

    /// @notice Mainnet-shaped deploy: all three LP deployers are the REAL modules, zero mocks under
    ///         LIQUIDITY_DEPLOYER, and the canonical zRouter is reused.
    function test_mainnetLike_allRealDeployers_noMockUnderFunctionalTag() public {
        zRouter canonical = new zRouter(mainnetChainConfig(), address(this));

        DeployCore s = new DeployCore();
        s.deploy(address(s), _mainnetLikeConfig(address(canonical)));

        // zRouter singleton reused, not freshly deployed.
        assertEq(address(s.zrouter()), address(canonical), "configured zRouter must be reused");

        address uni = s.moduleUniV4Deployer();
        address zamm = s.moduleZAMMDeployer();
        assertTrue(uni != address(0) && zamm != address(0), "both deployers built");

        // Each is the REAL module (a MockComponentModule has none of these getters → would revert).
        assertEq(LiquidityDeployerModule(payable(uni)).poolFee(), FEE, "uni deployer is the real module");
        assertEq(
            ZAMMLiquidityDeployerModule(payable(zamm)).feeOrHook(), ZAMM_FEE_OR_HOOK, "zamm deployer is the real module"
        );

        // The audit invariant: every approved LIQUIDITY_DEPLOYER is one of the real modules — no
        // MockComponentModule is approved under the functional tag.
        address[] memory deployers = IComponentRegistry(address(s.componentRegistry()))
            .getApprovedComponentsByTag(FeatureUtils.LIQUIDITY_DEPLOYER);
        assertEq(deployers.length, 2, "exactly the two real deployers approved");
        for (uint256 i = 0; i < deployers.length; i++) {
            assertTrue(
                deployers[i] == uni || deployers[i] == zamm,
                "no non-real (mock) module approved under LIQUIDITY_DEPLOYER"
            );
        }
    }

    /// @notice A deploy with no zRouter configured self-deploys one, and the LP deployers are still
    ///         the real modules rather than approved metadata stubs.
    function test_selfDeployedZRouter_deployersStayReal() public {
        DeployCore.NetworkConfig memory cfg = _mainnetLikeConfig(address(0));

        DeployCore s = new DeployCore();
        s.deploy(address(s), cfg);

        address uni = s.moduleUniV4Deployer();
        address zamm = s.moduleZAMMDeployer();

        address[] memory deployers = IComponentRegistry(address(s.componentRegistry()))
            .getApprovedComponentsByTag(FeatureUtils.LIQUIDITY_DEPLOYER);
        assertEq(deployers.length, 2, "only uni + zamm approved; no stub");
        for (uint256 i = 0; i < deployers.length; i++) {
            assertTrue(deployers[i] == uni || deployers[i] == zamm, "no stub approved under LIQUIDITY_DEPLOYER");
        }
        assertEq(LiquidityDeployerModule(payable(uni)).poolFee(), FEE, "uni deployer is the real module");
        assertEq(
            ZAMMLiquidityDeployerModule(payable(zamm)).feeOrHook(), ZAMM_FEE_OR_HOOK, "zamm deployer is the real module"
        );
    }
}
