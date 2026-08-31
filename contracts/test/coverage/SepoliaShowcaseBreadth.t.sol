// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SeedSepoliaShared } from "../../script/SeedSepoliaShared.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";

/// @dev The seed base is abstract only because the two phase scripts are its concrete users; nothing
///      in it is unimplemented. This exposes the breadth post-conditions to a test.
contract BreadthAssertHarness is SeedSepoliaShared {
    function assertEditions(EditionFacts calldata f) external pure {
        _assertEditionShowcase(f);
    }

    function assertGating(GatingFacts calldata f, uint256 nowTs) external pure {
        _assertGatingShowcase(f, nowTs);
    }

    function assertStaking(StakingFacts calldata f) external pure {
        _assertStakingShowcase(f);
    }

    function assertTiers(TierFacts calldata f) external pure {
        _assertTierShowcase(f);
    }

    function assertAuctions(
        AuctionLotFacts calldata live,
        AuctionLotFacts calldata sold,
        AuctionLotFacts calldata reclaimed,
        uint256 nowTs
    ) external pure {
        _assertAuctionShowcase(live, sold, reclaimed, nowTs);
    }

    function assertCarve(CarveFacts calldata f) external pure {
        _assertCarveShowcase(f);
    }

    function carveThresholdRaise(uint256 minPoolEth) external pure returns (uint256) {
        return _carveThresholdRaise(minPoolEth);
    }
}

/// @notice THE VACUITY CHECK FOR THE SEPOLIA SHOWCASE'S WAVE-2 MECHANISMS.
///
///         Phase 2 reports success only after asserting, on-chain, that every mechanism the showcase
///         claims to hold actually reached its state. An assertion that cannot fail would let a seed
///         that gated nothing, staked nothing and settled nothing report a complete showcase — so
///         this suite states each predicate's negative space directly: it removes the ONE fact that
///         each mechanism exists to demonstrate and requires the check to go RED.
///
///         The `passesOn...` cases are the other half. Without them the red cases could be satisfied
///         by a predicate that always reverts, which is a different kind of vacuous.
contract SepoliaShowcaseBreadthTest is Test {
    BreadthAssertHarness internal h;

    uint256 internal constant NOW_TS = 1_000_000;

    function setUp() public {
        h = new BreadthAssertHarness();
    }

    // ═══════════════════════ 1. Editions: three pricing regimes ═══════════════════════

    function _healthyEditions() internal pure returns (SeedSepoliaShared.EditionFacts memory f) {
        f = SeedSepoliaShared.EditionFacts({
            nextEditionId: 4, // three editions were added; nextEditionId is one past the last
            fixedModel: uint8(ERC1155Instance.PricingModel.LIMITED_FIXED),
            fixedPrice: 0.002 ether,
            fixedSupply: 250,
            dynamicModel: uint8(ERC1155Instance.PricingModel.LIMITED_DYNAMIC),
            dynamicBasePrice: 0.001 ether,
            dynamicRate: 2000,
            dynamicPriceAfterProbe: 0.00248 ether, // 1.2^5 = 2.49x, comfortably over the 2x floor
            dynamicModule: address(0xDEAD),
            freeClaimAllocation: 100,
            freeClaimSupply: 250,
            freeClaimMinted: 0
        });
    }

    function test_passesOnAHealthyEditionSet() public view {
        h.assertEditions(_healthyEditions());
    }

    function test_redWhenAnEditionIsMissing() public {
        SeedSepoliaShared.EditionFacts memory f = _healthyEditions();
        f.nextEditionId = 3; // only two editions were ever added
        vm.expectRevert(bytes("editions: the collection does not carry all three editions"));
        h.assertEditions(f);
    }

    /// @dev THE ONE THAT MATTERS. A dynamic edition whose rate is technically non-zero but too small
    ///      to see is a flat curve wearing a dynamic label — the exact failure the predicate is aimed
    ///      at, and one that a `pricingModel == LIMITED_DYNAMIC` check would wave through.
    function test_redWhenTheDynamicPriceBarelyMoves() public {
        SeedSepoliaShared.EditionFacts memory f = _healthyEditions();
        f.dynamicRate = 1;
        f.dynamicPriceAfterProbe = f.dynamicBasePrice + 5; // non-zero movement, invisible in practice
        vm.expectRevert(
            bytes("editions: the dynamic price does not move enough to be visible across a handful of mints")
        );
        h.assertEditions(f);
    }

    function test_redWhenTheDynamicModuleIsNotWired() public {
        SeedSepoliaShared.EditionFacts memory f = _healthyEditions();
        f.dynamicModule = address(0);
        vm.expectRevert(bytes("editions: no dynamic pricing module is wired to the instance"));
        h.assertEditions(f);
    }

    function test_redWhenTheFreeClaimReservesNothing() public {
        SeedSepoliaShared.EditionFacts memory f = _healthyEditions();
        f.freeClaimAllocation = 0;
        vm.expectRevert(bytes("editions: the free-claim row reserves nothing (nothing is claimable)"));
        h.assertEditions(f);
    }

    function test_redWhenTheFreeClaimIsAlreadyExhausted() public {
        SeedSepoliaShared.EditionFacts memory f = _healthyEditions();
        f.freeClaimMinted = f.freeClaimAllocation;
        vm.expectRevert(bytes("editions: the free-claim reservation is already exhausted"));
        h.assertEditions(f);
    }

    // ═══════════════════════ 2. Merkle allowlist gating ═══════════════════════

    function _healthyGating() internal pure returns (SeedSepoliaShared.GatingFacts memory f) {
        f = SeedSepoliaShared.GatingFacts({
            attachedModule: address(0xBEEF),
            expectedModule: address(0xBEEF),
            scope: uint8(GatingScope.BOTH),
            installedTierCount: 1,
            installedRoot: keccak256("root"),
            provenRoot: keccak256("root"),
            tierOpenTime: NOW_TS - 1,
            freeClaimAllocation: 10,
            listedMemberVerifies: true,
            unlistedAddressRejected: true
        });
    }

    function test_passesOnAHealthyGate() public view {
        h.assertGating(_healthyGating(), NOW_TS);
    }

    /// @dev THE VACUITY CHECK THE ITEM NAMES. Remove the gate — the collection carries no module at
    ///      all — and the assertion must go red. A predicate that passed here would let an OPEN
    ///      collection ship wearing a gated description.
    function test_redWhenTheGateIsRemoved() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.attachedModule = address(0);
        vm.expectRevert(bytes("gating: no gating module is attached to the collection"));
        h.assertGating(f, NOW_TS);
    }

    function test_redWhenTheAttachedModuleIsNotTheApprovedOne() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.attachedModule = address(0xC0FFEE);
        vm.expectRevert(bytes("gating: the attached module is not the approved one"));
        h.assertGating(f, NOW_TS);
    }

    /// @dev A gate that refuses nobody. The module is attached, the root is installed, the tier is
    ///      open — and every proof verifies. Structurally indistinguishable from a working gate unless
    ///      the refusal is asserted, which is why it is.
    function test_redWhenTheGateRefusesNobody() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.unlistedAddressRejected = false;
        vm.expectRevert(bytes("gating: an unlisted address verifies (the gate refuses nobody)"));
        h.assertGating(f, NOW_TS);
    }

    function test_redWhenTheInstalledRootIsNotTheProvenOne() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.installedRoot = keccak256("some other root");
        vm.expectRevert(bytes("gating: the installed root is not the root that was proven"));
        h.assertGating(f, NOW_TS);
    }

    function test_redWhenTheSeededTierNeverOpens() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.tierOpenTime = NOW_TS + 1 days;
        vm.expectRevert(bytes("gating: the seeded tier has not opened (nobody can mint through it)"));
        h.assertGating(f, NOW_TS);
    }

    function test_redWhenTheScopeLeavesThePaidPathOpen() public {
        SeedSepoliaShared.GatingFacts memory f = _healthyGating();
        f.scope = uint8(GatingScope.FREE_MINT_ONLY);
        vm.expectRevert(bytes("gating: scope is not BOTH (the paid path would be ungated)"));
        h.assertGating(f, NOW_TS);
    }

    // ═══════════════════════ 3. Staking ═══════════════════════

    function _healthyStaking() internal pure returns (SeedSepoliaShared.StakingFacts memory f) {
        f = SeedSepoliaShared.StakingFacts({
            module: address(0xABCD),
            expectedModule: address(0xABCD),
            active: true,
            userStaked: 5e23,
            totalStaked: 5e23,
            liquidBalance: 5e23
        });
    }

    function test_passesOnAHealthyStakingRow() public view {
        h.assertStaking(_healthyStaking());
    }

    function test_redWhenStakingWasNeverActivated() public {
        SeedSepoliaShared.StakingFacts memory f = _healthyStaking();
        f.active = false;
        vm.expectRevert(bytes("staking: the row's staking is not activated"));
        h.assertStaking(f);
    }

    function test_redWhenNothingWasActuallyStaked() public {
        SeedSepoliaShared.StakingFacts memory f = _healthyStaking();
        f.userStaked = 0;
        vm.expectRevert(bytes("staking: the row carries no staked position"));
        h.assertStaking(f);
    }

    /// @dev A row that staked its entire float leaves the stake action unwalkable — the surface is
    ///      present and cannot be exercised, which is the seed failing at its own purpose.
    function test_redWhenTheWholePositionIsLocked() public {
        SeedSepoliaShared.StakingFacts memory f = _healthyStaking();
        f.liquidBalance = 0;
        vm.expectRevert(bytes("staking: the whole position is locked (the stake action is unwalkable)"));
        h.assertStaking(f);
    }

    // ═══════════════════════ 4/5. Token Tiers + the metadata stack ═══════════════════════

    function _healthyTiers() internal pure returns (SeedSepoliaShared.TierFacts memory f) {
        f = SeedSepoliaShared.TierFacts({
            scarceCapacity: 1,
            scarceOutstanding: 1, // taken by the seed and left taken -> BandExhausted is reachable
            openCapacity: 3,
            openOutstanding: 0, // minted up into and back down out of
            totalTierEscrow: 4e24,
            waveCount: 0, // the overlay is the ARTIST METADATA row's; this row wires none
            baseArt: "ipfs://base/",
            bandArt: "ipfs://band/"
        });
    }

    function test_passesOnAHealthyTierRow() public view {
        h.assertTiers(_healthyTiers());
    }

    /// @dev The scarce band still having room is exactly the state in which `BandExhausted` cannot be
    ///      reached, so a visitor could never observe the state §3 asks for.
    function test_redWhenTheScarceBandIsNotExhausted() public {
        SeedSepoliaShared.TierFacts memory f = _healthyTiers();
        f.scarceOutstanding = 0;
        vm.expectRevert(bytes("tiers: the scarce band is not exhausted (BandExhausted is unobservable)"));
        h.assertTiers(f);
    }

    function test_redWhenTheOpenBandHasNoRoomLeft() public {
        SeedSepoliaShared.TierFacts memory f = _healthyTiers();
        f.openOutstanding = f.openCapacity;
        vm.expectRevert(bytes("tiers: the open band has no room left to mint up into"));
        h.assertTiers(f);
    }

    function test_redWhenNoMintUpSurvived() public {
        SeedSepoliaShared.TierFacts memory f = _healthyTiers();
        f.totalTierEscrow = 0;
        vm.expectRevert(bytes("tiers: no coin is escrowed behind a band (no mint-up survived)"));
        h.assertTiers(f);
    }

    /// @dev Two art layers that point at the same collection render as one picture twice: the band
    ///      table is sealed and demonstrates nothing.
    function test_redWhenTheTwoArtLayersAreTheSameArt() public {
        SeedSepoliaShared.TierFacts memory f = _healthyTiers();
        f.bandArt = f.baseArt;
        vm.expectRevert(bytes("tiers: band art is the same collection as the base art"));
        h.assertTiers(f);
    }

    /// @dev The demo split, as a gate rather than a convention: waves and paid commissions belong to
    ///      the ARTIST METADATA row, so an overlay wave reappearing on the tier row is a regression
    ///      and must fail the seed rather than quietly re-merge the two demonstrations.
    function test_redWhenTheTierRowCarriesAnOverlayWave() public {
        SeedSepoliaShared.TierFacts memory f = _healthyTiers();
        f.waveCount = 1;
        vm.expectRevert(bytes("tiers: this row carries an overlay wave (the demo split has regressed)"));
        h.assertTiers(f);
    }

    // ═══════════════════════ 6. Auctions in three states ═══════════════════════

    address internal constant WINNER = address(0xB1D);

    function _healthyLots()
        internal
        pure
        returns (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        )
    {
        live = SeedSepoliaShared.AuctionLotFacts({
            label: "live",
            settled: false,
            highBidder: address(0),
            highBid: 0,
            endTime: NOW_TS + 30 days,
            minted: false,
            tokenOwner: address(0)
        });
        sold = SeedSepoliaShared.AuctionLotFacts({
            label: "sold",
            settled: true,
            highBidder: WINNER,
            highBid: 0.0015 ether,
            endTime: NOW_TS - 1 hours,
            minted: true,
            tokenOwner: WINNER
        });
        reclaimed = SeedSepoliaShared.AuctionLotFacts({
            label: "reclaimed",
            settled: true,
            highBidder: address(0),
            highBid: 0,
            endTime: NOW_TS - 1 hours,
            minted: false,
            tokenOwner: address(0)
        });
    }

    function test_passesOnHealthyAuctionLots() public view {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    /// @dev THE VACUITY CHECK THE ITEM NAMES. Remove the settle — the lot ended with its bid still
    ///      standing and was never crossed — and the assertion must go red.
    function test_redWhenTheSettleIsRemoved() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        sold.settled = false;
        sold.minted = false;
        sold.tokenOwner = address(0);
        vm.expectRevert(bytes("auctions: sold was never settled"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    /// @dev `settled` alone cannot tell a sold lot from a reclaimed one — both terminal paths set it,
    ///      and only one mints. A settle that flipped the flag without minting is exactly the shape a
    ///      flag-only assertion would call success.
    function test_redWhenTheSettledLotNeverMintedItsToken() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        sold.minted = false;
        sold.tokenOwner = address(0);
        vm.expectRevert(bytes("auctions: sold settled without minting its token"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    function test_redWhenTheSettledTokenIsNotTheWinners() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        sold.tokenOwner = address(0xBAD);
        vm.expectRevert(bytes("auctions: sold token is not the winner's"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    function test_redWhenTheReclaimIsRemoved() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        reclaimed.settled = false;
        vm.expectRevert(bytes("auctions: reclaimed was never reclaimed"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    /// @dev A "reclaimed" lot that carries a bid is a settled lot mislabelled — the two terminal
    ///      states would then both be the same one, and the showcase would hold two states, not three.
    function test_redWhenTheReclaimedLotCarriedABid() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        reclaimed.highBidder = WINNER;
        vm.expectRevert(bytes("auctions: reclaimed carried a bid (it is a settled lot, not a reclaimed one)"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    function test_redWhenTheLiveLotHasAlreadyEnded() public {
        (
            SeedSepoliaShared.AuctionLotFacts memory live,
            SeedSepoliaShared.AuctionLotFacts memory sold,
            SeedSepoliaShared.AuctionLotFacts memory reclaimed
        ) = _healthyLots();
        live.endTime = NOW_TS - 1;
        vm.expectRevert(bytes("auctions: live has already ended"));
        h.assertAuctions(live, sold, reclaimed, NOW_TS);
    }

    // ═══════════════════════ 7. The carve ═══════════════════════

    /// @dev A raise BELOW the pool floor: the protocol clamps the carve to zero, the graduation still
    ///      completes, and the declaration is still on the label. This is the shape a faucet-funded
    ///      seed actually produces, and the predicate is written to accept it and say why.
    function _thinCarve() internal pure returns (SeedSepoliaShared.CarveFacts memory f) {
        f = SeedSepoliaShared.CarveFacts({
            declaredMaxBps: 10_000,
            requestBps: 10_000,
            raise: 0.1 ether, // LP share 0.08 ETH, far under a 1 ETH floor
            effectiveCarveEth: 0,
            minPoolEth: 1 ether,
            graduated: true
        });
    }

    /// @dev The same row on a raise that DOES clear the floor. Both shapes must pass, and each must
    ///      reject the other's carve figure — that pairing is what makes the predicate a statement
    ///      about the clamp rather than a restatement of whatever the seed happened to buy.
    function _deepCarve() internal pure returns (SeedSepoliaShared.CarveFacts memory f) {
        f = SeedSepoliaShared.CarveFacts({
            declaredMaxBps: 10_000,
            requestBps: 10_000,
            raise: 4 ether, // LP share 3.2 ETH against a 1 ETH floor -> 2.2 ETH of headroom
            effectiveCarveEth: 2 ether,
            minPoolEth: 1 ether,
            graduated: true
        });
    }

    function test_passesOnAThinRaiseWhereTheCarveClampsToZero() public view {
        h.assertCarve(_thinCarve());
    }

    function test_passesOnARaiseThatClearsThePoolFloor() public view {
        h.assertCarve(_deepCarve());
    }

    function test_redWhenACarveIsPaidOutOfARaiseUnderThePoolFloor() public {
        SeedSepoliaShared.CarveFacts memory f = _thinCarve();
        f.effectiveCarveEth = 0.01 ether;
        vm.expectRevert(bytes("carve: a carve was paid out of a raise whose LP share does not clear the pool floor"));
        h.assertCarve(f);
    }

    function test_redWhenAClearingRaisePaysNoCarveAtAll() public {
        SeedSepoliaShared.CarveFacts memory f = _deepCarve();
        f.effectiveCarveEth = 0;
        vm.expectRevert(bytes("carve: the raise clears the pool floor but the declared-maximum request paid nothing"));
        h.assertCarve(f);
    }

    function test_redWhenTheCarveExceedsTheHeadroomAboveTheFloor() public {
        SeedSepoliaShared.CarveFacts memory f = _deepCarve();
        f.effectiveCarveEth = 3 ether; // headroom is 2.2 ETH
        vm.expectRevert(bytes("carve: the payout exceeds the headroom the LP share has above the pool floor"));
        h.assertCarve(f);
    }

    /// @dev The disclosure IS the feature. A row that graduated with a carve but declared no allowance
    ///      gave buyers nothing to price in, which is the thing `declaredMaxAllowanceBps` exists for.
    function test_redWhenTheRowDeclaredNoAllowance() public {
        SeedSepoliaShared.CarveFacts memory f = _deepCarve();
        f.declaredMaxBps = 0;
        vm.expectRevert(bytes("carve: the row declares no allowance (there is no disclosure to read)"));
        h.assertCarve(f);
    }

    function test_redWhenTheRowNeverGraduated() public {
        SeedSepoliaShared.CarveFacts memory f = _deepCarve();
        f.graduated = false;
        vm.expectRevert(bytes("carve: the row did not graduate"));
        h.assertCarve(f);
    }

    /// @dev The threshold the seed prints is the raise at which a full-allowance carve stops clamping
    ///      to zero, so it has to be a raise the predicate itself calls "clearing". Asserted rather
    ///      than trusted: an off-by-one here would send an operator to buy depth that still pays
    ///      nothing.
    function test_theReportedCarveThresholdActuallyClearsTheFloor() public view {
        uint256 floor_ = 1 ether;
        uint256 threshold = h.carveThresholdRaise(floor_);
        SeedSepoliaShared.CarveFacts memory f = SeedSepoliaShared.CarveFacts({
            declaredMaxBps: 10_000,
            requestBps: 10_000,
            raise: threshold,
            effectiveCarveEth: 1, // the smallest non-zero carve the headroom can back
            minPoolEth: floor_,
            graduated: true
        });
        h.assertCarve(f); // reverts if the threshold does not in fact clear the floor
    }
}
