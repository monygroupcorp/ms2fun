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
///   4. Choose cfg.hookFeeBips and cfg.lpFeeRate — the perpetual post-graduation swap tithe. Both are
///      left at zero here DELIBERATELY: the rate is immutable per hook (baked into its init code at
///      graduation), so it is an economic decision with no safe default, and Sepolia's 100 bips is a
///      testnet rehearsal figure rather than a proposal for this network. Zero is not inert — enabled
///      over a zero rate, every mainnet graduation mints a hook that takes nothing, forever, with no
///      revert to say so. `test/script/MainnetConfigCompleteness.t.sol` holds the gap open.
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
        // TODO 4: cfg.hookFeeBips / cfg.lpFeeRate — the perpetual swap tithe, left unchosen. See the
        // header. Turning the tithe ON is a separate governed call either way (script/
        // EnableAlignmentTithe.s.sol); this pair is only the rate it would be turned on at.
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/mainnet.json";
    }
}
