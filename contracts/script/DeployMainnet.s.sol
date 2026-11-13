// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";
import { SepoliaSalts } from "./SepoliaSalts.sol";

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
///         `hookFeeBips` / `lpFeeRate` (the perpetual swap tithe) ship LIVE at launch, matching
///         Sepolia's rehearsed rate: ruled 2026-11-10 (rth) — mainnet launches on 1% fees, not zero,
///         and not deferred to a later `EnableAlignmentTithe` switch-on. The rate is immutable per
///         hook, baked into its init code at graduation, so this is the number every pool graduating
///         from day one keeps for good.
contract DeployMainnet is DeployCore {
    function run() public {
        require(
            msg.sender == SepoliaSalts.DEPLOYER,
            "DeployMainnet: sender is not the deployer the salt set is bound to (see script/SepoliaSalts.sol)"
        );
        vm.startBroadcast();
        deploy(msg.sender, _mainnetConfig());
        vm.stopBroadcast();
    }

    // The curated launch roster: five communities, each already rehearsed on Sepolia under a
    // fixture standing in for the mainnet address below (`SeedSepoliaShared._alignmentRoster`).
    // Both vault families are opened for every target so a creator can align a collection to
    // either venue. `communityPayout` is left unset for all five: each is pinned on the registry
    // after deploy (`AlignmentRegistryV1.setCommunityPayout`), since a real-world payout address
    // is operator input a deploy script cannot derive.
    address internal constant CULT_TOKEN = 0x0000000000c5dc95539589fbD24BE07c6C14eCa4;
    address internal constant MS2_TOKEN = 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820;
    address internal constant SPX6900_TOKEN = 0xE0f63A424a4439cBE457D80E4f4b51aD25b2c56C;
    address internal constant MOG_TOKEN = 0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a;
    address internal constant ZAMM_TOKEN = 0xE9b1cFEA55BAA219e34301f2F31b9FD0921664ED;

    function _mainnetConfig() internal pure returns (NetworkConfig memory cfg) {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](5);
        targets[0] = AlignmentTargetConfig({
            token: CULT_TOKEN,
            symbol: "CULT",
            name: "Remilia",
            description: "Remilia Corporation's own token, and the community every collection on this platform descends from. A share of every aligned sale buys CULT and holds it as liquidity.",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        targets[1] = AlignmentTargetConfig({
            token: MS2_TOKEN,
            symbol: "MS2",
            name: "MS2",
            description: "This platform's own token. A share of every aligned sale buys MS2 and holds it as liquidity.",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        targets[2] = AlignmentTargetConfig({
            token: SPX6900_TOKEN,
            symbol: "SPX",
            name: "SPX6900",
            description: "A community a creator can align a collection to instead of the platform's own.",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        targets[3] = AlignmentTargetConfig({
            token: MOG_TOKEN,
            symbol: "MOG",
            name: "Mog Coin",
            description: "A community a creator can align a collection to instead of the platform's own.",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        targets[4] = AlignmentTargetConfig({
            token: ZAMM_TOKEN,
            symbol: "ZAMM",
            name: "ZAMM",
            description: "The token of the venue this platform already routes one of its vault families through.",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });

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
        cfg.safe = 0xBCE7DF8d399F145745C660DecB9ef50CA723d262; // 1-of-1 Safe, owner rth (0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6)
        cfg.saltMasterRegistry = SepoliaSalts.MASTER_REGISTRY;
        cfg.saltTreasury = SepoliaSalts.TREASURY;
        cfg.saltQueueManager = SepoliaSalts.QUEUE_MANAGER;
        cfg.saltGlobalMsgReg = SepoliaSalts.GLOBAL_MSG_REG;
        cfg.saltAlignmentReg = SepoliaSalts.ALIGNMENT_REG;
        cfg.saltComponentReg = SepoliaSalts.COMPONENT_REG;
        cfg.priceDeviationBps = 500; // 5% — mainnet liquidity is deeper
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 30; // 0.3%; matches vault feeOrHook() and the Uni launch tier
        cfg.hookFeeBips = 100; // 1% of the ETH leg of every swap, to the pool's alignment vault — live at launch, see header
        cfg.lpFeeRate = 3000; // 0.3%
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/mainnet.json";
    }
}
