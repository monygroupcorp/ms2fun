// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { IERC1155EditionReader } from "../../src/query/QueryAggregator.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";

/*//////////////////////////////////////////////////////////////
                         PER-FAMILY MOCKS

  These mirror the getters the aggregator reads through (the same seam the
  existing QueryAggregatorCards / QueryAggregatorPortfolio harness mocks). Each
  mock is the "source of truth per-instance getter" side of the parity: the test
  reads its raw getters directly, independently derives what the card/detail
  SHOULD be, and asserts the aggregator computed the same thing field-by-field.
//////////////////////////////////////////////////////////////*/

/// @notice ERC404 bonding instance exposing the card getters the lens reads.
contract ParityMockERC404 {
    uint256 public totalBondingSupply;
    uint256 public maxSupply;
    uint256 public unit;
    bool public bondingActive;
    uint256 public bondingOpenTime;
    bool public graduated;
    BondingCurveMath.Params internal _params;

    constructor(
        uint256 supply_,
        uint256 max_,
        uint256 unit_,
        bool active_,
        bool graduated_,
        uint256 openTime_,
        BondingCurveMath.Params memory p
    ) {
        totalBondingSupply = supply_;
        maxSupply = max_;
        unit = unit_;
        bondingActive = active_;
        graduated = graduated_;
        bondingOpenTime = openTime_;
        _params = p;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }

    function curveParams() external view returns (uint256, uint256, uint256) {
        return (_params.kCoeff, _params.poleWad, _params.normalizationFactor);
    }

    function params() external view returns (BondingCurveMath.Params memory) {
        return _params;
    }
}

/// @notice ERC404 mock whose card read path reverts (curveParams throws) — exercises the
///         aggregator's try/catch fallback (067 F-F.1 / 084 §6): a broken read must yield a
///         zero-default card, never a silent wrong value or a batch revert.
contract ParityMockERC404Reverting {
    uint256 public totalBondingSupply = 500e18;
    uint256 public maxSupply = 10_000e18;
    uint256 public unit = 1_000_000 * 1e18;

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }

    function bondingActive() external pure returns (bool) {
        return true;
    }

    function bondingOpenTime() external pure returns (uint256) {
        return 0;
    }

    function graduated() external pure returns (bool) {
        return false;
    }

    function curveParams() external pure returns (uint256, uint256, uint256) {
        revert("curve read broken");
    }
}

/// @notice ERC721 auction instance. Single line; auction configurable.
contract ParityMockERC721 {
    struct Auction {
        uint24 tokenId;
        string tokenURI;
        uint256 minBid;
        address highBidder;
        uint256 highBid;
        uint40 startTime;
        uint40 endTime;
        bool settled;
    }

    uint8 public lines = 1;
    uint24 public nextTokenId; // pieces minted + 1
    Auction internal _auction;
    uint24 internal _activeToken;

    constructor(uint24 minted_, Auction memory a, uint24 activeToken_) {
        nextTokenId = minted_ + 1;
        _auction = a;
        _activeToken = activeToken_;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc721");
    }

    function getActiveAuction(uint8) external view returns (uint24) {
        return _activeToken;
    }

    function getAuction(uint24) external view returns (Auction memory) {
        return _auction;
    }
}

/// @notice ERC1155 edition-bearing instance exposing the reader seam the aggregator uses for
///         both the card path (_hydrateERC1155CardData) and the detail path (getERC1155EditionsBatch).
contract ParityMockERC1155 {
    IERC1155EditionReader.Edition[] internal _editions; // index 0 unused; edition ids are 1-indexed
    mapping(uint256 => uint256) internal _currentPrice;

    constructor() {
        // push a placeholder so real editions start at id 1 (matches aggregator's 1..count loop)
        _editions.push();
    }

    function addEdition(IERC1155EditionReader.Edition memory ed, uint256 curPrice) external {
        _editions.push(ed);
        _currentPrice[ed.id] = curPrice;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc1155");
    }

    function nextEditionId() external view returns (uint256) {
        return _editions.length; // == (real edition count) + 1, since slot 0 is the placeholder
    }

    function getEdition(uint256 editionId) external view returns (IERC1155EditionReader.Edition memory) {
        return _editions[editionId];
    }

    function getCurrentPrice(uint256 editionId) external view returns (uint256) {
        return _currentPrice[editionId];
    }
}

/// @notice FeaturedQueueManager stub: getFeaturedInstances returns a configurable list so the
///         getHomePageData (list) path can be pinned against getProjectCardsBatch. getRentalInfo
///         reports "not featured" so featured fields stay zero-default.
contract ParityMockFQM {
    address[] internal _featured;

    function setFeatured(address[] memory f) external {
        _featured = f;
    }

    function getFeaturedInstances(uint256, uint256) external view returns (address[] memory, uint256) {
        return (_featured, _featured.length);
    }

    function getRentalInfo(address) external pure returns (address, uint256, uint256, bool) {
        return (address(0), 0, 0, false);
    }
}

/**
 * @title QueryAggregatorParityTest
 * @notice node-12 parity invariant (spec §4.7): the QueryAggregator batch read-path must return,
 *         for each instance, EXACTLY what a direct per-instance read returns. This is the
 *         regression-catcher the card-fix PRs (067/084/087) skipped — the single artifact that
 *         fails if a future aggregator refactor silently diverges from the source-of-truth getters.
 *
 *         Method: seed each family into a non-trivial state (including the states that previously
 *         tripped card bugs — graduated ERC404, sold-out limited ERC1155, expired ERC721 auction),
 *         read the instance's own getters directly, independently derive the expected card/detail,
 *         and assertEq field-by-field against the aggregator's output. The list path
 *         (getHomePageData) is pinned equal to the batch path (getProjectCardsBatch).
 */
contract QueryAggregatorParityTest is Test {
    QueryAggregator internal agg;
    MockMasterRegistry internal registry;
    ParityMockFQM internal fqm;

    function setUp() public {
        registry = new MockMasterRegistry();
        fqm = new ParityMockFQM();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(fqm), address(0xDEAD), address(this));
        vm.warp(1_000_000); // sane block.timestamp for open-time / endTime comparisons
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _defaultParams() internal pure returns (BondingCurveMath.Params memory) {
        return BondingCurveMath.Params({ kCoeff: 1e18, poleWad: 1.0438e18, normalizationFactor: 1e18 });
    }

    function _card(address inst) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory instances = new address[](1);
        instances[0] = inst;
        return agg.getProjectCardsBatch(instances)[0];
    }

    /// Field-by-field equality of the four computed card fields.
    function _assertCardEq(
        QueryAggregator.ProjectCard memory card,
        uint256 price,
        uint256 supply,
        uint256 max,
        bool active,
        string memory tag
    ) internal {
        assertEq(card.currentPrice, price, string.concat(tag, ": currentPrice"));
        assertEq(card.totalSupply, supply, string.concat(tag, ": totalSupply"));
        assertEq(card.maxSupply, max, string.concat(tag, ": maxSupply"));
        assertEq(card.isActive, active, string.concat(tag, ": isActive"));
    }

    /*//////////////////////////////////////////////////////////////
                          ERC404 CARD PARITY
    //////////////////////////////////////////////////////////////*/

    /// Parity: for an active bonding instance, the aggregator card equals the values derived
    /// directly from the instance's own getters (supply/max/unit/curveParams/phase flags).
    function test_parity_erc404_active() public {
        BondingCurveMath.Params memory p = _defaultParams();
        ParityMockERC404 inst = new ParityMockERC404(500e18, 10_000e18, 1_000_000 * 1e18, true, false, 0, p);

        // direct per-instance reads
        uint256 supply = inst.totalBondingSupply();
        uint256 max = inst.maxSupply();
        uint256 unit_ = inst.unit();
        bool expectedActive = inst.bondingActive() && block.timestamp >= inst.bondingOpenTime() && !inst.graduated();
        uint256 expectedPrice = unit_ > 0 ? BondingCurveMath.calculateCost(inst.params(), supply, unit_) : 0;

        assertTrue(expectedActive, "state precondition: active");
        assertGt(expectedPrice, 0, "state precondition: nonzero price");

        _assertCardEq(_card(address(inst)), expectedPrice, supply, max, expectedActive, "erc404-active");
    }

    /// Graduated ERC404 (a card-bug state): direct read says graduated => card must be inactive,
    /// and price/supply still mirror the direct getters.
    function test_parity_erc404_graduated() public {
        BondingCurveMath.Params memory p = _defaultParams();
        ParityMockERC404 inst = new ParityMockERC404(9_000e18, 10_000e18, 1_000_000 * 1e18, true, true, 0, p);

        uint256 supply = inst.totalBondingSupply();
        uint256 max = inst.maxSupply();
        uint256 unit_ = inst.unit();
        bool expectedActive = inst.bondingActive() && block.timestamp >= inst.bondingOpenTime() && !inst.graduated();
        uint256 expectedPrice = BondingCurveMath.calculateCost(inst.params(), supply, unit_);

        assertFalse(expectedActive, "state precondition: graduated => inactive");
        _assertCardEq(_card(address(inst)), expectedPrice, supply, max, expectedActive, "erc404-graduated");
    }

    /// Pre-open ERC404: bondingActive but openTime in the future => inactive per direct derivation.
    function test_parity_erc404_preopen() public {
        BondingCurveMath.Params memory p = _defaultParams();
        ParityMockERC404 inst =
            new ParityMockERC404(0, 10_000e18, 1_000_000 * 1e18, true, false, block.timestamp + 1000, p);

        uint256 supply = inst.totalBondingSupply();
        uint256 max = inst.maxSupply();
        bool expectedActive = inst.bondingActive() && block.timestamp >= inst.bondingOpenTime() && !inst.graduated();
        // supply 0 => calculateCost at supply 0 for one unit
        uint256 expectedPrice = BondingCurveMath.calculateCost(inst.params(), supply, inst.unit());

        assertFalse(expectedActive, "state precondition: preopen => inactive");
        _assertCardEq(_card(address(inst)), expectedPrice, supply, max, expectedActive, "erc404-preopen");
    }

    /// Fallback parity (067 F-F.1 / 084 §6): a broken card read must degrade to the documented
    /// zero-default, NOT a silent wrong value. The aggregator try/catches the atomic reader, so a
    /// reverting curveParams() yields an all-zero computed card without reverting the batch.
    function test_parity_erc404_revert_yields_zero_default() public {
        ParityMockERC404Reverting inst = new ParityMockERC404Reverting();
        QueryAggregator.ProjectCard memory card = _card(address(inst));
        _assertCardEq(card, 0, 0, 0, false, "erc404-revert-fallback");
    }

    /*//////////////////////////////////////////////////////////////
                          ERC721 CARD PARITY
    //////////////////////////////////////////////////////////////*/

    function _mkAuction(uint256 minBid, uint256 highBid, uint40 endTime, bool settled)
        internal
        view
        returns (ParityMockERC721.Auction memory)
    {
        return ParityMockERC721.Auction({
            tokenId: 3,
            tokenURI: "",
            minBid: minBid,
            highBidder: highBid > 0 ? address(0xB1D) : address(0),
            highBid: highBid,
            startTime: uint40(block.timestamp - 100),
            endTime: endTime,
            settled: settled
        });
    }

    /// Independent re-implementation of the aggregator's erc721CardData derivation from direct reads.
    function _expectedErc721(ParityMockERC721 inst)
        internal
        view
        returns (uint256 price, uint256 supply, uint256 max, bool active)
    {
        supply = uint256(inst.nextTokenId()) - 1;
        max = 0;
        uint8 lineCount = inst.lines();
        for (uint8 i = 0; i < lineCount; i++) {
            uint24 tokenId = inst.getActiveAuction(i);
            if (tokenId == 0) continue;
            ParityMockERC721.Auction memory a = inst.getAuction(tokenId);
            if (!a.settled && block.timestamp < a.endTime) {
                active = true;
                price = a.highBid > 0 ? a.highBid : a.minBid;
                break;
            }
        }
    }

    /// Live auction with bids: card price == high bid, active, supply == nextTokenId-1.
    function test_parity_erc721_live_with_bids() public {
        ParityMockERC721.Auction memory a = _mkAuction(1 ether, 2 ether, uint40(block.timestamp + 100), false);
        ParityMockERC721 inst = new ParityMockERC721(5, a, 3);

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc721(inst);
        assertTrue(active && price == 2 ether, "state precondition: live w/ bids");
        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc721-live-bids");
    }

    /// Live auction, no bids: card price falls back to minBid.
    function test_parity_erc721_live_no_bids() public {
        ParityMockERC721.Auction memory a = _mkAuction(1 ether, 0, uint40(block.timestamp + 100), false);
        ParityMockERC721 inst = new ParityMockERC721(1, a, 3);

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc721(inst);
        assertTrue(active && price == 1 ether, "state precondition: live no bids => minBid");
        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc721-live-nobids");
    }

    /// Expired-unsettled auction (a card-bug state): endTime passed => inactive; price stays 0.
    function test_parity_erc721_expired_unsettled() public {
        ParityMockERC721.Auction memory a = _mkAuction(1 ether, 2 ether, uint40(block.timestamp - 50), false);
        ParityMockERC721 inst = new ParityMockERC721(5, a, 3);

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc721(inst);
        assertFalse(active, "state precondition: expired => inactive");
        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc721-expired");
    }

    /*//////////////////////////////////////////////////////////////
                     ERC1155 CARD + DETAIL PARITY
    //////////////////////////////////////////////////////////////*/

    function _mkEdition(
        uint256 id,
        string memory title,
        uint256 basePrice,
        uint256 supply,
        uint256 minted,
        IERC1155EditionReader.PricingModel model,
        uint256 rate
    ) internal pure returns (IERC1155EditionReader.Edition memory) {
        return IERC1155EditionReader.Edition({
            id: id,
            pieceTitle: title,
            basePrice: basePrice,
            supply: supply,
            minted: minted,
            metadataURI: string.concat("ipfs://edition/", title),
            pricingModel: model,
            priceIncreaseRate: rate,
            openTime: 0
        });
    }

    /// Independent re-implementation of _hydrateERC1155CardData from the instance's own getEdition reads.
    function _expectedErc1155Card(ParityMockERC1155 inst)
        internal
        view
        returns (uint256 price, uint256 supply, uint256 max, bool active)
    {
        uint256 count = inst.nextEditionId() - 1;
        if (count == 0) return (0, 0, 0, false);
        uint256 floorPrice = type(uint256).max;
        uint256 totalMinted;
        uint256 maxSupply;
        bool isActive;
        bool hasUnlimited;
        for (uint256 i = 1; i <= count; i++) {
            IERC1155EditionReader.Edition memory ed = inst.getEdition(i);
            if (ed.basePrice < floorPrice) floorPrice = ed.basePrice;
            totalMinted += ed.minted;
            if (ed.supply == 0) {
                hasUnlimited = true;
            } else {
                maxSupply += ed.supply;
                if (ed.minted < ed.supply) isActive = true;
            }
        }
        if (hasUnlimited) maxSupply = 0;
        isActive = isActive || hasUnlimited;
        price = floorPrice == type(uint256).max ? 0 : floorPrice;
        supply = totalMinted;
        max = maxSupply;
        active = isActive;
    }

    /// Asserts the aggregator's detail path (getERC1155EditionsBatch) equals a direct getEdition +
    /// getCurrentPrice read, field-by-field, across every edition.
    function _assertDetailParity(ParityMockERC1155 inst, uint256 count) internal {
        QueryAggregator.EditionView[] memory views = agg.getERC1155EditionsBatch(address(inst), 1, count);
        assertEq(views.length, count, "detail: count");
        for (uint256 i = 0; i < count; i++) {
            uint256 id = i + 1;
            IERC1155EditionReader.Edition memory ed = inst.getEdition(id);
            QueryAggregator.EditionView memory v = views[i];
            assertEq(v.id, ed.id, "detail: id");
            assertEq(v.pieceTitle, ed.pieceTitle, "detail: pieceTitle");
            assertEq(v.basePrice, ed.basePrice, "detail: basePrice");
            assertEq(v.currentPrice, inst.getCurrentPrice(id), "detail: currentPrice");
            assertEq(v.supply, ed.supply, "detail: supply");
            assertEq(v.minted, ed.minted, "detail: minted");
            assertEq(v.metadataURI, ed.metadataURI, "detail: metadataURI");
            assertEq(uint8(v.pricingModel), uint8(ed.pricingModel), "detail: pricingModel");
            assertEq(v.priceIncreaseRate, ed.priceIncreaseRate, "detail: priceIncreaseRate");
        }
    }

    /// Multi-edition mix: a fixed-price limited edition with room, a dynamic-priced limited edition
    /// (currentPrice != basePrice), and a sold-out limited edition. maxSupply = sum of limited
    /// supplies; isActive true (the first edition still has room). Covers both card and detail paths.
    function test_parity_erc1155_multi_edition_mixed() public {
        ParityMockERC1155 inst = new ParityMockERC1155();
        inst.addEdition(
            _mkEdition(1, "A", 0.1 ether, 100, 40, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0), 0.1 ether
        );
        inst.addEdition(
            _mkEdition(2, "B", 0.2 ether, 50, 10, IERC1155EditionReader.PricingModel.LIMITED_DYNAMIC, 500),
            0.25 ether // dynamic: current > base
        );
        inst.addEdition(
            _mkEdition(3, "C", 0.05 ether, 10, 10, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0),
            0.05 ether // sold out
        );

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc1155Card(inst);
        // sanity on the derived expectation
        assertEq(price, 0.05 ether, "state precondition: floor = cheapest basePrice");
        assertEq(supply, 60, "state precondition: total minted");
        assertEq(max, 160, "state precondition: sum of limited supplies");
        assertTrue(active, "state precondition: edition 1 still has room => active");

        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc1155-mixed");
        _assertDetailParity(inst, 3);
    }

    /// All-sold-out limited collection (the bug-2 state): every limited edition is minted out and
    /// there is no unlimited edition => isActive MUST be false (a sold-out collection must not lie
    /// as active). Parity holds against the direct derivation.
    function test_parity_erc1155_all_sold_out_inactive() public {
        ParityMockERC1155 inst = new ParityMockERC1155();
        inst.addEdition(
            _mkEdition(1, "A", 0.1 ether, 20, 20, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0), 0.1 ether
        );
        inst.addEdition(
            _mkEdition(2, "B", 0.2 ether, 30, 30, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0), 0.2 ether
        );

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc1155Card(inst);
        assertFalse(active, "state precondition: all sold out => inactive");
        assertEq(max, 50, "state precondition: sum supplies");
        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc1155-soldout");
        _assertDetailParity(inst, 2);
    }

    /// Unlimited edition present (UNLIMITED pricing, supply 0): maxSupply collapses to 0 and the
    /// collection is active regardless of minted counts. Parity against direct derivation.
    function test_parity_erc1155_unlimited_edition() public {
        ParityMockERC1155 inst = new ParityMockERC1155();
        inst.addEdition(
            _mkEdition(1, "Open", 0.03 ether, 0, 500, IERC1155EditionReader.PricingModel.UNLIMITED, 0), 0.03 ether
        );
        inst.addEdition(
            _mkEdition(2, "Capped", 0.5 ether, 100, 100, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0), 0.5 ether
        );

        (uint256 price, uint256 supply, uint256 max, bool active) = _expectedErc1155Card(inst);
        assertEq(max, 0, "state precondition: unlimited => maxSupply 0");
        assertTrue(active, "state precondition: unlimited => active");
        assertEq(price, 0.03 ether, "state precondition: floor price");
        _assertCardEq(_card(address(inst)), price, supply, max, active, "erc1155-unlimited");
        _assertDetailParity(inst, 2);
    }

    /*//////////////////////////////////////////////////////////////
                    LIST PATH == BATCH PATH PARITY
    //////////////////////////////////////////////////////////////*/

    /// getHomePageData (the list path the homepage actually calls) must return, for each featured
    /// instance, the SAME ProjectCard as getProjectCardsBatch — one aggregator entry point cannot
    /// silently diverge from the other. Seeds one live instance of each family as featured.
    function test_parity_list_path_matches_batch_path() public {
        ParityMockERC404 e404 =
            new ParityMockERC404(500e18, 10_000e18, 1_000_000 * 1e18, true, false, 0, _defaultParams());
        ParityMockERC721.Auction memory a = _mkAuction(1 ether, 2 ether, uint40(block.timestamp + 100), false);
        ParityMockERC721 e721 = new ParityMockERC721(5, a, 3);
        ParityMockERC1155 e1155 = new ParityMockERC1155();
        e1155.addEdition(
            _mkEdition(1, "A", 0.1 ether, 100, 40, IERC1155EditionReader.PricingModel.LIMITED_FIXED, 0), 0.1 ether
        );

        address[] memory instances = new address[](3);
        instances[0] = address(e404);
        instances[1] = address(e721);
        instances[2] = address(e1155);
        fqm.setFeatured(instances);

        (QueryAggregator.ProjectCard[] memory home, uint256 total) = agg.getHomePageData(0, 50);
        QueryAggregator.ProjectCard[] memory batch = agg.getProjectCardsBatch(instances);

        assertEq(total, 3, "featured total");
        assertEq(home.length, 3, "home length");
        for (uint256 i = 0; i < 3; i++) {
            assertEq(home[i].instance, batch[i].instance, "list==batch: instance");
            assertEq(home[i].currentPrice, batch[i].currentPrice, "list==batch: currentPrice");
            assertEq(home[i].totalSupply, batch[i].totalSupply, "list==batch: totalSupply");
            assertEq(home[i].maxSupply, batch[i].maxSupply, "list==batch: maxSupply");
            assertEq(home[i].isActive, batch[i].isActive, "list==batch: isActive");
        }
    }

    /*//////////////////////////////////////////////////////////////
                          PARAMETRIC SWEEP
    //////////////////////////////////////////////////////////////*/

    /// Light fuzz over ERC404 seeded state: the aggregator's card price/supply/active must equal the
    /// direct-derivation for any in-range supply and phase flags. Pins the price computation parity
    /// across the whole seeded surface, not just the hand-picked points above.
    function testFuzz_parity_erc404_price(uint96 supplyRaw, bool active, bool graduated_) public {
        uint256 max = 10_000e18;
        uint256 supply = uint256(supplyRaw) % (max + 1); // 0..max
        uint256 unit_ = 1_000_000 * 1e18;
        ParityMockERC404 inst = new ParityMockERC404(supply, max, unit_, active, graduated_, 0, _defaultParams());

        bool expectedActive = inst.bondingActive() && block.timestamp >= inst.bondingOpenTime() && !inst.graduated();
        uint256 expectedPrice = BondingCurveMath.calculateCost(inst.params(), supply, unit_);

        _assertCardEq(_card(address(inst)), expectedPrice, supply, max, expectedActive, "erc404-fuzz");
    }
}
