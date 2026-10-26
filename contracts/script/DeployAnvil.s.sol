// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DeployCore } from "./DeployCore.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";
// The quoter lives in the shared anvil-seed surface rather than here: `forge script` resolves a
// script by its FILE, and a second concrete contract in this one makes that resolution ambiguous —
// the orchestrator's invocation names the path, not the contract.
import { AnvilFixedRouteQuoter, ArtistEndowments } from "./SeedAnvilShared.sol";
// Registry paperwork, not an asset: an endowment vault's `alignmentToken` exists only to satisfy
// `registerVault`'s check (the vault holds Aave-supplied WETH and never touches this token), and
// `initialize` refuses address(0). Every surface that names one says FIXTURE.
import { MockERC20 } from "../test/mocks/MockERC20.sol";

/// @notice Deploys the full protocol to a local Anvil chain.
///         Called by deploy.mjs: forge script script/DeployAnvil.s.sol --broadcast
///         Writes deployments/anvil.json which deploy.mjs copies to
///         src/config/contracts.local.json for the frontend.
contract DeployAnvil is DeployCore {
    // The protocol rails this fork inherits from mainnet come from `script/MainnetAddresses.sol`,
    // the same file `DeployMainnet` reads, so the rehearsal and the deploy agree.
    //
    // The two token addresses below are this fork's alignment roster, a curation choice about what
    // to demonstrate, not a fact about the network.
    address constant MS2_TOKEN = 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820;
    address constant CULT_TOKEN = 0x0000000000c5dc95539589fbD24BE07c6C14eCa4;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        // The two artist targets' fixture tokens: deployed rather than pinned because there is no
        // mainnet token to point at, and the registry requires the field.
        address paradilfToken = address(new MockERC20("Paradilf Fan Club Fixture", "PDLF"));
        address petravoiceToken = address(new MockERC20("Petravoice Fixture", "PTRA"));
        // The best-route quoter is operator input and a local fork has no canonical one, so the fork
        // supplies its own. It must exist before `deploy` runs: every vault factory takes the quoter
        // as a constructor immutable and threads it into each vault at deployVault time, and the
        // vault's `setZQuoter` is owned by the factory, which exposes no passthrough.
        address quoter = address(new AnvilFixedRouteQuoter(CULT_TOKEN));
        deploy(deployer, _anvilConfig(quoter, paradilfToken, petravoiceToken));
        vm.stopBroadcast();
    }

    /// @dev Four alignment targets: two community tokens (MS2, CULT) and two individual artists,
    ///      each carrying an Aave endowment vault and nothing else.
    ///
    ///      The artist targets deploy no LP vault. An endowment has no liquidity leg: it supplies
    ///      WETH to Aave and splits the yield between the benefactor's claimable purse and the
    ///      target's payout, so a liquidity vault beside it would be a venue nothing routes to.
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
            deployZAMMVault: true,
            // local-only deterministic placeholder community payout (a real deploy passes the actual address)
            communityPayout: address(uint160(uint256(keccak256(abi.encode("ms2.community", MS2_TOKEN)))))
        });
        targets[1] = AlignmentTargetConfig({
            token: CULT_TOKEN,
            symbol: "CULT",
            // CULT_TOKEN answers `name()` with "Milady Cult Coin" and `symbol()` with "CULT". The title
            // is sealed at registration (`updateAlignmentTarget` changes only the description and the
            // metadata URI).
            name: "Milady Cult Coin",
            description: "Remilia / Milady community alignment target",
            deployUniVault: true,
            deployZAMMVault: true,
            communityPayout: address(uint160(uint256(keccak256(abi.encode("ms2.community", CULT_TOKEN)))))
        });
        // ── The artist endowments ────────────────────────────────────────────────────────────────
        // Each payout is a fixture derived from the artist's slug: reproducible across reseeds,
        // owned by nobody, never a real person's address. The token is a fixture too.
        targets[2] = AlignmentTargetConfig({
            token: paradilfToken,
            symbol: ArtistEndowments.PARADILF_SYMBOL,
            name: ArtistEndowments.PARADILF_TITLE,
            description: "An artist endowment. Collections bound here escrow permanent principal and stream its yield to the artist rather than buying a token. Demonstration target: the payout address and the alignment token are generated fixtures, not a real person's.",
            deployUniVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PARADILF_SLUG)
        });
        targets[3] = AlignmentTargetConfig({
            token: petravoiceToken,
            symbol: ArtistEndowments.PETRAVOICE_SYMBOL,
            name: ArtistEndowments.PETRAVOICE_TITLE,
            description: "An artist endowment. Collections bound here escrow permanent principal and stream its yield to the artist they are aligned to. Demonstration target: the payout address and the alignment token are generated fixtures, not a real person's.",
            deployUniVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PETRAVOICE_SLUG)
        });

        // Use timestamp-derived salts so repeated Anvil restarts don't collide
        cfg.chainId = block.chainid;
        cfg.weth = MainnetAddresses.WETH;
        cfg.v4PoolManager = MainnetAddresses.V4_POOL_MANAGER;
        cfg.v3Factory = MainnetAddresses.V3_FACTORY;
        cfg.v2Factory = MainnetAddresses.V2_FACTORY;
        cfg.zamm = MainnetAddresses.ZAMM_V1; // ZAMM LP family — live on the mainnet fork
        cfg.aaveStataToken = MainnetAddresses.WETH_STATA_TOKEN; // waEthWETH (mainnet fork)
        cfg.zrouter = address(0);
        // Best-route acquisition, pinned to the alignment token's deepest native-ETH V4 pool. Scoped to
        // that one token (see AnvilFixedRouteQuoter); every other vault uses the fixed-tier fallback.
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
        cfg.zammFeeOrHook = 100; // ZAMM standard 1% pool fee selector
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "./deployments/anvil.json";
    }
}
