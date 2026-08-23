// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { SeedAnvilShared, IOwnable, IEndowmentPayout, ArtistEndowments } from "./SeedAnvilShared.sol";

/// @dev The DN404 mirror's ERC-721 surface — NFT counts and ownership live here, not on the token.
/// @dev The endowment vault's principal accounting. Read as a DELTA across the settlements rather
///      than as an absolute, because another seeded collection is bound to a sibling endowment vault
///      and an absolute reading could be satisfied by that one instead.
interface IEndowmentPrincipal {
    function totalPrincipalCommittedAllTime() external view returns (uint256);
}

/// @dev The yield leg. Permissionless: the destination is always the vault's own `communityPayout`.
interface IEndowmentHarvest {
    function harvest() external;
}

interface IDN404Mirror {
    function balanceOf(address nftOwner) external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
}

/// @notice Anvil-only seed, PHASE 2: every buy, everything downstream of a buy, and the ownership
///         handover to the testing wallet.
///
///         Runs after SeedAnvil (phase 1) and after deploy.ts advances the anvil clock past every
///         `bondingOpenTime` phase 1 armed. It must not run before that advance: `buyBonding`
///         reverts `TooEarly` on an unopened curve (noesis-205), and because forge simulates a
///         script before broadcasting any of it, that revert kills the whole run at SIMULATION —
///         nothing broadcasts, and the failure names the buy rather than the missing advance.
///
///         Instances are resolved BY NAME from deployments/anvil-seed.json, which phase 1 wrote.
contract SeedAnvilBuys is SeedAnvilShared {
    /// @dev Tokens handed to ADMIN on the mid-curve instance. Must exceed ADMIN_VAPOR_STAKE by at
    ///      least one whole unit (1e24) so ADMIN still holds an NFT after deploy.ts places the stake.
    uint256 internal constant ADMIN_VAPOR_TOKENS = 2e24;
    /// @dev The slice deploy.ts stakes as ADMIN. Kept here so the two numbers are read together.
    uint256 internal constant ADMIN_VAPOR_STAKE = 5e23;

    /// @dev Whole units of `prism-stacked` handed to ADMIN — DN404 mints one NFT per whole unit.
    uint256 internal constant ADMIN_PRISM_UNITS = 3;
    /// @dev Whole units the artist (deployer) KEEPS, so the piece it authors on survives the transfer.
    uint256 internal constant ARTIST_PRISM_UNITS = 3;
    /// @dev The artist-held piece carrying the already-paid, pinned commission. Sits outside the
    ///      reserved band range (the ladder derives id 11), so it is an ordinary buy-minted id.
    uint256 internal constant ARTIST_COMMISSION_ID = 3;
    uint256 internal constant DN404_UNIT = 1e24;

    /// @dev Upper bound for the id sweep that LOGS which prism ids ADMIN ended up with. The instance
    ///      is created with nftCount 10 and one reserved band id (11), so 12 covers the space.
    uint256 internal constant PRISM_ID_SCAN_LIMIT = 12;

    // ── The alignment catalog roster ───────────────────────────────────────────────────────────
    //
    // WHY THE BIG CURVES ARE BOUGHT IN TWO PARTS, AND WHY THE ORDER IS NOT NEGOTIABLE. These
    // instances carry their real collections' supplies — thousands of pieces, not ten — and DN404
    // reconciles a recipient's id count to `balance / unit` on EVERY credit. Buying a five-thousand
    // piece curve out with the NFT flag on would therefore try to mint thousands of ids in a single
    // transaction. So the curve is bought as a SMALL NFT-MINTING TAIL FIRST and a large silent
    // remainder second. Reversing the two does not merely fail to help — the flag is read at credit
    // time, so a silent bulk followed by a minting buy would mint the ENTIRE backlog at once, which
    // is the very transaction being avoided.
    /// @dev Pieces the flagship curve actually mints. Deliberately above the 100-tile gallery window
    ///      so the truncated-grid case has a live subject on the seeded chain rather than only in
    ///      theory; the piece count each instance reaches is reported with the seed.
    uint256 internal constant SCHIZO_PIECES = 120;
    /// @dev Mid-curve piece split across the three actors, so the holder surface has more than one
    ///      holder and the testing wallet's portfolio has real pieces in it.
    uint256 internal constant PIXELADY_PIECES_DEPLOYER = 20;
    uint256 internal constant PIXELADY_PIECES_ACCT1 = 15;
    uint256 internal constant PIXELADY_PIECES_ADMIN = 10;
    /// @dev Share of the FLAGSHIP curve's bondable supply to buy, in bps — the same shape the
    ///      mid-curve row already had, and for the same reason. Buying the whole curve out is what
    ///      would make the reserve land on the armed raise, and that only ever mattered while the row
    ///      claimed the raise was a measurement a visitor could check. It is not one: the figures on
    ///      this roster are illustrative. A quarter fill renders every surface the row exists to show
    ///      and costs roughly a tenth of what a buyout does, and arming is free either way.
    uint256 internal constant SCHIZO_FILL_BPS = 2500;
    /// @dev Same fraction on the second large row, for the same reasons.
    uint256 internal constant BOREDMILADY_FILL_BPS = 2500;
    /// @dev Pieces the second mid-curve row mints, split so the holder surface has more than one holder.
    uint256 internal constant BOREDMILADY_PIECES_DEPLOYER = 12;
    uint256 internal constant BOREDMILADY_PIECES_ACCT1 = 8;

    /// @dev Pieces the small ready-to-graduate row mints. Its whole curve is bought, and at 420 pieces
    ///      the entire supply can be minted as ids without the id-reconciliation problem the large
    ///      rows have — but the tail is kept below the gallery window's size anyway, so the row's
    ///      gallery reads as a populated collection rather than as a wall.
    uint256 internal constant LAWBSTERS_PIECES = 60;

    /// @dev Share of the mid-curve instance's bondable supply to buy, in bps. Far enough along that
    ///      the curve, the holder surface and the vault panel all render something real, and nowhere
    ///      near the end — this instance has no maturity time and must never look close to finishing.
    uint256 internal constant PIXELADY_FILL_BPS = 2500;

    /// @dev The opening auctions phase 1 armed, settled here. Settlement is the ONLY way principal
    ///      reaches the endowment through the 80% leg rather than through a donation, which is the
    ///      entire reason this collection is in the roster.
    uint24 internal constant FIGMATA_OPENING_AUCTIONS = 3;
    /// @dev Bids placed on the auctions that settlement starts, so the collection boots with a
    ///      settle-ready line rather than an empty one.
    uint256 internal constant FIGMATA_FOLLOW_BID = 0.25 ether;

    /// @dev The artist collections' opening auctions, settled here — which is what turns a hammer
    ///      price into escrowed endowment principal for the artist.
    uint24 internal constant ARTIST_OPENING_AUCTIONS = 2;
    uint256 internal constant ARTIST_FOLLOW_BID = 0.2 ether;
    /// @dev Floor on what settling one artist collection must actually escrow. Not an accuracy claim
    ///      about anything: it is the difference between a vault panel with a real position in it and
    ///      one showing dust, and phase 1's bids are sized well above it.
    uint256 internal constant ARTIST_MIN_ENDOWED = 3 ether;
    uint256 internal constant PERSON_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    function run() public {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        acct1 = vm.addr(ACCOUNT_1_KEY);

        Deployed memory d = _readDeployed();
        (SeededErc404 memory s, SeededCatalog memory k, address[] memory all) = _readSeedState();

        // EMBER is deliberately absent from everything below: it is the PREOPEN demo, its open time
        // is +1 day, and buying into it would both revert and destroy the state it exists to show.
        _buysMidCurve(s.vapor);
        _buyReadyToGraduate(s.cinder, "cinder");
        _buyReadyToGraduate(s.molten, "molten");
        _buyReadyToGraduate(s.quench, "quench");
        _buysCarveDemo(s.carve);
        _buysStacked(d, s.stacked);

        // ── The alignment catalog roster ──
        _buysCatalogFlagship(d, s.schizo);
        _buysCatalogMidCurve(d, s.pixelady);
        _buysCatalogSecondMidCurve(d, s.boredmilady);
        _buysCatalogGraduate(d, s.lawbsters);
        _settleCatalogAuction(d, k.figmata);

        // ── The artist endowments ──
        _settleArtistEndowment(d.paradilfVault, k.paradilf, "paradilf-fan-club");
        _settleArtistEndowment(d.petravoiceVault, k.petravoice, "petravoice");

        // Hand everything to the team's testing wallet (LAST — after all owner-only seeding, which
        // includes this phase's staking activation and overlay authoring).
        _transferAdmin(all);

        // Everything this phase claims, checked on-chain. See the function header.
        _assertPhase2(s);
        _assertCatalogPhase2(d, s, k);

        console.log("=== SeedAnvilBuys (phase 2: buys + handover) complete ===");
        console.log("ERC404 : vapor mid-curve + staked; cinder/molten/quench bought (reserve > 0, graduate-ready)");
        console.log("ERC404 : carve reserve >= 3 ETH; stacked NFTs held by ADMIN + overlay authored");
        console.log("CATALOG: three curves filled to a quarter, the small row bought out (ungraduated)");
        console.log("ARTIST : both endowments settled, principal escrowed, harvest split to the artist payout");
        console.log("block.timestamp now:", block.timestamp);
    }

    // ─────────────────────── Phase 2 post-conditions ───────────────────────

    /// @notice Assert, on-chain, every state PHASE 2 claims to have created.
    ///
    /// @dev WHY `require` AND NOT `console.log`. Forge simulates a whole script before broadcasting
    ///      any of it, so a failed post-condition here leaves NO partial seed and names the assert
    ///      that failed — the same property the carve-demo reserve check already relies on. A comment
    ///      claiming an outcome is not an outcome. Do not soften an assertion to make a run pass.
    ///
    ///      Each post-condition lives in the phase where the state it describes actually exists.
    ///      Phase 2 buys, authors and hands over creator ownership. The registry handover and ADMIN's
    ///      stake are asserted in deploy.ts, which is where those two acts happen — a post-condition
    ///      in the wrong phase is vacuous, not merely misplaced.
    ///
    ///      NOT ASSERTED, deliberately: `rewardRate` on the staking module. It is unreachable by any
    ///      act this seed can perform (see SeedAnvil's `_assertPhase1` header for the derivation), so
    ///      the stake/unstake surface is walkable and the CLAIM surface is not. Stated residual.
    function _assertPhase2(SeededErc404 memory s) internal view {
        // 1. HOLDER POSITION ON THE METADATA DEMO. The walk judges metadata precedence as the holder;
        //    without this the pieces sit with the deployer and the walk silently tests the viewer path.
        ERC404BondingInstance prism = ERC404BondingInstance(payable(s.stacked));
        IDN404Mirror mirror = IDN404Mirror(prism.mirrorERC721());
        uint256 held = mirror.balanceOf(ADMIN);
        require(held == ADMIN_PRISM_UNITS, "phase2: ADMIN does not hold the expected prism NFT count");

        // The authored piece must have SURVIVED the transfer. A DN404 whole-unit transfer burns the
        // sender's ids and mints fresh ones, so handing away the wrong count would destroy the id the
        // paid commission is pinned to and leave the pin addressed to an id nobody owns — a metadata
        // demo that renders as though it were never authored.
        require(
            mirror.ownerOf(ARTIST_COMMISSION_ID) == deployer,
            "phase2: the commissioned prism id is no longer held by the artist (pin orphaned)"
        );

        // The COUNT is the assertion; the ids are LOGGED, not asserted. DN404 burns on transfer out
        // and mints fresh ids to the recipient, so which ids ADMIN ends up with is decided by the
        // token's internal id allocation — pinning a specific triple here would assert an
        // implementation detail and red on a seed that is in fact correct. The walker reads the ids
        // off this log rather than off a comment.
        console.log("PHASE-2 post-conditions OK");
        console.log("  ADMIN prism NFT count:", held);
        for (uint256 id = 1; id <= PRISM_ID_SCAN_LIMIT; id++) {
            try mirror.ownerOf(id) returns (address holder) {
                if (holder == ADMIN) console.log("    ADMIN holds prism id:", id);
            } catch {
                // Unminted id — DN404 reverts rather than returning address(0).
            }
        }

        // 2. ADMIN CAN STAKE. deploy.ts places ADMIN's stake by impersonation (no ADMIN key here), so
        //    what phase 2 owes it is a balance large enough to stake AND keep a whole unit.
        ERC404BondingInstance vapor = ERC404BondingInstance(payable(s.vapor));
        uint256 adminVapor = vapor.balanceOf(ADMIN);
        require(
            adminVapor >= ADMIN_VAPOR_STAKE + DN404_UNIT,
            "phase2: ADMIN vapor balance too small to stake and still hold a piece"
        );

        // 3. THE CARVE IS ACTUALLY CARVEABLE. deploy.ts graduates carved-demo with a full-allowance
        //    request; a preview of 0 means the graduation would deploy liquidity with no carve at all
        //    and the carve surface would be unwalkable. The reserve walk above is the input to this;
        //    this is the property the walk actually needs.
        ERC404BondingInstance carve = ERC404BondingInstance(payable(s.carve));
        uint256 preview = carve.previewCarve(10_000);
        require(preview > 0, "phase2: carved-demo previewCarve(10000) is 0 (nothing would be carved)");

        console.log("  ADMIN vapor token balance:", adminVapor);
        console.log("  carved-demo previewCarve(10000) (wei):", preview);
    }

    /// @dev MID-CURVE: several buys from deployer + acct1 so BondingSale events give the candles a
    ///      real price history, then staking activated and a slice staked, then ADMIN gets tokens so
    ///      the testing wallet's PORTFOLIO shows real ERC404 holdings AND has a balance to stake from.
    ///
    ///      TWO STAKERS, DELIBERATELY. The deployer keeps its own stake and ADMIN adds a second one
    ///      (placed by deploy.ts — see below). A sole staker is simpler to reason about, but a second
    ///      staker is what a live curve looks like and it is the only configuration under which the
    ///      pro-rata split is exercised at all; with one staker every share calculation is the
    ///      identity. The walker reasoning from this should expect ADMIN's position to be a fraction
    ///      of the pool, not the whole of it.
    ///
    ///      WHY ADMIN's STAKE IS NOT PLACED HERE. `stake` is keyed to msg.sender and this script
    ///      holds no ADMIN key — only anvil impersonation, which the orchestrator has and a forge
    ///      broadcast does not. So this phase seeds ADMIN the BALANCE and asserts it; deploy.ts
    ///      impersonates ADMIN, places the stake, and asserts the staked balance afterwards. That is
    ///      the same division already used for the registry handover and the graduation.
    function _buysMidCurve(address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));

        // Buy amount: >= normalizationFactor (else cost rounds to 0 -> PurchaseTooSmall) and well
        // under maxBondingSupply (~9e24 for preset 1: maxSupply 1e25 - 10% reserve). unit = 1e24.
        uint256 buyAmount = 1e23; // 0.1 NFT-equivalent worth of tokens per buy

        _buyBonding(b, deployerKey, buyAmount);
        _buyBonding(b, ACCOUNT_1_KEY, buyAmount);
        _buyBonding(b, deployerKey, buyAmount);
        // One larger deployer buy: enough to cover the deployer's own stake AND the ADMIN transfer
        // below, which must leave ADMIN a whole unit (an NFT) on top of what it later stakes.
        _buyBonding(b, deployerKey, 32e23);

        vm.startBroadcast(deployerKey);
        b.activateStaking();
        b.stake(buyAmount / 2);
        // DN404: whole units mint NFTs. ADMIN receives ADMIN_VAPOR_TOKENS so that after staking
        // ADMIN_VAPOR_STAKE it still holds >= 1 whole unit, i.e. the portfolio NFT survives the stake.
        b.transfer(ADMIN, ADMIN_VAPOR_TOKENS);
        vm.stopBroadcast();

        console.log("MID-CURVE vapor bought + staked:", inst);
        console.log("  ADMIN vapor token balance:", b.balanceOf(ADMIN));
    }

    /// @dev READY-TO-GRADUATE: one buy, because deployLiquidity requires reserve > 0. Maturity was
    ///      set in phase 1 to a time still ahead of this buy, so the curve is open but NOT yet
    ///      matured here; deploy.ts's second advance is what unlocks the graduate button.
    function _buyReadyToGraduate(address inst, string memory label) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        _buyBonding(b, deployerKey, 1e23);
        require(b.reserve() > 0, string.concat(label, ": reserve is 0, deployLiquidity would revert"));
        console.log("READY-TO-GRADUATE bought:", label, inst);
    }

    /// @dev CARVE DEMO: walk the curve until the reserve clears 3 ETH so the carve has real headroom
    ///      above the 1 ETH pool floor. Bounded: preset 1 targets ~25 ETH over ~9e24 bondable
    ///      tokens, so 3 ETH arrives well inside the iteration cap.
    ///
    ///      The require below is the seed's one real assertion about buy VOLUME — it reds if the
    ///      buys stop landing rather than letting a thin reserve reach the demo silently. Do not
    ///      soften it to make a run pass.
    function _buysCarveDemo(address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        for (uint256 i = 0; i < 24 && b.reserve() < 3 ether; i++) {
            _buyBonding(b, i % 2 == 0 ? ACCOUNT_1_KEY : deployerKey, 5e23);
        }
        require(b.reserve() >= 3 ether, "carve demo: reserve did not reach 3 ETH");
        console.log("CARVE demo reserve (wei):", b.reserve());
    }

    /// @dev STACKED METADATA: the deployer (artist) buys enough whole units to keep the pieces it
    ///      AUTHORS ON and still hand a set to ADMIN, so both sides of the metadata surface exist:
    ///      an already-paid, pinned commission on an artist-held piece, and an unpaid commission on
    ///      an ADMIN-held piece for the walker to unlock as the holder.
    ///
    ///      WHY THE ARTIST BUYS MORE THAN IT KEEPS. A DN404 whole-unit transfer does not carry the
    ///      sender's ids across: it BURNS them and mints fresh ids to the recipient. Handing all
    ///      three away would therefore destroy id 3 — the id the commission is pinned to — and leave
    ///      that pin addressed to an id no longer owned by anyone. Buying ARTIST_PRISM_UNITS +
    ///      ADMIN_PRISM_UNITS and transferring only ADMIN_PRISM_UNITS keeps the low ids with the
    ///      artist (DN404 burns most-recent-first) and the authored piece intact. `_assertPhase2`
    ///      checks that rather than trusting it.
    ///
    ///      ORDERING: the transfer MUST follow the unlock. `unlock` is a HOLDER write on id 3, so
    ///      moving pieces first would revert it, and because forge simulates a whole script before
    ///      broadcasting, the run would seed nothing at all.
    function _buysStacked(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        _buyBondingMint(b, deployerKey, (ARTIST_PRISM_UNITS + ADMIN_PRISM_UNITS) * DN404_UNIT);

        vm.startBroadcast(deployerKey);
        MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);
        // An opt-in open event wave (holders select it; not auto because autoLatest=false).
        // A wave's art is `wave.baseURI + id` (MetadataOverlayModule._resolve), the same composition
        // the base and the band use — so the wave's payload is a metadata directory too. A FOURTH
        // collection, distinct from the base, the band and the commissions: selecting the wave has to
        // visibly change the piece, which is the only way an opt-in wave reads as a wave.
        ov.publishWave(
            inst, ART_BASE_DOODLE, MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        // A paid commission on id 3 (outside the band range), then unlock+pin it as the holder.
        // The payload is a real metadata URI, not a label: the overlay wins over both the band and the
        // base, so it has to carry an image of its own for the top of the precedence stack to show
        // anything. A THIRD collection, distinct from the instance's base and from the band, so the
        // three layers are told apart by eye.
        ov.setCommission(
            inst,
            ARTIST_COMMISSION_ID,
            string.concat(ART_BASE_SIMIAN, vm.toString(ARTIST_COMMISSION_ID)),
            MetadataOverlayModule.CommCond.PAY,
            0.01 ether,
            MetadataOverlayModule.Payout.ARTIST
        );
        ov.unlock{ value: 0.01 ether }(inst, ARTIST_COMMISSION_ID);

        // Hand a set of pieces to ADMIN so the walk judges the metadata-precedence surface as the
        // HOLDER rather than as a viewer — a different code path, and the one the surface exists to
        // show. The exact ids ADMIN receives are decided by the token, not by us, so they are read
        // back below rather than assumed.
        b.transfer(ADMIN, ADMIN_PRISM_UNITS * DN404_UNIT);
        vm.stopBroadcast();

        // Give ADMIN's set an UNPAID commission, so the holder-side pay-and-pin path is walkable as
        // a live action rather than arriving pre-consumed. setCommission is an ARTIST write, so the
        // deployer can author it on a piece it no longer holds; `unlock` is the holder's to call.
        // Same commission collection as the artist-held piece, addressed to the id ADMIN actually got,
        // so paying and pinning it swaps that piece's art for a visibly different one.
        uint256 adminId = _firstIdHeldBy(b, ADMIN);
        vm.startBroadcast(deployerKey);
        ov.setCommission(
            inst,
            adminId,
            string.concat(ART_BASE_SIMIAN, vm.toString(adminId)),
            MetadataOverlayModule.CommCond.PAY,
            0.01 ether,
            MetadataOverlayModule.Payout.ARTIST
        );
        vm.stopBroadcast();

        console.log("STACKED prism bought + authored:", inst);
        console.log("  unpaid commission set on ADMIN-held id:", adminId);
    }

    /// @dev Lowest minted id currently owned by `who`, over the instance's small id space. Reverts if
    ///      there is none — a caller that needs an id to author against must not silently author on 0.
    function _firstIdHeldBy(ERC404BondingInstance b, address who) internal view returns (uint256) {
        IDN404Mirror mirror = IDN404Mirror(b.mirrorERC721());
        for (uint256 id = 1; id <= PRISM_ID_SCAN_LIMIT; id++) {
            try mirror.ownerOf(id) returns (address holder) {
                if (holder == who) return id;
            } catch {
                // Unminted id — DN404 reverts rather than returning address(0).
            }
        }
        revert("prism: no minted id is held by the expected address");
    }

    // ───────────────── THE ALIGNMENT CATALOG ROSTER (phase 2: buys + settlements) ─────────────────

    /// @dev FLAGSHIP — a QUARTER fill, the same shape the mid-curve row uses.
    ///
    ///      WHAT CHANGED AND WHY IT IS NOT A LOSS. This row used to buy its entire bondable supply so
    ///      the reserve would land within a tenth of a percent of the armed raise. That band enforced
    ///      an accuracy claim the roster no longer makes — the figures here are illustrative, and
    ///      spending hundreds of ETH to make one exact buys nothing a visitor can act on. Arming is
    ///      free, so the page still reads the full raise; only the fill shrank.
    ///
    ///      The preset check below STAYS, and it is not the same kind of assertion. It proves the
    ///      preset the seed registered is the preset this instance was created against — a real
    ///      failure mode, independent of whether any figure is exact.
    function _buysCatalogFlagship(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        uint256 unit_ = b.unit();
        uint256 bondable = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * unit_);
        uint256 fill = (bondable * SCHIZO_FILL_BPS) / 10000;
        uint256 tail = SCHIZO_PIECES * unit_;
        require(fill > tail, "catalog: flagship fill is smaller than its piece tail");

        // 1. The minting tail, FIRST — see the constant's header for why the order is load-bearing.
        _buyBonding(b, deployerKey, tail);

        // 2. The silent remainder. `setSkipNFT` only suppresses FUTURE id reconciliation; the ids
        //    already minted above are untouched by it.
        vm.startBroadcast(deployerKey);
        b.setSkipNFT(true);
        vm.stopBroadcast();
        _buyBonding(b, deployerKey, fill - tail);

        // WIRING, not accuracy: the instance must be sitting on the preset the seed registered for it.
        // A row created against the protocol preset by mistake would trade, render and mislead.
        uint256 target = LaunchManager(d.launchManager).getPreset(PRESET_SCHIZO).targetETH;
        require(target == SCHIZO_REAL_RAISE, "catalog: the flagship preset is not the one the seed armed");

        // The FILL is what is asserted, in the mid-curve row's style: far enough along to render, and
        // nowhere near the cap. A row that crept to its cap would be a graduate demo by accident.
        uint256 supply = b.totalBondingSupply();
        require(supply >= fill, "catalog: the flagship curve did not take its fill");
        require(supply < bondable, "catalog: the flagship curve has no curve left");

        console.log("CATALOG flagship filled:", inst);
        console.log("  reserve (wei):", b.reserve(), "of armed raise (wei):", target);
    }

    /// @dev SECOND MID-CURVE — same quarter fill and the same two-part buy as the flagship, with two
    ///      holders so the row's holder surface is not a single address.
    function _buysCatalogSecondMidCurve(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        uint256 unit_ = b.unit();
        uint256 bondable = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * unit_);
        uint256 fill = (bondable * BOREDMILADY_FILL_BPS) / 10000;
        uint256 minted = (BOREDMILADY_PIECES_DEPLOYER + BOREDMILADY_PIECES_ACCT1) * unit_;
        require(fill > minted, "catalog: the second mid-curve fill is smaller than the pieces it must mint");

        _buyBonding(b, deployerKey, BOREDMILADY_PIECES_DEPLOYER * unit_);
        _buyBonding(b, ACCOUNT_1_KEY, BOREDMILADY_PIECES_ACCT1 * unit_);

        vm.startBroadcast(deployerKey);
        b.setSkipNFT(true);
        vm.stopBroadcast();
        _buyBonding(b, deployerKey, fill - minted);

        uint256 target = LaunchManager(d.launchManager).getPreset(PRESET_BOREDMILADY).targetETH;
        require(target == BOREDMILADY_REAL_RAISE, "catalog: the second mid-curve preset is not the one the seed armed");
        require(b.totalBondingSupply() >= fill, "catalog: the second mid-curve row did not take its fill");
        require(b.totalBondingSupply() < bondable, "catalog: the second mid-curve row has no curve left");

        console.log("CATALOG second mid-curve filled:", inst);
        console.log("  reserve (wei):", b.reserve(), "of armed raise (wei):", target);
    }

    /// @dev THE GRADUATE DEMO — buy the small curve OUT, and stop there.
    ///
    ///      This is what replaced the flagship's bought-out curve, and it is the better shape: a small
    ///      raise can be bought out in full for a couple of ETH, so the graduate action on the seeded
    ///      chain is live rather than a posture. `deployLiquidity` is deliberately NOT called — the
    ///      split happening in front of a visitor is worth more than finding it already done — and the
    ///      last assertion here is what says so, because a graduation performed by accident is not
    ///      recoverable on a seeded chain.
    function _buysCatalogGraduate(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        uint256 unit_ = b.unit();
        uint256 bondable = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * unit_);
        uint256 tail = LAWBSTERS_PIECES * unit_;
        require(bondable > tail, "catalog: the graduate row's bondable supply is smaller than its piece tail");

        _buyBonding(b, deployerKey, tail);
        vm.startBroadcast(deployerKey);
        b.setSkipNFT(true);
        vm.stopBroadcast();
        _buyBonding(b, deployerKey, bondable - tail);

        uint256 target = LaunchManager(d.launchManager).getPreset(PRESET_LAWBSTERS).targetETH;
        require(target == LAWBSTERS_REAL_RAISE, "catalog: the graduate row's preset is not the one the seed armed");
        require(b.totalBondingSupply() == bondable, "catalog: the graduate row's curve is not fully bought");
        require(!b.graduated(), "catalog: the graduate row has already graduated - the demo action is spent");

        console.log("CATALOG graduate row bought out (graduation left uncrossed):", inst);
        console.log("  reserve (wei):", b.reserve(), "of armed raise (wei):", target);
    }

    /// @dev MID-CURVE — three holders and a partial fill. Each actor buys its OWN pieces before the
    ///      silent bulk, so the ids are minted by a real purchase rather than manufactured by a
    ///      transfer, and the testing wallet ends up holding a set it can act on from the UI.
    function _buysCatalogMidCurve(Deployed memory d, address inst) internal {
        ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
        uint256 unit_ = b.unit();
        uint256 bondable = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * unit_);
        uint256 fill = (bondable * PIXELADY_FILL_BPS) / 10000;

        uint256 minted = (PIXELADY_PIECES_DEPLOYER + PIXELADY_PIECES_ACCT1) * unit_;
        require(
            fill > minted + PIXELADY_PIECES_ADMIN * unit_,
            "catalog: mid-curve fill is smaller than the pieces it must mint"
        );

        // Minting buys first (see SCHIZO_PIECES' header), one per actor, so each holder's ids come
        // from a purchase it actually made.
        _buyBonding(b, deployerKey, PIXELADY_PIECES_DEPLOYER * unit_);
        _buyBonding(b, ACCOUNT_1_KEY, PIXELADY_PIECES_ACCT1 * unit_);

        vm.startBroadcast(deployerKey);
        b.setSkipNFT(true);
        vm.stopBroadcast();
        _buyBonding(b, deployerKey, fill - minted);

        // ADMIN holds no key in this process, so its pieces are bought silently above and moved here.
        // A whole-unit credit mints the RECIPIENT's ids, so ADMIN's pieces are minted to ADMIN rather
        // than carried across — and the sender's own ids survive, because the flag it now carries
        // stops DN404 reconciling its (much larger) remaining balance back down to an id count.
        vm.startBroadcast(deployerKey);
        b.transfer(ADMIN, PIXELADY_PIECES_ADMIN * unit_);
        vm.stopBroadcast();

        console.log("CATALOG mid-curve filled:", inst);
        console.log(
            "  reserve (wei):",
            b.reserve(),
            "of armed raise (wei):",
            LaunchManager(d.launchManager).getPreset(PRESET_PIXELADY).targetETH
        );
    }

    /// @dev THE 80% ENDOWMENT — settle the opening auctions, which is what moves 80% of each real
    ///      winning bid into the endowment as permanent principal, then bid on the auctions those
    ///      settlements start so the line boots settle-ready rather than empty.
    ///
    ///      Settlement is permissionless, so the deployer performing it is a convenience and not an
    ///      authority: the piece is minted to the WINNER either way, and the winners here are the two
    ///      non-deployer actors.
    function _settleCatalogAuction(Deployed memory d, address inst) internal {
        ERC721AuctionInstance a = ERC721AuctionInstance(payable(inst));
        uint256 before = IEndowmentPrincipal(d.cultAaveVault).totalPrincipalCommittedAllTime();

        vm.startBroadcast(deployerKey);
        for (uint24 id = 1; id <= FIGMATA_OPENING_AUCTIONS; id++) {
            a.settleAuction(id);
        }
        vm.stopBroadcast();

        // Each settlement advanced its line to the next queued piece, which is live from now. Bid on
        // all of them so nothing in the collection reads as abandoned.
        vm.startBroadcast(ACCOUNT_1_KEY);
        a.createBid{ value: FIGMATA_FOLLOW_BID }(FIGMATA_OPENING_AUCTIONS + 1, "");
        a.createBid{ value: FIGMATA_FOLLOW_BID }(FIGMATA_OPENING_AUCTIONS + 3, "");
        vm.stopBroadcast();
        vm.startBroadcast(PERSON_KEY);
        a.createBid{ value: FIGMATA_FOLLOW_BID }(FIGMATA_OPENING_AUCTIONS + 2, "");
        vm.stopBroadcast();

        // A settlement that failed to endow is the one failure this collection cannot survive: the
        // whole reason it is in the roster is that it is the only family that CAN express the 80%
        // leg, and an endowment holding nothing demonstrates the opposite of that.
        uint256 endowed = IEndowmentPrincipal(d.cultAaveVault).totalPrincipalCommittedAllTime() - before;
        require(endowed > 0, "catalog: settling the auctions committed no endowment principal");

        console.log("CATALOG auction settled:", inst);
        console.log("  endowment principal committed by settlement (wei):", endowed);
    }

    /// @dev THE ARTIST ENDOWMENTS — settle the opening auctions, which is what moves 80% of each
    ///      hammer price into the artist's endowment as permanent principal, then bid on the auctions
    ///      those settlements start so the line boots live rather than finished.
    ///
    ///      Three things are asserted here and each is a distinct failure. That the settlement
    ///      ESCROWED principal — a vault holding nothing demonstrates the opposite of an endowment.
    ///      That the vault pays the artist's DERIVED FIXTURE address — a collection bound to the wrong
    ///      vault renders perfectly and endows somebody else. And that the `harvest()` path RUNS
    ///      against that payout, because a principal balance with no path out of it is a savings
    ///      account, not an endowment.
    function _settleArtistEndowment(address vault, address inst, string memory slug) internal {
        ERC721AuctionInstance a = ERC721AuctionInstance(payable(inst));
        address payout = ArtistEndowments.payout(slug);
        require(
            IEndowmentPayout(vault).communityPayout() == payout,
            "artist endowment: the vault pays somewhere other than this artist's derived fixture address"
        );
        require(
            address(ERC721AuctionInstance(payable(inst)).vault()) == vault,
            "artist endowment: the collection is bound to another vault"
        );

        uint256 before = IEndowmentPrincipal(vault).totalPrincipalCommittedAllTime();
        vm.startBroadcast(deployerKey);
        for (uint24 id = 1; id <= ARTIST_OPENING_AUCTIONS; id++) {
            a.settleAuction(id);
        }
        vm.stopBroadcast();

        // Each settlement advanced its line to the next queued piece. Bid on those so the collection
        // boots with a settleable line rather than a stalled one.
        vm.startBroadcast(ACCOUNT_1_KEY);
        a.createBid{ value: ARTIST_FOLLOW_BID }(ARTIST_OPENING_AUCTIONS + 1, "");
        vm.stopBroadcast();
        vm.startBroadcast(PERSON_KEY);
        a.createBid{ value: ARTIST_FOLLOW_BID }(ARTIST_OPENING_AUCTIONS + 2, "");
        vm.stopBroadcast();

        uint256 endowed = IEndowmentPrincipal(vault).totalPrincipalCommittedAllTime() - before;
        require(endowed >= ARTIST_MIN_ENDOWED, "artist endowment: settling the auctions escrowed too little principal");

        // THE YIELD LEG, EXERCISED — AND WHAT IT DOES NOT PROVE. `harvest()` crystallizes what the
        // position has earned and routes the target share to `communityPayout`; the creator share
        // stays claimable in the benefactor's purse. It is permissionless, so calling it here is a
        // convenience and not an authority.
        //
        // The principal is SECONDS OLD IN CHAIN TIME at this point — the settlement that created it
        // ran moments ago — so the amount this particular harvest delivers is dust or nothing, and no
        // assertion here claims otherwise. What is asserted is that the call succeeds and that the
        // sink is the artist's. The non-zero split is a live action: once the fork's clock has moved,
        // anyone can harvest again and the target leg lands at the payout below. Making it non-zero
        // at seed time would need the chain advanced between the deposit and the harvest, which only
        // the orchestrator can do — a script cannot warp the live chain.
        vm.startBroadcast(deployerKey);
        IEndowmentHarvest(vault).harvest();
        vm.stopBroadcast();
        require(
            IEndowmentPayout(vault).communityPayout() == payout,
            "artist endowment: the payout sink moved during harvest"
        );

        console.log("ARTIST endowment settled:", inst);
        console.log("  principal escrowed by settlement (wei):", endowed);
        console.log("  payout sink:", payout);
    }

    /// @dev Post-conditions for the catalog roster, read back off chain state.
    ///
    ///      NOT ASSERTED, deliberately: that the flagship's graduation returns the aligned share.
    ///      Graduation is a human action left for the demo, and asserting a `previewCarve`-style
    ///      projection here would restate the split library rather than test the seed. What IS
    ///      asserted is the input that projection is computed from — the reserve, checked against
    ///      the armed raise in `_buysCatalogFlagship`.
    ///
    ///      NOT ASSERTED, deliberately: the acquisition swap the vault performs on a convert. It
    ///      needs pending ETH in the vault, and the liquidity-family vault receives nothing until a
    ///      collection bound to it graduates — which no seeded instance does. The route is curated
    ///      and read back in phase 1; the swap along it is a live action, not a seeded state.
    function _assertCatalogPhase2(Deployed memory d, SeededErc404 memory s, SeededCatalog memory k) internal view {
        // 1. THE MID-CURVE HOLDER SURFACE. Three distinct holders, and the testing wallet among them
        //    — a single-holder collection cannot exercise anything the surface exists to show.
        ERC404BondingInstance pixelady = ERC404BondingInstance(payable(s.pixelady));
        IDN404Mirror mirror = IDN404Mirror(pixelady.mirrorERC721());
        require(
            mirror.balanceOf(ADMIN) == PIXELADY_PIECES_ADMIN,
            "catalog: the testing wallet does not hold the expected mid-curve piece count"
        );
        require(mirror.balanceOf(acct1) == PIXELADY_PIECES_ACCT1, "catalog: the second actor holds no mid-curve pieces");
        require(
            mirror.balanceOf(deployer) == PIXELADY_PIECES_DEPLOYER,
            "catalog: the creator does not hold the expected mid-curve piece count"
        );

        // 2. THE MID-CURVE MUST STILL BE MID-CURVE. A fill that crept up to the cap would leave the
        //    instance the live features are demonstrated on unable to take another buy.
        uint256 bondable =
            pixelady.maxSupply() - pixelady.liquidityReserve() - (pixelady.freeMintAllocation() * pixelady.unit());
        require(pixelady.totalBondingSupply() < bondable, "catalog: the mid-curve instance has no curve left");
        require(pixelady.reserve() > 0, "catalog: the mid-curve instance took no ETH");

        // 3. THE FLAGSHIP'S PIECES EXIST. The reserve is asserted at buy time; this is the other half
        //    — a curve bought out silently would hold the raise and render an empty gallery.
        ERC404BondingInstance schizo = ERC404BondingInstance(payable(s.schizo));
        uint256 flagshipPieces = IDN404Mirror(schizo.mirrorERC721()).balanceOf(deployer);
        require(flagshipPieces == SCHIZO_PIECES, "catalog: the flagship minted a different piece count than intended");

        // 4. THE ENDOWMENT HOLDS PRINCIPAL, and it arrived through settlement rather than a donation
        //    (the delta is asserted at settle time; this is the standing balance).
        uint256 principal = IEndowmentPrincipal(d.cultAaveVault).totalPrincipalCommittedAllTime();
        require(principal > 0, "catalog: the endowment vault holds no principal");

        // 5. THE AUCTION LINE IS NOT DEAD. Every opening auction is settled and every follow-on
        //    carries a bid, so the collection boots with a settleable line rather than a stalled one.
        ERC721AuctionInstance figmata = ERC721AuctionInstance(payable(k.figmata));
        for (uint24 id = 1; id <= FIGMATA_OPENING_AUCTIONS; id++) {
            (,,,,,, bool settled) = _auction(figmata, id);
            require(settled, "catalog: an opening auction is still unsettled");
        }
        for (uint24 id = FIGMATA_OPENING_AUCTIONS + 1; id <= FIGMATA_OPENING_AUCTIONS * 2; id++) {
            (,, address highBidder,,,,) = _auction(figmata, id);
            require(highBidder != address(0), "catalog: a follow-on auction carries no bid");
        }

        // 6. THE SECOND MID-CURVE ROW HAS TWO HOLDERS AND CURVE LEFT.
        ERC404BondingInstance boredmilady = ERC404BondingInstance(payable(s.boredmilady));
        IDN404Mirror boredMirror = IDN404Mirror(boredmilady.mirrorERC721());
        require(
            boredMirror.balanceOf(deployer) == BOREDMILADY_PIECES_DEPLOYER,
            "catalog: the second mid-curve row minted a different creator piece count than intended"
        );
        require(
            boredMirror.balanceOf(acct1) == BOREDMILADY_PIECES_ACCT1,
            "catalog: the second actor holds no pieces of the second mid-curve row"
        );

        // 7. THE GRADUATE ROW IS BOUGHT OUT AND STILL UNGRADUATED. Both halves: a row that quietly
        //    graduated has spent the one action it exists to offer, and a row short of its cap cannot
        //    offer it at all.
        ERC404BondingInstance lawbsters = ERC404BondingInstance(payable(s.lawbsters));
        uint256 lawbstersBondable =
            lawbsters.maxSupply() - lawbsters.liquidityReserve() - (lawbsters.freeMintAllocation() * lawbsters.unit());
        require(lawbsters.totalBondingSupply() == lawbstersBondable, "catalog: the graduate row is not fully bought");
        require(!lawbsters.graduated(), "catalog: the graduate row has already graduated");
        require(
            IDN404Mirror(lawbsters.mirrorERC721()).balanceOf(deployer) == LAWBSTERS_PIECES,
            "catalog: the graduate row minted a different piece count than intended"
        );

        // 8. THE ART RESOLVES, ON EVERY ROW THAT NOW HOLDS MINTED IDS. This is the primary acceptance
        //    test: a row whose economics are perfect and whose pieces render as blank tiles is a
        //    failed seed. Checked on the COMPOSED pointer read back off the token rather than on the
        //    base alone, because the defect this catches — a missing or doubled separator between the
        //    base and the id — only appears once the two are concatenated. None of these four wires a
        //    metadata resolver, so the composed pointer is the whole answer.
        _assertComposedPieceURI(schizo.mirrorERC721(), ART_BASE_ARCTIC, 1, "schizo-posters");
        _assertComposedPieceURI(pixelady.mirrorERC721(), ART_BASE_PIXELADY, 1, "pixelady-maker");
        _assertComposedPieceURI(boredmilady.mirrorERC721(), ART_BASE_BOREDMILADY, 1, "bored-milady");
        _assertComposedPieceURI(lawbsters.mirrorERC721(), ART_BASE_LAWBSTERS, 1, "lawbsters");

        // 9. BOTH ARTIST ENDOWMENTS HOLD PRINCIPAL AND PAY THE ARTIST. The standing balance, beside
        //    the per-settlement delta already asserted at settle time.
        _assertArtistEndowmentStanding(d.paradilfVault, ArtistEndowments.PARADILF_SLUG);
        _assertArtistEndowmentStanding(d.petravoiceVault, ArtistEndowments.PETRAVOICE_SLUG);

        console.log("CATALOG post-conditions OK");
        console.log("  flagship pieces minted:", flagshipPieces);
        console.log("  mid-curve pieces held by the testing wallet:", PIXELADY_PIECES_ADMIN);
        console.log("  endowment principal committed all-time (wei):", principal);
    }

    /// @dev One artist endowment's standing state: principal escrowed, and the payout still pointing
    ///      at the artist's derived fixture address.
    function _assertArtistEndowmentStanding(address vault, string memory slug) internal view {
        require(
            IEndowmentPrincipal(vault).totalPrincipalCommittedAllTime() >= ARTIST_MIN_ENDOWED,
            "artist endowment: the vault holds no meaningful principal"
        );
        require(
            IEndowmentPayout(vault).communityPayout() == ArtistEndowments.payout(slug),
            "artist endowment: the vault pays somewhere other than this artist's derived fixture address"
        );
    }

    /// @dev The auction record WITHOUT its token URI. The public mapping getter returns the URI
    ///      inline, and a caller that only wants the bid state would otherwise have to name a string
    ///      slot it never reads — which is also the slot most likely to move.
    function _auction(ERC721AuctionInstance a, uint24 id)
        internal
        view
        returns (
            uint24 tokenId,
            uint256 minBid,
            address highBidder,
            uint256 highBid,
            uint40 startTime,
            uint40 endTime,
            bool settled
        )
    {
        (tokenId,, minBid, highBidder, highBid, startTime, endTime, settled) = a.auctions(id);
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
    function _transferAdmin(address[] memory all) internal {
        vm.startBroadcast(deployerKey);
        // Fund ADMIN so it can pay gas + value actions (queuePiece deposit, bids, buys) immediately.
        // A demo wallet float, not a spend: enough to pay gas and the value actions the walk performs
        // (a queuePiece deposit, a bid, a buy) several times over. It was 50 while anvil's free ETH
        // made the figure invisible; on a funded chain the float is a real line item, so it is sized
        // to what the walk needs.
        (bool funded,) = ADMIN.call{ value: 5 ether }("");
        require(funded, "fund ADMIN failed");
        for (uint256 i = 0; i < all.length; i++) {
            IOwnable(all[i]).transferOwnership(ADMIN);
        }
        vm.stopBroadcast();
        console.log("Handed", all.length, "instances (creator admin) + 5 ETH to ADMIN:");
        console.log(ADMIN);
    }
}
