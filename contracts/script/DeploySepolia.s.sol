// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { ChainConfig } from "../src/peripherals/zRouter.sol";
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
        // Aave endowment family. Sepolia's Aave V3 WETH market is fronted by Aave's own test WETH, so the
        // stataToken's `asset()` is that token and NOT the canonical Sepolia WETH set above. The endowment
        // family therefore gets its own WETH here; `cfg.weth` stays canonical, so every other family — and
        // a visitor arriving with canonical Sepolia WETH — is untouched. The vault wraps ETH internally
        // and both tokens expose a permissionless payable `deposit()`, so a visitor contributing ETH needs
        // neither token in hand.
        //
        // Mainnet carries no equivalent line: there the stataToken's `asset()` IS canonical WETH, so
        // `cfg.aaveWeth` stays unset and resolves back to `cfg.weth`. `DeployCore` asserts the match at
        // deploy on every network.
        cfg.aaveStataToken = 0x162B500569F42D9eCe937e6a61EDfef660A12E98; // stataEthWETH (StaticATokenLM)
        cfg.aaveWeth = 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c; // Aave's Sepolia test WETH
        // ZAMM is a canonical CREATE2 singleton (same address on every chain it's deployed to).
        cfg.zamm = 0x000000000000040470635EB91b7CE4D132D616eD; // V1
        // zRouter: SELF-DEPLOYED here rather than reusing a pre-existing Sepolia address.
        //
        // Neither router already on Sepolia is this repo's router. `0x0000…F600e4` predates `swapVZ`,
        // so every ZAMM leg reverts `Unauthorized()`; `0x4ABd…1CFB` binds the mainnet V4 PoolManager,
        // so every V4 acquire reverts. Deploying `src/peripherals/zRouter.sol` with the Sepolia
        // bindings below means the logic the showcase exercises is the logic mainnet runs, only
        // re-addressed — a rehearsal against it transfers.
        cfg.zrouter = address(0);
        cfg.zrouterChain = ChainConfig({
            weth: cfg.weth,
            // Uniswap V4 PoolManager, Sepolia.
            v4PoolManager: cfg.v4PoolManager,
            // Uniswap V3 factory, Sepolia. The pool init-code hash is the mainnet one: the factory
            // deploys the same pool bytecode, verified on chain by recomputing a live Sepolia pool's
            // CREATE2 address from this factory + hash and matching `getPool`.
            v3Factory: cfg.v3Factory,
            v3PoolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            // ── DARK LEGS ──────────────────────────────────────────────────────────────────────
            // No vault or showcase surface routes through V2 or Sushi here, and a V2 leg would need
            // its own pair init-code hash verified against whichever factory it bound. Left unbound;
            // the leg reverts. A Uniswap-V2 factory does exist on Sepolia (`cfg.v2Factory`, used by
            // the price validator) if the leg is ever lit.
            v2Factory: address(0),
            v2PoolInitCodeHash: bytes32(0),
            sushiFactory: address(0),
            sushiPoolInitCodeHash: bytes32(0),
            // ───────────────────────────────────────────────────────────────────────────────────
            // ZAMM V1 is deployed to the same canonical address on Sepolia and is byte-identical.
            zamm: cfg.zamm,
            // The hookless ZAMM predecessor has no Sepolia deployment — unbound, leg reverts.
            zamm0: address(0),
            // Lido has no Sepolia deployment under these addresses — unbound, leg reverts.
            steth: address(0),
            wsteth: address(0),
            // No canonical DAI on Sepolia — the DAI-permit path reverts.
            dai: address(0),
            // Permit2 is deployed to its canonical address on Sepolia.
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
            // NameNFT is mainnet-only — unbound, leg reverts.
            nameNft: address(0)
        });
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
