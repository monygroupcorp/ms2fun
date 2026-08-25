// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { IDynamicPricingModule } from "../src/factories/erc1155/interfaces/IDynamicPricingModule.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { IMerkleGatingModule, MerkleConfig } from "../src/gating/IMerkleGatingModule.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { RevenueSplitLib } from "../src/shared/libraries/RevenueSplitLib.sol";

/// @dev Read-back surface of `MerkleGatingModule`. `IMerkleGatingModule` carries only `configureFor`;
///      these views are what let the seed assert that what it installed is what is actually stored.
interface IMerkleGatingView {
    function getRoots(address instance, uint256 editionId) external view returns (bytes32[] memory);
    function getTierOpenTimes(address instance, uint256 editionId) external view returns (uint256[] memory);
}

/// @dev The two staking numbers the showcase reports. Read off the deployment's approved STAKING
///      module rather than off the instance, because the module is where the stream itself lives.
interface IShowcaseStakingState {
    function totalStaked(address instance) external view returns (uint256);
    function stakedBalance(address instance, address user) external view returns (uint256);
    function rewardRate(address instance) external view returns (uint256);
    function periodFinish(address instance) external view returns (uint256);
}

/// @dev The carve parameters the factory applies LIVE at graduation. Read back so the seed reports
///      the protocol's own figure rather than recomputing the bracket/floor math beside it.
interface IShowcaseCarveParams {
    function minPoolEth() external view returns (uint256);
    function effectiveCarveEth(uint256 raise, uint256 declaredMaxBps, uint256 carveRequestBps)
        external
        view
        returns (uint256);
}

/// @dev The tier surface the showcase asserts against: the sealed ladder plus the derived
///      outstanding-band count. Both are public getters on the real instance.
interface IShowcaseTierState {
    function tierBands(uint256 idx) external view returns (uint32 idStart, uint32 idEnd, uint32 weight);
    function bandOutstanding(uint8 tierN) external view returns (uint256);
    function totalTierEscrow() external view returns (uint256);
}

/// @dev The read surface the showcase post-conditions are stated against. Declared as an interface
///      rather than typed to `ERC404BondingInstance` on purpose: the same assertions are exercised by
///      a unit test against a settable stub, which is what proves they are not vacuous
///      (`test/coverage/SepoliaShowcasePostConditions.t.sol`). Every member is a public state getter
///      on the real instance, so the interface and the instance cannot drift apart silently.
interface IShowcaseCurveState {
    function bondingOpenTime() external view returns (uint256);
    function bondingMaturityTime() external view returns (uint256);
    function bondingActive() external view returns (bool);
    function graduated() external view returns (bool);
    function reserve() external view returns (uint256);
    function totalBondingSupply() external view returns (uint256);
}

/// @notice The chain-agnostic base for the Sepolia showcase seed — the pieces phase 1 (create + arm)
///         and phase 2 (buys + graduation) both need: the deployment reader, the roster, the
///         hand-off state file, the buy helpers, and the post-conditions.
///
///         ── WHY THIS FILE MIRRORS `SeedAnvilShared` INSTEAD OF EXTENDING A COMMON ANCESTOR ──
///
///         The item that authored this preferred a shared ancestor both seeds inherit. That is the
///         right shape and it is not what landed, for a reason worth stating rather than hiding:
///         `SeedAnvilShared` is one file in which the genuinely reusable parts (the exact-cost buy
///         helper, the curve-params reconstruction, the JSON readers, the string predicates) are
///         interleaved with anvil-only facts — a hardcoded `./deployments/anvil.json` path, a fixed
///         local chain id, the well-known local test keys, and a roster of eleven instances that only
///         a mainnet fork can serve. Splitting those apart means editing the file the local dev-chain
///         rebuild depends on end to end, and that rebuild is the anvil seed's only regression gate.
///         The trade taken here is: the anvil seed is left BYTE-IDENTICAL (this branch changes no file
///         the anvil path reads), and the Sepolia spine carries its own copy of ~120 lines of curve
///         arithmetic and string handling.
///
///         The duplication is therefore deliberate and bounded. The follow-on is to lift the shared
///         core into its own file once the Sepolia seed's shape has stopped moving — the two waves
///         still to land on top of this one (further venues, further project types) are what would
///         make that extraction premature today.
///
///         ── THE TIME MODEL, AND WHY SEPOLIA IS NOT ANVIL ──
///
///         Arming a curve and buying into it cannot share one `forge script`: `setBondingOpenTime`
///         rejects a non-future timestamp, `buyBonding` reverts `TooEarly` before it, and forge
///         simulates a whole script at ONE timestamp before broadcasting any of it. So the seed is
///         two scripts with a clock advance in between — the same split the local seed uses.
///
///         What is different: the local chain is told to advance (`evm_increaseTime`). A public
///         testnet cannot be told anything. The gap between the two phases is REAL WALL-CLOCK TIME
///         that a human waits out, so the arm window is short and configurable
///         (`SEPOLIA_ARM_WINDOW_SECONDS`, default 20 minutes) rather than the local seed's day-long
///         offsets, and phase 1 records the exact timestamp phase 2 becomes legal
///         (`phase2NotBefore`) in the hand-off file so the orchestrator polls for it instead of
///         guessing.
abstract contract SeedSepoliaShared is Script {
    // ─────────────────────────── Network + paths ───────────────────────────

    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Written by `DeploySepolia`. Read, never written, by this seed.
    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";
    /// @dev Phase 1 writes it; phase 2 and the orchestrator read it.
    string internal constant SEED_STATE_PATH = "./deployments/sepolia-seed.json";

    // ─────────────────────────── Clock knobs ───────────────────────────
    //
    // Every window below is a WALL-CLOCK wait for whoever runs the seed, so the defaults are sized
    // for a human at a terminal rather than for a chain that can be fast-forwarded.

    /// @dev How long after phase 1 the showcase curves open. Deliberately short.
    string internal constant ENV_ARM_WINDOW = "SEPOLIA_ARM_WINDOW_SECONDS";
    uint256 internal constant DEFAULT_ARM_WINDOW = 20 minutes;

    /// @dev Maturity sits just after the open time (the setter requires strictly-after), so a curve
    ///      that phase 2 reaches is open AND matured — which is what makes the graduate action live
    ///      on the ready-to-graduate row rather than merely arguable.
    string internal constant ENV_MATURITY_OFFSET = "SEPOLIA_MATURITY_OFFSET_SECONDS";
    uint256 internal constant DEFAULT_MATURITY_OFFSET = 2 minutes;

    /// @dev The slack phase 2 waits past the last maturity before it may run. Absorbs the wall-clock
    ///      the phase-1 broadcast itself consumes plus block-time jitter.
    string internal constant ENV_PHASE2_SLACK = "SEPOLIA_PHASE2_SLACK_SECONDS";
    uint256 internal constant DEFAULT_PHASE2_SLACK = 2 minutes;

    /// @dev The pre-open row is the one state that must SURVIVE the seed rather than be crossed by
    ///      it, because a visitor arriving days later still has to find a curve that has not opened.
    ///      It is therefore armed on its own, much longer clock — this is not the arm window.
    string internal constant ENV_PREOPEN_DELAY = "SEPOLIA_PREOPEN_DELAY_SECONDS";
    uint256 internal constant DEFAULT_PREOPEN_DELAY = 30 days;

    // ─────────────────────────── Fill knobs ───────────────────────────
    //
    // Fills are expressed as a share of the instance's own bondable supply so they stay meaningful
    // whichever preset a row selects. They are ALSO the entire ETH cost of the seed, and that ETH is
    // a human's faucet balance, so every one of them is overridable without touching the source.
    //
    // THE DEFAULTS ARE SIZED FOR A FAUCET, NOT FOR DEPTH. A Sepolia faucet dispenses a fraction of an
    // ETH per day, so the defaults below buy enough curve to render every surface the rows exist to
    // show and no more — a measured 0.242 ETH across the three bought rows on the NICHE preset. Depth
    // is a separate decision with a separate cost: raising these makes the graduated row's pool and
    // the vault's tithe correspondingly larger, which is what a deployment meant to be attacked wants.
    // Raise them by environment, and read the projection the seed prints before confirming.

    string internal constant ENV_MID_FILL_BPS = "SEPOLIA_MID_FILL_BPS";
    string internal constant ENV_READY_FILL_BPS = "SEPOLIA_READY_FILL_BPS";
    string internal constant ENV_GRADUATED_FILL_BPS = "SEPOLIA_GRADUATED_FILL_BPS";

    // ─────────────────────────── Wave-2 breadth knobs ───────────────────────────
    //
    // The breadth rows demonstrate MECHANISMS, not depth, so their defaults are the smallest values
    // that still reach the state each row exists to show. Every one of them is overridable, and the
    // seed prints its projection before it spends anything.

    /// @dev Fill for the staking row, in bps of its bondable supply. The stake itself is taken out of
    ///      what this buys, so it only has to be large enough to leave a non-zero position.
    string internal constant ENV_STAKING_FILL_BPS = "SEPOLIA_STAKING_FILL_BPS";
    uint256 internal constant DEFAULT_STAKING_FILL_BPS = 300;

    /// @dev Share of the bought staking position that is actually staked, in bps. Below 10000 so the
    ///      row also holds a LIQUID balance — an instance whose whole float is locked cannot
    ///      demonstrate the stake action a second time.
    string internal constant ENV_STAKE_SHARE_BPS = "SEPOLIA_STAKE_SHARE_BPS";
    uint256 internal constant DEFAULT_STAKE_SHARE_BPS = 5000;

    /// @dev The tier row's fill is counted in WHOLE DN404 UNITS, not in bps, because every tier
    ///      operation is denominated in whole units: `mintUp` into tier N burns one ordinary id and
    ///      escrows `(w_N - 1)` units. The default is exactly what the phase-2 walk consumes —
    ///      3 units for the scarce band, 2 for the open band, 1 kept liquid to carry the commission.
    string internal constant ENV_TIER_UNITS = "SEPOLIA_TIER_UNITS";
    uint256 internal constant DEFAULT_TIER_UNITS = 6;

    /// @dev The carve row's fill, in bps of its bondable supply. See `_carveThresholdRaise`: whether
    ///      the carve pays anything is a DEPTH question, and the seed prints the raise it would take.
    string internal constant ENV_CARVE_FILL_BPS = "SEPOLIA_CARVE_FILL_BPS";
    uint256 internal constant DEFAULT_CARVE_FILL_BPS = 700;

    /// @dev The queue deposit each auction lot is listed with, and the bid placed on the lot that is
    ///      settled. The bid must clear the deposit (`BidBelowMinimum`); the settle then returns the
    ///      deposit and splits the bid, so the net cost of the settled lot is a fraction of the bid.
    string internal constant ENV_AUCTION_DEPOSIT_WEI = "SEPOLIA_AUCTION_DEPOSIT_WEI";
    uint256 internal constant DEFAULT_AUCTION_DEPOSIT = 0.001 ether;
    string internal constant ENV_AUCTION_BID_WEI = "SEPOLIA_AUCTION_BID_WEI";
    uint256 internal constant DEFAULT_AUCTION_BID = 0.0015 ether;

    /// @dev How long the LIVE auction runs. Like the pre-open curve, this row must SURVIVE the seed —
    ///      a visitor arriving days later still has to find a lot they can bid on — so it is armed on
    ///      its own long clock and is excluded from the wait phase 2 computes.
    string internal constant ENV_LIVE_AUCTION_SECONDS = "SEPOLIA_LIVE_AUCTION_SECONDS";
    uint256 internal constant DEFAULT_LIVE_AUCTION_SECONDS = 30 days;

    /// @dev The overlay commission's price. Paid once by the seed (to prove the pay-and-pin path) and
    ///      left unpaid on a second id so the same path is walkable by a visitor.
    string internal constant ENV_COMMISSION_PRICE_WEI = "SEPOLIA_COMMISSION_PRICE_WEI";
    uint256 internal constant DEFAULT_COMMISSION_PRICE = 0.0005 ether;

    // ─────────────────────────── Wave-2 breadth: fixed shape ───────────────────────────

    /// @dev Anti-snipe buffer on the seeded auctions. Short, so a bid placed immediately after the lot
    ///      is queued cannot extend the lot past the arm window the orchestrator is waiting out.
    uint40 internal constant AUCTION_TIME_BUFFER = 60;
    uint256 internal constant AUCTION_BID_INCREMENT = 0.0005 ether;
    /// @dev The timed auction runs for exactly the arm window, so its lots end in the same wait phase 2
    ///      already performs. Below this the anti-snipe buffer would dominate, so it is a floor.
    uint256 internal constant MIN_ARM_WINDOW_FOR_AUCTIONS = 300;

    /// @dev ERC1155 edition ids. `nextEditionId` starts at 1 and increments per `addEdition`, in the
    ///      order the calls below make them. Asserted against `nextEditionId`, never assumed.
    uint256 internal constant EDITION_FIXED = 1;
    uint256 internal constant EDITION_DYNAMIC = 2;
    uint256 internal constant EDITION_FREE_CLAIM = 3;

    uint256 internal constant EDITION_FIXED_PRICE = 0.002 ether;
    uint256 internal constant EDITION_FIXED_SUPPLY = 250;
    uint256 internal constant EDITION_DYNAMIC_BASE_PRICE = 0.001 ether;
    /// @dev +20% per mint. Chosen so the exponential regime is visible BY EYE across a handful of
    ///      mints rather than merely non-zero: a rate that needs a spreadsheet to see is a flat curve
    ///      wearing a dynamic label, which is the failure mode the price-movement assertion is about.
    uint256 internal constant EDITION_DYNAMIC_RATE_BPS = 2000;
    uint256 internal constant EDITION_DYNAMIC_SUPPLY = 250;
    uint256 internal constant DYNAMIC_PROBE_MINTS = 5;
    uint256 internal constant DYNAMIC_MIN_MULTIPLE = 2;
    uint256 internal constant EDITION_FREE_PRICE = 0.001 ether;
    uint256 internal constant EDITION_FREE_SUPPLY = 250;
    /// @dev Reserved out of the supply above and claimable once per address. Sized as HEADROOM: it is
    ///      the one surface a single visitor cannot exhaust by clicking twice.
    uint256 internal constant EDITION_FREE_ALLOCATION = 100;

    /// @dev The gated edition's own numbers. One tier, open now — see `_gatedTierOpenTimes`.
    uint256 internal constant GATED_EDITION = 1;
    uint256 internal constant GATED_EDITION_PRICE = 0.002 ether;
    uint256 internal constant GATED_EDITION_SUPPLY = 100;
    uint256 internal constant GATED_FREE_ALLOCATION = 10;
    /// @dev The cap the seeded operator address is listed with. Small on purpose: `QtyCapExceeded` is
    ///      then two mints away rather than a hundred, which is the branch a mint UI most often gets
    ///      wrong (it must read `claimed` before it builds the request).
    uint256 internal constant GATED_OPERATOR_QTY = 2;
    uint256 internal constant GATED_MEMBER_QTY = 1;

    /// @dev The tier row's piece count, and the one number on this row bounded from BOTH sides.
    ///
    ///      From below: every tier operation costs WHOLE units, and a whole unit is `1 / nftCount` of
    ///      the curve's supply — so a small collection makes the six units this row needs a large
    ///      fraction of the raise, and the row stops being faucet-priced.
    ///
    ///      From above: `maxSupply = nftCount * unitPerNFT * 1e18` and DN404 holds total supply in a
    ///      `uint96`, so on the NICHE preset (`unitPerNFT` 1e9, hence a `1e27` unit) anything past ~79
    ///      pieces reverts `TotalSupplyOverflow` AT CREATE. 60 sits inside that ceiling with margin
    ///      and puts the walk at a tenth of supply. Raising it means changing preset, not this number.
    uint256 internal constant TIER_NFT_COUNT = 60;
    /// @dev The OPEN rung: denomination 2, three ids. Minted up into and back down out of, and left
    ///      with room, so the reversible half of Token Tiers is walkable after the seed.
    uint32 internal constant TIER_OPEN_WEIGHT = 2;
    uint32 internal constant TIER_OPEN_COUNT = 3;
    /// @dev The SCARCE rung: denomination 3, ONE id, against a supply that could back twenty. The seed
    ///      takes that id, so the band is exhausted and the next `mintUp` into it reverts
    ///      `BandExhausted` — the state §3 asks a visitor to be able to observe. It reopens the moment
    ///      any holder mints down, which is the point: scarcity here is a queue, not a wall.
    uint32 internal constant TIER_SCARCE_WEIGHT = 3;
    uint32 internal constant TIER_SCARCE_COUNT = 1;
    uint8 internal constant TIER_N_OPEN = 1;
    uint8 internal constant TIER_N_SCARCE = 2;

    /// @dev The carve row declares its FULL allowance up front. The declaration is the disclosure
    ///      surface — immutable per instance, on the label before the first buy — and declaring the
    ///      maximum is what makes the row's page worth reading.
    uint16 internal constant CARVE_DECLARED_MAX_BPS = 10_000;
    uint256 internal constant CARVE_REQUEST_BPS = 10_000;

    // ─────────────────────────── Curve preset ───────────────────────────

    /// @dev NICHE (`targetETH` 5 ether) — the smallest preset `DeployCore` registers, and the only
    ///      sane choice for a deployment funded out of a faucet. STANDARD/HYPE raise 25/50 ETH across
    ///      the same span, which multiplies every fill below by five or ten for no demonstrative gain.
    uint8 internal constant PRESET_NICHE = 0;

    /// @dev Pieces per collection. DN404 mints one id per whole unit credited, so this is also the
    ///      granularity of a buy: at 50, a fill in the low thousands of bps mints pieces in the tens.
    uint256 internal constant SHOWCASE_NFT_COUNT = 50;

    // ─────────────────────────── Art ───────────────────────────
    //
    // Per-piece bases are METADATA directories whose entries are addressed by the BARE token id,
    // because `base + tokenId` composes with no separator and no extension. An image directory 404s
    // for every id. These are the same content-addressed directories the local seed resolved and
    // gateway-verified; reusing them keeps the showcase's art off any host we would have to keep up.

    string internal constant ART_BASE_ANIME = "ipfs://QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4/";
    string internal constant ART_BASE_ARCTIC = "ipfs://bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna/";
    string internal constant ART_BASE_SIMIAN = "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/";
    string internal constant ART_BASE_DOODLE = "ipfs://QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS/";

    // Collection tile art — single gateway-verified pointers from the same harvested set.
    string internal constant ART_EMBER = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/7.png";
    string internal constant ART_VAPOR = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/128.png";
    string internal constant ART_CINDER = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/777.png";
    string internal constant ART_FLARE = "ipfs://QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/42.png";

    // ─────────────────────────── The roster ───────────────────────────

    uint8 internal constant STATE_PREOPEN = 0;
    uint8 internal constant STATE_MID_CURVE = 1;
    uint8 internal constant STATE_READY = 2;
    uint8 internal constant STATE_GRADUATED = 3;

    /// @dev A roster row. BOTH phases build the identical list and index it BY NAME, never by
    ///      position: the waves that follow this one add venues and project types to the showcase,
    ///      and a phase-2 that resolved `instances[2]` would silently re-target when they do.
    struct ShowcaseLeg {
        string slug; // registry name, and the key in the hand-off file
        string title; // display name in the collection metadata
        string symbol;
        string description; // states the FEATURE demonstrated — see `_showcaseRoster`
        string image;
        string pieceBase;
        uint8 state;
        uint16 declaredMaxBps;
        uint256 fillBps; // phase-2 share of bondable supply to buy (0 for the pre-open row)
    }

    /// @dev The addresses the deploy wrote, narrowed to what an ERC404 showcase seed touches.
    struct Deployed {
        ERC404Factory erc404;
        address masterRegistry;
        address alignmentRegistry;
        address componentRegistry;
        address uniVaultFactory;
        address uniDeployer; // approved LIQUIDITY_DEPLOYER — the Uni-V4 module
        address priceValidator;
        address protocolTreasury;
        address zRouter;
        address weth;
        address v4PoolManager;
        // ── Wave-2 breadth: the other project families and the optional modules ──
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        address merkleGating; // approved GATING — the Merkle allowlist module
        address stakingModule; // approved STAKING — the ERC404 fee-stream module
        address resolverRouter; // METADATA_RESOLVER target when a stack is wired
        address overlay; // MetadataOverlayModule (waves + commissions)
        address tierResolver; // TokenTierBandResolver (static band art)
    }

    /// @dev What phase 1 hands phase 2, beyond the ERC404 curve roster itself. The breadth rows are
    ///      addressed by FIELD rather than by the roster's name map because they are not curve rows:
    ///      three of them are not ERC404 instances at all.
    struct SeedHandoff {
        uint256 phase2NotBefore;
        address ms2Token;
        address cultToken;
        address ms2Vault;
        address cultVault;
        uint256 ms2TargetId;
        uint256 cultTargetId;
        // ── Wave-2 breadth ──
        address editions; // ERC1155: fixed + dynamic + free-claim editions
        address gatedEditions; // ERC1155 behind the Merkle allowlist
        address staking404; // ERC404 with the staking module wired + activated
        address tiers404; // ERC404 with the metadata stack + the Token Tiers ladder
        address carve404; // ERC404 that graduates WITH a carve request
        address auctionTimed; // ERC721 whose lots end inside the arm window
        address auctionLive; // ERC721 that is still running when a visitor arrives
        uint256 soldLotId; // the timed lot carrying a bid — settled in phase 2
        uint256 unsoldLotId; // the timed lot with no bid — reclaimed in phase 2
        uint256 liveLotId; // the live lot, left running
    }

    /// @dev The seed's sender. Resolved from `msg.sender` inside `run()`, which is forge's
    ///      `--sender` — so the same scripts serve a keystore (`--account`) on the live testnet and an
    ///      unlocked account (`--unlocked`) on a fork rehearsal, with no key material in the
    ///      environment either way. It must be the account that owns the deployment's registries.
    address internal deployer;

    // ─────────────────────────── Env-backed knobs ───────────────────────────

    function _armWindow() internal view returns (uint256) {
        return vm.envOr(ENV_ARM_WINDOW, DEFAULT_ARM_WINDOW);
    }

    function _maturityOffset() internal view returns (uint256) {
        return vm.envOr(ENV_MATURITY_OFFSET, DEFAULT_MATURITY_OFFSET);
    }

    function _phase2Slack() internal view returns (uint256) {
        return vm.envOr(ENV_PHASE2_SLACK, DEFAULT_PHASE2_SLACK);
    }

    function _preopenDelay() internal view returns (uint256) {
        return vm.envOr(ENV_PREOPEN_DELAY, DEFAULT_PREOPEN_DELAY);
    }

    // ─────────────────────────── The roster, stated once ───────────────────────────

    /// @notice The four curve states the showcase must hold, as one list both phases read.
    ///
    /// @dev EVERY DESCRIPTION STATES THE FEATURE, NOT A FICTION. The showcase's defining constraint
    ///      is that a stranger can learn the product by reading the roster: a description says what
    ///      the collection demonstrates and what to do with it. The NAMES stay evocative; the
    ///      descriptions carry the teaching. Copy that roleplays a real drop is the thing this
    ///      roster exists not to be, and re-introducing it costs a later wave the unwind.
    function _showcaseRoster() internal view returns (ShowcaseLeg[] memory legs) {
        legs = new ShowcaseLeg[](4);

        legs[0] = ShowcaseLeg({
            slug: "ember-preopen",
            title: "Ember",
            symbol: "EMBER",
            description: "This collection demonstrates the PRE-OPEN state. The curve is armed and the countdown is running, and nothing can be bought until it expires - a buy attempted now is rejected on-chain, not hidden by the interface. Watch what the collection page does as the timer runs down.",
            image: ART_EMBER,
            pieceBase: ART_BASE_DOODLE,
            state: STATE_PREOPEN,
            declaredMaxBps: 0,
            fillBps: 0
        });

        legs[1] = ShowcaseLeg({
            slug: "vapor-mid",
            title: "Vapor",
            symbol: "VAPOR",
            description: "This collection demonstrates a LIVE BONDING CURVE part-way through its sale. Each buy mints coin and, in whole units, the pieces that ride it - one asset with two surfaces. Buy into it and watch the price, the piece gallery and the holder list move.",
            image: ART_VAPOR,
            pieceBase: ART_BASE_ANIME,
            state: STATE_MID_CURVE,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_MID_FILL_BPS, uint256(400))
        });

        legs[2] = ShowcaseLeg({
            slug: "cinder-ready",
            title: "Cinder",
            symbol: "CINDER",
            description: "This collection demonstrates the READY-TO-GRADUATE state. The curve is open, matured and holds a raise, so the graduation action is live and uncrossed - the collection is one call away from opening a Uniswap V4 pool. The creator declared a carve allowance up front, which the page shows before you buy.",
            image: ART_CINDER,
            pieceBase: ART_BASE_ARCTIC,
            state: STATE_READY,
            declaredMaxBps: 5000,
            fillBps: vm.envOr(ENV_READY_FILL_BPS, uint256(700))
        });

        legs[3] = ShowcaseLeg({
            slug: "flare-graduated",
            title: "Flare",
            symbol: "FLARE",
            description: "This collection demonstrates the GRADUATED state. Its curve has closed and the raise opened a real Uniswap V4 pool, so the coin now trades on the venue instead of on the curve - and 19 percent of the raise went to the alignment vault by contract. Trade it, then read the graduation on-chain.",
            image: ART_FLARE,
            pieceBase: ART_BASE_SIMIAN,
            state: STATE_GRADUATED,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_GRADUATED_FILL_BPS, uint256(700))
        });
    }

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile(DEPLOYMENT_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        require(chainId == SEPOLIA_CHAIN_ID, "sepolia.json: not a Sepolia deployment file");

        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.uniVaultFactory = vm.parseJsonAddress(json, ".factories.UNI");
        d.masterRegistry = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.componentRegistry = vm.parseJsonAddress(json, ".contracts.ComponentRegistry");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.priceValidator = vm.parseJsonAddress(json, ".contracts.UniswapVaultPriceValidator");
        d.protocolTreasury = vm.parseJsonAddress(json, ".contracts.ProtocolTreasury");
        d.zRouter = vm.parseJsonAddress(json, ".contracts.zRouter");
        d.v4PoolManager = vm.parseJsonAddress(json, ".uniswap.v4PoolManager");
        // WETH is not a top-level field of the deployment file; it is the deploy config's, and the
        // vault factory carries it as an immutable. Read it back off the factory rather than
        // re-declaring an address literal here — this item introduces no new external addresses.
        d.weth = IWethSource(d.uniVaultFactory).weth();

        // ── Wave-2 breadth: the other two factories and the optional modules ──
        d.erc1155 = ERC1155Factory(payable(vm.parseJsonAddress(json, ".factories.ERC1155")));
        d.erc721 = ERC721AuctionFactory(payable(vm.parseJsonAddress(json, ".factories.ERC721")));
        d.merkleGating = vm.parseJsonAddress(json, ".contracts.ModuleMerkleGating");
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.resolverRouter = vm.parseJsonAddress(json, ".contracts.MetadataResolverRouter");
        d.overlay = vm.parseJsonAddress(json, ".contracts.MetadataOverlayModule");
        d.tierResolver = vm.parseJsonAddress(json, ".contracts.TokenTierBandResolver");

        require(address(d.erc404) != address(0), "sepolia.json: ERC404 factory missing");
        require(d.uniVaultFactory != address(0), "sepolia.json: UNI vault factory missing");
        require(d.uniDeployer != address(0), "sepolia.json: ModuleUniV4Deployer missing (stale deployment file?)");
        require(d.v4PoolManager != address(0), "sepolia.json: v4PoolManager missing");

        // Each breadth module is REQUIRED rather than optional: a deployment missing one of them
        // cannot hold the showcase this seed claims to produce, and discovering that at the first
        // `createInstance` would leave a half-seeded deployment behind.
        require(address(d.erc1155) != address(0), "sepolia.json: ERC1155 factory missing");
        require(address(d.erc721) != address(0), "sepolia.json: ERC721 factory missing");
        require(d.merkleGating != address(0), "sepolia.json: ModuleMerkleGating missing");
        require(d.stakingModule != address(0), "sepolia.json: ERC404StakingModule missing");
        require(d.resolverRouter != address(0), "sepolia.json: MetadataResolverRouter missing");
        require(d.overlay != address(0), "sepolia.json: MetadataOverlayModule missing");
        require(d.tierResolver != address(0), "sepolia.json: TokenTierBandResolver missing");
    }

    // ─────────────────────────── Hand-off state ───────────────────────────

    function _writeSeedState(ShowcaseLeg[] memory legs, address[] memory instances, SeedHandoff memory h) internal {
        require(legs.length == instances.length, "seed state: roster/instance length mismatch");

        string memory inner = "sepoliaShowcaseInstances";
        string memory instancesJson;
        for (uint256 i = 0; i < legs.length; i++) {
            instancesJson = vm.serializeAddress(inner, legs[i].slug, instances[i]);
        }

        string memory root = "sepoliaSeedState";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "phase2NotBefore", h.phase2NotBefore);
        vm.serializeUint(root, "armWindowSeconds", _armWindow());
        vm.serializeAddress(root, "ms2Token", h.ms2Token);
        vm.serializeAddress(root, "cultToken", h.cultToken);
        vm.serializeAddress(root, "ms2Vault", h.ms2Vault);
        vm.serializeAddress(root, "cultVault", h.cultVault);
        vm.serializeUint(root, "ms2TargetId", h.ms2TargetId);
        vm.serializeUint(root, "cultTargetId", h.cultTargetId);
        vm.serializeAddress(root, "editions", h.editions);
        vm.serializeAddress(root, "gatedEditions", h.gatedEditions);
        vm.serializeAddress(root, "staking404", h.staking404);
        vm.serializeAddress(root, "tiers404", h.tiers404);
        vm.serializeAddress(root, "carve404", h.carve404);
        vm.serializeAddress(root, "auctionTimed", h.auctionTimed);
        vm.serializeAddress(root, "auctionLive", h.auctionLive);
        vm.serializeUint(root, "soldLotId", h.soldLotId);
        vm.serializeUint(root, "unsoldLotId", h.unsoldLotId);
        vm.serializeUint(root, "liveLotId", h.liveLotId);
        vm.serializeAddress(root, "all", instances);
        string memory out = vm.serializeString(root, "instances", instancesJson);

        vm.writeJson(out, SEED_STATE_PATH);
        console.log("Wrote seed state:", SEED_STATE_PATH);
    }

    /// @dev Resolve the roster BY NAME out of the hand-off file, in roster order.
    function _readSeedState(ShowcaseLeg[] memory legs)
        internal
        view
        returns (address[] memory instances, SeedHandoff memory h)
    {
        string memory json = vm.readFile(SEED_STATE_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        // A hand-off file left behind by a DIFFERENT chain (a fork rehearsal, an earlier deployment)
        // points at addresses that hold no code here. Fail at the boundary rather than broadcasting
        // buys into the void and reporting success.
        require(chainId == block.chainid, "sepolia-seed.json: wrong chainId (stale file from another chain?)");

        h.phase2NotBefore = vm.parseJsonUint(json, ".phase2NotBefore");
        h.ms2Token = vm.parseJsonAddress(json, ".ms2Token");
        h.cultToken = vm.parseJsonAddress(json, ".cultToken");
        h.ms2Vault = vm.parseJsonAddress(json, ".ms2Vault");
        h.cultVault = vm.parseJsonAddress(json, ".cultVault");
        h.ms2TargetId = vm.parseJsonUint(json, ".ms2TargetId");
        h.cultTargetId = vm.parseJsonUint(json, ".cultTargetId");

        h.editions = vm.parseJsonAddress(json, ".editions");
        h.gatedEditions = vm.parseJsonAddress(json, ".gatedEditions");
        h.staking404 = vm.parseJsonAddress(json, ".staking404");
        h.tiers404 = vm.parseJsonAddress(json, ".tiers404");
        h.carve404 = vm.parseJsonAddress(json, ".carve404");
        h.auctionTimed = vm.parseJsonAddress(json, ".auctionTimed");
        h.auctionLive = vm.parseJsonAddress(json, ".auctionLive");
        h.soldLotId = vm.parseJsonUint(json, ".soldLotId");
        h.unsoldLotId = vm.parseJsonUint(json, ".unsoldLotId");
        h.liveLotId = vm.parseJsonUint(json, ".liveLotId");
        _requireBreadthHandoff(h);

        instances = new address[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            // Bracket-quoted, not dotted: the slugs carry hyphens, which a dotted JSON path splits
            // on rather than treating as part of the key.
            instances[i] = vm.parseJsonAddress(json, string.concat(".instances[\"", legs[i].slug, "\"]"));
            require(
                instances[i] != address(0), string.concat("seed state: ", legs[i].slug, " missing from the hand-off")
            );
            require(
                instances[i].code.length > 0,
                string.concat("seed state: ", legs[i].slug, " holds no code on this chain")
            );
        }
    }

    // ─────────────────────────── Buy helpers ───────────────────────────
    //
    // The cost is computed with the SAME library the instance charges with, so `maxCost == value ==
    // cost` and a buy never reverts on a bound the seed itself chose. There is no buy-side fee (the
    // protocol fee is taken on exit), so the value is the curve price exactly.

    function _buyCost(ERC404BondingInstance b, uint256 amount) internal view returns (uint256) {
        return BondingCurveMath.calculateCost(_curveParams(b), b.totalBondingSupply(), amount);
    }

    /// @dev Buy `amount` tokens, minting the pieces the whole units carry. Reverts `TooEarly` unless
    ///      the CHAIN has passed the instance's open time — which is why every caller is in phase 2.
    function _buyBondingMint(ERC404BondingInstance b, uint256 amount) internal returns (uint256 cost) {
        cost = _buyBonding(b, amount, true);
    }

    function _buyBonding(ERC404BondingInstance b, uint256 amount, bool mintNFT) internal returns (uint256 cost) {
        cost = _buyCost(b, amount);
        require(cost > 0, "buy: cost rounds to zero (amount below the curve normalization factor)");
        vm.startBroadcast();
        b.buyBonding{ value: cost }(amount, cost, mintNFT, bytes(""), "", 0);
        vm.stopBroadcast();
    }

    /// @dev Reconstruct the curve Params struct from the public auto-getter (returns a 3-tuple).
    function _curveParams(ERC404BondingInstance b) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = b.curveParams();
        p = BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
    }

    /// @dev The tokens still buyable on a curve: the bonding cap the instance itself enforces, less
    ///      what has already been sold.
    function _bondableRemaining(ERC404BondingInstance b) internal view returns (uint256) {
        uint256 cap = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * b.unit());
        uint256 sold = b.totalBondingSupply();
        return cap > sold ? cap - sold : 0;
    }

    // ─────────────────────────── Post-conditions ───────────────────────────
    //
    // WHY THESE ARE `require`s AND NOT LOGS. Forge simulates an entire script before broadcasting any
    // of it, so a failed post-condition costs a named failure and NO partial seed. A comment claiming
    // an outcome is not an outcome. Do not soften one to make a run pass.
    //
    // WHY THEY LIVE HERE AND TAKE AN INTERFACE. The identical function is exercised by a unit test
    // against a stub whose state is settable, which is what demonstrates that removing the graduation
    // (or the maturity, or the raise) turns them RED. An assertion nothing can fail is the failure
    // mode these are written against.

    /// @notice Assert the four curve states the showcase claims to hold.
    /// @param states  The roster's instances, in roster order.
    /// @param legs    The roster.
    /// @param nowTs   The timestamp to judge the clock-dependent states at.
    /// @param poolLiquidity Live liquidity in the graduated row's venue pool. Passed in rather than
    ///        read here so the assertion stays chain-free and unit-testable; phase 2 reads it off the
    ///        pool manager and hands it over.
    function _assertShowcaseStates(
        IShowcaseCurveState[] memory states,
        ShowcaseLeg[] memory legs,
        uint256 nowTs,
        uint128 poolLiquidity
    ) internal view {
        require(states.length == legs.length, "post: roster/state length mismatch");
        bool sawPreopen;
        bool sawMid;
        bool sawReady;
        bool sawGraduated;

        for (uint256 i = 0; i < legs.length; i++) {
            IShowcaseCurveState s = states[i];
            string memory slug = legs[i].slug;

            if (legs[i].state == STATE_PREOPEN) {
                // The pre-open row is the one the visitor must find UNBOUGHT and UNOPENED. Its open
                // time still being in the future is the whole property: it is what makes `buyBonding`
                // revert `TooEarly` on-chain, which is the behaviour the description promises.
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() > nowTs, string.concat("post: ", slug, " has already opened"));
                require(s.totalBondingSupply() == 0, string.concat("post: ", slug, " has been bought into"));
                require(!s.graduated(), string.concat("post: ", slug, " is graduated"));
                sawPreopen = true;
            } else if (legs[i].state == STATE_MID_CURVE) {
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() <= nowTs, string.concat("post: ", slug, " has not opened"));
                require(!s.graduated(), string.concat("post: ", slug, " is graduated (mid-curve row)"));
                require(s.totalBondingSupply() > 0, string.concat("post: ", slug, " has no partial fill"));
                require(s.reserve() > 0, string.concat("post: ", slug, " holds no raise"));
                sawMid = true;
            } else if (legs[i].state == STATE_READY) {
                // Ready-to-graduate is three facts at once, and dropping any one of them leaves the
                // graduate action unreachable: open, matured, and holding a raise. `deployLiquidity`
                // reverts `NoReserve` on a zero raise, so a matured empty curve is not "ready".
                require(s.bondingActive(), string.concat("post: ", slug, " is not armed"));
                require(s.bondingOpenTime() <= nowTs, string.concat("post: ", slug, " has not opened"));
                require(
                    s.bondingMaturityTime() != 0 && s.bondingMaturityTime() <= nowTs,
                    string.concat("post: ", slug, " has not matured (graduate action would not be live)")
                );
                require(s.reserve() > 0, string.concat("post: ", slug, " holds no raise to graduate"));
                require(!s.graduated(), string.concat("post: ", slug, " has already graduated"));
                sawReady = true;
            } else if (legs[i].state == STATE_GRADUATED) {
                require(s.graduated(), string.concat("post: ", slug, " has NOT graduated"));
                // The raise is moved out and the reserve zeroed by `deployLiquidity`; a graduated row
                // still holding one did not complete.
                require(s.reserve() == 0, string.concat("post: ", slug, " graduated with the raise still held"));
                require(poolLiquidity > 0, string.concat("post: ", slug, " venue pool holds no liquidity"));
                sawGraduated = true;
            } else {
                revert("post: unknown roster state");
            }
        }

        require(sawPreopen, "post: no pre-open row in the roster");
        require(sawMid, "post: no mid-curve row in the roster");
        require(sawReady, "post: no ready-to-graduate row in the roster");
        require(sawGraduated, "post: no graduated row in the roster");
    }

    // ─────────────────────────── The art acceptance test ───────────────────────────
    //
    // A seeded collection whose art does not render is a failed seed, whatever its economics say. A
    // per-piece base composes as `base + tokenId` with NO separator, so a base missing its trailing
    // slash addresses `<cid>7` instead of `<cid>/7`, and one carrying two produces `//7`.

    function _assertPieceBase(string memory base, string memory label) internal pure {
        bytes memory b = bytes(base);
        require(b.length > 8, string.concat("art: ", label, " has no per-piece base URI"));
        require(_startsWith(base, "ipfs://"), string.concat("art: ", label, " base is not content-addressed"));
        require(b[b.length - 1] == "/", string.concat("art: ", label, " base has no trailing slash"));
        require(b[b.length - 2] != "/", string.concat("art: ", label, " base ends in a double slash"));
        require(!_contains(base, "TODO"), string.concat("art: ", label, " base still carries a placeholder"));
    }

    function _startsWith(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i < n.length; i++) {
            if (h[i] != n[i]) return false;
        }
        return true;
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    // ─────────────────────────── Metadata ───────────────────────────

    /// @dev Backend-free collection metadata: an unencoded `data:application/json,{...}` URI whose
    ///      image is a plain `ipfs://` pointer. No server, no gateway pinned, nothing to keep up.
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

    // ─────────────────────────── ETH discipline ───────────────────────────

    /// @dev Print what a phase is about to spend BEFORE it spends it. On a public testnet the ETH is
    ///      a human's faucet balance, not a fork's fabricated one, so the number has to be visible at
    ///      simulation time — which is before `--broadcast` sends anything.
    function _reportSpend(string memory phase, uint256 curveEth, uint256 balanceBefore) internal pure {
        console.log("--------------------------------------------------");
        console.log(string.concat("ETH projection - ", phase));
        console.log("  curve spend (wei):", curveEth);
        console.log("  deployer balance before (wei):", balanceBefore);
        console.log("  gas is NOT included above - it is charged per broadcast tx by forge");
        console.log("--------------------------------------------------");
    }

    /// @dev Create + arm helper shared by phase 1's rows. Kept here so the create parameters a row
    ///      does NOT vary (owner, preset, piece count, gating, free mint) are stated exactly once.
    function _createShowcaseInstance(Deployed memory d, ShowcaseLeg memory leg, address vault)
        internal
        returns (address instance)
    {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, leg.slug, "ERC404-SEPOLIA")),
            name: leg.slug,
            symbol: leg.symbol,
            styleUri: "",
            tokenBaseURI: leg.pieceBase,
            owner: deployer,
            vault: vault,
            nftCount: SHOWCASE_NFT_COUNT,
            presetId: PRESET_NICHE,
            stakingModule: address(0),
            declaredMaxAllowanceBps: leg.declaredMaxBps
        });
        instance = d.erc404
            .createInstance(
                params,
                _collectionMeta(leg.title, leg.description, leg.image),
                d.uniDeployer,
                address(0), // no gating on the spine rows
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            );
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                        WAVE 2 — THE OTHER PROJECT TYPES AND MECHANISMS
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // The spine above holds the four ERC404 CURVE STATES. Everything below holds the rest of what a
    // visitor is told the product does: editions with three pricing regimes, an allowlist, staking,
    // the metadata stack, Token Tiers, auctions in three states, and the creator carve.
    //
    // The same two rules the spine follows apply unchanged: every description states the FEATURE
    // rather than roleplaying a drop, and every claimed outcome is a `require` rather than a comment.

    // ─────────────────────────── Breadth knobs ───────────────────────────

    function _stakingFillBps() internal view returns (uint256) {
        return vm.envOr(ENV_STAKING_FILL_BPS, DEFAULT_STAKING_FILL_BPS);
    }

    function _stakeShareBps() internal view returns (uint256) {
        uint256 v = vm.envOr(ENV_STAKE_SHARE_BPS, DEFAULT_STAKE_SHARE_BPS);
        require(v > 0 && v < 10_000, "stake share: must leave the row both a staked and a liquid balance");
        return v;
    }

    function _tierUnits() internal view returns (uint256) {
        uint256 v = vm.envOr(ENV_TIER_UNITS, DEFAULT_TIER_UNITS);
        // 5 units reach the scarce band, 2 more reach the open band, 1 stays liquid to carry the
        // commission the overlay is authored on. Below that the phase-2 walk cannot complete.
        require(v >= DEFAULT_TIER_UNITS, "tier units: below what the tier walk consumes");
        return v;
    }

    function _carveFillBps() internal view returns (uint256) {
        return vm.envOr(ENV_CARVE_FILL_BPS, DEFAULT_CARVE_FILL_BPS);
    }

    function _auctionDeposit() internal view returns (uint256) {
        return vm.envOr(ENV_AUCTION_DEPOSIT_WEI, DEFAULT_AUCTION_DEPOSIT);
    }

    function _auctionBid() internal view returns (uint256) {
        uint256 bid = vm.envOr(ENV_AUCTION_BID_WEI, DEFAULT_AUCTION_BID);
        require(bid >= _auctionDeposit(), "auction bid: below the lot's own minimum (BidBelowMinimum)");
        return bid;
    }

    function _liveAuctionSeconds() internal view returns (uint256) {
        return vm.envOr(ENV_LIVE_AUCTION_SECONDS, DEFAULT_LIVE_AUCTION_SECONDS);
    }

    function _commissionPrice() internal view returns (uint256) {
        return vm.envOr(ENV_COMMISSION_PRICE_WEI, DEFAULT_COMMISSION_PRICE);
    }

    /// @dev The timed auction's lots must END inside the wait phase 2 already performs, so their
    ///      duration IS the arm window. The floor keeps the anti-snipe buffer from dominating: a bid
    ///      placed within `AUCTION_TIME_BUFFER` of the end extends the lot, which would push the
    ///      settle past the instant the orchestrator waits for.
    function _timedAuctionSeconds() internal view returns (uint256) {
        uint256 window = _armWindow();
        require(
            window >= MIN_ARM_WINDOW_FOR_AUCTIONS,
            "arm window: too short to also carry the timed auction (raise SEPOLIA_ARM_WINDOW_SECONDS)"
        );
        return window;
    }

    // ─────────────────────────── Metadata ───────────────────────────

    /// @dev Backend-free PIECE metadata — the per-edition JSON an ERC1155 edition carries. Same shape
    ///      as `_collectionMeta`: an unencoded `data:` JSON URI pointing at a content-addressed image.
    function _pieceMeta(string memory name, string memory image, string memory collection)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json,{\"schemaVersion\":1,\"name\":\"",
            name,
            "\",\"image\":\"",
            image,
            "\",\"collection\":\"",
            collection,
            "\"}"
        );
    }

    // ─────────────────────────── Merkle allowlist ───────────────────────────
    //
    // ── WHAT THIS SEEDS, AND WHAT IT DOES NOT ──
    //
    // The seeded allowlist is ADDRESS-BOUND, which is what a Merkle allowlist is: a leaf commits to a
    // wallet AND the cap it was listed with, so a stranger cannot enter it. The showcase standard also
    // asks for a gated tier a cold visitor can satisfy, and this wave does NOT provide one — the only
    // gating module the deployment approves is this one, and authoring a second, cold-satisfiable
    // gating contract is security-relevant work that belongs in its own item rather than in a seed.
    // The tier's own description says so on-chain, so a visitor is told what they are looking at
    // rather than left to discover a door they cannot open.
    //
    // The list's SECOND member is a derived fixture address rather than a person's wallet: a
    // single-leaf tree has `root == leaf` and an EMPTY proof, so it would verify without the verifier
    // ever hashing an internal node. With two members every proof carries a real sibling.

    /// @dev A deterministic, code-free fixture address derived from the deployment's own sender. It
    ///      holds no key and is nobody's wallet — its only job is to be a second leaf.
    function _allowlistFixtureMember() internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("ms2fun.showcase.allowlist.member", deployer)))));
    }

    /// @dev A second derived fixture address, deliberately NOT listed, so the refusal path
    ///      (`InvalidProof`) is a checked property of the seed rather than an assumption about it.
    function _allowlistStranger() internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("ms2fun.showcase.allowlist.stranger", deployer)))));
    }

    /// @dev Leaf construction, byte-identical to `MerkleGatingModule.canMint` AND to
    ///      `app/src/lib/merkle.ts`: `keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))))`.
    ///      The cap is part of the leaf, which is what stops a listed wallet re-proving itself at a
    ///      larger cap than it was listed with.
    function _leaf(address user, uint256 maxQty) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))));
    }

    /// @dev Solady commutative (sorted-pair) parent hash — the internal node the on-chain verifier and
    ///      the off-chain builder must agree on.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Build the two-member tier the fixture installs, and PROVE IT BEFORE INSTALLING IT.
    ///
    ///      A divergence between the leaf this seed commits and the leaf the app rebuilds surfaces in
    ///      the UI as an unexplained `InvalidProof`, with nothing to point at. Verifying the seed's own
    ///      proofs through the very library the module calls moves that failure into the SEED, where it
    ///      names itself.
    function _buildAllowlistTier(address a, uint256 aQty, address b, uint256 bQty, address stranger)
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

        require(MerkleProofLib.verify(proofA, root, leafA), "gating: member A's proof does not verify");
        require(MerkleProofLib.verify(proofB, root, leafB), "gating: member B's proof does not verify");
        require(
            !MerkleProofLib.verify(proofA, root, _leaf(stranger, aQty)),
            "gating: the unlisted address verifies at member A's cap"
        );
        require(
            !MerkleProofLib.verify(proofA, root, _leaf(a, aQty + 1)),
            "gating: member A verifies at a cap it was not listed with"
        );
    }

    /// @dev The off-chain `{address,maxQty}[]` list the mint page fetches to rebuild a connected
    ///      wallet's proof. Self-hosted as a `data:` URI so the fixture needs no network.
    ///
    ///      Two details are load-bearing rather than stylistic: the quotes are BACKSLASH-ESCAPED,
    ///      because this string is embedded as a JSON string value inside collection metadata that is
    ///      itself an unencoded `data:` JSON URI; and `maxQty` is a QUOTED integer, because a cap
    ///      denominated in token units does not fit a JSON number exactly.
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
    ///      this (editionId, tierIndex) pair. `tierIndex` is 0 — the tier the app resolves, and the
    ///      reason the seeded tier is tier 0 and open immediately.
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

    // ══════════════════════════ Breadth post-conditions ══════════════════════════
    //
    // Each mechanism's claim is stated as a plain struct of on-chain-observable FACTS plus a pure
    // predicate over it. That shape is deliberate and is the whole vacuity story: phase 2 fills the
    // struct by reading the chain, and `test/coverage/SepoliaShowcaseBreadth.t.sol` fills the same
    // struct by hand — including the shapes that must make each predicate go RED. An assertion that
    // only ever sees healthy input is an assertion nobody has shown can fail.

    /// @dev What the hand-off must carry before phase 2 will touch anything.
    function _requireBreadthHandoff(SeedHandoff memory h) internal pure {
        require(h.editions != address(0), "seed state: the editions collection is missing");
        require(h.gatedEditions != address(0), "seed state: the gated collection is missing");
        require(h.staking404 != address(0), "seed state: the staking row is missing");
        require(h.tiers404 != address(0), "seed state: the tiers row is missing");
        require(h.carve404 != address(0), "seed state: the carve row is missing");
        require(h.auctionTimed != address(0), "seed state: the timed auction is missing");
        require(h.auctionLive != address(0), "seed state: the live auction is missing");
        require(h.soldLotId != 0 && h.unsoldLotId != 0, "seed state: the timed auction's lot ids are missing");
        require(h.soldLotId != h.unsoldLotId, "seed state: both timed lots resolve to the same id");
        require(h.liveLotId != 0, "seed state: the live auction's lot id is missing");
    }

    // ── 1. ERC-1155 editions: fixed, LIMITED_DYNAMIC, free claim ──

    struct EditionFacts {
        uint256 nextEditionId;
        uint8 fixedModel;
        uint256 fixedPrice;
        uint256 fixedSupply;
        uint8 dynamicModel;
        uint256 dynamicBasePrice;
        uint256 dynamicRate;
        uint256 dynamicPriceAfterProbe;
        address dynamicModule;
        uint256 freeClaimAllocation;
        uint256 freeClaimSupply;
        uint256 freeClaimMinted;
    }

    /// @notice The three pricing regimes an edition collection can carry, each asserted as a REGIME
    ///         rather than as a configuration flag.
    /// @dev The dynamic row is the one worth reading twice. Checking that `pricingModel` is
    ///      `LIMITED_DYNAMIC` and the rate is non-zero would pass with a rate too small to see across
    ///      a handful of mints — a flat curve wearing a dynamic label. So the assertion is about PRICE
    ///      MOVEMENT: what the module will actually charge after `DYNAMIC_PROBE_MINTS` mints.
    function _assertEditionShowcase(EditionFacts memory f) internal pure {
        require(f.nextEditionId == EDITION_FREE_CLAIM + 1, "editions: the collection does not carry all three editions");

        require(f.fixedModel == uint8(ERC1155Instance.PricingModel.LIMITED_FIXED), "editions: fixed row is not fixed");
        require(f.fixedPrice > 0, "editions: fixed row has no price");
        require(f.fixedSupply > 0, "editions: fixed row has no supply to mint from");

        require(
            f.dynamicModel == uint8(ERC1155Instance.PricingModel.LIMITED_DYNAMIC),
            "editions: dynamic row is not LIMITED_DYNAMIC"
        );
        require(f.dynamicModule != address(0), "editions: no dynamic pricing module is wired to the instance");
        require(f.dynamicBasePrice > 0 && f.dynamicRate > 0, "editions: dynamic row has no base price or no rate");
        require(
            f.dynamicPriceAfterProbe >= f.dynamicBasePrice * DYNAMIC_MIN_MULTIPLE,
            "editions: the dynamic price does not move enough to be visible across a handful of mints"
        );

        require(f.freeClaimAllocation > 0, "editions: the free-claim row reserves nothing (nothing is claimable)");
        require(
            f.freeClaimAllocation <= f.freeClaimSupply,
            "editions: the free-claim reservation exceeds the row's own supply"
        );
        // Headroom, not merely presence: the claim is one-per-address, so a reservation a single
        // visitor could exhaust would leave the next visitor a dead button.
        require(f.freeClaimMinted < f.freeClaimAllocation, "editions: the free-claim reservation is already exhausted");
    }

    // ── 2. Merkle allowlist gating ──

    struct GatingFacts {
        address attachedModule;
        address expectedModule;
        uint8 scope;
        uint256 installedTierCount;
        bytes32 installedRoot;
        bytes32 provenRoot;
        uint256 tierOpenTime;
        uint256 freeClaimAllocation;
        bool listedMemberVerifies;
        bool unlistedAddressRejected;
    }

    /// @notice The allowlist is INSTALLED, OPEN, and DISCRIMINATING.
    /// @dev The last two facts are what stop this being a label. A root can be installed on a tier
    ///      that never opens, and a "gate" that accepts every proof is an open collection wearing a
    ///      gated description — so the seed re-verifies both a listed member and an unlisted address
    ///      against the root it actually installed, through the same library the module calls.
    function _assertGatingShowcase(GatingFacts memory f, uint256 nowTs) internal pure {
        require(f.attachedModule != address(0), "gating: no gating module is attached to the collection");
        require(f.attachedModule == f.expectedModule, "gating: the attached module is not the approved one");
        require(f.scope == uint8(GatingScope.BOTH), "gating: scope is not BOTH (the paid path would be ungated)");
        require(f.installedTierCount >= 1, "gating: no tier was installed");
        require(f.installedRoot != bytes32(0), "gating: the installed root is zero");
        require(f.installedRoot == f.provenRoot, "gating: the installed root is not the root that was proven");
        require(f.tierOpenTime <= nowTs, "gating: the seeded tier has not opened (nobody can mint through it)");
        require(f.freeClaimAllocation > 0, "gating: the gated free claim reserves nothing");
        require(f.listedMemberVerifies, "gating: a listed member does not verify against the installed root");
        require(f.unlistedAddressRejected, "gating: an unlisted address verifies (the gate refuses nobody)");
    }

    // ── 3. Staking ──

    struct StakingFacts {
        address module;
        address expectedModule;
        bool active;
        uint256 userStaked;
        uint256 totalStaked;
        uint256 liquidBalance;
    }

    /// @notice The stake/unstake surface is wired, enabled, and carries a real position.
    /// @dev This wave asserts the SURFACE, not a running stream. The module's only funding path is a
    ///      real LP-fee delta through `claimAllFees`, which needs pool depth and swap volume that a
    ///      later wave seeds; manufacturing a reward here would fabricate the source. What is checked
    ///      is therefore everything that must be true for that stream to start crediting the moment it
    ///      is funded — and the row keeps a LIQUID balance so the stake action is walkable again.
    function _assertStakingShowcase(StakingFacts memory f) internal pure {
        require(f.module != address(0), "staking: no staking module is wired to the row");
        require(f.module == f.expectedModule, "staking: the wired module is not the approved one");
        require(f.active, "staking: the row's staking is not activated");
        require(f.userStaked > 0, "staking: the row carries no staked position");
        require(f.totalStaked >= f.userStaked, "staking: the module's total is below the seeded position");
        require(f.liquidBalance > 0, "staking: the whole position is locked (the stake action is unwalkable)");
    }

    // ── 4/5. Metadata stack and Token Tiers ──

    struct TierFacts {
        uint256 scarceCapacity;
        uint256 scarceOutstanding;
        uint256 openCapacity;
        uint256 openOutstanding;
        uint256 totalTierEscrow;
        bool commissionPaid;
        uint256 waveCount;
        string baseArt;
        string bandArt;
        string commissionArt;
    }

    /// @notice Mint-up, mint-down, an EXHAUSTED band, and three visibly different metadata layers.
    /// @dev The exhaustion check is the one §3 asks for by name: the scarce band's outstanding count
    ///      equalling its capacity is exactly the condition under which the next `mintUp` into it
    ///      reverts `BandExhausted`. The open band is asserted to still have room, because the seed
    ///      minted down out of it — without that, "reversible" is a claim rather than an outcome.
    ///
    ///      The three art strings are compared for INEQUALITY rather than checked for presence. The
    ///      precedence stack (overlay over band over base) is only demonstrated if the three layers
    ///      resolve to visibly different pictures; three pointers into one collection would render as
    ///      one image three times and show nothing.
    function _assertTierShowcase(TierFacts memory f) internal pure {
        require(f.scarceCapacity > 0, "tiers: the scarce band has no capacity (the ladder was not sealed)");
        require(
            f.scarceOutstanding == f.scarceCapacity,
            "tiers: the scarce band is not exhausted (BandExhausted is unobservable)"
        );
        require(f.openCapacity > f.openOutstanding, "tiers: the open band has no room left to mint up into");
        require(f.totalTierEscrow > 0, "tiers: no coin is escrowed behind a band (no mint-up survived)");
        require(f.commissionPaid, "tiers: the paid commission was never settled");
        require(f.waveCount > 0, "tiers: no event wave was published");

        require(bytes(f.baseArt).length > 0, "tiers: the collection has no piece art");
        require(!_eq(f.baseArt, f.bandArt), "tiers: band art is the same collection as the base art");
        require(!_eq(f.baseArt, f.commissionArt), "tiers: commission art is the same collection as the base art");
        require(!_eq(f.bandArt, f.commissionArt), "tiers: commission art is the same collection as the band art");
    }

    // ── 6. ERC-721 auctions ──

    struct AuctionLotFacts {
        string label;
        bool settled;
        address highBidder;
        uint256 highBid;
        uint256 endTime;
        bool minted;
        address tokenOwner;
    }

    /// @notice The three auction states, each asserted by the fact that distinguishes it.
    /// @dev `settled` is set by BOTH terminal paths, so it cannot tell a sold lot from a reclaimed
    ///      one on its own. What separates them is the token: `settleAuction` mints it to the winner,
    ///      `reclaimUnsold` never mints at all. So the sold lot is checked to be OWNED BY ITS WINNER
    ///      and the reclaimed lot to have no token in existence — remove the settle and the first goes
    ///      red, remove the reclaim and the second still shows a live unsettled lot.
    function _assertAuctionShowcase(
        AuctionLotFacts memory live,
        AuctionLotFacts memory sold,
        AuctionLotFacts memory reclaimed,
        uint256 nowTs
    ) internal pure {
        // LIVE: still running, so a visitor can bid into it.
        require(!live.settled, string.concat("auctions: ", live.label, " is already settled"));
        require(live.endTime > nowTs, string.concat("auctions: ", live.label, " has already ended"));
        require(!live.minted, string.concat("auctions: ", live.label, " already minted its token"));

        // SETTLED: ended with a bid, and the winner holds the piece.
        require(sold.settled, string.concat("auctions: ", sold.label, " was never settled"));
        require(sold.endTime <= nowTs, string.concat("auctions: ", sold.label, " has not ended"));
        require(sold.highBidder != address(0), string.concat("auctions: ", sold.label, " settled with no bidder"));
        require(sold.highBid > 0, string.concat("auctions: ", sold.label, " settled on a zero bid"));
        require(sold.minted, string.concat("auctions: ", sold.label, " settled without minting its token"));
        require(
            sold.tokenOwner == sold.highBidder, string.concat("auctions: ", sold.label, " token is not the winner's")
        );

        // RECLAIMED: ended with no bid, the deposit returned, no token ever minted.
        require(reclaimed.settled, string.concat("auctions: ", reclaimed.label, " was never reclaimed"));
        require(reclaimed.endTime <= nowTs, string.concat("auctions: ", reclaimed.label, " has not ended"));
        require(
            reclaimed.highBidder == address(0),
            string.concat("auctions: ", reclaimed.label, " carried a bid (it is a settled lot, not a reclaimed one)")
        );
        require(!reclaimed.minted, string.concat("auctions: ", reclaimed.label, " minted a token on reclaim"));
    }

    // ── 7. The carve ──

    struct CarveFacts {
        uint16 declaredMaxBps;
        uint256 requestBps;
        uint256 raise;
        uint256 effectiveCarveEth;
        uint256 minPoolEth;
        bool graduated;
    }

    /// @notice The carve was DECLARED, REQUESTED, and settled at the protocol's own figure.
    /// @dev The declaration is the disclosure surface — immutable per instance and readable before the
    ///      first buy — so it is asserted to be on-chain and non-zero regardless of what the carve
    ///      pays out.
    ///
    ///      The payout itself is a DEPTH question, and this assertion states it as one rather than
    ///      asserting a number the seed's own fill decides. `effectiveCarveEth` is the minimum of the
    ///      request, the bracket allowance, and the LP share's headroom ABOVE the pool floor — so on a
    ///      raise whose LP share does not clear that floor the effective carve is zero BY THE
    ///      PROTOCOL'S DESIGN, and asserting otherwise would be asserting that the seed bought depth.
    ///      What is checked is the consistency of the two: below the floor the carve must be zero, and
    ///      above it, having requested the declared maximum, it must not be.
    function _assertCarveShowcase(CarveFacts memory f) internal pure {
        require(f.declaredMaxBps > 0, "carve: the row declares no allowance (there is no disclosure to read)");
        require(f.requestBps > 0, "carve: no carve was requested at graduation");
        require(f.graduated, "carve: the row did not graduate");
        require(f.raise > 0, "carve: the row graduated on an empty raise");

        uint256 lpShare = RevenueSplitLib.split(f.raise).remainder;
        if (lpShare <= f.minPoolEth) {
            require(
                f.effectiveCarveEth == 0,
                "carve: a carve was paid out of a raise whose LP share does not clear the pool floor"
            );
        } else {
            require(
                f.effectiveCarveEth > 0,
                "carve: the raise clears the pool floor but the declared-maximum request paid nothing"
            );
            require(
                f.effectiveCarveEth <= lpShare - f.minPoolEth,
                "carve: the payout exceeds the headroom the LP share has above the pool floor"
            );
        }
    }

    /// @dev The raise at which a full-allowance carve stops clamping to zero: the smallest raise whose
    ///      LP share strictly exceeds the pool floor. Printed by the seed rather than asserted,
    ///      because whether to buy that much curve is a depth decision, not a seed decision.
    function _carveThresholdRaise(uint256 minPoolEth_) internal pure returns (uint256) {
        // `split` sends 1% to the protocol and 19% to the vault; the remainder is the LP share. Solve
        // `remainder(raise) > floor` by inverting that 80%, then add one wei to make it strict.
        return (minPoolEth_ * 100) / 80 + 1;
    }

    // ─────────────────────────── String equality ───────────────────────────

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}

/// @dev The vault factory's WETH immutable — read so the seed never re-declares an external address.
interface IWethSource {
    function weth() external view returns (address);
}
