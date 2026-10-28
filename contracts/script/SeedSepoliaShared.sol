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
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { CurrencySettler } from "../src/libraries/v4/CurrencySettler.sol";
import { LiquidityAmounts } from "../src/libraries/v4/LiquidityAmounts.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { FeaturedQueueManager } from "../src/master/FeaturedQueueManager.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { MessageTypes } from "../src/libraries/MessageTypes.sol";
// The ZAMM singleton's surface, taken from the vault that already depends on it rather than
// re-declared here — the seed fills the pool the vault deposits into, so the key type must be the
// vault factory's own or the two are only accidentally the same shape.
import { IZAMM } from "../src/vaults/zamm/ZAMMAlignmentVault.sol";

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

/// @notice The chain-agnostic base for the Sepolia showcase seed: the pieces phase 1 (create + arm)
///         and phase 2 (buys + graduation) both need: the deployment reader, the roster, the
///         hand-off state file, the buy helpers, and the post-conditions.
///
///         This file mirrors `SeedAnvilShared` rather than extending a common ancestor. The reusable
///         parts of `SeedAnvilShared` (exact-cost buy helper, curve-params reconstruction, JSON
///         readers, string predicates) are interleaved with anvil-only facts (a hardcoded
///         `./deployments/anvil.json`, a fixed local chain id, well-known local test keys, a roster
///         only a mainnet fork can serve), and that file is the local dev-chain rebuild's only
///         regression gate, so it is left untouched. The Sepolia spine carries its own ~120 lines of
///         curve arithmetic and string handling.
///
///         ── Time model ──
///
///         Arming a curve and buying into it cannot share one `forge script`: `setBondingOpenTime`
///         rejects a non-future timestamp, `buyBonding` reverts `TooEarly` before it, and forge
///         simulates a whole script at one timestamp before broadcasting any of it. So the seed is
///         two scripts with a wait in between, as in the local seed.
///
///         A public testnet cannot be told to advance its clock (`evm_increaseTime`), so the gap
///         between the phases is real wall-clock time. The arm window is short and configurable
///         (`SEPOLIA_ARM_WINDOW_SECONDS`, default 20 minutes), and phase 1 records the exact
///         timestamp phase 2 becomes legal (`phase2NotBefore`) in the hand-off file for the
///         orchestrator to poll.
abstract contract SeedSepoliaShared is Script {
    // ─────────────────────────── Network + paths ───────────────────────────

    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Written by `DeploySepolia`. Read, never written, by this seed.
    string internal constant DEPLOYMENT_PATH = "./deployments/sepolia.json";
    /// @dev Phase 1 writes it; phase 2 and the orchestrator read it.
    string internal constant SEED_STATE_PATH = "./deployments/sepolia-seed.json";
    /// @dev Written by `DeploySepolia` beside the deployment file — see `_readVenueHandoff`.
    string internal constant VENUE_PATH = "./deployments/sepolia-venues.json";

    // ─────────────────────────── Venue pool shape ───────────────────────────
    //
    // One fee tier for the Uniswap vaults. `DeployCore` builds every Uni vault's pool key from
    // `zrouterFee`/`zrouterTickSpacing`, and `BestRouteAcquirer` falls back to the same pair, so
    // the pool a vault LPs into, the pool its acquire leg swaps through, and the pool the registry
    // curates as its route are all this tier.
    //
    // `DeploySepolia` also wires a `SepoliaRouteQuoter`, and the seed registers each Uni vault
    // against this tier once its pool has depth, so the best-route path is live and the showcase
    // rehearses the code mainnet runs. The tier applies to the Uni vaults only: MS2 on ZAMM sits in
    // a vault with its own pool and price authority, which is why the quoter keys rows by the
    // asking vault (see `SepoliaRouteQuoter`).

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev `POOL_FEE` in the quoter ABI's BPS units — what a Uni vault's `SepoliaRouteQuoter` row
    ///      stores. `BestRouteAcquirer` multiplies it back by 100 for the pool fee and maps it to the
    ///      paired tick spacing (30 -> 60); deriving it keeps the quoted pool and the seeded pool
    ///      the same pool.
    uint256 internal constant POOL_FEE_BPS = uint256(POOL_FEE) / 100;
    /// @dev Starting price 1:1 (sqrt(1) * 2^96). A pool must be initialized before it can be named;
    ///      it holds no liquidity until someone adds some. The reference pool is stood up at the same
    ///      parity — see `SepoliaReferencePoolSeeder`.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // ─────────────────────────── Clock knobs ───────────────────────────
    //
    // Every window below is a wall-clock wait for whoever runs the seed, so the defaults are sized
    // for a human at a terminal.

    /// @dev How long after phase 1 the showcase curves open.
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

    /// @dev The pre-open row must survive the seed, so a visitor arriving days later still finds a
    ///      curve that has not opened. It is armed on its own long clock, not the arm window.
    string internal constant ENV_PREOPEN_DELAY = "SEPOLIA_PREOPEN_DELAY_SECONDS";
    uint256 internal constant DEFAULT_PREOPEN_DELAY = 30 days;

    // ─────────────────────────── Fill knobs ───────────────────────────
    //
    // Fills are a share of the instance's own bondable supply, so they stay meaningful whichever
    // preset a row selects. They are also the entire ETH cost of the seed, paid from a faucet
    // balance, so each is overridable by environment.
    //
    // The defaults are sized for a faucet, not for depth. A Sepolia faucet dispenses a fraction of
    // an ETH per day, so the defaults buy enough curve to render every surface the rows exist to
    // show: a measured 0.242 ETH across the three bought rows on the NICHE preset. Raising them
    // makes the graduated row's pool and the vault's tithe correspondingly larger; the seed prints
    // its projection before spending.

    string internal constant ENV_MID_FILL_BPS = "SEPOLIA_MID_FILL_BPS";
    string internal constant ENV_READY_FILL_BPS = "SEPOLIA_READY_FILL_BPS";
    string internal constant ENV_GRADUATED_FILL_BPS = "SEPOLIA_GRADUATED_FILL_BPS";

    // ─────────────────────────── Breadth knobs ───────────────────────────
    //
    // The breadth rows demonstrate mechanisms, not depth, so their defaults are the smallest values
    // that still reach the state each row exists to show. Each is overridable.

    /// @dev Fill for the staking row, in bps of its bondable supply. The stake itself is taken out of
    ///      what this buys, so it only has to be large enough to leave a non-zero position.
    string internal constant ENV_STAKING_FILL_BPS = "SEPOLIA_STAKING_FILL_BPS";
    uint256 internal constant DEFAULT_STAKING_FILL_BPS = 300;

    /// @dev Share of the bought staking position that is actually staked, in bps. Below 10000 so the
    ///      row also holds a liquid balance; an instance whose whole float is locked cannot
    ///      demonstrate staking a second time.
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

    /// @dev How long the live auction runs. Like the pre-open curve it must survive the seed, so a
    ///      visitor arriving days later finds a lot to bid on; it runs on its own long clock and is
    ///      excluded from the wait phase 2 computes.
    string internal constant ENV_LIVE_AUCTION_SECONDS = "SEPOLIA_LIVE_AUCTION_SECONDS";
    uint256 internal constant DEFAULT_LIVE_AUCTION_SECONDS = 30 days;

    /// @dev The overlay commission's price. Paid once by the seed (to prove the pay-and-pin path) and
    ///      left unpaid on a second id so the same path is walkable by a visitor.
    string internal constant ENV_COMMISSION_PRICE_WEI = "SEPOLIA_COMMISSION_PRICE_WEI";
    uint256 internal constant DEFAULT_COMMISSION_PRICE = 0.0005 ether;

    // ─────────────────────────── The featured wall ───────────────────────────
    //
    // A featured slot is rented per day at the queue's own `dailyRate`, so the duration is the
    // whole cost. The default is 30 days, the showcase's lifetime on Sepolia, not the queue's
    // 365-day ceiling. The seed prints the resulting total before it spends anything.
    //
    // The rate is read from the deployed queue because it is owner-tunable.
    string internal constant ENV_FEATURED_DURATION_SECONDS = "SEPOLIA_FEATURED_DURATION_SECONDS";
    uint256 internal constant DEFAULT_FEATURED_DURATION_SECONDS = 30 days;

    /// @dev The rank step between adjacent featured slots. The queue returns active slots sorted by
    ///      effective rank, so a distinct boost per slot makes the wall read in composed order. The
    ///      step is small because only the ordering is demonstrated.
    string internal constant ENV_FEATURED_RANK_STEP_WEI = "SEPOLIA_FEATURED_RANK_STEP_WEI";
    uint256 internal constant DEFAULT_FEATURED_RANK_STEP_WEI = 0.0001 ether;

    // ─────────────────────────── Venue knobs ───────────────────────────
    //
    // Every venue's depth is the seed's own ETH, so each is an environment knob and the seed prints
    // what it deposited. The defaults are sized by the floor: a demo-sized convert must price
    // within the vault's -5% oracle floor, and a concentrated position reaches that on a fraction
    // of an ETH.

    /// @dev ETH into each Uniswap V4 acquire pool (one per Uni alignment target).
    ///
    ///      Sized by the floor. The vault's oracle floor rejects a convert that prices more than
    ///      `maxPriceDeviationBps` (5%) under the reference TWAP, and on a concentrated position at
    ///      parity a swap of `dx` moves the price by roughly `2·dx/L`, so the pool needs
    ///      `L >= 40·dx`. With this seed's fills the largest convert swaps a little over a hundredth
    ///      of an ETH. Raising the curve fills raises the tithe, and therefore this.
    string internal constant ENV_V4_DEPTH_WEI = "SEPOLIA_V4_DEPTH_WEI";
    uint256 internal constant DEFAULT_V4_DEPTH_WEI = 0.05 ether;

    /// @dev ETH into each seeded {token, WETH} Uniswap V3 reference pool, a price authority
    ///      rather than an execution venue, sized to be a credible quote and not to absorb a trade.
    string internal constant ENV_REFERENCE_DEPTH_WEI = "SEPOLIA_REFERENCE_DEPTH_WEI";
    uint256 internal constant DEFAULT_REFERENCE_DEPTH_WEI = 0.01 ether;

    /// @dev ETH into the ZAMM ETH/token pool, stood up with the vault so the vault has a venue.
    string internal constant ENV_ZAMM_DEPTH_WEI = "SEPOLIA_ZAMM_DEPTH_WEI";
    uint256 internal constant DEFAULT_ZAMM_DEPTH_WEI = 0.05 ether;

    /// @dev The tithe seeded directly into the ZAMM vault so its convert has something to convert.
    ///      The Uni vault receives its own as the product does, 19% of a real graduation. No
    ///      collection graduates into ZAMM here, so its pending balance is a plain contribution from
    ///      the seed's own account: real ETH, credited to a real benefactor, converted by the real
    ///      call.
    string internal constant ENV_ZAMM_VAULT_TITHE_WEI = "SEPOLIA_ZAMM_VAULT_TITHE_WEI";
    uint256 internal constant DEFAULT_ZAMM_VAULT_TITHE_WEI = 0.002 ether;

    /// @dev The demo swap that produces the LP-fee delta the staking stream is funded from. It buys
    ///      the alignment asset on the vault's own venue pool, so the fee it pays is earned by the
    ///      vault's position — which is the only funding path the staking module has.
    string internal constant ENV_DEMO_SWAP_WEI = "SEPOLIA_DEMO_SWAP_WEI";
    uint256 internal constant DEFAULT_DEMO_SWAP_WEI = 0.004 ether;

    /// @dev Half-width of every seeded position, in ticks, before alignment to the pool's spacing.
    ///
    ///      Concentration makes a faucet budget enough. Liquidity for a given deposit
    ///      scales roughly as `1 / (1 - 1/sqrt(priceRatio))`, so narrowing the range buys depth that
    ///      widening it does not. 1200 ticks is about ±12.7% in price: two-and-a-half times the -5%
    ///      band the vault's floor allows a convert to move the price through, so the seeded range
    ///      still contains the price after every convert and the demo swap — and about five times the
    ///      liquidity the same ETH would buy across a ±80% range.
    string internal constant ENV_DEPTH_HALF_WIDTH_TICKS = "SEPOLIA_DEPTH_HALF_WIDTH_TICKS";
    int24 internal constant DEFAULT_DEPTH_HALF_WIDTH_TICKS = 1200;

    /// @dev Observation ring size requested on each seeded V3 reference pool.
    uint16 internal constant REFERENCE_POOL_CARDINALITY = 16;

    /// @dev Minimum active liquidity a seeded venue pool must report before the seed claims the venue
    ///      is live. A position minted outside the current tick range reports units while adding none
    ///      of the depth the acquire leg needs.
    uint128 internal constant MIN_VENUE_ACTIVE_LIQUIDITY = 1e12;

    // ─────────────────────────── Breadth: fixed shape ───────────────────────────

    /// @dev Anti-snipe buffer on the seeded auctions. Short, so a bid placed right after the lot
    ///      is queued cannot extend it past the arm window.
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
    /// @dev +20% per mint, so the exponential regime is visible by eye across a handful of mints.
    uint256 internal constant EDITION_DYNAMIC_RATE_BPS = 2000;
    uint256 internal constant EDITION_DYNAMIC_SUPPLY = 250;
    uint256 internal constant DYNAMIC_PROBE_MINTS = 5;
    uint256 internal constant DYNAMIC_MIN_MULTIPLE = 2;
    uint256 internal constant EDITION_FREE_PRICE = 0.001 ether;
    uint256 internal constant EDITION_FREE_SUPPLY = 250;
    /// @dev Reserved out of the supply above and claimable once per address. Sized as headroom, so a single
    ///      visitor cannot exhaust it.
    uint256 internal constant EDITION_FREE_ALLOCATION = 100;

    /// @dev The gated edition's own numbers. One tier, open now — see `_gatedTierOpenTimes`.
    uint256 internal constant GATED_EDITION = 1;
    uint256 internal constant GATED_EDITION_PRICE = 0.002 ether;
    uint256 internal constant GATED_EDITION_SUPPLY = 100;
    uint256 internal constant GATED_FREE_ALLOCATION = 10;
    /// @dev The cap the seeded operator address is listed with. Small so `QtyCapExceeded` is
    ///      two mints away; a mint UI must read `claimed` before it builds the request.
    uint256 internal constant GATED_OPERATOR_QTY = 2;
    uint256 internal constant GATED_MEMBER_QTY = 1;

    /// @dev The tier row's piece count, bounded from both sides.
    ///
    ///      Below: every tier operation costs whole units, and a whole unit is `1 / nftCount` of the
    ///      curve's supply, so a small collection makes the six units this row needs a large
    ///      fraction of the raise and the row stops being faucet-priced.
    ///
    ///      Above: `maxSupply = nftCount * unitPerNFT * 1e18` and DN404 holds total supply in a
    ///      `uint96`, so on the NICHE preset (`unitPerNFT` 1e6, a `1e24` unit) anything past 79,228
    ///      pieces reverts `TotalSupplyOverflow` at create. 60 is far below it, so the lower bound
    ///      decides this number.
    uint256 internal constant TIER_NFT_COUNT = 60;
    /// @dev The open rung: denomination 2, three ids. Left with room so the reversible half of
    ///      Token Tiers (mint up and back down) is walkable after the seed.
    uint32 internal constant TIER_OPEN_WEIGHT = 2;
    uint32 internal constant TIER_OPEN_COUNT = 3;
    /// @dev The scarce rung: denomination 3, one id, against a supply that could back twenty. The
    ///      seed takes that id, so the band is exhausted and the next `mintUp` into it reverts
    ///      `BandExhausted`. It reopens when any holder mints down: scarcity here is a queue, not a
    ///      wall.
    uint32 internal constant TIER_SCARCE_WEIGHT = 3;
    uint32 internal constant TIER_SCARCE_COUNT = 1;
    uint8 internal constant TIER_N_OPEN = 1;
    uint8 internal constant TIER_N_SCARCE = 2;

    /// @dev The carve row declares its full allowance up front. The declaration is the disclosure
    ///      surface, immutable per instance and visible before the first buy.
    uint16 internal constant CARVE_DECLARED_MAX_BPS = 10_000;
    uint256 internal constant CARVE_REQUEST_BPS = 10_000;

    // ─────────────────────────── Curve preset ───────────────────────────

    /// @dev NICHE (`targetETH` 5 ether), the smallest preset `DeployCore` registers. STANDARD/HYPE
    ///      raise 25/50 ETH across the same span, multiplying every fill by five or ten.
    uint8 internal constant PRESET_NICHE = 0;

    /// @dev Pieces per collection. DN404 mints one id per whole unit credited, so this is also the
    ///      granularity of a buy: at 50, a fill in the low thousands of bps mints pieces in the tens.
    uint256 internal constant SHOWCASE_NFT_COUNT = 50;

    // ─────────────────────────── Art ───────────────────────────
    //
    // Every row on this seed, curve and breadth alike, wears one derivative collection end to end:
    // its pieces resolve inside that collection's own metadata directory and its tile is that
    // collection's own art, so the featured wall reads as twelve distinct drops. No two rows share a
    // family, and no row takes its tile from a directory another row's tile comes from.
    //
    // Per-piece bases are metadata directories whose entries are addressed by the bare token id,
    // because `base + tokenId` composes with no separator or extension; an image directory 404s for
    // every id. Tiles are single files inside the family's own image directory, a different CID from
    // the metadata one.
    //
    // Rows whose mechanism composes per-piece `data:` metadata (the ERC-1155 editions and the
    // ERC-721 auction houses) have no on-chain base, so only their family's image directory appears
    // below.

    // ── Metadata directories, one per row that carries an on-chain base ───────────────────────────
    string internal constant ART_BASE_PIXELADY = "ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/";
    string internal constant ART_BASE_BOREDMILADY = "ipfs://QmZ7K6hG5uiTvLVvmxZgm72Nv3kmvTq4CVAEG6JoMFvpkW/";
    string internal constant ART_BASE_FIGMATA = "ipfs://bafybeih64fcswxjq7qrpx6hbzr2wkmn7u7bcl63yadaxmzgcyabecenl6e/";
    string internal constant ART_BASE_LAWBSTERS = "ipfs://bafybeibvgwjwuosoov6cfgwoyyrt7vocalqoprjayni6rfepda7bi2jdse/";
    string internal constant ART_BASE_MILADYSTATION = "ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/";
    string internal constant ART_BASE_GHIBLADY = "ipfs://bafybeic5in4it4rsocajjvzn3zs5scsci4a7hhpbpd5fulqca42vqtjs2q/";
    string internal constant ART_BASE_ELITE = "ipfs://bafybeicrcd4fgtumtkjfzkxkmlzqvy3w6cn2tlb3vm6jvbnxbojebvnwne/";

    /// @dev The tier row's three metadata directories are one family's lineage, bottom to top: the
    ///      ordinary base is the parent collection, and each tier band is the derivative that
    ///      succeeded it, so the layers can be told apart by eye.
    string internal constant ART_BASE_SONORA = "ipfs://QmX89dvzA3TSwsGfY7SthYkDxSFjszec8JkEEZE7JP5QHF/";
    string internal constant ART_BASE_SONORA222 = "ipfs://bafybeifxxqwdsdxtmvk6iauqqh4vobvlrflv332nb6fnllhwwjeblr35ra/";
    string internal constant ART_BASE_SCHIZO = "ipfs://bafybeibtjhjyswebkwvck4u6pomllz46gdsfqtsdfrurhm7awn34oxckgi/";

    /// @dev The metadata row's lineage: the Pixelady base is the parent collection, the WOTLK
    ///      expansion is the wave an artist publishes for holders to opt into, and Pixelady Maker BC,
    ///      the later edition of the same maker, is what a paid commission replaces a piece with.
    ///
    ///      The CIDs are the collections' own, recovered CID-preserving; a gateway that has not
    ///      pinned the content renders these layers blank.
    string internal constant ART_BASE_WOTLK = "ipfs://bafybeifxf2xnossezzaywoni3gf5dfyqotn36vdvhnjkvldgkavyc2kx2q/";

    /// @dev The alignment roster's logos, one square PNG per community, keyed by ticker. Each is the
    ///      community's own mark, taken from its canonical source (its own site, or the asset lists
    ///      wallets and explorers serve it from). CID-preserving, so as with the collection art an
    ///      unpinned directory renders blank.
    string internal constant ART_IMG_TARGETS = "ipfs://bafybeiaq7odvp24jbgwsyaxq5c67qs2iev2ct42rd7rhjuticpbqd6fhlm/";
    string internal constant ART_BASE_PIXELADYBC =
        "ipfs://bafybeigtcr23kdzivowzasei7u7yza5frirctrjflytvooycb6tdqa4dga/";

    // ── Image directories, one per family. A row's tile is a FILE inside its own family's ─────────
    string internal constant ART_IMG_PIXELADY = "ipfs://bafybeih5mqafo34424swmfdboww3s2tvfmzoojbip4jmcjbg5n3fl7edee/";
    string internal constant ART_IMG_BOREDMILADY = "ipfs://QmWEQVc5xLyjPduYopckWWu6arhqgg7srxTo5FuLmLxiAU/";
    string internal constant ART_IMG_FIGMATA = "ipfs://bafybeieedvws62v6g3gr6uw2a2m7m2ckhekv2vkcsv62vokpjtcvkz6gfi/";
    string internal constant ART_IMG_LAWBSTERS = "ipfs://QmRFZ9GtqT6A8cF8ZF1x4fsysRHMhFSk1g8QGEBVn249pQ/";
    string internal constant ART_IMG_RADBRO = "ipfs://bafybeiawybz4ma6qj2litcotzpu4j6z5whwlb5bcocsfhvzp5odco5twgy/";
    string internal constant ART_IMG_MILADYSTATION = "ipfs://QmSjnEsFWBWC3hCcm1UarThXLSRrKuYLq1e8oYFaZpVmJS/";
    string internal constant ART_IMG_MFERS = "ipfs://QmSXG9BXpFPCse35T4ZcEVdYXDUwP7MRr2oXJvfuEiVCPT/";
    string internal constant ART_IMG_MEOWLADY = "ipfs://bafybeic5ayyoejk74vhbrodtgw66lg5n4fbkkua6fhrqniwjuciaiaau5e/";
    string internal constant ART_IMG_COLOMBIA = "ipfs://bafybeiamccfdkkqi7hnqyxhfaiz5tkdvxc5uz7ed6o2hgrypbjom2tsi2a/";
    string internal constant ART_IMG_SONORA = "ipfs://QmcX9WYUF6Z79Gg8RBxzX9sowQpNJKaQRn6Gn1xUVqQB2t/";
    string internal constant ART_IMG_GHIBLADY = "ipfs://bafybeih77zrj3rugllheg277n4sib4avy2hb5i4xnhrt6y5ix5xiwjzote/";
    string internal constant ART_IMG_ELITE = "ipfs://bafybeifgzaqtirkmmy7rqgtchfg2twe4olz2i3ul64w4pnlufrsaovkhau/";

    // ── The curve rows' tiles ─────────────────────────────────────────────────────────────────────
    string internal constant ART_TILE_PIXELADY =
        "ipfs://bafybeih5mqafo34424swmfdboww3s2tvfmzoojbip4jmcjbg5n3fl7edee/1.png";
    string internal constant ART_TILE_BOREDMILADY = "ipfs://QmWEQVc5xLyjPduYopckWWu6arhqgg7srxTo5FuLmLxiAU/1.png";
    string internal constant ART_TILE_FIGMATA =
        "ipfs://bafybeieedvws62v6g3gr6uw2a2m7m2ckhekv2vkcsv62vokpjtcvkz6gfi/1.png";
    string internal constant ART_TILE_LAWBSTERS = "ipfs://QmRFZ9GtqT6A8cF8ZF1x4fsysRHMhFSk1g8QGEBVn249pQ/1.png";

    // ── The breadth rows' tiles and pieces ────────────────────────────────────────────────────────
    //
    // One family per row, distinct ids within a row so a collection page is not three copies of one
    // picture. The auction and edition pieces are the only places a breadth row names a picture per
    // piece; everything else on those rows is the collection tile.
    string internal constant ART_TILE_ATLAS =
        "ipfs://bafybeiawybz4ma6qj2litcotzpu4j6z5whwlb5bcocsfhvzp5odco5twgy/1.png";
    string internal constant ART_PIECE_ATLAS_FIXED =
        "ipfs://bafybeiawybz4ma6qj2litcotzpu4j6z5whwlb5bcocsfhvzp5odco5twgy/2.png";
    string internal constant ART_PIECE_ATLAS_RISING =
        "ipfs://bafybeiawybz4ma6qj2litcotzpu4j6z5whwlb5bcocsfhvzp5odco5twgy/3.png";
    string internal constant ART_PIECE_ATLAS_CLAIM =
        "ipfs://bafybeiawybz4ma6qj2litcotzpu4j6z5whwlb5bcocsfhvzp5odco5twgy/4.png";

    string internal constant ART_TILE_VEIL = "ipfs://QmSXG9BXpFPCse35T4ZcEVdYXDUwP7MRr2oXJvfuEiVCPT/1.png";
    string internal constant ART_PIECE_VEIL_PASS = "ipfs://QmSXG9BXpFPCse35T4ZcEVdYXDUwP7MRr2oXJvfuEiVCPT/2.png";

    string internal constant ART_TILE_QUARRY = "ipfs://QmSjnEsFWBWC3hCcm1UarThXLSRrKuYLq1e8oYFaZpVmJS/1.png";
    string internal constant ART_TILE_PRISM = "ipfs://QmcX9WYUF6Z79Gg8RBxzX9sowQpNJKaQRn6Gn1xUVqQB2t/1.png";
    string internal constant ART_TILE_CARVE =
        "ipfs://bafybeih77zrj3rugllheg277n4sib4avy2hb5i4xnhrt6y5ix5xiwjzote/1.png";
    string internal constant ART_TILE_RELIC =
        "ipfs://bafybeic5ayyoejk74vhbrodtgw66lg5n4fbkkua6fhrqniwjuciaiaau5e/1.png";
    string internal constant ART_PIECE_RELIC_I =
        "ipfs://bafybeic5ayyoejk74vhbrodtgw66lg5n4fbkkua6fhrqniwjuciaiaau5e/2.png";
    string internal constant ART_PIECE_RELIC_II =
        "ipfs://bafybeic5ayyoejk74vhbrodtgw66lg5n4fbkkua6fhrqniwjuciaiaau5e/3.png";

    /// @dev Three ids in this directory are AVIF rather than PNG and are the only surviving copies of
    ///      their pieces; the two ids taken here are PNG.
    string internal constant ART_TILE_SALON =
        "ipfs://bafybeiamccfdkkqi7hnqyxhfaiz5tkdvxc5uz7ed6o2hgrypbjom2tsi2a/1.png";
    string internal constant ART_PIECE_SALON_I =
        "ipfs://bafybeiamccfdkkqi7hnqyxhfaiz5tkdvxc5uz7ed6o2hgrypbjom2tsi2a/2.png";

    // ── Id coverage of each metadata directory ───────────────────────────────────────────────────
    //
    // A row mints piece ids 1..N, and `base + tokenId` resolves only for ids the directory carries.
    // The counts below are each collection's supply, the number of ids its directory answers for.
    // `_assertPieceCoverage` holds them against what a row can mint.
    uint256 internal constant COVER_PIXELADY = 10_000;
    uint256 internal constant COVER_BOREDMILADY = 6911;
    uint256 internal constant COVER_FIGMATA = 180;
    uint256 internal constant COVER_LAWBSTERS = 420;
    uint256 internal constant COVER_MILADYSTATION = 1212;
    uint256 internal constant COVER_GHIBLADY = 2600;
    uint256 internal constant COVER_ELITE = 777;
    uint256 internal constant COVER_SONORA = 444;
    uint256 internal constant COVER_SONORA222 = 222;
    uint256 internal constant COVER_SCHIZO = 100;
    uint256 internal constant COVER_WOTLK = 150;
    uint256 internal constant COVER_PIXELADYBC = 1000;

    // ── Denylisted directories ───────────────────────────────────────────────────────────────────
    //
    // Five blue-chip directories the seed must not reference. `_assertNotRetiredArt` runs over every
    // base and every tile the seed configures, so one of them (e.g. copied from the anvil seed) is a
    // named failure at simulation time.
    string internal constant RETIRED_DIR_ANIME = "QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4";
    string internal constant RETIRED_DIR_ARCTIC = "bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna";
    string internal constant RETIRED_DIR_SIMIAN = "QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq";
    string internal constant RETIRED_DIR_DOODLE = "QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS";
    string internal constant RETIRED_DIR_SHARED_TILE = "QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg";

    // ─────────────────────────── The roster ───────────────────────────

    uint8 internal constant STATE_PREOPEN = 0;
    uint8 internal constant STATE_MID_CURVE = 1;
    uint8 internal constant STATE_READY = 2;
    uint8 internal constant STATE_GRADUATED = 3;

    /// @dev A roster row. Both phases build the identical list and index it by name, never by
    ///      position, so adding rows cannot silently re-target a phase-2 lookup.
    struct ShowcaseLeg {
        string slug; // registry name, and the key in the hand-off file
        string title; // display name in the collection metadata
        string symbol;
        string description; // states the FEATURE demonstrated — see `_showcaseRoster`
        string image;
        string imageDir; // the row family's IMAGE directory — `image` must live inside it
        string pieceBase;
        uint8 state;
        uint16 declaredMaxBps;
        uint256 fillBps; // phase-2 share of bondable supply to buy (0 for the pre-open row)
        uint256 pieceIdCoverage; // ids the row's metadata directory answers for — see COVER_*
        /// @dev Wire the overlay module under a router on this row, making it the artist metadata
        ///      demonstration.
        bool metadataOverlay;
    }

    /// @dev One community the showcase can align to.
    ///
    ///      The asset is a testnet fixture. The real token lives on Ethereum mainnet and cannot be
    ///      traded here, so the seed mints a stand-in and records the real address in `mainnetToken`.
    ///      The tithe, the acquire swap and the LP position are exercised against the fixture.
    struct AlignmentSeed {
        string symbol; // the fixture's ticker — the community's real one
        string tokenName; // the fixture's on-chain name, which carries the word FIXTURE
        string title; // what the vaults page calls this row
        string logo; // file inside `ART_IMG_TARGETS`
        address mainnetToken; // the real mainnet ERC-20 this row rehearses
        string description;
        bool endowment; // also stand up an Aave endowment vault for this target
    }

    /// @notice The alignment roster, stated once.
    ///
    /// @dev Order is display order. Remilia leads because every collection on this wall is a Remilia
    ///      derivative and aligns to it; MS2 follows because it is this platform's own token and the
    ///      one row that aligns elsewhere. The rest are communities the picker offers a creator, each
    ///      with a live venue behind it so a collection launched against one during a walk can
    ///      actually tithe rather than reverting at its first acquire.
    function _alignmentRoster() internal pure returns (AlignmentSeed[] memory r) {
        r = new AlignmentSeed[](5);
        r[0] = AlignmentSeed({
            symbol: "CULT",
            tokenName: "Remilia Fixture Token",
            title: "Remilia",
            logo: "CULT.png",
            mainnetToken: 0x0000000000c5dc95539589fbD24BE07c6C14eCa4,
            description: "Milady Cult Coin - Remilia Corporation's own token, and the community every collection on this wall descends from. Aligning here sends a share of each sale to a vault that acquires CULT and holds it as liquidity. The asset on this testnet is a FIXTURE standing in for mainnet 0x0000000000c5dc95539589fbD24BE07c6C14eCa4; what is real here is where the money goes and what the vault does with it.",
            endowment: true
        });
        r[1] = AlignmentSeed({
            symbol: "MS2",
            tokenName: "Station This Fixture Token",
            title: "MS2",
            logo: "MS2.png",
            mainnetToken: 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820,
            description: "Station This - this platform's own token. It carries an endowment vault as well as a liquidity vault, so the two vault families can be read side by side: one holds a principal and pays a community from the yield, the other puts the tithe to work as liquidity. Fixture asset for mainnet 0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820.",
            endowment: true
        });
        r[2] = AlignmentSeed({
            symbol: "SPX",
            tokenName: "SPX6900 Fixture Token",
            title: "SPX6900",
            logo: "SPX.png",
            mainnetToken: 0xE0f63A424a4439cBE457D80E4f4b51aD25b2c56C,
            description: "SPX6900 - a community a creator can align a collection to instead of ours. Its venue is stood up and funded here, so a collection launched against it tithes for real. Fixture asset for mainnet 0xE0f63A424a4439cBE457D80E4f4b51aD25b2c56C.",
            endowment: false
        });
        r[3] = AlignmentSeed({
            symbol: "MOG",
            tokenName: "Mog Coin Fixture Token",
            title: "MOG",
            logo: "MOG.png",
            mainnetToken: 0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a,
            description: "Mog Coin - another community on the picker, with its own funded venue. Fixture asset for mainnet 0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a.",
            endowment: false
        });
        r[4] = AlignmentSeed({
            symbol: "ZAMM",
            tokenName: "ZAMM Fixture Token",
            title: "ZAMM",
            logo: "ZAMM.png",
            mainnetToken: 0xE9b1cFEA55BAA219e34301f2F31b9FD0921664ED,
            description: "ZAMM - the token of the venue this platform already routes one of its vault families through. Fixture asset for mainnet 0xE9b1cFEA55BAA219e34301f2F31b9FD0921664ED.",
            endowment: false
        });
    }

    /// @dev The addresses the deploy wrote, narrowed to what an ERC404 showcase seed touches.
    struct Deployed {
        ERC404Factory erc404;
        address masterRegistry;
        address alignmentRegistry;
        address componentRegistry;
        address uniVaultFactory;
        address aaveVaultFactory; // AlignmentEndowmentVaultFactory; zero where the network has no Aave market
        address uniDeployer; // approved LIQUIDITY_DEPLOYER — the Uni-V4 module
        address priceValidator;
        address protocolTreasury;
        address zRouter;
        address zQuoter; // SepoliaRouteQuoter; the route table the acquire leg reads
        address weth;
        address v4PoolManager;
        // ── Breadth: the other project families and the optional modules ──
        ERC1155Factory erc1155;
        ERC721AuctionFactory erc721;
        address merkleGating; // approved GATING — the Merkle allowlist module
        address stakingModule; // approved STAKING — the ERC404 fee-stream module
        address resolverRouter; // METADATA_RESOLVER target when a stack is wired
        address overlay; // MetadataOverlayModule (waves + commissions)
        address tierResolver; // TokenTierBandResolver (static band art)
        // ── Venues: the LP families beyond Uni, and the periphery they ride ──
        address zammVaultFactory; // ZAMMAlignmentVaultFactory — zero when this network has no ZAMM
        address zammDeployer; // approved LIQUIDITY_DEPLOYER — the ZAMM module
        address v3Factory;
        address zamm;
        uint256 zammFeeOrHook;
        // ── The home page's front door ──
        FeaturedQueueManager queue; // paid placement; what `QueryAggregator.getHomePageData` reads
        // ── The social layer ──
        //
        // Every activity surface the app renders (home preview, a collection's activity section,
        // the board) reads `MessagePosted` off this one registry.
        GlobalMessageRegistry messages;
    }

    /// @dev What phase 1 hands phase 2, beyond the ERC404 curve roster. The breadth rows are
    ///      addressed by field, not by the roster's name map, because they are not curve rows and
    ///      three are not ERC404 instances.
    struct SeedHandoff {
        uint256 phase2NotBefore;
        address ms2Token;
        address cultToken;
        address ms2Vault;
        address cultVault;
        uint256 ms2TargetId;
        uint256 cultTargetId;
        // ── The alignment roster, in `_alignmentRoster()` order ──
        //
        // The two named pairs above are the roster's first two rows; every collection binds to one of
        // them by name. These arrays carry the whole roster.
        address[] targetTokens;
        address[] targetVaults;
        uint256[] targetIds;
        address[] endowmentVaults; // per roster row; address(0) where the row carries none
        // ── Breadth ──
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
        // ── Venues ──
        //
        // Each venue carries its own alignment target. The registry stores one acquire route per
        // (targetId, token), and a vault refuses to convert unless the route it reads names its own
        // venue, so one target cannot carry a live convert on two venues for the same asset. Each
        // venue gets its own target with a coherent route and its own reference pool.
        uint256 ms2ZammTargetId; // MS2 under a ZAMM route
        address ms2ZammVault;
        address ms2ReferencePool; // Uniswap V3 {MS2, WETH} — price authority for both MS2 targets
        address cultReferencePool; // Uniswap V3 {CULT, WETH} — price authority for CULT's Uni target
        uint256 referenceReadyAt; // when the seeded pools can first serve the deployment's TWAP window
        // ── The featured wall ──
        //
        // The instances that hold a rented slot, in rental order: descending rank, which is the
        // order the home page renders them in.
        address[] featured;
        uint256 featuredSpendWei; // duration cost + rank boost, summed across the slots above
        uint256 featuredDuration; // the duration each slot was rented for
    }

    /// @dev The seed's sender, resolved from `msg.sender` inside `run()` (forge's `--sender`), so the
    ///      same scripts serve a keystore (`--account`) on the live testnet and an unlocked account
    ///      (`--unlocked`) on a fork rehearsal. It must own the deployment's registries.
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

    function _featuredDuration() internal view returns (uint256) {
        return vm.envOr(ENV_FEATURED_DURATION_SECONDS, DEFAULT_FEATURED_DURATION_SECONDS);
    }

    function _featuredRankStep() internal view returns (uint256) {
        return vm.envOr(ENV_FEATURED_RANK_STEP_WEI, DEFAULT_FEATURED_RANK_STEP_WEI);
    }

    /// @dev The rank boost for slot `index` of `count`, descending: the first slot rented outranks
    ///      every later one by one step.
    function _featuredRankBoost(uint256 index, uint256 count) internal view returns (uint256) {
        return _featuredRankStep() * (count - index);
    }

    /// @dev What the whole wall costs at the deployed queue's current `dailyRate`, before any slot
    ///      is rented.
    function _quoteFeaturedSpend(Deployed memory d, uint256 count) internal view returns (uint256 total) {
        uint256 durationCost = d.queue.quoteDurationCost(_featuredDuration());
        for (uint256 i = 0; i < count; i++) {
            total += durationCost + _featuredRankBoost(i, count);
        }
    }

    // ─────────────────────────── The roster, stated once ───────────────────────────

    /// @notice The four curve states the showcase must hold, as one list both phases read.
    ///
    /// @dev Every description states the feature: a stranger learns the product by reading the
    ///      roster, so a description says what the collection demonstrates and what to do with it,
    ///      not a fictional drop.
    ///
    ///      A name riffs on the derivative family the row wears: near enough to credit it, distinct
    ///      enough that nobody reads the row as the collection itself. Lifecycle and mechanism words
    ///      (pre-open, mid, staking, tiers, editions) belong in the description, not the name. The
    ///      slug is the internal key (the salt, the hand-off's map key, the label every log and
    ///      post-condition reads); `name` below is what the app renders.
    ///
    ///      A name is also a registry key, so it carries no spaces.
    ///      `MasterRegistryV1.registerInstance` runs every name through `MetadataUtils.isValidName`,
    ///      which admits only `[0-9A-Za-z-_]`; a space reverts the create for the whole row.
    ///      Capitalization survives (only the uniqueness hash case-folds), so a two-word riff is a
    ///      CamelCase compound rather than hyphenated.
    function _showcaseRoster() internal view returns (ShowcaseLeg[] memory legs) {
        legs = new ShowcaseLeg[](4);

        legs[0] = ShowcaseLeg({
            slug: "ember-preopen",
            title: "SnoredMilady",
            symbol: "SNORED",
            description: "This collection demonstrates the PRE-OPEN state. The curve is armed and the countdown is running, and nothing can be bought until it expires - a buy attempted now is rejected on-chain, not hidden by the interface. Watch what the collection page does as the timer runs down.",
            image: ART_TILE_BOREDMILADY,
            imageDir: ART_IMG_BOREDMILADY,
            pieceBase: ART_BASE_BOREDMILADY,
            state: STATE_PREOPEN,
            declaredMaxBps: 0,
            fillBps: 0,
            pieceIdCoverage: COVER_BOREDMILADY,
            metadataOverlay: false
        });

        legs[1] = ShowcaseLeg({
            slug: "vapor-mid",
            title: "Voxelady",
            symbol: "VOXY",
            description: "This collection demonstrates a LIVE BONDING CURVE part-way through its sale. Each buy mints coin and, in whole units, the pieces that ride it - one asset with two surfaces. Buy into it and watch the price, the piece gallery and the holder list move. It also demonstrates ARTIST METADATA: a piece's picture is resolved on-chain, and the holder chooses which layer shows. The base is the collection's own art. The artist has published an upgraded edition as a WAVE, and any holder can opt into it for free - buy a piece here and you can upgrade it yourself. Some pieces additionally carry a COMMISSION the artist has priced: its holder can pay, on-chain, to have that piece replaced with a rarer one-off. One piece on this row wears each, so all three are on the page at once",
            image: ART_TILE_PIXELADY,
            imageDir: ART_IMG_PIXELADY,
            pieceBase: ART_BASE_PIXELADY,
            state: STATE_MID_CURVE,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_MID_FILL_BPS, uint256(400)),
            pieceIdCoverage: COVER_PIXELADY,
            metadataOverlay: true
        });

        legs[2] = ShowcaseLeg({
            slug: "cinder-ready",
            title: "Figmenta",
            symbol: "FIGM",
            description: "This collection demonstrates the READY-TO-GRADUATE state. The curve is open, matured and holds a raise, so the graduation action is live and uncrossed - the collection is one call away from opening a Uniswap V4 pool. The creator declared a carve allowance up front, which the page shows before you buy.",
            image: ART_TILE_FIGMATA,
            imageDir: ART_IMG_FIGMATA,
            pieceBase: ART_BASE_FIGMATA,
            state: STATE_READY,
            declaredMaxBps: 5000,
            fillBps: vm.envOr(ENV_READY_FILL_BPS, uint256(700)),
            pieceIdCoverage: COVER_FIGMATA,
            metadataOverlay: false
        });

        legs[3] = ShowcaseLeg({
            slug: "flare-graduated",
            title: "Shrimpsters",
            symbol: "SHRMP",
            description: "This collection demonstrates the GRADUATED state. Its curve has closed and the raise opened a real Uniswap V4 pool, so the coin now trades on the venue instead of on the curve - and 19 percent of the raise went to the alignment vault by contract. Trade it, then read the graduation on-chain.",
            image: ART_TILE_LAWBSTERS,
            imageDir: ART_IMG_LAWBSTERS,
            pieceBase: ART_BASE_LAWBSTERS,
            state: STATE_GRADUATED,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_GRADUATED_FILL_BPS, uint256(700)),
            pieceIdCoverage: COVER_LAWBSTERS,
            metadataOverlay: false
        });

        // The art is checked where the roster is built: a row whose directory cannot answer for every
        // id the row can mint is named before anything is created on chain.
        for (uint256 i = 0; i < legs.length; i++) {
            _assertPieceBase(legs[i].pieceBase, legs[i].slug);
            _assertPieceCoverage(legs[i].pieceIdCoverage, SHOWCASE_NFT_COUNT, legs[i].slug);
            _assertTileArt(legs[i].image, legs[i].imageDir, legs[i].slug);
        }
    }

    // ─────────────────────────── Address loading ───────────────────────────

    function _readDeployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile(DEPLOYMENT_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        require(chainId == SEPOLIA_CHAIN_ID, "sepolia.json: not a Sepolia deployment file");

        d.erc404 = ERC404Factory(payable(vm.parseJsonAddress(json, ".factories.ERC404")));
        d.uniVaultFactory = vm.parseJsonAddress(json, ".factories.UNI");
        d.aaveVaultFactory = vm.parseJsonAddress(json, ".factories.AAVE");
        d.masterRegistry = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.componentRegistry = vm.parseJsonAddress(json, ".contracts.ComponentRegistry");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.priceValidator = vm.parseJsonAddress(json, ".contracts.UniswapVaultPriceValidator");
        d.protocolTreasury = vm.parseJsonAddress(json, ".contracts.ProtocolTreasury");
        d.zRouter = vm.parseJsonAddress(json, ".contracts.zRouter");
        d.zQuoter = vm.parseJsonAddress(json, ".contracts.zQuoter");
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
        d.v4PoolManager = vm.parseJsonAddress(json, ".uniswap.v4PoolManager");
        // WETH is not in the deployment file; the vault factory carries it as an immutable, so it is
        // read back off the factory rather than redeclared.
        d.weth = IWethSource(d.uniVaultFactory).weth();

        // ── Breadth: the other two factories and the optional modules ──
        d.erc1155 = ERC1155Factory(payable(vm.parseJsonAddress(json, ".factories.ERC1155")));
        d.erc721 = ERC721AuctionFactory(payable(vm.parseJsonAddress(json, ".factories.ERC721")));
        d.merkleGating = vm.parseJsonAddress(json, ".contracts.ModuleMerkleGating");
        d.stakingModule = vm.parseJsonAddress(json, ".contracts.ERC404StakingModule");
        d.resolverRouter = vm.parseJsonAddress(json, ".contracts.MetadataResolverRouter");
        d.overlay = vm.parseJsonAddress(json, ".contracts.MetadataOverlayModule");
        d.tierResolver = vm.parseJsonAddress(json, ".contracts.TokenTierBandResolver");

        // ── Venues: the LP modules the deploy publishes ──
        d.zammDeployer = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        _readVenueHandoff(d);

        require(address(d.erc404) != address(0), "sepolia.json: ERC404 factory missing");
        require(d.uniVaultFactory != address(0), "sepolia.json: UNI vault factory missing");
        require(d.uniDeployer != address(0), "sepolia.json: ModuleUniV4Deployer missing (stale deployment file?)");
        require(d.v4PoolManager != address(0), "sepolia.json: v4PoolManager missing");

        // Each breadth module is required: discovering a missing one at the first `createInstance`
        // would leave a half-seeded deployment.
        require(address(d.erc1155) != address(0), "sepolia.json: ERC1155 factory missing");
        require(address(d.erc721) != address(0), "sepolia.json: ERC721 factory missing");
        require(d.merkleGating != address(0), "sepolia.json: ModuleMerkleGating missing");
        require(d.stakingModule != address(0), "sepolia.json: ERC404StakingModule missing");
        require(d.resolverRouter != address(0), "sepolia.json: MetadataResolverRouter missing");
        require(d.overlay != address(0), "sepolia.json: MetadataOverlayModule missing");
        require(d.tierResolver != address(0), "sepolia.json: TokenTierBandResolver missing");
        // The featured queue is required: the home page reads its placements.
        require(address(d.queue) != address(0), "sepolia.json: FeaturedQueueManager missing");
        // Required: the seed posts the showcase's activity, and without the registry every activity
        // surface stays empty after an otherwise-successful seed.
        require(address(d.messages) != address(0), "sepolia.json: GlobalMessageRegistry missing");
    }

    /// @dev The venue addresses `DeploySepolia` wrote beside the deployment file: the vault factory
    ///      the seed deploys ZAMM vaults from (its alignment assets are fixtures that do not exist at
    ///      deploy time), plus the plain externals the venue legs ride. Read from a Sepolia-local file
    ///      so the cross-network `DeployCore` keeps one output shape.
    ///
    ///      A zero here is a state, not a failure: a network may carry no ZAMM. The seed reports the
    ///      venue as unavailable and continues.
    function _readVenueHandoff(Deployed memory d) internal view {
        if (!vm.exists(VENUE_PATH)) {
            console.log("VENUES: no", VENUE_PATH, "- the ZAMM leg will be reported unavailable");
            return;
        }
        string memory json = vm.readFile(VENUE_PATH);
        require(
            vm.parseJsonUint(json, ".chainId") == block.chainid,
            "sepolia-venues.json: wrong chainId (stale file from another chain?)"
        );
        d.zammVaultFactory = vm.parseJsonAddress(json, ".zammVaultFactory");
        d.v3Factory = vm.parseJsonAddress(json, ".v3Factory");
        d.zamm = vm.parseJsonAddress(json, ".zamm");
        d.zammFeeOrHook = vm.parseJsonUint(json, ".zammFeeOrHook");
        require(d.v3Factory != address(0), "sepolia-venues.json: v3Factory missing (no reference pool can be stood up)");
    }

    function _zammAvailable(Deployed memory d) internal pure returns (bool) {
        return d.zammVaultFactory != address(0) && d.zamm != address(0) && d.zammFeeOrHook != 0;
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
        vm.serializeAddress(root, "targetTokens", h.targetTokens);
        vm.serializeAddress(root, "targetVaults", h.targetVaults);
        vm.serializeUint(root, "targetIds", h.targetIds);
        vm.serializeAddress(root, "endowmentVaults", h.endowmentVaults);
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
        // ── Venues ──
        vm.serializeUint(root, "ms2ZammTargetId", h.ms2ZammTargetId);
        vm.serializeAddress(root, "ms2ZammVault", h.ms2ZammVault);
        vm.serializeAddress(root, "ms2ReferencePool", h.ms2ReferencePool);
        vm.serializeAddress(root, "cultReferencePool", h.cultReferencePool);
        vm.serializeUint(root, "referenceReadyAt", h.referenceReadyAt);
        // ── The featured wall, in rendered order ──
        vm.serializeAddress(root, "featured", h.featured);
        vm.serializeUint(root, "featuredSpendWei", h.featuredSpendWei);
        vm.serializeUint(root, "featuredDuration", h.featuredDuration);
        vm.serializeAddress(root, "all", instances);
        string memory out = vm.serializeString(root, "instances", instancesJson);

        vm.writeJson(out, SEED_STATE_PATH);
        console.log("Wrote seed state:", SEED_STATE_PATH);
    }

    /// @dev Resolve the roster by name out of the hand-off file, in roster order.
    function _readSeedState(ShowcaseLeg[] memory legs)
        internal
        view
        returns (address[] memory instances, SeedHandoff memory h)
    {
        string memory json = vm.readFile(SEED_STATE_PATH);
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        // A hand-off file from a different chain (a fork rehearsal, an earlier deployment) points at
        // addresses that hold no code here; fail at the boundary.
        require(chainId == block.chainid, "sepolia-seed.json: wrong chainId (stale file from another chain?)");

        h.phase2NotBefore = vm.parseJsonUint(json, ".phase2NotBefore");
        h.ms2Token = vm.parseJsonAddress(json, ".ms2Token");
        h.cultToken = vm.parseJsonAddress(json, ".cultToken");
        h.ms2Vault = vm.parseJsonAddress(json, ".ms2Vault");
        h.cultVault = vm.parseJsonAddress(json, ".cultVault");
        h.ms2TargetId = vm.parseJsonUint(json, ".ms2TargetId");
        h.cultTargetId = vm.parseJsonUint(json, ".cultTargetId");
        h.targetTokens = vm.parseJsonAddressArray(json, ".targetTokens");
        h.targetVaults = vm.parseJsonAddressArray(json, ".targetVaults");
        h.targetIds = vm.parseJsonUintArray(json, ".targetIds");
        h.endowmentVaults = vm.parseJsonAddressArray(json, ".endowmentVaults");

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
        // ── Venues. Zeros are legal: a venue whose rail this network does not carry is reported
        //    unavailable in phase 1 and skipped, not asserted, in phase 2.
        h.ms2ZammTargetId = vm.parseJsonUint(json, ".ms2ZammTargetId");
        h.ms2ZammVault = vm.parseJsonAddress(json, ".ms2ZammVault");
        h.ms2ReferencePool = vm.parseJsonAddress(json, ".ms2ReferencePool");
        h.cultReferencePool = vm.parseJsonAddress(json, ".cultReferencePool");
        h.referenceReadyAt = vm.parseJsonUint(json, ".referenceReadyAt");
        _requireBreadthHandoff(h);

        instances = new address[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            // Bracket-quoted: the slugs carry hyphens, which a dotted JSON path splits on.
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
    // The cost is computed with the same library the instance charges with, so `maxCost == value ==
    // cost` and a buy never reverts on a bound the seed chose. There is no buy-side fee (the
    // protocol fee is taken on exit), so the value is the curve price exactly.

    function _buyCost(ERC404BondingInstance b, uint256 amount) internal view returns (uint256) {
        return BondingCurveMath.calculateCost(_curveParams(b), b.totalBondingSupply(), amount);
    }

    /// @dev Buy `amount` tokens, minting the pieces the whole units carry. Reverts `TooEarly` unless
    ///      the chain has passed the instance's open time, so every caller is in phase 2.
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
    // These are `require`s, not logs: forge simulates an entire script before broadcasting any of
    // it, so a failed post-condition is a named failure with no partial seed.
    //
    // They take an interface so the identical function is exercised by a unit test against a stub
    // with settable state (`test/coverage/SepoliaShowcasePostConditions.t.sol`), which shows that
    // removing the graduation, the maturity or the raise fails them.

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
                // The pre-open row must be unbought and unopened: an open time still in the future is
                // what makes `buyBonding` revert `TooEarly` on-chain, as the description promises.
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
                // Ready-to-graduate is open, matured and holding a raise; without any one the graduate
                // action is unreachable. `deployLiquidity` reverts `NoReserve` on a zero raise.
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
    // A seeded collection whose art does not render is a failed seed. A per-piece base composes as
    // `base + tokenId` with no separator, so a base missing its trailing slash addresses `<cid>7`
    // instead of `<cid>/7`, and one carrying two produces `//7`.

    function _assertPieceBase(string memory base, string memory label) internal pure {
        bytes memory b = bytes(base);
        require(b.length > 8, string.concat("art: ", label, " has no per-piece base URI"));
        require(_startsWith(base, "ipfs://"), string.concat("art: ", label, " base is not content-addressed"));
        require(b[b.length - 1] == "/", string.concat("art: ", label, " base has no trailing slash"));
        require(b[b.length - 2] != "/", string.concat("art: ", label, " base ends in a double slash"));
        require(!_contains(base, "TODO"), string.concat("art: ", label, " base still carries a placeholder"));
        _assertNotRetiredArt(base, label);
    }

    /// @dev No URI this seed configures may point into a denylisted directory (the `RETIRED_DIR_*`
    ///      constants); a base or tile carrying one fails by name at simulation time, before anything
    ///      is created on chain.
    function _assertNotRetiredArt(string memory uri, string memory label) internal pure {
        require(
            !_contains(uri, RETIRED_DIR_ANIME) && !_contains(uri, RETIRED_DIR_ARCTIC)
                && !_contains(uri, RETIRED_DIR_SIMIAN) && !_contains(uri, RETIRED_DIR_DOODLE)
                && !_contains(uri, RETIRED_DIR_SHARED_TILE),
            string.concat("art: ", label, " points into a retired directory")
        );
    }

    /// @dev A row mints piece ids 1..`minted`, and `base + tokenId` resolves only for ids the
    ///      directory carries. A shorter directory renders the tail of the collection blank, so the
    ///      reach of the art is asserted against the count.
    function _assertPieceCoverage(uint256 covered, uint256 minted, string memory label) internal pure {
        require(
            covered >= minted,
            string.concat("art: ", label, " metadata directory does not cover every id the row can mint")
        );
    }

    /// @dev The collection tile must come from the row's own family: a tile from any other directory
    ///      puts one collection's image over another's pieces, and a wall of tiles from one place
    ///      reads as a single uniform set.
    function _assertTileArt(string memory image, string memory imageDir, string memory label) internal pure {
        bytes memory b = bytes(image);
        require(b.length > 8, string.concat("art: ", label, " has no collection tile"));
        require(_startsWith(image, "ipfs://"), string.concat("art: ", label, " tile is not content-addressed"));
        require(b[b.length - 1] != "/", string.concat("art: ", label, " tile points at a directory, not a file"));
        require(
            _startsWith(imageDir, "ipfs://") && bytes(imageDir)[bytes(imageDir).length - 1] == "/",
            string.concat("art: ", label, " declares no image directory to hold its tile against")
        );
        require(
            _startsWith(image, imageDir),
            string.concat("art: ", label, " tile does not come from the row's own collection")
        );
        _assertNotRetiredArt(image, label);
    }

    /// @dev The highest piece id the tier row can address. Ordinary ids run 1..`TIER_NFT_COUNT`, and
    ///      the two sealed bands are allocated above that ceiling, one id per unit of band count, so
    ///      this is the largest id the band directories answer for.
    uint256 internal constant TIER_MAX_ADDRESSABLE_ID = TIER_NFT_COUNT + TIER_OPEN_COUNT + TIER_SCARCE_COUNT;

    /// @dev The breadth rows' art, held to the same rules as the roster's and run before phase 1
    ///      creates anything. The ERC-1155 edition rows and the ERC-721 auction houses compose
    ///      per-piece `data:` documents rather than a base + id, so for them the check is that every
    ///      picture they name comes from their own family.
    function _assertBreadthArt() internal pure {
        // Editions: one family across the collection tile and all three edition pictures.
        _assertTileArt(ART_TILE_ATLAS, ART_IMG_RADBRO, "atlas-editions");
        _assertTileArt(ART_PIECE_ATLAS_FIXED, ART_IMG_RADBRO, "atlas-editions fixed");
        _assertTileArt(ART_PIECE_ATLAS_RISING, ART_IMG_RADBRO, "atlas-editions rising");
        _assertTileArt(ART_PIECE_ATLAS_CLAIM, ART_IMG_RADBRO, "atlas-editions claim");

        // The gated row.
        _assertTileArt(ART_TILE_VEIL, ART_IMG_MFERS, "veil-list");
        _assertTileArt(ART_PIECE_VEIL_PASS, ART_IMG_MFERS, "veil-list pass");

        // Staking: an ERC404 row, so its base must reach every id the row can mint.
        _assertTileArt(ART_TILE_QUARRY, ART_IMG_MILADYSTATION, "quarry-staking");
        _assertPieceBase(ART_BASE_MILADYSTATION, "quarry-staking");
        _assertPieceCoverage(COVER_MILADYSTATION, SHOWCASE_NFT_COUNT, "quarry-staking");

        // Tiers: one family's lineage across three directories. The base answers for the ordinary
        // ids; the two band directories answer for ids up to the band ceiling, the highest id
        // anything on this row can address.
        _assertTileArt(ART_TILE_PRISM, ART_IMG_SONORA, "prism-tiers");
        _assertPieceBase(ART_BASE_SONORA, "prism-tiers base");
        _assertPieceBase(ART_BASE_SONORA222, "prism-tiers open band");
        _assertPieceBase(ART_BASE_SCHIZO, "prism-tiers scarce band");
        _assertPieceCoverage(COVER_SONORA, TIER_NFT_COUNT, "prism-tiers base");
        _assertPieceCoverage(COVER_SONORA222, TIER_MAX_ADDRESSABLE_ID, "prism-tiers open band");
        _assertPieceCoverage(COVER_SCHIZO, TIER_MAX_ADDRESSABLE_ID, "prism-tiers scarce band");
        // The rungs must be tellable apart or the precedence stack demonstrates nothing.
        require(!_eq(ART_BASE_SONORA, ART_BASE_SONORA222), "art: prism-tiers open band repeats the base directory");
        require(!_eq(ART_BASE_SONORA, ART_BASE_SCHIZO), "art: prism-tiers scarce band repeats the base directory");
        require(!_eq(ART_BASE_SONORA222, ART_BASE_SCHIZO), "art: prism-tiers bands repeat one another");

        // The carve row.
        _assertTileArt(ART_TILE_CARVE, ART_IMG_GHIBLADY, "carve-demo");
        _assertPieceBase(ART_BASE_GHIBLADY, "carve-demo");
        _assertPieceCoverage(COVER_GHIBLADY, SHOWCASE_NFT_COUNT, "carve-demo");

        // The two auction houses.
        _assertTileArt(ART_TILE_RELIC, ART_IMG_MEOWLADY, "relic-line");
        _assertTileArt(ART_PIECE_RELIC_I, ART_IMG_MEOWLADY, "relic-line lot I");
        _assertTileArt(ART_PIECE_RELIC_II, ART_IMG_MEOWLADY, "relic-line lot II");
        _assertTileArt(ART_TILE_SALON, ART_IMG_COLOMBIA, "salon-line");
        _assertTileArt(ART_PIECE_SALON_I, ART_IMG_COLOMBIA, "salon-line lot I");

        _assertDistinctFamilies();
    }

    /// @dev One family per row, across the whole seed: two rows on the same directory would show the
    ///      same collection twice on the wall. Held over the image directories, which the featured
    ///      grid displays.
    function _assertDistinctFamilies() internal pure {
        string[12] memory dirs = [
            ART_IMG_PIXELADY,
            ART_IMG_BOREDMILADY,
            ART_IMG_FIGMATA,
            ART_IMG_LAWBSTERS,
            ART_IMG_RADBRO,
            ART_IMG_MILADYSTATION,
            ART_IMG_MFERS,
            ART_IMG_MEOWLADY,
            ART_IMG_COLOMBIA,
            ART_IMG_SONORA,
            ART_IMG_GHIBLADY,
            ART_IMG_ELITE
        ];
        for (uint256 i = 0; i < dirs.length; i++) {
            for (uint256 j = i + 1; j < dirs.length; j++) {
                require(
                    keccak256(bytes(dirs[i])) != keccak256(bytes(dirs[j])),
                    "art: two rows wear the same collection - every row on this seed is its own family"
                );
            }
        }
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
    ///      image is a plain `ipfs://` pointer.
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

    /// @dev Print what a phase is about to spend before it spends it. On a public testnet the ETH is
    ///      a faucet balance, so the number is visible at simulation time, before `--broadcast`.
    function _reportSpend(string memory phase, uint256 curveEth, uint256 featuredEth, uint256 balanceBefore)
        internal
        pure
    {
        console.log("--------------------------------------------------");
        console.log(string.concat("ETH projection - ", phase));
        console.log("  curve spend (wei):", curveEth);
        // Featured placement is rented per day, so this line moves with a duration, not a fill. It
        // is the wall's whole cost: rent plus rank.
        console.log("  featured placement (wei):", featuredEth);
        console.log("  deployer balance before (wei):", balanceBefore);
        console.log("  gas is NOT included above - it is charged per broadcast tx by forge");
        console.log("--------------------------------------------------");
    }

    // ─────────────────────────── The activity the showcase carries ───────────────────────────
    //
    // Three app surfaces render nothing but `MessagePosted` events: the home page's recent activity
    // preview, each collection page's activity section, and the board. Seeding posts keeps them
    // off their empty state.
    //
    // Every line states a feature of the surface it sits on, in the register of the roster's
    // descriptions: what the mechanism does and what to do with it. No personas or roleplayed
    // drops. The lines are constants so the whole set is reviewable in one place.
    //
    // Every message carries zero attached ETH, so activity adds no ETH to either phase's
    // projection and costs gas for one broadcast transaction, because the registry takes the whole
    // set through `postBatch`. The spam threshold (`postThreshold`) is zero on this deployment, so
    // a zero-value post surfaces on every feed.

    /// @dev One channel's seeded activity: the address a post is filed under, the label the run log
    ///      names it by, and the two lines it carries.
    struct ActivityChannel {
        address channel;
        string label;
        string first;
        string second;
    }

    /// @dev Everything beyond the two lines each channel carries: the salon's own posts and the
    ///      reply / quote / reaction of each kind. Counted so the batch is allocated at its exact size.
    uint256 internal constant ACTIVITY_EXTRA_MESSAGES = 9;

    /// @dev The eleven collection channels, in the order the run log prints them.
    function _activityChannels(ShowcaseLeg[] memory legs, address[] memory instances, SeedHandoff memory h)
        internal
        pure
        returns (ActivityChannel[] memory chans)
    {
        chans = new ActivityChannel[](11);
        uint256 n;

        chans[n++] = ActivityChannel({
            channel: instances[0],
            label: legs[0].slug,
            first: "the countdown is the contract's, not this page's. a buy before it expires is rejected on-chain.",
            second: "a pre-open row still takes messages. the activity feed is not gated on the curve being open."
        });
        chans[n++] = ActivityChannel({
            channel: instances[1],
            label: legs[1].slug,
            first: "mid-curve. every buy moves the price, and in whole units it mints the pieces that ride the coin.",
            second: "the gallery fills as the curve fills. one asset, two surfaces - coin and pieces, same balance."
        });
        chans[n++] = ActivityChannel({
            channel: instances[2],
            label: legs[2].slug,
            first: "open, matured, and holding a raise. graduation is live and uncrossed - the action on the page does it.",
            second: "the carve allowance was declared before the first buy, and it is immutable. read it above."
        });
        chans[n++] = ActivityChannel({
            channel: instances[3],
            label: legs[3].slug,
            first: "the curve closed and the raise opened a uniswap v4 pool. the coin trades on the venue now.",
            second: "part of the raise went to the alignment vault by contract, not by promise. the split is on-chain."
        });
        chans[n++] = ActivityChannel({
            channel: h.editions,
            label: "atlas-editions",
            first: "three editions on one contract: one at a fixed price, one priced dynamically, one free to claim.",
            second: "supply is capped per edition, not per collection. each edition sells and sells out on its own."
        });
        chans[n++] = ActivityChannel({
            channel: h.gatedEditions,
            label: "veil-list",
            first: "this edition sits behind a merkle allowlist. an address that is not on it is refused on-chain.",
            second: "the list opens in tiers. each tier carries its own root and its own open time."
        });
        chans[n++] = ActivityChannel({
            channel: h.staking404,
            label: "quarry-staking",
            first: "staking is wired to the fee stream. stake the coin and the reward accrues per second, not per claim.",
            second: "unstaking is not a lock-up: the stream stops and the principal comes back the same call."
        });
        chans[n++] = ActivityChannel({
            channel: h.tiers404,
            label: "prism-tiers",
            first: "the ids are banded. an open band and a scarce band, each sealed at its count when the row was created.",
            second: "mint up into a band or back down out of it. the move is reversible and priced by the band."
        });
        chans[n++] = ActivityChannel({
            channel: h.carve404,
            label: "carve-demo",
            first: "the creator declared a maximum carve before the first buy. that number cannot be raised afterwards.",
            second: "at graduation the carve comes out of the raise, up to the declared cap and no further."
        });
        chans[n++] = ActivityChannel({
            channel: h.auctionTimed,
            label: "relic-line",
            first: "two timed lots ran here: one closed with a bid and was settled, one closed with none and was reclaimed.",
            second: "settle and reclaim are both on-chain actions. neither state is something this page decides."
        });
        chans[n++] = ActivityChannel({
            channel: h.auctionLive,
            label: "salon-line",
            first: "this lot is still running. bid on it and watch the high bidder and the end time move.",
            second: "a bid does not extend the clock by itself - the end time is the one the lot was created with."
        });

        require(n == chans.length, "activity: channel set is not the size it was allocated at");
        for (uint256 i = 0; i < chans.length; i++) {
            require(
                chans[i].channel != address(0), string.concat("activity: ", chans[i].label, " has no channel address")
            );
        }
    }

    /// @dev Post the showcase's activity as one batch. `postBatch` emits sequential message ids
    ///      starting at the registry's current `messageCount`, so the id a reply / quote / reaction
    ///      points at is computable before the batch is sent, and one transaction carries a threaded
    ///      conversation.
    ///
    ///      Order is a display decision: the home preview renders the last few messages, so the batch
    ///      ends on the salon's posts, a reply and a quote, with one reaction so the preview shows a
    ///      typed badge too.
    function _seedActivity(
        Deployed memory d,
        ShowcaseLeg[] memory legs,
        address[] memory instances,
        SeedHandoff memory h
    ) internal returns (uint256 posted) {
        ActivityChannel[] memory chans = _activityChannels(legs, instances, h);

        uint256 base = d.messages.messageCount();
        GlobalMessageRegistry.PostParams[] memory posts =
            new GlobalMessageRegistry.PostParams[](chans.length * 2 + ACTIVITY_EXTRA_MESSAGES);

        uint256 n;
        uint256 midCurveAnchor;
        uint256 graduatedAnchor;
        for (uint256 i = 0; i < chans.length; i++) {
            if (i == 1) midCurveAnchor = base + n;
            if (i == 3) graduatedAnchor = base + n;
            posts[n++] = _activityPost(chans[i].channel, chans[i].first);
            posts[n++] = _activityPost(chans[i].channel, chans[i].second);
        }

        // Endorsements carry no text: the app aggregates them into a count against the message they
        // target and never renders them as a row.
        posts[n++] = _activityReact(chans[1].channel, midCurveAnchor);
        posts[n++] = _activityReact(chans[3].channel, graduatedAnchor);
        // A reply rides the same channel as the message it answers, which puts it in that
        // collection's own feed.
        posts[n++] = _activityReply(
            chans[1].channel, midCurveAnchor, "a reply carries the id of the post it answers. it threads under it here."
        );

        // The salon: posts filed under the poster's own address, as the board's composer writes
        // them; it is the channel the board opens on.
        uint256 salonAnchor = base + n;
        posts[n++] = _activityPost(
            deployer, "the board is every channel at once. a post with no collection lands here, on the poster's wall."
        );
        posts[n++] = _activityPost(
            deployer, "the chips above filter the board down to one collection, and the count beside each one is live."
        );
        posts[n++] = _activityPost(
            deployer,
            "a post can carry eth. the threshold that hides cheap posts is an owner setting, and it is zero here."
        );
        posts[n++] = _activityReact(deployer, salonAnchor);
        posts[n++] = _activityReply(
            deployer,
            salonAnchor,
            "on-chain the board is flat: one event per message. the threading is done when it is read."
        );
        posts[n++] = _activityQuote(
            deployer,
            graduatedAnchor,
            "a quote lifts the message it names into a thread of its own instead of nesting under it."
        );

        require(n == posts.length, "activity: batch is not the size it was allocated at");

        vm.startBroadcast();
        d.messages.postBatch(posts);
        vm.stopBroadcast();

        posted = posts.length;

        // Asserted against the registry: the batch is the only writer in this transaction, so the
        // counter advances by exactly its size.
        require(d.messages.messageCount() == base + posted, "activity: the registry did not record the whole batch");

        console.log("--------------------------------------------------");
        console.log("ACTIVITY seeded (one postBatch transaction)");
        console.log("  channels posted to:", chans.length);
        console.log("  messages emitted:", posted);
        console.log("  first message id:", base);
        console.log("  eth attached (wei): 0 - this wave costs gas only");
        console.log("--------------------------------------------------");
        console.log("ACTIVITY post-conditions OK");
    }

    function _activityPost(address channel, string memory content)
        private
        pure
        returns (GlobalMessageRegistry.PostParams memory)
    {
        return _activityMessage(channel, MessageTypes.POST, 0, content);
    }

    function _activityReply(address channel, uint256 refId, string memory content)
        private
        pure
        returns (GlobalMessageRegistry.PostParams memory)
    {
        return _activityMessage(channel, MessageTypes.REPLY, refId, content);
    }

    function _activityQuote(address channel, uint256 refId, string memory content)
        private
        pure
        returns (GlobalMessageRegistry.PostParams memory)
    {
        return _activityMessage(channel, MessageTypes.QUOTE, refId, content);
    }

    function _activityReact(address channel, uint256 refId)
        private
        pure
        returns (GlobalMessageRegistry.PostParams memory)
    {
        return _activityMessage(channel, MessageTypes.REACT, refId, "");
    }

    function _activityMessage(address channel, uint8 messageType, uint256 refId, string memory content)
        private
        pure
        returns (GlobalMessageRegistry.PostParams memory)
    {
        return GlobalMessageRegistry.PostParams({
            instance: channel,
            messageType: messageType,
            refId: refId,
            actionRef: bytes32(0),
            metadata: bytes32(0),
            value: 0,
            content: content
        });
    }

    /// @dev Create helper shared by phase 1's rows, stating once the parameters a row does not vary
    ///      (owner, preset, piece count, gating, free mint).
    ///
    ///      `name` is the row's display name and `salt` is derived from the slug, so the hand-off key
    ///      is independent of the displayed name.
    function _createShowcaseInstance(Deployed memory d, ShowcaseLeg memory leg, address vault)
        internal
        returns (address instance)
    {
        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: keccak256(abi.encode(block.timestamp, leg.slug, "ERC404-SEPOLIA")),
            name: leg.title,
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
        if (!leg.metadataOverlay) {
            instance = d.erc404
                .createInstance(
                    params,
                    _collectionMeta(leg.title, leg.description, leg.image),
                    d.uniDeployer,
                    address(0), // no gating on the spine rows
                    FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
                );
            return instance;
        }

        // The artist metadata row, created through the factory's metadata overload so the overlay is
        // sealed onto the instance in the creating transaction. No tier pointer and an empty ladder:
        // Token Tiers is the other demonstration's, and `_wireMetadata` rejects a tier module wired
        // with no bands. The router carries one child, so the precedence shown is the overlay's own:
        // a holder's selection between the paid commission, the artist's wave and the collection base.
        instance = d.erc404
            .createInstance(
                params,
                _collectionMeta(leg.title, leg.description, leg.image),
                d.uniDeployer,
                address(0), // no gating on the spine rows
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                ERC404Factory.MetadataConfig({
                    resolver: d.resolverRouter,
                    childResolvers: _oneChild(d.overlay),
                    overlay: d.overlay,
                    tier: address(0),
                    tiers: new ERC404Factory.TierSpec[](0),
                    autoLatest: false, // opt-in waves: a holder chooses the layer, nothing switches under them
                    defaultPayout: MetadataOverlayModule.Payout.ARTIST
                })
            );
    }

    /// @dev A one-element child list for the create call above.
    function _oneChild(address child) internal pure returns (address[] memory children) {
        children = new address[](1);
        children[0] = child;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                        THE OTHER PROJECT TYPES AND MECHANISMS
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // The spine above holds the four ERC404 curve states. Everything below holds the rest: editions
    // with three pricing regimes, an allowlist, staking, the metadata stack, Token Tiers, auctions
    // in three states, and the creator carve. Descriptions state the feature, and every claimed
    // outcome is a `require`.

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
        // 3 units reach the scarce band, 2 the open band, and 1 stays liquid to carry the commission
        // the overlay is authored on; below that the phase-2 walk cannot complete.
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

    /// @dev The ids the artist pre-authors commission offers on, above the pieces the seed keeps.
    ///
    ///      `unlock` is holder-gated, so an offer on a piece the seed holds can only be paid by the
    ///      seed. `setCommission` has no existence check, so the artist authors offers on ids before
    ///      they are minted; the next buyer into this row receives a piece with an offer already
    ///      waiting and can pay it as its holder.
    ///
    ///      The ids clear the pieces the seed keeps and skip the ids whose commission art is
    ///      unavailable (see `_commissionArtMissing`).
    function _commissionOfferIds() internal pure returns (uint256[] memory ids) {
        ids = new uint256[](6);
        ids[0] = 10;
        ids[1] = 11;
        ids[2] = 13;
        ids[3] = 14;
        ids[4] = 15;
        ids[5] = 16;
    }

    /// @dev The `selection` pointer that means "wave 0": `MetadataOverlayModule.WAVE_OFFSET` plus the
    ///      index of the only wave this seed publishes. The module's offset is `internal`, so this
    ///      mirrors it; the seed checks the mirror by requiring the selection to resolve to the
    ///      wave's own art right after making it.
    uint256 internal constant OVERLAY_WAVE_0 = 3;

    /// @dev How many pieces the artist metadata demonstration consumes: one wearing the artist's
    ///      wave, one wearing a paid commission, and one carrying an unpaid commission as the live
    ///      action. The row must hold at least this many.
    uint256 internal constant METADATA_DEMO_PIECES = 3;

    /// @dev Steps a vault's deterministic address past a CREATE3 collision. The vault salt is keyed
    ///      on the token, but any deterministic address can collide with a chain it does not control
    ///      (CreateX reverts `FailedContractCreation` on an address that already holds code); a
    ///      collision is resolved by re-running with this variable set.
    string internal constant ENV_VAULT_SALT_NONCE = "SEPOLIA_VAULT_SALT_NONCE";

    function _vaultSaltNonce() internal view returns (uint256) {
        return vm.envOr(ENV_VAULT_SALT_NONCE, uint256(0));
    }

    /// @dev The WOTLK ids whose art is unavailable, on which a commission must not be authored.
    ///
    ///      The expansion set was recovered CID-preserving: 149/150 images and 110/150 metadata files
    ///      verify against the collection's own per-file CIDs; the rest are unreachable. The holes are
    ///      not at the end (ids 2 and 4-9 are among them), hence a list rather than a ceiling.
    ///
    ///      The wave does not ride this collection: a wave is published to the whole collection and
    ///      opted into on any id, so it needs art for every id a row can mint, whereas a commission
    ///      needs art only for the ids the artist names. The wave rides the fully recovered edition
    ///      and the commission rides this one.
    function _commissionArtMissing(uint256 id) internal pure returns (bool) {
        if (id == 0 || id > COVER_WOTLK) return true;
        uint16[41] memory holes = [
            uint16(2),
            4,
            5,
            6,
            7,
            8,
            9,
            12,
            19,
            20,
            24,
            28,
            29,
            33,
            46,
            77,
            85,
            90,
            100,
            101,
            102,
            105,
            106,
            107,
            110,
            111,
            112,
            113,
            114,
            115,
            116,
            117,
            118,
            119,
            120,
            121,
            122,
            123,
            124,
            125,
            135
        ];
        for (uint256 i = 0; i < holes.length; i++) {
            if (holes[i] == id) return true;
        }
        return false;
    }

    /// @dev The timed auction's lots end inside the wait phase 2 performs, so their duration is the
    ///      arm window. The floor keeps the anti-snipe buffer from dominating: a bid within
    ///      `AUCTION_TIME_BUFFER` of the end extends the lot, which would push the settle past the
    ///      instant the orchestrator waits for.
    function _timedAuctionSeconds() internal view returns (uint256) {
        uint256 window = _armWindow();
        require(
            window >= MIN_ARM_WINDOW_FOR_AUCTIONS,
            "arm window: too short to also carry the timed auction (raise SEPOLIA_ARM_WINDOW_SECONDS)"
        );
        return window;
    }

    // ══════════════════════════ VENUE KNOBS AND WIRING ══════════════════════════

    function _v4DepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_V4_DEPTH_WEI, DEFAULT_V4_DEPTH_WEI);
    }

    function _referenceDepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_REFERENCE_DEPTH_WEI, DEFAULT_REFERENCE_DEPTH_WEI);
    }

    function _zammDepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_ZAMM_DEPTH_WEI, DEFAULT_ZAMM_DEPTH_WEI);
    }

    function _zammVaultTitheWei() internal view returns (uint256) {
        return vm.envOr(ENV_ZAMM_VAULT_TITHE_WEI, DEFAULT_ZAMM_VAULT_TITHE_WEI);
    }

    function _demoSwapWei() internal view returns (uint256) {
        return vm.envOr(ENV_DEMO_SWAP_WEI, DEFAULT_DEMO_SWAP_WEI);
    }

    function _depthHalfWidthTicks() internal view returns (int24) {
        return int24(uint24(vm.envOr(ENV_DEPTH_HALF_WIDTH_TICKS, uint256(uint24(DEFAULT_DEPTH_HALF_WIDTH_TICKS)))));
    }

    /// @dev The TWAP window the deployment's own validator was constructed with, read off the
    ///      validator so the wait this seed imposes and the window the registry probes with are the
    ///      same number.
    function _twapWindow(Deployed memory d) internal view returns (uint32) {
        return ITwapWindowSource(d.priceValidator).twapSecondsAgo();
    }

    /// @dev The instant a seeded V3 reference pool can first answer `observe([window, 0])`, derived
    ///      from the observation the pool itself holds.
    ///
    ///      Phase 1 cannot compute this: forge simulates a script at one timestamp and then
    ///      broadcasts, so phase 1 only knows the simulation's instant, while the pool's first
    ///      observation is written when its creating transaction is mined, a broadcast later. A
    ///      phase-1 value would understate readiness by the broadcast's duration, which
    ///      `phase2NotBefore`'s slack (sized for block-time jitter) does not cover. `observe`
    ///      reverts `OLD` for a target older than the oldest stored observation, so the oldest
    ///      observation plus the window is the instant exactly.
    ///
    ///      The oldest observation sits at `index + 1` once the ring has wrapped and at 0 until it
    ///      has; `initialized` distinguishes the two, as in `Oracle.observeSingle`.
    function _v3ReferenceReadyAt(address pool, uint32 window) internal view returns (uint256) {
        (,, uint16 index, uint16 cardinality,,,) = IUniswapV3PoolMinimal(pool).slot0();
        (uint32 oldest,,, bool initialized) = IUniswapV3PoolMinimal(pool).observations((index + 1) % cardinality);
        if (!initialized) (oldest,,,) = IUniswapV3PoolMinimal(pool).observations(0);
        return uint256(oldest) + window;
    }

    /// @dev `_v3ReferenceReadyAt` across every V3 reference pool phase 2 pins, as one instant.
    function _referencePoolsReadyAt(Deployed memory d, SeedHandoff memory h) internal view returns (uint256 readyAt) {
        uint32 window = _twapWindow(d);
        readyAt = _v3ReferenceReadyAt(h.ms2ReferencePool, window);
        uint256 cult = _v3ReferenceReadyAt(h.cultReferencePool, window);
        if (cult > readyAt) readyAt = cult;
    }

    /// @dev The native-ETH/token V4 key every Uni alignment vault in this seed LPs into and acquires
    ///      through. Native ETH is currency0 (address(0) sorts below every token address), and the
    ///      tier is the one `DeployCore` builds vault keys from, which `BestRouteAcquirer` also falls
    ///      back to when no quoter is wired. One pool, named by all three legs.
    function _uniVenueKey(address token) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    /// @dev The ZAMM key `DeployCore` bakes into a ZAMM vault at deploy: native ETH as token0, the
    ///      alignment token as token1, the network's `zammFeeOrHook`. Rebuilt so the pool the seed
    ///      fills is the pool the vault deposits into.
    function _zammVenueKey(address token, uint256 feeOrHook) internal pure returns (IZAMM.PoolKey memory) {
        return IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: token, feeOrHook: feeOrHook });
    }

    /// @dev The pending tithe a vault holds, across the two names the families give it:
    ///      `UniAlignmentVault.totalPendingETH()` and `ZAMMAlignmentVault.pendingETH()`. A vault that
    ///      answers neither is refused rather than read as zero, which would look like no tithe.
    function _pendingTithe(address vault) internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(abi.encodeWithSignature("totalPendingETH()"));
        if (!ok || data.length != 32) {
            (ok, data) = vault.staticcall(abi.encodeWithSignature("pendingETH()"));
        }
        require(ok && data.length == 32, "venue: the vault exposes no pending-tithe read");
        return abi.decode(data, (uint256));
    }

    /// @dev ZAMM's pool id for a key — `keccak256(abi.encode(poolKey))`, the same derivation the
    ///      singleton uses internally, so a reserve read names the pool the seed just filled.
    function _zammPoolId(IZAMM.PoolKey memory key) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(key)));
    }

    // ─────────────────────────── Metadata ───────────────────────────

    /// @dev Backend-free piece metadata: the per-edition JSON an ERC1155 edition carries, shaped as
    ///      `_collectionMeta` (an unencoded `data:` JSON URI pointing at a content-addressed image).
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
    // The seeded allowlist is address-bound: a leaf commits to a wallet and the cap it was listed
    // with, so a stranger cannot enter. No tier a cold visitor can satisfy is seeded, because the
    // only gating module the deployment approves is this one; the tier's own description says so
    // on-chain.
    //
    // The list's second member is a derived fixture address rather than a person's wallet: a
    // single-leaf tree has `root == leaf` and an empty proof, so it would verify without the
    // verifier hashing an internal node. With two members every proof carries a real sibling.

    /// @dev A deterministic, code-free fixture address derived from the deployment's own sender. It
    ///      holds no key and is nobody's wallet — its only job is to be a second leaf.
    function _allowlistFixtureMember() internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("ms2fun.showcase.allowlist.member", deployer)))));
    }

    /// @dev A second derived fixture address, not listed, so the refusal path (`InvalidProof`) is a
    ///      checked property of the seed.
    function _allowlistStranger() internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("ms2fun.showcase.allowlist.stranger", deployer)))));
    }

    /// @dev Leaf construction, byte-identical to `MerkleGatingModule.canMint` and to
    ///      `app/src/lib/merkle.ts`: `keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))))`.
    ///      The cap is part of the leaf, so a listed wallet cannot re-prove itself at a larger cap.
    function _leaf(address user, uint256 maxQty) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))));
    }

    /// @dev Solady commutative (sorted-pair) parent hash: the internal node the on-chain verifier
    ///      and the off-chain builder agree on.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Build the two-member tier the fixture installs, verifying it before install. A divergence
    ///      between the leaf this seed commits and the leaf the app rebuilds would surface in the UI
    ///      as an unexplained `InvalidProof`; verifying through the library the module calls moves
    ///      that failure into the seed.
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
    ///      The quotes are backslash-escaped because this string is embedded as a JSON string value
    ///      inside collection metadata that is itself an unencoded `data:` JSON URI; `maxQty` is a
    ///      quoted integer because a cap in token units does not fit a JSON number exactly.
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
    ///      this (editionId, tierIndex) pair. `tierIndex` is 0, the tier the app resolves, so the
    ///      seeded tier is tier 0 and open immediately.
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
    // Each mechanism's claim is a plain struct of on-chain-observable facts plus a pure predicate
    // over it. Phase 2 fills the struct by reading the chain, and
    // `test/coverage/SepoliaShowcaseBreadth.t.sol` fills the same struct by hand, including the
    // shapes that must fail each predicate.

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

    // ── ERC-1155 editions: fixed, LIMITED_DYNAMIC, free claim ──

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

    /// @notice The three pricing regimes an edition collection can carry, each asserted as a regime
    ///         rather than a configuration flag.
    /// @dev For the dynamic row, a `LIMITED_DYNAMIC` model with a non-zero rate would pass with a
    ///      rate too small to see across a handful of mints, so the assertion is about price
    ///      movement: what the module charges after `DYNAMIC_PROBE_MINTS` mints.
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
        // Headroom: the claim is one-per-address, so a reservation a single visitor could exhaust
        // would leave the next visitor a dead button.
        require(f.freeClaimMinted < f.freeClaimAllocation, "editions: the free-claim reservation is already exhausted");
    }

    // ── Merkle allowlist gating ──

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

    /// @notice The allowlist is installed, open, and discriminating.
    /// @dev A root can be installed on a tier that never opens, and a gate that accepts every proof
    ///      is an open collection with a gated description, so the seed re-verifies a listed member
    ///      and an unlisted address against the installed root through the library the module calls.
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

    // ── Staking ──

    struct StakingFacts {
        address module;
        address expectedModule;
        bool active;
        uint256 userStaked;
        uint256 totalStaked;
        uint256 liquidBalance;
    }

    /// @notice The stake/unstake surface is wired, enabled, and carries a real position.
    /// @dev This asserts the surface, not a running stream (see `_assertStakingStream`). The
    ///      module's only funding path is a real LP-fee delta through `claimAllFees`, so what is
    ///      checked is everything that must hold for the stream to credit once funded. The row keeps
    ///      a liquid balance so the stake action is walkable again.
    function _assertStakingShowcase(StakingFacts memory f) internal pure {
        require(f.module != address(0), "staking: no staking module is wired to the row");
        require(f.module == f.expectedModule, "staking: the wired module is not the approved one");
        require(f.active, "staking: the row's staking is not activated");
        require(f.userStaked > 0, "staking: the row carries no staked position");
        require(f.totalStaked >= f.userStaked, "staking: the module's total is below the seeded position");
        require(f.liquidBalance > 0, "staking: the whole position is locked (the stake action is unwalkable)");
    }

    // ── The staking stream ──

    struct StreamFacts {
        uint256 feeDelta; // ETH the instance actually received when it claimed its vaults' fees
        uint256 rewardRate; // the module's per-second rate after the delta was recorded
        uint256 periodFinish;
        uint256 totalStaked;
        uint256 nowTs;
    }

    /// @notice The staking stream is running, on a real LP-fee delta.
    /// @dev The module's only funding path is a fee delta arriving through `claimAllFees`. The
    ///      stream is funded as in the product: the alignment vault holds a real LP position, a
    ///      real swap on that pool pays it a fee, and the claim moves that fee to the instance.
    ///      `feeDelta > 0` is what excludes a stream started by ETH pushed from anywhere.
    function _assertStakingStream(StreamFacts memory f) internal pure {
        require(f.totalStaked > 0, "stream: nothing is staked (a stream nobody can accrue is not running)");
        require(f.feeDelta > 0, "stream: no fee delta arrived - the stream would have no earned source");
        require(f.rewardRate > 0, "stream: the module records no per-second rate");
        require(f.periodFinish > f.nowTs, "stream: the reward period has already finished");
    }

    // ── The venues ──

    struct VenueFacts {
        string label;
        uint8 routeVenue; // the venue the registry curates for this (target, token)
        uint8 expectedVenue;
        address referencePool;
        uint32 referenceWindow;
        uint32 expectedWindow;
        address vaultToken;
        address expectedToken;
        uint256 vaultTargetId;
        uint256 expectedTargetId;
        address vaultPriceValidator;
        uint256 venueLiquidity; // active depth in the pool the acquire leg swaps through
        uint256 minVenueLiquidity;
        uint256 pendingBefore; // the tithe the vault held going into its convert
        uint256 pendingAfter;
        uint256 lpPositionValue; // what the convert itself reported
    }

    /// @notice One venue is live: curated coherently, priced by a pinned reference, deep enough to
    ///         serve a convert, and proven by a convert that executed.
    ///
    /// @dev Three facts are ones a venue quietly fails on, and none reads the others. The route is
    ///      what a vault refuses to convert against when it disagrees, and what the app shows. The
    ///      reference pool is the price authority the -5% floor reads; unpinned, the convert reverts
    ///      before reaching any pool. The active liquidity cannot be replaced by a deposit figure,
    ///      since a position minted outside the current tick range reports units while adding none
    ///      of the depth the swap needs.
    ///
    ///      The last three make this an outcome: a tithe existed, the convert consumed it
    ///      (`pendingAfter < pendingBefore`), and it reported a position.
    function _assertVenueShowcase(VenueFacts memory f) internal pure {
        require(f.expectedVenue != 0, "venue: the expected venue is NONE (the assertion would say nothing)");
        require(f.routeVenue == f.expectedVenue, string.concat("venue: ", f.label, " route is not the venue it LPs on"));
        require(f.referencePool != address(0), string.concat("venue: ", f.label, " has no pinned reference pool"));
        require(
            f.referenceWindow == f.expectedWindow,
            string.concat("venue: ", f.label, " reference window is not the deployment's TWAP window")
        );
        require(f.vaultToken == f.expectedToken, string.concat("venue: ", f.label, " vault holds another asset"));
        require(
            f.vaultTargetId == f.expectedTargetId, string.concat("venue: ", f.label, " vault sits on another target")
        );
        require(f.vaultPriceValidator != address(0), string.concat("venue: ", f.label, " vault has no price validator"));
        require(
            f.venueLiquidity >= f.minVenueLiquidity,
            string.concat("venue: ", f.label, " pool is too thin to serve a convert inside the floor")
        );
        require(f.pendingBefore > 0, string.concat("venue: ", f.label, " vault held no tithe to convert"));
        require(
            f.pendingAfter < f.pendingBefore, string.concat("venue: ", f.label, " convert consumed none of the tithe")
        );
        require(f.lpPositionValue > 0, string.concat("venue: ", f.label, " convert reported no LP position"));
    }

    // ── Metadata stack and Token Tiers ──

    struct TierFacts {
        uint256 scarceCapacity;
        uint256 scarceOutstanding;
        uint256 openCapacity;
        uint256 openOutstanding;
        uint256 totalTierEscrow;
        uint256 waveCount;
        string baseArt;
        string bandArt;
    }

    /// @notice Mint-up, mint-down, an exhausted band, and two visibly different art layers.
    /// @dev The scarce band's outstanding count equalling its capacity is exactly the condition under
    ///      which the next `mintUp` into it reverts `BandExhausted`. The open band must still have
    ///      room, because the seed minted down out of it; otherwise "reversible" is only a claim.
    ///
    ///      The art strings are compared for inequality: band over base is only demonstrated if the
    ///      layers resolve to different pictures, and two pointers into one collection would render
    ///      one image twice.
    ///
    ///      The wave count is asserted zero. Waves and paid commissions are the artist metadata row's
    ///      demonstration; this row wires no overlay.
    function _assertTierShowcase(TierFacts memory f) internal pure {
        require(f.scarceCapacity > 0, "tiers: the scarce band has no capacity (the ladder was not sealed)");
        require(
            f.scarceOutstanding == f.scarceCapacity,
            "tiers: the scarce band is not exhausted (BandExhausted is unobservable)"
        );
        require(f.openCapacity > f.openOutstanding, "tiers: the open band has no room left to mint up into");
        require(f.totalTierEscrow > 0, "tiers: no coin is escrowed behind a band (no mint-up survived)");
        require(f.waveCount == 0, "tiers: this row carries an overlay wave (the demo split has regressed)");

        require(bytes(f.baseArt).length > 0, "tiers: the collection has no piece art");
        require(!_eq(f.baseArt, f.bandArt), "tiers: band art is the same collection as the base art");
    }

    // ── ERC-721 auctions ──

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
    /// @dev `settled` is set by both terminal paths, so it cannot tell a sold lot from a reclaimed
    ///      one. The token does: `settleAuction` mints it to the winner, `reclaimUnsold` never
    ///      mints. So the sold lot is checked to be owned by its winner and the reclaimed lot to
    ///      have no token.
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

    // ── The carve ──

    struct CarveFacts {
        uint16 declaredMaxBps;
        uint256 requestBps;
        uint256 raise;
        uint256 effectiveCarveEth;
        uint256 minPoolEth;
        bool graduated;
    }

    /// @notice The carve was declared, requested, and settled at the protocol's own figure.
    /// @dev The declaration is the disclosure surface, immutable per instance and readable before the
    ///      first buy, so it must be on-chain and non-zero regardless of the payout.
    ///
    ///      The payout is a depth question. `effectiveCarveEth` is the minimum of the request, the
    ///      bracket allowance, and the LP share's headroom above the pool floor, so on a raise whose
    ///      LP share does not clear that floor the effective carve is zero by design. The check is
    ///      consistency: below the floor the carve is zero, and above it, having requested the
    ///      declared maximum, it is not.
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
    ///      LP share strictly exceeds the pool floor. Printed by the seed, not asserted.
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

/// @dev The vault factory's WETH immutable, read so the seed declares no external address.
interface IWethSource {
    function weth() external view returns (address);
}

/// @dev The validator's own TWAP window. The wait this seed imposes before pinning a freshly created
///      reference pool and the window the registry probes it with are the same number, read from the
///      deployment.
interface ITwapWindowSource {
    function twapSecondsAgo() external view returns (uint32);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                     THE VENUES: EXTERNAL SURFACES AND THE TWO SEEDERS
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Three separate things must hold before a vault's convert can execute, and none reads the others:
//
//   · the acquire route: the venue the registry curates for this (target, token);
//   · the reference pool: the price authority the vault's -5% oracle floor reads, a {token, WETH}
//     pool that can already serve a TWAP over the deployment's window; and
//   · the venue pool itself, deep enough that a demo-sized buy prices inside that floor.
//
// The floor is never touched. The seeders below stand up the pools: the alignment assets are
// fixture tokens this deployment mints, so the market that prices them is the seed's to create.
// The staking reward source stays a real LP-fee delta from a real swap (see `SeedSepoliaBuys`).

/// @dev The two calls the reference-pool seeder makes on the Uniswap V3 factory.
interface IUniswapV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

/// @dev The Uniswap V3 pool surface the reference pool is stood up and read back through.
interface IUniswapV3PoolMinimal {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
    function observations(uint256 index)
        external
        view
        returns (
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulativeX128,
            bool initialized
        );
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @dev Minimal WETH surface. The V4 and ZAMM venues are native-ETH pools; the reference pool is a
///      WETH pair, so only the ETH it consumes is wrapped.
interface IWethMinimal {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The fixture-token surface the seed uses: the deployment's own `MockERC20`s, minted by this
///      seed, so the token leg of every venue is minted rather than bought. No deep pool on this
///      network sells a fixture asset.
interface IFixtureToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The owner-only registry setters the venue wiring drives, declared here so the seed states
///      exactly the calls it makes.
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

/// @dev The reads a vault is checked through after it is wired. Every member is a public getter on
///      all three vault families; the pending-tithe read and the convert differ by family and are
///      handled separately.
interface IVenueVaultView {
    function alignmentToken() external view returns (address);
    function alignmentTargetId() external view returns (uint256);
    function priceValidator() external view returns (address);
}

/// @dev The convert, as the Uniswap family exposes it: one slippage bound, floored by the vault to
///      an oracle-derived minimum.
interface IVenueVaultConvert {
    function convertAndAddLiquidity(uint256 minOutTarget) external returns (uint256 lpPositionValue);
}

/// @dev The convert, as the ZAMM family exposes it. Its LP add is a paired deposit rather than a
///      range position, so it carries two further minimums for the deposit legs. It is a different
///      signature from `IVenueVaultConvert`.
interface IZammVaultConvert {
    function convertAndAddLiquidity(uint256 minTokenOut, uint256 minEth, uint256 minToken)
        external
        returns (uint256 lpMinted);
}

/// @notice Stands up the Uniswap V3 {token, WETH} pool the vault's oracle floor reads as its price
///         authority, and holds the position it mints.
///
///         The floor is derived from a pinned pool's own TWAP, which an attacker cannot move inside
///         one transaction. It presumes a pool exists, and the alignment assets are fixture tokens
///         minted by this deployment, so nothing on this network prices them until the deployment
///         does. Standing the pool up is part of standing the asset up; the floor is left as
///         deployed.
///
///         `setReferencePool` probes `observe([window, 0])` before accepting a pool, and a freshly
///         initialized pool has no observation old enough to answer. This contract therefore only
///         creates and seeds the pool; the pin happens a full window later, in phase 2, after the
///         orchestrator has waited the window out in real time.
///
///         The position is minted under this contract and left. There is no withdraw path, so the
///         reference pool's depth cannot be removed by a demo action.
contract SepoliaReferencePoolSeeder {
    error NotOwner();
    error NotPool();
    error PoolPairMismatch();
    error NoLiquidityMinted();

    /// @dev 1:1. The fixture asset has no prior price; parity with ETH keeps every number in the
    ///      showcase readable. The V4 and ZAMM venues are seeded at the same parity, so the curated
    ///      reference and the executed venue agree and the -5% floor has headroom.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    address public immutable owner;
    IWethMinimal public immutable weth;
    IFixtureToken public immutable token;
    IUniswapV3PoolMinimal public pool;

    constructor(address weth_, address token_) {
        owner = msg.sender;
        weth = IWethMinimal(weth_);
        token = IFixtureToken(token_);
    }

    receive() external payable { }

    /// @notice Create (or adopt) the {token, WETH} pool at `fee`, initialize it at parity, widen its
    ///         observation ring, and mint a concentrated position centred on its tick.
    /// @param halfWidthTicks Half-width before alignment to `tickSpacing`. Symmetric in ticks is
    ///        symmetric in log price, so equal nominal amounts on the two legs is the right split at
    ///        parity.
    /// @return poolAddr The pool that must later be pinned as this (target, token)'s reference.
    /// @return liquidityMinted Liquidity units the position added.
    function seed(address v3Factory, uint24 fee, int24 tickSpacing, int24 halfWidthTicks, uint16 cardinality)
        external
        payable
        returns (address poolAddr, uint128 liquidityMinted)
    {
        if (msg.sender != owner) revert NotOwner();

        poolAddr = IUniswapV3FactoryMinimal(v3Factory).getPool(address(weth), address(token), fee);
        if (poolAddr == address(0)) {
            poolAddr = IUniswapV3FactoryMinimal(v3Factory).createPool(address(weth), address(token), fee);
        }
        pool = IUniswapV3PoolMinimal(poolAddr);
        // The registry's own probe requires the pair to be exactly {token, WETH}; assert it here so a
        // mis-specified fee tier fails at the seeder rather than a window later at the pin.
        address t0 = pool.token0();
        address t1 = pool.token1();
        if (!((t0 == address(token) && t1 == address(weth)) || (t0 == address(weth) && t1 == address(token)))) {
            revert PoolPairMismatch();
        }

        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        if (sqrtPriceX96 == 0) {
            pool.initialize(SQRT_PRICE_1_1);
            sqrtPriceX96 = SQRT_PRICE_1_1;
        }
        // Widen the observation ring so the pool keeps history once anything trades on it. The pin
        // does not depend on this (an untraded pool answers from its initialization observation),
        // but a traded pool with a one-slot ring stops serving as a reference.
        pool.increaseObservationCardinalityNext(cardinality);

        // Both legs, at the parity the pool was initialized at: the ETH the caller sent, wrapped, and
        // the same nominal amount of the fixture token, minted.
        uint256 ethLeg = msg.value;
        weth.deposit{ value: ethLeg }();
        token.mint(address(this), ethLeg);

        (, int24 tick,,,,,) = pool.slot0();
        (int24 tickLower, int24 tickUpper) = _range(tick, tickSpacing, halfWidthTicks);

        // At parity the two legs are equal in nominal terms, so token ordering does not change the
        // amounts offered; the callback reads the ordering for its payment.
        liquidityMinted = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), ethLeg, ethLeg
        );
        if (liquidityMinted == 0) revert NoLiquidityMinted();
        pool.mint(address(this), tickLower, tickUpper, liquidityMinted, "");
    }

    /// @dev Uniswap V3 mint callback: pay what the position pulled out of the legs already held.
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        if (msg.sender != address(pool)) revert NotPool();
        (uint256 wethOwed, uint256 tokenOwed) =
            address(weth) < address(token) ? (amount0Owed, amount1Owed) : (amount1Owed, amount0Owed);
        if (wethOwed != 0) weth.transfer(msg.sender, wethOwed);
        if (tokenOwed != 0) token.transfer(msg.sender, tokenOwed);
    }

    function _range(int24 tick, int24 spacing, int24 halfWidthTicks) private pure returns (int24 lower, int24 upper) {
        lower = _alignedTick(tick - halfWidthTicks, spacing);
        upper = _alignedTick(tick + halfWidthTicks, spacing);
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        if (lower < minTick) lower = minTick;
        if (upper > maxTick) upper = maxTick;
    }

    function _alignedTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        return compressed * spacing;
    }
}

/// @notice Gives the Uniswap V4 pool a vault actually acquires through the depth its curated route
///         already claims.
///
///         This is the Sepolia analog of the mainnet-fork seed's depth seeder. On a mainnet fork the
///         token leg is bought on a deep same-pair V3 pool because the alignment asset has a real
///         market; here the asset is a fixture this deployment minted and no deep pool exists, so
///         the leg is minted. Both put two-sided liquidity into the pool the acquire leg swaps
///         through, so the executed buy prices inside the vault's -5% floor.
///
///         The position is minted under this contract with a zero salt and left, with no withdraw
///         path, as with the reference pool.
contract SepoliaV4DepthSeeder is IUnlockCallback {
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error NotOwner();
    error NotPoolManager();
    error TokenNotInPoolKey();
    error NoLiquidityMinted();

    struct AddLiquidityCallbackData {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
    }

    IPoolManager public immutable poolManager;
    IFixtureToken public immutable token;
    address public immutable owner;

    constructor(IPoolManager poolManager_, address token_) {
        poolManager = poolManager_;
        token = IFixtureToken(token_);
        owner = msg.sender;
    }

    receive() external payable { }

    /// @notice Mint the fixture leg and add the pair as a concentrated position centred on the pool's
    ///         current tick.
    /// @return liquidity Liquidity units minted.
    /// @return ethUsed Native ETH the position pulled.
    /// @return tokenUsed Fixture token the position pulled.
    function seedDepth(PoolKey calldata key, int24 halfWidthTicks)
        external
        payable
        returns (uint128 liquidity, uint256 ethUsed, uint256 tokenUsed)
    {
        if (msg.sender != owner) revert NotOwner();
        bool tokenIsCurrency1 = Currency.unwrap(key.currency1) == address(token);
        if (!tokenIsCurrency1 && Currency.unwrap(key.currency0) != address(token)) revert TokenNotInPoolKey();

        // At the parity the pool is initialized to, an ETH-symmetric range wants equal nominal legs.
        uint256 ethHeld = msg.value;
        token.mint(address(this), ethHeld);
        uint256 tokenHeld = token.balanceOf(address(this));

        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 tickLower = _alignedTick(tick - halfWidthTicks, key.tickSpacing);
        int24 tickUpper = _alignedTick(tick + halfWidthTicks, key.tickSpacing);
        int24 minTick = TickMath.minUsableTick(key.tickSpacing);
        int24 maxTick = TickMath.maxUsableTick(key.tickSpacing);
        if (tickLower < minTick) tickLower = minTick;
        if (tickUpper > maxTick) tickUpper = maxTick;

        (uint256 amount0, uint256 amount1) = tokenIsCurrency1 ? (ethHeld, tokenHeld) : (tokenHeld, ethHeld);

        bytes memory result = poolManager.unlock(
            abi.encode(
                AddLiquidityCallbackData({
                    key: key, tickLower: tickLower, tickUpper: tickUpper, amount0: amount0, amount1: amount1
                })
            )
        );
        uint256 used0;
        uint256 used1;
        (liquidity, used0, used1) = abi.decode(result, (uint128, uint256, uint256));
        if (liquidity == 0) revert NoLiquidityMinted();
        (ethUsed, tokenUsed) = tokenIsCurrency1 ? (used0, used1) : (used1, used0);

        // Residue back to the caller: a position never pulls both legs to the last wei.
        uint256 tokenLeft = token.balanceOf(address(this));
        if (tokenLeft != 0) token.transfer(owner, tokenLeft);
        uint256 ethLeft = address(this).balance;
        if (ethLeft != 0) SafeTransferLib.safeTransferETH(owner, ethLeft);
    }

    /// @dev V4 unlock callback: price the liquidity off the pool's live sqrt price, mint it, then
    ///      settle debts and take credits with `CurrencySettler`.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        AddLiquidityCallbackData memory p = abi.decode(data, (AddLiquidityCallbackData));

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(p.key.toId());
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(p.tickLower),
            TickMath.getSqrtPriceAtTick(p.tickUpper),
            p.amount0,
            p.amount1
        );

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) p.key.currency0.settle(poolManager, address(this), uint256(uint128(-d0)), false);
        else if (d0 > 0) p.key.currency0.take(poolManager, address(this), uint256(uint128(d0)), false);
        if (d1 < 0) p.key.currency1.settle(poolManager, address(this), uint256(uint128(-d1)), false);
        else if (d1 > 0) p.key.currency1.take(poolManager, address(this), uint256(uint128(d1)), false);

        return abi.encode(liquidity, d0 < 0 ? uint256(uint128(-d0)) : 0, d1 < 0 ? uint256(uint128(-d1)) : 0);
    }

    function _alignedTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        return compressed * spacing;
    }
}
