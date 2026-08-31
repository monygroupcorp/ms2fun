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
///
///         ── THE CYPHER RAIL IS SUPPLIED BY ENVIRONMENT, NOT BY A LITERAL ──
///
///         Sepolia carries no Algebra deployment of its own; one is stood up from mainnet bytecode by
///         `app/scripts/sepolia-algebra/`. Its three periphery addresses are therefore read from the
///         environment and default to `address(0)`, which `DeployCore` already reads as "this network
///         has no Cypher rail" and leaves the family unwired. One unchanged script then serves all
///         three callers: a deployment made before the standup, the fork rehearsal (which stands
///         Algebra up inside the fork and exports what it got), and the live deployment afterwards.
contract DeploySepolia is DeployCore {
    /// @dev The Algebra/Cypher periphery, once a standup exists. Unset = the rail stays unwired.
    string internal constant ENV_CYPHER_POSITION_MANAGER = "SEPOLIA_CYPHER_POSITION_MANAGER";
    string internal constant ENV_CYPHER_ROUTER = "SEPOLIA_CYPHER_ROUTER";
    string internal constant ENV_CYPHER_ALGEBRA_FACTORY = "SEPOLIA_CYPHER_ALGEBRA_FACTORY";

    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";
    /// @dev The vault-factory addresses `DeployCore`'s own output does not carry. See
    ///      `_writeVenueHandoff` for why this is a second file rather than a wider core.
    string internal constant VENUE_PATH = "./deployments/sepolia-venues.json";

    function run() public {
        require(
            msg.sender == SepoliaSalts.DEPLOYER,
            "DeploySepolia: sender is not the deployer the salt set is bound to (see script/SepoliaSalts.sol)"
        );
        vm.startBroadcast();
        deploy(msg.sender, _networkConfig());
        vm.stopBroadcast();
        _writeVenueHandoff();
    }

    /// @dev The config this script actually deploys: the network's fixed shape, plus the Cypher rail
    ///      the environment supplies.
    ///
    ///      The split is deliberate. `_sepoliaConfig()` stays a PURE statement of what is fixed about
    ///      this network — addresses, salts, tiers — so anything that wants to read the network's
    ///      shape can, without an environment. The three Algebra addresses are the only part of the
    ///      config that is not fixed: they do not exist until a standup has happened, and they are
    ///      different for a fork rehearsal than for the live network. Overlaying them here keeps the
    ///      environment read at the one call site that deploys, rather than in the description of the
    ///      network itself.
    function _networkConfig() internal view returns (NetworkConfig memory cfg) {
        cfg = _sepoliaConfig();
        cfg.cypherPositionManager = _envAddress(ENV_CYPHER_POSITION_MANAGER);
        cfg.cypherRouter = _envAddress(ENV_CYPHER_ROUTER);
        cfg.cypherAlgebraFactory = _envAddress(ENV_CYPHER_ALGEBRA_FACTORY);
    }

    /// @dev The ZAMM and Cypher vault FACTORIES, written beside the deployment file.
    ///
    ///      `DeployCore`'s own output publishes the Uni and Aave factories, because those are the two
    ///      a network deploys vaults from at deploy time. The Sepolia showcase deploys its ZAMM and
    ///      Cypher vaults from the SEED instead — its alignment tokens are fixtures the seed itself
    ///      mints, so they do not exist yet when `DeployCore` runs — and a factory address that is in
    ///      no file is not reachable by a later script. This writes the two the seed needs, in a
    ///      Sepolia-local file, so the cross-network core keeps one output shape.
    ///
    ///      Either address is zero when the network carries no such family: `cfg.zamm == 0` leaves the
    ///      ZAMM factory undeployed, and an unwired Cypher rail leaves the Cypher one undeployed. The
    ///      seed reads a zero as "this venue is not available here" and reports it rather than
    ///      reverting.
    function _writeVenueHandoff() internal {
        NetworkConfig memory cfg = _networkConfig();
        string memory root = "sepoliaVenueHandoff";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "zammVaultFactory", address(zammVaultFactory));
        vm.serializeAddress(root, "cypherVaultFactory", address(cypherVaultFactory));
        vm.serializeAddress(root, "cypherPositionManager", cfg.cypherPositionManager);
        vm.serializeAddress(root, "cypherRouter", cfg.cypherRouter);
        vm.serializeAddress(root, "cypherAlgebraFactory", cfg.cypherAlgebraFactory);
        vm.serializeAddress(root, "v3Factory", cfg.v3Factory);
        vm.serializeAddress(root, "zamm", cfg.zamm);
        string memory out = vm.serializeUint(root, "zammFeeOrHook", cfg.zammFeeOrHook);
        vm.writeJson(out, VENUE_PATH);
    }

    function _envAddress(string memory key) internal view returns (address) {
        return vm.envOr(key, address(0));
    }

    function _sepoliaConfig() internal pure returns (NetworkConfig memory cfg) {
        // NO DEPLOY-TIME ALIGNMENT TARGETS ON THIS NETWORK.
        //
        // The showcase's roster is six communities — Remilia, MS2, SPX6900, MOG, ZAMM and Cypher —
        // and every one of them is an Ethereum MAINNET token that does not exist here. A vault bound
        // to a mainnet address on Sepolia deploys happily and then fails at its first acquire, which
        // is a worse demonstration than none. So the roster is minted, registered, vaulted and given
        // depth by `SeedSepolia` as FIXTURE assets, each recording the real mainnet address it stands
        // in for. See `SeedSepoliaShared._alignmentRoster`.
        //
        // This list was previously one entry — LINK — which existed only so the per-target Aave
        // ENDOWMENT vault had something to hang on. That surface has a better home now: the endowment
        // vaults are stood up by the seed on the two roster rows that should carry one (Remilia and
        // MS2), so the wall no longer shows a target nothing aligns to and nobody chose.
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](0);

        cfg.chainId = 11155111;
        cfg.weth = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
        cfg.v4PoolManager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        cfg.v3Factory = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
        cfg.v2Factory = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
        // The Cypher rail's periphery is NOT fixed about this network: it does not exist until a
        // standup has happened, and it differs between a fork rehearsal and the live chain. It is
        // therefore left zero here and overlaid by `_networkConfig` from the environment. All three
        // unset is the pre-standup shape, and `DeployCore` reads it as "no Cypher rail on this
        // network": it omits the Cypher launch deployer and the Cypher vault factory entirely rather
        // than reusing mainnet Algebra addresses.
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
        cfg.jsonOutputPath = DEPLOYMENT_PATH;
    }
}
