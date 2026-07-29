// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";

/// @notice Minimal ERC404 instance exposing the card getters the lens reads.
contract MockERC404Card {
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

    function curveParams() external view returns (uint256, uint256, uint256, uint256, uint256) {
        return (
            _params.initialPrice,
            _params.quarticCoeff,
            _params.cubicCoeff,
            _params.quadraticCoeff,
            _params.normalizationFactor
        );
    }
}

/// @notice Minimal ERC721 auction instance. One line; auction configurable.
contract MockERC721Card {
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

/// @notice No-op FeaturedQueueManager stub (getRentalInfo returns "not featured").
contract MockFQM {
    function getRentalInfo(address) external pure returns (address, uint256, uint256, bool) {
        return (address(0), 0, 0, false);
    }

    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory, uint256) {
        return (new address[](0), 0);
    }
}

/// @notice noesis-084 §6: minimal instance exposing instanceType() + ERC-7572 contractURI().
contract MockContractURIInstance {
    bytes32 private immutable _type;
    string private _cu;

    constructor(bytes32 t, string memory cu) {
        _type = t;
        _cu = cu;
    }

    function instanceType() external view returns (bytes32) {
        return _type;
    }

    function contractURI() external view returns (string memory) {
        return _cu;
    }
}

/// @notice noesis-084 §6: instance with a type but NO contractURI() (the ERC404 case pre-085).
contract MockNoContractURIInstance {
    bytes32 private immutable _type;

    constructor(bytes32 t) {
        _type = t;
    }

    function instanceType() external view returns (bytes32) {
        return _type;
    }
}

/// @notice F-A regression: before the fix, ERC404 and ERC721 cards returned zero-default
///         currentPrice/isActive/supply (the getCardData() seam was unimplemented), rendering as
///         "0 gwei"/"Ended" on the homepage/grid. The lens now type-dispatches on instanceType() and
///         computes each type's card data from existing getters.
contract QueryAggregatorCardsTest is Test {
    QueryAggregator internal agg;
    MockMasterRegistry internal registry;

    function setUp() public {
        registry = new MockMasterRegistry();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(new MockFQM()), address(0xDEAD), address(this));
        vm.warp(1_000_000); // a sane block.timestamp for open-time / endTime comparisons
    }

    function _params() internal pure returns (BondingCurveMath.Params memory) {
        // initialPrice=1e18, normalizationFactor=1e18 → basePart integral = supply/1e18, so a 1e24-token
        // (=1 NFT) buy at supply 500e18 costs ~1e6 wei — small but nonzero and deterministic.
        return BondingCurveMath.Params({
            initialPrice: 1e18, quarticCoeff: 0, cubicCoeff: 0, quadraticCoeff: 0, normalizationFactor: 1e18
        });
    }

    function _batch(address inst) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory instances = new address[](1);
        instances[0] = inst;
        return agg.getProjectCardsBatch(instances)[0];
    }

    function test_erc404_card_hydrates_price_active_supply() public {
        BondingCurveMath.Params memory p = _params();
        uint256 supply = 500e18;
        uint256 unit_ = 1_000_000 * 1e18;
        MockERC404Card inst = new MockERC404Card(supply, 10_000e18, unit_, true, false, 0, p);

        QueryAggregator.ProjectCard memory card = _batch(address(inst));

        // Parity: aggregator price == the library's cost-of-next-unit for the same params.
        uint256 expected = BondingCurveMath.calculateCost(p, supply, unit_);
        assertEq(card.currentPrice, expected, "price == calculateCost(next unit)");
        assertGt(card.currentPrice, 0, "price nonzero (was 0 before fix)");
        assertTrue(card.isActive, "bonding-open card is active (was false before fix)");
        assertEq(card.totalSupply, supply, "supply");
        assertEq(card.maxSupply, 10_000e18, "maxSupply");
    }

    function test_erc404_graduated_is_inactive() public {
        MockERC404Card inst = new MockERC404Card(500e18, 10_000e18, 1_000_000 * 1e18, true, true, 0, _params());
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertFalse(card.isActive, "graduated => not active");
    }

    function test_erc404_preopen_is_inactive() public {
        // bondingActive true but openTime in the future => preopen => inactive.
        MockERC404Card inst =
            new MockERC404Card(0, 10_000e18, 1_000_000 * 1e18, true, false, block.timestamp + 1000, _params());
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertFalse(card.isActive, "open-time in future => not yet active");
    }

    function test_erc721_live_auction_card() public {
        MockERC721Card.Auction memory a = MockERC721Card.Auction({
            tokenId: 3,
            tokenURI: "",
            minBid: 1 ether,
            highBidder: address(0xB1D),
            highBid: 2 ether,
            startTime: uint40(block.timestamp - 100),
            endTime: uint40(block.timestamp + 100), // live
            settled: false
        });
        MockERC721Card inst = new MockERC721Card(5, a, 3); // 5 pieces minted, token 3 active

        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertEq(card.currentPrice, 2 ether, "price == high bid");
        assertTrue(card.isActive, "live auction => active");
        assertEq(card.totalSupply, 5, "supply == nextTokenId-1");
        assertEq(card.maxSupply, 0, "open queue => unlimited");
    }

    function test_erc721_expired_unsettled_is_inactive() public {
        MockERC721Card.Auction memory a = MockERC721Card.Auction({
            tokenId: 3,
            tokenURI: "",
            minBid: 1 ether,
            highBidder: address(0xB1D),
            highBid: 2 ether,
            startTime: uint40(block.timestamp - 200),
            endTime: uint40(block.timestamp - 100), // past endTime, not settled
            settled: false
        });
        MockERC721Card inst = new MockERC721Card(5, a, 3);
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertFalse(card.isActive, "expired-unsettled => not active (endTime gate)");
    }

    /// F-F.4: no card type populates extraData — it must be empty bytes for ERC404 and ERC721 too
    /// (the ERC1155 case is covered in QueryAggregator.t.sol). Pins the documented "unused" contract.
    function test_FF4_erc404_and_erc721_card_extradata_empty() public {
        MockERC404Card e404 = new MockERC404Card(500e18, 10_000e18, 1_000_000 * 1e18, true, false, 0, _params());
        assertEq(_batch(address(e404)).extraData.length, 0, "ERC404 card extraData unused => empty");

        MockERC721Card.Auction memory a = MockERC721Card.Auction({
            tokenId: 1,
            tokenURI: "",
            minBid: 1 ether,
            highBidder: address(0),
            highBid: 0,
            startTime: uint40(block.timestamp - 10),
            endTime: uint40(block.timestamp + 100),
            settled: false
        });
        MockERC721Card e721 = new MockERC721Card(1, a, 1);
        assertEq(_batch(address(e721)).extraData.length, 0, "ERC721 card extraData unused => empty");
    }

    // ── noesis-084 §6 anti-drift: card.metadataURI reads the instance's contractURI() for the
    //    types that expose it (ERC1155/ERC721), and keeps the registry copy for ERC404. ───────────

    function test_s6_erc1155_card_reads_instance_contractURI() public {
        MockContractURIInstance inst = new MockContractURIInstance(keccak256("erc1155"), "instance://erc1155");
        registry.setInstanceMetadataURI(address(inst), "registry://stale");
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertEq(
            card.metadataURI,
            "instance://erc1155",
            "ERC1155 card must read the instance contractURI, not the registry copy"
        );
    }

    function test_s6_erc721_card_reads_instance_contractURI() public {
        MockContractURIInstance inst = new MockContractURIInstance(keccak256("erc721"), "instance://erc721");
        registry.setInstanceMetadataURI(address(inst), "registry://stale");
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertEq(
            card.metadataURI,
            "instance://erc721",
            "ERC721 card must read the instance contractURI, not the registry copy"
        );
    }

    function test_s6_erc404_card_keeps_registry_metadataURI() public {
        // ERC404 has no contractURI() until noesis-085 → the registry copy must survive.
        MockNoContractURIInstance inst = new MockNoContractURIInstance(keccak256("erc404"));
        registry.setInstanceMetadataURI(address(inst), "registry://erc404");
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertEq(
            card.metadataURI, "registry://erc404", "ERC404 card must keep the registry metadataURI pending noesis-085"
        );
    }

    function test_erc721_no_bids_uses_minbid() public {
        MockERC721Card.Auction memory a = MockERC721Card.Auction({
            tokenId: 1,
            tokenURI: "",
            minBid: 1 ether,
            highBidder: address(0),
            highBid: 0,
            startTime: uint40(block.timestamp - 10),
            endTime: uint40(block.timestamp + 100),
            settled: false
        });
        MockERC721Card inst = new MockERC721Card(1, a, 1);
        QueryAggregator.ProjectCard memory card = _batch(address(inst));
        assertEq(card.currentPrice, 1 ether, "no bids => min bid");
        assertTrue(card.isActive);
    }
}
