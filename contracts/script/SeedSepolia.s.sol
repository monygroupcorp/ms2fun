// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import {
    SeedSepoliaShared,
    IShowcaseCurveState,
    IMerkleGatingView,
    IShowcaseTierState,
    IAlignmentRouteAdmin,
    IUniswapV3PoolMinimal,
    IWethMinimal,
    SepoliaReferencePoolSeeder,
    SepoliaV4DepthSeeder,
    IVenueVaultView
} from "./SeedSepoliaShared.sol";
import { IZAMM } from "../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { ZAMMAlignmentVaultFactory } from "../src/vaults/zamm/ZAMMAlignmentVaultFactory.sol";
import { CypherAlignmentVaultFactory } from "../src/vaults/cypher/CypherAlignmentVaultFactory.sol";
import { IAlgebraFactory, IAlgebraPool, IAlgebraNFTPositionManager } from "../src/interfaces/algebra/IAlgebra.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { IDynamicPricingModule } from "../src/factories/erc1155/interfaces/IDynamicPricingModule.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { IMerkleGatingModule, MerkleConfig } from "../src/gating/IMerkleGatingModule.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { AlignmentRegistryV1 } from "../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { UniAlignmentVaultFactory } from "../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { IVaultPriceValidator } from "../src/interfaces/IVaultPriceValidator.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/// @notice Sepolia showcase seed, PHASE 1: alignment wiring, then CREATE + ARM every ERC404 row.
///         Buys nothing.
///
///         Run against the deployment `DeploySepolia` wrote (`deployments/sepolia.json`); every
///         address is read from that file rather than declared here.
///
///         ── WHY THIS BUYS NOTHING ──
///         `setBondingOpenTime` rejects a non-future timestamp and `buyBonding` reverts `TooEarly`
///         before it, and forge simulates an entire script at ONE timestamp before broadcasting any
///         of it. One script therefore cannot both arm a curve and buy into it. Phase 2
///         (`SeedSepoliaBuys.s.sol`) runs after the arm window has actually elapsed in wall-clock
///         time — see `app/scripts/sepolia-seed/` for the orchestrator that waits it out.
///
///         ── WHAT IT COSTS ──
///         Creating and arming a curve moves no ETH: the create call carries no value (the deploy
///         bond lever ships off) and every other call here is a write. Phase 1's cost is gas.
///
///         Run with:
///           forge script script/SeedSepolia.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepolia is SeedSepoliaShared {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev How many slots the wall rents. Stated as a constant because the projection is printed
    ///      BEFORE the rows exist — `_seedFeaturedWall` asserts it renders exactly this many, so the
    ///      number the operator was shown and the number that was spent cannot diverge.
    uint256 internal constant FEATURED_SLOTS = 4;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepolia: not running against Sepolia (or a fork of it)");

        // The featured wall is the only ETH this phase spends that is priced by TIME rather than by
        // depth, so its total is quoted off the deployed queue and printed with the rest — before
        // `--broadcast` sends anything, which is the only moment the number can still change a mind.
        _reportSpend("phase 1 (create + arm)", 0, _quoteFeaturedSpend(d, FEATURED_SLOTS), deployer.balance);

        // ── Alignment wiring: fixture tokens, targets, vaults, pools ──
        SeedHandoff memory h = _seedAlignment(d);

        // ── The other two venues, each with its own target, vault and pool ──
        _seedZammVenue(d, h);
        _seedCypherVenue(d, h);

        // The instant every pool seeded above can first answer the deployment's TWAP window. Phase 2
        // pins the reference pools, and `setReferencePool` refuses a pool that cannot yet serve one.
        h.referenceReadyAt = block.timestamp + _twapWindow(d);

        // ── The ERC404 roster: create + arm, nothing bought ──
        ShowcaseLeg[] memory legs = _showcaseRoster();
        address[] memory instances = new address[](legs.length);
        uint256 armWindow = _armWindow();
        uint256 maturityOffset = _maturityOffset();
        uint256 latestArm;

        for (uint256 i = 0; i < legs.length; i++) {
            _assertPieceBase(legs[i].pieceBase, legs[i].slug);
            (address inst, uint256 armedUntil) = _createAndArm(d, legs[i], h.ms2Vault, armWindow, maturityOffset);
            instances[i] = inst;
            if (armedUntil > latestArm) latestArm = armedUntil;
            console.log(string.concat("ARMED ", legs[i].slug), inst);
        }

        // ── The breadth rows: every other project type and mechanism ──
        //
        // Runs AFTER the curve roster because two of its rows bind to the alignment vaults the wiring
        // above stood up, and because its own clock (the timed auction) has to join the same wait.
        uint256 breadthClock = _seedBreadth(d, h);
        if (breadthClock > latestArm) latestArm = breadthClock;

        // The Cypher flagship, created and armed on the same clock as everything else. It graduates
        // through the Algebra rail in phase 2, which is what puts a real tithe in the Cypher vault.
        uint256 cypherArm = _seedCypherCollection(d, h);
        if (cypherArm > latestArm) latestArm = cypherArm;

        // ── The front door: rent the wall the home page renders ──
        //
        // LAST in the phase, because every slot names an instance and an instance has to be created
        // and registered before the queue will accept it.
        _seedFeaturedWall(d, h, legs, instances);

        // Phase 2 becomes legal only once the LAST clock phase 1 set has passed, plus slack for the
        // wall-clock the broadcast itself consumed. Recorded rather than recomputed later, so the
        // orchestrator waits for the same instant the chain will judge the buys against.
        //
        // THE TWAP WINDOW IS ONE OF THOSE CLOCKS. Phase 2 pins the reference pools this phase created,
        // and a pool cannot answer a window-long TWAP until a window has passed. On a chain that
        // cannot be fast-forwarded that is wall-clock time, so it joins the same wait rather than
        // becoming a second one somebody has to know about.
        if (h.referenceReadyAt > latestArm) latestArm = h.referenceReadyAt;
        h.phase2NotBefore = latestArm + _phase2Slack();

        _assertPhase1(legs, instances);
        _assertBreadthPhase1(d, h);
        _assertVenuesPhase1(d, h);
        _assertFeaturedPhase1(d, h);
        _writeSeedState(legs, instances, h);

        console.log("=== SeedSepolia (phase 1: create + arm) complete ===");
        console.log("  rows armed:", legs.length);
        console.log("  featured slots rented / total spend (wei):", h.featured.length, h.featuredSpendWei);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("  phase 2 is legal from (unix):", h.phase2NotBefore);
        console.log("  wall-clock wait from now (seconds):", h.phase2NotBefore - block.timestamp);
        console.log("  NEXT: wait out the window, then run SeedSepoliaBuys.s.sol");
    }

    // ─────────────────────── Alignment targets, vaults, pools ───────────────────────

    /// @dev Two fixture alignment assets, and one alignment TARGET per (asset, venue).
    ///
    ///      ── WHY THE TOKENS ARE FIXTURES, AND WHY THAT IS THE DEMONSTRATION ──
    ///
    ///      The tokens are `MockERC20`s this seed mints. That is the showcase: a testnet exists to
    ///      show what the product does, and what it does is take a collection's alignment tithe,
    ///      acquire the target's asset on a curated venue, and LP the pair. Aligning to a real
    ///      third-party testnet token would demonstrate none of that better and would read as a claim
    ///      about that token. Every target's on-chain description says the asset is a fixture.
    ///
    ///      ── WHY ONE ASSET CARRIES MORE THAN ONE TARGET ──
    ///
    ///      The registry stores ONE acquire route per (targetId, token), and a Cypher vault refuses to
    ///      convert unless the route it reads says ALGEBRA. So a single target cannot carry a live
    ///      Uniswap convert and a live Cypher convert for the same asset — and pointing a vault at a
    ///      venue the registry curates as something else is precisely the divergence the acquire route
    ///      exists to close. Each venue therefore gets its own target, each internally coherent: its
    ///      route, its reference pool and its vault all name the same venue. Presenting two targets
    ///      over one asset as ONE row with a venue choice is the picker's job, not the registry's.
    function _seedAlignment(Deployed memory d) internal returns (SeedHandoff memory h) {
        AlignmentRegistryV1 registry = AlignmentRegistryV1(d.alignmentRegistry);
        UniAlignmentVaultFactory factory = UniAlignmentVaultFactory(d.uniVaultFactory);

        vm.startBroadcast();

        MockERC20 ms2 = new MockERC20("Station Fixture Token", "MS2");
        MockERC20 cult = new MockERC20("Community Fixture Token", "CULT");
        h.ms2Token = address(ms2);
        h.cultToken = address(cult);

        h.ms2TargetId = _registerTarget(
            registry,
            address(ms2),
            "MS2",
            "Station",
            "Alignment target demonstrating the vault flow on the Uniswap V4 venue. Its asset is a testnet FIXTURE token, not a traded coin - what it exists to show is where a collection's alignment tithe goes and what the vault does with it."
        );
        h.cultTargetId = _registerTarget(
            registry,
            address(cult),
            "CULT",
            "Community",
            "A second alignment target on the Uniswap V4 venue, so the registry index and the target picker have more than one row to choose between. Its asset is a testnet FIXTURE token."
        );

        h.ms2Vault = _deployAndWireVault(d, factory, address(ms2), "MS2", h.ms2TargetId);
        h.cultVault = _deployAndWireVault(d, factory, address(cult), "CULT", h.cultTargetId);

        // The curated venue for both Uni targets, set here so the registry and the vault agree before
        // anything is deposited. `feeOrHook` stays zero — a ZAMM-only field on a UNI_V4 leg is refused.
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);
        IAlignmentRegistry.AcquireRoute memory uniRoute = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, feeOrHook: 0
        });
        reg.setAcquireRoute(h.ms2TargetId, h.ms2Token, uniRoute);
        reg.setAcquireRoute(h.cultTargetId, h.cultToken, uniRoute);

        vm.stopBroadcast();

        console.log("ALIGNMENT ms2 target/vault:", h.ms2TargetId, h.ms2Vault);
        console.log("ALIGNMENT cult target/vault:", h.cultTargetId, h.cultVault);

        // The price authorities, CREATED here and PINNED a TWAP window later — see `_referenceReadyAt`.
        h.ms2ReferencePool = _seedReferencePool(d, h.ms2Token, "MS2");
        h.cultReferencePool = _seedReferencePool(d, h.cultToken, "CULT");

        // The depth the curated route already claims, in the pool the acquire leg swaps through.
        _seedV4Depth(d, h.ms2Token, "MS2");
        _seedV4Depth(d, h.cultToken, "CULT");
    }

    // ─────────────────────── The reference pool (price authority) ───────────────────────

    /// @dev Stand up the {token, WETH} Uniswap V3 pool this asset's oracle floor will read.
    ///
    ///      It is created and seeded HERE and pinned in phase 2, because `setReferencePool` probes
    ///      `observe([window, 0])` and a pool initialized moments ago has no observation old enough to
    ///      answer that. The wait is real wall-clock time on a public testnet, which is why it is
    ///      folded into the same gate the arm window already uses.
    function _seedReferencePool(Deployed memory d, address token, string memory symbol)
        internal
        returns (address pool)
    {
        uint256 budget = _referenceDepthWei();
        vm.startBroadcast();
        SepoliaReferencePoolSeeder seeder = new SepoliaReferencePoolSeeder(d.weth, token);
        uint128 minted;
        (pool, minted) = seeder.seed{ value: budget }(
            d.v3Factory, POOL_FEE, POOL_TICK_SPACING, _depthHalfWidthTicks(), REFERENCE_POOL_CARDINALITY
        );
        vm.stopBroadcast();

        require(minted > 0, string.concat("reference: ", symbol, " pool minted no liquidity"));
        // Read the pool's ACTIVE liquidity back rather than trusting the mint's return: a position
        // minted outside the current tick range reports units while pricing nothing.
        require(
            IUniswapV3PoolMinimal(pool).liquidity() > 0,
            string.concat("reference: ", symbol, " position landed outside the pool's active range")
        );
        console.log(string.concat("REFERENCE ", symbol, " pool / ETH deposited (wei):"), pool, budget);
    }

    // ─────────────────────── Uniswap V4 venue depth ───────────────────────

    /// @dev Give the V4 pool the vault acquires through the depth to serve a convert inside the -5%
    ///      floor. Sepolia analog of the mainnet-fork depth seed; the difference is where the token
    ///      leg comes from, and it is a property of the network rather than of the pattern — there is
    ///      no deep pool here to buy a fixture asset on, so the leg is minted. The floor is untouched.
    function _seedV4Depth(Deployed memory d, address token, string memory symbol) internal {
        PoolKey memory key = _uniVenueKey(token);
        uint128 activeBefore = IPoolManager(d.v4PoolManager).getLiquidity(key.toId());
        uint256 budget = _v4DepthWei();

        vm.startBroadcast();
        SepoliaV4DepthSeeder seeder = new SepoliaV4DepthSeeder(IPoolManager(d.v4PoolManager), token);
        (uint128 added, uint256 ethUsed, uint256 tokenUsed) =
            seeder.seedDepth{ value: budget }(key, _depthHalfWidthTicks());
        vm.stopBroadcast();

        uint128 activeAfter = IPoolManager(d.v4PoolManager).getLiquidity(key.toId());
        require(added > 0, string.concat("venue: ", symbol, " V4 depth seed minted no liquidity"));
        require(
            activeAfter > activeBefore,
            string.concat("venue: ", symbol, " V4 depth did not land in the pool's active range")
        );
        require(
            activeAfter >= MIN_VENUE_ACTIVE_LIQUIDITY,
            string.concat("venue: ", symbol, " V4 pool is still too thin to serve a convert")
        );

        console.log(string.concat("VENUE ", symbol, " uni-v4 depth - budget (wei):"), budget);
        console.log("  ETH leg deposited / token leg deposited:", ethUsed, tokenUsed);
        console.log("  active liquidity before / after:", uint256(activeBefore), uint256(activeAfter));
        console.log("  seeder (holds the position):", address(seeder));
    }

    // ─────────────────────── The ZAMM venue ───────────────────────

    /// @dev MS2's ZAMM leg: its own alignment target, a vault bound to the real ETH/MS2 pool key, and
    ///      the POOL ITSELF. Flipping a vault on without standing its pool up produces a vault that
    ///      reports as liquidity-ready and reverts on its first convert, which is a dead vault rather
    ///      than a venue — so the pool and its depth are created in the same breath as the vault.
    ///
    ///      The pool needs no create call: ZAMM's `addLiquidity` opens it on first use, and a pool is
    ///      identified by its key rather than by an address.
    function _seedZammVenue(Deployed memory d, SeedHandoff memory h) internal {
        if (!_zammAvailable(d)) {
            console.log("VENUE zamm: not available on this network - no vault, no pool, no target");
            return;
        }
        MockERC20 ms2 = MockERC20(h.ms2Token);
        IZAMM.PoolKey memory key = _zammVenueKey(h.ms2Token, d.zammFeeOrHook);
        uint256 budget = _zammDepthWei();

        vm.startBroadcast();
        h.ms2ZammTargetId = _registerTarget(
            AlignmentRegistryV1(d.alignmentRegistry),
            h.ms2Token,
            "MS2",
            "Station-ZAMM",
            "The same FIXTURE asset as the Station target, curated on the ZAMM venue instead. A separate target because the registry curates ONE venue per target and asset, and a vault that LPs somewhere other than its curated route is exactly what that curation exists to prevent."
        );
        h.ms2ZammVault = ZAMMAlignmentVaultFactory(d.zammVaultFactory)
            .deployVault(
                keccak256(abi.encode(block.chainid, h.ms2ZammTargetId, "MS2", "ZAMM-SHOWCASE")),
                h.ms2Token,
                h.ms2ZammTargetId,
                key
            );
        MasterRegistryV1(d.masterRegistry)
            .registerVault(
                h.ms2ZammVault,
                deployer,
                "MS2 ZAMM Vault",
                _collectionMeta(
                    "MS2 ZAMM Vault",
                    "Alignment vault for the showcase, LPing on the ZAMM venue. A collection aligned to this target sends it 19 percent of its graduation raise, by contract.",
                    ""
                ),
                h.ms2ZammTargetId
            );

        // The pool, at the same parity the reference pool was stood up at, so the curated price and
        // the executable price agree and the floor has headroom rather than a standing skew.
        ms2.mint(deployer, budget);
        ms2.approve(d.zamm, budget);
        (,, uint256 liquidity) =
            IZAMM(d.zamm).addLiquidity{ value: budget }(key, budget, budget, 0, 0, deployer, block.timestamp + 1 hours);

        // ZAMM's leg carries `feeOrHook` and no fee/tickSpacing; the registry refuses the other shape.
        IAlignmentRouteAdmin(d.alignmentRegistry)
            .setAcquireRoute(
                h.ms2ZammTargetId,
                h.ms2Token,
                IAlignmentRegistry.AcquireRoute({
                    venue: IAlignmentRegistry.Venue.ZAMM, fee: 0, tickSpacing: 0, feeOrHook: d.zammFeeOrHook
                })
            );
        vm.stopBroadcast();

        IZAMM.Pool memory pool = IZAMM(d.zamm).pools(_zammPoolId(key));
        require(liquidity > 0, "venue: the ZAMM pool minted no liquidity");
        require(pool.reserve0 > 0 && pool.reserve1 > 0, "venue: the ZAMM pool holds a one-sided reserve");

        console.log("VENUE MS2 zamm target/vault:", h.ms2ZammTargetId, h.ms2ZammVault);
        console.log("  pool feeOrHook / ETH deposited (wei):", d.zammFeeOrHook, budget);
        console.log("  reserves (eth, token):", uint256(pool.reserve0), uint256(pool.reserve1));
    }

    // ─────────────────────── The Cypher venue ───────────────────────

    /// @dev CULT's Cypher leg: its own alignment target on an ALGEBRA route, the Algebra pool that is
    ///      BOTH the venue and its own price authority, and the vault that converts through it.
    ///
    ///      THE POOL HAS TO EXIST BEFORE THE VAULT CONVERTS, not merely before it LPs. The vault
    ///      resolves-or-creates its LP pool as part of a convert, but the ACQUIRE leg swaps first —
    ///      through the Algebra router, against whatever depth is there. A pool created by the convert
    ///      and empty at the moment of the swap serves nothing.
    ///
    ///      THE PLUGIN IS WHAT MAKES THE POOL A REFERENCE. The validator's Algebra branch reads the
    ///      TWAP off `pool.plugin()`, not off the pool, so a pool created by a factory with no default
    ///      plugin factory wired is unusable as a reference no matter how deep it is. That is asserted
    ///      here rather than discovered a window later at the pin.
    function _seedCypherVenue(Deployed memory d, SeedHandoff memory h) internal {
        if (!_cypherAvailable(d)) {
            console.log("VENUE cypher: the Algebra rail is not wired on this deployment - leg skipped");
            return;
        }
        uint256 budget = _algebraDepthWei();

        vm.startBroadcast();
        h.cultAlgebraTargetId = _registerTarget(
            AlignmentRegistryV1(d.alignmentRegistry),
            h.cultToken,
            "CULT",
            "Community-Cypher",
            "The same FIXTURE asset as the Community target, curated on the Cypher (Algebra) venue instead. A separate target because a Cypher vault refuses to convert unless the route it reads names ALGEBRA - the vault checks the curation rather than trusting its own wiring."
        );
        h.cultCypherVault = address(
            CypherAlignmentVaultFactory(d.cypherVaultFactory)
                .createVault(
                    keccak256(abi.encode(block.chainid, h.cultAlgebraTargetId, "CULT", "CYPHER-SHOWCASE")),
                    d.cypherPositionManager,
                    d.cypherRouter,
                    d.weth,
                    h.cultToken,
                    d.protocolTreasury,
                    h.cultAlgebraTargetId
                )
        );
        MasterRegistryV1(d.masterRegistry)
            .registerVault(
                h.cultCypherVault,
                deployer,
                "CULT Cypher Vault",
                _collectionMeta(
                    "CULT Cypher Vault",
                    "Alignment vault for the showcase, LPing on the Cypher venue. A collection aligned to this target sends it 19 percent of its graduation raise, by contract.",
                    ""
                ),
                h.cultAlgebraTargetId
            );

        h.cultAlgebraPool = _standUpAlgebraPool(d, h.cultToken, budget);

        IAlignmentRouteAdmin(d.alignmentRegistry)
            .setAcquireRoute(
                h.cultAlgebraTargetId,
                h.cultToken,
                // ALGEBRA derives its own pool and runs a dynamic fee, so the leg carries no params;
                // the registry refuses any other shape.
                IAlignmentRegistry.AcquireRoute({
                    venue: IAlignmentRegistry.Venue.ALGEBRA, fee: 0, tickSpacing: 0, feeOrHook: 0
                })
            );
        vm.stopBroadcast();

        console.log("VENUE CULT cypher target/vault:", h.cultAlgebraTargetId, h.cultCypherVault);
        console.log("  algebra pool / ETH deposited (wei):", h.cultAlgebraPool, budget);
    }

    /// @dev Create-or-adopt the Algebra {token, WETH} pool, initialize it at parity, and put real
    ///      two-sided depth in it through the deployment's position manager. Broadcast is already open.
    function _standUpAlgebraPool(Deployed memory d, address token, uint256 budget) internal returns (address pool) {
        pool = IAlgebraFactory(d.cypherAlgebraFactory).poolByPair(d.weth, token);
        if (pool == address(0)) {
            pool = IAlgebraFactory(d.cypherAlgebraFactory).createPool(d.weth, token, "");
        }
        (uint160 price,,,,,) = IAlgebraPool(pool).globalState();
        if (price == 0) IAlgebraPool(pool).initialize(SQRT_PRICE_1_1);
        require(
            IAlgebraPool(pool).plugin() != address(0),
            "venue: the Algebra pool carries no plugin (getTimepoints could not serve the price validator)"
        );

        IWethMinimal(d.weth).deposit{ value: budget }();
        MockERC20(token).mint(deployer, budget);
        IWethMinimal(d.weth).approve(d.cypherPositionManager, budget);
        MockERC20(token).approve(d.cypherPositionManager, budget);

        (, int24 tick,,,,) = IAlgebraPool(pool).globalState();
        (int24 tickLower, int24 tickUpper) = _alignedRange(tick, POOL_TICK_SPACING, _depthHalfWidthTicks());
        (address token0, address token1) = d.weth < token ? (d.weth, token) : (token, d.weth);

        (, uint128 liquidity,,) = IAlgebraNFTPositionManager(d.cypherPositionManager)
            .mint(
                IAlgebraNFTPositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    deployer: address(0), // the factory-created (default-deployer) pool
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: budget,
                    amount1Desired: budget,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: deployer,
                    deadline: block.timestamp + 1 hours
                })
            );
        require(liquidity > 0, "venue: the Algebra depth seed minted no liquidity");
    }

    /// @dev A tick range centred on `tick`, aligned DOWN to `spacing` and clamped to the usable band.
    function _alignedRange(int24 tick, int24 spacing, int24 halfWidth)
        internal
        pure
        returns (int24 lower, int24 upper)
    {
        lower = _floorTick(tick - halfWidth, spacing);
        upper = _floorTick(tick + halfWidth, spacing);
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        if (lower < minTick) lower = minTick;
        if (upper > maxTick) upper = maxTick;
    }

    function _floorTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        return compressed * spacing;
    }

    function _registerTarget(
        AlignmentRegistryV1 registry,
        address token,
        string memory symbol,
        string memory title,
        string memory description
    ) internal returns (uint256 targetId) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: token, symbol: symbol, info: description, metadataURI: "" });
        targetId = registry.registerAlignmentTarget(title, description, "", assets);
    }

    /// @dev Deploy the target's vault, initialize its V4 pool, point the vault at that pool, and
    ///      register it. All four, because leaving any one undone produces a vault that looks wired
    ///      and cannot LP: the pool key lives on the vault (not in the registry), the pool has to
    ///      exist before it can be named, and an unregistered vault is refused at instance-create.
    function _deployAndWireVault(
        Deployed memory d,
        UniAlignmentVaultFactory factory,
        address token,
        string memory symbol,
        uint256 targetId
    ) internal returns (address vault) {
        bytes32 salt = keccak256(abi.encode(block.chainid, targetId, symbol, "UNIv4-SHOWCASE"));
        vault = factory.deployVault(salt, token, targetId, IVaultPriceValidator(address(0)));

        // Native ETH is currency0 — address(0) sorts below every token address, so the ordering holds
        // without a comparison.
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(address(0))
        });
        IPoolManager(d.v4PoolManager).initialize(key, SQRT_PRICE_1_1);
        factory.setVaultPoolKey(vault, key);

        MasterRegistryV1(d.masterRegistry)
            .registerVault(
                vault,
                deployer,
                string.concat(symbol, " UNIv4 Vault"),
                _collectionMeta(
                    string.concat(symbol, " UNIv4 Vault"),
                    "Alignment vault for the showcase. A collection aligned to this target sends it 19 percent of its graduation raise, by contract.",
                    ""
                ),
                targetId
            );
    }

    // ─────────────────────── Create + arm ───────────────────────

    /// @dev Create one roster row and set its clocks. Returns the latest timestamp the row's state
    ///      depends on, which is what phase 2 must wait past.
    ///
    ///      THE PRE-OPEN ROW IS ARMED ON A DIFFERENT CLOCK, DELIBERATELY. Every other row opens after
    ///      the short arm window because a human is waiting on it. The pre-open row must still be
    ///      pre-open when a stranger arrives days later — that state IS its whole demonstration — so
    ///      it takes `SEPOLIA_PREOPEN_DELAY_SECONDS` (default 30 days) and is excluded from the wait
    ///      phase 2 computes.
    function _createAndArm(
        Deployed memory d,
        ShowcaseLeg memory leg,
        address vault,
        uint256 armWindow,
        uint256 maturityOffset
    ) internal returns (address inst, uint256 armedUntil) {
        vm.startBroadcast();
        inst = _createShowcaseInstance(d, leg, vault);
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));

        if (leg.state == STATE_PREOPEN) {
            b.setBondingOpenTime(block.timestamp + _preopenDelay());
            b.setBondingActive(true);
            armedUntil = 0; // never waited for
        } else {
            uint256 openAt = block.timestamp + armWindow;
            b.setBondingOpenTime(openAt);
            armedUntil = openAt;
            if (leg.state == STATE_READY) {
                // Maturity is what makes the graduate action live, and the setter requires it to be
                // strictly after the open time — so it is the open time plus a small offset, and it,
                // not the open time, is this row's real wait.
                uint256 matureAt = openAt + maturityOffset;
                b.setBondingMaturityTime(matureAt);
                armedUntil = matureAt;
            }
            b.setBondingActive(true);
        }
        vm.stopBroadcast();
    }

    // ─────────────────────── Phase 1 post-conditions ───────────────────────

    /// @dev Everything phase 1 claims, checked before the hand-off file is written. `require`s, not
    ///      logs: forge simulates the whole script first, so a failure here leaves no partial seed and
    ///      names the row that failed.
    function _assertPhase1(ShowcaseLeg[] memory legs, address[] memory instances) internal view {
        for (uint256 i = 0; i < legs.length; i++) {
            IShowcaseCurveState s = IShowcaseCurveState(instances[i]);
            string memory slug = legs[i].slug;
            require(instances[i] != address(0), string.concat("phase1: ", slug, " was not created"));
            require(s.bondingActive(), string.concat("phase1: ", slug, " is not armed"));
            require(s.bondingOpenTime() > block.timestamp, string.concat("phase1: ", slug, " opened during phase 1"));
            require(s.totalBondingSupply() == 0, string.concat("phase1: ", slug, " was bought into by phase 1"));
            if (legs[i].state == STATE_READY) {
                require(
                    s.bondingMaturityTime() > s.bondingOpenTime(),
                    string.concat("phase1: ", slug, " has no maturity after its open time")
                );
            }
        }
        console.log("PHASE-1 post-conditions OK");
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                    WAVE 2 — EVERY OTHER PROJECT TYPE, ON THE SAME TWO-PHASE SPINE
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Phase 1 CREATES and ARMS. It still buys nothing: the ERC404 rows below are armed on the same
    // clock as the curve roster, and the two auctions are listed here so their lots END inside the
    // same wall-clock wait the orchestrator already performs. Phase 2 is what fills them.
    //
    // COST: the auction lots carry a queue deposit (returned at settle, less a 1% cut at reclaim);
    // everything else in this phase is gas.

    /// @dev Seed every non-curve mechanism and record it in the hand-off. Returns the latest clock
    ///      phase 2 must wait past — the timed auction's end. The LIVE auction is excluded from that,
    ///      exactly as the pre-open curve row is: it exists to still be running afterwards.
    function _seedBreadth(Deployed memory d, SeedHandoff memory h) internal returns (uint256 latestClock) {
        // The art these rows will wear, checked before the first of them is created — the same
        // pre-condition the roster performs on itself, over the directories the breadth rows name.
        _assertBreadthArt();
        h.editions = _seedEditions(d, h.ms2Vault);
        h.gatedEditions = _seedGatedEditions(d, h.cultVault);
        uint256 stakingMaturity;
        (h.staking404, stakingMaturity) = _seedStakingRow(d, h.ms2Vault);
        h.tiers404 = _seedTierRow(d, h.cultVault);
        h.carve404 = _seedCarveRow(d, h.ms2Vault);
        latestClock = _seedAuctions(d, h);
        if (stakingMaturity > latestClock) latestClock = stakingMaturity;
    }

    // ─────────────────────── 1. ERC-1155: three pricing regimes ───────────────────────

    /// @dev One collection carrying all three edition regimes, because they are properties of an
    ///      EDITION rather than of a collection and splitting them across three instances would say
    ///      the opposite. A visitor comparing the three rows on one page is the demonstration.
    function _seedEditions(Deployed memory d, address vault) internal returns (address instance) {
        vm.startBroadcast();
        instance = d.erc1155
            .createInstance(
                keccak256(abi.encode(block.timestamp, "atlas-editions")),
                ERC1155Factory.CreateParams({
                    name: "GladbroWebring",
                    symbol: "GLADBRO",
                    metadataURI: _collectionMeta(
                        "GladbroWebring",
                        "This collection demonstrates the three ways an EDITION can be priced. One row is a fixed price, one rises with every mint, and one reserves part of its supply as a free claim. Open all three and compare what the mint button asks for.",
                        ART_TILE_ATLAS
                    ),
                    creator: deployer,
                    vault: vault,
                    styleUri: "",
                    gatingModule: address(0), // open — the gated collection is its own row below
                    // The allocation is per EDITION for ERC1155; the factory refuses a non-zero value here.
                    freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
                })
            );

        ERC1155Instance ed = ERC1155Instance(payable(instance));
        // Edition 1 — LIMITED_FIXED. The price does not move; the supply is what runs out.
        ed.addEdition(
            "Fixed Edition",
            EDITION_FIXED_PRICE,
            EDITION_FIXED_SUPPLY,
            _pieceMeta("Fixed Edition", ART_PIECE_ATLAS_FIXED, "atlas-editions"),
            ERC1155Instance.PricingModel.LIMITED_FIXED,
            0,
            0,
            0
        );
        // Edition 2 — LIMITED_DYNAMIC. Every mint compounds the price by the rate, so the curve is
        // visible by eye within a handful of mints rather than only in a spreadsheet.
        ed.addEdition(
            "Rising Edition",
            EDITION_DYNAMIC_BASE_PRICE,
            EDITION_DYNAMIC_SUPPLY,
            _pieceMeta("Rising Edition", ART_PIECE_ATLAS_RISING, "atlas-editions"),
            ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
            EDITION_DYNAMIC_RATE_BPS,
            0,
            0
        );
        // Edition 3 — a free claim reserved out of a priced edition's own supply. The last argument
        // is the reservation; the claim is one per address, so it is sized as headroom.
        ed.addEdition(
            "Claim Edition",
            EDITION_FREE_PRICE,
            EDITION_FREE_SUPPLY,
            _pieceMeta("Claim Edition", ART_PIECE_ATLAS_CLAIM, "atlas-editions"),
            ERC1155Instance.PricingModel.LIMITED_FIXED,
            0,
            0,
            EDITION_FREE_ALLOCATION
        );
        vm.stopBroadcast();

        console.log("EDITIONS atlas-editions:", instance);
        console.log("  fixed / dynamic / free-claim editions:", EDITION_FIXED, EDITION_DYNAMIC, EDITION_FREE_CLAIM);
    }

    // ─────────────────────── 2. The Merkle allowlist ───────────────────────

    /// @dev A gated edition, with the deviation stated ON-CHAIN rather than only in the pull request.
    ///      The seeded tier is address-bound — that is what a Merkle allowlist IS — so a cold visitor
    ///      cannot enter it, and the collection's own description says so. Everything else about the
    ///      gate is real: the list is published as a `data:` URI the mint page can rebuild a proof
    ///      from, the cap is committed inside each leaf, and the seed proves both the acceptance and
    ///      the refusal against the root before it installs it.
    function _seedGatedEditions(Deployed memory d, address vault) internal returns (address instance) {
        address member = _allowlistFixtureMember();
        address stranger = _allowlistStranger();
        (bytes32 root,,) = _buildAllowlistTier(deployer, GATED_OPERATOR_QTY, member, GATED_MEMBER_QTY, stranger);

        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory tierOpenTimes = new uint256[](1);
        tierOpenTimes[0] = 0; // open immediately — tier 0 is the tier the app resolves

        vm.startBroadcast();
        instance = d.erc1155
            .createInstance(
                keccak256(abi.encode(block.timestamp, "veil-list")),
                ERC1155Factory.CreateParams({
                    name: "Mferlady",
                    symbol: "MFERL",
                    metadataURI: _collectionMetaWithAllowlist(
                        "Mferlady",
                        "This collection demonstrates ALLOWLIST GATING. Each entry on the list commits to a wallet AND the quantity that wallet may take, so the contract - not the interface - decides who mints and how much. The seeded list is bound to the addresses below and cannot be joined from outside; connect one of them to pass, connect anything else to see the refusal.",
                        ART_TILE_VEIL,
                        GATED_EDITION,
                        _allowlistListUri(deployer, GATED_OPERATOR_QTY, member, GATED_MEMBER_QTY)
                    ),
                    creator: deployer,
                    vault: vault,
                    styleUri: "",
                    gatingModule: d.merkleGating,
                    freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
                })
            );

        ERC1155Instance(payable(instance))
            .addEdition(
                "Mferlady Pass",
                GATED_EDITION_PRICE,
                GATED_EDITION_SUPPLY,
                _pieceMeta("Mferlady Pass", ART_PIECE_VEIL_PASS, "veil-list"),
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0,
                GATED_FREE_ALLOCATION
            );

        // Post-create, by the instance owner: the factory threads no gating CONFIG (the generic slot
        // bakes in no module's config shape), so this second call is the intended path.
        IMerkleGatingModule(d.merkleGating)
            .configureFor(
                instance, MerkleConfig({ editionId: GATED_EDITION, roots: roots, tierOpenTimes: tierOpenTimes })
            );
        vm.stopBroadcast();

        console.log("GATED veil-list:", instance);
        console.log("  listed:", deployer, "maxQty:", GATED_OPERATOR_QTY);
        console.log("  listed (fixture):", member, "maxQty:", GATED_MEMBER_QTY);
        console.log("  NOT listed (refusal path):", stranger);
    }

    // ─────────────────────── 3. Staking ───────────────────────

    /// @dev An ERC404 row with the approved staking module wired and ACTIVATED. Activation is
    ///      irreversible and is the creator's call, so it happens here rather than being left as a
    ///      button nobody presses.
    ///
    ///      WHAT MAKES THE STREAM RUN, AND WHY THIS ROW GRADUATES. The module's only funding path is a
    ///      real LP-fee delta arriving through `claimAllFees`, and `claimFees` pays a vault's
    ///      BENEFACTORS — the collections that actually tithed to it. So the row is armed to be
    ///      graduated in phase 2: graduating is what makes it a benefactor with real shares, and its
    ///      share of a fee its vault's position actually earned is what starts the stream. Pushing ETH
    ///      at the module from a fixture would fabricate the reward source instead of demonstrating
    ///      it, and is still refused.
    ///
    /// @return instance   the row
    /// @return maturedAt  the clock phase 2 must wait past before it can graduate the row
    function _seedStakingRow(Deployed memory d, address vault) internal returns (address instance, uint256 maturedAt) {
        vm.startBroadcast();
        instance = _createBreadthCurve(
            d,
            vault,
            "quarry-staking",
            "SUBSTN",
            "MiladySubstation",
            "This collection demonstrates STAKING. Holders lock coin into the collection itself and take a pro-rata share of the trading fees it collects, streamed over a week rather than paid as a lump. Stake, unstake, and watch the claimable figure move: the stream is funded by fees this collection's alignment vault earns on the venue it aligns to, so what a staker takes is earned rather than granted.",
            ART_TILE_QUARRY,
            ART_BASE_MILADYSTATION,
            SHOWCASE_NFT_COUNT,
            d.stakingModule,
            0
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        b.activateStaking();
        uint256 openAt = block.timestamp + _armWindow();
        b.setBondingOpenTime(openAt);
        // Maturity, because the graduation this row's stream depends on is gated on it and the setter
        // requires it strictly after the open time.
        maturedAt = openAt + _maturityOffset();
        b.setBondingMaturityTime(maturedAt);
        b.setBondingActive(true);
        vm.stopBroadcast();

        console.log("STAKING quarry-staking:", instance);
    }

    // ─────────────────────── 4/5. Metadata stack + Token Tiers ───────────────────────

    /// @dev An ERC404 created through the factory's METADATA overload, wiring
    ///      resolver(router) -> [overlay, tier] and sealing a two-rung Token Tiers ladder in the same
    ///      transaction. Both the economic ladder and the band art table are derived from the SAME id
    ///      ranges, so the two tables cannot describe different ids.
    ///
    ///      THE LADDER IS TWO RUNGS ON PURPOSE. The open rung (denomination 2, three ids) is minted up
    ///      into and back down out of in phase 2, so the reversible half of the feature is walkable
    ///      afterwards. The scarce rung (denomination 3, ONE id against a supply that could back
    ///      twenty) is taken by the seed and left taken, which is what makes `BandExhausted` a state a
    ///      visitor can observe rather than a revert in a test.
    ///
    ///      THE ART IS ONE FAMILY'S OWN LINEAGE, read bottom to top. Ordinary pieces resolve to the
    ///      parent collection; the open band to the derivative that succeeded it; the scarce band to
    ///      the derivative after that; and the commission phase 2 pays sits on top of them all.
    ///      Precedence (overlay over band over base) is only demonstrated if the layers can be told
    ///      apart by eye, and stacking one lineage says what a rung MEANS as well as that it differs.
    function _seedTierRow(Deployed memory d, address vault) internal returns (address instance) {
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](2);
        tiers[0] =
            ERC404Factory.TierSpec({ weight: TIER_OPEN_WEIGHT, count: TIER_OPEN_COUNT, baseURI: ART_BASE_SONORA222 });
        tiers[1] =
            ERC404Factory.TierSpec({ weight: TIER_SCARCE_WEIGHT, count: TIER_SCARCE_COUNT, baseURI: ART_BASE_SCHIZO });

        address[] memory children = new address[](2);
        children[0] = d.overlay; // precedence: holder pins and paid commissions win over...
        children[1] = d.tierResolver; // ...static band art, which wins over the collection base

        vm.startBroadcast();
        instance = d.erc404
            .createInstance(
                ERC404Factory.CreateParams({
                    salt: keccak256(abi.encode(block.timestamp, "prism-tiers", "ERC404-SEPOLIA")),
                    name: "SonoraEcho",
                    symbol: "ECHO",
                    styleUri: "",
                    tokenBaseURI: ART_BASE_SONORA,
                    owner: deployer,
                    vault: vault,
                    nftCount: TIER_NFT_COUNT,
                    presetId: PRESET_NICHE,
                    stakingModule: address(0),
                    declaredMaxAllowanceBps: 0 // a metadata demonstration, not an economic one
                }),
                _collectionMeta(
                    "SonoraEcho",
                    "This collection demonstrates TOKEN TIERS and layered METADATA. Coin can be folded into a higher-denomination piece and unfolded again, and a piece's picture is resolved on-chain from three stacked layers - a paid commission over reserved-band art over the collection's own base. One rung is deliberately scarce, so it sells out and reopens as holders unfold.",
                    ART_TILE_PRISM
                ),
                d.uniDeployer,
                address(0), // no gating on this row — the gate is its own collection
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                ERC404Factory.MetadataConfig({
                    resolver: d.resolverRouter,
                    childResolvers: children,
                    overlay: d.overlay,
                    tier: d.tierResolver,
                    tiers: tiers,
                    autoLatest: false, // opt-in waves, so band art stays visible by default
                    defaultPayout: MetadataOverlayModule.Payout.ARTIST
                })
            );

        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        b.setBondingOpenTime(block.timestamp + _armWindow());
        b.setBondingActive(true);

        // The event wave is an ARTIST write and needs no holdings, so it is published here. A wave's
        // art composes as `wave.baseURI + id`, the same way the base and the band do — so its payload
        // is a metadata directory too. It draws on the ladder's first rung, which is a step up from
        // the collection base an ordinary id otherwise shows: opting into the wave visibly moves the
        // piece, rather than resolving to the picture already on screen.
        MetadataOverlayModule(d.overlay)
            .publishWave(
                instance,
                ART_BASE_SONORA222,
                MetadataOverlayModule.WaveCond.NONE,
                0,
                0,
                MetadataOverlayModule.Payout.ARTIST
            );
        vm.stopBroadcast();

        console.log("TIERS prism-tiers:", instance);
        console.log("  open rung   - weight/count:", uint256(TIER_OPEN_WEIGHT), uint256(TIER_OPEN_COUNT));
        console.log("  scarce rung - weight/count:", uint256(TIER_SCARCE_WEIGHT), uint256(TIER_SCARCE_COUNT));
    }

    // ─────────────────────── 7. The carve ───────────────────────

    /// @dev The carve row declares its allowance UP FRONT and graduates with the carve requested in
    ///      phase 2. `declaredMaxAllowanceBps` is immutable per instance and readable before the first
    ///      buy — that immutability is the disclosure, and it is why the declaration is made here at
    ///      create rather than at graduation.
    function _seedCarveRow(Deployed memory d, address vault) internal returns (address instance) {
        vm.startBroadcast();
        instance = _createBreadthCurve(
            d,
            vault,
            "carve-demo",
            "GBLD",
            "Ghibladita",
            "This collection demonstrates the CREATOR CARVE and the disclosure that governs it. The maximum share of the raise this creator may ever take at graduation is fixed in the contract before the first buy, and the page shows it - so what the creator can do is priced in rather than discovered afterwards. The pool floor clamps the carve on a thin raise; it never blocks the graduation.",
            ART_TILE_CARVE,
            ART_BASE_GHIBLADY,
            SHOWCASE_NFT_COUNT,
            address(0),
            CARVE_DECLARED_MAX_BPS
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        uint256 openAt = block.timestamp + _armWindow();
        b.setBondingOpenTime(openAt);
        b.setBondingMaturityTime(openAt + _maturityOffset());
        b.setBondingActive(true);
        vm.stopBroadcast();

        console.log("CARVE carve-demo:", instance);
        console.log("  declared max allowance (bps):", uint256(CARVE_DECLARED_MAX_BPS));
    }

    // ─────────────────────── 8. The Cypher flagship ───────────────────────

    /// @dev The collection that rides the Cypher rail end to end: created against the Cypher LP
    ///      deployer, aligned to the Cypher vault, and armed to be GRADUATED in phase 2.
    ///
    ///      It is armed like the ready-to-graduate row (open, then matured) rather than merely opened,
    ///      because graduating it is the point: the graduation is what opens an Algebra pool for the
    ///      collection's own coin AND what sends a real 19% tithe to the Cypher vault, which is what
    ///      that vault then converts. Without it the Cypher venue would be a vault with nothing in it.
    ///
    ///      Returns the clock phase 2 must wait past, or zero when the rail is not wired here.
    function _seedCypherCollection(Deployed memory d, SeedHandoff memory h) internal returns (uint256 maturedAt) {
        if (!_cypherAvailable(d) || h.cultCypherVault == address(0)) {
            console.log("CYPHER collection: the Algebra rail is not wired on this deployment - row skipped");
            return 0;
        }
        vm.startBroadcast();
        address instance = _createBreadthCurveOnVenue(
            d,
            h.cultCypherVault,
            d.cypherDeployer,
            "cypher-flagship",
            "ANGLT",
            "AngeliteMaker",
            "This collection demonstrates the CYPHER venue. Its curve graduates onto an Algebra pool rather than a Uniswap one, and the 19 percent alignment tithe it pays goes to a vault that acquires and LPs on that same venue - the route the registry curates, the pool the vault deposits into and the pool the swap executes on are one pool. Graduate it, then read the pool it opened.",
            ART_TILE_CYPHER,
            ART_BASE_ELITE,
            SHOWCASE_NFT_COUNT
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        uint256 openAt = block.timestamp + _armWindow();
        b.setBondingOpenTime(openAt);
        maturedAt = openAt + _maturityOffset();
        b.setBondingMaturityTime(maturedAt);
        b.setBondingActive(true);
        vm.stopBroadcast();

        h.cypher404 = instance;
        console.log("CYPHER cypher-flagship:", instance);
    }

    /// @dev Create + register one curve row on a NAMED LP venue. Same shape as `_createBreadthCurve`,
    ///      with the liquidity deployer as a parameter — that address is what decides which venue the
    ///      row's graduation opens a pool on, and it is the only thing the Cypher row varies.
    function _createBreadthCurveOnVenue(
        Deployed memory d,
        address vault,
        address liquidityDeployer,
        string memory slug,
        string memory symbol,
        string memory title,
        string memory description,
        string memory image,
        string memory pieceBase,
        uint256 nftCount
    ) internal returns (address instance) {
        _assertPieceBase(pieceBase, slug);
        instance = d.erc404
            .createInstance(
                ERC404Factory.CreateParams({
                    salt: keccak256(abi.encode(block.timestamp, slug, "ERC404-SEPOLIA")),
                    name: title,
                    symbol: symbol,
                    styleUri: "",
                    tokenBaseURI: pieceBase,
                    owner: deployer,
                    vault: vault,
                    nftCount: nftCount,
                    presetId: PRESET_NICHE,
                    stakingModule: address(0),
                    declaredMaxAllowanceBps: 0
                }),
                _collectionMeta(title, description, image),
                liquidityDeployer,
                address(0),
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            );
    }

    /// @dev Create + register one breadth curve row. Kept beside its callers so the parameters a row
    ///      does NOT vary (owner, preset, LP venue, gating, free mint) are stated exactly once.
    function _createBreadthCurve(
        Deployed memory d,
        address vault,
        string memory slug,
        string memory symbol,
        string memory title,
        string memory description,
        string memory image,
        string memory pieceBase,
        uint256 nftCount,
        address stakingModule,
        uint16 declaredMaxBps
    ) internal returns (address instance) {
        _assertPieceBase(pieceBase, slug);
        instance = d.erc404
            .createInstance(
                ERC404Factory.CreateParams({
                    salt: keccak256(abi.encode(block.timestamp, slug, "ERC404-SEPOLIA")),
                    name: title,
                    symbol: symbol,
                    styleUri: "",
                    tokenBaseURI: pieceBase,
                    owner: deployer,
                    vault: vault,
                    nftCount: nftCount,
                    presetId: PRESET_NICHE,
                    stakingModule: stakingModule,
                    declaredMaxAllowanceBps: declaredMaxBps
                }),
                _collectionMeta(title, description, image),
                d.uniDeployer,
                address(0),
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            );
    }

    // ─────────────────────── 6. ERC-721 auctions in three states ───────────────────────

    /// @dev Two auction houses, because a single instance carries ONE base duration and the three
    ///      states this must hold do not share one.
    ///
    ///        · the TIMED house runs for exactly the arm window over two lines. One lot takes a bid
    ///          and is SETTLED in phase 2; the other takes none and is RECLAIMED. Both need real time
    ///          to end, which is the wait the orchestrator is already performing — no fast-forward
    ///          exists on a public testnet, so the two phases are what make these states reachable.
    ///        · the LIVE house runs long and keeps counting down, so a visitor arriving later finds a
    ///          lot that is still open to bid on.
    ///
    ///      The lot ids are READ BACK off each line rather than assumed from the queue order.
    function _seedAuctions(Deployed memory d, SeedHandoff memory h) internal returns (uint256 timedEnd) {
        uint256 deposit = _auctionDeposit();
        uint256 bid = _auctionBid();

        vm.startBroadcast();
        address timed = d.erc721
            .createInstance(
                keccak256(abi.encode(block.timestamp, "relic-line", "ERC721")),
                ERC721AuctionFactory.CreateParams({
                    name: "Mewlady",
                    metadataURI: _collectionMeta(
                        "Mewlady",
                        "This auction house demonstrates how a lot ENDS. It runs two lines on a short clock: one lot takes a bid and is settled to its winner, the other attracts none and is reclaimed by the creator. Read both after they close - the settled lot minted a piece and split the hammer, the reclaimed one never minted at all.",
                        ART_TILE_RELIC
                    ),
                    creator: deployer,
                    vault: h.ms2Vault,
                    symbol: "MEW",
                    lines: 2,
                    baseDuration: uint40(_timedAuctionSeconds()),
                    timeBuffer: AUCTION_TIME_BUFFER,
                    bidIncrement: AUCTION_BID_INCREMENT
                })
            );
        ERC721AuctionInstance t = ERC721AuctionInstance(payable(timed));
        // One lot per LINE, so both start immediately: a second lot on the same line would sit in the
        // queue behind the first and never reach an end state inside this seed.
        t.queuePiece{ value: deposit }(_pieceMeta("Mewlady I", ART_PIECE_RELIC_I, "relic-line"));
        t.queuePiece{ value: deposit }(_pieceMeta("Mewlady II", ART_PIECE_RELIC_II, "relic-line"));

        uint256 soldLot = t.getActiveAuction(0);
        uint256 unsoldLot = t.getActiveAuction(1);
        require(soldLot != 0 && unsoldLot != 0, "auctions: a timed line did not start its lot");

        // The bid is the seed's own. A public testnet showcase has exactly one funded account, so the
        // winner of the settled lot is that account — the STATE is real, the counterparty is not a
        // second person, and the post-conditions say so by asserting the token lands with the bidder.
        t.createBid{ value: bid }(uint24(soldLot), "");

        address live = d.erc721
            .createInstance(
                keccak256(abi.encode(block.timestamp, "salon-line", "ERC721")),
                ERC721AuctionFactory.CreateParams({
                    name: "Colombilady",
                    metadataURI: _collectionMeta(
                        "Colombilady",
                        "This auction house demonstrates a LIVE lot. One piece is on the block with the clock running, the minimum is the creator's own deposit, and a late bid pushes the ending back so the last seconds cannot be sniped. Place a bid and watch the countdown move.",
                        ART_TILE_SALON
                    ),
                    creator: deployer,
                    vault: h.cultVault,
                    symbol: "COLMB",
                    lines: 1,
                    baseDuration: uint40(_liveAuctionSeconds()),
                    timeBuffer: AUCTION_TIME_BUFFER,
                    bidIncrement: AUCTION_BID_INCREMENT
                })
            );
        ERC721AuctionInstance l = ERC721AuctionInstance(payable(live));
        l.queuePiece{ value: deposit }(_pieceMeta("Colombilady I", ART_PIECE_SALON_I, "salon-line"));
        uint256 liveLot = l.getActiveAuction(0);
        require(liveLot != 0, "auctions: the live line did not start its lot");
        vm.stopBroadcast();

        h.auctionTimed = timed;
        h.auctionLive = live;
        h.soldLotId = soldLot;
        h.unsoldLotId = unsoldLot;
        h.liveLotId = liveLot;

        // The bid may have extended its own lot (anti-snipe), so the wait is read back off the chain
        // rather than recomputed from the duration.
        uint256 soldEnd = t.getAuction(uint24(soldLot)).endTime;
        uint256 unsoldEnd = t.getAuction(uint24(unsoldLot)).endTime;
        timedEnd = soldEnd > unsoldEnd ? soldEnd : unsoldEnd;

        console.log("AUCTION relic-line (timed):", timed);
        console.log("  settled-lot / reclaim-lot:", soldLot, unsoldLot);
        console.log("  both lots end at (unix):", timedEnd);
        console.log("AUCTION salon-line (live):", live);
        console.log("  live lot / ends at (unix):", liveLot, l.getAuction(uint24(liveLot)).endTime);
    }

    // ─────────────────────── Breadth phase-1 post-conditions ───────────────────────

    /// @dev Everything phase 1's breadth rows claim, checked before the hand-off file is written.
    ///      The two curve-state claims phase 2 depends on (armed, unopened) are checked alongside the
    ///      spine's rows; what is checked here is what phase 1 alone is responsible for.
    function _assertBreadthPhase1(Deployed memory d, SeedHandoff memory h) internal view {
        _requireBreadthHandoff(h);
        _assertEditionShowcase(_readEditionFacts(h.editions));
        _assertGatingShowcase(_readGatingFacts(d, h.gatedEditions), block.timestamp);

        // The three breadth curves must be armed and still unopened, exactly like the spine's rows —
        // a row that opened during phase 1 cannot be bought by phase 2 at a price phase 2 projected.
        _assertBreadthCurveArmed(h.staking404, "quarry-staking");
        _assertBreadthCurveArmed(h.tiers404, "prism-tiers");
        _assertBreadthCurveArmed(h.carve404, "carve-demo");

        // Staking is ACTIVATED here and staked in phase 2, so only the wiring half is asserted now.
        ERC404BondingInstance quarry = ERC404BondingInstance(payable(h.staking404));
        require(
            address(quarry.stakingModule()) == d.stakingModule, "phase1: quarry-staking has the wrong staking module"
        );
        require(quarry.stakingActive(), "phase1: quarry-staking did not activate staking");

        // The carve row's DISCLOSURE is a phase-1 fact: it is sealed at create and is what a buyer
        // reads before the first buy, so it must be right before anything is bought.
        require(
            ERC404BondingInstance(payable(h.carve404)).declaredMaxAllowanceBps() == CARVE_DECLARED_MAX_BPS,
            "phase1: carve-demo did not seal its declared allowance"
        );

        // The tier ladder is sealed at create and can never be supplied afterwards, so an empty or
        // mis-sized band here is unrecoverable — check it before the deployment is handed on.
        IShowcaseTierState tiers = IShowcaseTierState(h.tiers404);
        (uint32 openStart, uint32 openEnd, uint32 openWeight) = tiers.tierBands(0);
        (uint32 scarceStart, uint32 scarceEnd, uint32 scarceWeight) = tiers.tierBands(1);
        require(openWeight == TIER_OPEN_WEIGHT && scarceWeight == TIER_SCARCE_WEIGHT, "phase1: tier weights drifted");
        require(openEnd - openStart + 1 == TIER_OPEN_COUNT, "phase1: the open rung was not sealed at its count");
        require(
            scarceEnd - scarceStart + 1 == TIER_SCARCE_COUNT,
            "phase1: the scarce rung was not sealed at its count (BandExhausted would be unreachable)"
        );
        require(
            openStart
                > ERC404BondingInstance(payable(h.tiers404)).maxSupply()
                    / ERC404BondingInstance(payable(h.tiers404)).unit(),
            "phase1: a band overlaps the ordinary id space"
        );

        // The auctions: both timed lots must actually be able to END inside the wait, and the live lot
        // must outlast it — otherwise phase 2 settles nothing and the live row is not live.
        ERC721AuctionInstance timed = ERC721AuctionInstance(payable(h.auctionTimed));
        require(timed.getAuction(uint24(h.soldLotId)).highBidder == deployer, "phase1: the settle lot carries no bid");
        require(
            timed.getAuction(uint24(h.unsoldLotId)).highBidder == address(0),
            "phase1: the reclaim lot already carries a bid"
        );
        require(
            ERC721AuctionInstance(payable(h.auctionLive)).getAuction(uint24(h.liveLotId)).endTime > h.phase2NotBefore,
            "phase1: the live lot ends before phase 2 runs (it would not be live)"
        );

        console.log("BREADTH phase-1 post-conditions OK");
    }

    // ─────────────────────── Venue phase-1 post-conditions ───────────────────────

    /// @dev What phase 1 alone is responsible for on the venue legs: each target is CURATED at the
    ///      venue its vault actually LPs on, each vault is bound to the right asset and target and
    ///      carries a price validator, and every pool a convert will swap through already holds depth.
    ///
    ///      What is deliberately NOT asserted here is the reference pin — that is phase 2's, because
    ///      the pools this phase created cannot serve a window-long TWAP until a window has passed.
    ///      Asserting it here would only be assertable by not creating the pools here.
    function _assertVenuesPhase1(Deployed memory d, SeedHandoff memory h) internal view {
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        _assertUniVenuePhase1(d, reg, h.ms2TargetId, h.ms2Token, h.ms2Vault, h.ms2ReferencePool, "MS2 uni-v4");
        _assertUniVenuePhase1(d, reg, h.cultTargetId, h.cultToken, h.cultVault, h.cultReferencePool, "CULT uni-v4");

        if (h.ms2ZammVault != address(0)) {
            require(
                reg.getAcquireRoute(h.ms2ZammTargetId, h.ms2Token).venue == IAlignmentRegistry.Venue.ZAMM,
                "venue: the ZAMM target is not curated as ZAMM"
            );
            IZAMM.Pool memory pool = IZAMM(d.zamm).pools(_zammPoolId(_zammVenueKey(h.ms2Token, d.zammFeeOrHook)));
            require(pool.reserve0 > 0 && pool.reserve1 > 0, "venue: the ZAMM vault's own pool holds no reserves");
            _assertVaultBinding(h.ms2ZammVault, h.ms2Token, h.ms2ZammTargetId, "MS2 zamm");
        }

        if (h.cultCypherVault != address(0)) {
            require(
                reg.getAcquireRoute(h.cultAlgebraTargetId, h.cultToken).venue == IAlignmentRegistry.Venue.ALGEBRA,
                "venue: the Cypher target is not curated as ALGEBRA"
            );
            require(h.cultAlgebraPool != address(0), "venue: the Cypher target has no Algebra pool");
            // The plugin is what makes this pool answerable as a price authority at all; a pool
            // without one is deep and unusable, and the pin a window from now would refuse it.
            require(
                IAlgebraPool(h.cultAlgebraPool).plugin() != address(0),
                "venue: the Algebra pool lost its plugin (getTimepoints would not serve the validator)"
            );
            _assertVaultBinding(h.cultCypherVault, h.cultToken, h.cultAlgebraTargetId, "CULT cypher");
            require(h.cypher404 != address(0), "venue: the Cypher rail is wired but carries no collection");
        }

        console.log("VENUE phase-1 post-conditions OK");
    }

    function _assertUniVenuePhase1(
        Deployed memory d,
        IAlignmentRouteAdmin reg,
        uint256 targetId,
        address token,
        address vault,
        address referencePool,
        string memory label
    ) internal view {
        require(
            reg.getAcquireRoute(targetId, token).venue == IAlignmentRegistry.Venue.UNI_V4,
            string.concat("venue: ", label, " is not curated as UNI_V4")
        );
        require(
            reg.getAcquireRoute(targetId, token).fee == POOL_FEE,
            string.concat("venue: ", label, " is curated on a fee tier the vault does not LP into")
        );
        require(referencePool != address(0), string.concat("venue: ", label, " has no reference pool to pin"));
        require(
            IUniswapV3PoolMinimal(referencePool).liquidity() > 0,
            string.concat("venue: ", label, " reference pool holds no active liquidity")
        );
        require(
            IPoolManager(d.v4PoolManager).getLiquidity(_uniVenueKey(token).toId()) >= MIN_VENUE_ACTIVE_LIQUIDITY,
            string.concat("venue: ", label, " acquire pool is too thin to serve a convert")
        );
        _assertVaultBinding(vault, token, targetId, label);
    }

    /// @dev A vault is bound to exactly one (asset, target) and prices through a validator. The
    ///      validator read is the one worth stating: the factory substitutes its default when a vault
    ///      is deployed with a zero, and a vault that ended up with a genuine zero cannot price its
    ///      own floor at all.
    function _assertVaultBinding(address vault, address token, uint256 targetId, string memory label) internal view {
        IVenueVaultView v = IVenueVaultView(vault);
        require(v.alignmentToken() == token, string.concat("venue: ", label, " vault holds another asset"));
        require(v.alignmentTargetId() == targetId, string.concat("venue: ", label, " vault sits on another target"));
        require(v.priceValidator() != address(0), string.concat("venue: ", label, " vault has no price validator"));
    }

    function _assertBreadthCurveArmed(address instance, string memory slug) internal view {
        IShowcaseCurveState s = IShowcaseCurveState(instance);
        require(s.bondingActive(), string.concat("phase1: ", slug, " is not armed"));
        require(s.bondingOpenTime() > block.timestamp, string.concat("phase1: ", slug, " opened during phase 1"));
        require(s.totalBondingSupply() == 0, string.concat("phase1: ", slug, " was bought into by phase 1"));
    }

    // ─────────────────────── 9. The featured wall ───────────────────────

    /// @dev Rent the placements the home page renders. `QueryAggregator.getHomePageData` is a read
    ///      over the featured queue, so a deployment with no placements answers with an empty grid
    ///      however much it holds — the showcase's front door is the one surface that is not seeded
    ///      by creating collections.
    ///
    ///      WHICH ROWS, AND WHY THESE FOUR. The wall is the tour's first page, so it carries the
    ///      product's ARC rather than its inventory: the graduated curve (the arc completed, trading
    ///      on a real pool), the mid-curve row (the arc in motion, and the one thing a visitor can act
    ///      on immediately), the edition set (a second project family, priced three ways on one page)
    ///      and the live auction (a third family, with a clock running). One per mechanism family,
    ///      with the two curve states leading because the curve is the product's spine.
    ///
    ///      WHY THE ORDER IS PAID FOR. The queue returns active slots sorted by effective rank, so
    ///      without distinct boosts the wall's order is whatever the sort makes of equal keys. Each
    ///      slot is rented with a boost one step above the next, which is also the demonstration:
    ///      placement is bought and contestable, and every wei of it is 100% protocol revenue by
    ///      design rather than a split.
    ///
    ///      WHY PHASE 1. The rent rides the phase that already holds the payer's purse for the venue
    ///      depth and the auction deposits, and it has to: `rentFeatured` refuses an unregistered
    ///      instance, and phase 1 is where every instance is created and registered. Phase 2 buys
    ///      into curves and graduates them — it changes no row's eligibility for a slot.
    function _seedFeaturedWall(
        Deployed memory d,
        SeedHandoff memory h,
        ShowcaseLeg[] memory legs,
        address[] memory instances
    ) internal {
        address[] memory wall = new address[](FEATURED_SLOTS);
        wall[0] = _instanceForSlug(legs, instances, "flare-graduated");
        wall[1] = _instanceForSlug(legs, instances, "vapor-mid");
        wall[2] = h.editions;
        wall[3] = h.auctionLive;

        uint256 duration = _featuredDuration();
        // The bounds are the QUEUE's, and they are owner-tunable: a duration outside them reverts
        // `InvalidDuration` at the first rent. Refused here instead, at simulation time, with the
        // ceiling that refused it named — the knob to turn is an environment variable.
        require(
            duration >= d.queue.minDuration() && duration <= d.queue.maxDuration(),
            "featured: SEPOLIA_FEATURED_DURATION_SECONDS is outside the queue's own duration bounds"
        );
        uint256 durationCost = d.queue.quoteDurationCost(duration);

        vm.startBroadcast();
        for (uint256 i = 0; i < wall.length; i++) {
            require(wall[i] != address(0), "featured: the wall names a row this seed did not create");
            uint256 rankBoost = _featuredRankBoost(i, wall.length);
            // Exactly what is due, rather than a generous value and a refund: the refund path hands
            // the excess back through the WETH fallback, which is a second mechanism to be right
            // about for no gain on a seed that already knows the price.
            d.queue.rentFeatured{ value: durationCost + rankBoost }(wall[i], duration, rankBoost);
            h.featuredSpendWei += durationCost + rankBoost;
            console.log("FEATURED slot / instance:", i + 1, wall[i]);
            console.log("  rank boost / duration (seconds):", rankBoost, duration);
        }
        vm.stopBroadcast();

        h.featured = wall;
        h.featuredDuration = duration;
        console.log("FEATURED wall - slots / total spend (wei):", wall.length, h.featuredSpendWei);
        console.log("  daily rate read from the queue (wei):", d.queue.dailyRate());
        console.log("  slot expiry (unix):", block.timestamp + duration);
    }

    /// @dev Resolve one roster row BY NAME. The wall names the rows it features rather than indexing
    ///      them, for the same reason phase 2 does: the roster grows, and a positional reference
    ///      silently re-targets when it does.
    function _instanceForSlug(ShowcaseLeg[] memory legs, address[] memory instances, string memory slug)
        internal
        pure
        returns (address)
    {
        for (uint256 i = 0; i < legs.length; i++) {
            if (keccak256(bytes(legs[i].slug)) == keccak256(bytes(slug))) return instances[i];
        }
        revert(string.concat("featured: the roster carries no row named ", slug));
    }

    // ─────────────────────── Featured phase-1 post-conditions ───────────────────────

    /// @dev The wall as the HOME PAGE will read it, not as the seed remembers renting it. Read back
    ///      through `getFeaturedInstances` — the same call `QueryAggregator.getHomePageData` makes —
    ///      because a slot that was paid for and is not visible (an unregistered instance, a slot the
    ///      cap pruned) renders an empty front door exactly like never having rented it.
    function _assertFeaturedPhase1(Deployed memory d, SeedHandoff memory h) internal view {
        require(h.featured.length == FEATURED_SLOTS, "featured: the wall is not the size that was quoted");

        // The whole visible wall, not only this seed's window of it: a deployment may already carry
        // placements somebody else rented, and they sort among these by rank like any other.
        (address[] memory rendered, uint256 total) = d.queue.getFeaturedInstances(0, d.queue.maxFeaturedSize());
        require(total >= FEATURED_SLOTS, "featured: the queue reports fewer active slots than were rented");

        uint256 previousPosition;
        for (uint256 i = 0; i < FEATURED_SLOTS; i++) {
            uint256 position = _positionInWall(rendered, h.featured[i]);
            require(position != type(uint256).max, "featured: a rented slot is not on the wall the home page reads");
            // The RELATIVE order of this seed's own slots is what the descending rank steps bought.
            // Stated as relative rather than absolute because the seed does not own the whole wall:
            // an existing placement may outrank all of these and still leave the tour in its order.
            if (i > 0) {
                require(position > previousPosition, "featured: the wall renders this seed's rows out of order");
            }
            previousPosition = position;

            (,, uint256 expiresAt, bool isActive) = d.queue.getRentalInfo(h.featured[i]);
            require(isActive, "featured: a rented slot is not active");
            require(
                expiresAt >= block.timestamp + h.featuredDuration,
                "featured: a slot expires sooner than the duration it was rented for"
            );
        }

        console.log("FEATURED phase-1 post-conditions OK");
    }

    /// @dev Where `instance` sits on the rendered wall, or `type(uint256).max` when it is not on it.
    function _positionInWall(address[] memory rendered, address instance) internal pure returns (uint256) {
        for (uint256 i = 0; i < rendered.length; i++) {
            if (rendered[i] == instance) return i;
        }
        return type(uint256).max;
    }

    // ─────────────────────── Fact readers ───────────────────────

    function _readEditionFacts(address instance) internal view returns (EditionFacts memory f) {
        ERC1155Instance ed = ERC1155Instance(payable(instance));
        f.nextEditionId = ed.nextEditionId();

        (,, uint256 fixedPrice, uint256 fixedSupply,,, ERC1155Instance.PricingModel fixedModel,,) =
            ed.editions(EDITION_FIXED);
        f.fixedModel = uint8(fixedModel);
        f.fixedPrice = fixedPrice;
        f.fixedSupply = fixedSupply;

        (,, uint256 dynBase,,,, ERC1155Instance.PricingModel dynModel, uint256 dynRate,) = ed.editions(EDITION_DYNAMIC);
        f.dynamicModel = uint8(dynModel);
        f.dynamicBasePrice = dynBase;
        f.dynamicRate = dynRate;
        f.dynamicModule = address(ed.dynamicPricingModule());
        // Asked of the module the instance will actually charge through, not recomputed here — a
        // second copy of the pricing curve beside the first is how the two drift.
        if (f.dynamicModule != address(0)) {
            f.dynamicPriceAfterProbe =
                IDynamicPricingModule(f.dynamicModule).calculatePrice(dynBase, dynRate, DYNAMIC_PROBE_MINTS);
        }

        (,,, uint256 freeSupply, uint256 freeMinted,,,,) = ed.editions(EDITION_FREE_CLAIM);
        f.freeClaimSupply = freeSupply;
        f.freeClaimMinted = freeMinted;
        f.freeClaimAllocation = ed.freeMintAllocation(EDITION_FREE_CLAIM);
    }

    function _readGatingFacts(Deployed memory d, address instance) internal view returns (GatingFacts memory f) {
        ERC1155Instance veil = ERC1155Instance(payable(instance));
        f.attachedModule = address(veil.gatingModule());
        f.expectedModule = d.merkleGating;
        f.scope = uint8(veil.gatingScope());
        f.freeClaimAllocation = veil.freeMintAllocation(GATED_EDITION);

        bytes32[] memory installed = IMerkleGatingView(d.merkleGating).getRoots(instance, GATED_EDITION);
        uint256[] memory opens = IMerkleGatingView(d.merkleGating).getTierOpenTimes(instance, GATED_EDITION);
        f.installedTierCount = installed.length;
        if (installed.length > 0) f.installedRoot = installed[0];
        if (opens.length > 0) f.tierOpenTime = opens[0];

        address member = _allowlistFixtureMember();
        address stranger = _allowlistStranger();
        (bytes32 root, bytes32[] memory proofOperator,) =
            _buildAllowlistTier(deployer, GATED_OPERATOR_QTY, member, GATED_MEMBER_QTY, stranger);
        f.provenRoot = root;
        // Re-verified against the root that is actually INSTALLED, through the same library the module
        // calls. Verifying against the locally rebuilt root would only prove the seed agrees with
        // itself.
        f.listedMemberVerifies =
            MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(deployer, GATED_OPERATOR_QTY));
        f.unlistedAddressRejected =
            !MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(stranger, GATED_OPERATOR_QTY));
    }
}
