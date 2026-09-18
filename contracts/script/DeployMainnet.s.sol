// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";

/// @notice Mainnet deployment — populate _mainnetConfig() before use.
///         Run with: forge script script/DeployMainnet.s.sol --account <keystore> \
///                   --rpc-url mainnet --broadcast --verify
///
///         Every external address this deploys against is stated in `script/MainnetAddresses.sol`
///         and read from there, because `DeployAnvil` rehearses this deploy on a mainnet fork and
///         reads the same file. What is left here is what mainnet-the-deployment CHOOSES rather
///         than inherits: the salts, the governance Safe, the roster, and the oracle/pool params.
///
/// TODO before mainnet launch:
///   1. Mine vanity CREATE3 salts for the broadcasting address (script/salt-miner), and assert that
///      address in run() the way DeploySepolia asserts SepoliaSalts.DEPLOYER — CreateX reverts
///      `InvalidSalt` for any other sender, and a mismatch should surface in simulation.
///   2. Set real alignment targets (token addresses, vault flags)
///   3. Set cfg.safe to the real Gnosis Safe address — address(0) deploys a MockSafe
contract DeployMainnet is DeployCore {
    function run() public {
        vm.startBroadcast();
        deploy(msg.sender, _mainnetConfig());
        vm.stopBroadcast();
    }

    function _mainnetConfig() internal pure returns (NetworkConfig memory cfg) {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](0);
        // TODO: populate targets

        cfg.chainId = 1;
        cfg.weth = MainnetAddresses.WETH;
        cfg.v4PoolManager = MainnetAddresses.V4_POOL_MANAGER;
        cfg.v3Factory = MainnetAddresses.V3_FACTORY;
        cfg.v2Factory = MainnetAddresses.V2_FACTORY;
        cfg.cypherPositionManager = MainnetAddresses.CYPHER_POSITION_MANAGER;
        cfg.cypherRouter = MainnetAddresses.CYPHER_SWAP_ROUTER;
        cfg.cypherAlgebraFactory = MainnetAddresses.CYPHER_ALGEBRA_FACTORY;
        cfg.zamm = MainnetAddresses.ZAMM_V1;
        // The Aave endowment family. Unset gates the family off entirely (`DeployCore` treats a zero
        // stataToken as "this network has no endowment rail"), which is how it came to be missing
        // here while the mainnet-fork rehearsal wired it — the same omission noesis-404 found on
        // Sepolia. `cfg.aaveWeth` stays unset on purpose: this token's `asset()` IS canonical WETH,
        // so the field resolves back to `cfg.weth` and `deploy()` asserts the match.
        cfg.aaveStataToken = MainnetAddresses.WETH_STATA_TOKEN;
        cfg.zrouter = MainnetAddresses.ZROUTER;
        cfg.zQuoter = MainnetAddresses.ZQUOTER;
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
