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
import { AlignmentEndowmentVaultFactory } from "../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { SepoliaRouteQuoter } from "./SepoliaRouteQuoter.sol";
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

/// @notice Sepolia showcase seed, phase 1: alignment wiring, then create + arm every ERC404 row.
///         Buys nothing.
///
///         Run against the deployment `DeploySepolia` wrote (`deployments/sepolia.json`); every
///         address is read from that file rather than declared here.
///
///         Buys nothing because `setBondingOpenTime` rejects a non-future timestamp, `buyBonding`
///         reverts `TooEarly` before it, and forge simulates an entire script at one timestamp
///         before broadcasting any of it, so one script cannot both arm a curve and buy into it.
///         Phase 2 (`SeedSepoliaBuys.s.sol`) runs after the arm window has elapsed in wall-clock
///         time; `app/scripts/sepolia-seed/` is the orchestrator that waits it out.
///
///         Cost: creating and arming a curve moves no ETH (the create call carries no value, as the
///         deploy bond lever is off) and every other call here is a write, so phase 1 costs gas.
///
///         Run with:
///           forge script script/SeedSepolia.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepolia is SeedSepoliaShared {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev How many slots the wall rents. A constant because the projection is printed before the
    ///      rows exist; `_seedFeaturedWall` asserts it renders exactly this many, so the number the
    ///      operator was shown and the number spent cannot diverge.
    uint256 internal constant FEATURED_SLOTS = 4;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepolia: not running against Sepolia (or a fork of it)");

        // The featured wall is the only ETH this phase spends that is priced by time rather than by
        // depth, so its total is quoted off the deployed queue and printed with the rest, before
        // `--broadcast` sends anything.
        _reportSpend("phase 1 (create + arm)", 0, _quoteFeaturedSpend(d, FEATURED_SLOTS), deployer.balance);

        // ── Alignment wiring: fixture tokens, targets, vaults, pools ──
        SeedHandoff memory h = _seedAlignment(d);

        // ── The other venue, with its own target, vault and pool ──
        _seedZammVenue(d, h);

        // The instant every pool seeded above can first answer the deployment's TWAP window. Phase 2
        // pins the reference pools, and `setReferencePool` refuses a pool that cannot serve one.
        h.referenceReadyAt = block.timestamp + _twapWindow(d);

        // ── The ERC404 roster: create + arm, nothing bought ──
        ShowcaseLeg[] memory legs = _showcaseRoster();
        address[] memory instances = new address[](legs.length);
        uint256 armWindow = _armWindow();
        uint256 maturityOffset = _maturityOffset();
        uint256 latestArm;

        for (uint256 i = 0; i < legs.length; i++) {
            _assertPieceBase(legs[i].pieceBase, legs[i].slug);
            (address inst, uint256 armedUntil) = _createAndArm(d, legs[i], h.cultVault, armWindow, maturityOffset);
            instances[i] = inst;
            if (armedUntil > latestArm) latestArm = armedUntil;
            console.log(string.concat("ARMED ", legs[i].slug), inst);
        }

        // ── The breadth rows: every other project type and mechanism ──
        //
        // Runs after the curve roster because two of its rows bind to the alignment vaults the wiring
        // above created, and because its own clock (the timed auction) joins the same wait.
        uint256 breadthClock = _seedBreadth(d, h);
        if (breadthClock > latestArm) latestArm = breadthClock;

        // ── The front door: rent the wall the home page renders ──
        //
        // Last in the phase: every slot names an instance, and an instance has to be created and
        // registered before the queue accepts it.
        _seedFeaturedWall(d, h, legs, instances);

        // Phase 2 becomes legal only once the last clock phase 1 set has passed, plus slack for the
        // wall-clock the broadcast itself consumed. Recorded so the orchestrator waits for the same
        // instant the chain will judge the buys against.
        //
        // The TWAP window is one of those clocks: phase 2 pins the reference pools this phase
        // created, and a pool cannot answer a window-long TWAP until a window has passed. On a chain
        // that cannot be fast-forwarded that is wall-clock time, so it joins the same wait.
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

    /// @dev Two fixture alignment assets, and one alignment target per (asset, venue).
    ///
    ///      The tokens are `MockERC20`s this seed mints: the showcase shows a collection's alignment
    ///      tithe, the acquisition of the target's asset on a curated venue, and the LP of the pair.
    ///      Aligning to a real third-party testnet token would read as a claim about that token.
    ///      Every target's on-chain description says the asset is a fixture.
    ///
    ///      One asset can carry more than one target. The registry stores one acquire route per
    ///      (targetId, token), and a vault refuses to convert unless the route it reads names its own
    ///      venue, so a single target cannot carry a live convert on two venues for the same asset.
    ///      Each venue gets its own target, internally coherent: its route, its reference pool and
    ///      its vault all name the same venue. Presenting two targets over one asset as one row with
    ///      a venue choice is the picker's job, not the registry's.
    function _seedAlignment(Deployed memory d) internal returns (SeedHandoff memory h) {
        AlignmentRegistryV1 registry = AlignmentRegistryV1(d.alignmentRegistry);
        UniAlignmentVaultFactory factory = UniAlignmentVaultFactory(d.uniVaultFactory);
        AlignmentSeed[] memory roster = _alignmentRoster();

        h.targetTokens = new address[](roster.length);
        h.targetVaults = new address[](roster.length);
        h.targetIds = new uint256[](roster.length);
        h.endowmentVaults = new address[](roster.length);

        // The curated venue for every Uni target, set as each row is created so the registry and the
        // vault agree before anything is deposited. `feeOrHook` is zero: a ZAMM-only field on a
        // UNI_V4 leg is refused.
        IAlignmentRegistry.AcquireRoute memory uniRoute = IAlignmentRegistry.AcquireRoute({
            venue: IAlignmentRegistry.Venue.UNI_V4, fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, feeOrHook: 0
        });
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        vm.startBroadcast();
        for (uint256 i = 0; i < roster.length; i++) {
            AlignmentSeed memory a = roster[i];

            address token = address(new MockERC20(a.tokenName, a.symbol));
            uint256 targetId = _registerTarget(
                registry,
                token,
                a.symbol,
                a.title,
                a.description,
                // The row's own metadata, which is where its logo comes from: inline JSON pointing at
                // a content-addressed image. The registry carries the pointer, not the picture.
                _collectionMeta(a.title, a.description, string.concat(ART_IMG_TARGETS, a.logo))
            );
            address vault = _deployAndWireVault(d, factory, token, a.symbol, targetId);
            reg.setAcquireRoute(targetId, token, uniRoute);

            // The endowment family, on the rows that carry one. It differs from the LP vault beside it:
            // principal is held and a community is paid from the yield, rather than the tithe put to
            // work as liquidity. The community payout is left unset because it names a real
            // recipient, which is not a seed constant.
            if (a.endowment && d.aaveVaultFactory != address(0)) {
                h.endowmentVaults[i] = AlignmentEndowmentVaultFactory(d.aaveVaultFactory)
                    .deployVault(
                        keccak256(abi.encode(block.chainid, token, a.symbol, "AAVE-SHOWCASE", _vaultSaltNonce())),
                        token,
                        targetId
                    );
            }

            h.targetTokens[i] = token;
            h.targetVaults[i] = vault;
            h.targetIds[i] = targetId;

            // The two rows every collection binds to by name keep their own fields.
            if (_eq(a.symbol, "CULT")) {
                h.cultToken = token;
                h.cultVault = vault;
                h.cultTargetId = targetId;
            } else if (_eq(a.symbol, "MS2")) {
                h.ms2Token = token;
                h.ms2Vault = vault;
                h.ms2TargetId = targetId;
            }
        }
        vm.stopBroadcast();

        require(h.cultVault != address(0), "alignment: the roster carries no CULT row (every collection aligns to it)");
        require(h.ms2Vault != address(0), "alignment: the roster carries no MS2 row");

        for (uint256 i = 0; i < roster.length; i++) {
            console.log(
                string.concat("ALIGNMENT ", roster[i].title, " target/vault:"), h.targetIds[i], h.targetVaults[i]
            );
            if (h.endowmentVaults[i] != address(0)) {
                console.log(string.concat("  endowment vault: "), h.endowmentVaults[i]);
            }
        }

        // The price authorities, created here and pinned a TWAP window later (see `referenceReadyAt`).
        // Every row gets one, because a row a creator can pick is a row whose tithe must be able to
        // acquire.
        h.cultReferencePool = _seedReferencePool(d, h.cultToken, "CULT");
        h.ms2ReferencePool = _seedReferencePool(d, h.ms2Token, "MS2");
        for (uint256 i = 0; i < roster.length; i++) {
            if (_eq(roster[i].symbol, "CULT") || _eq(roster[i].symbol, "MS2")) continue;
            _seedReferencePool(d, h.targetTokens[i], roster[i].symbol);
        }

        // The depth the curated route claims, in the pool the acquire leg swaps through.
        for (uint256 i = 0; i < roster.length; i++) {
            _seedV4Depth(d, h.targetTokens[i], h.targetVaults[i], roster[i].symbol);
        }
    }

    // ─────────────────────── The reference pool (price authority) ───────────────────────

    /// @dev Stand up the {token, WETH} Uniswap V3 pool this asset's oracle floor will read.
    ///
    ///      It is created and seeded here and pinned in phase 2, because `setReferencePool` probes
    ///      `observe([window, 0])` and a pool initialized moments ago has no observation old enough to
    ///      answer that. The wait is wall-clock time on a public testnet, so it shares the gate the
    ///      arm window uses.
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
        // Read the pool's active liquidity back rather than trusting the mint's return: a position
        // minted outside the current tick range reports units while pricing nothing.
        require(
            IUniswapV3PoolMinimal(pool).liquidity() > 0,
            string.concat("reference: ", symbol, " position landed outside the pool's active range")
        );
        console.log(string.concat("REFERENCE ", symbol, " pool / ETH deposited (wei):"), pool, budget);
    }

    // ─────────────────────── Uniswap V4 venue depth ───────────────────────

    /// @dev Give the V4 pool the vault acquires through the depth to serve a convert inside the -5%
    ///      floor. Sepolia analog of the mainnet-fork depth seed; there is no deep pool to buy a
    ///      fixture asset on, so the token leg is minted. The floor is untouched.
    function _seedV4Depth(Deployed memory d, address token, address vault, string memory symbol) internal {
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

        // The route is registered here, and only here, because this is the first line at which it
        // is true: the pool the quoter names is `key`, and the three `require`s above establish that
        // `key` holds enough active liquidity to serve a convert. Registering earlier would point the
        // acquire leg at an empty pool.
        //
        // The row names this vault and no other. `token` alone would also answer the venue vaults
        // that share the asset (the ZAMM vault on MS2) and send their converts to this Uniswap pool
        // instead of the venue they LP into and floor against.
        vm.startBroadcast();
        SepoliaRouteQuoter(d.zQuoter).setRoute(vault, token, SepoliaRouteQuoter.AMM.UNI_V4, POOL_FEE_BPS);
        vm.stopBroadcast();

        console.log(string.concat("VENUE ", symbol, " uni-v4 depth - budget (wei):"), budget);
        console.log("  ETH leg deposited / token leg deposited:", ethUsed, tokenUsed);
        console.log("  active liquidity before / after:", uint256(activeBefore), uint256(activeAfter));
        console.log("  seeder (holds the position):", address(seeder));
    }

    // ─────────────────────── The ZAMM venue ───────────────────────

    /// @dev MS2's ZAMM leg: its own alignment target, a vault bound to the real ETH/MS2 pool key, and
    ///      the pool itself. A vault without its pool reports as liquidity-ready and reverts on its
    ///      first convert, so the pool and its depth are created together with the vault.
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
            "MS2-ZAMM",
            "The same FIXTURE asset as the MS2 target, curated on the ZAMM venue instead. A separate target because the registry curates ONE venue per target and asset, and a vault that LPs somewhere other than its curated route is exactly what that curation exists to prevent.",
            _collectionMeta(
                "MS2-ZAMM",
                "The MS2 target, curated on the ZAMM venue instead of Uniswap.",
                string.concat(ART_IMG_TARGETS, "MS2.png")
            )
        );
        h.ms2ZammVault = ZAMMAlignmentVaultFactory(d.zammVaultFactory)
            .deployVault(
                keccak256(abi.encode(block.chainid, h.ms2Token, "MS2", "ZAMM-SHOWCASE", _vaultSaltNonce())),
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

        // This vault's own best-route row, registered once the pool holds two-sided reserves, as for
        // the V4 rows. It names the pool the vault LPs into and falls back to, so it changes which
        // code reaches that pool, not where anything trades: `BestRouteAcquirer`'s typed `swapVZ`
        // leg instead of the fallback around it. That leg is one of the two this showcase exercises.
        vm.startBroadcast();
        SepoliaRouteQuoter(d.zQuoter).setRoute(h.ms2ZammVault, h.ms2Token, SepoliaRouteQuoter.AMM.ZAMM, d.zammFeeOrHook);
        vm.stopBroadcast();

        console.log("VENUE MS2 zamm target/vault:", h.ms2ZammTargetId, h.ms2ZammVault);
        console.log("  pool feeOrHook / ETH deposited (wei):", d.zammFeeOrHook, budget);
        console.log("  reserves (eth, token):", uint256(pool.reserve0), uint256(pool.reserve1));
    }

    function _registerTarget(
        AlignmentRegistryV1 registry,
        address token,
        string memory symbol,
        string memory title,
        string memory description,
        string memory metadataURI
    ) internal returns (uint256 targetId) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({
            token: token, symbol: symbol, info: description, metadataURI: metadataURI
        });
        targetId = registry.registerAlignmentTarget(title, description, metadataURI, assets);
    }

    /// @dev Deploy the target's vault, initialize its V4 pool, point the vault at that pool, and
    ///      register it. All four are needed: the pool key lives on the vault (not in the registry),
    ///      the pool has to exist before it can be named, and an unregistered vault is refused at
    ///      instance-create.
    function _deployAndWireVault(
        Deployed memory d,
        UniAlignmentVaultFactory factory,
        address token,
        string memory symbol,
        uint256 targetId
    ) internal returns (address vault) {
        // Keyed on the token, not on the target's ordinal: an ordinal renumbers whenever the roster
        // changes and drags every derived address with it. `_vaultSaltNonce` steps the address past a CREATE3 collision.
        bytes32 salt = keccak256(abi.encode(block.chainid, token, symbol, "UNIv4-SHOWCASE", _vaultSaltNonce()));
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
    ///      The pre-open row is armed on a different clock. Every other row opens after the short arm
    ///      window; the pre-open row must still be pre-open when a stranger arrives days later, so it
    ///      takes `SEPOLIA_PREOPEN_DELAY_SECONDS` (default 30 days) and is excluded from the wait
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

        // The artist's wave, published here because publishing is an artist write that needs no
        // holdings. Opting in is a holder write and cannot happen until phase 2 has bought into this
        // row. `WaveCond.NONE` at price 0 offers the upgraded edition to every holder, free, which is
        // why it rides the fully-recovered directory: whoever buys a piece on this row can opt in and
        // have it resolve, whatever id they were minted.
        if (leg.metadataOverlay) {
            MetadataOverlayModule(d.overlay)
                .publishWave(
                    inst,
                    ART_BASE_PIXELADYBC,
                    MetadataOverlayModule.WaveCond.NONE,
                    0,
                    0,
                    MetadataOverlayModule.Payout.ARTIST
                );
            console.log(string.concat("WAVE published on ", leg.slug), inst);
        }

        if (leg.state == STATE_PREOPEN) {
            b.setBondingOpenTime(block.timestamp + _preopenDelay());
            b.setBondingActive(true);
            armedUntil = 0; // never waited for
        } else {
            uint256 openAt = block.timestamp + armWindow;
            b.setBondingOpenTime(openAt);
            armedUntil = openAt;
            if (leg.state == STATE_READY) {
                // Maturity makes the graduate action live, and the setter requires it strictly after
                // the open time, so it is the open time plus a small offset; it, not the open time,
                // is this row's wait.
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
    ///      logs: forge simulates the whole script first, so a failure leaves no partial seed and
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
    //                    BREADTH — EVERY OTHER PROJECT TYPE, ON THE SAME TWO-PHASE SPINE
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Phase 1 creates and arms and buys nothing: the ERC404 rows below are armed on the same clock
    // as the curve roster, and the two auctions are listed here so their lots end inside the same
    // wall-clock wait the orchestrator performs. Phase 2 fills them.
    //
    // Cost: the auction lots carry a queue deposit (returned at settle, less a 1% cut at reclaim);
    // everything else in this phase is gas.

    /// @dev Seed every non-curve mechanism and record it in the hand-off. Returns the latest clock
    ///      phase 2 must wait past: the timed auction's end. The live auction is excluded, as the
    ///      pre-open curve row is, because it exists to still be running afterwards.
    function _seedBreadth(Deployed memory d, SeedHandoff memory h) internal returns (uint256 latestClock) {
        // The art these rows wear, checked before the first of them is created: the pre-condition
        // the roster performs on itself, over the directories the breadth rows name.
        _assertBreadthArt();
        h.editions = _seedEditions(d, h.cultVault);
        h.gatedEditions = _seedGatedEditions(d, h.cultVault);
        uint256 stakingMaturity;
        (h.staking404, stakingMaturity) = _seedStakingRow(d, h.ms2Vault);
        h.tiers404 = _seedTierRow(d, h.cultVault);
        h.carve404 = _seedCarveRow(d, h.cultVault);
        latestClock = _seedAuctions(d, h);
        if (stakingMaturity > latestClock) latestClock = stakingMaturity;
    }

    // ─────────────────────── 1. ERC-1155: three pricing regimes ───────────────────────

    /// @dev One collection carrying all three edition regimes, because they are properties of an
    ///      edition rather than of a collection. A visitor comparing the three rows on one page is
    ///      the demonstration.
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
            0,
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
            EDITION_FREE_ALLOCATION,
            0,
            0
        );
        vm.stopBroadcast();

        console.log("EDITIONS atlas-editions:", instance);
        console.log("  fixed / dynamic / free-claim editions:", EDITION_FIXED, EDITION_DYNAMIC, EDITION_FREE_CLAIM);
    }

    // ─────────────────────── 2. The Merkle allowlist ───────────────────────

    /// @dev A gated edition. The seeded tier is address-bound, as a Merkle allowlist is, so a cold
    ///      visitor cannot enter it, and the collection's own description says so. The gate is
    ///      otherwise real: the list is published as a `data:` URI the mint page can rebuild a proof
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
                GATED_FREE_ALLOCATION,
                0,
                0
            );

        // Post-create, by the instance owner: the factory threads no gating config (the generic slot
        // bakes in no module's config shape), so configuration is a second call.
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

    /// @dev An ERC404 row with the approved staking module wired and activated. Activation is
    ///      irreversible and is the creator's call, so it happens here.
    ///
    ///      The module's only funding path is a real LP-fee delta arriving through `claimAllFees`,
    ///      and `claimFees` pays a vault's benefactors, the collections that tithed to it. The row is
    ///      armed to graduate in phase 2: graduating makes it a benefactor with real shares, and its
    ///      share of a fee its vault's position earned starts the stream. Pushing ETH at the module
    ///      from a fixture would fabricate the reward source, so the seed does not.
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
        // Maturity gates the graduation this row's stream depends on; the setter requires it
        // strictly after the open time.
        maturedAt = openAt + _maturityOffset();
        b.setBondingMaturityTime(maturedAt);
        b.setBondingActive(true);
        vm.stopBroadcast();

        console.log("STAKING quarry-staking:", instance);
    }

    // ─────────────────────── 4/5. Metadata stack + Token Tiers ───────────────────────

    /// @dev An ERC404 created through the factory's metadata overload, wiring
    ///      resolver(router) -> [overlay, tier] and sealing a two-rung Token Tiers ladder in the same
    ///      transaction. The economic ladder and the band art table are derived from the same id
    ///      ranges, so the two tables cannot describe different ids.
    ///
    ///      The open rung (denomination 2, three ids) is minted up into and back down out of in
    ///      phase 2, so the reversible half of the feature is walkable. The scarce rung
    ///      (denomination 3, one id against a supply that could back twenty) is taken by the seed and
    ///      left taken, so `BandExhausted` is a state a visitor can observe.
    ///
    ///      The art is one family's lineage, read bottom to top: ordinary pieces resolve to the
    ///      parent collection, the open band to the derivative that succeeded it, and the scarce band
    ///      to the derivative after that. Band art over base is demonstrated only if the layers can
    ///      be told apart by eye. The overlay's own layers (waves and paid commissions) belong to the
    ///      artist-metadata row and are not wired here.
    function _seedTierRow(Deployed memory d, address vault) internal returns (address instance) {
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](2);
        tiers[0] =
            ERC404Factory.TierSpec({ weight: TIER_OPEN_WEIGHT, count: TIER_OPEN_COUNT, baseURI: ART_BASE_SONORA222 });
        tiers[1] =
            ERC404Factory.TierSpec({ weight: TIER_SCARCE_WEIGHT, count: TIER_SCARCE_COUNT, baseURI: ART_BASE_SCHIZO });

        // One child. The overlay (waves and paid commissions) belongs to the metadata row (see the
        // roster's `metadataOverlay` flag), so this row wires only what Token Tiers resolves
        // through: static band art over the collection base.
        address[] memory children = new address[](1);
        children[0] = d.tierResolver;

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
                    "It's like if banners, remilio, fumo, milady and bonkler were all in one DNT contract, where 100 coins = 1 banners, 200 coins = 2 banners or 1 remilio, 300 coins = 3 banners or 1 fumo, and so on and so forth. That is TOKEN TIERS: coin can be folded into a higher-denomination piece and unfolded again, and one rung here is deliberately scarce, so it sells out and reopens as holders unfold.",
                    ART_TILE_PRISM
                ),
                d.uniDeployer,
                address(0), // no gating on this row — the gate is its own collection
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                ERC404Factory.MetadataConfig({
                    resolver: d.resolverRouter,
                    childResolvers: children,
                    overlay: address(0), // no overlay on this row: `address(0)` is the factory's documented skip
                    tier: d.tierResolver,
                    tiers: tiers,
                    autoLatest: false, // unread with no overlay wired
                    defaultPayout: MetadataOverlayModule.Payout.ARTIST
                })
            );

        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        b.setBondingOpenTime(block.timestamp + _armWindow());
        b.setBondingActive(true);

        vm.stopBroadcast();

        console.log("TIERS prism-tiers:", instance);
        console.log("  open rung   - weight/count:", uint256(TIER_OPEN_WEIGHT), uint256(TIER_OPEN_COUNT));
        console.log("  scarce rung - weight/count:", uint256(TIER_SCARCE_WEIGHT), uint256(TIER_SCARCE_COUNT));
    }

    // ─────────────────────── 7. The carve ───────────────────────

    /// @dev The carve row declares its allowance up front and graduates with the carve requested in
    ///      phase 2. `declaredMaxAllowanceBps` is immutable per instance and readable before the first
    ///      buy; that immutability is the disclosure, so the declaration is made at create.
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

    /// @dev Create one breadth curve row. The parameters a row does not vary (owner, preset, LP
    ///      venue, gating, free mint) are stated once here.
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

    /// @dev Two auction houses, because a single instance carries one base duration and the three
    ///      states this must hold do not share one.
    ///
    ///        · the timed house runs for exactly the arm window over two lines. One lot takes a bid
    ///          and is settled in phase 2; the other takes none and is reclaimed. Both need real time
    ///          to end, which is the orchestrator's wait; a public testnet has no fast-forward.
    ///        · the live house runs long and keeps counting down, so a visitor arriving later finds a
    ///          lot that is still open to bid on.
    ///
    ///      The lot ids are read back off each line rather than assumed from the queue order.
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
                    vault: h.cultVault,
                    symbol: "MEW",
                    lines: 2,
                    baseDuration: uint40(_timedAuctionSeconds()),
                    timeBuffer: AUCTION_TIME_BUFFER,
                    bidIncrement: AUCTION_BID_INCREMENT
                })
            );
        ERC721AuctionInstance t = ERC721AuctionInstance(payable(timed));
        // One lot per line, so both start immediately: a second lot on the same line would queue
        // behind the first and never reach an end state inside this seed.
        t.queuePiece{ value: deposit }(_pieceMeta("Mewlady I", ART_PIECE_RELIC_I, "relic-line"));
        t.queuePiece{ value: deposit }(_pieceMeta("Mewlady II", ART_PIECE_RELIC_II, "relic-line"));

        uint256 soldLot = t.getActiveAuction(0);
        uint256 unsoldLot = t.getActiveAuction(1);
        require(soldLot != 0 && unsoldLot != 0, "auctions: a timed line did not start its lot");

        // The bid is the seed's own. The showcase has one funded account, so the winner of the
        // settled lot is that account: the state is real, the counterparty is not a second person,
        // and the post-conditions assert the token lands with the bidder.
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

        // The three breadth curves must be armed and unopened, like the spine's rows: a row that
        // opened during phase 1 cannot be bought by phase 2 at the price phase 2 projected.
        _assertBreadthCurveArmed(h.staking404, "quarry-staking");
        _assertBreadthCurveArmed(h.tiers404, "prism-tiers");
        _assertBreadthCurveArmed(h.carve404, "carve-demo");

        // Staking is activated here and staked in phase 2, so only the wiring half is asserted.
        ERC404BondingInstance quarry = ERC404BondingInstance(payable(h.staking404));
        require(
            address(quarry.stakingModule()) == d.stakingModule, "phase1: quarry-staking has the wrong staking module"
        );
        require(quarry.stakingActive(), "phase1: quarry-staking did not activate staking");

        // The carve row's disclosure is a phase-1 fact: it is sealed at create and is what a buyer
        // reads before the first buy.
        require(
            ERC404BondingInstance(payable(h.carve404)).declaredMaxAllowanceBps() == CARVE_DECLARED_MAX_BPS,
            "phase1: carve-demo did not seal its declared allowance"
        );

        // The tier ladder is sealed at create and cannot be supplied afterwards, so an empty or
        // mis-sized band is unrecoverable.
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

        // The auctions: both timed lots must be able to end inside the wait, and the live lot must
        // outlast it; otherwise phase 2 settles nothing and the live row is not live.
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

    /// @dev What phase 1 alone is responsible for on the venue legs: each target is curated at the
    ///      venue its vault LPs on, each vault is bound to the right asset and target and carries a
    ///      price validator, and every pool a convert swaps through holds depth.
    ///
    ///      The reference pin is phase 2's assertion: the pools this phase created cannot serve a
    ///      window-long TWAP until a window has passed.
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
            // MS2 is also a Uniswap target, so this vault's row is the one that proves the table
            // tells the two apart: it must name ZAMM at this deployment's feeOrHook, which is the
            // vault's own pool, and not the V4 tier its Uniswap sibling was registered at.
            (SepoliaRouteQuoter.AMM zSource, uint256 zFeeOrHook, bool zRouted) =
                SepoliaRouteQuoter(d.zQuoter).routeOf(h.ms2ZammVault, h.ms2Token);
            require(zRouted, "venue: the ZAMM vault carries no best-route row");
            require(zSource == SepoliaRouteQuoter.AMM.ZAMM, "venue: the ZAMM vault is best-routed off its own venue");
            require(
                zFeeOrHook == d.zammFeeOrHook,
                "venue: the ZAMM vault's best-route row names another pool than the one it LPs into"
            );
            _assertVaultBinding(h.ms2ZammVault, h.ms2Token, h.ms2ZammTargetId, "MS2 zamm");
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
        // The best-route table has to agree with the pool the checks above vouch for. A row
        // registered at another tier sends its convert to a pool nothing seeded; a missing row drops
        // to the fallback, which is the same pool only while a single tier exists. Either way the
        // showcase would not rehearse the acquire path it claims to. The row is read against this
        // vault, which keeps the Uni leg off the vaults that share the asset on another venue.
        require(d.zQuoter != address(0), string.concat("venue: ", label, " deployment wired no quoter"));
        (SepoliaRouteQuoter.AMM source, uint256 feeOrHook, bool routed) =
            SepoliaRouteQuoter(d.zQuoter).routeOf(vault, token);
        require(routed, string.concat("venue: ", label, " vault carries no best-route row"));
        require(
            source == SepoliaRouteQuoter.AMM.UNI_V4,
            string.concat("venue: ", label, " best-route table sends the vault off its curated venue")
        );
        require(
            feeOrHook == POOL_FEE_BPS,
            string.concat("venue: ", label, " best-route table does not name the seeded tier")
        );
        _assertVaultBinding(vault, token, targetId, label);
    }

    /// @dev A vault is bound to exactly one (asset, target) and prices through a validator. The
    ///      factory substitutes its default validator when a vault is deployed with zero, and a vault
    ///      left with a zero validator cannot price its own floor.
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
    ///      however much it holds; it is the one surface not seeded by creating collections.
    ///
    ///      The wall is the tour's first page, so it carries the product's arc rather than its
    ///      inventory: the graduated curve (the arc completed, trading on a real pool), the
    ///      mid-curve row (the arc in motion, and the one thing a visitor can act on immediately),
    ///      the edition set (a second project family, priced three ways on one page) and the live
    ///      auction (a third family, with a clock running). One per mechanism family, with the two
    ///      curve states leading because the curve is the product's spine.
    ///
    ///      The queue returns active slots sorted by effective rank, so without distinct boosts the
    ///      wall's order is whatever the sort makes of equal keys. Each slot is rented with a boost
    ///      one step above the next. Placement is bought and contestable, and every wei of it is
    ///      protocol revenue rather than a split.
    ///
    ///      The rent happens in phase 1 because `rentFeatured` refuses an unregistered instance and
    ///      phase 1 is where every instance is created and registered; phase 2 changes no row's
    ///      eligibility for a slot.
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
        // The bounds are the queue's and owner-tunable: a duration outside them reverts
        // `InvalidDuration` at the first rent. The require refuses it at simulation time and names
        // the environment variable that sets it.
        require(
            duration >= d.queue.minDuration() && duration <= d.queue.maxDuration(),
            "featured: SEPOLIA_FEATURED_DURATION_SECONDS is outside the queue's own duration bounds"
        );
        uint256 durationCost = d.queue.quoteDurationCost(duration);

        vm.startBroadcast();
        for (uint256 i = 0; i < wall.length; i++) {
            require(wall[i] != address(0), "featured: the wall names a row this seed did not create");
            uint256 rankBoost = _featuredRankBoost(i, wall.length);
            // Exactly what is due, since the refund path returns the excess through the WETH fallback
            // and the seed knows the price.
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

    /// @dev Resolve one roster row by name. The wall names the rows it features rather than indexing
    ///      them, since a positional reference re-targets when the roster changes.
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

    /// @dev The wall as the home page reads it, not as the seed remembers renting it. Read back
    ///      through `getFeaturedInstances`, the call `QueryAggregator.getHomePageData` makes, because
    ///      a paid slot that is not visible (an unregistered instance, a slot the cap pruned) renders
    ///      an empty front door.
    function _assertFeaturedPhase1(Deployed memory d, SeedHandoff memory h) internal view {
        require(h.featured.length == FEATURED_SLOTS, "featured: the wall is not the size that was quoted");

        // The whole visible wall, not only this seed's window of it: a deployment may carry
        // placements somebody else rented, and they sort among these by rank.
        (address[] memory rendered, uint256 total) = d.queue.getFeaturedInstances(0, d.queue.maxFeaturedSize());
        require(total >= FEATURED_SLOTS, "featured: the queue reports fewer active slots than were rented");

        uint256 previousPosition;
        for (uint256 i = 0; i < FEATURED_SLOTS; i++) {
            uint256 position = _positionInWall(rendered, h.featured[i]);
            require(position != type(uint256).max, "featured: a rented slot is not on the wall the home page reads");
            // The relative order of this seed's own slots is what the descending rank steps buy; it
            // is relative because the seed does not own the whole wall, and another placement may
            // outrank all of these without disturbing the tour's order.
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
        // Asked of the module the instance charges through, not recomputed here, so a second copy
        // of the pricing curve cannot drift.
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
        // Verified against the root that is installed, through the library the module calls;
        // verifying against the locally rebuilt root would only prove the seed agrees with itself.
        f.listedMemberVerifies =
            MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(deployer, GATED_OPERATOR_QTY));
        f.unlistedAddressRejected =
            !MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(stranger, GATED_OPERATOR_QTY));
    }
}
