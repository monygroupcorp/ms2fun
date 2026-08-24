// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { SeedSepoliaShared, IShowcaseCurveState, IMerkleGatingView, IShowcaseTierState } from "./SeedSepoliaShared.sol";
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
    // V4 pool params for the alignment-target pools this seed stands up: 0.3% fee, tickSpacing 60,
    // no hooks — the same tier `DeployCore` builds the deployment's vault keys from.
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev Starting price 1:1 (sqrt(1) * 2^96). A pool must be initialized before it can be named;
    ///      it holds no liquidity until someone adds some.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepolia: not running against Sepolia (or a fork of it)");

        _reportSpend("phase 1 (create + arm)", 0, deployer.balance);

        // ── Alignment wiring: fixture tokens, targets, vaults, pools ──
        SeedHandoff memory h = _seedAlignment(d);

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

        // Phase 2 becomes legal only once the LAST clock phase 1 set has passed, plus slack for the
        // wall-clock the broadcast itself consumed. Recorded rather than recomputed later, so the
        // orchestrator waits for the same instant the chain will judge the buys against.
        h.phase2NotBefore = latestArm + _phase2Slack();

        _assertPhase1(legs, instances);
        _assertBreadthPhase1(d, h);
        _writeSeedState(legs, instances, h);

        console.log("=== SeedSepolia (phase 1: create + arm) complete ===");
        console.log("  rows armed:", legs.length);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("  phase 2 is legal from (unix):", h.phase2NotBefore);
        console.log("  wall-clock wait from now (seconds):", h.phase2NotBefore - block.timestamp);
        console.log("  NEXT: wait out the window, then run SeedSepoliaBuys.s.sol");
    }

    // ─────────────────────── Alignment targets, vaults, pools ───────────────────────

    /// @dev Two fixture alignment targets with their own Uni-V4 vaults, carried over from the seed
    ///      this replaces. The tokens are FIXTURES: `MockERC20`s that exist so a target has an asset
    ///      to name and a vault something to be aligned to. They are labelled as fixtures in the
    ///      target's own on-chain description, because a testnet target that reads as a real
    ///      community token is exactly the fiction the showcase refuses.
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
            "Alignment target demonstrating the vault flow. Its asset is a testnet FIXTURE token, not a traded coin - what it exists to show is where a collection's alignment tithe goes and what the vault does with it."
        );
        h.cultTargetId = _registerTarget(
            registry,
            address(cult),
            "CULT",
            "Community",
            "A second alignment target, so the registry index and the target picker have more than one row to choose between. Its asset is a testnet FIXTURE token."
        );

        h.ms2Vault = _deployAndWireVault(d, factory, address(ms2), "MS2", h.ms2TargetId);
        h.cultVault = _deployAndWireVault(d, factory, address(cult), "CULT", h.cultTargetId);

        vm.stopBroadcast();

        console.log("ALIGNMENT ms2 target/vault:", h.ms2TargetId, h.ms2Vault);
        console.log("ALIGNMENT cult target/vault:", h.cultTargetId, h.cultVault);
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
        h.editions = _seedEditions(d, h.ms2Vault);
        h.gatedEditions = _seedGatedEditions(d, h.cultVault);
        h.staking404 = _seedStakingRow(d, h.ms2Vault);
        h.tiers404 = _seedTierRow(d, h.cultVault);
        h.carve404 = _seedCarveRow(d, h.ms2Vault);
        latestClock = _seedAuctions(d, h);
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
                    name: "atlas-editions",
                    symbol: "ATLAS",
                    metadataURI: _collectionMeta(
                        "Atlas Editions",
                        "This collection demonstrates the three ways an EDITION can be priced. One row is a fixed price, one rises with every mint, and one reserves part of its supply as a free claim. Open all three and compare what the mint button asks for.",
                        ART_EMBER
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
            _pieceMeta("Fixed Edition", ART_EMBER, "atlas-editions"),
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
            _pieceMeta("Rising Edition", ART_VAPOR, "atlas-editions"),
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
            _pieceMeta("Claim Edition", ART_CINDER, "atlas-editions"),
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
                    name: "veil-list",
                    symbol: "VEIL",
                    metadataURI: _collectionMetaWithAllowlist(
                        "Veil List",
                        "This collection demonstrates ALLOWLIST GATING. Each entry on the list commits to a wallet AND the quantity that wallet may take, so the contract - not the interface - decides who mints and how much. The seeded list is bound to the addresses below and cannot be joined from outside; connect one of them to pass, connect anything else to see the refusal.",
                        ART_VAPOR,
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
                "Veil Pass",
                GATED_EDITION_PRICE,
                GATED_EDITION_SUPPLY,
                _pieceMeta("Veil Pass", ART_VAPOR, "veil-list"),
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
    ///      WHAT THIS ROW DOES NOT YET HOLD: a running reward stream. The module is funded only by a
    ///      real LP-fee delta arriving through `claimAllFees`, which needs alignment-pool depth and
    ///      swap volume that a later wave seeds. Pushing ETH at it from a fixture here would
    ///      fabricate the reward source on a public showcase, so the stream is left armed and unfunded
    ///      and the row's description says which half is live.
    function _seedStakingRow(Deployed memory d, address vault) internal returns (address instance) {
        vm.startBroadcast();
        instance = _createBreadthCurve(
            d,
            vault,
            "quarry-staking",
            "QUARRY",
            "Quarry",
            "This collection demonstrates STAKING. Holders lock coin into the collection itself and take a pro-rata share of the trading fees it collects, streamed over a week rather than paid as a lump. The stake and unstake actions are live now; the fee stream begins once this collection's venue is carrying trades.",
            ART_CINDER,
            ART_BASE_ANIME,
            SHOWCASE_NFT_COUNT,
            d.stakingModule,
            0
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        b.activateStaking();
        b.setBondingOpenTime(block.timestamp + _armWindow());
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
    ///      THE ART IS THREE DIFFERENT COLLECTIONS, not three labels: ordinary pieces resolve to one,
    ///      band ids to a second, and the overlay commission phase 2 pays to a third. Precedence
    ///      (overlay over band over base) is only demonstrated if the layers can be told apart by eye.
    function _seedTierRow(Deployed memory d, address vault) internal returns (address instance) {
        ERC404Factory.TierSpec[] memory tiers = new ERC404Factory.TierSpec[](2);
        tiers[0] =
            ERC404Factory.TierSpec({ weight: TIER_OPEN_WEIGHT, count: TIER_OPEN_COUNT, baseURI: ART_BASE_ARCTIC });
        tiers[1] =
            ERC404Factory.TierSpec({ weight: TIER_SCARCE_WEIGHT, count: TIER_SCARCE_COUNT, baseURI: ART_BASE_ARCTIC });

        address[] memory children = new address[](2);
        children[0] = d.overlay; // precedence: holder pins and paid commissions win over...
        children[1] = d.tierResolver; // ...static band art, which wins over the collection base

        vm.startBroadcast();
        instance = d.erc404
            .createInstance(
                ERC404Factory.CreateParams({
                    salt: keccak256(abi.encode(block.timestamp, "prism-tiers", "ERC404-SEPOLIA")),
                    name: "prism-tiers",
                    symbol: "PRISM",
                    styleUri: "",
                    tokenBaseURI: ART_BASE_ANIME,
                    owner: deployer,
                    vault: vault,
                    nftCount: TIER_NFT_COUNT,
                    presetId: PRESET_NICHE,
                    stakingModule: address(0),
                    declaredMaxAllowanceBps: 0 // a metadata demonstration, not an economic one
                }),
                _collectionMeta(
                    "Prism",
                    "This collection demonstrates TOKEN TIERS and layered METADATA. Coin can be folded into a higher-denomination piece and unfolded again, and a piece's picture is resolved on-chain from three stacked layers - a paid commission over reserved-band art over the collection's own base. One rung is deliberately scarce, so it sells out and reopens as holders unfold.",
                    ART_FLARE
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
        // is a metadata directory too, and a FOURTH collection, because an opt-in wave that resolves
        // to the picture already showing reads as nothing happening.
        MetadataOverlayModule(d.overlay)
            .publishWave(
                instance,
                ART_BASE_DOODLE,
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
            "CARVE",
            "Carve",
            "This collection demonstrates the CREATOR CARVE and the disclosure that governs it. The maximum share of the raise this creator may ever take at graduation is fixed in the contract before the first buy, and the page shows it - so what the creator can do is priced in rather than discovered afterwards. The pool floor clamps the carve on a thin raise; it never blocks the graduation.",
            ART_FLARE,
            ART_BASE_SIMIAN,
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
                    name: slug,
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
                    name: "relic-line",
                    metadataURI: _collectionMeta(
                        "Relic Line",
                        "This auction house demonstrates how a lot ENDS. It runs two lines on a short clock: one lot takes a bid and is settled to its winner, the other attracts none and is reclaimed by the creator. Read both after they close - the settled lot minted a piece and split the hammer, the reclaimed one never minted at all.",
                        ART_CINDER
                    ),
                    creator: deployer,
                    vault: h.ms2Vault,
                    symbol: "RELIC",
                    lines: 2,
                    baseDuration: uint40(_timedAuctionSeconds()),
                    timeBuffer: AUCTION_TIME_BUFFER,
                    bidIncrement: AUCTION_BID_INCREMENT
                })
            );
        ERC721AuctionInstance t = ERC721AuctionInstance(payable(timed));
        // One lot per LINE, so both start immediately: a second lot on the same line would sit in the
        // queue behind the first and never reach an end state inside this seed.
        t.queuePiece{ value: deposit }(_pieceMeta("Relic I", ART_EMBER, "relic-line"));
        t.queuePiece{ value: deposit }(_pieceMeta("Relic II", ART_VAPOR, "relic-line"));

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
                    name: "salon-line",
                    metadataURI: _collectionMeta(
                        "Salon Line",
                        "This auction house demonstrates a LIVE lot. One piece is on the block with the clock running, the minimum is the creator's own deposit, and a late bid pushes the ending back so the last seconds cannot be sniped. Place a bid and watch the countdown move.",
                        ART_FLARE
                    ),
                    creator: deployer,
                    vault: h.cultVault,
                    symbol: "SALON",
                    lines: 1,
                    baseDuration: uint40(_liveAuctionSeconds()),
                    timeBuffer: AUCTION_TIME_BUFFER,
                    bidIncrement: AUCTION_BID_INCREMENT
                })
            );
        ERC721AuctionInstance l = ERC721AuctionInstance(payable(live));
        l.queuePiece{ value: deposit }(_pieceMeta("Salon I", ART_CINDER, "salon-line"));
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

    function _assertBreadthCurveArmed(address instance, string memory slug) internal view {
        IShowcaseCurveState s = IShowcaseCurveState(instance);
        require(s.bondingActive(), string.concat("phase1: ", slug, " is not armed"));
        require(s.bondingOpenTime() > block.timestamp, string.concat("phase1: ", slug, " opened during phase 1"));
        require(s.totalBondingSupply() == 0, string.concat("phase1: ", slug, " was bought into by phase 1"));
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
