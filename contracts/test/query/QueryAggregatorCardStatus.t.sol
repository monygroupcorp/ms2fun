// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator, IERC1155EditionReader } from "../../src/query/QueryAggregator.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { ERC404BondingInstance, ExceedsBonding } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @notice ERC1155 instance exposing exactly the reader seam the card path goes through, so an
///         edition's `openTime` can be placed either side of `block.timestamp`.
contract StatusMockERC1155 {
    IERC1155EditionReader.Edition[] internal _editions; // slot 0 unused; edition ids are 1-indexed
    mapping(uint256 => uint256) internal _currentPrice;

    constructor() {
        _editions.push();
    }

    /// @param supply 0 = an UNLIMITED edition; the card's maxSupply collapses to 0 in that case.
    function addEdition(uint256 basePrice, uint256 supply, uint256 minted, uint256 openTime) external {
        uint256 id = _editions.length;
        _editions.push(
            IERC1155EditionReader.Edition({
                id: id,
                pieceTitle: "",
                basePrice: basePrice,
                supply: supply,
                minted: minted,
                metadataURI: "",
                pricingModel: IERC1155EditionReader.PricingModel.LIMITED_FIXED,
                priceIncreaseRate: 0,
                openTime: openTime
            })
        );
        _currentPrice[id] = basePrice;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc1155");
    }

    function nextEditionId() external view returns (uint256) {
        return _editions.length;
    }

    function getEdition(uint256 editionId) external view returns (IERC1155EditionReader.Edition memory) {
        return _editions[editionId];
    }

    function getCurrentPrice(uint256 editionId) external view returns (uint256) {
        return _currentPrice[editionId];
    }
}

/// @notice No-op FeaturedQueueManager stub: every instance reads as "not featured".
contract StatusMockFQM {
    function getRentalInfo(address) external pure returns (address, uint256, uint256, bool) {
        return (address(0), 0, 0, false);
    }

    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory, uint256) {
        return (new address[](0), 0);
    }
}

/// @notice The status a card advertises must be a state a buyer can act on.
///
///         Two ways it was not. An ERC-1155 card computed `isActive` from supply alone, so a
///         collection whose every edition was still scheduled advertised as buyable while both mint
///         entry points reverted `EditionNotOpen()`. And an ERC-404 card reported `maxSupply` as its
///         ceiling while the buy path caps strictly lower, so a curve bought to exhaustion showed a
///         partly-full meter and a non-zero remainder that no further buy could reach.
contract QueryAggregatorCardStatusTest is Test {
    QueryAggregator internal agg;
    MockMasterRegistry internal registry;

    address internal owner = address(0x1);
    address internal buyer = address(0x2);

    uint256 internal constant PRICE_A = 0.05 ether;
    uint256 internal constant PRICE_B = 0.09 ether;

    function setUp() public {
        registry = new MockMasterRegistry();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(new StatusMockFQM()), address(0xDEAD), address(this));
        vm.warp(1_000_000); // a sane block.timestamp for the openTime comparisons
    }

    function _card(address inst) internal view returns (QueryAggregator.ProjectCard memory) {
        address[] memory instances = new address[](1);
        instances[0] = inst;
        return agg.getProjectCardsBatch(instances)[0];
    }

    /*//////////////////////////////////////////////////////////////
                  ERC1155: A SHUT EDITION IS NOT BUYABLE
    //////////////////////////////////////////////////////////////*/

    /// The whole collection is scheduled for later: nothing can be minted, so the card is not active.
    function test_erc1155_all_editions_unopened_is_inactive() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        inst.addEdition(PRICE_A, 10, 0, block.timestamp + 7 days);
        inst.addEdition(PRICE_B, 5, 0, block.timestamp + 14 days);

        QueryAggregator.ProjectCard memory card = _card(address(inst));
        assertFalse(card.isActive, "every edition still shut => not active");
        assertEq(card.maxSupply, 15, "supply accounting is unchanged by the gate");
        assertEq(card.totalSupply, 0, "nothing minted");
    }

    /// One edition open, one scheduled: the collection IS buyable, so the card stays active.
    function test_erc1155_mixed_open_and_unopened_is_active() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        inst.addEdition(PRICE_B, 10, 0, 0); // open now
        inst.addEdition(PRICE_A, 5, 0, block.timestamp + 7 days); // scheduled

        QueryAggregator.ProjectCard memory card = _card(address(inst));
        assertTrue(card.isActive, "one open mintable edition => active");
        assertEq(card.currentPrice, PRICE_B, "floor is taken over OPEN editions only");
    }

    /// Warping past the openTime makes the same collection active — the flag tracks time, not just
    /// supply, which is the asymmetry the ERC-404 and ERC-721 legs already had.
    function test_erc1155_becomes_active_once_open_time_arrives() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        uint256 opensAt = block.timestamp + 7 days;
        inst.addEdition(PRICE_A, 10, 0, opensAt);

        assertFalse(_card(address(inst)).isActive, "before openTime => inactive");
        vm.warp(opensAt);
        assertTrue(_card(address(inst)).isActive, "at openTime => active");
    }

    /// A sold-out open edition is still inactive: the gate narrows the flag, it does not widen it.
    function test_erc1155_open_but_sold_out_is_inactive() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        inst.addEdition(PRICE_A, 10, 10, 0);

        assertFalse(_card(address(inst)).isActive, "open but fully minted => not active");
    }

    /// An UNLIMITED edition is unbounded but not exempt: while it is shut, nothing can be minted.
    function test_erc1155_unopened_unlimited_edition_is_inactive() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        inst.addEdition(PRICE_A, 0, 0, block.timestamp + 7 days);

        QueryAggregator.ProjectCard memory card = _card(address(inst));
        assertFalse(card.isActive, "unlimited but shut => not active");
        assertEq(card.maxSupply, 0, "unlimited still collapses maxSupply, open or not");
    }

    /// The floor when nothing is open yet: the earliest opener's price, not 0. A scheduled drop that
    /// has not started is not a free one.
    function test_erc1155_all_unopened_quotes_the_earliest_opener() public {
        StatusMockERC1155 inst = new StatusMockERC1155();
        inst.addEdition(PRICE_B, 10, 0, block.timestamp + 14 days); // later, dearer
        inst.addEdition(PRICE_A, 5, 0, block.timestamp + 7 days); // earlier, cheaper

        assertEq(_card(address(inst)).currentPrice, PRICE_A, "earliest opener's price");

        // Reversed: the earliest opener is the DEARER one, so the quote must follow the clock, not
        // the price — a plain floor over all editions would still answer PRICE_A here.
        StatusMockERC1155 inst2 = new StatusMockERC1155();
        inst2.addEdition(PRICE_A, 5, 0, block.timestamp + 14 days); // later, cheaper
        inst2.addEdition(PRICE_B, 10, 0, block.timestamp + 7 days); // earlier, dearer

        assertEq(_card(address(inst2)).currentPrice, PRICE_B, "earliest opener, not cheapest edition");
    }

    /*//////////////////////////////////////////////////////////////
              ERC404: THE CEILING IS WHAT A BUY CAN REACH
    //////////////////////////////////////////////////////////////*/

    uint256 internal constant MAX_SUPPLY = 10_000_000 ether;
    uint256 internal constant UNIT = 1_000_000 ether;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 1000;

    CurveParamsComputer internal curveComputer;

    function _deployCurve() internal returns (ERC404BondingInstance inst) {
        curveComputer = new CurveParamsComputer(address(this));
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(
            owner,
            address(0xBEEF),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 })
            }),
            address(0x600),
            address(0),
            address(new DN404Mirror(owner))
        );
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: address(0xFEE),
                masterRegistry: address(0x400),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        inst.initializeMetadata("Ceiling", "CEIL", "", "", "");
        // Arming requires an open time, and the setter takes only a future one; warp onto it so the
        // curve is open for the buys below.
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    function _buy(ERC404BondingInstance inst, uint256 amount) internal {
        (uint256 k, uint256 pole, uint256 nf) = inst.curveParams();
        uint256 cost = curveComputer.calculateCost(
            BondingCurveMath.Params({ kCoeff: k, poleWad: pole, normalizationFactor: nf }),
            inst.totalBondingSupply(),
            amount
        );
        uint256 total = cost + (cost * inst.bondingFeeBps()) / 10000;
        vm.deal(buyer, total);
        vm.prank(buyer);
        inst.buyBonding{ value: total }(amount, total, false, bytes(""), bytes(""), 0);
    }

    /// A curve bought to exhaustion reports a FULL card: `supply == max`, and the next buy reverts.
    /// Against the raw `maxSupply` this collection read 90% with a `liquidityReserve`-sized remainder
    /// that nobody could ever buy.
    function test_erc404_curve_bought_to_its_cap_reads_full() public {
        ERC404BondingInstance inst = _deployCurve();

        uint256 reserve = inst.liquidityReserve();
        assertGt(reserve, 0, "state precondition: the reserve is real");
        uint256 ceiling = MAX_SUPPLY - reserve - inst.freeMintAllocation() * UNIT;

        _buy(inst, ceiling);
        assertEq(inst.totalBondingSupply(), ceiling, "state precondition: curve exhausted");

        QueryAggregator.ProjectCard memory card = _card(address(inst));
        assertEq(card.maxSupply, ceiling, "card ceiling == the ceiling the buy path enforces");
        assertEq(card.totalSupply, card.maxSupply, "an exhausted curve reads full, not 90%");
        assertLt(card.maxSupply, MAX_SUPPLY, "and it is strictly below maxSupply");

        // The remainder the old card advertised is genuinely unreachable: the cap rejects the buy
        // before it ever prices it, however much ETH is offered.
        vm.deal(buyer, 1000 ether);
        vm.prank(buyer);
        vm.expectRevert(ExceedsBonding.selector);
        inst.buyBonding{ value: 1000 ether }(UNIT, 1000 ether, false, bytes(""), bytes(""), 0);
    }

    /// The gate does not touch `isActive`: a curve that is open, started and ungraduated stays active
    /// whether or not it has been bought out. What "active" means for that state is a separate
    /// question, deliberately not answered here.
    function test_erc404_ceiling_change_leaves_isactive_alone() public {
        ERC404BondingInstance inst = _deployCurve();
        assertTrue(_card(address(inst)).isActive, "open, started, ungraduated => active");

        uint256 ceiling = MAX_SUPPLY - inst.liquidityReserve() - inst.freeMintAllocation() * UNIT;
        _buy(inst, ceiling);
        assertTrue(_card(address(inst)).isActive, "exhausting the curve does not flip isActive");
    }
}
