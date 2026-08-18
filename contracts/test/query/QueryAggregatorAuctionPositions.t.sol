// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { QueryAggregator, IERC721Card } from "../../src/query/QueryAggregator.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { TYPE_ERC721, TYPE_ERC404 } from "../../src/interfaces/IInstanceLifecycle.sol";

/// @notice noesis-355 — the ERC721 leg of `getPortfolioData`.
/// @dev ETH escrowed inside an auction (a live high bid, a won-but-unsettled high bid, a creator's queue
///      deposit) is money the portfolio must be able to show. These pin the three positions, the
///      release-act flags, the failure tolerance of the leg, and the invariant that escrow never enters
///      `totalClaimable`.
contract QueryAggregatorAuctionPositionsTest is Test {
    QueryAggregator internal agg;
    MockRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal bidder = makeAddr("bidder");
    address internal stranger = makeAddr("stranger");

    uint40 internal constant END = 10_000;

    function setUp() public {
        registry = new MockRegistry();
        agg = new QueryAggregator();
        agg.initialize(address(registry), address(new NoopFeaturedQueueManager()), address(0), owner);
        vm.warp(1000); // before END: auctions are live unless a test warps past it
    }

    // ─────────────────────────────── helpers ───────────────────────────────

    function _portfolio(address user, address instance)
        internal
        view
        returns (QueryAggregator.AuctionPosition[] memory positions, uint256 claimable)
    {
        address[] memory instances = new address[](1);
        instances[0] = instance;
        (,,, claimable, positions) = agg.getPortfolioData(user, instances, new address[](0));
    }

    function _register(address instance) internal {
        registry.register(instance, TYPE_ERC721, "Auction House");
    }

    /// @dev One instance, one line, one queued piece with the given deposit and (optionally) a high bid.
    function _instance(uint256 deposit, address highBidder, uint256 highBid) internal returns (MockAuction m) {
        m = new MockAuction(creator, 1);
        m.queue({ line: 0, tokenId: 1, minBid: deposit, endTime: END });
        if (highBidder != address(0)) m.bid({ tokenId: 1, highBidder: highBidder, highBid: highBid });
        _register(address(m));
    }

    // ─────────────────────────── position 1: live high bid ───────────────────────────

    function test_high_bidder_on_live_auction_sees_escrowed_bid() public {
        MockAuction m = _instance({ deposit: 0.1 ether, highBidder: bidder, highBid: 2 ether });

        (QueryAggregator.AuctionPosition[] memory p, uint256 claimable) = _portfolio(bidder, address(m));

        assertEq(p.length, 1, "the live high bid is one position");
        assertEq(p[0].instance, address(m));
        assertEq(p[0].name, "Auction House", "the registry name rides the position");
        assertEq(p[0].tokenId, 1);
        assertEq(p[0].amount, 2 ether, "the escrowed amount is the high bid");
        assertFalse(p[0].isCreatorDeposit, "a bid is not a deposit");
        assertEq(p[0].endTime, END);
        assertFalse(p[0].settleable, "a live auction cannot be settled yet");
        assertFalse(p[0].reclaimable, "a bidder never reclaims");
        assertEq(claimable, 0, "escrow is not claimable");
    }

    /// An outbid bidder is refunded on the bid path, so only the current high bidder holds ETH here.
    function test_outbid_bidder_has_no_position() public {
        MockAuction m = _instance({ deposit: 0.1 ether, highBidder: bidder, highBid: 2 ether });
        m.bid({ tokenId: 1, highBidder: stranger, highBid: 3 ether });

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(bidder, address(m));
        assertEq(p.length, 0, "the refunded bidder holds nothing");

        (QueryAggregator.AuctionPosition[] memory q,) = _portfolio(stranger, address(m));
        assertEq(q.length, 1, "the new high bidder holds the escrow");
        assertEq(q[0].amount, 3 ether);
    }

    // ─────────────────────── position 2: won, ended, unsettled ───────────────────────

    function test_high_bidder_on_ended_auction_is_flagged_settleable() public {
        MockAuction m = _instance({ deposit: 0.1 ether, highBidder: bidder, highBid: 2 ether });
        vm.warp(END);

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(bidder, address(m));
        assertEq(p.length, 1);
        assertEq(p[0].amount, 2 ether, "the winning bid is still escrowed until settlement");
        assertTrue(p[0].settleable, "an ended auction with bids is settleable by anyone");
        assertFalse(p[0].reclaimable);
    }

    // ─────────────────────────── position 3: creator deposit ───────────────────────────

    function test_creator_sees_deposit_in_unsettled_auction() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: address(0), highBid: 0 });

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, 1);
        assertEq(p[0].amount, 0.5 ether, "the queue deposit is the creator's escrow");
        assertTrue(p[0].isCreatorDeposit);
        assertFalse(p[0].settleable, "no bids and still live: nothing to do yet");
        assertFalse(p[0].reclaimable);
    }

    function test_creator_deposit_on_ended_no_bid_auction_is_reclaimable() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: address(0), highBid: 0 });
        vm.warp(END);

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, 1);
        assertTrue(p[0].reclaimable, "ended with no bids: reclaimUnsold releases the deposit");
        assertFalse(p[0].settleable);
    }

    function test_creator_deposit_on_ended_bid_auction_is_settleable() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: bidder, highBid: 2 ether });
        vm.warp(END);

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, 1);
        assertTrue(p[0].isCreatorDeposit);
        assertTrue(p[0].settleable, "ended with bids: settleAuction refunds the deposit");
        assertFalse(p[0].reclaimable, "a bid auction is not reclaimable");
    }

    /// A creator who is also the high bidder holds two distinct escrows and gets two entries.
    function test_creator_who_is_also_high_bidder_gets_both_positions() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: creator, highBid: 2 ether });

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, 2, "bid and deposit are separate escrows");
        assertFalse(p[0].isCreatorDeposit);
        assertEq(p[0].amount, 2 ether);
        assertTrue(p[1].isCreatorDeposit);
        assertEq(p[1].amount, 0.5 ether);
    }

    // ─────────────────────────────── absence cases ───────────────────────────────

    function test_uninvolved_user_has_no_positions() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: bidder, highBid: 2 ether });
        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(stranger, address(m));
        assertEq(p.length, 0);
    }

    function test_settled_auction_yields_no_position() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: bidder, highBid: 2 ether });
        m.settle(1);

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(bidder, address(m));
        assertEq(p.length, 0, "settled: the escrow has been paid out");

        (QueryAggregator.AuctionPosition[] memory q,) = _portfolio(creator, address(m));
        assertEq(q.length, 0, "settled: the deposit has been refunded");
    }

    /// `getActiveAuction` returns 0 for "no live auction" and `getAuction(0)` reverts (token ids start at
    /// 1, so 0 is never a real piece). An empty line must therefore be SKIPPED, not read through: reading
    /// through it would revert the whole per-instance reader and lose the positions on the other lines.
    function test_empty_line_sentinel_is_skipped_not_read_through() public {
        MockAuction m = new MockAuction(creator, 2);
        m.queue({ line: 1, tokenId: 1, minBid: 0.5 ether, endTime: END }); // line 0 stays empty
        m.bid({ tokenId: 1, highBidder: bidder, highBid: 2 ether });
        _register(address(m));

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(bidder, address(m));
        assertEq(p.length, 1, "the empty line is skipped and the populated line still reports");
        assertEq(p[0].tokenId, 1);
    }

    function test_instance_with_no_queued_pieces_yields_no_positions() public {
        MockAuction m = new MockAuction(creator, 1); // nothing queued: the line reports 0
        _register(address(m));

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, 0);
    }

    function test_no_instances_yields_empty_positions() public view {
        (,,, uint256 claimable, QueryAggregator.AuctionPosition[] memory p) =
            agg.getPortfolioData(bidder, new address[](0), new address[](0));
        assertEq(p.length, 0);
        assertEq(claimable, 0);
    }

    // ─────────────────────────────── failure tolerance ───────────────────────────────

    /// One reverting 721 instance must not take down the portfolio read.
    function test_reverting_instance_is_skipped_not_fatal() public {
        MockAuction good = _instance({ deposit: 0.5 ether, highBidder: bidder, highBid: 2 ether });
        address bad = address(new RevertingAuction());
        _register(bad);

        address[] memory instances = new address[](3);
        instances[0] = bad;
        instances[1] = address(good);
        instances[2] = address(new ShortReturnAuction());
        _register(instances[2]);

        (,,,, QueryAggregator.AuctionPosition[] memory p) = agg.getPortfolioData(bidder, instances, new address[](0));
        assertEq(p.length, 1, "the healthy instance still reports");
        assertEq(p[0].instance, address(good));
    }

    /// An instance over-reporting its line count cannot expand the per-instance read loop.
    function test_line_count_is_clamped() public {
        MockAuction m = new MockAuction(creator, 200);
        for (uint8 i = 0; i < 4; i++) {
            m.queue({ line: i, tokenId: uint24(i + 1), minBid: 1 ether, endTime: END });
        }
        _register(address(m));

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(creator, address(m));
        assertEq(p.length, uint256(agg.MAX_AUCTION_LINES_PER_INSTANCE()), "scan stops at the clamp");
    }

    function test_all_lines_are_scanned() public {
        MockAuction m = new MockAuction(creator, 3);
        for (uint8 i = 0; i < 3; i++) {
            m.queue({ line: i, tokenId: uint24(i + 1), minBid: 1 ether, endTime: END });
        }
        m.bid({ tokenId: 3, highBidder: bidder, highBid: 4 ether });
        _register(address(m));

        (QueryAggregator.AuctionPosition[] memory p,) = _portfolio(bidder, address(m));
        assertEq(p.length, 1, "a bid on the last line is found");
        assertEq(p[0].tokenId, 3);
    }

    // ─────────────────────────── the other legs are untouched ───────────────────────────

    /// The escrow is money the user CANNOT withdraw. Folding it into `totalClaimable` would overstate
    /// withdrawable funds, so the ERC721 leg must leave that number exactly where it was.
    function test_auction_escrow_never_enters_total_claimable() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: creator, highBid: 2 ether });
        (QueryAggregator.AuctionPosition[] memory p, uint256 claimable) = _portfolio(creator, address(m));
        assertEq(p.length, 2, "both escrows present");
        assertEq(claimable, 0, "and neither is claimable");
    }

    /// The 404/1155/vault legs keep their behaviour: a non-721 instance contributes nothing to the new
    /// array, and the 721 leg contributes nothing to theirs.
    function test_other_legs_unchanged_by_the_erc721_branch() public {
        MockAuction m = _instance({ deposit: 0.5 ether, highBidder: bidder, highBid: 2 ether });
        address other = address(new RevertingAuction());
        registry.register(other, TYPE_ERC404, "Curve");

        address[] memory instances = new address[](2);
        instances[0] = address(m);
        instances[1] = other;

        (
            QueryAggregator.ERC404Holding[] memory h404,
            QueryAggregator.ERC1155Holding[] memory h1155,
            QueryAggregator.VaultPosition[] memory vp,
            uint256 claimable,
            QueryAggregator.AuctionPosition[] memory ap
        ) = agg.getPortfolioData(bidder, instances, new address[](0));

        assertEq(h404.length, 0);
        assertEq(h1155.length, 0);
        assertEq(vp.length, 0);
        assertEq(claimable, 0);
        assertEq(ap.length, 1, "only the 721 instance contributes an auction position");
    }
}

// ───────────────────────────────────── Mocks ─────────────────────────────────────

/// @dev Registry answering `getInstanceInfo` plus the aggregator's `instanceType()` read, which the lens
///      issues against the INSTANCE. `MockAuction` forwards that call here so one table drives both.
contract MockRegistry {
    mapping(address => bytes32) public typeOf;
    mapping(address => string) public nameOf;

    function register(address instance, bytes32 t, string memory n) external {
        typeOf[instance] = t;
        nameOf[instance] = n;
    }

    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory info) {
        if (typeOf[instance] == bytes32(0)) revert("unregistered");
        info.instance = instance;
        info.name = nameOf[instance];
    }
}

contract NoopFeaturedQueueManager {
    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory, uint256) {
        return (new address[](0), 0);
    }

    function getRentalInfo(address) external pure returns (address, uint256, uint256, bool) {
        return (address(0), 0, 0, false);
    }
}

/// @dev Models `ERC721AuctionInstance`'s read surface: per-line queue heads, `getActiveAuction`
///      returning 0 once the head is settled (or the line is empty), and `getAuction` reverting on a
///      zero id. Token ids are 1-indexed exactly as the real instance's `nextTokenId` makes them.
contract MockAuction {
    address public owner;
    uint8 public lines;
    uint24 public nextTokenId = 1;

    mapping(uint8 => uint24) internal head;
    mapping(uint24 => IERC721Card.Auction) internal auctionOf;

    constructor(address owner_, uint8 lines_) {
        owner = owner_;
        lines = lines_;
    }

    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC721;
    }

    function queue(uint8 line, uint24 tokenId, uint256 minBid, uint40 endTime) external {
        auctionOf[tokenId] = IERC721Card.Auction({
            tokenId: tokenId,
            tokenURI: "ipfs://piece",
            minBid: minBid,
            highBidder: address(0),
            highBid: 0,
            startTime: 1,
            endTime: endTime,
            settled: false
        });
        head[line] = tokenId;
        if (tokenId >= nextTokenId) nextTokenId = tokenId + 1;
    }

    function bid(uint24 tokenId, address highBidder, uint256 highBid) external {
        auctionOf[tokenId].highBidder = highBidder;
        auctionOf[tokenId].highBid = highBid;
    }

    function settle(uint24 tokenId) external {
        auctionOf[tokenId].settled = true;
    }

    function getActiveAuction(uint8 line) external view returns (uint24) {
        uint24 id = head[line];
        if (id == 0) return 0;
        if (auctionOf[id].settled) return 0;
        return id;
    }

    function getAuction(uint24 tokenId) external view returns (IERC721Card.Auction memory) {
        if (tokenId == 0) revert("AuctionDoesNotExist");
        return auctionOf[tokenId];
    }
}

/// @dev A registered 721 instance whose every read reverts.
contract RevertingAuction {
    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC721;
    }

    fallback() external payable {
        revert("broken");
    }
}

/// @dev A registered 721 instance whose auction read returns bytes that do not decode to the declared
///      struct. The decode must fail inside the guarded reader's frame, not the portfolio's.
contract ShortReturnAuction {
    function instanceType() external pure returns (bytes32) {
        return TYPE_ERC721;
    }

    function owner() external view returns (address) {
        return address(this);
    }

    function lines() external pure returns (uint8) {
        return 1;
    }

    function getActiveAuction(uint8) external pure returns (uint24) {
        return 1;
    }

    /// @dev Declared to return an Auction; returns a single word instead.
    function getAuction(uint24) external pure returns (uint256) {
        return 1;
    }
}
