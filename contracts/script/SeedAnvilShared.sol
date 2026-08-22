// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FeaturedQueueManager } from "../src/master/FeaturedQueueManager.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { ProfileRegistry } from "../src/registry/ProfileRegistry.sol";

/// @dev Minimal Solady-Ownable surface — instances + registries all expose this single-step transfer.
interface IOwnable {
    function transferOwnership(address newOwner) external payable;
}

/// @notice ROUTE PIN, not a price oracle. Anvil-only stand-in for the canonical on-chain best-route
///         quoter that `DeployCore.NetworkConfig.zQuoter` expects (OPERATOR INPUT — the canonical one
///         is deployed per network and there is none to point at on a local fork).
///
///         WHY THIS EXISTS AT ALL. A vault's ETH -> alignment-token acquisition tier comes from the
///         factory's `zRouterFee`/`zRouterTickSpacing` immutables, which are network-wide and carry no
///         setter, so a single target whose deepest pool sits elsewhere cannot be routed there by
///         configuration. `BestRouteAcquirer` already has the seam for it: a non-zero quoter picks the
///         venue, and only an unset/reverting/empty quote degrades to the fixed tier. This contract
///         fills that seam for ONE token.
///
///         WHY THE PINNED VENUE IS THE ONE IT IS, AND NOT THE VAULT'S LP POOL. These are two different
///         questions and they have two different answers on this fork. The vault LPs into the deepest
///         native-ETH V4 pool for its token; the vault ACQUIRES wherever the token is cheapest to buy
///         without breaching its own oracle floor, and that is the deepest pool of any kind. Measured
///         on the fork: the V4 tier prices a tenth-of-an-ETH buy ~31% under the reference TWAP and the
///         V3 tier of the same fee prices a whole-ETH buy ~1% under it — three orders of magnitude of
///         depth apart. Pinning the acquire leg to the V4 pool would make every demo-sized convert
///         revert on the vault's slippage floor, which is the floor doing its job against a pool that
///         cannot serve the size. Buying deep and providing liquidity where the alignment is committed
///         is what a best-route acquirer is FOR; it is not a workaround.
///
///         WHY THE ANSWER IS SCOPED TO ONE TOKEN. Every other `(tokenIn, tokenOut)` pair — including
///         the other alignment target's — is answered with an EMPTY route, which `BestRouteAcquirer`
///         reads as "no viable route" and falls back to the vault's fixed pool. So wiring this quoter
///         changes the acquisition path of exactly one token and leaves every other vault byte-identical
///         to a deployment with no quoter at all. That scoping is the whole point; do not widen it into
///         a catch-all without re-reading which vaults it would silently re-route.
///
///         `amountOut` IS A FLAG, NOT A PRICE. `BestRouteAcquirer` consumes it only as a non-zero
///         "route exists" test; the slippage bound the swap actually executes against is the vault's
///         own oracle-derived floor (`_floorTokenOut`, from the DAO-pinned reference pool), which this
///         contract cannot influence. Reading a price out of this return value would be wrong.
contract AnvilFixedRouteQuoter {
    /// @dev Must match `BestRouteAcquirer.IBestRouteQuoter.AMM` ordering for ABI decoding.
    enum AMM {
        UNI_V2,
        SUSHI,
        ZAMM,
        UNI_V3,
        UNI_V4
    }

    struct Quote {
        AMM source;
        uint256 feeBps;
        uint256 amountIn;
        uint256 amountOut;
    }

    /// @notice The one token this quoter answers for.
    address public immutable pinnedToken;
    /// @notice Fee tier in the quoter ABI's BPS units; the acquirer multiplies by 100 for the pool fee.
    uint256 public constant PINNED_FEE_BPS = 100;

    constructor(address token) {
        pinnedToken = token;
    }

    function getQuotes(bool, address tokenIn, address tokenOut, uint256 swapAmount)
        external
        view
        returns (Quote memory best, Quote[] memory quotes)
    {
        // ETH in only, pinned token out. Anything else returns a zeroed best + an empty list, which
        // is the caller's "no viable route" signal and leaves its fixed-pool fallback in charge.
        if (tokenIn != address(0) || tokenOut != pinnedToken || swapAmount == 0) {
            return (best, new Quote[](0));
        }
        best = Quote({ source: AMM.UNI_V3, feeBps: PINNED_FEE_BPS, amountIn: swapAmount, amountOut: 1 });
        quotes = new Quote[](1);
        quotes[0] = best;
    }
}

/// @notice Shared surface for the two-phase anvil seed: the deployed-address struct, the exact-cost
///         buy helpers, and the phase-1 → phase-2 hand-off file.
///
///         WHY THE SEED IS TWO SCRIPTS. `buyBonding` reverts `TooEarly` before `bondingOpenTime`
///         (noesis-205), and `setBondingOpenTime` reverts `TimeMustBeInFuture` on a non-future time.
///         A single script therefore cannot both ARM a launch and BUY into it: forge simulates the
///         whole script before broadcasting any of it, and anvil block timestamps track the REAL
///         clock, so a small arm offset is raced by broadcast lag (the arm tx reverts) while a large
///         one is never crossed (the buy tx reverts). `vm.warp` cannot help — it moves only the
///         script's in-memory EVM, never the live chain — and `vm.sleep` makes it worse by delaying
///         broadcast until the arm tx is past its own open time.
///
///         Only the ORCHESTRATOR can advance the chain between the two. So `deploy.ts` runs
///         SeedAnvil (create + arm), advances the anvil clock past every open time, then runs
///         SeedAnvilBuys (buys + everything downstream of them). Do NOT merge these back into one
///         script to "simplify" it — that is the shape that is broken, and it fails at SIMULATION,
///         so nothing broadcasts and the fork is left with a deployed protocol and no seed at all.
abstract contract SeedAnvilShared is Script {
    // Well-known Anvil account #1 (public test key) — used to seed a second, non-deployer actor.
    uint256 internal constant ACCOUNT_1_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    // The team's testing wallet. After the deployer finishes all owner-only seeding, ownership of
    // every seeded instance + the platform registries is handed to ADMIN so it can drive the creator
    // admin + (future) protocol-admin console from the UI. Anvil-only — DeployCore stays untouched.
    address internal constant ADMIN = 0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86;

    // ── The alignment target the catalog roster binds to ─────────────────────────────────────────
    // Milady Cult Coin, the Remilia-issued ERC20 (`name()` = "Milady Cult Coin", `symbol()` = "CULT",
    // 18 decimals). Present on the mainnet fork because the fork is mainnet. Kept here rather than in
    // DeployAnvil because the seed resolves CULT's OWN per-target vaults out of `anvil.json` by
    // matching this address — `contracts.SeedUniVault` / `contracts.SeedAaveVault` are the FIRST
    // target's vaults (MS2), and binding a catalog instance to those would tithe the wrong community.
    address internal constant CULT_TOKEN = 0x0000000000c5dc95539589fbD24BE07c6C14eCa4;

    /// @dev The local fork's chain id. Asserted when reading the hand-off file so a seed-state file
    ///      left behind by a PREVIOUS fork cannot be replayed against dead addresses on a new one.
    uint256 internal constant ANVIL_CHAIN_ID = 1337;

    string internal constant SEED_STATE_PATH = "./deployments/anvil-seed.json";

    // ── Per-piece art: METADATA directory bases (mainnet-harvested, gateway-verified) ────────────
    // ERC404 piece art composes as `base + tokenId` with NO suffix (ERC404BondingInstance._tokenURI;
    // TokenTierBandResolver and TierRevealModule concat the same way). So a base MUST point at a
    // collection's METADATA directory, whose entries are extensionless numeric JSON — an IMAGE
    // directory 404s for every id (`…/42.png` serves bytes, `…/42` does not). Each JSON carries the
    // `image` the frontend renders after it resolves `tokenURI(id)`.
    // These are the metadata layer of the same collections the seed already harvests images from:
    // ART_NEON_DRIFT / ART_ABERRATION / ART_EMBER read back to ART_BASE_ANIME's image directory, and
    // ART_LIVE_SALON / ART_PRISM to ART_BASE_ARCTIC's.
    // A different collection per instance keeps each one visually its own drop rather than one image
    // repeated — and on the stacked instance it makes WHICH metadata layer is answering obvious by eye.
    // The four bases are the whole roster; surfaces added later REUSE one rather than introduce a
    // fifth, choosing whichever is not already answering next to them. Current reuse: ART_BASE_DOODLE
    // backs both `ember-preopen`'s pieces and — on two surfaces that never sit beside it — the
    // agent-created commission and `prism-stacked`'s opt-in wave, whose stack already spends the
    // other three (base = ANIME, band = ARCTIC, commissions = SIMIAN) — and `quench-ready`, which
    // sits in the ready-to-graduate group where ARCTIC (cinder) and SIMIAN (molten) already answer.
    string internal constant ART_BASE_ANIME = "ipfs://QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4/";
    string internal constant ART_BASE_ARCTIC = "ipfs://bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna/";
    string internal constant ART_BASE_SIMIAN = "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/";
    string internal constant ART_BASE_DOODLE = "ipfs://QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS/";

    // ── Catalog-instance art bases ───────────────────────────────────────────────────────────────
    // The two bases below are the REAL metadata directories of the collections the catalog instances
    // stand in for, reused verbatim. Both are immutable IPFS and both address their entries by the
    // bare token id, which is exactly the `base + tokenId` concatenation the instances perform — so
    // the seeded pieces resolve to the actual art with no re-hosting and no third-party server.
    string internal constant ART_BASE_PIXELADY = "ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/";
    string internal constant ART_BASE_FIGMATA = "ipfs://bafybeigibcocisl3d4oirx5bivemr6iwtdnbswxbpd57zb4ekf64lch5dm/";
    // NO real base for the flagship curve or the free-mint editions, DELIBERATELY. Those collections
    // serve their metadata from a live third-party domain rather than from content-addressed storage.
    // Wiring a domain here would make the local fork's art depend on somebody else's uptime and would
    // point our traffic at their host, so those instances take one of the ART_BASE_* constants above
    // and the substitution is stated in their on-chain description. Do not "improve" this back.

    // ── THE ALIGNMENT CATALOG ROSTER ────────────────────────────────────────────────────────
    //
    // READ THIS BEFORE CHANGING A NUMBER BELOW. Several seeded collections are not inventions: each
    // one restates a real, MEASURED derivative collection — its supply, its revenue, and the share
    // that would have returned to the community it derived from had it launched aligned. A visitor
    // is meant to check the arithmetic, so the figures are the product, not decoration.
    //
    // THE INFRASTRUCTURE IS OURS TO INVENT; THE NUMBERS ARE NOT. Pools, quoters, presets, clocks and
    // truncated edition sizes are all fabricated to fit a local fork, and every fabrication is stated
    // on chain in the instance's own metadata. Rounding a raise because it is inconvenient is not the
    // same kind of act and is never in scope. If a figure below cannot be honoured, STOP — do not
    // quietly move it to one that can.
    //
    // Revenue is mint revenue except on the auction collection, where it is the sum of WINNING BIDS
    // read from settlement events. A mint-transaction total undercounts an auction by an order of
    // magnitude, because the winner's ETH arrives as bids and the settlement transaction carries
    // none. Do not "correct" the auction figure back to a mint-transaction number.

    // Flagship curve — ready-to-graduate, aligned at 19%.
    uint256 constant SCHIZO_REAL_SUPPLY = 5555;
    uint256 constant SCHIZO_REAL_RAISE = 320.1691 ether;
    // Mid-curve exemplar — the instance the site's live features are demonstrated on.
    uint256 constant PIXELADY_REAL_SUPPLY = 10_000;
    uint256 constant PIXELADY_REAL_RAISE = 106 ether;
    // Auction collection — the ONLY roster member that can express the 80% endowment (the 80/19/1
    // leg is `splitMintFor(amount, liquidityFamily = false)`, reachable from the ERC-1155 and
    // ERC-721 settlement paths only; ERC404 graduation has no family branch and cannot express it).
    uint256 constant FIGMATA_REAL_SUPPLY = 180;

    // Curve presets. `LaunchManager` accepts ANY `targetETH` — the 5/25/50 ETH menu is three
    // registered presets, not a protocol ceiling — so a catalog-sized raise needs no contract change,
    // only its own preset. Ids start at 10 to leave the protocol's 0-2 (and room to grow) untouched;
    // everything except `targetETH` is carried over from the STANDARD preset so a seeded curve
    // differs from a production one in SIZE ONLY.
    uint8 constant PRESET_SOURCE = 1; // STANDARD — the preset every other seeded instance uses
    uint8 constant PRESET_SCHIZO = 10;
    uint8 constant PRESET_PIXELADY = 11;

    // Deployed addresses (read from anvil.json).
    struct Deployed {
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        ERC404Factory erc404;
        ProfileRegistry profiles;
        FeaturedQueueManager queue;
        GlobalMessageRegistry messages;
        address vault; // first Uni LP vault — generic contract vault
        address zammVault; // first ZAMM LP vault
        address cypherVault; // first Cypher (Algebra) LP vault
        address endowmentVault; // first Aave endowment vault
        address stakingModule; // ERC404StakingModule (approved STAKING component)
        address zammDeployer; // ModuleZAMMDeployer (approved LIQUIDITY_DEPLOYER)
        address uniDeployer; // ModuleUniV4Deployer (approved LIQUIDITY_DEPLOYER)
        address cypherDeployer; // ModuleCypherDeployer (approved LIQUIDITY_DEPLOYER)
        address resolverRouter; // MetadataResolverRouter (approved RESOLVER)
        address overlay; // MetadataOverlayModule (approved OVERLAY)
        address tier; // TokenTierBandResolver (approved TIER)
        address alignmentRegistry; // AlignmentRegistryV1 proxy (target curation)
        address master; // MasterRegistryV1 proxy (agent authorization; deployer-owned pre-handover)
        address launchManager; // LaunchManager (curve presets; deployer-owned pre-handover)
        address uniVaultFactory; // UniAlignmentVaultFactory — owns every Uni vault, so per-vault setters route here
        address cultUniVault; // CULT's OWN UniswapV4LP vault (NOT SeedUniVault, which is the first target's)
        address cultAaveVault; // CULT's OWN Aave endowment vault (NOT SeedAaveVault)
        uint256 cultTargetId; // alignment target id the CULT vaults were deployed under
    }

    /// @dev The ERC404 instances phase 1 arms, resolved BY NAME in phase 2.
    struct SeededErc404 {
        address ember; // PREOPEN — never bought, open time is +1 day and stays uncrossed
        address vapor; // MID-CURVE — several buys + staking
        address cinder; // READY-TO-GRADUATE (Uni-V4)
        address molten; // READY-TO-GRADUATE (ZAMM)
        address quench; // READY-TO-GRADUATE (Cypher/Algebra)
        address carve; // CARVE DEMO — bought until reserve >= 3 ETH
        address stacked; // STACKED METADATA — buy-with-mint + overlay authoring
        address schizo; // CATALOG flagship — READY-TO-GRADUATE, catalog-sized curve, CULT UniV4 vault
        address pixelady; // CATALOG mid-curve — the instance the live features are demonstrated on
    }

    /// @dev The non-ERC404 catalog instances phase 2 still has work to do on. The ERC-1155 tranche is
    ///      absent on purpose: those are created, editioned and featured entirely in phase 1 and phase 2
    ///      owes them nothing but the ownership handover, which rides the `all` array.
    struct SeededCatalog {
        address figmata; // ERC721 AUCTION bound to CULT's Aave endowment vault (the 80% endowment leg)
    }

    uint256 internal deployerKey;
    address internal deployer;
    address internal acct1;

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile("./deployments/anvil.json");
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        d.erc721 = ERC721AuctionFactory(vm.parseJsonAddress(json, ".factories.ERC721"));
        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.profiles = ProfileRegistry(vm.parseJsonAddress(json, ".contracts.ProfileRegistry"));
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.zammDeployer = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.cypherDeployer = vm.parseJsonAddress(json, ".contracts.ModuleCypherDeployer");
        d.resolverRouter = vm.parseJsonAddress(json, ".contracts.MetadataResolverRouter");
        d.overlay = vm.parseJsonAddress(json, ".contracts.MetadataOverlayModule");
        d.tier = vm.parseJsonAddress(json, ".contracts.TokenTierBandResolver");
        // Resolve the seed's vaults by FAMILY via DeployCore's convenience pointers, not by index
        // into the `vaults` array — that array's ordering shifts as LP families (ZAMM/Cypher) are
        // enabled per network, so a fixed index silently binds to the wrong vault type.
        d.vault = vm.parseJsonAddress(json, ".contracts.SeedUniVault");
        d.zammVault = vm.parseJsonAddress(json, ".contracts.SeedZammVault");
        d.cypherVault = vm.parseJsonAddress(json, ".contracts.SeedCypherVault");
        d.endowmentVault = vm.parseJsonAddress(json, ".contracts.SeedAaveVault");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.master = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        d.launchManager = vm.parseJsonAddress(json, ".contracts.LaunchManager");
        d.uniVaultFactory = vm.parseJsonAddress(json, ".factories.UNI");
        (d.cultUniVault, d.cultAaveVault, d.cultTargetId) = _readCultVaults(json);
    }

    /// @dev Resolve the vaults belonging to the CULT alignment target out of `anvil.json`'s `vaults`
    ///      array, by MATCHING THE ALIGNMENT TOKEN — never by index and never via the `Seed*Vault`
    ///      convenience pointers, which are the FIRST target's vaults. DeployCore deploys one vault of
    ///      each configured family PER TARGET, so both a CULT UniswapV4LP vault and a CULT Aave
    ///      endowment vault already exist by the time the seed runs; the seed only has to find them.
    ///      Binding a catalog instance to the wrong target's vault is silent — the collection would
    ///      still trade, still tithe, and still render, while routing every aligned fee to a community
    ///      it has nothing to do with. Hence the requires rather than a zero return.
    function _readCultVaults(string memory json)
        internal
        view
        returns (address uniVault, address aaveVault, uint256 targetId)
    {
        bytes32 uniType = keccak256(bytes("UNIv4"));
        bytes32 aaveType = keccak256(bytes("AaveEndowment"));

        // TWO THINGS ABOUT THIS READ, BOTH LEARNED THE HARD WAY.
        //  · `vaults` is serialized as a STRING holding JSON, not as a JSON array, so it has to be
        //    lifted out and queried as its own document — a path through the outer file never
        //    descends into it.
        //  · The entries are read ONE INDEX AT A TIME rather than through a wildcard: a wildcard path
        //    resolves to many values and the array parsers accept exactly one, so it fails outright.
        // The loop bound guards a malformed file; the loop really ends at the first missing index.
        string memory vaults = vm.parseJsonString(json, ".vaults");
        for (uint256 i = 0; i < 64; i++) {
            string memory at = string.concat("[", vm.toString(i), "]");
            if (!vm.keyExistsJson(vaults, at)) break;
            if (vm.parseJsonAddress(vaults, string.concat(at, ".alignmentToken")) != CULT_TOKEN) continue;

            bytes32 t = keccak256(bytes(vm.parseJsonString(vaults, string.concat(at, ".type"))));
            if (t == uniType && uniVault == address(0)) {
                uniVault = vm.parseJsonAddress(vaults, string.concat(at, ".address"));
                targetId = vm.parseJsonUint(vaults, string.concat(at, ".targetId"));
            } else if (t == aaveType && aaveVault == address(0)) {
                aaveVault = vm.parseJsonAddress(vaults, string.concat(at, ".address"));
                targetId = vm.parseJsonUint(vaults, string.concat(at, ".targetId"));
            }
        }
        require(uniVault != address(0), "anvil.json: no UNIv4 vault is bound to the CULT alignment token");
        require(aaveVault != address(0), "anvil.json: no Aave endowment vault is bound to the CULT alignment token");
        require(targetId != 0, "anvil.json: CULT vaults carry no alignment target id");
    }

    // ─────────────────────── Phase 1 → phase 2 hand-off ───────────────────────

    /// @dev Phase 2 runs as a separate forge process with no memory of phase 1, so phase 1 persists
    ///      what it created. Instances are keyed BY NAME, never by array index: `_readDeployed`
    ///      above carries the same lesson for vaults, and a change in seed ORDER must not silently
    ///      rebind `carve` to `stacked`. `all` is the ownership-handover list and MAY be reordered
    ///      freely — nothing resolves a role out of it.
    function _writeSeedState(SeededErc404 memory s, SeededCatalog memory k, address[] memory all) internal {
        string memory inner = "anvilSeedInstances";
        vm.serializeAddress(inner, "ember", s.ember);
        vm.serializeAddress(inner, "vapor", s.vapor);
        vm.serializeAddress(inner, "cinder", s.cinder);
        vm.serializeAddress(inner, "molten", s.molten);
        vm.serializeAddress(inner, "quench", s.quench);
        vm.serializeAddress(inner, "carve", s.carve);
        vm.serializeAddress(inner, "schizo", s.schizo);
        vm.serializeAddress(inner, "pixelady", s.pixelady);
        vm.serializeAddress(inner, "figmata", k.figmata);
        string memory instancesJson = vm.serializeAddress(inner, "stacked", s.stacked);

        string memory root = "anvilSeedState";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "all", all);
        string memory out = vm.serializeString(root, "instances", instancesJson);

        vm.writeJson(out, SEED_STATE_PATH);
        console.log("Wrote seed state:", SEED_STATE_PATH);
    }

    function _readSeedState()
        internal
        view
        returns (SeededErc404 memory s, SeededCatalog memory k, address[] memory all)
    {
        string memory json = vm.readFile(SEED_STATE_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        // A seed-state file from a PREVIOUS fork points at addresses that no longer hold code. Fail
        // loudly here rather than broadcasting buys into the void and reporting success — the same
        // guard deploy.ts applies to anvil.json.
        require(chainId == ANVIL_CHAIN_ID, "anvil-seed.json: wrong chainId (stale file from another chain?)");
        require(block.chainid == ANVIL_CHAIN_ID, "SeedAnvilBuys: not running against anvil");

        s.ember = vm.parseJsonAddress(json, ".instances.ember");
        s.vapor = vm.parseJsonAddress(json, ".instances.vapor");
        s.cinder = vm.parseJsonAddress(json, ".instances.cinder");
        s.molten = vm.parseJsonAddress(json, ".instances.molten");
        s.quench = vm.parseJsonAddress(json, ".instances.quench");
        s.carve = vm.parseJsonAddress(json, ".instances.carve");
        s.stacked = vm.parseJsonAddress(json, ".instances.stacked");
        s.schizo = vm.parseJsonAddress(json, ".instances.schizo");
        s.pixelady = vm.parseJsonAddress(json, ".instances.pixelady");
        k.figmata = vm.parseJsonAddress(json, ".instances.figmata");
        all = vm.parseJsonAddressArray(json, ".all");

        // A phase-1 that silently failed to record an instance would otherwise show up much later as
        // an unowned collection or a missing buy. Catch it at the boundary.
        require(s.ember != address(0), "seed state: ember missing");
        require(s.vapor != address(0), "seed state: vapor missing");
        require(s.cinder != address(0), "seed state: cinder missing");
        require(s.molten != address(0), "seed state: molten missing");
        require(s.quench != address(0), "seed state: quench missing");
        require(s.carve != address(0), "seed state: carve missing");
        require(s.stacked != address(0), "seed state: stacked missing");
        require(s.schizo != address(0), "seed state: schizo missing");
        require(s.pixelady != address(0), "seed state: pixelady missing");
        require(k.figmata != address(0), "seed state: figmata missing");
        require(all.length > 0, "seed state: no instances to hand over");
    }

    // ─────────────────────────── Buy helpers ───────────────────────────

    /// @dev Same exact-cost math as _buyBonding but mints NFTs (mintNFT=true) so the buyer owns ids.
    function _buyBondingMint(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        _buy(b, key, amount, true);
    }

    /// @dev Compute the EXACT cost the instance will charge and pay it, so buyBonding never reverts.
    ///      The instance computes cost = BondingCurveMath.calculateCost(curveParams, supply, amount),
    ///      then adds a fee = cost * bondingFeeBps / 10000. We reproduce both with the SAME library
    ///      + the instance's public getters and set maxCost == value == cost + fee. (Excess, if any,
    ///      is refunded by the contract.) mintNFT=false keeps tokens fungible for staking.
    ///
    ///      NOTE: this reverts `TooEarly` unless the CHAIN has passed the instance's bondingOpenTime.
    ///      That is why every caller lives in phase 2, after deploy.ts advances the clock.
    function _buyBonding(ERC404BondingInstance b, uint256 key, uint256 amount) internal {
        _buy(b, key, amount, false);
    }

    function _buy(ERC404BondingInstance b, uint256 key, uint256 amount, bool mintNFT) private {
        BondingCurveMath.Params memory params = _curveParams(b);
        uint256 cost = BondingCurveMath.calculateCost(params, b.totalBondingSupply(), amount);
        uint256 fee = (cost * b.bondingFeeBps()) / 10000;
        uint256 total = cost + fee;
        vm.startBroadcast(key);
        b.buyBonding{ value: total }(amount, total, mintNFT, bytes(""), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 3-tuple).
    function _curveParams(ERC404BondingInstance b) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = b.curveParams();
        p = BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
    }
}
