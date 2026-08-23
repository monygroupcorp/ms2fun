// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
// The quoter lives in the shared anvil-seed surface rather than here: `forge script` resolves a
// script by its FILE, and a second concrete contract in this one makes that resolution ambiguous —
// the orchestrator's invocation names the path, not the contract.
import { AnvilFixedRouteQuoter, ArtistEndowments } from "./SeedAnvilShared.sol";
// Registry paperwork, not an asset: an endowment vault's `alignmentToken` exists only to satisfy
// `registerVault`'s check (the vault holds Aave-supplied WETH and never touches this token), and
// `initialize` refuses address(0). The Sepolia seed already stands its alignment tokens up the same
// way. Every surface that names one says FIXTURE, so nobody reads it as a real fan token.
import { MockERC20 } from "../test/mocks/MockERC20.sol";

/// @notice Deploys the full protocol to a local Anvil chain.
///         Called by deploy.mjs: forge script script/DeployAnvil.s.sol --broadcast
///         Writes deployments/anvil.json which deploy.mjs copies to
///         src/config/contracts.local.json for the frontend.
contract DeployAnvil is DeployCore {
    // Mainnet addresses available on an Anvil mainnet fork
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant V4_PM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant V2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    address constant MS2_TOKEN = 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820;
    address constant CULT_TOKEN = 0x0000000000c5dc95539589fbD24BE07c6C14eCa4;
    // Aave WETH StataTokenV2 (waEthWETH). = AaveV3EthereumAssets.WETH_STATA_TOKEN in the vendored
    // aave-dao/aave-address-book; pinned here (verified live on the fork) to avoid dragging the whole
    // Aave protocol into compilation for one address. Update from the address-book if Aave migrates.
    address constant WETH_STATA_TOKEN = 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202;
    // ZAMM singleton (mainnet) — present on the mainnet fork. Enables the ZAMM LP vault family.
    address constant ZAMM = 0x000000000000040470635EB91b7CE4D132D616eD;
    // Cypher = Algebra Integral on Ethereum mainnet (live — verified on the fork; addresses from the
    // camel404 mainnet deployment). Enables the Cypher LP vault family.
    address constant CYPHER_ALGEBRA_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;
    address constant CYPHER_POSITION_MANAGER = 0x0a984a446A116335ac90425d2D1E69A7199A2f7c;
    address constant CYPHER_SWAP_ROUTER = 0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        // The two artist targets' fixture tokens. Deployed here rather than pinned as constants
        // because there is nothing on mainnet to point at — an artist endowment is escrowed principal
        // streaming yield to a payout address, and the token is the one field the registry insists on.
        address paradilfToken = address(new MockERC20("Paradilf Fan Club Fixture", "PDLF"));
        address petravoiceToken = address(new MockERC20("Petravoice Fixture", "PTRA"));
        // The best-route quoter is OPERATOR INPUT and there is no canonical one on a local fork, so the
        // fork supplies its own. It must exist before `deploy` runs: every vault factory takes the
        // quoter as a CONSTRUCTOR immutable and threads it into each vault at deployVault time, and the
        // vault's own `setZQuoter` is owned by the factory, which exposes no passthrough — so this is
        // the only point in the lifecycle at which the acquisition venue is settable at all.
        address quoter = address(new AnvilFixedRouteQuoter(CULT_TOKEN));
        deploy(deployer, _anvilConfig(quoter, paradilfToken, petravoiceToken));
        vm.stopBroadcast();
    }

    /// @dev FOUR alignment targets, and the last two are the argument. One is a large community
    ///      token; two are individual artists, each carrying an Aave endowment vault and nothing else.
    ///      A reviewer should be able to read "this platform is for artist exaltation, and the large
    ///      community is one instance of that" off the target list alone, before opening a collection.
    ///
    ///      The artist targets deploy NO LP vault, on purpose. An endowment has no liquidity leg: it
    ///      supplies WETH to Aave and splits the yield between the benefactor's claimable purse and the
    ///      target's payout. Deploying a liquidity vault beside it would offer a venue nothing routes to.
    function _anvilConfig(address quoter, address paradilfToken, address petravoiceToken)
        internal
        view
        returns (NetworkConfig memory cfg)
    {
        AlignmentTargetConfig[] memory targets = new AlignmentTargetConfig[](4);
        targets[0] = AlignmentTargetConfig({
            token: MS2_TOKEN,
            symbol: "MS2",
            name: "Milady-Station-2",
            description: "MS2 community alignment target",
            deployUniVault: true,
            deployCypherVault: true,
            deployZAMMVault: true,
            // local-only deterministic placeholder community payout (a real deploy passes the actual address)
            communityPayout: address(uint160(uint256(keccak256(abi.encode("ms2.community", MS2_TOKEN)))))
        });
        targets[1] = AlignmentTargetConfig({
            token: CULT_TOKEN,
            symbol: "CULT",
            // CULT_TOKEN answers `name()` with "Milady Cult Coin" and `symbol()` with "CULT" — the
            // token is Remilia Corporation's own ERC20, not the unrelated token that shares the
            // symbol. `registerAlignmentTarget` seals the title at registration (`updateAlignmentTarget`
            // can change only the description and the metadata URI), so the label has to be right here.
            name: "Milady Cult Coin",
            description: "Remilia / Milady community alignment target",
            deployUniVault: true,
            deployCypherVault: true,
            deployZAMMVault: true,
            communityPayout: address(uint160(uint256(keccak256(abi.encode("ms2.community", CULT_TOKEN)))))
        });
        // ── The artist endowments ────────────────────────────────────────────────────────────────
        // The payout on each is a DERIVED FIXTURE keyed off the artist's slug — reproducible across
        // reseeds, owned by nobody, and never a real person's address. The token beside it is a
        // fixture too, and is described as one.
        targets[2] = AlignmentTargetConfig({
            token: paradilfToken,
            symbol: ArtistEndowments.PARADILF_SYMBOL,
            name: ArtistEndowments.PARADILF_TITLE,
            description: "An artist endowment. Collections bound here escrow permanent principal and stream its yield to the artist rather than buying a token. Demonstration target: the payout address and the alignment token are generated fixtures, not a real person's.",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PARADILF_SLUG)
        });
        targets[3] = AlignmentTargetConfig({
            token: petravoiceToken,
            symbol: ArtistEndowments.PETRAVOICE_SYMBOL,
            name: ArtistEndowments.PETRAVOICE_TITLE,
            description: "An artist endowment. Collections bound here escrow permanent principal and stream its yield to the artist they are aligned to. Demonstration target: the payout address and the alignment token are generated fixtures, not a real person's.",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PETRAVOICE_SLUG)
        });

        // Use timestamp-derived salts so repeated Anvil restarts don't collide
        cfg.chainId = block.chainid;
        cfg.weth = WETH;
        cfg.v4PoolManager = V4_PM;
        cfg.v3Factory = V3_FACTORY;
        cfg.v2Factory = V2_FACTORY;
        cfg.cypherAlgebraFactory = CYPHER_ALGEBRA_FACTORY; // Algebra Integral factory — live on the fork
        cfg.cypherPositionManager = CYPHER_POSITION_MANAGER; // Cypher (Algebra Integral) — live on the fork
        cfg.cypherRouter = CYPHER_SWAP_ROUTER;
        cfg.zamm = ZAMM; // ZAMM LP family — live on the mainnet fork
        cfg.aaveStataToken = WETH_STATA_TOKEN; // waEthWETH (mainnet fork)
        cfg.zrouter = address(0);
        // Best-route acquisition, pinned to the alignment token's deepest native-ETH V4 pool. Scoped to
        // that one token (see AnvilFixedRouteQuoter) — every other vault keeps the fixed-tier fallback
        // it has today, so this addition is inert for them.
        cfg.zQuoter = quoter;
        cfg.safe = address(0);
        // Sequential salts — unguarded so any address can call CreateX on local chain
        cfg.saltMasterRegistry = bytes32(uint256(keccak256(abi.encode(block.timestamp, "master"))));
        cfg.saltTreasury = bytes32(uint256(keccak256(abi.encode(block.timestamp, "treasury"))));
        cfg.saltQueueManager = bytes32(uint256(keccak256(abi.encode(block.timestamp, "queue"))));
        cfg.saltGlobalMsgReg = bytes32(uint256(keccak256(abi.encode(block.timestamp, "gmr"))));
        cfg.saltAlignmentReg = bytes32(uint256(keccak256(abi.encode(block.timestamp, "align"))));
        cfg.saltComponentReg = bytes32(uint256(keccak256(abi.encode(block.timestamp, "comp"))));
        // Mixed into the per-target vault salts so re-deploying onto the same fork doesn't collide.
        cfg.saltNonce = block.timestamp;
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 100; // ZAMM standard 1% pool fee selector (mainnet-shaped value confirmed pre-Phase-4)
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/anvil.json";
    }
}
