// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1155Factory} from "../src/factories/erc1155/ERC1155Factory.sol";
import {ERC1155Instance} from "../src/factories/erc1155/ERC1155Instance.sol";
import {ERC721AuctionFactory} from "../src/factories/erc721/ERC721AuctionFactory.sol";
import {ERC721AuctionInstance} from "../src/factories/erc721/ERC721AuctionInstance.sol";
import {ERC404Factory} from "../src/factories/erc404/ERC404Factory.sol";
import {ERC404BondingInstance} from "../src/factories/erc404/ERC404BondingInstance.sol";
import {BondingCurveMath} from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import {FeaturedQueueManager} from "../src/master/FeaturedQueueManager.sol";
import {GlobalMessageRegistry} from "../src/registry/GlobalMessageRegistry.sol";
import {ProfileRegistry} from "../src/registry/ProfileRegistry.sol";
import {FreeMintParams} from "../src/interfaces/IFactoryTypes.sol";
import {GatingScope} from "../src/gating/IGatingModule.sol";
import {TierConfig} from "../src/gating/IPasswordTierGatingModule.sol";
import {IAlignmentVault} from "../src/interfaces/IAlignmentVault.sol";
import {TierRevealModule} from "../src/metadata/TierRevealModule.sol";
import {MetadataOverlayModule} from "../src/metadata/MetadataOverlayModule.sol";
import {Currency} from "v4-core/types/Currency.sol";

/// @dev Minimal Solady-Ownable surface — instances + registries all expose this single-step transfer.
interface IOwnable {
    function transferOwnership(address newOwner) external payable;
}

/// @dev Minimal owner surface for enriching a seeded alignment target's description + logo metadata.
interface IAlignmentTargetAdmin {
    function updateAlignmentTarget(uint256 targetId, string memory description, string memory metadataURI) external;
}

/// @dev Minimal MasterRegistry agent surface — setAgent is onlyOwner (the deployer, pre-handover).
interface IAgentRegistry {
    function setAgent(address agent, bool authorized) external;
    function isAgent(address agent) external view returns (bool);
}

/// @notice Anvil-only FULL-STATE seed: stands up demoable instances of every project type
///         (ERC1155 editions, ERC721 auctions, ERC404 bonding) plus profiles + activity, so the
///         discovery cards, trading surfaces, candles, staking, and profile pages all light up with
///         real on-chain state. Runs AFTER DeployAnvil; reads the deployed addresses from
///         deployments/anvil.json. All metadata is backend-free — inline `data:` JSON with inline
///         `data:` SVG images, so the seed needs no IPFS/network and renders offline. NEVER part of
///         a production deploy (DeployCore stays clean); this lives only in the local dev bridge.
///
///         TIME MODEL: vm.warp is a NO-OP under --broadcast (it advances only the script's in-memory
///         EVM, not the live chain), so this seed NEVER warps. Every instance is created with time
///         OFFSETS relative to seed-time T0 (open +1h, gallery duration 1h, maturity +90m, etc.), and
///         `deploy.ts` advances the anvil chain by +2h afterward (evm_increaseTime) so the
///         ended/open/matured states materialize. The frontend countdown is chain-anchored (useNowSec
///         reads block.timestamp) so the UI agrees with the advanced chain. Net result after +2h:
///         gallery auctions ended (settle-ready + no-bid), live auctions active, ember preopen,
///         vapor mid-curve (bonding + staking), cinder bonding + matured (graduate unlocked).
contract SeedAnvil is Script {

    // Well-known Anvil account #1 (public test key) — used to seed a second, non-deployer actor.
    uint256 constant ACCOUNT_1_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    // Agent-delegation demo (pre-testnet confirmation): the AGENT is an authorized delegate that
    // creates a collection ON BEHALF OF the PERSON, who ends up owning it. Anvil accounts #3 (agent)
    // and #2 (person) — well-known public test keys.
    uint256 constant AGENT_KEY =
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    address constant AGENT = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // anvil #3
    address constant PERSON = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // anvil #2

    // The team's testing wallet. After the deployer finishes all owner-only seeding, ownership of
    // every seeded instance + the platform registries is handed to ADMIN so it can drive the creator
    // admin + (future) protocol-admin console from the UI. Anvil-only — DeployCore stays untouched.
    address constant ADMIN = 0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86;

    // Every seeded instance, accumulated as they're created, so _transferAdmin can hand them over.
    address[] private _instances;

    // Deployed addresses (read from anvil.json in run()).
    struct Deployed {
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        ERC404Factory erc404;
        ProfileRegistry profiles;
        FeaturedQueueManager queue;
        GlobalMessageRegistry messages;
        address vault;          // first Uni LP vault — generic contract vault
        address zammVault;      // first ZAMM LP vault
        address cypherVault;    // first Cypher (Algebra) LP vault
        address endowmentVault; // first Aave endowment vault
        address stakingModule;  // ERC404StakingModule (approved STAKING component)
        address zammDeployer;   // ModuleZAMMDeployer (approved LIQUIDITY_DEPLOYER)
        address uniDeployer;    // ModuleUniV4Deployer (approved LIQUIDITY_DEPLOYER)
        address cypherDeployer; // ModuleCypherDeployer (approved LIQUIDITY_DEPLOYER)
        address resolverRouter; // MetadataResolverRouter (approved RESOLVER)
        address overlay;        // MetadataOverlayModule (approved OVERLAY)
        address tier;           // TierRevealModule (approved TIER)
        address alignmentRegistry; // AlignmentRegistryV1 proxy (target curation)
        address master;         // MasterRegistryV1 proxy (agent authorization; deployer-owned pre-handover)
    }

    uint256 deployerKey;
    address deployer;
    address acct1;

    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        acct1 = vm.addr(ACCOUNT_1_KEY);

        Deployed memory d = _readDeployed();

        // ── Phase A: ERC1155 editions + profiles + activity (the original seed, enriched) ──
        address c0 = _seedErc1155(d);

        // TIME MODEL: vm.warp is a NO-OP under --broadcast (it advances only the script's in-memory
        // EVM, never the live chain). So this seed never warps — every instance is created with time
        // OFFSETS relative to seed-time T0, and deploy.ts advances the anvil chain by +2h afterward
        // (evm_increaseTime) so the ended/open/matured states materialize. The UI's countdown is
        // chain-anchored (useNowSec reads block.timestamp), so it agrees with the advanced chain.
        // Order below is no longer time-sensitive.

        // ── ERC721 gallery (1h duration -> ENDED after the +2h advance: settle-ready + no-bid) ──
        _seedErc721Gallery(d);

        // ── ERC404 bonding — preopen + mid-curve(+staking) + ready-to-graduate ──
        _seedErc404PreOpen(d);
        _seedErc404MidCurve(d);
        _seedErc404ReadyToGraduate(d);

        // ── ERC404 with a stacked metadata-resolution stack (overlay + tier) ──
        _seedErc404Stacked(d);

        // ── ERC721 live (1-day duration -> stays ACTIVE after the advance) ──
        _seedErc721Live(d);

        // Second profile + activity (independent of the time model).
        vm.startBroadcast(ACCOUNT_1_KEY);
        d.profiles.setProfile(_profileMeta(
            "Vela", "vela",
            "Collector. Aligned to the cult.", ART_AVATAR_2));
        _post(d.messages, acct1, "minted from monolith. clean.");
        _post(d.messages, c0, "grabbed one from neon-drift. love the aberration.");
        // Varied-value posts so the post-threshold lever (admin panel) has something to filter.
        _postValued(d.messages, acct1, "staking rewards are underrated. ape responsibly.", 0.02 ether);
        _postValued(d.messages, c0, "signal boost - this one earns the front page.", 0.25 ether);
        vm.stopBroadcast();

        // Give the alignment targets a description + logo (Vaults-page targets section).
        _enrichAlignmentTargets(d);

        // Agent-delegation confirmation: an authorized agent creates a collection FOR a person.
        _seedAgentDemo(d);

        // Hand everything to the team's testing wallet (LAST — after all owner-only seeding).
        _transferAdmin(d);

        console.log("=== SeedAnvil complete ===");
        console.log("ERC1155: 3 collections (neon-drift, monolith, ghost-mint[free-claim]) w/ editions");
        console.log("ERC721 : 2 auctions (gallery=settled+expired, live=active+bid)");
        console.log("ERC404 : preopen(cypher) + mid-curve+staking(uniV4) + 2 ready-to-graduate (cinder=uniV4, molten=zamm) + stacked(zamm)");
        console.log("Vaults : all 4 flavors used (aave/uni/zamm/cypher); AMMs: all 3 (uniV4/zamm/cypher)");
        console.log("Profiles: 2 (MS2 Labs, Vela) + activity. block.timestamp now:", block.timestamp);
    }

    /// @dev Hand ownership of every seeded INSTANCE to ADMIN (the testing wallet) + fund it, so it
    ///      drives creator admin from the UI. Runs LAST, as the deployer, after all owner-only seeding
    ///      (instances use Solady's single-step transferOwnership).
    ///
    ///      The platform REGISTRIES (MasterRegistry/Alignment/Component/FeaturedQueue) are UUPS proxies
    ///      that override transferOwnership to force the 2-step `requestOwnershipHandover` flow — which
    ///      the NEW owner must initiate, and we don't hold ADMIN's key here. So protocol-admin
    ///      ownership is deferred to Phase 3 (handled via anvil impersonation in deploy.ts, or by ADMIN
    ///      requesting the handover from the admin console). The deployer stays the protocol owner.
    function _transferAdmin(Deployed memory) internal {
        vm.startBroadcast(deployerKey);
        // Fund ADMIN so it can pay gas + value actions (queuePiece deposit, bids, buys) immediately.
        (bool funded,) = ADMIN.call{value: 50 ether}("");
        require(funded, "fund ADMIN failed");
        for (uint256 i = 0; i < _instances.length; i++) {
            IOwnable(_instances[i]).transferOwnership(ADMIN);
        }
        vm.stopBroadcast();
        console.log("Handed", _instances.length, "instances (creator admin) + 50 ETH to ADMIN:");
        console.log(ADMIN);
    }

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile("./deployments/anvil.json");
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        d.erc721  = ERC721AuctionFactory(vm.parseJsonAddress(json, ".factories.ERC721"));
        d.erc404  = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.profiles = ProfileRegistry(vm.parseJsonAddress(json, ".contracts.ProfileRegistry"));
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.zammDeployer  = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        d.uniDeployer   = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.cypherDeployer = vm.parseJsonAddress(json, ".contracts.ModuleCypherDeployer");
        d.resolverRouter = vm.parseJsonAddress(json, ".contracts.MetadataResolverRouter");
        d.overlay        = vm.parseJsonAddress(json, ".contracts.MetadataOverlayModule");
        d.tier           = vm.parseJsonAddress(json, ".contracts.TierRevealModule");
        // Resolve the seed's vaults by FAMILY via DeployCore's convenience pointers, not by index
        // into the `vaults` array — that array's ordering shifts as LP families (ZAMM/Cypher) are
        // enabled per network, so a fixed index silently binds to the wrong vault type.
        d.vault = vm.parseJsonAddress(json, ".contracts.SeedUniVault");
        d.zammVault = vm.parseJsonAddress(json, ".contracts.SeedZammVault");
        d.cypherVault = vm.parseJsonAddress(json, ".contracts.SeedCypherVault");
        d.endowmentVault = vm.parseJsonAddress(json, ".contracts.SeedAaveVault");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.master = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
    }

    /// @dev Enrich the two seeded alignment targets (registered by DeployCore with empty metadataURI)
    ///      with a richer description + a logo, so the Vaults-page "Alignment targets" section has
    ///      something to show. Targets are ids 1 (MS2) + 2 (CULT); deployer still owns the registry at
    ///      seed time (protocol-admin handover is deferred — see _transferAdmin).
    function _enrichAlignmentTargets(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        IAlignmentTargetAdmin reg = IAlignmentTargetAdmin(d.alignmentRegistry);
        string memory ms2 =
            "The MS2 community and its milady-descended aesthetic. Collections aligned here route ~20% of every fee into the MS2 token, by contract.";
        string memory cult =
            "Cult DAO and its ragequit-native treasury. Aligned collections bind ~20% of their fees to the CULT token, forever.";
        reg.updateAlignmentTarget(1, ms2, _collectionMeta("Milady-Station-2", ms2, ART_AVATAR_1));
        reg.updateAlignmentTarget(2, cult, _collectionMeta("Cult-DAO", cult, ART_AVATAR_2));
        vm.stopBroadcast();
    }

    /// @dev Pre-testnet agent-delegation confirmation, exercised against the REAL MasterRegistryV1:
    ///      the deployer (registry owner, pre-handover) authorizes AGENT, then AGENT creates an ERC404
    ///      collection with `owner = PERSON`. The factory's agent-on-behalf path requires the caller to
    ///      be a registered agent whenever `msg.sender != owner`, and hands a fully PERSON-owned
    ///      collection back. NOT pushed to `_instances` — PERSON owns it, not ADMIN, which is the point.
    function _seedAgentDemo(Deployed memory d) internal {
        // 1. Owner authorizes the agent (deployer still owns MasterRegistry at seed time).
        vm.startBroadcast(deployerKey);
        IAgentRegistry(d.master).setAgent(AGENT, true);
        vm.stopBroadcast();

        // 2. The agent creates a collection FOR the person (owner = PERSON, caller = AGENT).
        vm.startBroadcast(AGENT_KEY);
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, "agent-commission")),
            name: "agent-commission",
            symbol: "COMM",
            styleUri: "",
            tokenBaseURI: "",
            owner: PERSON,
            vault: d.vault,
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0)
        });
        address instance = d.erc404.createInstance(
            params,
            _collectionMeta(
                "Agent Commission",
                "Commissioned via an authorized agent on behalf of a collector. The agent created it; the collector owns it.",
                ART_SLAB
            ),
            d.uniDeployer,
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        );
        vm.stopBroadcast();

        // 3. Confirm the wiring: the person owns it, and it is flagged agent-created.
        ERC404BondingInstance inst = ERC404BondingInstance(payable(instance));
        require(inst.owner() == PERSON, "agent demo: person must own the agent-created collection");
        require(inst.agentDelegationEnabled(), "agent demo: instance must be flagged agent-created");
        require(IAgentRegistry(d.master).isAgent(AGENT), "agent demo: agent must be authorized");
        console.log("Agent-created collection (owned by PERSON):", instance);
        console.log("  agent:", AGENT, "person:", PERSON);
    }

    // ─────────────────────────── Phase A: ERC1155 ───────────────────────────

    /// @dev Creates the 3 original collections, gives each real editions, makes ghost-mint a
    ///      free-claim collection, features them, seeds the endowment, and writes the deployer
    ///      profile + activity. Returns c0 (used by later activity posts).
    function _seedErc1155(Deployed memory d) internal returns (address c0) {
        vm.startBroadcast(deployerKey);

        // c0 binds to the Aave ENDOWMENT vault so its collection page shows the endowment panel.
        c0 = _createCollection(d.erc1155, d.endowmentVault, 0,
            "neon-drift", "Neon Drift",
            "Generative monochrome fragments. An edition aligned to the MS2 community.", ART_NEON_DRIFT, 0);
        address c1 = _createCollection(d.erc1155, d.vault, 1,
            "monolith", "Monolith",
            "One slab, many hands. A minimalist open edition.", ART_MONOLITH, 0);
        // c2: free-claim. allocation=5 reserved free mints, configured at creation by the factory
        // (initializeFreeMint is onlyFactory — it is NOT called post-create from this script).
        address c2 = _createCollection(d.erc1155, d.vault, 2,
            "ghost-mint", "Ghost Mint",
            "Faint signals from the fossil layer. Free-claim editions.", ART_GHOST_MINT, 5);

        // Editions. basePrice must be > 0 even for the free-claim collection (addEdition reverts on
        // zero price; claimFreeMint ignores price — the edition just needs to exist as a target).
        // PricingModel: 0=UNLIMITED (open, fixed price, supply MUST be 0), 1=LIMITED_FIXED,
        // 2=LIMITED_DYNAMIC (needs the dynamic module + a non-zero rate). openTime=0 => open now.
        ERC1155Instance(c0).addEdition(
            "Aberration #1", 0.01 ether, 50, _pieceMeta("Aberration #1", ART_ABERRATION, "neon-drift"),
            ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);
        ERC1155Instance(c0).addEdition(
            "Drift Open", 0.005 ether, 0, _pieceMeta("Drift Open", ART_DRIFT_OPEN, "neon-drift"),
            ERC1155Instance.PricingModel.UNLIMITED, 0, 0);

        ERC1155Instance(c1).addEdition(
            "Slab", 0.002 ether, 0, _pieceMeta("Slab", ART_SLAB, "monolith"),
            ERC1155Instance.PricingModel.UNLIMITED, 0, 0);

        // ghost-mint needs at least one edition so claimFreeMint has a target.
        ERC1155Instance(c2).addEdition(
            "Ghost", 0.001 ether, 100, _pieceMeta("Ghost", ART_GHOST, "ghost-mint"),
            ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);

        // Feature each (rentFeatured) so it surfaces in getHomePageData. rankBoost descends for a
        // stable order; a generous value covers the cost and the excess refunds.
        uint256 duration = 30 days;
        d.queue.rentFeatured{value: 1 ether}(c0, duration, 0.03 ether);
        d.queue.rentFeatured{value: 1 ether}(c1, duration, 0.02 ether);
        d.queue.rentFeatured{value: 1 ether}(c2, duration, 0.01 ether);

        // Seed the endowment so c0's vault panel shows real principal (benefactor = the c0 instance).
        IAlignmentVault(payable(d.endowmentVault)).receiveContribution{value: 0.5 ether}(
            Currency.wrap(address(0)), 0.5 ether, c0
        );

        // Deployer profile + activity (POST=0 to own wall: instance == sender).
        d.profiles.setProfile(_profileMeta(
            "MS2 Labs", "ms2labs",
            "Building the lean onchain launchpad. Alignment is the product.", ART_AVATAR_1));
        _post(d.messages, deployer, "gm. neon-drift is live and aligned to MS2.");
        _post(d.messages, deployer, "the vault is the product. alignment compounds.");
        _post(d.messages, c0, "first drop. minting is open.");

        vm.stopBroadcast();
    }

    function _createCollection(
        ERC1155Factory factory,
        address vault,
        uint256 index,
        string memory slug,
        string memory displayName,
        string memory description,
        string memory image,
        uint256 freeMintAllocation
    ) internal returns (address instance) {
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: slug,
            metadataURI: _collectionMeta(displayName, description, image),
            creator: deployer,
            vault: vault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({allocation: freeMintAllocation, scope: GatingScope.BOTH})
        });
        bytes32 salt = keccak256(abi.encode(block.timestamp, index, slug));
        instance = factory.createInstance(salt, params);
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN
    }

    // ─────────────────────────── Phase B: ERC721 gallery ───────────────────────────

    /// @dev Gallery auction: a SHORT 1h duration so the post-seed +2h chain advance (deploy.ts) ends
    ///      both pieces. Piece #1 gets acct1's bid -> ENDED-WITH-BIDS (the human settles it live, which
    ///      demos settleAuction -> settled); piece #2 has no bid -> ENDED-NO-BIDS (reclaimable).
    ///      No vm.warp (a no-op under --broadcast) and no in-script settle (the auction isn't ended at
    ///      broadcast time — only after deploy.ts advances the chain).
    function _seedErc721Gallery(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address gallery = _createAuction(
            d, "gallery-relics", "Gallery Relics",
            "A single-line auction house for salvaged relics - one piece up at a time, highest bid takes it. ~20% of the hammer binds to the alignment vault.",
            "GAL", ART_GALLERY, 1 hours);
        ERC721AuctionInstance g = ERC721AuctionInstance(payable(gallery));
        // Each queuePiece's msg.value = minBid; first piece per line auto-starts (endTime = now+1h).
        g.queuePiece{value: 0.05 ether}(_pieceMeta("Relic I", ART_RELIC_I, "gallery-relics"));  // tokenId 1, line 0
        g.queuePiece{value: 0.05 ether}(_pieceMeta("Relic II", ART_RELIC_II, "gallery-relics")); // tokenId 2, line 1
        d.queue.rentFeatured{value: 1 ether}(gallery, 30 days, 0.025 ether);
        vm.stopBroadcast();

        // acct1 bids on piece #1 (a non-owner EOA; settleAuction _safeMints to the winner).
        vm.startBroadcast(ACCOUNT_1_KEY);
        g.createBid{value: 0.1 ether}(1, "");
        vm.stopBroadcast();
    }

    // ─────────────────────────── Phase E: ERC721 live ───────────────────────────

    /// @dev Live auction with a LONG 1-day duration so it stays active well past the +2h chain
    ///      advance. One piece gets a bid (active-with-bids), the other is active-no-bid (clean bid
    ///      form to demo). Both keep counting down (chain-anchored countdown in the UI).
    function _seedErc721Live(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address live = _createAuction(
            d, "live-salon", "Live Salon",
            "The Live Salon runs a rolling single-line auction - a new work on the block, bidding open now. Collect the piece, fund the vault.",
            "LIV", ART_LIVE_SALON, 1 days);
        ERC721AuctionInstance l = ERC721AuctionInstance(payable(live));
        l.queuePiece{value: 0.05 ether}(_pieceMeta("Salon I", ART_SALON_I, "live-salon"));  // tokenId 1, line 0
        l.queuePiece{value: 0.05 ether}(_pieceMeta("Salon II", ART_SALON_II, "live-salon")); // tokenId 2, line 1
        d.queue.rentFeatured{value: 1 ether}(live, 30 days, 0.04 ether);
        vm.stopBroadcast();

        vm.startBroadcast(ACCOUNT_1_KEY);
        l.createBid{value: 0.1 ether}(1, ""); // piece #1 active-with-bids; piece #2 stays no-bid
        vm.stopBroadcast();
    }

    function _createAuction(
        Deployed memory d,
        string memory slug,
        string memory displayName,
        string memory description,
        string memory symbol,
        string memory image,
        uint40 baseDuration
    ) internal returns (address instance) {
        ERC721AuctionFactory.CreateParams memory params = ERC721AuctionFactory.CreateParams({
            name: slug,
            metadataURI: _collectionMeta(displayName, description, image),
            creator: deployer,
            vault: d.vault, // must be a contract; the generic Uni vault qualifies
            symbol: symbol,
            lines: 2,
            baseDuration: baseDuration,
            timeBuffer: 300,
            bidIncrement: 0.01 ether
        });
        bytes32 salt = keccak256(abi.encode(block.timestamp, slug, "ERC721"));
        instance = d.erc721.createInstance(salt, params); // msg.value 0: no creation fee on anvil
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN
    }

    // ─────────────────────────── Phase C/D: ERC404 bonding ───────────────────────────

    /// @dev PREOPEN: created, bonding flagged active, open time in the FUTURE -> derivePhase=preopen
    ///      (UI shows a countdown). No buys.
    function _seedErc404PreOpen(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        // Cypher LP venue + Cypher (Algebra) vault — covers the Cypher family (it stays preopen, so
        // the Algebra pool is never actually deployed; the graduated-swap Cypher path is link-out anyway).
        address inst = _createBonding(
            d, "ember-preopen", "Ember",
            "Ember hasn't caught yet. When the curve opens, each buy mints a glowing shard; ~20% of every trade binds to the alignment vault, by contract.",
            "EMBER", ART_EMBER, address(0), d.cypherVault, d.cypherDeployer);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 days); // strictly future -> preopen
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.06 ether);
        vm.stopBroadcast();
    }

    /// @dev MID-CURVE: the main demo. Created WITH the staking module, opened just-ahead then crossed,
    ///      several buys from deployer + acct1 (BondingSale events -> price history for candles), then
    ///      staking activated and a position staked. No graduation.
    function _seedErc404MidCurve(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        // Uni-V4 LP venue + Uni LP vault (mid-curve; does not graduate).
        address inst = _createBonding(
            d, "vapor-mid", "Vapor",
            "Vapor is live on the curve - trade the coin, hold the piece, stake for a cut of the flow. A DN404 where the token and the art are one asset.",
            "VAPOR", ART_VAPOR, d.stakingModule, d.vault, d.uniDeployer);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // openTime must be strictly future at broadcast; set it +1h so the seed never reverts on
        // broadcast lag. The post-seed +2h chain advance (deploy.ts) crosses it -> derivePhase=bonding.
        // buyBonding does NOT gate on openTime, so the seed buys land now regardless.
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.05 ether);

        // Buy amount: >= normalizationFactor (else cost rounds to 0 -> PurchaseTooSmall) and well
        // under maxBondingSupply (~9e24 for preset 1: maxSupply 1e25 - 10% reserve). unit = 1e24.
        uint256 buyAmount = 1e23; // 0.1 NFT-equivalent worth of tokens per buy
        vm.stopBroadcast();

        _buyBonding(b, deployerKey, buyAmount);
        _buyBonding(b, ACCOUNT_1_KEY, buyAmount);
        _buyBonding(b, deployerKey, buyAmount);
        // One larger deployer buy so there's enough to seed ADMIN a whole NFT (unit = 1e24).
        _buyBonding(b, deployerKey, 12e23);

        // Activate staking + stake a slice, then hand ADMIN 1 unit (1 NFT + tokens) so the testing
        // wallet's PORTFOLIO shows real ERC404 holdings. Deployer now holds 1e23+1e23+12e23 = 1.4e24.
        vm.startBroadcast(deployerKey);
        b.activateStaking();
        b.stake(buyAmount / 2);
        b.transfer(ADMIN, 1e24); // DN404: a whole-unit transfer mints the NFT to ADMIN
        vm.stopBroadcast();
    }

    /// @dev READY-TO-GRADUATE: opened, one buy (reserve > 0 is required by deployLiquidity), maturity
    ///      set so the post-seed +2h chain advance (deploy.ts) crosses it -> deployLiquidity's
    ///      isMatured becomes true and the UI surfaces the graduate button. We do NOT call
    ///      deployLiquidity (it hits an external AMM); the human graduates live. No vm.warp.
    ///      Two graduate-ready instances are seeded — one per embedded-swap venue — so the
    ///      post-graduation swap surface can be exercised on both: cinder-ready (Uni-V4 -> swapV4)
    ///      and molten-ready (ZAMM -> swapVZ).
    function _seedErc404ReadyToGraduate(Deployed memory d) internal {
        // Uni-V4 LP venue + Uni LP vault — graduating stands up a real V4 pool (embedded swapV4).
        _seedReadyToGraduate(
            d, "cinder-ready", "Cinder",
            "Cinder's curve is nearly spent - one push from graduating to a Uniswap V4 pool. Late embers, deep discounts.",
            "CINDER", ART_CINDER, d.vault, d.uniDeployer, 0.045 ether);
        // ZAMM LP venue + ZAMM LP vault — graduating stands up a ZAMM pool (embedded swapVZ).
        _seedReadyToGraduate(
            d, "molten-ready", "Molten",
            "Molten runs hot and ready to pour - matured and one call from a ZAMM pool. The curve's last stretch before the DEX.",
            "MOLTEN", ART_MOLTEN, d.zammVault, d.zammDeployer, 0.043 ether);
    }

    function _seedReadyToGraduate(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory description,
        string memory symbol,
        string memory image,
        address vault,
        address deployer_,
        uint256 rankBoost
    ) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(d, slug, name, description, symbol, image, address(0), vault, deployer_);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // openTime +1h (safe future), maturity +90m (> openTime, < the +2h advance) so after the
        // advance the curve is open (bonding) AND matured (graduate unlocked).
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingMaturityTime(block.timestamp + 90 minutes);
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, rankBoost);
        vm.stopBroadcast();
        // _buyBonding manages its own broadcast — call it OUTSIDE the block above (no nesting).
        _buyBonding(b, deployerKey, 1e23);
    }

    /// @dev STACKED METADATA: an ERC404 created via the factory's metadata overload (NOT the gating
    ///      param), wiring resolver(router) → [overlay, tier]. The tier table is sealed at create
    ///      (ids 1-2 reveal "rare-" art once the holder clears 1 unit; teaser "locked-" otherwise).
    ///      Post-create the deployer (artist) publishes an opt-in event wave and a PAY commission on
    ///      id 3, then — as the holder of id 3 — unlocks + pins it. Token URIs (tokenBaseURI "" → base
    ///      is the bare id) demonstrate precedence: id1/2 → "rare-N", id3 → "commission-3", else "N".
    function _seedErc404Stacked(Deployed memory d) internal {
        // Build the sealed tier table: ids 1-2 are the rare subset, threshold = 1 unit (1e24 for preset 1).
        TierRevealModule.Tier[] memory tiers = new TierRevealModule.Tier[](1);
        tiers[0] = TierRevealModule.Tier({
            idStart: 1, idEnd: 2, minBalance: 1e24, baseURI: "rare-", lockedURI: "locked-"
        });

        address[] memory children = new address[](2);
        children[0] = d.overlay; // precedence: holder pins/events win over...
        children[1] = d.tier;    // ...ambient rarity reveal

        ERC404Factory.MetadataConfig memory meta = ERC404Factory.MetadataConfig({
            resolver: d.resolverRouter,
            childResolvers: children,
            overlay: d.overlay,
            tier: d.tier,
            tiers: tiers,
            autoLatest: false, // opt-in events — keeps tier reveal visible by default
            defaultPayout: MetadataOverlayModule.Payout.ARTIST
        });

        vm.startBroadcast(deployerKey);
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, "prism-stacked", "ERC404")),
            name: "prism-stacked",
            symbol: "PRISM",
            styleUri: "",
            tokenBaseURI: "", // base tokenURI is the bare id, so prefixes above read clearly
            owner: deployer,
            vault: d.zammVault, // ZAMM LP vault — pairs with the ZAMM deployer below
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0)
        });
        TierConfig memory noGating;
        address inst = d.erc404.createInstance(
            params,
            _collectionMeta(
                "Prism",
                "Prism refracts: a rarity-tiered ERC404 where holding enough unlocks the rare face. Overlay + tier metadata, resolved on-chain.",
                ART_PRISM),
            d.zammDeployer,
            address(0),
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH}),
            noGating,
            meta
        );
        _instances.push(inst);

        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{value: 1 ether}(inst, 30 days, 0.035 ether);
        vm.stopBroadcast();

        // Deployer buys 3 whole units WITH NFTs minted → owns ids 1,2,3 (balance 3e24 clears the tier).
        _buyBondingMint(b, deployerKey, 3e24);

        // Artist (deployer) authoring + holder unlock — all owner/holder writes before _transferAdmin.
        vm.startBroadcast(deployerKey);
        MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);
        // An opt-in open event wave (holders select it; not auto because autoLatest=false).
        ov.publishWave(inst, "event-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST);
        // A paid commission on id 3 (outside the tier range), then unlock+pin it as the holder.
        ov.setCommission(inst, 3, "commission-3", MetadataOverlayModule.CommCond.PAY, 0.01 ether, MetadataOverlayModule.Payout.ARTIST);
        ov.unlock{value: 0.01 ether}(inst, 3);
        vm.stopBroadcast();

        console.log("STACKED prism instance:", inst);
        console.log("  overlay:", d.overlay);
        console.log("  tier   :", d.tier);
        console.log("  router :", d.resolverRouter);
    }

    /// @dev Same exact-cost math as _buyBonding but mints NFTs (mintNFT=true) so the buyer owns ids.
    function _buyBondingMint(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        BondingCurveMath.Params memory params = _curveParams(b);
        uint256 cost = BondingCurveMath.calculateCost(params, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.startBroadcast(key);
        b.buyBonding{value: total}(amount, total, true, bytes32(0), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Compute the EXACT cost the instance will charge and pay it, so buyBonding never reverts.
    ///      The instance computes cost = BondingCurveMath.calculateCost(curveParams, supply, amount),
    ///      then adds a fee = cost * bondingFeeBps / 10000. We reproduce both with the SAME library
    ///      + the instance's public getters and set maxCost == value == cost + fee. (Excess, if any,
    ///      is refunded by the contract.) mintNFT=false keeps tokens fungible for staking.
    function _buyBonding(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        BondingCurveMath.Params memory params = _curveParams(b);
        uint256 cost = BondingCurveMath.calculateCost(params, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.startBroadcast(key);
        b.buyBonding{value: total}(amount, total, false, bytes32(0), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 5-tuple).
    function _curveParams(ERC404BondingInstance b)
        internal
        view
        returns (BondingCurveMath.Params memory p)
    {
        (
            uint256 initialPrice,
            uint256 quarticCoeff,
            uint256 cubicCoeff,
            uint256 quadraticCoeff,
            uint256 normalizationFactor
        ) = b.curveParams();
        p = BondingCurveMath.Params({
            initialPrice: initialPrice,
            quarticCoeff: quarticCoeff,
            cubicCoeff: cubicCoeff,
            quadraticCoeff: quadraticCoeff,
            normalizationFactor: normalizationFactor
        });
    }

    /// @param vault    the alignment/endowment vault the instance binds to (any of the 4 flavors)
    /// @param deployer_ the LP deployer module (Uni-V4 / ZAMM / Cypher) the curve graduates through.
    ///        Vault flavor and LP venue are independent axes — the seed spreads instances across both
    ///        so all four vaults and all three AMMs are demonstrated (and the graduated-swap surface
    ///        can be exercised per venue).
    function _createBonding(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory description,
        string memory symbol,
        string memory image,
        address stakingModule,
        address vault,
        address deployer_
    ) internal returns (address instance) {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, slug, "ERC404")),
            name: slug,
            symbol: symbol,
            styleUri: "",
            tokenBaseURI: "",
            owner: deployer,
            vault: vault,
            nftCount: 10,
            presetId: 1, // STANDARD: targetETH 25 ether, unitPerNFT 1e6
            stakingModule: stakingModule
        });
        instance = d.erc404.createInstance(
            params,
            _collectionMeta(name, description, image),
            deployer_,           // approved LIQUIDITY_DEPLOYER (the LP venue)
            address(0),          // no gating
            FreeMintParams({allocation: 0, scope: GatingScope.BOTH})
        ); // msg.value 0: no creation fee on anvil
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN
    }

    // ─────────────────────────── Activity ───────────────────────────

    /// @dev Direct POST (messageType 0) to a channel; sender is the broadcaster. The profile feed
    ///      filters by sender, so posting to the sender's own address (self-wall) keeps it coherent.
    function _post(GlobalMessageRegistry messages, address channel, string memory content) internal {
        messages.post(channel, 0, 0, bytes32(0), bytes32(0), content);
    }

    /// @dev POST carrying ETH `value` — exercises the spam-threshold lever. Posts below the current
    ///      postThreshold are hidden from the feed (display-side); the ETH accrues in the registry.
    ///      Seeded threshold stays 0 (feed shows everything) so raising the lever in the admin panel
    ///      has varied-value posts to act on.
    function _postValued(
        GlobalMessageRegistry messages,
        address channel,
        string memory content,
        uint256 value
    ) internal {
        messages.post{value: value}(channel, 0, 0, bytes32(0), bytes32(0), content);
    }

    // ── Real art (mainnet-harvested, gateway-verified IPFS CIDs) ─────────────────
    // A fresh, varied set: a coherent style per collection (as a real drop would have). Each CID was
    // read off a live mainnet collection's tokenURI on the fork and verified to return image bytes,
    // so it is genuinely pinned. If a public gateway is slow the frontend's IpfsImage rotator falls
    // through to the next one. To refresh the pool see docs/phases/design-pass-blockers.md.
    // Azuki (anime) → neon-drift edition · Doodles → gallery-relics auction · Pudgy → live-salon
    // auction + prism · mfers → monolith + vapor · World of Women → ghost-mint + cinder.
    string constant ART_NEON_DRIFT = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/7.png";
    string constant ART_ABERRATION = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/42.png";
    string constant ART_DRIFT_OPEN = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/128.png";
    string constant ART_MONOLITH = "ipfs://Qmd4LiA6qkH64HwKnj28va5EgWSmSTu6WRvq4SwWav2eCx";
    string constant ART_SLAB = "ipfs://QmUcgEJByHioefXqrhv8LadTJL8TCsC2iBDzvsYqsiAs7k";
    string constant ART_GHOST_MINT = "ipfs://QmRLxHRC8x92XgVk2RnUs4RmM1WiX1dg6rH8hpRtLoKfJj";
    string constant ART_GHOST = "ipfs://QmNwxe3ZUd31rm2ejwjRLUB1paoxC2nj76VLbnyFy27CF7";
    string constant ART_GALLERY = "ipfs://QmcPv7T6QD6sjyu4G1jVgx2Gj8ZtTwEBy71tMRjSHGoZcT";
    string constant ART_RELIC_I = "ipfs://QmQTkvAKhrTCmSR24zQgDLUiUT6gqWqh9aZJDbX5yWgLMP";
    string constant ART_RELIC_II = "ipfs://QmVDJ6wg4y7Biy9Wm93ghJJsRithcBNXFUcBbasGYDSpHb";
    string constant ART_LIVE_SALON = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/7.png";
    string constant ART_SALON_I = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/42.png";
    string constant ART_SALON_II = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/128.png";
    string constant ART_EMBER = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/777.png";
    string constant ART_VAPOR = "ipfs://QmNg8FE8pgKSCjo54WDNEHaiaUcgW2eNUQ5iWzBYc7ZUKt";
    string constant ART_CINDER = "ipfs://QmbeHAw5nGwSQSZ8pQc8WSdbzxh3rLY8Pg2rqiS1wJRcvQ";
    string constant ART_MOLTEN = "ipfs://QmS3XQsKc1FRKV6Q9sn3kgwstdLmgM5sK9gFhiJtRLv7y1";
    string constant ART_PRISM = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/777.png";
    string constant ART_AVATAR_1 = "ipfs://QmNewNmsfGgvqptDDDeDC7nwWVM8ReXp5qmySNyBdyRw9M";
    string constant ART_AVATAR_2 = "ipfs://QmWZqi5xnTcnqa4k7UuzeLd3sm2mCci24wx1yQvKiDq1vm";

    // ── Backend-free metadata builders (raw data: JSON pointing at a real IPFS image) ───
    // The metadata JSON is an unencoded `data:application/json,{...}` URI; the image is a plain
    // ipfs:// pointer (no quotes/backslashes to escape), which the frontend resolver races across
    // gateways.

    function _collectionMeta(
        string memory name,
        string memory description,
        string memory image
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"description\":\"", description,
            "\",\"category\":\"edition\",\"image\":\"", image,
            "\"}"
        );
    }

    /// @dev Per-piece/edition metadata (same shape, piece-scoped name + image).
    function _pieceMeta(
        string memory name,
        string memory image,
        string memory collection
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"collection\":\"", collection,
            "\",\"image\":\"", image,
            "\"}"
        );
    }

    function _profileMeta(
        string memory name,
        string memory handle,
        string memory bio,
        string memory image
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"", name,
            "\",\"handle\":\"", handle,
            "\",\"bio\":\"", bio,
            "\",\"avatar\":\"", image,
            "\"}"
        );
    }
}
