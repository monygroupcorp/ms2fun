// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { IDynamicPricingModule } from "../src/factories/erc1155/interfaces/IDynamicPricingModule.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";
import { IMerkleGatingModule, MerkleConfig } from "../src/gating/IMerkleGatingModule.sol";
import { IAlignmentVault } from "../src/interfaces/IAlignmentVault.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import {
    SeedAnvilShared,
    ArtistEndowments,
    IEndowmentPayout,
    AnvilV4DepthSeeder,
    IUniswapV3PoolMinimal
} from "./SeedAnvilShared.sol";

/// @dev Minimal owner surface for enriching a seeded alignment target's description + logo metadata.
interface IAlignmentTargetAdmin {
    function updateAlignmentTarget(uint256 targetId, string memory description, string memory metadataURI) external;
}

/// @dev Read-back surface of MerkleGatingModule. `IMerkleGatingModule` carries only `configureFor`;
///      the views are what let the seed assert that what it installed is what is actually stored.
interface IMerkleGatingView {
    function getRoots(address instance, uint256 editionId) external view returns (bytes32[] memory);
    function getTierOpenTimes(address instance, uint256 editionId) external view returns (uint256[] memory);
}

/// @dev Minimal owner surface for curating an alignment target's acquisition venue and its pinned
///      price-authority pool. Both are `onlyOwner` on AlignmentRegistryV1 and the deployer still owns
///      the registry at seed time (protocol-admin handover is deferred — see `_transferAdmin`).
interface IAlignmentRouteAdmin {
    function setAcquireRoute(uint256 targetId, address token, IAlignmentRegistry.AcquireRoute calldata route) external;
    function setReferencePool(uint256 targetId, address token, IAlignmentRegistry.ReferencePool calldata ref) external;
    function getAcquireRoute(uint256 targetId, address token)
        external
        view
        returns (IAlignmentRegistry.AcquireRoute memory);
    function getReferencePool(uint256 targetId, address token)
        external
        view
        returns (IAlignmentRegistry.ReferencePool memory);
}

/// @dev The per-vault pool-key setter on UniAlignmentVaultFactory. Declared as an interface rather
///      than imported: the factory's constructor deploys a vault implementation, so importing the
///      contract type would drag that bytecode into this script for the sake of one call.
interface IUniVaultFactoryAdmin {
    function setVaultPoolKey(address vault, PoolKey calldata poolKey) external;
}

/// @dev Read-back surface of UniAlignmentVault, so the pool key this script installs can be asserted
///      rather than assumed. `v4PoolKey` is a public struct getter and returns the flattened tuple.
interface IUniVaultView {
    function v4PoolKey() external view returns (Currency, Currency, uint24, int24, IHooks);
    function alignmentToken() external view returns (address);
    function alignmentTargetId() external view returns (uint256);
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
///         TIME MODEL — READ THIS BEFORE MOVING ANYTHING. vm.warp is a NO-OP under --broadcast (it
///         advances only the script's in-memory EVM, not the live chain), so this seed NEVER warps.
///         Every instance is created with time OFFSETS relative to seed-time T0 (open +1h, gallery
///         duration 1h, maturity +90m), and `deploy.ts` advances the anvil chain AFTERWARD.
///
///         The seed is TWO SCRIPTS because `buyBonding` reverts `TooEarly` before `bondingOpenTime`
///         while `setBondingOpenTime` reverts `TimeMustBeInFuture` on a non-future time — a single
///         script cannot both arm a launch and buy into it (see SeedAnvilShared's header for the
///         full derivation). THIS script only CREATES and ARMS. Every buy, and everything downstream
///         of a buy, lives in SeedAnvilBuys.
///
///         deploy.ts drives the clock in two steps:
///           SeedAnvil  →  +1h +slack  →  SeedAnvilBuys  →  +2h
///         so ~3h of chain time passes in total. Net result at the end:
///           · ember       preopen        (open +1 day — uncrossed by ~3h, deliberately)
///           · vapor       bonding        (open crossed by the FIRST advance, then bought + staked)
///           · cinder      bonding + MATURED (maturity +90m: after the buys, before the end)
///           · molten      bonding + MATURED (same shape, ZAMM venue)
///           · quench      bonding + MATURED (same shape, Cypher/Algebra venue)
///           · carve       bonding, reserve >= 3 ETH, matured — graduates in deploy.ts WITH a carve
///           · stacked     bonding, ids 1-3 held, overlay authored
///           · gallery auction (1h)  ENDED — note it now ends during the FIRST advance, not the
///             second; it is settle-ready + no-bid either way, and nothing in phase 2 needs it live
///           · live auction (1 day)  ACTIVE, with its phase-1 bid intact
contract SeedAnvil is SeedAnvilShared {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // Agent-delegation demo (pre-testnet confirmation): the AGENT is an authorized delegate that
    // creates a collection ON BEHALF OF the PERSON, who ends up owning it. Anvil accounts #3 (agent)
    // and #2 (person) — well-known public test keys.
    uint256 constant AGENT_KEY = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    address constant AGENT = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // anvil #3
    address constant PERSON = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // anvil #2

    // ── LIMITED_DYNAMIC coverage (edition 3 on neon-drift) ──────────────────────────────────
    // basePrice sits between the two fixed editions so the surface reads naturally; the rate is
    // large enough that the exponential regime is visible by eye. See the addEdition call site.
    uint256 constant DYN_BASE_PRICE = 0.004 ether;
    uint256 constant DYN_RATE_BPS = 2000; // +20% per mint
    /// @dev Mints to look ahead when checking that the dynamic price actually moves.
    uint256 constant DYN_PROBE_MINTS = 5;
    /// @dev The price at DYN_PROBE_MINTS must be at least this multiple of basePrice.
    uint256 constant DYN_MIN_MULTIPLE = 2;

    // The edition ids this phase creates, asserted by name rather than assumed. `nextEditionId`
    // starts at 1 (ERC1155Instance.sol) and increments per addEdition on that instance.
    uint256 constant NEON_DRIFT_DYNAMIC_EDITION = 3;
    uint256 constant GHOST_MINT_EDITION = 1;

    // ── Merkle-allowlist fixture (noesis-357) ───────────────────────────────────────────────
    // Two gated instances, one per instance family, because the families forward DIFFERENT
    // editionIds to the module (ERC1155 forwards the real edition; ERC404 forwards 0) and a
    // fixture that only proves one leaves the other unexercised.
    //
    // Allowlist membership, shared by both fixtures:
    //   · ADMIN  (the team's testing wallet) — the wallet the walk mints WITH.
    //   · PERSON (anvil #2)                  — a second member, so every proof has a real sibling
    //                                          rather than degenerating to an empty proof.
    //   · acct1  (anvil #1)                  — deliberately NOT on any list, so the refusal path
    //                                          (`InvalidProof`) is walkable from a funded wallet.
    //
    // SCOPE ASSIGNMENT IS FORCED BY THE INSTANCES, not chosen for variety. Both free-mint paths are
    // one-claim-per-address (`freeMintClaimed[.. ]` on both families), so a cumulative per-user cap
    // can only be exceeded on a PAID path — which means the instance that must demonstrate
    // `QtyCapExceeded` is the one whose scope includes paid buys. Hence: ERC1155 = BOTH (paid mint
    // gated, cap reachable), ERC404 = FREE_MINT_ONLY (the free-claim path gated, buys open).
    uint256 constant VEIL_EDITION = 1; // first addEdition on a fresh instance; asserted, not assumed
    uint256 constant VEIL_TIER_COUNT = 2;
    // Tier 0 (open now). ADMIN's cap is 2 so a second mint of 2 exceeds it — QtyCapExceeded is two
    // clicks away, which is the part most likely to be wrong in a UI (it must read `claimed` before
    // building the request).
    uint256 constant VEIL_T0_ADMIN_QTY = 2;
    uint256 constant VEIL_T0_MEMBER_QTY = 1;
    // Tier 1 (opens +1 day, i.e. after both of deploy.ts's advances) — the later phase raises the
    // caps, which is the module's documented re-allocation lever. Unopened, so `TierNotOpen` is
    // reachable for the whole life of the seeded chain.
    uint256 constant VEIL_T1_ADMIN_QTY = 5;
    uint256 constant VEIL_T1_MEMBER_QTY = 5;
    uint256 constant VEIL_TIER1_DELAY = 1 days;
    uint256 constant VEIL_FREE_ALLOC = 3;

    // ERC404 side. The module's `amount` on the free-claim path is `unit` (one NFT's worth of
    // tokens), NOT an NFT count — so the cap encoded in the leaf is denominated in the same units.
    // preset 1 is unitPerNFT = 1e6, and the created instance's `unit()` is asserted against this
    // before the config is trusted, because the leaf (and therefore the root) is built BEFORE the
    // instance exists.
    uint256 constant SIGIL_UNIT = 1e6 * 1e18;
    uint256 constant SIGIL_MAX_QTY = SIGIL_UNIT; // exactly one free claim's worth
    uint256 constant SIGIL_FREE_ALLOC = 3;

    // ── THE ALIGNMENT CATALOG ROSTER ────────────────────────────────────────────────────────
    //
    // THE ROSTER IS A SET OF EXAMPLES, NOT A MEASUREMENT. Several seeded collections stand in for
    // real, recognisable collections; being recognisable is the whole of their job. Their figures are
    // ILLUSTRATIVE — they give an armed curve the shape of a real one, they cost nothing, and they are
    // never asserted, never presented as verified, and never worth spending ETH to make exact.
    //
    // WHAT IS ASSERTED IS WIRING AND ART: that the preset the seed registered is the preset the
    // instance got, that a row binds to the vault it names, and that every seeded piece composes a
    // metadata pointer that actually resolves. Those are real failure modes, and each one is invisible
    // on a card until somebody opens it.
    //
    // WHAT THE ROSTER IS ARGUING. Not that these collections owe anyone anything. That the platform
    // routes value to artists: a curve binds a share of every trade to a community's own token, an
    // auction turns a hammer price into permanent endowment principal, and two of the four alignment
    // targets are individual artists rather than communities. The roster is the demonstration surface
    // for that, and its copy should read as demonstration rather than as accusation.
    //
    // The roster's figures, its curve preset ids and the artist-endowment fixtures live in
    // SeedAnvilShared: both phases read them, and a figure restated in two files eventually disagrees
    // with itself.

    // ── The alignment target's two registry legs ────────────────────────────────────────────
    // ACQUIRE: native ETH / CULT on Uniswap V4, 1% tier, hookless. The 0.3% tier is INITIALIZED and
    // holds ZERO liquidity — "a pool exists" is not "a pool can be swapped through", so the tier
    // matters and is not interchangeable.
    uint24 constant CULT_ACQUIRE_FEE = 10000;
    int24 constant CULT_ACQUIRE_TICK_SPACING = 200;
    // REFERENCE: a Uniswap V3 pool is a valid price AUTHORITY but is NOT a valid acquire venue
    // (`Venue` is UNI_V4 | ZAMM | ALGEBRA). This is the deepest ETH/CULT pool on chain and is pinned
    // as the anti-sandwich floor's oracle only. Its 0.3% sibling is likewise empty — do not swap them.
    address constant CULT_REFERENCE_POOL_V3 = 0xC4ce8E63921b8B6cBdB8fCB6Bd64cC701Fb926f2;
    uint8 constant CULT_REFERENCE_KIND = 0; // Uniswap V3 `observe`
    uint32 constant CULT_REFERENCE_TWAP_WINDOW = 0; // 0 => the registry's default window

    // ── The acquire pool's DEPTH ────────────────────────────────────────────────────────────
    // Mainnet singletons, present on the fork. The pool manager is the V4 singleton every pool lives
    // in; WETH is needed only because the deep pool the token leg is bought on is a WETH pair.
    address constant V4_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    // THE BUDGET IS SIZED BY MEASUREMENT, not by taste. Half buys the token leg on the deep pool and
    // half is the native-ETH leg, and a tick-symmetric range makes those two legs equal in value.
    // What the figure has to buy is a pool that can serve a demo-sized convert inside the vault's -5%
    // oracle floor. Measured on the fork at authoring time, the 1%/200 tier's own liquidity prices a
    // 0.1 ETH buy tens of percent under the reference TWAP; the position this budget mints lifts the
    // tier's active liquidity by roughly three orders of magnitude, which puts a several-ETH buy
    // inside the floor with the 1% pool fee already paid out of the budget. The graduation this fork
    // leaves armed carves a vault share well under that, so the headroom is deliberate rather than
    // exact — a demo that reverts on the second convert is the failure mode being bought out.
    uint256 constant CULT_DEPTH_BUDGET = 24 ether;
    // +/- ~19.7% in price around the pool's current tick, aligned down to the 200 spacing. Wide
    // enough that a demo-sized buy stays inside the range for the whole swap (a swap that walks out
    // of the range falls back onto the tier's original depth mid-trade, which is the thin case again).
    int24 constant CULT_DEPTH_HALF_WIDTH_TICKS = 1800;
    // A floor, not the expected value: what is being asserted is that the deposit LANDED and moved
    // the tier by orders of magnitude, not that it landed to the wei. The tier's pre-existing active
    // liquidity was ~3.7e20 at authoring, so this is ~100x that and cannot be met by the pool's own
    // depth drifting on a newer fork block.
    uint128 constant CULT_DEPTH_MIN_ACTIVE_LIQUIDITY = 4e22;

    // ── The ERC-1155 tranche — free-mint-heavy examples, TRUNCATED ──────────────────────────
    // The seed demonstrates the family; it does not mint ten thousand tokens onto a fork. Each
    // edition is cut to a demo size, and the cut rides the instance's own on-chain metadata beside
    // the example supply it stands in for. That pairing is the load-bearing part: a truncated
    // edition's on-chain supply is the one figure a surface can read directly, so leaving it to be
    // mistaken for the size it is an example of would misstate the only real number on the row.
    uint256 constant ANTI_SEEDED_SUPPLY = 40; // example 10,000 -> 1:250
    uint256 constant ANTI_FREE_ALLOC = 39; // the split it stands in for was mostly free
    uint256 constant OEKAKI_SEEDED_SUPPLY = 50; // example 5,555 -> ~1:111
    uint256 constant OEKAKI_FREE_ALLOC = 37; // roughly three quarters free, one quarter paid
    uint256 constant MILADY333_SEEDED_SUPPLY = 37; // example 333 -> 1:9
    uint256 constant MILADY333_FREE_ALLOC = 37; // free from the first piece to the last

    // ── Auction shape ───────────────────────────────────────────────────────────────────────
    // The orchestrator advances the chain +70m after phase 1 and +120m after phase 2, and
    // `baseDuration` is an instance IMMUTABLE. A duration under 70m is what lets phase 2 SETTLE the
    // opening auctions, which is the only way the endowment ends up holding principal that arrived
    // through the 80% leg rather than through a donation. That same duration means the auctions
    // settlement starts have themselves ended by the time the app boots, so the collection lands
    // settle-ready-with-bids rather than mid-countdown. The two cannot both be had from one
    // instance: any auction a settlement starts begins at the +70m mark and would need to outlive a
    // further 120m, i.e. a duration LONGER than the one that made the settlement possible.
    // Settled-with-real-principal is the half that carries the 80% endowment, so it is the half kept.
    uint40 constant FIGMATA_DURATION = 45 minutes;
    uint8 constant FIGMATA_LINES = 3;
    // Deposit per queued piece, and three bid sizes spanning a plausible settlement spread, so the
    // endowment ends up holding 80% of a distribution rather than of one repeated number. These are
    // illustrative sizes; nothing downstream asserts them.
    uint256 constant FIGMATA_MIN_BID = 0.095 ether;
    uint256 constant FIGMATA_BID_MEDIAN = 0.3 ether;
    uint256 constant FIGMATA_BID_HIGH = 0.95 ether;
    uint256 constant FIGMATA_BID_MAX = 4.025 ether;

    // ── The artist endowments ───────────────────────────────────────────────────────────────
    // Two auction collections, one per artist target, and the auction family is not a stylistic
    // choice: the 80% endowment leg is `splitMintFor(amount, liquidityFamily = false)`, reachable
    // from the ERC-1155 and ERC-721 settlement paths only. An ERC404 curve bound to an endowment
    // vault would render a vault panel that nothing ever feeds.
    //
    // Small on purpose. These exist to make the target list argue something and to give each artist
    // vault real escrowed principal to render — not to be large. The duration mirrors the other
    // auction row so the orchestrator's first advance can settle the openers, which is the only way
    // principal reaches the endowment through the 80% leg rather than as a donation.
    uint8 constant ARTIST_LINES = 2;
    uint40 constant ARTIST_DURATION = 45 minutes;
    uint256 constant ARTIST_MIN_BID = 0.05 ether;
    uint256 constant ARTIST_BID_HIGH = 3 ether;
    uint256 constant ARTIST_BID_LOW = 2.3 ether;

    // Anvil account #2, the second bidder. Well-known public test key; `PERSON` is its address and
    // already carries the agent-delegation demo's collection, so the seed's two non-deployer actors
    // stay the two it already uses.
    uint256 constant PERSON_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    // Every seeded instance, accumulated as they're created, so phase 2's _transferAdmin can hand
    // them over. Persisted to anvil-seed.json at the end of run() — phase 2 cannot see this array.
    address[] private _instances;

    // The ERC404 instances phase 2 resolves by name.
    SeededErc404 private _seeded;

    // The non-ERC404 catalog instances phase 2 still has work to do on.
    SeededCatalog private _catalog;

    // The two merkle-gated fixtures (noesis-357), kept so the phase-1 post-conditions and the
    // closing console block can name them.
    address private _gatedErc1155;
    address private _gatedErc404;

    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        acct1 = vm.addr(ACCOUNT_1_KEY);

        Deployed memory d = _readDeployed();

        // ── Phase A: ERC1155 editions + profiles + activity (the original seed, enriched) ──
        (address c0, address c2) = _seedErc1155(d);

        // TIME MODEL: vm.warp is a NO-OP under --broadcast (it advances only the script's in-memory
        // EVM, never the live chain). So this seed never warps — every instance is created with time
        // OFFSETS relative to seed-time T0, and deploy.ts advances the anvil chain afterward
        // (evm_increaseTime) so the ended/open/matured states materialize. The UI's countdown is
        // chain-anchored (useNowSec reads block.timestamp), so it agrees with the advanced chain.
        // Order below is no longer time-sensitive.
        //
        // Nothing here BUYS. Arming a launch and buying into it cannot share one script (see the
        // contract header) — the buys are in SeedAnvilBuys, which deploy.ts runs after advancing
        // the clock past every open time set below.

        // ── ERC721 gallery (1h duration -> ENDED after the +2h advance: settle-ready + no-bid) ──
        _seedErc721Gallery(d);

        // ── ERC404 bonding — preopen + mid-curve(+staking) + ready-to-graduate ──
        _seedErc404PreOpen(d);
        _seedErc404MidCurve(d);
        _seedErc404ReadyToGraduate(d);
        _seedErc404CarveDemo(d);

        // ── ERC404 with a stacked metadata-resolution stack (overlay + tier) ──
        _seedErc404Stacked(d);

        // ── THE ALIGNMENT CATALOG ROSTER ──
        // Registry legs FIRST: the acquire venue and the pinned price authority are properties of the
        // TARGET, and every roster instance below binds to a vault that reads them. Curating them
        // after the instances exist would leave a window in which an aligned collection is bound to a
        // target with no acquisition route at all.
        _seedCultAlignmentLegs(d, CULT_REFERENCE_POOL_V3);
        // Depth into the curated acquire pool, IMMEDIATELY after the legs and before any roster
        // instance exists. Ordering is load-bearing in both directions: the pool key has to be set
        // first (the depth goes into the tier the vault and the registry name, not the deployment
        // default), and the depth has to exist before anything can graduate into the vault, because a
        // convert reads the pool at execution time and gets no second attempt at the same ETH.
        _seedCultPoolDepth(d);
        // Catalog-sized curve presets, before the two curves that select them.
        _registerCatalogPresets(d);
        _seedCatalogFlagship(d);
        _seedCatalogMidCurve(d);
        _seedCatalogSecondMidCurve(d);
        _seedCatalogGraduate(d);
        _seedCatalogAuction(d);
        // The artist endowments — the two targets that make the roster an argument about artists
        // rather than about one community. After the community rows on purpose: they read as the
        // generalisation of what those rows do, not as a separate feature.
        _seedArtistEndowments(d);
        _seedCatalogEditions(d);

        // ── ERC721 live (1-day duration -> stays ACTIVE after the advance) ──
        _seedErc721Live(d);

        // ── Merkle-gated fixtures — one per instance family (noesis-357) ──
        // Added AFTER the ungated instances on purpose: the rest of the walk depends on those being
        // open, so gating is introduced as NEW surfaces rather than by gating an existing one.
        address merkleGating = _readMerkleGatingModule();
        _gatedErc1155 = _seedGatedErc1155(d, merkleGating);
        _gatedErc404 = _seedGatedErc404(d, merkleGating);

        // Second profile + activity (independent of the time model).
        vm.startBroadcast(ACCOUNT_1_KEY);
        d.profiles.setProfile(_profileMeta("Vela", "vela", "Collector. Aligned to the cult.", ART_AVATAR_2));
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

        // Everything this phase claims, checked before the state file is written. See the function
        // header for why these are `require`s rather than logs.
        _assertPhase1(c0, c2);

        // Ownership handover is NOT here: it must run after ALL owner-only seeding, and phase 2 still
        // performs owner-only writes (staking activation, overlay authoring). _transferAdmin lives in
        // SeedAnvilBuys and runs last there.
        _writeSeedState(_seeded, _catalog, _instances);

        console.log("=== SeedAnvil (phase 1: create + arm) complete ===");
        console.log(
            "ERC1155: 3 collections (neon-drift, monolith, ghost-mint[free-claim]) w/ editions incl. LIMITED_DYNAMIC"
        );
        console.log("ERC721 : 2 auctions (gallery=1h duration, live=1-day + bid)");
        console.log(
            "ERC404 : armed but UNBOUGHT - preopen(cypher) + mid-curve(uniV4) + 3 ready-to-graduate (cinder=uniV4, molten=zamm, quench=cypher) + carve + stacked(zamm)"
        );
        console.log(
            "CATALOG: 4 curves (schizo/pixelady/bored-milady armed large + mid-curve, lawbsters small + graduate-ready)"
        );
        console.log("ARTIST : 2 endowment targets (ids 3, 4) with an auction collection each");
        console.log("Vaults : all 4 flavors used (aave/uni/zamm/cypher); AMMs: all 3 (uniV4/zamm/cypher)");
        console.log(
            "Gating : 2 merkle-allowlisted instances (veil-list ERC1155 BOTH, sigil-gate ERC404 FREE_MINT_ONLY)"
        );
        console.log("Profiles: 2 (MS2 Labs, Vela) + activity. block.timestamp now:", block.timestamp);
        console.log("NEXT   : deploy.ts advances the chain past every openTime, then runs SeedAnvilBuys");
    }

    /// @dev Enrich the four seeded alignment targets (registered by DeployCore with empty metadataURI)
    ///      with a richer description + a logo, so the Vaults-page "Alignment targets" section has
    ///      something to show. Ids 1 (MS2) and 2 (the community token) are the community targets; 3
    ///      and 4 are the artist endowments. The deployer still owns the registry at seed time
    ///      (protocol-admin handover is deferred — see _transferAdmin).
    function _enrichAlignmentTargets(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        IAlignmentTargetAdmin reg = IAlignmentTargetAdmin(d.alignmentRegistry);
        string memory ms2 =
            "The MS2 community and its milady-descended aesthetic. Collections aligned here route ~20% of every fee into the MS2 token, by contract.";
        // The token is the community's own ERC20 — first-party, which is the entire point: the
        // derivative collections align back to the parent's real token rather than to a proxy for it.
        string memory cult =
            "The Remilia / Milady community and the collections aligned to it. An aligned collection binds ~20% of its fees to the community's own token, by contract, forever.";
        // THE TWO ARTIST TARGETS ARE THE ARGUMENT. A target list with one large community token and
        // two individual artists says, before any collection is opened, that this is an
        // artist-exaltation platform on which a large community is one instance rather than the
        // purpose. Both descriptions say plainly that the payout address and the alignment token are
        // generated fixtures, so nothing here reads as a claim about a real person's wallet.
        string memory paradilf =
            "An artist endowment. Collections aligned here do not buy a token - they escrow permanent principal in a vault that supplies it to Aave, and the yield streams to the artist for as long as the principal sits there. This is a demonstration target: the payout address and the alignment token beside it are generated fixtures, not a real person's.";
        string memory petravoice =
            "An artist endowment, held for an artist and paid to them. A collection aligned here escrows permanent principal and streams its yield to their payout address - they keep receiving it without having to sell anything, and the principal is never spent. Demonstration target: the payout address and the alignment token are generated fixtures, not a real person's.";
        reg.updateAlignmentTarget(TARGET_ID_MS2, ms2, _collectionMeta("Milady-Station-2", ms2, ART_AVATAR_1));
        reg.updateAlignmentTarget(TARGET_ID_CULT, cult, _collectionMeta("Milady Cult Coin", cult, ART_AVATAR_2));
        reg.updateAlignmentTarget(
            TARGET_ID_PARADILF, paradilf, _collectionMeta(ArtistEndowments.PARADILF_TITLE, paradilf, ART_RELIC_I)
        );
        reg.updateAlignmentTarget(
            TARGET_ID_PETRAVOICE,
            petravoice,
            _collectionMeta(ArtistEndowments.PETRAVOICE_TITLE, petravoice, ART_RELIC_II)
        );
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
            // Per-piece art, same rule as every other seeded ERC404: `_tokenURI` composes
            // `tokenBaseURI + tokenId`, so a metadata directory here is what makes the agent-created
            // pieces resolve to art instead of a bare id. This instance is deliberately absent from
            // `_instances`/`_seeded` (PERSON owns it, not ADMIN), so it carries its base explicitly
            // rather than inheriting one from a list. ART_BASE_DOODLE is the base no neighbouring
            // instance uses, so the commission reads as its own collection.
            tokenBaseURI: ART_BASE_DOODLE,
            owner: PERSON,
            vault: d.vault,
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0 // agent demo keeps default no-carve economics
        });
        address instance = d.erc404
            .createInstance(
                params,
                _collectionMeta(
                    "Agent Commission",
                    "Commissioned via an authorized agent on behalf of a collector. The agent created it; the collector owns it.",
                    ART_SLAB
                ),
                d.uniDeployer,
                address(0),
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
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

    // ─────────────────── Merkle-allowlist fixtures (noesis-357) ───────────────────

    /// @dev The gating module is deployed by DeployCore and exported to anvil.json. It is read here
    ///      rather than added to the shared `Deployed` struct: only this phase needs it, and every
    ///      other seed phase would otherwise carry a field it never touches.
    function _readMerkleGatingModule() internal view returns (address module) {
        string memory json = vm.readFile("./deployments/anvil.json");
        module = vm.parseJsonAddress(json, ".contracts.ModuleMerkleGating");
        require(module != address(0), "gating: ModuleMerkleGating missing from anvil.json");
        require(module.code.length > 0, "gating: ModuleMerkleGating address holds no code");
    }

    /// @dev Leaf construction, byte-identical to `MerkleGatingModule.canMint` AND to
    ///      `app/src/lib/merkle.ts`: `keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))))`.
    ///      The cap is part of the leaf, which is what stops a listed wallet re-proving itself at a
    ///      larger cap than it was listed with.
    function _leaf(address user, uint256 maxQty) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))));
    }

    /// @dev Solady commutative (sorted-pair) parent hash — the internal node the on-chain verifier
    ///      and the off-chain builder must agree on.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Build the two-member tier both fixtures use, and PROVE IT BEFORE INSTALLING IT.
    ///
    ///      Two members rather than one on purpose: a single-leaf tree has root == leaf and an EMPTY
    ///      proof, so it would verify without `MerkleProofLib` ever hashing a node. With two, every
    ///      proof carries a real sibling.
    ///
    ///      The self-verification below is the check the item exists for. `IMerkleGatingModule`
    ///      documents the leaf/root construction as byte-identical to `app/src/lib/merkle.ts`; a
    ///      divergence between the two surfaces as an unexplained `InvalidProof` in the UI during a
    ///      walk, with nothing to point at. Verifying the seed's own proof through the very library
    ///      the module calls moves that failure to the SEED, where it names itself.
    function _buildTier(address a, uint256 aQty, address b, uint256 bQty, address excluded)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proofA, bytes32[] memory proofB)
    {
        bytes32 leafA = _leaf(a, aQty);
        bytes32 leafB = _leaf(b, bQty);
        require(leafA != leafB, "gating: the two allowlist members collide to one leaf");

        root = _hashPair(leafA, leafB);
        require(root != bytes32(0), "gating: zero root (configureFor would revert ZeroRoot)");

        proofA = new bytes32[](1);
        proofA[0] = leafB;
        proofB = new bytes32[](1);
        proofB[0] = leafA;

        // 1. Both members must verify against the root that is about to be installed.
        require(MerkleProofLib.verify(proofA, root, leafA), "gating: member A's proof does not verify");
        require(MerkleProofLib.verify(proofB, root, leafB), "gating: member B's proof does not verify");
        // 2. The deliberately-excluded address must NOT verify at either listed cap — this is the
        //    refusal the walk sees as `InvalidProof`, checked against the same library the module uses.
        require(
            !MerkleProofLib.verify(proofA, root, _leaf(excluded, aQty)),
            "gating: the excluded address verifies at member A's cap"
        );
        require(
            !MerkleProofLib.verify(proofB, root, _leaf(excluded, bQty)),
            "gating: the excluded address verifies at member B's cap"
        );
        // 3. A cap the leaf did not commit to must not verify either.
        require(
            !MerkleProofLib.verify(proofA, root, _leaf(a, aQty + 1)),
            "gating: member A verifies at a cap it was not listed with"
        );
    }

    /// @dev The off-chain `{address,maxQty}[]` list the mint page fetches to rebuild a connected
    ///      wallet's proof (`app/src/lib/collection/allowlistConfig.ts`). Self-hosted as a `data:`
    ///      URI — the same shape the admin panel's paste path produces — so the seed needs no
    ///      network and the fixture is walkable offline.
    ///
    ///      Two details that are load-bearing rather than stylistic:
    ///        · the quotes are BACKSLASH-ESCAPED, because this string is embedded as a JSON string
    ///          value inside the collection metadata, which is itself an unencoded `data:` JSON URI;
    ///        · `maxQty` is a QUOTED integer. The ERC404 cap is a token amount (1e24) and a JSON
    ///          number cannot carry it exactly; the parser accepts a numeric string for exactly this.
    function _allowlistListUri(address a, uint256 aQty, address b, uint256 bQty) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,[{\\\"address\\\":\\\"",
            vm.toString(a),
            "\\\",\\\"maxQty\\\":\\\"",
            vm.toString(aQty),
            "\\\"},{\\\"address\\\":\\\"",
            vm.toString(b),
            "\\\",\\\"maxQty\\\":\\\"",
            vm.toString(bQty),
            "\\\"}]"
        );
    }

    /// @dev Collection metadata carrying an `allowlists` row, so the mint page can find the list for
    ///      this (editionId, tierIndex) pair. `tierIndex` is 0: the app resolves tier 0 only today,
    ///      which is why tier 0 is the OPEN tier on the multi-tier fixture below.
    function _collectionMetaWithAllowlist(
        string memory name,
        string memory description,
        string memory image,
        uint256 editionId,
        string memory escapedListUri
    ) internal pure returns (string memory) {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"description\":\"",
            description,
            "\",\"category\":\"edition\",\"image\":\"",
            image,
            "\",\"allowlists\":[{\"editionId\":",
            vm.toString(editionId),
            ",\"tierIndex\":0,\"listURI\":\"",
            escapedListUri,
            "\"}]}"
        );
    }

    /// @dev GATED ERC-1155, scope BOTH — the paid path is gated, so the cumulative per-user cap is
    ///      reachable: ADMIN is listed at 2, so a first mint of 2 succeeds and a second reverts
    ///      `QtyCapExceeded`. TWO tiers, staggered: tier 0 is open immediately (and is the tier the
    ///      app resolves), tier 1 opens +1 day — past both of deploy.ts's advances — so `TierNotOpen`
    ///      stays reachable for the life of the seeded chain and the tier ladder is not a length-1
    ///      degenerate case.
    function _seedGatedErc1155(Deployed memory d, address merkleGating) internal returns (address instance) {
        (bytes32 tier0Root,,) = _buildTier(ADMIN, VEIL_T0_ADMIN_QTY, PERSON, VEIL_T0_MEMBER_QTY, acct1);
        (bytes32 tier1Root,,) = _buildTier(ADMIN, VEIL_T1_ADMIN_QTY, PERSON, VEIL_T1_MEMBER_QTY, acct1);

        bytes32[] memory roots = new bytes32[](VEIL_TIER_COUNT);
        roots[0] = tier0Root;
        roots[1] = tier1Root;
        uint256[] memory tierOpenTimes = new uint256[](VEIL_TIER_COUNT);
        tierOpenTimes[0] = 0; // open immediately
        tierOpenTimes[1] = block.timestamp + VEIL_TIER1_DELAY; // still closed after every advance

        vm.startBroadcast(deployerKey);
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: "veil-list",
            symbol: "VEIL",
            metadataURI: _collectionMetaWithAllowlist(
                "Veil List",
                "An allowlisted edition. The list is the door - prove membership and the veil parts; everyone else is turned away by the contract.",
                ART_VEIL,
                VEIL_EDITION,
                _allowlistListUri(ADMIN, VEIL_T0_ADMIN_QTY, PERSON, VEIL_T0_MEMBER_QTY)
            ),
            creator: deployer,
            vault: d.vault,
            styleUri: "",
            gatingModule: merkleGating,
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
        instance = d.erc1155.createInstance(keccak256(abi.encode(block.timestamp, "veil-list")), params);
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN

        ERC1155Instance(payable(instance))
            .addEdition(
                "Veil Pass",
                0.003 ether,
                50,
                _pieceMeta("Veil Pass", ART_VEIL_PIECE, "veil-list"),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0,
                VEIL_FREE_ALLOC
            );

        // Post-create, by the instance owner — the factory threads no gating config (the generic
        // slot bakes in no module's config shape), so this second tx is the intended path.
        IMerkleGatingModule(merkleGating)
            .configureFor(
                instance, MerkleConfig({ editionId: VEIL_EDITION, roots: roots, tierOpenTimes: tierOpenTimes })
            );

        d.queue.rentFeatured{ value: 1 ether }(instance, 30 days, 0.032 ether);
        vm.stopBroadcast();

        _assertGatedErc1155(instance, merkleGating, roots, tierOpenTimes);

        console.log("GATED ERC1155 veil-list:", instance);
        console.log("  edition:", VEIL_EDITION, "scope: BOTH (paid mint + free claim are both gated)");
        console.log("  tier 0 OPEN  - allowlisted:", ADMIN, "maxQty:", VEIL_T0_ADMIN_QTY);
        console.log("                 allowlisted:", PERSON, "maxQty:", VEIL_T0_MEMBER_QTY);
        console.log("  tier 1 CLOSED until unix:", tierOpenTimes[1]);
        console.log("  NOT allowlisted (refusal path):", acct1);
    }

    /// @dev GATED ERC-404, scope FREE_MINT_ONLY — the free-claim path is gated and paid buys stay
    ///      open, which is the half of `GatingScope` an all-`BOTH` fixture cannot distinguish from
    ///      the scope being ignored. ERC404 has no editions, so the module is configured at
    ///      editionId 0 with a single tier (the app resolves tier 0 only).
    function _seedGatedErc404(Deployed memory d, address merkleGating) internal returns (address instance) {
        (bytes32 root,,) = _buildTier(ADMIN, SIGIL_MAX_QTY, PERSON, SIGIL_MAX_QTY, acct1);

        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory tierOpenTimes = new uint256[](1);
        tierOpenTimes[0] = 0;

        vm.startBroadcast(deployerKey);
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, "sigil-gate", "ERC404")),
            name: "sigil-gate",
            symbol: "SIGIL",
            styleUri: "",
            tokenBaseURI: ART_BASE_DOODLE,
            owner: deployer,
            vault: d.vault,
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
        instance = d.erc404
            .createInstance(
                params,
                _collectionMetaWithAllowlist(
                    "Sigil Gate",
                    "A curve whose free claim is sigil-locked: the allowlist opens the claim, the open market opens to everyone.",
                    ART_SIGIL,
                    0,
                    _allowlistListUri(ADMIN, SIGIL_MAX_QTY, PERSON, SIGIL_MAX_QTY)
                ),
                d.uniDeployer,
                merkleGating,
                FreeMintParams({ allocation: SIGIL_FREE_ALLOC, scope: GatingScope.FREE_MINT_ONLY })
            );
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN

        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        // The cap in the leaf is denominated in TOKENS (the free-claim path forwards `unit` as the
        // amount), and the leaf was built before the instance existed. If the preset's unit is not
        // what the leaf committed to, every claim would revert `QtyCapExceeded` on a valid proof —
        // so the assumption is checked here, before the root is installed.
        require(b.unit() == SIGIL_UNIT, "gating: sigil-gate unit differs from the cap encoded in the leaves");

        // Free claims are part of the curve and revert `TooEarly` before it opens: +1h, crossed by
        // deploy.ts's FIRST advance, same as every other armed instance in this phase.
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);

        IMerkleGatingModule(merkleGating)
            .configureFor(instance, MerkleConfig({ editionId: 0, roots: roots, tierOpenTimes: tierOpenTimes }));

        d.queue.rentFeatured{ value: 1 ether }(instance, 30 days, 0.031 ether);
        vm.stopBroadcast();

        _assertGatedErc404(instance, merkleGating, roots);

        console.log("GATED ERC404 sigil-gate:", instance);
        console.log("  scope: FREE_MINT_ONLY (claimFreeMint gated; buyBonding open)");
        console.log("  allowlisted:", ADMIN, "maxQty (tokens):", SIGIL_MAX_QTY);
        console.log("  allowlisted:", PERSON, "maxQty (tokens):", SIGIL_MAX_QTY);
        console.log("  NOT allowlisted (refusal path):", acct1);
    }

    /// @dev Read the ERC1155 fixture back off-chain-state. Everything asserted here is something the
    ///      walk depends on and nothing here restates a comment: the module must be ATTACHED (the
    ///      factory silently accepts address(0)), the scope must be the one that gates the paid path,
    ///      the edition id must be the one the config keyed to, and the installed roots must be the
    ///      roots that were proven above.
    function _assertGatedErc1155(
        address instance,
        address merkleGating,
        bytes32[] memory roots,
        uint256[] memory tierOpenTimes
    ) internal view {
        ERC1155Instance veil = ERC1155Instance(payable(instance));
        require(address(veil.gatingModule()) == merkleGating, "gating: veil-list has no gating module attached");
        require(veil.gatingScope() == GatingScope.BOTH, "gating: veil-list scope is not BOTH");
        require(veil.nextEditionId() == VEIL_EDITION + 1, "gating: veil-list edition id is not the configured one");
        require(veil.freeMintAllocation(VEIL_EDITION) > 0, "gating: veil-list free-claim allocation is 0");

        bytes32[] memory installed = IMerkleGatingView(merkleGating).getRoots(instance, VEIL_EDITION);
        uint256[] memory installedOpens = IMerkleGatingView(merkleGating).getTierOpenTimes(instance, VEIL_EDITION);
        require(installed.length == VEIL_TIER_COUNT, "gating: veil-list did not install both tiers");
        require(installedOpens.length == VEIL_TIER_COUNT, "gating: veil-list tier open times are not parallel");
        for (uint256 i = 0; i < VEIL_TIER_COUNT; i++) {
            require(installed[i] == roots[i], "gating: veil-list installed a root that was never proven");
            require(installedOpens[i] == tierOpenTimes[i], "gating: veil-list tier open time drifted");
        }
        // The two tiers must actually be STAGGERED on the seeded chain, or `TierNotOpen` is unwalkable.
        require(installedOpens[0] <= block.timestamp, "gating: veil-list tier 0 is not open");
        require(installedOpens[1] > block.timestamp, "gating: veil-list tier 1 is not still closed");
    }

    /// @dev Same read-back for the ERC404 fixture. `gatingActive` is checked because the module is
    ///      consulted only while it is true, and the buy path clears it on a `permanent` allow —
    ///      an allowlist is deliberately never permanent, and a fixture that shipped with it already
    ///      cleared would be an open collection wearing a gated label.
    function _assertGatedErc404(address instance, address merkleGating, bytes32[] memory roots) internal view {
        ERC404BondingInstance sigil = ERC404BondingInstance(payable(instance));
        require(address(sigil.gatingModule()) == merkleGating, "gating: sigil-gate has no gating module attached");
        require(sigil.gatingActive(), "gating: sigil-gate gating is not active");
        require(sigil.gatingScope() == GatingScope.FREE_MINT_ONLY, "gating: sigil-gate scope is not FREE_MINT_ONLY");
        require(sigil.freeMintAllocation() == SIGIL_FREE_ALLOC, "gating: sigil-gate has nothing to claim");

        bytes32[] memory installed = IMerkleGatingView(merkleGating).getRoots(instance, 0);
        require(installed.length == 1, "gating: sigil-gate did not install its tier");
        require(installed[0] == roots[0], "gating: sigil-gate installed a root that was never proven");
    }

    // ─────────────────────── Phase 1 post-conditions ───────────────────────

    /// @notice Assert, on-chain, every state PHASE 1 claims to have created.
    ///
    /// @dev WHY `require` AND NOT `console.log`. Forge simulates a whole script before broadcasting
    ///      any of it, so a failed post-condition here leaves NO partial seed and names the assert
    ///      that failed. A comment claiming an outcome is not an outcome — this seed carried such a
    ///      comment about the free-claim configuration, and the state it described was never created.
    ///      Do not soften an assertion to make a run pass: a failing post-condition is the tool
    ///      working, and the seed refusing to complete is cheaper than a walk built on a false premise.
    ///
    ///      Each post-condition lives in the phase where the state it describes actually exists.
    ///      Phase 1 creates and ARMS: nothing is bought, staked or ADMIN-held here, so the holder-side
    ///      checks are in SeedAnvilBuys and the registry handover check is in deploy.ts. A
    ///      post-condition in the wrong phase is vacuous, not merely misplaced.
    ///
    ///      NOT ASSERTED, deliberately: the staking reward stream. `rewardRate` is reachable only via
    ///      `recordFeesReceived` <- `claimAllFees` <- a vault fee DELTA, and vaults receive nothing
    ///      until graduation, while the staking instance (vapor-mid) deliberately never graduates. A
    ///      direct ETH donation cannot substitute, because claimAllFees measures a delta across the
    ///      vault loop. The stake/unstake surface is therefore seeded and walkable; the CLAIM surface
    ///      is not, and there is nothing to claim for any address. That is a stated residual, not an
    ///      oversight — reaching it needs a graduated instance with a staking module, which no seeded
    ///      instance is.
    ///
    ///      NOT ASSERTED, deliberately: the deploy-bond escrow. `bondAmount` stays 0. Turning it on
    ///      requires `setBondAmount` to run after the LAST create (every 404 create here sends
    ///      msg.value 0 and the factory reverts InsufficientBond below the bond), and reading the
    ///      escrow's address means widening the Deployed struct. The escrow stays inert and the walk
    ///      records it as not-covered rather than half-covered.
    function _assertPhase1(address c0, address c2) internal view {
        // 1. FREE-CLAIM ALLOCATION. The free-claim collection must actually carry an allocation on
        //    the edition claimFreeMint targets, or the whole free-claim surface is unwalkable and
        //    claimFreeMint reverts for everyone.
        uint256 alloc = ERC1155Instance(payable(c2)).freeMintAllocation(GHOST_MINT_EDITION);
        require(alloc > 0, "phase1: ghost-mint free-claim allocation is 0 (nothing is claimable)");

        // 2. LIMITED_DYNAMIC COVERAGE — asserted as a REGIME, not as a configuration. Checking only
        //    that pricingModel is LIMITED_DYNAMIC and the rate is non-zero would pass with a rate too
        //    small to see across a handful of mints, which is a flat curve wearing a dynamic label.
        //    So: read the edition back, then ask the module what it will actually charge.
        ERC1155Instance neonDrift = ERC1155Instance(payable(c0));
        (,, uint256 basePrice,,,, ERC1155Instance.PricingModel model, uint256 rate,) =
            neonDrift.editions(NEON_DRIFT_DYNAMIC_EDITION);
        require(model == ERC1155Instance.PricingModel.LIMITED_DYNAMIC, "phase1: dynamic edition is not LIMITED_DYNAMIC");
        require(basePrice > 0, "phase1: dynamic edition has no base price");

        IDynamicPricingModule pricer = neonDrift.dynamicPricingModule();
        require(address(pricer) != address(0), "phase1: no dynamic pricing module wired to the instance");
        uint256 priceAfterProbe = pricer.calculatePrice(basePrice, rate, DYN_PROBE_MINTS);
        require(
            priceAfterProbe >= basePrice * DYN_MIN_MULTIPLE,
            "phase1: dynamic price does not move enough to be visible across a handful of mints"
        );

        console.log("PHASE-1 post-conditions OK");
        console.log("  ghost-mint free-claim allocation:", alloc);
        console.log("  dynamic edition base price (wei):", basePrice);
        console.log("  dynamic price after 5 mints (wei):", priceAfterProbe);
    }

    // ─────────────────────────── Phase A: ERC1155 ───────────────────────────

    /// @dev Creates the 3 original collections, gives each real editions, makes ghost-mint a
    ///      free-claim collection, features them, seeds the endowment, and writes the deployer
    ///      profile + activity. Returns c0 (used by later activity posts) and c2 (the free-claim
    ///      collection, checked in `_assertPhase1`).
    function _seedErc1155(Deployed memory d) internal returns (address c0, address c2) {
        vm.startBroadcast(deployerKey);

        // c0 binds to the Aave ENDOWMENT vault so its collection page shows the endowment panel.
        c0 = _createCollection(
            d.erc1155,
            d.endowmentVault,
            0,
            "neon-drift",
            "Neon Drift",
            "Generative monochrome fragments. An edition aligned to the MS2 community.",
            ART_NEON_DRIFT
        );
        address c1 = _createCollection(
            d.erc1155,
            d.vault,
            1,
            "monolith",
            "Monolith",
            "One slab, many hands. A minimalist open edition.",
            ART_MONOLITH
        );
        // c2: free-claim. The free-mint allocation is per edition and is set on the Ghost edition
        // below, via addEdition's freeMintAlloc argument.
        c2 = _createCollection(
            d.erc1155,
            d.vault,
            2,
            "ghost-mint",
            "Ghost Mint",
            "Faint signals from the fossil layer. Free-claim editions.",
            ART_GHOST_MINT
        );

        // Editions. basePrice must be > 0 even for the free-claim collection (addEdition reverts on
        // zero price; claimFreeMint ignores price — the edition just needs to exist as a target).
        // PricingModel: 0=UNLIMITED (open, fixed price, supply MUST be 0), 1=LIMITED_FIXED,
        // 2=LIMITED_DYNAMIC (needs the dynamic module + a non-zero rate). openTime=0 => open now.
        ERC1155Instance(payable(c0))
            .addEdition(
                "Aberration #1",
                0.01 ether,
                50,
                _pieceMeta("Aberration #1", ART_ABERRATION, "neon-drift"),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0,
                0
            );
        ERC1155Instance(payable(c0))
            .addEdition(
                "Drift Open",
                0.005 ether,
                0,
                _pieceMeta("Drift Open", ART_DRIFT_OPEN, "neon-drift"),
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0,
                0
            );

        // Edition 3 on c0: the LIMITED_DYNAMIC (exponential) pricing regime. Every other seeded
        // edition is UNLIMITED or LIMITED_FIXED, so without this one DynamicPricingModule is never
        // reached by anything a walker can click, and the exponential path ships unwalked.
        //
        // DYN_RATE_BPS is chosen so the rise is VISIBLE across a handful of mints rather than merely
        // non-zero: calculatePrice compounds (10000 + rate)/10000 per mint, so 2000 bps doubles the
        // price in under 4 mints (1.2^4 = 2.07). A rate small enough to need a spreadsheet to see is
        // a flat curve wearing a dynamic label, which is the failure mode this edition exists to
        // make observable — hence the assertion in _assertPhase1 is about PRICE MOVEMENT, not about
        // the pricingModel field being set.
        ERC1155Instance(payable(c0))
            .addEdition(
                "Aberration Rising",
                DYN_BASE_PRICE,
                50,
                _pieceMeta("Aberration Rising", ART_ABERRATION, "neon-drift"),
                ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
                DYN_RATE_BPS,
                0,
                0
            );

        ERC1155Instance(payable(c1))
            .addEdition(
                "Slab",
                0.002 ether,
                0,
                _pieceMeta("Slab", ART_SLAB, "monolith"),
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0,
                0
            );

        // ghost-mint needs at least one edition so claimFreeMint has a target. The last argument is
        // the edition's free-mint allocation: 5 free claims reserved out of the supply of 100.
        ERC1155Instance(payable(c2))
            .addEdition(
                "Ghost",
                0.001 ether,
                100,
                _pieceMeta("Ghost", ART_GHOST, "ghost-mint"),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0,
                5
            );

        // Feature each (rentFeatured) so it surfaces in getHomePageData. rankBoost descends for a
        // stable order; a generous value covers the cost and the excess refunds.
        uint256 duration = 30 days;
        d.queue.rentFeatured{ value: 1 ether }(c0, duration, 0.03 ether);
        d.queue.rentFeatured{ value: 1 ether }(c1, duration, 0.02 ether);
        d.queue.rentFeatured{ value: 1 ether }(c2, duration, 0.01 ether);

        // Seed the endowment so c0's vault panel shows real principal (benefactor = the c0 instance).
        IAlignmentVault(payable(d.endowmentVault)).receiveContribution{ value: 0.5 ether }(
            Currency.wrap(address(0)), 0.5 ether, c0
        );

        // Deployer profile + activity (POST=0 to own wall: instance == sender).
        d.profiles
            .setProfile(
                _profileMeta(
                    "MS2 Labs",
                    "ms2labs",
                    "Building the lean onchain launchpad. Alignment is the product.",
                    ART_AVATAR_1
                )
            );
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
        string memory image
    ) internal returns (address instance) {
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: slug,
            symbol: "", // optional collection symbol (noesis-084)
            metadataURI: _collectionMeta(displayName, description, image),
            creator: deployer,
            vault: vault,
            styleUri: "",
            gatingModule: address(0),
            // allocation is per edition for ERC1155; the factory refuses a non-zero value here.
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
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
            d,
            "gallery-relics",
            "Gallery Relics",
            "A single-line auction house for salvaged relics - one piece up at a time, highest bid takes it. ~20% of the hammer binds to the alignment vault.",
            "GAL",
            ART_GALLERY,
            1 hours
        );
        ERC721AuctionInstance g = ERC721AuctionInstance(payable(gallery));
        // Each queuePiece's msg.value = minBid; first piece per line auto-starts (endTime = now+1h).
        g.queuePiece{ value: 0.05 ether }(_pieceMeta("Relic I", ART_RELIC_I, "gallery-relics")); // tokenId 1, line 0
        g.queuePiece{ value: 0.05 ether }(_pieceMeta("Relic II", ART_RELIC_II, "gallery-relics")); // tokenId 2, line 1
        d.queue.rentFeatured{ value: 1 ether }(gallery, 30 days, 0.025 ether);
        vm.stopBroadcast();

        // acct1 bids on piece #1 (a non-owner EOA; settleAuction _safeMints to the winner).
        vm.startBroadcast(ACCOUNT_1_KEY);
        g.createBid{ value: 0.1 ether }(1, "");
        vm.stopBroadcast();
    }

    // ─────────────────────────── Phase E: ERC721 live ───────────────────────────

    /// @dev Live auction with a LONG 1-day duration so it stays active well past the +2h chain
    ///      advance. One piece gets a bid (active-with-bids), the other is active-no-bid (clean bid
    ///      form to demo). Both keep counting down (chain-anchored countdown in the UI).
    function _seedErc721Live(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address live = _createAuction(
            d,
            "live-salon",
            "Live Salon",
            "The Live Salon runs a rolling single-line auction - a new work on the block, bidding open now. Collect the piece, fund the vault.",
            "LIV",
            ART_LIVE_SALON,
            1 days
        );
        ERC721AuctionInstance l = ERC721AuctionInstance(payable(live));
        l.queuePiece{ value: 0.05 ether }(_pieceMeta("Salon I", ART_SALON_I, "live-salon")); // tokenId 1, line 0
        l.queuePiece{ value: 0.05 ether }(_pieceMeta("Salon II", ART_SALON_II, "live-salon")); // tokenId 2, line 1
        d.queue.rentFeatured{ value: 1 ether }(live, 30 days, 0.04 ether);
        vm.stopBroadcast();

        vm.startBroadcast(ACCOUNT_1_KEY);
        l.createBid{ value: 0.1 ether }(1, ""); // piece #1 active-with-bids; piece #2 stays no-bid
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
        // Cypher LP venue + Cypher (Algebra) vault. This instance covers the PREOPEN phase only —
        // it never opens, so no Algebra pool is deployed from here. Cypher's graduation rail is
        // covered by `quench-ready` below, which is armed to graduate like its uniV4/ZAMM siblings.
        address inst = _createBonding(
            d,
            "ember-preopen",
            "Ember",
            "Ember hasn't caught yet. When the curve opens, each buy mints a glowing shard; ~20% of every trade binds to the alignment vault, by contract.",
            "EMBER",
            ART_EMBER,
            ART_BASE_DOODLE,
            address(0),
            d.cypherVault,
            d.cypherDeployer,
            0,
            10,
            PRESET_SOURCE
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // +1 DAY, not +1h: this one must stay preopen through BOTH of deploy.ts's advances (~3h
        // total). It is the only ERC404 the seed never buys into, which is the point of it.
        b.setBondingOpenTime(block.timestamp + 1 days);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.06 ether);
        vm.stopBroadcast();
        _seeded.ember = inst;
    }

    /// @dev MID-CURVE: the main demo. Created WITH the staking module and armed here; the buys
    ///      (BondingSale events -> price history for candles), staking activation and the ADMIN unit
    ///      hand-off all happen in SeedAnvilBuys, after the chain crosses openTime. No graduation.
    function _seedErc404MidCurve(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        // Uni-V4 LP venue + Uni LP vault (mid-curve; does not graduate).
        address inst = _createBonding(
            d,
            "vapor-mid",
            "Vapor",
            "Vapor is live on the curve - trade the coin, hold the piece, stake for a cut of the flow. A DN404 where the token and the art are one asset.",
            "VAPOR",
            ART_VAPOR,
            ART_BASE_ANIME,
            d.stakingModule,
            d.vault,
            d.uniDeployer,
            10000,
            10,
            PRESET_SOURCE
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // openTime must be strictly future at broadcast; +1h clears any broadcast lag. deploy.ts
        // crosses it with its FIRST advance, before SeedAnvilBuys runs -> derivePhase=bonding.
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.05 ether);
        vm.stopBroadcast();
        _seeded.vapor = inst;
    }

    /// @dev READY-TO-GRADUATE: armed here; the single buy that gives it the reserve > 0 that
    ///      deployLiquidity requires happens in SeedAnvilBuys. Maturity is set so that after BOTH of
    ///      deploy.ts's advances it has passed -> deployLiquidity's isMatured becomes true and the UI
    ///      surfaces the graduate button. Maturity +90m sits deliberately AFTER the first advance
    ///      (+1h) so the buy lands on an open, un-matured curve, and before the ~3h total so it ends
    ///      matured. We do NOT call deployLiquidity (it hits an external AMM); the human graduates
    ///      live. No vm.warp.
    ///      One graduate-ready instance is seeded per LP venue, so the graduation rail and the
    ///      post-graduation surface can be exercised on each: cinder-ready (Uni-V4 -> swapV4),
    ///      molten-ready (ZAMM -> swapVZ) and quench-ready (Cypher/Algebra). The Cypher sibling has
    ///      no embedded swap surface — its post-graduation trade path is a link-out — so what it
    ///      covers is the deployer module and the Algebra pool creation itself, which the Algebra
    ///      stack on the mainnet fork can serve at the same addresses mainnet uses.
    function _seedErc404ReadyToGraduate(Deployed memory d) internal {
        // Uni-V4 LP venue + Uni LP vault — graduating stands up a real V4 pool (embedded swapV4).
        // Declared max 10000: the creator kept full carve rights (shown pre-buy on the primary surface).
        _seeded.cinder = _seedReadyToGraduate(
            d,
            "cinder-ready",
            "Cinder",
            "Cinder's curve is nearly spent - one push from graduating to a Uniswap V4 pool. Late embers, deep discounts.",
            "CINDER",
            ART_CINDER,
            ART_BASE_ARCTIC,
            d.vault,
            d.uniDeployer,
            0.045 ether,
            10000
        );
        // ZAMM LP venue + ZAMM LP vault — graduating stands up a ZAMM pool (embedded swapVZ).
        // Declared max 2500: a partial-carve disclosure so the UI shows a non-round value too.
        _seeded.molten = _seedReadyToGraduate(
            d,
            "molten-ready",
            "Molten",
            "Molten runs hot and ready to pour - matured and one call from a ZAMM pool. The curve's last stretch before the DEX.",
            "MOLTEN",
            ART_MOLTEN,
            ART_BASE_SIMIAN,
            d.zammVault,
            d.zammDeployer,
            0.043 ether,
            2500
        );
        // Cypher LP venue + Cypher (Algebra) vault — graduating stands up a real Algebra pool via
        // ModuleCypherDeployer. Declared max 5000: a third distinct disclosure value.
        _seeded.quench = _seedReadyToGraduate(
            d,
            "quench-ready",
            "Quench",
            "Quench is matured and one call from an Algebra pool - the curve's last stretch before the DEX.",
            "QUENCH",
            ART_QUENCH,
            ART_BASE_DOODLE,
            d.cypherVault,
            d.cypherDeployer,
            0.042 ether,
            5000
        );
    }

    function _seedReadyToGraduate(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory description,
        string memory symbol,
        string memory image,
        string memory pieceBase,
        address vault,
        address deployer_,
        uint256 rankBoost,
        uint16 declaredMaxBps
    ) internal returns (address inst) {
        vm.startBroadcast(deployerKey);
        inst = _createBonding(
            d,
            slug,
            name,
            description,
            symbol,
            image,
            pieceBase,
            address(0),
            vault,
            deployer_,
            declaredMaxBps,
            10,
            PRESET_SOURCE
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // openTime +1h (crossed by deploy.ts's FIRST advance, so the phase-2 buy lands on an open
        // curve), maturity +90m (still ahead at buy time, crossed by the SECOND advance) so the
        // curve ends bonding AND matured (graduate unlocked).
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingMaturityTime(block.timestamp + 90 minutes);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, rankBoost);
        vm.stopBroadcast();
    }

    /// @dev CARVE DEMO: an ERC404 that declared the FULL carve allowance (declaredMax = 10000) and
    ///      builds a deep-enough reserve (>= 3 ETH) that graduating with a carve is meaningful:
    ///      allowance(3 ETH) = 1.5 ETH, LP-80 headroom above the 1 ETH pool floor = 1.4 ETH, so a
    ///      full-request graduation carves ~1.4 ETH (80% creator / 19% vault / 1% protocol).
    ///      The GRADUATION itself happens in deploy.ts AFTER the +2h chain advance (openTime is
    ///      strictly-future at seed time, and vm.warp is a no-op under --broadcast), calling
    ///      deployLiquidity(10000) as ADMIN — so the app boots with a graduated-WITH-carve
    ///      collection on a real Uni-V4 pool.
    function _seedErc404CarveDemo(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(
            d,
            "carved-demo",
            "Carved",
            "Carved declared its full creator carve up front - the maximum cut was on the label before the first buy. Graduated with the carve taken; the pool floor held.",
            "CARVE",
            ART_CARVED,
            ART_BASE_ANIME,
            address(0),
            d.vault,
            d.uniDeployer,
            10000,
            10,
            PRESET_SOURCE
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingMaturityTime(block.timestamp + 90 minutes);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.041 ether);
        vm.stopBroadcast();
        // The reserve-building buy walk is in SeedAnvilBuys, along with the assertion that it
        // actually cleared 3 ETH.
        _seeded.carve = inst;
    }

    /// @dev STACKED METADATA: an ERC404 created via the factory's metadata overload (NOT the gating
    ///      param), wiring resolver(router) → [overlay, tier]. Both the economic ladder and the band
    ///      art table are sealed at create, from the SAME derived id ranges.
    ///      The ladder is one SCARCE tier: `weight: 5, count: 1` against the 10-id supply. The factory
    ///      derives its range as the single id 11 — above the instance's id ceiling (nftCount = 10),
    ///      because DN404's auto-mint bounds emitted ids to [1..idLimit] (`_wrapNFTId`, DN404.sol:531,
    ///      544), so band ids are never handed out by an ordinary buy. `count: 1` is BELOW the maximum
    ///      the supply could back (10 / 5 = 2 ids), which is what makes the tier scarce: the second
    ///      `mintUp` into it reverts `BandExhausted` until a holder mints down, and the demo shows a
    ///      capped tier rather than one that can never sell out.
    ///      Post-create the deployer (artist) publishes an opt-in event wave and a PAY commission on
    ///      id 3, then — as the holder of id 3 — unlocks + pins it. Precedence (overlay > tier > base)
    ///      is demonstrated in ART: each of the three layers is a DIFFERENT collection, so id 3
    ///      (commission), id 11 (band) and an ordinary id resolve to three visibly different images
    ///      rather than three labels that only a diff can tell apart.
    function _seedErc404Stacked(Deployed memory d) internal {
        // The ladder the creator supplies; the factory derives the id range (11-11) and seals both the
        // instance's economic ladder and the resolver's art table from it.
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](1);
        // The band's own metadata base — a DIFFERENT collection from the instance's ordinary-piece
        // base, so minting up into the band visibly changes the art rather than swapping one label
        // for another. Composes as `base + 11`.
        tiers[0] = ERC404Factory.TierSpec({ weight: 5, count: 1, baseURI: ART_BASE_ARCTIC });

        address[] memory children = new address[](2);
        children[0] = d.overlay; // precedence: holder pins/events win over...
        children[1] = d.tier; // ...static band art

        ERC404Factory.MetadataConfig memory meta = ERC404Factory.MetadataConfig({
            resolver: d.resolverRouter,
            childResolvers: children,
            overlay: d.overlay,
            tier: d.tier,
            tiers: tiers,
            autoLatest: false, // opt-in events — keeps band art visible by default
            defaultPayout: MetadataOverlayModule.Payout.ARTIST
        });

        vm.startBroadcast(deployerKey);
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, "prism-stacked", "ERC404")),
            name: "prism-stacked",
            symbol: "PRISM",
            styleUri: "",
            tokenBaseURI: ART_BASE_ANIME, // ordinary ids resolve to this collection's piece art
            owner: deployer,
            vault: d.zammVault, // ZAMM LP vault — pairs with the ZAMM deployer below
            nftCount: 10,
            presetId: 1,
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0 // no carve rights — metadata demo, not an economics one
        });
        address inst = d.erc404
            .createInstance(
                params,
                _collectionMeta(
                    "Prism",
                    "Prism refracts: a tiered ERC404 whose reserved id bands carry their own static art. Overlay + tier metadata, resolved on-chain.",
                    ART_PRISM
                ),
                d.zammDeployer,
                address(0),
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                meta
            );
        _instances.push(inst);

        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.035 ether);
        vm.stopBroadcast();
        _seeded.stacked = inst;

        // The buy-with-mint (ids 1,2,3) and the overlay authoring that depends on HOLDING id 3 are
        // both in SeedAnvilBuys — the unlock is a holder write, so it cannot precede the buy.

        console.log("STACKED prism instance:", inst);
        console.log("  overlay:", d.overlay);
        console.log("  tier   :", d.tier);
        console.log("  router :", d.resolverRouter);
    }

    /// @param image    the COLLECTION image (banner/card art) handed to the master registry at create.
    /// @param pieceBase the per-PIECE metadata base. `_tokenURI` composes `pieceBase + tokenId`, so this
    ///        must be a metadata directory ending in `/` — an empty base makes every `tokenURI` the bare
    ///        id, which carries no art for the frontend to render. One collection per instance.
    /// @param vault    the alignment/endowment vault the instance binds to (any of the 4 flavors)
    /// @param deployer_ the LP deployer module (Uni-V4 / ZAMM / Cypher) the curve graduates through.
    ///        Vault flavor and LP venue are independent axes — the seed spreads instances across both
    ///        so all four vaults and all three AMMs are demonstrated (and the graduated-swap surface
    ///        can be exercised per venue).
    /// @param nftCount   the collection's piece count. Together with the preset's `unitPerNFT` this is
    ///        the supply the curve is computed over; it is an INDEPENDENT axis from the raise, because
    ///        `CurveParamsComputer` solves the curve's shape from `liquidityReserveBps` alone and then
    ///        rescales its amplitude to hit `targetETH`. A catalog instance therefore carries its real
    ///        supply AND its real raise; neither has to give way to the other.
    /// @param presetId   the LaunchManager preset supplying `targetETH`/`unitPerNFT`/reserve/computer.
    function _createBonding(
        Deployed memory d,
        string memory slug,
        string memory name,
        string memory description,
        string memory symbol,
        string memory image,
        string memory pieceBase,
        address stakingModule,
        address vault,
        address deployer_,
        uint16 declaredMaxBps,
        uint256 nftCount,
        uint8 presetId
    ) internal returns (address instance) {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, slug, "ERC404")),
            name: slug,
            symbol: symbol,
            styleUri: "",
            tokenBaseURI: pieceBase,
            owner: deployer,
            vault: vault,
            nftCount: nftCount,
            presetId: presetId,
            stakingModule: stakingModule,
            declaredMaxAllowanceBps: declaredMaxBps
        });
        instance = d.erc404
            .createInstance(
                params,
                _collectionMeta(name, description, image),
                deployer_, // approved LIQUIDITY_DEPLOYER (the LP venue)
                address(0), // no gating
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            ); // msg.value 0: no creation fee on anvil
        _instances.push(instance); // tracked so _transferAdmin hands ownership to ADMIN
    }

    // ───────────────── THE ALIGNMENT CATALOG ROSTER (phase 1: create + arm) ─────────────────

    /// @dev Curate the alignment target's two registry legs and point its OWN LP vault at the pool
    ///      that can actually absorb liquidity.
    ///
    ///      THREE THINGS THAT LOOK LIKE ONE AND ARE NOT:
    ///        · the ACQUIRE ROUTE is registry curation — the venue a DAO-side convert is told to use;
    ///        · the REFERENCE POOL is the price authority the anti-sandwich floor reads, and a
    ///          Uniswap V3 pool is legal here and illegal as an acquire venue (`Venue` carries no V3);
    ///        · the vault's own V4 POOL KEY is where the vault deposits liquidity, and it is neither
    ///          of the above — it lives on the vault, not in the registry.
    ///      All three are set here because leaving any one of them at a default silently sends real
    ///      value to a pool that cannot serve it, and none of the three reads the others.
    ///
    ///      THE POOL KEY IS SET PER VAULT, NOT NETWORK-WIDE. `DeployCore` builds every vault's key
    ///      from the network's single fee/tick-spacing pair, so the deployment-wide default is the
    ///      0.3% tier. This target's deep pool is the 1% tier, and retuning the network default to
    ///      reach it would move the other target's vault and every graduating curve's launch venue
    ///      with it. The vault's `setV4PoolKey` is owner-only and the FACTORY owns every vault it
    ///      deploys, so the retune routes through the factory and touches exactly one vault. That is
    ///      why the factory address is exported to the deployment file at all.
    function _seedCultAlignmentLegs(Deployed memory d, address referencePool) internal {
        require(referencePool.code.length > 0, "catalog: the pinned reference pool holds no code");
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        IAlignmentRegistry.AcquireRoute memory route = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4,
            fee: CULT_ACQUIRE_FEE,
            tickSpacing: CULT_ACQUIRE_TICK_SPACING,
            feeOrHook: 0 // UNI_V4 leg: a ZAMM-only field must stay zero or the route is refused
        });
        IAlignmentRegistry.ReferencePool memory ref = IAlignmentRegistry.ReferencePool({
            pool: referencePool, kind: CULT_REFERENCE_KIND, twapWindow: CULT_REFERENCE_TWAP_WINDOW
        });

        // Native ETH is currency0 (address(0) sorts below every token), the alignment token is
        // currency1, hookless. `setV4PoolKey` re-validates the tier/spacing pairing and the currency
        // ordering, so a mis-specified key reverts here instead of surfacing as a failed convert.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(CULT_TOKEN),
            fee: CULT_ACQUIRE_FEE,
            tickSpacing: CULT_ACQUIRE_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        vm.startBroadcast(deployerKey);
        reg.setAcquireRoute(d.cultTargetId, CULT_TOKEN, route);
        reg.setReferencePool(d.cultTargetId, CULT_TOKEN, ref);
        IUniVaultFactoryAdmin(d.uniVaultFactory).setVaultPoolKey(d.cultUniVault, key);
        vm.stopBroadcast();

        _assertCultAlignmentLegs(d, referencePool);
    }

    /// @dev Read all three legs back off chain state. Each check is a property the seed depends on
    ///      and none of them restates a comment: an unset route reads as `Venue.NONE` and callers are
    ///      required to refuse rather than fall back to a hardcoded pool, an unset reference pool
    ///      reads as address(0) and disarms the price floor, and a pool key left at the deployment
    ///      default would point the vault's liquidity at the empty tier.
    function _assertCultAlignmentLegs(Deployed memory d, address referencePool) internal view {
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        IAlignmentRegistry.AcquireRoute memory storedRoute = reg.getAcquireRoute(d.cultTargetId, CULT_TOKEN);
        require(storedRoute.venue == IAlignmentRegistry.Venue.UNI_V4, "catalog: acquire route venue is not UNI_V4");
        require(storedRoute.fee == CULT_ACQUIRE_FEE, "catalog: acquire route is on the wrong fee tier");
        require(storedRoute.tickSpacing == CULT_ACQUIRE_TICK_SPACING, "catalog: acquire route tick spacing drifted");

        IAlignmentRegistry.ReferencePool memory storedRef = reg.getReferencePool(d.cultTargetId, CULT_TOKEN);
        require(storedRef.pool == referencePool, "catalog: reference pool is not the pinned one");
        require(storedRef.kind == CULT_REFERENCE_KIND, "catalog: reference pool oracle kind drifted");

        IUniVaultView vault = IUniVaultView(d.cultUniVault);
        require(vault.alignmentToken() == CULT_TOKEN, "catalog: the resolved vault is not bound to the target token");
        require(vault.alignmentTargetId() == d.cultTargetId, "catalog: the resolved vault is on another target");
        (Currency c0, Currency c1, uint24 fee, int24 spacing,) = vault.v4PoolKey();
        require(Currency.unwrap(c0) == address(0), "catalog: vault pool key currency0 is not native ETH");
        require(Currency.unwrap(c1) == CULT_TOKEN, "catalog: vault pool key currency1 is not the alignment token");
        require(fee == CULT_ACQUIRE_FEE, "catalog: vault is still LPing into the deployment-default fee tier");
        require(spacing == CULT_ACQUIRE_TICK_SPACING, "catalog: vault pool key tick spacing drifted");

        console.log("CATALOG alignment legs set on target id:", d.cultTargetId);
        console.log("  acquire  : UNI_V4 fee", uint256(CULT_ACQUIRE_FEE), "tickSpacing 200");
        console.log("  reference:", referencePool);
        console.log("  LP vault :", d.cultUniVault);
    }

    /// @dev Give the curated acquire pool the depth the curated route already claims.
    ///
    ///      WHY THE SEED PAYS FOR THIS AT ALL. The registry curates the native-ETH 1%/200 tier as the
    ///      target's acquire venue, the vault LPs into that same tier, and the fork's route pin sends
    ///      the executed buy there too — three legs naming one pool. On a bare mainnet fork that pool
    ///      carries a small fraction of the depth its same-fee V3 sibling does, so a demo-sized ETH ->
    ///      token buy prices far enough under the reference TWAP to trip the vault's -5% oracle floor
    ///      and revert the convert. The floor is correct and is left alone; what changes is the pool.
    ///
    ///      WHERE THE TOKEN LEG COMES FROM. A two-sided position needs the alignment token and the
    ///      seed holds only ETH, so the seeder buys the token leg on the deep V3 pool — real tokens at
    ///      a real price rather than fabricated balances. That buy nudges the token's price up on the
    ///      reference pool, which moves the vault's floor DOWN (the floor is a minimum token-out
    ///      derived from the reference price), so it cannot be what breaks a later convert.
    ///
    ///      WHAT THIS DOES NOT TOUCH: the reference pool's role as the price authority, the vault's
    ///      own pool key, the network-wide fee/tick default, and the oracle floor. Only the pool's
    ///      liquidity moves.
    function _seedCultPoolDepth(Deployed memory d) internal {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(CULT_TOKEN),
            fee: CULT_ACQUIRE_FEE,
            tickSpacing: CULT_ACQUIRE_TICK_SPACING,
            hooks: IHooks(address(0))
        });

        uint128 before = IPoolManager(V4_POOL_MANAGER).getLiquidity(key.toId());

        vm.startBroadcast(deployerKey);
        AnvilV4DepthSeeder seeder = new AnvilV4DepthSeeder(
            IPoolManager(V4_POOL_MANAGER), IUniswapV3PoolMinimal(CULT_REFERENCE_POOL_V3), WETH, CULT_TOKEN
        );
        (uint128 liquidityAdded, uint256 ethUsed, uint256 tokenUsed) =
            seeder.seedDepth{ value: CULT_DEPTH_BUDGET }(key, CULT_DEPTH_HALF_WIDTH_TICKS);
        vm.stopBroadcast();

        // Read the tier back off the pool manager rather than trusting the seeder's return: the
        // number that decides whether a convert survives the floor is the pool's ACTIVE liquidity,
        // and a position minted outside the current tick range would report units while adding none
        // of the depth the acquire leg swaps through.
        uint128 nowActive = IPoolManager(V4_POOL_MANAGER).getLiquidity(key.toId());
        require(liquidityAdded > 0, "catalog: the acquire pool's depth seed minted no liquidity");
        require(nowActive > before, "catalog: the depth seed did not land in the pool's active range");
        require(
            nowActive >= CULT_DEPTH_MIN_ACTIVE_LIQUIDITY,
            "catalog: the acquire pool is still too thin to serve a demo-sized convert"
        );

        console.log("CATALOG acquire-pool depth seeded (UNI_V4 fee 10000 / spacing 200)");
        console.log("  budget spent (wei):", CULT_DEPTH_BUDGET);
        console.log("  ETH leg deposited (wei):", ethUsed);
        console.log("  token leg deposited:", tokenUsed);
        console.log("  active liquidity before:", uint256(before));
        console.log("  active liquidity after :", uint256(nowActive));
        console.log("  seeder (holds the position):", address(seeder));
    }

    /// @dev Register the four catalog-sized curve presets. `setPreset` guards only against a zero
    ///      target, a zero unit, an out-of-band reserve and a zero computer — there is no ceiling on
    ///      `targetETH` anywhere in the contract, so a raise the size of a real collection's is
    ///      expressible today and needs no protocol change. Everything except the target is carried
    ///      over from the STANDARD preset, so a catalog curve differs from a production one in SIZE
    ///      ONLY; read the source preset rather than restating its fields, or the two drift apart
    ///      silently the first time STANDARD is retuned.
    ///
    ///      ARMING IS FREE. A preset only prices the curve; nothing is spent until somebody buys along
    ///      it. So a row can carry the raise its real counterpart suggests while the seed buys a
    ///      fraction of it, which is exactly what phase 2 does on the three large rows.
    function _registerCatalogPresets(Deployed memory d) internal {
        LaunchManager lm = LaunchManager(d.launchManager);
        LaunchManager.Preset memory std = lm.getPreset(PRESET_SOURCE);

        vm.startBroadcast(deployerKey);
        _setCatalogPreset(lm, std, PRESET_SCHIZO, SCHIZO_REAL_RAISE);
        _setCatalogPreset(lm, std, PRESET_PIXELADY, PIXELADY_REAL_RAISE);
        _setCatalogPreset(lm, std, PRESET_BOREDMILADY, BOREDMILADY_REAL_RAISE);
        _setCatalogPreset(lm, std, PRESET_LAWBSTERS, LAWBSTERS_REAL_RAISE);
        vm.stopBroadcast();

        // A preset that did not take would surface much later as a curve priced for a raise nobody
        // chose. This is a WIRING check, not an accuracy claim: what it proves is that the preset the
        // seed registered is the preset the instance will be created against.
        _assertCatalogPreset(lm, std, PRESET_SCHIZO, SCHIZO_REAL_RAISE);
        _assertCatalogPreset(lm, std, PRESET_PIXELADY, PIXELADY_REAL_RAISE);
        _assertCatalogPreset(lm, std, PRESET_BOREDMILADY, BOREDMILADY_REAL_RAISE);
        _assertCatalogPreset(lm, std, PRESET_LAWBSTERS, LAWBSTERS_REAL_RAISE);

        console.log("CATALOG presets registered (ids 10-13), carried from preset", PRESET_SOURCE);
        console.log("  id 10 targetETH (wei):", lm.getPreset(PRESET_SCHIZO).targetETH);
        console.log("  id 11 targetETH (wei):", lm.getPreset(PRESET_PIXELADY).targetETH);
        console.log("  id 12 targetETH (wei):", lm.getPreset(PRESET_BOREDMILADY).targetETH);
        console.log("  id 13 targetETH (wei):", lm.getPreset(PRESET_LAWBSTERS).targetETH);
    }

    /// @dev One catalog preset: the protocol preset with a different raise, and nothing else changed.
    function _setCatalogPreset(LaunchManager lm, LaunchManager.Preset memory std, uint8 id, uint256 targetETH)
        internal
    {
        lm.setPreset(
            id,
            LaunchManager.Preset({
                targetETH: targetETH,
                unitPerNFT: std.unitPerNFT,
                liquidityReserveBps: std.liquidityReserveBps,
                curveComputer: std.curveComputer,
                active: true
            })
        );
    }

    function _assertCatalogPreset(LaunchManager lm, LaunchManager.Preset memory std, uint8 id, uint256 targetETH)
        internal
        view
    {
        LaunchManager.Preset memory got = lm.getPreset(id);
        require(got.targetETH == targetETH, "catalog: a preset did not take the raise it was registered with");
        require(got.unitPerNFT == std.unitPerNFT, "catalog: preset unit drifted from the protocol preset");
        require(
            got.liquidityReserveBps == std.liquidityReserveBps,
            "catalog: preset LP reserve drifted from the protocol preset"
        );
        require(got.curveComputer == std.curveComputer, "catalog: preset uses another curve computer");
        require(got.active, "catalog: preset registered inactive");
    }

    /// @dev FLAGSHIP — the largest curve on the roster, armed at the size a real collection of its
    ///      shape suggests. Phase 2 buys a FRACTION of it: arming costs nothing, and buying a curve
    ///      out to land the reserve on an exact figure would be spending real ETH to prop up an
    ///      accuracy claim this roster does not make. `declaredMax` is 0 deliberately — with no
    ///      creator carve the graduation arithmetic is the unmodified 1/19/80, which is the shape the
    ///      row is demonstrating.
    ///
    ///      The READY-TO-GRADUATE posture moved off this row and onto the small one below, where the
    ///      whole curve can be bought out for a couple of ETH and the graduate action is genuinely
    ///      live. `cinder`/`molten`/`quench` carry the same posture per LP venue.
    ///
    ///      ART: the real collection serves its metadata from a live third-party domain, so the
    ///      pieces take one of the seed's own pinned IPFS bases instead. Wiring the real host would
    ///      make this fork's art depend on somebody else's uptime and point our traffic at it.
    ///      Do not "improve" this into the real host.
    ///
    ///      DESCRIPTION: the LONG one on the roster, on purpose. The description field is demo
    ///      surface — a page that only ever renders one grey line has not been shown doing its job —
    ///      and the renderer takes plain text, so length and phrasing are the only axes there are.
    function _seedCatalogFlagship(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(
            d,
            "schizo-posters",
            "Schizo Posters",
            "A demonstration collection, standing in for a large poster drop so the biggest curve on this chain has a recognisable shape. Here is what the shape means. The curve is armed at a raise in the hundreds of ETH, and the price of the next piece is solved from that raise and the collection size together - so a big collection and a small one are the same mechanism at different amplitudes, not two different products. Every trade along the curve binds 19% of the take to an alignment target, by contract and without anybody choosing to be generous on the day. What is seeded here is a slice of that curve rather than the whole of it: the figures are illustrative, they are not measurements, and nothing on this page should be read as an audited number. The art is a stand-in too - the collection this row echoes serves its metadata from a web server rather than from content-addressed storage, and pointing a demonstration at somebody else's host is not something we do.",
            "SCHIZO",
            ART_SCHIZO,
            ART_BASE_ARCTIC,
            address(0),
            d.cultUniVault,
            d.uniDeployer,
            0, // no creator carve: the graduation split stays the unmodified 1/19/80
            SCHIZO_REAL_SUPPLY,
            PRESET_SCHIZO
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        // Open time crossed by the orchestrator's first advance so the phase-2 buys land on an open
        // curve. NO maturity time: this row is no longer the graduate demo, and a curve filled to a
        // quarter that also advertised a graduate action would be advertising one that cannot pay for
        // itself. We never call deployLiquidity here.
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.07 ether);
        vm.stopBroadcast();
        _assertPieceBase(ART_BASE_ARCTIC, "schizo-posters");
        _seeded.schizo = inst;

        console.log("CATALOG flagship (mid-curve, armed large):", inst);
    }

    /// @dev MID-CURVE — the instance the site's live features are demonstrated on, so it must sit
    ///      visibly mid-curve: bought into far enough that the curve, the holder surface and the
    ///      vault panel all have something real to render, and with NO maturity time set, so the
    ///      graduate action never unlocks and a demo cannot accidentally end it.
    ///
    ///      ART: the real collection's metadata is immutable IPFS whose entries are addressed by the
    ///      bare token id, which is exactly the `base + tokenId` concatenation the instance performs.
    ///      So this one carries the REAL art, re-hosted nowhere.
    function _seedCatalogMidCurve(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(
            d,
            "pixelady-maker",
            "Pixelady Maker",
            "A ten-thousand-piece demonstration collection, sitting mid-curve. Every trade routes 19% of the take to the alignment target this collection is bound to, by contract. The art is real and comes straight off content-addressed storage; the figures are illustrative.",
            "PXLDY",
            ART_PIXELADY,
            ART_BASE_PIXELADY,
            address(0),
            d.cultUniVault,
            d.uniDeployer,
            0,
            PIXELADY_REAL_SUPPLY,
            PRESET_PIXELADY
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        // No maturity time, deliberately — same shape as the other mid-curve instance. The buys are
        // in phase 2, after the chain crosses the open time.
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.068 ether);
        vm.stopBroadcast();
        _assertPieceBase(ART_BASE_PIXELADY, "pixelady-maker");
        _seeded.pixelady = inst;

        console.log("CATALOG mid-curve:", inst);
    }

    /// @dev SECOND MID-CURVE — a large, widely-recognised collection the roster was missing. Same
    ///      shape as the row above (no maturity time, a partial fill in phase 2) because the point it
    ///      makes is different: one recognisable row can be read as a one-off, two cannot.
    ///
    ///      ART: real, and content-addressed. `tokenURI(1)` on the collection this row echoes answers
    ///      `ipfs://<cid>/1` — bare-id form, which is exactly what `base + tokenId` reproduces — so
    ///      the pieces resolve to the actual art with no re-hosting and no third-party host in the path.
    ///
    ///      DESCRIPTION: the SHORT one on the roster, deliberately. A surface that renders the long
    ///      description well and collapses on a one-liner is still broken, and the only way to know is
    ///      to have both on the chain.
    function _seedCatalogSecondMidCurve(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(
            d,
            "bored-milady",
            "Bored Milady",
            "A demonstration collection, mid-curve, aligned at 19%. Illustrative figures, real art.",
            "BRDMLD",
            ART_BOREDMILADY,
            ART_BASE_BOREDMILADY,
            address(0),
            d.cultUniVault,
            d.uniDeployer,
            0,
            BOREDMILADY_REAL_SUPPLY,
            PRESET_BOREDMILADY
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.069 ether);
        vm.stopBroadcast();
        _assertPieceBase(ART_BASE_BOREDMILADY, "bored-milady");
        _seeded.boredmilady = inst;

        console.log("CATALOG second mid-curve:", inst);
    }

    /// @dev THE READY-TO-GRADUATE ROW, and it is the SMALL collection on purpose. A few-hundred-piece
    ///      curve armed at a few ETH can be bought out in full for a couple of ETH, so the graduate
    ///      action on this chain is genuinely live rather than a posture held at three hundred ETH of
    ///      fill. Phase 2 buys the curve out; GRADUATION IS LEFT UNCROSSED — a visitor performs it,
    ///      and watching the split happen is worth more than finding it already done.
    ///
    ///      Maturity is crossed by the orchestrator's second advance, which is what unlocks the action
    ///      without taking it. `deployLiquidity` is never called here or in phase 2.
    ///
    ///      ART: real, content-addressed, bare-id form — same test the two rows above pass.
    ///
    ///      DESCRIPTION: the one that names the mechanic it is here to show.
    function _seedCatalogGraduate(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        address inst = _createBonding(
            d,
            "lawbsters",
            "Lawbsters",
            "The graduate demo. This one is small enough that its whole curve is already bought, which is what unlocks the action on the collection page: graduating deploys the liquidity reserve into a real pool and settles the 1/19/80 split, 19% of it bound to the alignment target. It has not been graduated yet - that is the button, and it is left for you to press. Demonstration collection with illustrative figures; the art is the collection's own.",
            "LAWB",
            ART_LAWBSTERS,
            ART_BASE_LAWBSTERS,
            address(0),
            d.cultUniVault,
            d.uniDeployer,
            0,
            LAWBSTERS_REAL_SUPPLY,
            PRESET_LAWBSTERS
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        b.setBondingOpenTime(block.timestamp + 1 hours);
        b.setBondingMaturityTime(block.timestamp + 90 minutes);
        b.setBondingActive(true);
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.071 ether);
        vm.stopBroadcast();
        _assertPieceBase(ART_BASE_LAWBSTERS, "lawbsters");
        _seeded.lawbsters = inst;

        console.log("CATALOG ready-to-graduate (small):", inst);
    }

    /// @dev THE 80% ENDOWMENT — an ERC-721 auction collection bound to the target's OWN Aave
    ///      endowment vault. This is the only roster member that can express the 80% leg at all: the
    ///      split is chosen by the PINNED genesis vault's family, and the endowment branch is reachable
    ///      from the ERC-1155 and ERC-721 settlement paths only. The collection is auction-native in
    ///      real life too, so its mechanism and this instance's are the same shape.
    ///
    ///      Phase 1 queues the pieces and places the opening bids; phase 2 settles them once the
    ///      chain has passed their end time, and settlement is what puts real principal into the
    ///      endowment. The bids span a spread rather than repeating one size, so the principal the
    ///      vault ends up holding is 80% of a distribution and the vault panel has something with
    ///      shape in it.
    ///
    ///      ART: the real collection's metadata is immutable IPFS in bare-id form, and an ERC-721
    ///      piece carries its token URI directly, so each queued piece IS the real metadata pointer.
    function _seedCatalogAuction(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);
        ERC721AuctionFactory.CreateParams memory params = ERC721AuctionFactory.CreateParams({
            name: "pixelady-figmata",
            metadataURI: _catalogMeta(
                "Pixelady Figmata",
                "The endowment demo. This collection is auction-native, and every hammer price here splits 80/19/1 - the 80 is not the creator's cut, it is permanent principal escrowed in an endowment vault that supplies it to Aave and streams the yield to the community this collection is aligned to. Settle an auction and watch the principal appear in the vault panel. Demonstration collection with illustrative figures; the pieces carry real, content-addressed art.",
                ART_FIGMATA,
                CatalogFacts({
                    standsInFor: "an auction-native collection",
                    exampleSupply: "180",
                    exampleRaiseEth: "90.2673",
                    figureBasis: "illustrative, not a measurement of record",
                    routesTo: "80% endowment",
                    seededSupply: "6 queued pieces",
                    truncation: "history truncated: the collection this row echoes settled 180 auctions"
                })
            ),
            creator: deployer,
            vault: d.cultAaveVault, // the endowment family — this is what selects the 80% split
            symbol: "FGMTA",
            lines: FIGMATA_LINES,
            baseDuration: FIGMATA_DURATION,
            timeBuffer: 300,
            bidIncrement: 0.01 ether
        });
        address inst = d.erc721.createInstance(keccak256(abi.encode(block.timestamp, "pixelady-figmata")), params);
        _instances.push(inst);

        ERC721AuctionInstance a = ERC721AuctionInstance(payable(inst));
        // Two pieces per line: the first of each auto-starts now and is settled in phase 2; the second
        // is what settlement advances the line to. Each queuePiece's msg.value is the piece's minimum
        // bid, and the collection's real minimum winning bid is what it is set to.
        for (uint256 i = 1; i <= uint256(FIGMATA_LINES) * 2; i++) {
            a.queuePiece{ value: FIGMATA_MIN_BID }(string.concat(ART_BASE_FIGMATA, vm.toString(i)));
        }
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.066 ether);
        vm.stopBroadcast();

        // Opening bids, from the two non-deployer actors — a creator cannot be the only bidder on its
        // own line and have the settlement mean anything.
        vm.startBroadcast(ACCOUNT_1_KEY);
        a.createBid{ value: FIGMATA_BID_MEDIAN }(1, "");
        a.createBid{ value: FIGMATA_BID_MAX }(3, "");
        vm.stopBroadcast();
        vm.startBroadcast(PERSON_KEY);
        a.createBid{ value: FIGMATA_BID_HIGH }(2, "");
        vm.stopBroadcast();

        _assertPieceBase(ART_BASE_FIGMATA, "pixelady-figmata");
        _assertQueuedPieceURIs(a, ART_BASE_FIGMATA, uint24(uint256(FIGMATA_LINES) * 2), "pixelady-figmata");
        _catalog.figmata = inst;

        // The three opening auctions must actually be settleable by phase 2, or the endowment ends up
        // empty and the 80% leg is never exercised. Both halves of that are checked: a bid is present,
        // and the auction ends before the orchestrator's first advance rather than after it.
        for (uint24 id = 1; id <= 3; id++) {
            (,,, address highBidder, uint256 highBid,, uint40 endTime,) = a.auctions(id);
            require(highBidder != address(0), "catalog: an opening auction carries no bid (nothing to settle)");
            require(highBid > 0, "catalog: an opening auction settled at zero");
            require(
                uint256(endTime) <= block.timestamp + uint256(FIGMATA_DURATION),
                "catalog: an opening auction was extended past the window phase 2 can settle in"
            );
        }

        console.log("CATALOG auction (80% endowment):", inst);
        console.log("  endowment vault:", d.cultAaveVault);
    }

    /// @dev THE ARTIST ENDOWMENTS — one small auction collection per artist target, bound to that
    ///      artist's own Aave endowment vault.
    ///
    ///      WHAT AN ARTIST ENDOWMENT ACTUALLY IS, because it needs less machinery than it looks.
    ///      `AlignmentEndowmentVault` buys nobody's token: it wraps ETH to WETH, supplies it to Aave,
    ///      and `harvest()` splits the yield between the benefactor's claimable purse and the target's
    ///      `communityPayout`. Its `alignmentToken` exists only to satisfy `registerVault`'s check.
    ///      So an artist endowment is escrowed principal streaming yield to a payout address — which
    ///      is what "exaltation" should mean, and it needs no token to exist for the artist. It is
    ///      also the framing that describes what this vault family does: the family has no swap path
    ///      at all, so a collection bound here never buys anything on anyone's behalf.
    ///
    ///      THE AUCTION FAMILY IS FORCED, not chosen. The 80% leg is reachable from a settlement path
    ///      only, so a curve bound to an endowment vault would render a panel nothing feeds.
    ///
    ///      ART: these two are not standing in for real collections, so their pieces take the seed's
    ///      own pinned IPFS bases — one each, and neither is the base of a collection sitting beside
    ///      them, so each reads as its own drop.
    ///
    ///      NO REAL PERSON'S ADDRESS OR HANDLE reaches an on-chain field here. The payout is derived
    ///      from a slug, the alignment token is a fixture, and every description says so.
    function _seedArtistEndowments(Deployed memory d) internal {
        _catalog.paradilf = _seedArtistEndowment(
            d,
            d.paradilfVault,
            ArtistEndowments.PARADILF_SLUG,
            ArtistEndowments.PARADILF_TITLE,
            "PDLFC",
            "An artist endowment, shown end to end. Bid, and when the auction settles 80% of the hammer price does not go to the creator and does not go into a liquidity pool - it is escrowed as permanent principal in a vault that supplies it to Aave and streams the yield to the artist. The principal is never spent, so the payment does not stop. This is a demonstration collection: the artist payout is a generated fixture address and the alignment token beside it is a fixture too.",
            ART_RELIC_I,
            ART_BASE_SIMIAN
        );
        _catalog.petravoice = _seedArtistEndowment(
            d,
            d.petravoiceVault,
            ArtistEndowments.PETRAVOICE_SLUG,
            ArtistEndowments.PETRAVOICE_TITLE,
            "PTRAC",
            "Aligned to an artist, and the endowment pays them. Settlements escrow 80% of each hammer price as permanent principal and the yield streams to their payout address. Demonstration collection: fixture payout, fixture token.",
            ART_RELIC_II,
            ART_BASE_DOODLE
        );
    }

    /// @dev One artist endowment collection: create, queue, bid. Phase 2 settles — which is what turns
    ///      a hammer price into escrowed principal — and asserts the vault actually took it.
    function _seedArtistEndowment(
        Deployed memory d,
        address vault,
        string memory slug,
        string memory title,
        string memory symbol,
        string memory description,
        string memory image,
        string memory pieceBase
    ) internal returns (address inst) {
        // The vault must be the one the registry pinned this artist's payout on. A collection bound to
        // the wrong endowment still trades, still settles and still renders a vault panel — it simply
        // endows somebody else, and nothing on the page would say so.
        require(vault != address(0), "artist endowment: no vault resolved for this target");
        require(
            IEndowmentPayout(vault).communityPayout() == ArtistEndowments.payout(slug),
            "artist endowment: the vault pays somewhere other than this artist's derived fixture address"
        );
        _assertPieceBase(pieceBase, slug);

        vm.startBroadcast(deployerKey);
        ERC721AuctionFactory.CreateParams memory params = ERC721AuctionFactory.CreateParams({
            name: slug,
            metadataURI: _catalogMeta(
                title,
                description,
                image,
                CatalogFacts({
                    standsInFor: "an artist endowment, not a collection that exists",
                    exampleSupply: "4 queued pieces",
                    exampleRaiseEth: "5.3",
                    figureBasis: "illustrative, not a measurement of record",
                    routesTo: "80% artist endowment",
                    seededSupply: "4 queued pieces",
                    truncation: "none: this collection is a demonstration fixture, not a truncation of a real one"
                })
            ),
            creator: deployer,
            vault: vault, // the endowment family — this is what selects the 80% split
            symbol: symbol,
            lines: ARTIST_LINES,
            baseDuration: ARTIST_DURATION,
            timeBuffer: 300,
            bidIncrement: 0.01 ether
        });
        inst = d.erc721.createInstance(keccak256(abi.encode(block.timestamp, slug, "artist")), params);
        _instances.push(inst);

        ERC721AuctionInstance a = ERC721AuctionInstance(payable(inst));
        // Two per line: the first of each auto-starts and is settled in phase 2; the second is what
        // that settlement advances the line to, so the collection boots live rather than finished.
        for (uint256 i = 1; i <= uint256(ARTIST_LINES) * 2; i++) {
            a.queuePiece{ value: ARTIST_MIN_BID }(string.concat(pieceBase, vm.toString(i)));
        }
        d.queue.rentFeatured{ value: 1 ether }(inst, 30 days, 0.065 ether);
        vm.stopBroadcast();

        // The two non-deployer actors bid. A creator bidding on its own line would settle into its own
        // endowment, which demonstrates nothing.
        vm.startBroadcast(ACCOUNT_1_KEY);
        a.createBid{ value: ARTIST_BID_HIGH }(1, "");
        vm.stopBroadcast();
        vm.startBroadcast(PERSON_KEY);
        a.createBid{ value: ARTIST_BID_LOW }(2, "");
        vm.stopBroadcast();

        // Settleable before the orchestrator's first advance, or the endowment ends up empty and the
        // whole row demonstrates the opposite of what it claims.
        for (uint24 id = 1; id <= uint24(ARTIST_LINES); id++) {
            (,,, address highBidder, uint256 highBid,, uint40 endTime,) = a.auctions(id);
            require(highBidder != address(0), "artist endowment: an opening auction carries no bid");
            require(highBid > 0, "artist endowment: an opening auction settled at zero");
            require(
                uint256(endTime) <= block.timestamp + uint256(ARTIST_DURATION),
                "artist endowment: an opening auction was extended past the window phase 2 can settle in"
            );
        }
        // THE ART, CHECKED AS QUEUED. An ERC-721 piece carries its URI directly and `tokenURI` reverts
        // before the piece is minted, so the pointer is verified on the QUEUED record — which is the
        // same string the mint will hand out, and the last point at which a fix is still cheap.
        _assertQueuedPieceURIs(a, pieceBase, uint24(uint256(ARTIST_LINES) * 2), slug);

        console.log("ARTIST endowment collection:", inst);
        console.log("  vault:", vault, "payout:", ArtistEndowments.payout(slug));
    }

    /// @dev THE ERC-1155 TRANCHE — three free-mint-heavy examples, each cut to a demo-sized edition.
    ///      The example supply, the example raise, the mechanic and the truncation ratio all ride the
    ///      on-chain metadata, and each row says in its own metadata that the figures are illustrative.
    ///      The truncation ratio is the one that must never be dropped: the seeded supply is readable
    ///      off chain, and without the ratio beside it there is no way to tell a demo-sized edition
    ///      from a small collection.
    ///
    ///      The three are chosen to span the range rather than repeat one story: a pure free mint at
    ///      scale, a mixed free-and-paid edition, and a collection that charged nothing. The last one
    ///      earns its slot precisely BECAUSE its aligned share is zero — a demonstration that only
    ///      ever shows value moving is a pitch, and a row where nothing moves is what makes the other
    ///      rows legible as a mechanism.
    function _seedCatalogEditions(Deployed memory d) internal {
        vm.startBroadcast(deployerKey);

        // Pure free mint at scale. Real metadata lives on a domain, so the piece art is a stand-in.
        address anti = _createCatalogEdition(
            d,
            "anti-miladies",
            "Anti-Miladies",
            "A free-mint-at-scale example: ten thousand pieces, almost all claimed for nothing. The claim path is what this row is here to show - a collection can be free and still be aligned, because the 19% is taken from what is actually paid rather than from a promise. Art is a stand-in; figures are illustrative.",
            ART_ANTI,
            CatalogFacts({
                standsInFor: "a free mint at scale",
                exampleSupply: "10000",
                exampleRaiseEth: "4.01",
                figureBasis: "illustrative, not a measurement of record",
                routesTo: "19% liquidity family",
                seededSupply: "40",
                truncation: "1:250"
            }),
            0.015 ether,
            ANTI_SEEDED_SUPPLY,
            ANTI_FREE_ALLOC,
            0.024 ether
        );

        // Mixed free and paid — the interesting tier case, and the largest revenue in this tranche.
        address oekaki = _createCatalogEdition(
            d,
            "oekaki-maker",
            "Oekaki Maker",
            "Three quarters free, one quarter paid - the mixed case, and the tier surface is the interesting part. The paid quarter is where the alignment lands: 19% of it, bound to the target by contract. Demonstration example, illustrative figures.",
            ART_OEKAKI,
            CatalogFacts({
                standsInFor: "a mixed free and paid edition",
                exampleSupply: "5555",
                exampleRaiseEth: "32.21",
                figureBasis: "illustrative, not a measurement of record",
                routesTo: "19% liquidity family",
                seededSupply: "50",
                truncation: "1:111"
            }),
            0.0227 ether,
            OEKAKI_SEEDED_SUPPLY,
            OEKAKI_FREE_ALLOC,
            0.023 ether
        );

        // Charged nothing, so nothing is aligned. The row that keeps the others legible.
        address milady333 = _createCatalogEdition(
            d,
            "milady333",
            "Milady333",
            "Free from the first piece to the last. Nothing was charged, so the aligned share is zero - and the row is here precisely because it is: a demonstration that only ever shows value moving is not showing you the mechanism, it is showing you a pitch. Illustrative figures.",
            ART_MILADY333,
            CatalogFacts({
                standsInFor: "a collection that charged nothing",
                exampleSupply: "333",
                exampleRaiseEth: "0.00",
                figureBasis: "illustrative, not a measurement of record",
                routesTo: "19% liquidity family",
                seededSupply: "37",
                truncation: "1:9"
            }),
            0.001 ether,
            MILADY333_SEEDED_SUPPLY,
            MILADY333_FREE_ALLOC,
            0.022 ether
        );
        vm.stopBroadcast();

        // Each edition must carry the free allocation its real free/paid split is standing in for, or
        // the tranche demonstrates the wrong thing: a free-mint collection whose claim path is closed.
        require(
            ERC1155Instance(payable(anti)).freeMintAllocation(1) == ANTI_FREE_ALLOC,
            "catalog: the free-mint-at-scale edition carries the wrong allocation"
        );
        require(
            ERC1155Instance(payable(oekaki)).freeMintAllocation(1) == OEKAKI_FREE_ALLOC,
            "catalog: the mixed edition carries the wrong allocation"
        );
        require(
            ERC1155Instance(payable(milady333)).freeMintAllocation(1) == MILADY333_SEEDED_SUPPLY,
            "catalog: the zero-revenue edition is not fully free-claimable"
        );

        console.log("CATALOG editions:", anti, oekaki, milady333);
    }

    /// @dev One truncated ERC-1155 catalog row: instance, its single edition, and a featured slot.
    ///      Bound to the target's own liquidity-family vault, which is what makes the row's aligned
    ///      share the 19% one rather than the endowment's 80%.
    function _createCatalogEdition(
        Deployed memory d,
        string memory slug,
        string memory displayName,
        string memory description,
        string memory image,
        CatalogFacts memory facts,
        uint256 basePrice,
        uint256 seededSupply,
        uint256 freeAlloc,
        uint256 rankBoost
    ) internal returns (address instance) {
        ERC1155Factory.CreateParams memory params = ERC1155Factory.CreateParams({
            name: slug,
            symbol: "",
            metadataURI: _catalogMeta(displayName, description, image, facts),
            creator: deployer,
            vault: d.cultUniVault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
        instance = d.erc1155.createInstance(keccak256(abi.encode(block.timestamp, slug, "catalog")), params);
        _instances.push(instance);

        ERC1155Instance(payable(instance))
            .addEdition(
                displayName,
                basePrice,
                seededSupply,
                _catalogMeta(displayName, description, image, facts),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0,
                freeAlloc
            );
        d.queue.rentFeatured{ value: 1 ether }(instance, 30 days, rankBoost);
    }

    /// @dev Every queued piece points at `base + tokenId`, exactly. `queuePiece` assigns ids
    ///      sequentially from 1 and stores the URI verbatim, so a base that lost its trailing slash or
    ///      a loop that queued the wrong index shows up here rather than as a wall of blank tiles.
    function _assertQueuedPieceURIs(ERC721AuctionInstance a, string memory base, uint24 count, string memory label)
        internal
        view
    {
        for (uint24 id = 1; id <= count; id++) {
            (uint24 tokenId, string memory uri,,,,,,) = a.auctions(id);
            require(tokenId == id, string.concat("art: ", label, " queued a piece under an unexpected token id"));
            require(
                keccak256(bytes(uri)) == keccak256(bytes(string.concat(base, vm.toString(uint256(id))))),
                string.concat("art: ", label, " queued a piece whose URI is not the intended pointer")
            );
        }
    }

    /// @dev The illustrative figures a catalog row carries, kept as a struct so a row cannot be
    ///      written with its example figures and the mechanic they illustrate out of step.
    ///
    ///      EVERY FIELD HERE IS AN EXAMPLE, and `figureBasis` says so on every row. These are not
    ///      measurements and nothing in the app should present them as verified. What IS load-bearing
    ///      is `seededSupply` beside `exampleSupply`: an edition cut to a demo size whose on-chain
    ///      supply could be mistaken for the size it stands in for would misstate the one number a
    ///      surface can actually read off chain.
    struct CatalogFacts {
        string standsInFor; // the kind of collection this row is an example of
        string exampleSupply; // illustrative
        string exampleRaiseEth; // illustrative
        string figureBasis; // how to read the two above — always: illustrative, not a measurement
        string routesTo; // the mechanic the row demonstrates
        string seededSupply; // what this fork actually holds
        string truncation; // the ratio between the two, spelled out
    }

    /// @dev Catalog metadata: the ordinary collection shape plus a `catalog` object carrying the
    ///      illustrative figures alongside what the fork actually seeded. Both halves are present on
    ///      purpose. A surface that read only the on-chain supply of a truncated edition would report
    ///      the row as a fortieth of the size it is standing in for; a surface that read only the
    ///      example figures would misstate what this chain holds. Neither is recoverable from the
    ///      other, so both are written down — and `figureBasis` rides along so neither is mistaken
    ///      for a measurement.
    function _catalogMeta(string memory name, string memory description, string memory image, CatalogFacts memory f)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"description\":\"",
            description,
            "\",\"category\":\"edition\",\"image\":\"",
            image,
            "\",\"catalog\":{\"standsInFor\":\"",
            f.standsInFor,
            "\",\"exampleSupply\":\"",
            f.exampleSupply,
            "\",\"exampleRaiseEth\":\"",
            f.exampleRaiseEth,
            "\",\"figureBasis\":\"",
            f.figureBasis,
            "\",\"routesTo\":\"",
            f.routesTo,
            "\",\"seededSupply\":\"",
            f.seededSupply,
            "\",\"truncation\":\"",
            f.truncation,
            "\"}}"
        );
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
    function _postValued(GlobalMessageRegistry messages, address channel, string memory content, uint256 value)
        internal
    {
        messages.post{ value: value }(channel, 0, 0, bytes32(0), bytes32(0), content);
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
    // Reuses a gateway-verified CID from the harvested set (same precedent as ART_CARVED).
    string constant ART_QUENCH = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/42.png";
    string constant ART_PRISM = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/777.png";
    // Reuses a gateway-verified CID from the harvested set (512.png is NOT verified; 42.png is).
    string constant ART_CARVED = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/42.png";
    // The two gated fixtures REUSE gateway-verified CIDs from the harvested set rather than
    // introduce unverified ones (same precedent as ART_CARVED): veil-list takes the azuki 128, its
    // piece the azuki 7, and sigil-gate the azuki 777.
    string constant ART_VEIL = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/128.png";
    string constant ART_VEIL_PIECE = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/7.png";
    string constant ART_SIGIL = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/777.png";
    // Catalog-row card art. Same precedent as ART_CARVED: REUSE a gateway-verified CID from the
    // harvested set rather than introduce an unverified one. Card art is the collection tile only —
    // the PIECE art is what carries a row's real collection, and two of the rows carry theirs
    // verbatim off content-addressed storage (see ART_BASE_PIXELADY / ART_BASE_FIGMATA).
    // Card images for the two roster additions, taken from the same content-addressed image
    // directories the collections' own metadata resolves to (`ipfs://<image-cid>/<id>.png`, read out
    // of `<metadata-cid>/1`). Card art and per-piece art therefore come from the same place, which is
    // what makes a row read as one collection rather than as a stock image over real pieces.
    string constant ART_BOREDMILADY = "ipfs://QmWEQVc5xLyjPduYopckWWu6arhqgg7srxTo5FuLmLxiAU/1.png";
    string constant ART_LAWBSTERS = "ipfs://QmRFZ9GtqT6A8cF8ZF1x4fsysRHMhFSk1g8QGEBVn249pQ/1.png";
    string constant ART_SCHIZO = "ipfs://QmbeHAw5nGwSQSZ8pQc8WSdbzxh3rLY8Pg2rqiS1wJRcvQ";
    string constant ART_PIXELADY = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/128.png";
    string constant ART_FIGMATA = "ipfs://QmNf1UsmdGaMbpatQ6toXSkzDpizaGmC9zfunCyoz1enD5/penguin/7.png";
    string constant ART_ANTI = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/128.png";
    string constant ART_OEKAKI = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/7.png";
    string constant ART_MILADY333 = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/777.png";
    string constant ART_AVATAR_1 = "ipfs://QmNewNmsfGgvqptDDDeDC7nwWVM8ReXp5qmySNyBdyRw9M";
    string constant ART_AVATAR_2 = "ipfs://QmWZqi5xnTcnqa4k7UuzeLd3sm2mCci24wx1yQvKiDq1vm";

    // ── Backend-free metadata builders (raw data: JSON pointing at a real IPFS image) ───
    // The metadata JSON is an unencoded `data:application/json,{...}` URI; the image is a plain
    // ipfs:// pointer (no quotes/backslashes to escape), which the frontend resolver races across
    // gateways.

    function _collectionMeta(string memory name, string memory description, string memory image)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"description\":\"",
            description,
            "\",\"category\":\"edition\",\"image\":\"",
            image,
            "\"}"
        );
    }

    /// @dev Per-piece/edition metadata (same shape, piece-scoped name + image).
    function _pieceMeta(string memory name, string memory image, string memory collection)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"collection\":\"",
            collection,
            "\",\"image\":\"",
            image,
            "\"}"
        );
    }

    function _profileMeta(string memory name, string memory handle, string memory bio, string memory image)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"handle\":\"",
            handle,
            "\",\"bio\":\"",
            bio,
            "\",\"avatar\":\"",
            image,
            "\"}"
        );
    }
}
