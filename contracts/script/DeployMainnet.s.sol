// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";

/// @notice Mainnet deployment — populate _mainnetConfig() before use.
///         Run with: forge script script/DeployMainnet.s.sol --account <keystore> \
///                   --rpc-url mainnet --broadcast --verify
///
/// TODO before mainnet launch:
///   1. Mine vanity CREATE3 salts for deployer address
///   2. Set real alignment targets (token addresses, vault flags)
///   3. Set cfg.safe to the real Gnosis Safe address
contract DeployMainnet is DeployCore {
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant V4_PM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant V2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

    // ── ZAMM singleton (canonical CREATE2 deployment) — V1. Verified on a mainnet fork to answer the
    //    IZAMM.addLiquidity surface the ZAMMLiquidityDeployerModule compiles against (see
    //    test/fork/LaunchDeployerGraduationFork.t.sol). V0 is 0x00000000000008882D72EfA6cCE4B6a40b24C860.
    address constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;
    // ── zRouter canonical aggregator singleton — set so DeployCore reuses it instead of `new zRouter()`.
    address constant ZROUTER = 0x000000000000FB114709235f1ccBFfb925F600e4;
    // ── Cypher / Algebra (Ethereum mainnet). The launch deployer's ctor takes exactly
    //    (algebraFactory, positionManager/NFPM, weth); the swapRouter feeds the Cypher alignment vault.
    address constant CYPHER_ALGEBRA_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;
    address constant CYPHER_NFPM = 0x0a984a446A116335ac90425d2D1E69A7199A2f7c;
    address constant CYPHER_SWAP_ROUTER = 0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab;

    function run() public {
        vm.startBroadcast();
        deploy(msg.sender, _mainnetConfig());
        vm.stopBroadcast();
    }

    function _mainnetConfig() internal pure returns (NetworkConfig memory cfg) {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](0);
        // TODO: populate targets

        cfg.chainId = 1;
        cfg.weth = WETH;
        cfg.v4PoolManager = V4_PM;
        cfg.v3Factory = V3_FACTORY;
        cfg.v2Factory = V2_FACTORY;
        cfg.cypherPositionManager = CYPHER_NFPM;
        cfg.cypherRouter = CYPHER_SWAP_ROUTER;
        cfg.cypherAlgebraFactory = CYPHER_ALGEBRA_FACTORY;
        cfg.zamm = ZAMM_V1;
        cfg.zrouter = ZROUTER;
        cfg.safe = address(0); // TODO: real Safe address
        cfg.saltMasterRegistry = bytes32(0); // TODO: mine vanity salts
        cfg.saltTreasury = bytes32(0);
        cfg.saltQueueManager = bytes32(0);
        cfg.saltGlobalMsgReg = bytes32(0);
        cfg.saltAlignmentReg = bytes32(0);
        cfg.saltComponentReg = bytes32(0);
        cfg.priceDeviationBps = 500; // 5% — mainnet liquidity is deeper
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 30; // 0.3% — LOCKED (rth, 2026-07-10); matches vault feeOrHook() and Uni launch tier
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/mainnet.json";
    }
}
