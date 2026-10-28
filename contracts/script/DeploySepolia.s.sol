// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { ChainConfig } from "../src/peripherals/zRouter.sol";
import { SepoliaSalts } from "./SepoliaSalts.sol";
import { SepoliaRouteQuoter } from "./SepoliaRouteQuoter.sol";

/// @notice Deploys the full protocol to Sepolia.
///         Run with: forge script script/DeploySepolia.s.sol --account <keystore> \
///                   --rpc-url sepolia --broadcast --verify
///
///         The broadcasting address MUST be `SepoliaSalts.DEPLOYER`: it is embedded in every
///         CREATE3 salt as CreateX's permissioned-deploy guard, and CreateX reverts `InvalidSalt`
///         for any other sender. `run()` asserts it before broadcasting so the mismatch surfaces in
///         simulation rather than on chain.
contract DeploySepolia is DeployCore {
    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";
    /// @dev The vault-factory addresses `DeployCore`'s own output does not carry; see `_writeVenueHandoff`.
    string internal constant VENUE_PATH = "./deployments/sepolia-venues.json";

    function run() public {
        require(
            msg.sender == SepoliaSalts.DEPLOYER,
            "DeploySepolia: sender is not the deployer the salt set is bound to (see script/SepoliaSalts.sol)"
        );
        vm.startBroadcast();
        NetworkConfig memory cfg = _sepoliaConfig();
        // `cfg.zQuoter` is operator input elsewhere because other networks have a canonical quoter
        // to point at. Sepolia has none (see `SepoliaRouteQuoter`), so the network brings its own,
        // deployed here because `_sepoliaConfig()` is `pure` and states only what is fixed about
        // Sepolia.
        //
        // The route table starts empty, so every vault behaves as with no quoter wired until
        // `SeedSepolia` registers a route per roster token once its pool has depth.
        cfg.zQuoter = address(new SepoliaRouteQuoter(msg.sender));
        deploy(msg.sender, cfg);
        vm.stopBroadcast();
        _writeVenueHandoff();
    }

    /// @dev The ZAMM vault factory, written beside the deployment file.
    ///
    ///      `DeployCore`'s own output publishes the Uni and Aave factories, the two a network deploys
    ///      vaults from at deploy time. The Sepolia showcase deploys its ZAMM vaults from the seed,
    ///      whose alignment tokens are fixtures it mints itself, so the seed needs the factory address
    ///      in a Sepolia-local file and the cross-network core keeps one output shape.
    ///
    ///      The address is zero when `cfg.zamm == 0` leaves the ZAMM factory undeployed; the seed
    ///      reads a zero as "this venue is not available here" and reports it rather than reverting.
    function _writeVenueHandoff() internal {
        NetworkConfig memory cfg = _sepoliaConfig();
        string memory root = "sepoliaVenueHandoff";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "zammVaultFactory", address(zammVaultFactory));
        vm.serializeAddress(root, "v3Factory", cfg.v3Factory);
        vm.serializeAddress(root, "zamm", cfg.zamm);
        string memory out = vm.serializeUint(root, "zammFeeOrHook", cfg.zammFeeOrHook);
        vm.writeJson(out, VENUE_PATH);
    }

    function _sepoliaConfig() internal pure returns (NetworkConfig memory cfg) {
        // No deploy-time alignment targets on this network.
        //
        // The showcase roster (Remilia, MS2, SPX6900, MOG, ZAMM) is Ethereum mainnet tokens that do
        // not exist here, and a vault bound to a mainnet address on Sepolia fails at its first
        // acquire. `SeedSepolia` mints, registers, vaults and gives depth to fixture assets, each
        // recording the mainnet address it stands in for (`SeedSepoliaShared._alignmentRoster`).
        // The seed also stands up the endowment vaults, on the two roster rows that carry one
        // (Remilia and MS2).
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](0);

        cfg.chainId = 11155111;
        cfg.weth = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
        cfg.v4PoolManager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        cfg.v3Factory = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
        cfg.v2Factory = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
        // Aave endowment family. Sepolia's Aave V3 WETH market is fronted by Aave's own test WETH, so the
        // stataToken's `asset()` is that token and not the canonical Sepolia WETH set above. The endowment
        // family gets its own WETH; `cfg.weth` stays canonical for every other family. The vault wraps ETH
        // internally and both tokens expose a permissionless payable `deposit()`, so a visitor
        // contributing ETH needs neither token in hand. Mainnet leaves `cfg.aaveWeth` unset (its
        // `asset()` is canonical WETH); `DeployCore` asserts the match on every network.
        cfg.aaveStataToken = 0x162B500569F42D9eCe937e6a61EDfef660A12E98; // stataEthWETH (StaticATokenLM)
        cfg.aaveWeth = 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c; // Aave's Sepolia test WETH
        // ZAMM is a canonical CREATE2 singleton (same address on every chain it's deployed to).
        cfg.zamm = 0x000000000000040470635EB91b7CE4D132D616eD; // V1
        // zRouter: self-deployed. Neither router already on Sepolia is this repo's router:
        // `0x0000…F600e4` predates `swapVZ`, so every ZAMM leg reverts `Unauthorized()`; `0x4ABd…1CFB`
        // binds the mainnet V4 PoolManager, so every V4 acquire reverts. Deploying
        // `src/peripherals/zRouter.sol` with the Sepolia bindings below runs the mainnet logic
        // re-addressed.
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
            // ── Unbound legs (each reverts) ────────────────────────────────────────────────────
            // No vault or showcase surface routes through V2 or Sushi here, and a V2 leg would need
            // its own pair init-code hash verified against its factory. A Uniswap-V2 factory exists on
            // Sepolia (`cfg.v2Factory`, used by the price validator).
            v2Factory: address(0),
            v2PoolInitCodeHash: bytes32(0),
            sushiFactory: address(0),
            sushiPoolInitCodeHash: bytes32(0),
            // ───────────────────────────────────────────────────────────────────────────────────
            // ZAMM V1 is deployed to the same canonical address on Sepolia and is byte-identical.
            zamm: cfg.zamm,
            // The hookless ZAMM predecessor has no Sepolia deployment.
            zamm0: address(0),
            // Lido has no Sepolia deployment under these addresses.
            steth: address(0),
            wsteth: address(0),
            // No canonical DAI on Sepolia; the DAI-permit path reverts.
            dai: address(0),
            // Permit2 is deployed to its canonical address on Sepolia.
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
            // NameNFT is mainnet-only.
            nameNft: address(0)
        });
        cfg.safe = address(0); // deploys MockSafe
        // Vanity CREATE3 salts; script/SepoliaSalts.sol states the layout, the address derivation and the mining.
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
        cfg.zammFeeOrHook = 30; // 0.3%
        // ── The perpetual alignment tithe: its rate is seeded here, its switch is not ──────────────
        //
        // `DeployCore` copies both values onto the singleton `LiquidityDeployerModule` and leaves
        // `alignmentHookFactory` at `address(0)`, the module's off position, so until the switch is
        // thrown no graduation deploys a hook. Throwing it over a zero `hookFeeBips` would mint hooks
        // that take nothing on every swap, with no revert, so a rate has to sit under the switch.
        //
        // 100 bips is the testnet rehearsal rate, not a statement about mainnet's (see
        // `DeployMainnet` and `test/script/MainnetConfigCompleteness.t.sol`). The rate is immutable
        // per deployed hook (baked into its init code), so a change affects only hooks minted after
        // it; pools that already graduated keep the rate they were born with.
        //
        // `UniAlignmentVault.MIN_CONTRIBUTION` is 0.001 ETH, and the hook queues a take the vault
        // rejects rather than reverting the swap. At 100 bips, 0.1 ETH is the smallest swap whose
        // tithe reaches the vault in the swap's own transaction; below it the ETH lands in the
        // hook's `queuedFees` until `flushQueuedFees()` is called with the queue above the minimum.
        cfg.hookFeeBips = 100; // 1% of the ETH leg of every swap, to the pool's alignment vault
        // The dynamic LP fee the hook overrides the pool with. Matched to `cfg.zrouterFee`, the static
        // fee an untaxed graduation uses, so the hooked pool trades on the same 0.3% tier. A hooked
        // pool must carry a dynamic fee (v4 honors the hook's `beforeSwap` override on no other
        // kind), so the value is stated rather than inherited.
        cfg.lpFeeRate = 3000; // 0.3%
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = DEPLOYMENT_PATH;
    }
}
