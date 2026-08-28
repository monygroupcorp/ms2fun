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
    /// @dev Written by `DeploySepolia` beside the deployment file — see `_readVenueHandoff`.
    string internal constant VENUE_PATH = "./deployments/sepolia-venues.json";

    // ─────────────────────────── Venue pool shape ───────────────────────────
    //
    // One fee tier, deployment-wide. `DeployCore` builds every Uni vault's pool key from
    // `zrouterFee`/`zrouterTickSpacing`, and `BestRouteAcquirer` falls back to the same pair when no
    // best-route quoter is wired (`cfg.zQuoter` is unset on this network). So the pool a vault LPs
    // into, the pool its acquire leg swaps through, and the pool the registry curates as its route
    // are all THIS tier — which is why the depth seed and the route both name it and neither guesses.

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev Starting price 1:1 (sqrt(1) * 2^96). A pool must be initialized before it can be named;
    ///      it holds no liquidity until someone adds some. Parity is a CHOICE, and it is the same
    ///      choice the reference pool is stood up at — see `SepoliaReferencePoolSeeder`.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

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

    // ─────────────────────────── The featured wall ───────────────────────────
    //
    // A featured slot is rented per day at the queue's own `dailyRate`, so the duration is the
    // whole cost. The default is sized to the showcase's own planned lifetime — roughly 30 days
    // on Sepolia before the mainnet push (operator ruling, 2026-08-26) — not to the queue's
    // 365-day ceiling: a wall that outlives the showcase is spend, not durability. The seed
    // PRINTS the resulting total before it spends anything; the env knob is the lever if the
    // lifetime changes.
    //
    // The rate is read from the deployed queue rather than assumed here: it is owner-tunable, and a
    // projection computed off a stale literal would be a number nobody can act on.
    string internal constant ENV_FEATURED_DURATION_SECONDS = "SEPOLIA_FEATURED_DURATION_SECONDS";
    uint256 internal constant DEFAULT_FEATURED_DURATION_SECONDS = 30 days;

    /// @dev The rank step between adjacent featured slots. Rank is what ORDERS the wall — the queue
    ///      returns active slots sorted by effective rank — so the seed pays a distinct boost per slot
    ///      and the tour reads top to bottom in the order it was composed rather than in an arbitrary
    ///      one. The step is small on purpose: only the ordering is demonstrated here, and rank paid
    ///      to out-rank nobody is ETH spent on nothing.
    string internal constant ENV_FEATURED_RANK_STEP_WEI = "SEPOLIA_FEATURED_RANK_STEP_WEI";
    uint256 internal constant DEFAULT_FEATURED_RANK_STEP_WEI = 0.0001 ether;

    // ─────────────────────────── Wave-3 venue knobs ───────────────────────────
    //
    // Every venue's depth is the seed's own ETH, so every one of them is an environment knob and the
    // seed prints what it deposited. THE DEFAULTS ARE SIZED BY THE FLOOR, NOT BY AMBITION: the number
    // that has to hold is that a demo-sized convert prices within the vault's -5% oracle floor, and a
    // concentrated position reaches that on a fraction of an ETH. A deployment meant to be traded
    // against wants more; raise these rather than editing the source.

    /// @dev ETH into each Uniswap V4 acquire pool (one per Uni alignment target).
    ///
    ///      SIZED BY THE FLOOR, MEASURED. The vault's oracle floor rejects a convert that prices more
    ///      than `maxPriceDeviationBps` (5%) under the reference TWAP, and on a concentrated position
    ///      at parity a swap of `dx` moves the price by roughly `2·dx/L`. So the pool has to carry
    ///      `L >= 40·dx` for the vault's own swap to clear its own floor — with this seed's fills the
    ///      largest convert swaps a little over a hundredth of an ETH, and the default below leaves
    ///      that a comfortable margin. Raising the curve fills raises the tithe, and therefore raises
    ///      this: the two knobs move together.
    string internal constant ENV_V4_DEPTH_WEI = "SEPOLIA_V4_DEPTH_WEI";
    uint256 internal constant DEFAULT_V4_DEPTH_WEI = 0.05 ether;

    /// @dev ETH into each seeded {token, WETH} Uniswap V3 REFERENCE pool. This pool is a price
    ///      authority rather than an execution venue, so it is sized to be a credible quote rather
    ///      than to absorb a trade.
    string internal constant ENV_REFERENCE_DEPTH_WEI = "SEPOLIA_REFERENCE_DEPTH_WEI";
    uint256 internal constant DEFAULT_REFERENCE_DEPTH_WEI = 0.01 ether;

    /// @dev ETH into the ZAMM ETH/token pool. A flipped vault flag with no pool behind it is a dead
    ///      vault rather than a venue, so the pool and its liquidity are stood up with the vault.
    string internal constant ENV_ZAMM_DEPTH_WEI = "SEPOLIA_ZAMM_DEPTH_WEI";
    uint256 internal constant DEFAULT_ZAMM_DEPTH_WEI = 0.05 ether;

    /// @dev ETH into the Algebra {token, WETH} pool that is BOTH the Cypher venue and its reference.
    string internal constant ENV_ALGEBRA_DEPTH_WEI = "SEPOLIA_ALGEBRA_DEPTH_WEI";
    uint256 internal constant DEFAULT_ALGEBRA_DEPTH_WEI = 0.05 ether;

    /// @dev The tithe seeded directly into the ZAMM vault so its convert has something to convert.
    ///      The Uni and Cypher vaults receive theirs the way the product does — 19% of a real
    ///      graduation — because a collection graduates into each of those venues in this seed. No
    ///      collection graduates into ZAMM here, so its pending balance is a plain contribution from
    ///      the seed's own account: real ETH, credited to a real benefactor, converted by the real
    ///      call. It is stated here rather than dressed up as a raise.
    string internal constant ENV_ZAMM_VAULT_TITHE_WEI = "SEPOLIA_ZAMM_VAULT_TITHE_WEI";
    uint256 internal constant DEFAULT_ZAMM_VAULT_TITHE_WEI = 0.002 ether;

    /// @dev The Cypher flagship's fill, in bps of its bondable supply. It is bought to be GRADUATED,
    ///      so the only floor is a raise the graduation will accept; it is sized like the graduated
    ///      spine row for the same reason — the pool it opens should be worth looking at.
    string internal constant ENV_CYPHER_FILL_BPS = "SEPOLIA_CYPHER_FILL_BPS";
    uint256 internal constant DEFAULT_CYPHER_FILL_BPS = 700;

    /// @dev The demo swap that produces the LP-fee delta the staking stream is funded from. It buys
    ///      the alignment asset on the vault's own venue pool, so the fee it pays is earned by the
    ///      vault's position — which is the only funding path the staking module has.
    string internal constant ENV_DEMO_SWAP_WEI = "SEPOLIA_DEMO_SWAP_WEI";
    uint256 internal constant DEFAULT_DEMO_SWAP_WEI = 0.004 ether;

    /// @dev Half-width of every seeded position, in ticks, before alignment to the pool's spacing.
    ///
    ///      THE CONCENTRATION IS WHAT MAKES A FAUCET BUDGET ENOUGH. Liquidity for a given deposit
    ///      scales roughly as `1 / (1 - 1/sqrt(priceRatio))`, so narrowing the range buys depth that
    ///      widening it does not. 1200 ticks is about ±12.7% in price: two-and-a-half times the -5%
    ///      band the vault's floor allows a convert to move the price through, so the seeded range
    ///      still contains the price after every convert and the demo swap — and about five times the
    ///      liquidity the same ETH would buy across a ±80% range.
    string internal constant ENV_DEPTH_HALF_WIDTH_TICKS = "SEPOLIA_DEPTH_HALF_WIDTH_TICKS";
    int24 internal constant DEFAULT_DEPTH_HALF_WIDTH_TICKS = 1200;

    /// @dev Observation ring size requested on each seeded V3 reference pool.
    uint16 internal constant REFERENCE_POOL_CARDINALITY = 16;

    /// @dev Minimum active liquidity a seeded venue pool must report before the seed will claim the
    ///      venue is live. Guards the failure mode a budget alone cannot: a position minted OUTSIDE
    ///      the current tick range reports units while adding none of the depth the acquire leg needs.
    uint128 internal constant MIN_VENUE_ACTIVE_LIQUIDITY = 1e12;

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
    // EVERY row on this seed — the four curve rows and the eight breadth rows alike — wears ONE
    // derivative collection end to end. A row's pieces resolve inside that collection's own metadata
    // directory and its collection tile is that same collection's own art, so the featured wall reads
    // as twelve distinct drops rather than one uniform set. No two rows share a family, and no row
    // takes its tile from a directory another row's tile comes from.
    //
    // Per-piece bases are METADATA directories whose entries are addressed by the BARE token id,
    // because `base + tokenId` composes with no separator and no extension — an image directory 404s
    // for every id. Tiles are single FILES inside the family's own IMAGE directory, which is a
    // different CID from the metadata one for every family here.
    //
    // Rows whose mechanism composes per-piece `data:` metadata (the ERC-1155 editions and the ERC-721
    // auction houses) have no on-chain base to wire, so only their family's image directory appears
    // below: the piece document is ours, the picture inside it is the family's.

    // ── Metadata directories, one per row that carries an on-chain base ───────────────────────────
    string internal constant ART_BASE_PIXELADY = "ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/";
    string internal constant ART_BASE_BOREDMILADY = "ipfs://QmZ7K6hG5uiTvLVvmxZgm72Nv3kmvTq4CVAEG6JoMFvpkW/";
    string internal constant ART_BASE_FIGMATA = "ipfs://bafybeih64fcswxjq7qrpx6hbzr2wkmn7u7bcl63yadaxmzgcyabecenl6e/";
    string internal constant ART_BASE_LAWBSTERS = "ipfs://bafybeibvgwjwuosoov6cfgwoyyrt7vocalqoprjayni6rfepda7bi2jdse/";
    string internal constant ART_BASE_MILADYSTATION = "ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/";
    string internal constant ART_BASE_GHIBLADY = "ipfs://bafybeic5in4it4rsocajjvzn3zs5scsci4a7hhpbpd5fulqca42vqtjs2q/";
    string internal constant ART_BASE_ELITE = "ipfs://bafybeicrcd4fgtumtkjfzkxkmlzqvy3w6cn2tlb3vm6jvbnxbojebvnwne/";

    /// @dev The tier row's THREE metadata directories are one family's own lineage, bottom to top:
    ///      the ordinary base is the parent collection, and each tier band is the derivative that
    ///      succeeded it. Precedence (overlay over band over base) is only demonstrated if the layers
    ///      can be told apart by eye, and a ladder read inside one lineage says what the rungs mean
    ///      as well as that they differ.
    string internal constant ART_BASE_SONORA = "ipfs://QmX89dvzA3TSwsGfY7SthYkDxSFjszec8JkEEZE7JP5QHF/";
    string internal constant ART_BASE_SONORA222 = "ipfs://bafybeifxxqwdsdxtmvk6iauqqh4vobvlrflv332nb6fnllhwwjeblr35ra/";
    string internal constant ART_BASE_SCHIZO = "ipfs://bafybeibtjhjyswebkwvck4u6pomllz46gdsfqtsdfrurhm7awn34oxckgi/";

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
    string internal constant ART_TILE_CYPHER =
        "ipfs://bafybeifgzaqtirkmmy7rqgtchfg2twe4olz2i3ul64w4pnlufrsaovkhau/1.png";

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
    // A row mints piece ids 1..N, and `base + tokenId` resolves only for ids the directory actually
    // carries. The counts below are each collection's supply — the number of ids its directory
    // answers for. `_assertPieceCoverage` holds them against what a row can mint, so raising a piece
    // count past a directory's reach is a named failure instead of a silent gap.
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

    // ── The retired directories ──────────────────────────────────────────────────────────────────
    //
    // The five blue-chip directories this seed used to draw from. They are kept here, and ONLY here,
    // as a denylist: `_assertNotRetiredArt` runs over every base and every tile the seed configures,
    // so one of them coming back — copied from the anvil seed, or restored from an older revision —
    // is a named failure at simulation time rather than a wall of foreign art on the testnet.
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

    /// @dev A roster row. BOTH phases build the identical list and index it BY NAME, never by
    ///      position: the waves that follow this one add venues and project types to the showcase,
    ///      and a phase-2 that resolved `instances[2]` would silently re-target when they do.
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
        // ── Wave-3 venues: the LP families beyond Uni, and the periphery they ride ──
        address zammVaultFactory; // ZAMMAlignmentVaultFactory — zero when this network has no ZAMM
        address cypherVaultFactory; // CypherAlignmentVaultFactory — zero until the Algebra rail is up
        address cypherPositionManager;
        address cypherRouter;
        address cypherAlgebraFactory;
        address zammDeployer; // approved LIQUIDITY_DEPLOYER — the ZAMM module
        address cypherDeployer; // approved LIQUIDITY_DEPLOYER — the Cypher module
        address v3Factory;
        address zamm;
        uint256 zammFeeOrHook;
        // ── The home page's front door ──
        FeaturedQueueManager queue; // paid placement; what `QueryAggregator.getHomePageData` reads
        // ── The social layer ──
        //
        // Every activity surface the app renders — the home preview, a collection's ACTIVITY
        // section, the board — reads `MessagePosted` off this one registry and nothing else. A
        // showcase that creates twelve collections and posts to none of them opens every one of
        // those surfaces on its empty state.
        GlobalMessageRegistry messages;
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
        // ── Wave-3 venues ──
        //
        // WHY EACH VENUE CARRIES ITS OWN ALIGNMENT TARGET. The registry stores ONE acquire route per
        // (targetId, token), and the Cypher vault refuses to convert unless the route it reads says
        // ALGEBRA. So one target cannot carry a live Uniswap convert AND a live Cypher convert for the
        // same asset — and pointing a vault at a venue the registry curates as something else is the
        // registry-vs-executed divergence the acquire route exists to close. Each venue therefore gets
        // its own target, each with a coherent route and its own reference pool. Two targets naming one
        // asset is a PICKER question (one asset, venue as an add-on), not a registry question.
        uint256 ms2ZammTargetId; // MS2 under a ZAMM route
        uint256 cultAlgebraTargetId; // CULT under an ALGEBRA route — the Cypher flagship's target
        address ms2ZammVault;
        address cultCypherVault;
        address ms2ReferencePool; // Uniswap V3 {MS2, WETH} — price authority for both MS2 targets
        address cultReferencePool; // Uniswap V3 {CULT, WETH} — price authority for CULT's Uni target
        address cultAlgebraPool; // Algebra {CULT, WETH} — the Cypher venue AND its price authority
        address cypher404; // the CULT-on-Cypher collection, graduating through the Algebra rail
        uint256 referenceReadyAt; // when the seeded pools can first serve the deployment's TWAP window
        // ── The featured wall ──
        //
        // The instances that hold a rented slot, in the order they were rented — which is descending
        // rank, and therefore the order the home page renders them in. Recorded so the channel's
        // preflight can assert the wall against the seed's own claim rather than against a count
        // somebody has to remember.
        address[] featured;
        uint256 featuredSpendWei; // duration cost + rank boost, summed across the slots above
        uint256 featuredDuration; // the duration each slot was rented for
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

    function _featuredDuration() internal view returns (uint256) {
        return vm.envOr(ENV_FEATURED_DURATION_SECONDS, DEFAULT_FEATURED_DURATION_SECONDS);
    }

    function _featuredRankStep() internal view returns (uint256) {
        return vm.envOr(ENV_FEATURED_RANK_STEP_WEI, DEFAULT_FEATURED_RANK_STEP_WEI);
    }

    /// @dev The rank boost for slot `index` of `count`, descending: the first slot rented outranks
    ///      every later one by one step. Stated as a function rather than as a table so a wall that
    ///      grows a row keeps its ordering property without a second edit.
    function _featuredRankBoost(uint256 index, uint256 count) internal view returns (uint256) {
        return _featuredRankStep() * (count - index);
    }

    /// @dev What the whole wall costs, asked of the DEPLOYED queue at its current `dailyRate`, before
    ///      a single slot is rented. The rate is owner-tunable, so this is a read rather than an
    ///      arithmetic restatement of a literal.
    function _quoteFeaturedSpend(Deployed memory d, uint256 count) internal view returns (uint256 total) {
        uint256 durationCost = d.queue.quoteDurationCost(_featuredDuration());
        for (uint256 i = 0; i < count; i++) {
            total += durationCost + _featuredRankBoost(i, count);
        }
    }

    // ─────────────────────────── The roster, stated once ───────────────────────────

    /// @notice The four curve states the showcase must hold, as one list both phases read.
    ///
    /// @dev EVERY DESCRIPTION STATES THE FEATURE, NOT A FICTION. The showcase's defining constraint
    ///      is that a stranger can learn the product by reading the roster: a description says what
    ///      the collection demonstrates and what to do with it. Copy that roleplays a real drop is
    ///      the thing this roster exists not to be, and re-introducing it costs a later wave the
    ///      unwind.
    ///
    ///      A NAME HONOURS THE DERIVATIVE FAMILY THE ROW WEARS; THE DESCRIPTION CARRIES THE TEACHING.
    ///      Each row's pieces come from a named derivative collection, so the row is named as a riff
    ///      on that collection — near enough to credit it, distinct enough that nobody reads the row
    ///      as the collection itself. Lifecycle and mechanism words (pre-open, mid, staking, tiers,
    ///      editions) belong in the description, never in the name. The SLUG is the internal key —
    ///      the salt, the hand-off's map key, the label every log and post-condition reads — and it
    ///      is deliberately not the display name: `name` below is what the app renders.
    ///
    ///      A NAME IS ALSO A REGISTRY KEY, so it carries no spaces. `MasterRegistryV1.registerInstance`
    ///      runs every name through `MetadataUtils.isValidName`, which admits only `[0-9A-Za-z-_]`;
    ///      a space anywhere in a name reverts the create for the whole row. Capitalization survives
    ///      the round trip — only the uniqueness hash case-folds — so a two-word riff is written as a
    ///      CamelCase compound rather than hyphenated. Single-word and compound names sit side by side
    ///      across the roster on purpose; there is no one form to normalise the wall onto.
    function _showcaseRoster() internal view returns (ShowcaseLeg[] memory legs) {
        legs = new ShowcaseLeg[](4);

        legs[0] = ShowcaseLeg({
            slug: "ember-preopen",
            title: "Voxelady",
            symbol: "VOXY",
            description: "This collection demonstrates the PRE-OPEN state. The curve is armed and the countdown is running, and nothing can be bought until it expires - a buy attempted now is rejected on-chain, not hidden by the interface. Watch what the collection page does as the timer runs down.",
            image: ART_TILE_PIXELADY,
            imageDir: ART_IMG_PIXELADY,
            pieceBase: ART_BASE_PIXELADY,
            state: STATE_PREOPEN,
            declaredMaxBps: 0,
            fillBps: 0,
            pieceIdCoverage: COVER_PIXELADY
        });

        legs[1] = ShowcaseLeg({
            slug: "vapor-mid",
            title: "SnoredMilady",
            symbol: "SNORED",
            description: "This collection demonstrates a LIVE BONDING CURVE part-way through its sale. Each buy mints coin and, in whole units, the pieces that ride it - one asset with two surfaces. Buy into it and watch the price, the piece gallery and the holder list move.",
            image: ART_TILE_BOREDMILADY,
            imageDir: ART_IMG_BOREDMILADY,
            pieceBase: ART_BASE_BOREDMILADY,
            state: STATE_MID_CURVE,
            declaredMaxBps: 0,
            fillBps: vm.envOr(ENV_MID_FILL_BPS, uint256(400)),
            pieceIdCoverage: COVER_BOREDMILADY
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
            pieceIdCoverage: COVER_FIGMATA
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
            pieceIdCoverage: COVER_LAWBSTERS
        });

        // The art is part of the roster's claim, so it is checked where the roster is built rather
        // than only where it is deployed: a row whose directory cannot answer for every id the row
        // can mint is named here, before anything is created on chain.
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
        d.masterRegistry = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        d.alignmentRegistry = vm.parseJsonAddress(json, ".contracts.AlignmentRegistry");
        d.componentRegistry = vm.parseJsonAddress(json, ".contracts.ComponentRegistry");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.priceValidator = vm.parseJsonAddress(json, ".contracts.UniswapVaultPriceValidator");
        d.protocolTreasury = vm.parseJsonAddress(json, ".contracts.ProtocolTreasury");
        d.zRouter = vm.parseJsonAddress(json, ".contracts.zRouter");
        d.queue = FeaturedQueueManager(payable(vm.parseJsonAddress(json, ".contracts.FeaturedQueueManager")));
        d.messages = GlobalMessageRegistry(vm.parseJsonAddress(json, ".contracts.GlobalMessageRegistry"));
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

        // ── Wave-3 venues: the LP modules the deploy already publishes ──
        d.zammDeployer = vm.parseJsonAddress(json, ".contracts.ModuleZAMMDeployer");
        d.cypherDeployer = vm.parseJsonAddress(json, ".contracts.ModuleCypherDeployer");
        _readVenueHandoff(d);

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
        // The featured queue is REQUIRED for the same reason the breadth modules are: the home page
        // reads its placements, so a deployment without one cannot hold the showcase's front door.
        require(address(d.queue) != address(0), "sepolia.json: FeaturedQueueManager missing");
        // Required on the same terms: the seed's last wave posts the showcase's activity, and a
        // deployment without the registry would leave every activity surface on its empty state
        // after a full, otherwise-successful seed.
        require(address(d.messages) != address(0), "sepolia.json: GlobalMessageRegistry missing");
    }

    /// @dev The venue addresses `DeploySepolia` wrote beside the deployment file: the two vault
    ///      factories the seed deploys ZAMM and Cypher vaults from (its alignment assets are fixtures
    ///      that do not exist at deploy time), plus the Algebra periphery and the plain externals the
    ///      venue legs ride. Read from a Sepolia-local file so the cross-network `DeployCore` keeps
    ///      one output shape.
    ///
    ///      A ZERO here is a STATE, not a failure: an Algebra standup may not have happened yet, and a
    ///      network may carry no ZAMM. The seed reports the venue as unavailable and continues rather
    ///      than reverting a whole showcase over one absent rail.
    function _readVenueHandoff(Deployed memory d) internal view {
        if (!vm.exists(VENUE_PATH)) {
            console.log("VENUES: no", VENUE_PATH, "- ZAMM and Cypher legs will be reported unavailable");
            return;
        }
        string memory json = vm.readFile(VENUE_PATH);
        require(
            vm.parseJsonUint(json, ".chainId") == block.chainid,
            "sepolia-venues.json: wrong chainId (stale file from another chain?)"
        );
        d.zammVaultFactory = vm.parseJsonAddress(json, ".zammVaultFactory");
        d.cypherVaultFactory = vm.parseJsonAddress(json, ".cypherVaultFactory");
        d.cypherPositionManager = vm.parseJsonAddress(json, ".cypherPositionManager");
        d.cypherRouter = vm.parseJsonAddress(json, ".cypherRouter");
        d.cypherAlgebraFactory = vm.parseJsonAddress(json, ".cypherAlgebraFactory");
        d.v3Factory = vm.parseJsonAddress(json, ".v3Factory");
        d.zamm = vm.parseJsonAddress(json, ".zamm");
        d.zammFeeOrHook = vm.parseJsonUint(json, ".zammFeeOrHook");
        require(d.v3Factory != address(0), "sepolia-venues.json: v3Factory missing (no reference pool can be stood up)");
    }

    /// @dev True when the Cypher rail is wired end to end. Anything less than ALL of it is not a
    ///      partial venue, it is no venue: a vault factory with no router cannot acquire, and a router
    ///      with no vault factory has nothing to acquire for.
    function _cypherAvailable(Deployed memory d) internal pure returns (bool) {
        return d.cypherVaultFactory != address(0) && d.cypherPositionManager != address(0)
            && d.cypherRouter != address(0) && d.cypherAlgebraFactory != address(0) && d.cypherDeployer != address(0);
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
        // ── Wave-3 venues ──
        vm.serializeUint(root, "ms2ZammTargetId", h.ms2ZammTargetId);
        vm.serializeUint(root, "cultAlgebraTargetId", h.cultAlgebraTargetId);
        vm.serializeAddress(root, "ms2ZammVault", h.ms2ZammVault);
        vm.serializeAddress(root, "cultCypherVault", h.cultCypherVault);
        vm.serializeAddress(root, "ms2ReferencePool", h.ms2ReferencePool);
        vm.serializeAddress(root, "cultReferencePool", h.cultReferencePool);
        vm.serializeAddress(root, "cultAlgebraPool", h.cultAlgebraPool);
        vm.serializeAddress(root, "cypher404", h.cypher404);
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
        // ── Wave-3 venues. Zeros are legal here: a venue whose rail this network does not carry was
        //    reported unavailable in phase 1 and is skipped, not asserted, in phase 2.
        h.ms2ZammTargetId = vm.parseJsonUint(json, ".ms2ZammTargetId");
        h.cultAlgebraTargetId = vm.parseJsonUint(json, ".cultAlgebraTargetId");
        h.ms2ZammVault = vm.parseJsonAddress(json, ".ms2ZammVault");
        h.cultCypherVault = vm.parseJsonAddress(json, ".cultCypherVault");
        h.ms2ReferencePool = vm.parseJsonAddress(json, ".ms2ReferencePool");
        h.cultReferencePool = vm.parseJsonAddress(json, ".cultReferencePool");
        h.cultAlgebraPool = vm.parseJsonAddress(json, ".cultAlgebraPool");
        h.cypher404 = vm.parseJsonAddress(json, ".cypher404");
        h.referenceReadyAt = vm.parseJsonUint(json, ".referenceReadyAt");
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
        _assertNotRetiredArt(base, label);
    }

    /// @dev No URI this seed configures may point into a retired directory. The five directories the
    ///      showcase used to draw from are kept as a denylist rather than as wiring, so a base or a
    ///      tile carrying one — copied across from another seed, or restored from an older revision —
    ///      fails by name at simulation time, before anything is created on chain.
    function _assertNotRetiredArt(string memory uri, string memory label) internal pure {
        require(
            !_contains(uri, RETIRED_DIR_ANIME) && !_contains(uri, RETIRED_DIR_ARCTIC)
                && !_contains(uri, RETIRED_DIR_SIMIAN) && !_contains(uri, RETIRED_DIR_DOODLE)
                && !_contains(uri, RETIRED_DIR_SHARED_TILE),
            string.concat("art: ", label, " points into a retired directory")
        );
    }

    /// @dev A row mints piece ids 1..`minted`, and `base + tokenId` resolves only for ids the
    ///      directory actually carries. A directory shorter than the row's piece count renders the
    ///      tail of the collection blank, which is a failed seed even though every wiring assertion
    ///      passes — so the reach of the art is asserted against the count, not assumed from it.
    function _assertPieceCoverage(uint256 covered, uint256 minted, string memory label) internal pure {
        require(
            covered >= minted,
            string.concat("art: ", label, " metadata directory does not cover every id the row can mint")
        );
    }

    /// @dev The collection tile must come from the row's OWN family. There is no shared tile
    ///      directory left to refuse: the rule is now positive and per row, because a tile taken from
    ///      ANY directory other than the row's own puts one collection's image over another
    ///      collection's pieces, and a wall of tiles that all came from one place reads as a single
    ///      uniform set whatever family that place belongs to.
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
    ///      the two sealed bands are allocated ABOVE that ceiling, one id per unit of band count — so
    ///      this is the largest id the band directories have to answer for. The overlay wave and the
    ///      commissions compose over ORDINARY ids, which sit below it.
    uint256 internal constant TIER_MAX_ADDRESSABLE_ID = TIER_NFT_COUNT + TIER_OPEN_COUNT + TIER_SCARCE_COUNT;

    /// @dev The breadth rows' art, held to the same rules as the roster's — run before phase 1
    ///      creates anything, so a mis-wired directory names itself at simulation time.
    ///
    ///      The ERC-1155 edition rows and the ERC-721 auction houses compose per-piece `data:`
    ///      documents rather than a base + id, so there is no metadata directory to cover for them:
    ///      what is checked is that every picture they name comes from their own family.
    function _assertBreadthArt() internal pure {
        // 1. Editions — one family across the collection tile and all three edition pictures.
        _assertTileArt(ART_TILE_ATLAS, ART_IMG_RADBRO, "atlas-editions");
        _assertTileArt(ART_PIECE_ATLAS_FIXED, ART_IMG_RADBRO, "atlas-editions fixed");
        _assertTileArt(ART_PIECE_ATLAS_RISING, ART_IMG_RADBRO, "atlas-editions rising");
        _assertTileArt(ART_PIECE_ATLAS_CLAIM, ART_IMG_RADBRO, "atlas-editions claim");

        // 2. The gated row.
        _assertTileArt(ART_TILE_VEIL, ART_IMG_MFERS, "veil-list");
        _assertTileArt(ART_PIECE_VEIL_PASS, ART_IMG_MFERS, "veil-list pass");

        // 3. Staking — an ERC404 row, so its base has to reach every id the row can mint.
        _assertTileArt(ART_TILE_QUARRY, ART_IMG_MILADYSTATION, "quarry-staking");
        _assertPieceBase(ART_BASE_MILADYSTATION, "quarry-staking");
        _assertPieceCoverage(COVER_MILADYSTATION, SHOWCASE_NFT_COUNT, "quarry-staking");

        // 4/5. Tiers — one family's own lineage across four directories. The base answers for the
        //      ordinary ids; the two band directories and the commission directory answer for ids up
        //      to the band ceiling, which is the highest id anything on this row can address.
        _assertTileArt(ART_TILE_PRISM, ART_IMG_SONORA, "prism-tiers");
        _assertPieceBase(ART_BASE_SONORA, "prism-tiers base");
        _assertPieceBase(ART_BASE_SONORA222, "prism-tiers open band");
        _assertPieceBase(ART_BASE_SCHIZO, "prism-tiers scarce band");
        _assertPieceCoverage(COVER_SONORA, TIER_NFT_COUNT, "prism-tiers base");
        _assertPieceCoverage(COVER_SONORA222, TIER_MAX_ADDRESSABLE_ID, "prism-tiers open band");
        _assertPieceCoverage(COVER_SCHIZO, TIER_MAX_ADDRESSABLE_ID, "prism-tiers scarce band");
        // The rungs have to be tellable apart or the precedence stack demonstrates nothing. Three
        // directories, checked here rather than only on the two the phase-2 read-back carries.
        require(!_eq(ART_BASE_SONORA, ART_BASE_SONORA222), "art: prism-tiers open band repeats the base directory");
        require(!_eq(ART_BASE_SONORA, ART_BASE_SCHIZO), "art: prism-tiers scarce band repeats the base directory");
        require(!_eq(ART_BASE_SONORA222, ART_BASE_SCHIZO), "art: prism-tiers bands repeat one another");

        // 7. The carve row.
        _assertTileArt(ART_TILE_CARVE, ART_IMG_GHIBLADY, "carve-demo");
        _assertPieceBase(ART_BASE_GHIBLADY, "carve-demo");
        _assertPieceCoverage(COVER_GHIBLADY, SHOWCASE_NFT_COUNT, "carve-demo");

        // 8. The Cypher flagship.
        _assertTileArt(ART_TILE_CYPHER, ART_IMG_ELITE, "cypher-flagship");
        _assertPieceBase(ART_BASE_ELITE, "cypher-flagship");
        _assertPieceCoverage(COVER_ELITE, SHOWCASE_NFT_COUNT, "cypher-flagship");

        // 6. The two auction houses.
        _assertTileArt(ART_TILE_RELIC, ART_IMG_MEOWLADY, "relic-line");
        _assertTileArt(ART_PIECE_RELIC_I, ART_IMG_MEOWLADY, "relic-line lot I");
        _assertTileArt(ART_PIECE_RELIC_II, ART_IMG_MEOWLADY, "relic-line lot II");
        _assertTileArt(ART_TILE_SALON, ART_IMG_COLOMBIA, "salon-line");
        _assertTileArt(ART_PIECE_SALON_I, ART_IMG_COLOMBIA, "salon-line lot I");

        _assertDistinctFamilies();
    }

    /// @dev One family per row, across the whole seed. Two rows drawing on the same directory is the
    ///      defect this asserts away: the wall then shows the same collection twice and the roster
    ///      stops saying that each row is a different drop. Held over the IMAGE directories, because
    ///      those are what a visitor actually sees on the featured grid.
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
    function _reportSpend(string memory phase, uint256 curveEth, uint256 featuredEth, uint256 balanceBefore)
        internal
        pure
    {
        console.log("--------------------------------------------------");
        console.log(string.concat("ETH projection - ", phase));
        console.log("  curve spend (wei):", curveEth);
        // Featured placement is rented per DAY, so this line is the one that moves with a duration
        // rather than with a fill. It is the wall's whole cost: rent plus the rank that orders it.
        console.log("  featured placement (wei):", featuredEth);
        console.log("  deployer balance before (wei):", balanceBefore);
        console.log("  gas is NOT included above - it is charged per broadcast tx by forge");
        console.log("--------------------------------------------------");
    }

    // ─────────────────────────── The activity the showcase carries ───────────────────────────
    //
    // WHY THIS WAVE EXISTS. Three surfaces in the app render nothing but `MessagePosted` events —
    // the home page's RECENT ACTIVITY preview, each collection page's ACTIVITY section, and the
    // board. A showcase that stands up twelve collections and posts to none of them opens all
    // three on their empty state, which is what a visitor reads first.
    //
    // WHAT THE COPY IS FOR. Every line states a FEATURE of the surface it sits on, in the same
    // register the roster's descriptions use: what the mechanism does, and what to do with it. No
    // personas, no invented community, no roleplayed drop — a stranger reading the board learns the
    // product. The lines are constants rather than generated so the whole set is reviewable in one
    // place before it is ever broadcast.
    //
    // WHAT IT COSTS. Every message carries zero attached ETH, so this wave adds no ETH to either
    // phase's projection; it costs gas for exactly ONE broadcast transaction, because the registry
    // takes the whole set through `postBatch`. The N12 spam lever (`postThreshold`) is zero on this
    // deployment, so a zero-value post surfaces on every feed.

    /// @dev One channel's seeded activity: the address a post is filed under, the label the run log
    ///      names it by, and the two lines it carries. Held as a struct so the copy sits beside the
    ///      channel it teaches rather than in a parallel array that can drift out of step with it.
    struct ActivityChannel {
        address channel;
        string label;
        string first;
        string second;
    }

    /// @dev Everything beyond the two lines each channel carries: the salon's own posts and the one
    ///      reply / quote / reaction of each kind. Counted here so the batch can be allocated at its
    ///      exact size — a memory array cannot be grown, and shrinking one takes assembly.
    uint256 internal constant ACTIVITY_EXTRA_MESSAGES = 9;

    /// @dev The twelve collection channels, in the order the run log prints them. The Cypher row is
    ///      the one optional member: its rail is not wired on every deployment and phase 1 records a
    ///      zero address when it is skipped, so it is dropped from the set rather than posted into
    ///      the zero address.
    function _activityChannels(ShowcaseLeg[] memory legs, address[] memory instances, SeedHandoff memory h)
        internal
        pure
        returns (ActivityChannel[] memory chans)
    {
        bool hasCypher = h.cypher404 != address(0);
        chans = new ActivityChannel[](hasCypher ? 12 : 11);
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
        if (hasCypher) {
            chans[n++] = ActivityChannel({
                channel: h.cypher404,
                label: "cypher-flagship",
                first: "this row graduates through the algebra rail instead of uniswap. same curve, different venue.",
                second: "its tithe lands in a cypher vault, which converts on the venue the target is curated for."
            });
        }
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

    /// @dev Post the showcase's activity as ONE batch. `postBatch` emits sequential message ids
    ///      starting at the registry's current `messageCount`, so the id a reply / quote / reaction
    ///      points at is computable before the batch is sent — which is what lets one transaction
    ///      carry a threaded conversation rather than needing a round trip per reference.
    ///
    ///      ORDER IS A DISPLAY DECISION. The home preview renders the LAST few messages, so the tail
    ///      of this batch is what a visitor reads first: it ends on the salon's posts, a reply and a
    ///      quote, with one reaction among them so the preview shows a typed badge too.
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

        // Endorsements carry no text on purpose: the app aggregates them into a count against the
        // message they target and never renders them as a row of their own.
        posts[n++] = _activityReact(chans[1].channel, midCurveAnchor);
        posts[n++] = _activityReact(chans[3].channel, graduatedAnchor);
        // A reply rides the SAME channel as the message it answers, which is what puts it inside
        // that collection's own feed rather than only on the board.
        posts[n++] = _activityReply(
            chans[1].channel, midCurveAnchor, "a reply carries the id of the post it answers. it threads under it here."
        );

        // The salon: a post filed under the poster's own address rather than a collection. This is
        // what the board's composer writes, and it is the channel the board opens on.
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

        // Post-condition, asserted against the registry rather than against the log: the batch is
        // the only writer in this transaction, so the counter must have advanced by exactly its size.
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

    /// @dev Create + arm helper shared by phase 1's rows. Kept here so the create parameters a row
    ///      does NOT vary (owner, preset, piece count, gating, free mint) are stated exactly once.
    ///
    ///      `name` is the row's DISPLAY name and `salt` is derived from the SLUG, so the identifier
    ///      the seed keys its hand-off by stays stable while the name the app shows is the roster's.
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

    // ══════════════════════════ WAVE 3 — VENUE KNOBS AND WIRING ══════════════════════════

    function _v4DepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_V4_DEPTH_WEI, DEFAULT_V4_DEPTH_WEI);
    }

    function _referenceDepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_REFERENCE_DEPTH_WEI, DEFAULT_REFERENCE_DEPTH_WEI);
    }

    function _zammDepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_ZAMM_DEPTH_WEI, DEFAULT_ZAMM_DEPTH_WEI);
    }

    function _algebraDepthWei() internal view returns (uint256) {
        return vm.envOr(ENV_ALGEBRA_DEPTH_WEI, DEFAULT_ALGEBRA_DEPTH_WEI);
    }

    function _zammVaultTitheWei() internal view returns (uint256) {
        return vm.envOr(ENV_ZAMM_VAULT_TITHE_WEI, DEFAULT_ZAMM_VAULT_TITHE_WEI);
    }

    function _cypherFillBps() internal view returns (uint256) {
        return vm.envOr(ENV_CYPHER_FILL_BPS, DEFAULT_CYPHER_FILL_BPS);
    }

    function _demoSwapWei() internal view returns (uint256) {
        return vm.envOr(ENV_DEMO_SWAP_WEI, DEFAULT_DEMO_SWAP_WEI);
    }

    function _depthHalfWidthTicks() internal view returns (int24) {
        return int24(uint24(vm.envOr(ENV_DEPTH_HALF_WIDTH_TICKS, uint256(uint24(DEFAULT_DEPTH_HALF_WIDTH_TICKS)))));
    }

    /// @dev The TWAP window the deployment's own validator was constructed with. Read off the
    ///      validator rather than restated here: the wall-clock wait this seed imposes and the window
    ///      the registry probes with must be the same number, and two copies of it would drift.
    function _twapWindow(Deployed memory d) internal view returns (uint32) {
        return ITwapWindowSource(d.priceValidator).twapSecondsAgo();
    }

    /// @dev The instant a seeded V3 reference pool can first answer `observe([window, 0])`, derived
    ///      from the observation the pool ITSELF holds.
    ///
    ///      Phase 1 cannot compute this. A forge script is simulated at ONE timestamp and only then
    ///      broadcast, so the instant phase 1 is able to record is the SIMULATION's, while the pool's
    ///      first observation is written when its creating transaction is actually mined — a whole
    ///      broadcast later. The recorded instant therefore under-states readiness by however long the
    ///      phase-1 broadcast ran, and `phase2NotBefore`'s slack is sized for block-time jitter rather
    ///      than for that offset, so which of the two is larger decides whether the pin succeeds.
    ///      Reading the pool back replaces that race with the only clock that is authoritative here:
    ///      `observe` reverts `OLD` for a target older than the oldest stored observation, so the
    ///      oldest observation plus the window IS the instant, exactly.
    ///
    ///      The oldest observation sits at `index + 1` once the ring has wrapped and at 0 until it
    ///      has; the `initialized` flag distinguishes the two. That is the same walk `Oracle.
    ///      observeSingle` performs before it decides whether to revert.
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
    ///      through. Native ETH is currency0 — address(0) sorts below every token address, so the
    ///      ordering holds without a comparison — and the tier is the deployment-wide one `DeployCore`
    ///      builds vault keys from, which is also the tier `BestRouteAcquirer` falls back to when no
    ///      quoter is wired. One pool, named by all three legs.
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
    ///      alignment token as token1, the network's `zammFeeOrHook`. Rebuilt here so the pool the
    ///      seed fills is provably the pool the vault will deposit into.
    function _zammVenueKey(address token, uint256 feeOrHook) internal pure returns (IZAMM.PoolKey memory) {
        return IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: token, feeOrHook: feeOrHook });
    }

    /// @dev The pending tithe a vault holds, across the two names the three families give it.
    ///
    ///      `UniAlignmentVault` and `CypherAlignmentVault` expose `totalPendingETH()`;
    ///      `ZAMMAlignmentVault` exposes `pendingETH()`. Probed rather than branched on a family flag
    ///      the seed would have to keep in step by hand — and a vault that answers NEITHER is refused
    ///      here rather than read as a zero, because a zero is also what "this vault held no tithe"
    ///      looks like and the two must not be confusable.
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

    // ── 3b. The staking STREAM (wave 3) ──

    struct StreamFacts {
        uint256 feeDelta; // ETH the instance actually received when it claimed its vaults' fees
        uint256 rewardRate; // the module's per-second rate after the delta was recorded
        uint256 periodFinish;
        uint256 totalStaked;
        uint256 nowTs;
    }

    /// @notice The staking stream is RUNNING, and it is running on a real LP-fee delta.
    /// @dev Wave 2 left this row's stream armed and unfunded and said so, because the module's only
    ///      funding path is a fee delta arriving through `claimAllFees` — and pushing ETH at it from a
    ///      fixture would fabricate the reward source rather than demonstrate it. Wave 3 funds it the
    ///      way the product does: the alignment vault holds a real LP position, a real swap on that
    ///      pool pays it a fee, and the claim moves that fee to the instance.
    ///
    ///      `feeDelta > 0` is the assertion that keeps this honest. Without it the remaining three
    ///      checks would pass on a stream started by any ETH from anywhere, which is exactly the shape
    ///      wave 2 declined to ship.
    function _assertStakingStream(StreamFacts memory f) internal pure {
        require(f.totalStaked > 0, "stream: nothing is staked (a stream nobody can accrue is not running)");
        require(f.feeDelta > 0, "stream: no fee delta arrived - the stream would have no earned source");
        require(f.rewardRate > 0, "stream: the module records no per-second rate");
        require(f.periodFinish > f.nowTs, "stream: the reward period has already finished");
    }

    // ── 3c. The VENUES (wave 3) ──

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
        uint256 venueLiquidity; // ACTIVE depth in the pool the acquire leg swaps through
        uint256 minVenueLiquidity;
        uint256 pendingBefore; // the tithe the vault held going into its convert
        uint256 pendingAfter;
        uint256 lpPositionValue; // what the convert itself reported
    }

    /// @notice One venue is LIVE: curated coherently, priced by a pinned reference, deep enough to
    ///         serve a convert, and proven by a convert that actually executed.
    ///
    /// @dev Three of these facts are the ones a venue quietly fails on, and none of them reads the
    ///      others. The ROUTE is what the Cypher vault refuses to convert against when it disagrees,
    ///      and what the app shows a visitor either way. The REFERENCE POOL is the price authority the
    ///      -5% floor reads; unpinned, the convert reverts before it reaches any pool. The ACTIVE
    ///      LIQUIDITY is the one a deposit figure cannot stand in for — a position minted outside the
    ///      current tick range reports units while adding none of the depth the swap needs.
    ///
    ///      The last three are the ones that make this an outcome rather than a configuration
    ///      listing: a tithe existed, the convert consumed it, and it reported a position. Drop the
    ///      convert and `pendingAfter < pendingBefore` goes red.
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

/// @dev The validator's own TWAP window. The wall-clock wait this seed imposes before it will pin a
///      freshly-created reference pool and the window the registry probes that pool with have to be
///      the same number, so it is read from the deployment rather than restated in the seed.
interface ITwapWindowSource {
    function twapSecondsAgo() external view returns (uint32);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//                     WAVE 3 — THE VENUES: EXTERNAL SURFACES AND THE TWO SEEDERS
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// A venue is not a configuration flag. Three separate things have to be true before a vault's
// convert can execute, and none of them reads the others:
//
//   · the ACQUIRE ROUTE — the venue the registry curates for this (target, token);
//   · the REFERENCE POOL — the price authority the vault's -5% oracle floor reads, which must be a
//     {token, WETH} pool that can already serve a TWAP over the deployment's window; and
//   · the venue POOL ITSELF, holding enough depth that a demo-sized buy prices inside that floor.
//
// The floor is never touched. What the seeders below change is the POOL: the showcase's alignment
// assets are fixture tokens this deployment mints, so the market that prices them is ours to stand
// up — and a testnet demonstration of what a vault DOES needs a market for the vault to do it in.
// That is market plumbing, and it is distinct from the reward source the staking row still refuses
// to fabricate (which stays a real LP-fee delta from a real swap; see `SeedSepoliaBuys`).

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

/// @dev Minimal WETH surface. The V4 and ZAMM venues are NATIVE-ETH pools; the reference pool and the
///      Algebra venue are WETH pairs, so exactly the ETH those consume is wrapped and nothing else.
interface IWethMinimal {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The fixture-token surface the seed uses. These are the deployment's OWN `MockERC20`s, minted
///      by this seed — which is why the token leg of every venue is minted rather than bought. There
///      is no deep pool on this network to buy a fixture asset from, and inventing one to buy from
///      would be the same fabrication one step removed.
interface IFixtureToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The Algebra pool's ACTIVE in-range depth. Declared here rather than added to the shared
///      `IAlgebraPool` because it is a seed-side read: what a convert swaps through is the liquidity
///      at the current tick, and a deposit figure cannot stand in for it.
interface IAlgebraPoolLiquidity {
    function liquidity() external view returns (uint128);
}

/// @dev The owner-only registry setters the venue wiring drives. Declared here rather than imported
///      from the concrete registry so the seed states exactly the three calls it makes.
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

/// @dev The reads a vault is checked through after it is wired. Every member here is a public getter
///      on ALL THREE vault families — the two that are not (the pending-tithe read and the convert)
///      are handled explicitly below rather than assumed into this interface.
interface IVenueVaultView {
    function alignmentToken() external view returns (address);
    function alignmentTargetId() external view returns (uint256);
    function priceValidator() external view returns (address);
}

/// @dev The convert, as the Uniswap and Cypher families expose it: one slippage bound, floored by the
///      vault to an oracle-derived minimum.
interface IVenueVaultConvert {
    function convertAndAddLiquidity(uint256 minOutTarget) external returns (uint256 lpPositionValue);
}

/// @dev The convert, as the ZAMM family exposes it. Its LP add is a paired deposit rather than a
///      range position, so it carries two further minimums for the deposit legs. Declared separately
///      rather than folded into one interface: the two signatures are genuinely different calls, and
///      a single interface would only be able to express one of them.
interface IZammVaultConvert {
    function convertAndAddLiquidity(uint256 minTokenOut, uint256 minEth, uint256 minToken)
        external
        returns (uint256 lpMinted);
}

/// @notice Stands up the Uniswap V3 {token, WETH} pool the vault's oracle floor reads as its price
///         authority, and holds the position it mints.
///
///         ── WHY THE SHOWCASE MINTS ITS OWN REFERENCE POOL ──
///
///         The floor is derived from a pinned pool's own TWAP, which is the correct design: an
///         attacker cannot move a time-weighted price inside one transaction. It presumes a pool
///         exists. The showcase's alignment assets are FIXTURE tokens minted by this deployment, so
///         nothing on this network prices them until this deployment prices them. Standing the pool
///         up is therefore part of standing the asset up; it is not a way around the floor, and the
///         floor is left exactly as deployed.
///
///         ── THE TWAP IS A WALL-CLOCK COST, NOT A CALL ──
///
///         `setReferencePool` probes `observe([window, 0])` before it will accept a pool, and a pool
///         initialized moments ago has no observation old enough to answer that. So this contract
///         only CREATES and SEEDS the pool; the pin happens a full window later, in phase 2, after
///         the orchestrator has waited the window out in real time. There is no fast-forward on a
///         public testnet — the wait is the mechanism.
///
///         The position is minted under this contract and left. There is no withdraw path, which is
///         deliberate: the reference pool's depth should not be removable by a demo action.
contract SepoliaReferencePoolSeeder {
    error NotOwner();
    error NotPool();
    error PoolPairMismatch();
    error NoLiquidityMinted();

    /// @dev 1:1. The fixture asset has no prior price, so the price it is stood up at is a choice —
    ///      and parity with ETH is the choice that makes every other number in the showcase readable
    ///      by eye. The V4 and ZAMM venues are seeded at the same parity, so the curated reference and
    ///      the executed venue agree and the -5% floor has real headroom rather than a permanent skew.
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
        // Widen the observation ring so the pool keeps history once anything trades on it. The pin a
        // window from now does not depend on this — an untraded pool answers from its single
        // initialization observation — but a pool that is traded and cannot remember is a reference
        // that stops working the moment it becomes interesting.
        pool.increaseObservationCardinalityNext(cardinality);

        // Both legs, at the parity the pool was initialized at: the ETH the caller sent, wrapped, and
        // the same nominal amount of the fixture token, minted.
        uint256 ethLeg = msg.value;
        weth.deposit{ value: ethLeg }();
        token.mint(address(this), ethLeg);

        (, int24 tick,,,,,) = pool.slot0();
        (int24 tickLower, int24 tickUpper) = _range(tick, tickSpacing, halfWidthTicks);

        // At parity the two legs are equal in nominal terms, so which side sorts first does not
        // change the amounts offered — only the callback's payment does, and that reads the ordering
        // for itself.
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
///         This is the Sepolia analog of the depth seeder the mainnet-fork seed uses, and it differs
///         in exactly one place. On a mainnet fork the token leg is BOUGHT on a deep same-pair V3
///         pool, because the alignment asset is a real coin with a real market. On this network the
///         alignment asset is a fixture this deployment minted, and there is no deep pool to buy it
///         from — so the leg is MINTED. That is a structural difference between a fork of a live
///         market and a network where the asset begins with the deployment, not a weakening of the
///         pattern: what both do is put real two-sided liquidity into the pool the acquire leg swaps
///         through, so the executed buy prices inside the vault's -5% floor.
///
///         The position is minted under this contract with a zero salt and left. There is no withdraw
///         path, for the same reason the reference pool has none.
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

    /// @dev V4 unlock callback — the house pattern: price the liquidity off the pool's live sqrt
    ///      price, mint it, then settle debts and take credits with `CurrencySettler`.
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
