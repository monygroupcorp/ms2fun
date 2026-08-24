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
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { IERC20Minimal } from "v4-core/interfaces/external/IERC20Minimal.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { CurrencySettler } from "../src/libraries/v4/CurrencySettler.sol";
import { LiquidityAmounts } from "../src/libraries/v4/LiquidityAmounts.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

/// @dev Minimal Solady-Ownable surface — instances + registries all expose this single-step transfer.
interface IOwnable {
    function transferOwnership(address newOwner) external payable;
}

/// @dev The endowment vault's payout sink. Read back so a collection cannot be bound to a vault that
///      pays somewhere other than the artist the registry pinned.
interface IEndowmentPayout {
    function communityPayout() external view returns (address);
}

/// @dev The one read the art acceptance test needs, on either token surface (the DN404 mirror for a
///      bonding instance, the instance itself for an auction collection).
interface IPieceURI {
    function tokenURI(uint256 tokenId) external view returns (string memory);
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
///         WHY THE PINNED VENUE IS THE V4 TIER, AND WHAT HAD TO BE TRUE FIRST. The pin names the SAME
///         pool the registry curates as the acquire route and the same pool the vault LPs into: the
///         native-ETH 1% / tickSpacing-200 tier. That is only a legal answer while the pool can serve a
///         demo-sized buy inside the vault's oracle floor, and on a bare mainnet fork it cannot — the
///         tier carries a small fraction of the depth the same-fee V3 pool does, so a tenth-of-an-ETH
///         buy prices far enough under the reference TWAP to trip `Slippage()`. `AnvilV4DepthSeeder`
///         (below) is what makes the pin valid: the seed adds real two-sided liquidity to that pool
///         before anything converts. The floor is untouched — the pool is made worthy of it, not the
///         other way round. FLIPPING THIS PIN BACK WITHOUT REMOVING THE DEPTH SEED, OR REMOVING THE
///         DEPTH SEED WITHOUT FLIPPING THIS PIN, BREAKS THE PAIRING: they are one change.
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
        // `PINNED_FEE_BPS` = 100 -> `BestRouteAcquirer` executes `swapV4(fee 10000, tickSpacing 200)`:
        // it multiplies the bps by 100 for the pool fee and maps 100 bps -> spacing 200. That is the
        // exact pool the registry curates and the depth seed fills.
        best = Quote({ source: AMM.UNI_V4, feeBps: PINNED_FEE_BPS, amountIn: swapAmount, amountOut: 1 });
        quotes = new Quote[](1);
        quotes[0] = best;
    }
}

/// @dev The two calls the depth seed makes on the deep same-pair Uniswap V3 pool it sources the token
///      leg from, plus the pair read the constructor validates the wiring with.
interface IUniswapV3PoolMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @dev Minimal WETH surface. The V4 pool is native-ETH; the V3 pool the token leg is bought on is a
///      WETH pair, so the seeder wraps exactly the ETH it spends there and nothing else.
interface IWETHMinimalDeposit {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice ANVIL-ONLY LIQUIDITY SEEDER for the alignment target's Uniswap V4 acquire pool.
///
///         WHY IT EXISTS. The registry curates a native-ETH V4 tier as the target's acquire venue and
///         the vault LPs into that same tier, but on a bare mainnet fork the tier is thin: a
///         demo-sized ETH -> token buy prices far enough under the reference TWAP that the vault's
///         oracle floor (`UniAlignmentVault._floorTokenOut`, -5%) reverts the convert. This contract
///         gives the pool the depth the curated route already claims, so the executed buy and the
///         curated venue are the same pool. It does NOT touch the floor, the reference pool, or the
///         vault's own pool key — the pool is made worthy of the floor, not the floor loosened.
///
///         HOW THE TOKEN LEG IS SOURCED. A two-sided position needs the alignment token, and the seed
///         has only ETH. It buys the token leg on the deep same-pair V3 pool, which is the honest way
///         to obtain it on a fork: real tokens at a real price, no balance fabrication. That buy makes
///         the token slightly more expensive on the reference pool, which moves the vault's oracle
///         floor DOWN (the floor is a minimum token-out derived from the reference price), so it can
///         never be the thing that causes a later convert to breach.
///
///         THE POSITION IS PERMANENT AND UNOWNED IN PRACTICE. There is no withdraw path here: the
///         position is minted under this contract with a zero salt and left. That is deliberate — the
///         fork's depth should not be removable by a demo action, and a seeder that could pull it
///         would be a bigger surface than the one thing it is for.
///
///         ANVIL ONLY. Nothing about this belongs on a live network, where the pool's depth is the
///         market's business and not the deployer's.
contract AnvilV4DepthSeeder is IUnlockCallback {
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error NotOwner();
    error NotPoolManager();
    error NotSourcePool();
    error SourcePoolPairMismatch();
    error TokenNotInPoolKey();
    error NoTokenAcquired();
    error NoLiquidityMinted();

    /// @notice Callback payload for the single `unlock` this contract ever performs.
    struct AddLiquidityCallbackData {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
    }

    IPoolManager public immutable poolManager;
    /// @notice The deep same-pair Uniswap V3 pool the token leg is bought on.
    IUniswapV3PoolMinimal public immutable sourcePool;
    IWETHMinimalDeposit public immutable weth;
    /// @notice The alignment token being paired with native ETH in the V4 pool.
    address public immutable token;
    /// @notice The account that deployed this seeder; the only caller, and where residue is returned.
    address public immutable owner;
    /// @dev Orientation of the V3 source pool, resolved once so the swap direction is never guessed.
    bool private immutable _tokenIsSourceToken0;

    constructor(IPoolManager poolManager_, IUniswapV3PoolMinimal sourcePool_, address weth_, address token_) {
        poolManager = poolManager_;
        sourcePool = sourcePool_;
        weth = IWETHMinimalDeposit(weth_);
        token = token_;
        owner = msg.sender;

        address t0 = sourcePool_.token0();
        address t1 = sourcePool_.token1();
        bool tokenIsT0 = t0 == token_;
        if (!tokenIsT0 && t1 != token_) revert SourcePoolPairMismatch();
        if ((tokenIsT0 ? t1 : t0) != weth_) revert SourcePoolPairMismatch();
        _tokenIsSourceToken0 = tokenIsT0;
    }

    /// @dev Residue returns here from the pool manager (`take`) and from the router-free V3 leg.
    receive() external payable { }

    /// @notice Buy the token leg on the deep V3 pool and add the pair as a concentrated V4 position
    ///         centred on the V4 pool's current tick.
    /// @param key The V4 pool key to deposit into — native ETH on one side, `token` on the other.
    /// @param halfWidthTicks Half-width of the position, in ticks, before alignment to `tickSpacing`.
    ///        A symmetric-in-ticks range is symmetric in log price, so the two legs carry equal value
    ///        and an even ETH split across them is the right split.
    /// @return liquidity The liquidity units minted.
    /// @return ethUsed Native ETH the position actually pulled.
    /// @return tokenUsed Alignment token the position actually pulled.
    function seedDepth(PoolKey calldata key, int24 halfWidthTicks)
        external
        payable
        returns (uint128 liquidity, uint256 ethUsed, uint256 tokenUsed)
    {
        if (msg.sender != owner) revert NotOwner();
        bool tokenIsCurrency1 = Currency.unwrap(key.currency1) == token;
        if (!tokenIsCurrency1 && Currency.unwrap(key.currency0) != token) revert TokenNotInPoolKey();

        // ── The token leg, bought on the deep pool ───────────────────────────────────────────────
        uint256 ethForToken = msg.value / 2;
        weth.deposit{ value: ethForToken }();
        bool zeroForOne = !_tokenIsSourceToken0; // WETH is the input, so its side is the `zeroFor`.
        sourcePool.swap(
            address(this),
            zeroForOne,
            int256(ethForToken), // positive = exact input
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            ""
        );
        uint256 tokenHeld = IERC20Minimal(token).balanceOf(address(this));
        if (tokenHeld == 0) revert NoTokenAcquired();

        // ── The position, centred on the V4 pool's own current tick ──────────────────────────────
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 tickLower = _alignedTick(tick - halfWidthTicks, key.tickSpacing);
        int24 tickUpper = _alignedTick(tick + halfWidthTicks, key.tickSpacing);
        int24 minTick = TickMath.minUsableTick(key.tickSpacing);
        int24 maxTick = TickMath.maxUsableTick(key.tickSpacing);
        if (tickLower < minTick) tickLower = minTick;
        if (tickUpper > maxTick) tickUpper = maxTick;

        uint256 ethHeld = address(this).balance;
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

        // ── Residue back to the caller: a position never pulls both legs to the last wei ─────────
        uint256 tokenLeft = IERC20Minimal(token).balanceOf(address(this));
        if (tokenLeft != 0) IERC20Minimal(token).transfer(owner, tokenLeft);
        uint256 ethLeft = address(this).balance;
        if (ethLeft != 0) SafeTransferLib.safeTransferETH(owner, ethLeft);
    }

    /// @dev V4 unlock callback. Mirrors the house pattern (`ProtocolOwnedLiquidityV1._handleDeployPOL`,
    ///      `LiquidityDeployerModule.unlockCallback`): price the liquidity off the pool's live sqrt
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

    /// @dev Uniswap V3 swap callback. The only debt this contract can owe here is the WETH leg it
    ///      just wrapped — the token side of an exact-input buy is a credit, never a debt.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != address(sourcePool)) revert NotSourcePool();
        int256 owed = _tokenIsSourceToken0 ? amount1Delta : amount0Delta;
        if (owed > 0) weth.transfer(msg.sender, uint256(owed));
    }

    /// @dev Round a tick DOWN to the pool's spacing (floor division, negative ticks included).
    function _alignedTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        return compressed * spacing;
    }
}

/// @notice The artist-exaltation fixtures the anvil deployment and the seed must agree on.
///
///         Both sides need the same three things per artist — a slug, a display title, and a payout
///         address — and they are computed here so a rename in one file cannot leave the other
///         pointing at a payout nobody reads. `DeployAnvil` registers the targets and hands each
///         payout to the registry; the seed reads them back off the deployed vault and refuses to
///         proceed if they disagree.
///
///         THE PAYOUT IS A DERIVED FIXTURE. It is keyed off the SLUG, not off a deployed token
///         address, so it is the same address on every reseed of the fork. No real person's address
///         appears in this seed, and none should ever be substituted here.
library ArtistEndowments {
    string internal constant PARADILF_SLUG = "paradilf-fan-club";
    string internal constant PETRAVOICE_SLUG = "petravoice";
    string internal constant PARADILF_TITLE = "Paradilf Fan Club";
    string internal constant PETRAVOICE_TITLE = "Petravoice";
    string internal constant PARADILF_SYMBOL = "PDLF";
    string internal constant PETRAVOICE_SYMBOL = "PTRA";

    /// @dev Same derivation shape the deployment already uses for a community payout, keyed off the
    ///      artist slug. Deterministic, reproducible across reseeds, and owned by nobody.
    function payout(string memory slug) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("ms2.artist", slug)))));
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
    // Resolved off mainnet before they were wired here, by the same test both of the two above pass:
    // `tokenURI(1)` and `tokenURI(7)` are `ipfs://<cid>/1` and `ipfs://<cid>/7`, i.e. content-addressed
    // storage addressed by the BARE token id. That is the exact shape `base + tokenId` reproduces, so
    // the seeded pieces resolve to the real art with no re-hosting and no third-party host in the path.
    // A collection that had answered from a domain would have taken an ART_BASE_* stand-in instead,
    // the way the flagship does — the test is the URI's shape, never the collection's fame.
    string internal constant ART_BASE_BOREDMILADY = "ipfs://QmZ7K6hG5uiTvLVvmxZgm72Nv3kmvTq4CVAEG6JoMFvpkW/";
    string internal constant ART_BASE_LAWBSTERS = "ipfs://bafybeibvgwjwuosoov6cfgwoyyrt7vocalqoprjayni6rfepda7bi2jdse/";
    // NO real base for the flagship curve or the free-mint editions, DELIBERATELY. Those collections
    // serve their metadata from a live third-party domain rather than from content-addressed storage.
    // Wiring a domain here would make the local fork's art depend on somebody else's uptime and would
    // point our traffic at their host, so those instances take one of the ART_BASE_* constants above
    // and the substitution is stated in their on-chain description. Do not "improve" this back.

    // ── THE ALIGNMENT CATALOG ROSTER ────────────────────────────────────────────────────────
    //
    // READ THIS BEFORE CHANGING A NUMBER BELOW, AND READ IT BEFORE ADDING AN ASSERTION.
    //
    // THE ROSTER IS A SET OF EXAMPLES, NOT A MEASUREMENT. Several seeded collections stand in for
    // real, recognisable collections, and being recognisable is the whole of their job. The figures
    // below are ILLUSTRATIVE: they are the flavour a real collection's shape gives an armed curve,
    // they read well, and they cost nothing. They are never presented as verified, no copy may imply
    // a visitor can re-derive them from chain, and no assertion may be written that forces the seed
    // to spend ETH making one exact. An arming value is free; buying a curve out to honour one is not.
    //
    // WHAT THE SEED DOES ASSERT is wiring: that the preset the seed registered is the preset the
    // instance got, that a row is bound to the vault it names, and that the ART RESOLVES. Those are
    // real failure modes and they are independent of whether any figure is exact.
    //
    // THE INFRASTRUCTURE IS OURS TO INVENT. Pools, quoters, presets, clocks, fixture tokens and
    // truncated edition sizes are all fabricated to fit a local fork, and every fabrication is stated
    // on chain in the instance's own metadata.

    // Flagship curve. Armed at the size the real collection suggests; the seed buys a FRACTION of it.
    uint256 constant SCHIZO_REAL_SUPPLY = 5555;
    uint256 constant SCHIZO_REAL_RAISE = 320.1691 ether;
    // Mid-curve exemplar — the instance the site's live features are demonstrated on.
    uint256 constant PIXELADY_REAL_SUPPLY = 10_000;
    uint256 constant PIXELADY_REAL_RAISE = 106 ether;
    // Second mid-curve row: a large, widely-recognised collection the roster was missing.
    uint256 constant BOREDMILADY_REAL_SUPPLY = 6911;
    uint256 constant BOREDMILADY_REAL_RAISE = 223.08 ether;
    // THE READY-TO-GRADUATE ROW IS THE SMALL ONE, deliberately. A small raise can be bought out in
    // full for a couple of ETH, so the graduate action is live on the seeded chain instead of being
    // a posture that costs three hundred ETH to hold. The graduation itself is left UNCROSSED — a
    // visitor performs it.
    uint256 constant LAWBSTERS_REAL_SUPPLY = 420;
    uint256 constant LAWBSTERS_REAL_RAISE = 5.96 ether;
    // Auction collection — the family that can express the 80% endowment (the 80/19/1 leg is
    // `splitMintFor(amount, liquidityFamily = false)`, reachable from the ERC-1155 and ERC-721
    // settlement paths only; ERC404 graduation has no family branch and cannot express it).
    uint256 constant FIGMATA_REAL_SUPPLY = 180;

    // Curve presets. `LaunchManager` accepts ANY `targetETH` — the 5/25/50 ETH menu is three
    // registered presets, not a protocol ceiling — so a catalog-sized raise needs no contract change,
    // only its own preset. Ids start at 10 to leave the protocol's 0-2 (and room to grow) untouched;
    // everything except `targetETH` is carried over from the STANDARD preset so a seeded curve
    // differs from a production one in SIZE ONLY.
    uint8 constant PRESET_SOURCE = 1; // STANDARD — the preset every other seeded instance uses
    uint8 constant PRESET_SCHIZO = 10;
    uint8 constant PRESET_PIXELADY = 11;
    uint8 constant PRESET_BOREDMILADY = 12;
    uint8 constant PRESET_LAWBSTERS = 13;

    // ── THE ARTIST ENDOWMENTS ───────────────────────────────────────────────────────────────
    //
    // Two alignment targets that are not communities behind a token: they are individual artists,
    // each with an Aave endowment vault. `AlignmentEndowmentVault` buys nobody's token — it is a
    // yield engine (ETH -> WETH -> Aave waEthWETH) whose `harvest()` splits yield between a
    // benefactor's claimable purse and the target's `communityPayout`. Its `alignmentToken` field
    // exists only to satisfy `registerVault`'s check, so each artist target carries a FIXTURE ERC20
    // that is registry paperwork and nothing else, labelled as a fixture wherever it is described.
    //
    // WHY THIS IS THE POINT AND NOT A SIDE QUEST. Three alignment targets where one is a large
    // community token and two are individual artists is the argument the seeded target list makes on
    // its own: the platform is not a Remilia-alignment tool that happens to be general, it is an
    // artist-exaltation tool and Remilia is one instance of it. It also describes what this vault
    // family actually does, which the earlier "buy the community's token and hold it as liquidity"
    // framing did not — `AaveEndowment` has no swap path at all.
    //
    // The payout addresses are DERIVED FIXTURES, not people. They are keyed off a fixed slug rather
    // than off a deployed address so they are reproducible across reseeds, and no real person's
    // address is used anywhere in this seed.
    uint256 internal constant TARGET_ID_MS2 = 1;
    uint256 internal constant TARGET_ID_CULT = 2;
    uint256 internal constant TARGET_ID_PARADILF = 3;
    uint256 internal constant TARGET_ID_PETRAVOICE = 4;

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
        address paradilfVault; // the first artist target's Aave endowment vault
        address petravoiceVault; // the second artist target's Aave endowment vault
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
        address boredmilady; // CATALOG mid-curve — the second large collection on the roster
        address lawbsters; // CATALOG small collection — bought out, graduation left uncrossed
    }

    /// @dev The non-ERC404 catalog instances phase 2 still has work to do on. The ERC-1155 tranche is
    ///      absent on purpose: those are created, editioned and featured entirely in phase 1 and phase 2
    ///      owes them nothing but the ownership handover, which rides the `all` array.
    struct SeededCatalog {
        address figmata; // ERC721 AUCTION bound to CULT's Aave endowment vault (the 80% endowment leg)
        address paradilf; // ERC721 AUCTION whose settlements endow the first artist
        address petravoice; // ERC721 AUCTION whose settlements endow the second artist
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
        d.paradilfVault = _readEndowmentVaultForTarget(json, TARGET_ID_PARADILF);
        d.petravoiceVault = _readEndowmentVaultForTarget(json, TARGET_ID_PETRAVOICE);
    }

    /// @dev The Aave endowment vault deployed under one alignment target id. The artist targets carry
    ///      no LP vault at all — an endowment is escrowed principal streaming yield to a payout, and
    ///      there is no liquidity leg to deploy — so the family filter is what makes the read exact
    ///      rather than merely first-matching. Reverts rather than returning zero: a seed that bound a
    ///      collection to address(0) would create instances whose settlements route nowhere.
    function _readEndowmentVaultForTarget(string memory json, uint256 targetId) internal view returns (address vault) {
        bytes32 aaveType = keccak256(bytes("AaveEndowment"));
        string memory vaults = vm.parseJsonString(json, ".vaults");
        for (uint256 i = 0; i < 64; i++) {
            string memory at = string.concat("[", vm.toString(i), "]");
            if (!vm.keyExistsJson(vaults, at)) break;
            if (vm.parseJsonUint(vaults, string.concat(at, ".targetId")) != targetId) continue;
            if (keccak256(bytes(vm.parseJsonString(vaults, string.concat(at, ".type")))) != aaveType) continue;
            return vm.parseJsonAddress(vaults, string.concat(at, ".address"));
        }
        revert("anvil.json: no Aave endowment vault is registered under the expected artist target");
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
        vm.serializeAddress(inner, "boredmilady", s.boredmilady);
        vm.serializeAddress(inner, "lawbsters", s.lawbsters);
        vm.serializeAddress(inner, "paradilf", k.paradilf);
        vm.serializeAddress(inner, "petravoice", k.petravoice);
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
        s.boredmilady = vm.parseJsonAddress(json, ".instances.boredmilady");
        s.lawbsters = vm.parseJsonAddress(json, ".instances.lawbsters");
        k.paradilf = vm.parseJsonAddress(json, ".instances.paradilf");
        k.petravoice = vm.parseJsonAddress(json, ".instances.petravoice");
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
        require(s.boredmilady != address(0), "seed state: boredmilady missing");
        require(s.lawbsters != address(0), "seed state: lawbsters missing");
        require(k.paradilf != address(0), "seed state: paradilf endowment collection missing");
        require(k.petravoice != address(0), "seed state: petravoice endowment collection missing");
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

    // ─────────────────────── The art acceptance test ───────────────────────
    //
    // A SEEDED INSTANCE WHOSE ART DOES NOT RENDER IS A FAILED SEED, whatever its economics say. That
    // makes these the seed's primary post-conditions rather than a nicety, and they are `require`s in
    // both phases for the same reason every other post-condition is: forge simulates a script before
    // broadcasting any of it, so a base that would 404 costs a named failure instead of a fork full of
    // blank tiles nobody notices until a demo.
    //
    // The failure this catches is not exotic. A per-piece base composes as `base + tokenId` with NO
    // separator, so a base missing its trailing slash silently addresses `<cid>7` instead of `<cid>/7`,
    // and a base carrying two produces `//7`, which some gateways serve and others do not.

    /// @dev A per-piece metadata base must be content-addressed, must end in exactly one slash, and
    ///      must not still be carrying a placeholder.
    function _assertPieceBase(string memory base, string memory label) internal pure {
        bytes memory b = bytes(base);
        require(b.length > 8, string.concat("art: ", label, " has no per-piece base URI"));
        require(_startsWith(base, "ipfs://"), string.concat("art: ", label, " base is not content-addressed"));
        require(b[b.length - 1] == "/", string.concat("art: ", label, " base has no trailing slash"));
        require(b[b.length - 2] != "/", string.concat("art: ", label, " base ends in a double slash"));
        require(!_contains(base, "TODO"), string.concat("art: ", label, " base still carries a placeholder"));
    }

    /// @dev The COMPOSED pointer, read back off the token rather than recomputed from the same string
    ///      twice: `base + tokenId`, exactly, with nothing dropped and nothing doubled. Only valid on
    ///      an instance with no metadata resolver wired — a resolver is entitled to answer with
    ///      something else, which is what the stacked instance exists to show.
    function _assertComposedPieceURI(address token, string memory base, uint256 tokenId, string memory label)
        internal
        view
    {
        string memory expected = string.concat(base, vm.toString(tokenId));
        require(
            keccak256(bytes(IPieceURI(token).tokenURI(tokenId))) == keccak256(bytes(expected)),
            string.concat("art: ", label, " does not compose its piece URI to the intended pointer")
        );
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
}
