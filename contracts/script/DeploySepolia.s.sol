// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { SepoliaSalts } from "./SepoliaSalts.sol";

/// @notice Deploys the full protocol to Sepolia.
///         Run with: forge script script/DeploySepolia.s.sol --account <keystore> \
///                   --rpc-url sepolia --broadcast --verify
///
///         The broadcasting address MUST be `SepoliaSalts.DEPLOYER`: it is embedded in every
///         CREATE3 salt as CreateX's permissioned-deploy guard, and CreateX reverts `InvalidSalt`
///         for any other sender. `run()` asserts it before broadcasting so the mismatch surfaces in
///         simulation rather than on chain.
contract DeploySepolia is DeployCore {
    function run() public {
        require(
            msg.sender == SepoliaSalts.DEPLOYER,
            "DeploySepolia: sender is not the deployer the salt set is bound to (see script/SepoliaSalts.sol)"
        );
        vm.startBroadcast();
        deploy(msg.sender, _sepoliaConfig());
        vm.stopBroadcast();
    }

    function _sepoliaConfig() internal pure returns (NetworkConfig memory cfg) {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](1);
        targets[0] = AlignmentTargetConfig({
            token: 0x779877A7B0D9E8603169DdbD7836e478b4624789, // LINK
            symbol: "LINK",
            name: "Chainlink",
            description: "Chainlink - Sepolia alignment target",
            deployUniVault: true,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: address(0) // set post-deploy
        });

        cfg.chainId = 11155111;
        cfg.weth = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
        cfg.v4PoolManager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        cfg.v3Factory = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
        cfg.v2Factory = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
        // Cypher has no known Sepolia deployment — leave UNWIRED. DeployCore omits the Cypher launch
        // deployer entirely (no functional-tag stub) rather than reuse mainnet Algebra addresses.
        cfg.cypherPositionManager = address(0);
        cfg.cypherRouter = address(0);
        cfg.cypherAlgebraFactory = address(0);
        // ZAMM + zRouter are canonical CREATE2 singletons (same address on every chain they're deployed to).
        cfg.zamm = 0x000000000000040470635EB91b7CE4D132D616eD; // V1
        cfg.zrouter = 0x000000000000FB114709235f1ccBFfb925F600e4; // canonical aggregator
        cfg.safe = address(0); // deploys MockSafe
        // Vanity CREATE3 salts. Single source: script/SepoliaSalts.sol — see that file for the
        // salt layout, the address derivation, and how to re-mine the set.
        cfg.saltMasterRegistry = SepoliaSalts.MASTER_REGISTRY;
        cfg.saltTreasury = SepoliaSalts.TREASURY;
        cfg.saltQueueManager = SepoliaSalts.QUEUE_MANAGER;
        cfg.saltGlobalMsgReg = SepoliaSalts.GLOBAL_MSG_REG;
        cfg.saltAlignmentReg = SepoliaSalts.ALIGNMENT_REG;
        cfg.saltComponentReg = SepoliaSalts.COMPONENT_REG;
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 30; // 0.3% — LOCKED (rth, 2026-07-10)
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/sepolia.json";
    }
}
