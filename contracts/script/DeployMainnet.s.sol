// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";

/// @notice Mainnet deployment configuration.
///         Run with: forge script script/DeployMainnet.s.sol --account <keystore> \
///                   --rpc-url mainnet --broadcast --verify
///
///         Every external address this deploys against is stated in `script/MainnetAddresses.sol`,
///         which `DeployAnvil` reads too when it rehearses this deploy on a mainnet fork. What is set
///         here is what mainnet chooses rather than inherits: the salts, the governance Safe, the
///         roster, and the oracle/pool params.
///
///         Salts: one deployer and one salt set serve both chains. CreateX's guarded salt takes no
///         chain id (byte 20 is 0x00), so the same salt under the same deployer yields the same
///         address on every chain, and the CREATE2 proxy that collides is per-chain; a set spent on
///         Sepolia is unspent here. The set in `SepoliaSalts.sol` gives mainnet the addresses Sepolia
///         rehearsed. CreateX reverts `InvalidSalt` for any other sender.
///
///         `hookFeeBips` and `lpFeeRate` are zero: the rate is immutable per hook (baked into its
///         init code at graduation), so it is an economic choice with no safe default, and Sepolia's
///         100 bips is a testnet figure. Zero is not inert once the tithe is enabled: every
///         graduation then mints a hook that takes nothing, permanently, with no revert.
///         `test/script/MainnetConfigCompleteness.t.sol` holds the gap open.
contract DeployMainnet is DeployCore {
    function run() public {
        vm.startBroadcast();
        deploy(msg.sender, _mainnetConfig());
        vm.stopBroadcast();
    }

    function _mainnetConfig() internal pure returns (NetworkConfig memory cfg) {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](0);
        // The roster is empty.

        cfg.chainId = 1;
        cfg.weth = MainnetAddresses.WETH;
        cfg.v4PoolManager = MainnetAddresses.V4_POOL_MANAGER;
        cfg.v3Factory = MainnetAddresses.V3_FACTORY;
        cfg.v2Factory = MainnetAddresses.V2_FACTORY;
        cfg.zamm = MainnetAddresses.ZAMM_V1;
        // The Aave endowment family. A zero stataToken gates the family off entirely (`DeployCore`
        // reads it as "this network has no endowment rail"). `cfg.aaveWeth` is unset: this token's
        // `asset()` is canonical WETH, so the field resolves to `cfg.weth` and `deploy()` asserts the match.
        cfg.aaveStataToken = MainnetAddresses.WETH_STATA_TOKEN;
        cfg.zrouter = MainnetAddresses.ZROUTER;
        cfg.zQuoter = MainnetAddresses.ZQUOTER;
        cfg.safe = address(0); // address(0) deploys a MockSafe
        cfg.saltMasterRegistry = bytes32(0);
        cfg.saltTreasury = bytes32(0);
        cfg.saltQueueManager = bytes32(0);
        cfg.saltGlobalMsgReg = bytes32(0);
        cfg.saltAlignmentReg = bytes32(0);
        cfg.saltComponentReg = bytes32(0);
        cfg.priceDeviationBps = 500; // 5% — mainnet liquidity is deeper
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 30; // 0.3%; matches vault feeOrHook() and the Uni launch tier
        // cfg.hookFeeBips / cfg.lpFeeRate (the perpetual swap tithe) are zero; see the header. Enabling
        // the tithe is a separate governed call (script/EnableAlignmentTithe.s.sol); this pair is
        // only the rate it is enabled at.
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/mainnet.json";
    }
}
