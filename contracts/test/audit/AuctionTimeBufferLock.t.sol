// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";

/// @dev Minimal registry stub: the auction only reads these three on the paths exercised here.
contract MockRegistryTB {
    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }

    function isInstanceFromApprovedFactory(address) external pure returns (bool) {
        return false;
    }

    function isAgent(address) external pure returns (bool) {
        return false;
    }
}

contract MockVaultTB {
    function vaultType() external pure returns (string memory) {
        return "ZAMMLP";
    }

    function receiveContribution(address, uint256, address) external payable { }

    receive() external payable { }
}

/// @notice Finding A: `timeBuffer` is an unbounded uint40 immutable checked only for `!= 0`, and the
///         anti-snipe rule RESETS `endTime` to `vm.getBlockTimestamp() + timeBuffer` (absolute, not an
///         increment) on any bid landing inside the buffer. Nothing enforces the implicit invariant
///         `timeBuffer <= baseDuration`, so the FIRST bid on a fresh auction can push `endTime`
///         arbitrarily far out. The high bid has no withdraw path: `settleAuction` and
///         `reclaimUnsold` are the only exits and both gate on `endTime`.
contract AuctionTimeBufferLockTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal bidder = address(0xB1D);
    address internal rescuer = address(0xBEEF);
    address internal gmr = address(0xDEAD);

    MockRegistryTB internal registry;
    MockVaultTB internal vault;

    function _deploy(uint40 baseDuration, uint40 timeBuffer) internal returns (ERC721AuctionInstance inst) {
        registry = new MockRegistryTB();
        vault = new MockVaultTB();
        ERC721AuctionInstance.ConstructorParams memory p = ERC721AuctionInstance.ConstructorParams({
            vault: address(vault),
            protocolTreasury: treasury,
            owner: creator,
            name: "TimeBufferLock",
            symbol: "TBL",
            metadataURI: "ipfs://meta",
            lines: 1,
            baseDuration: baseDuration,
            timeBuffer: timeBuffer,
            bidIncrement: 0.01 ether,
            globalMessageRegistry: gmr,
            masterRegistry: address(registry),
            factory: address(0xFAC7),
            weth: address(0)
        });
        inst = new ERC721AuctionInstance(p);
    }

    /// @dev The constructor accepts a ~100-year `timeBuffer` with a one-hour `baseDuration`.
    ///      A single ordinary bid then locks the bidder's ETH for ~100 years.
    function test_A_hundredYearTimeBuffer_locksWinningBidderETH() public {
        uint40 century = uint40(365 days) * 100;
        ERC721AuctionInstance inst = _deploy(1 hours, century);

        // The only validation anywhere: != 0. Both values are public immutables.
        assertEq(inst.timeBuffer(), century, "constructor accepted a 100-year anti-snipe buffer");
        assertEq(inst.baseDuration(), 1 hours, "auction advertises a one-hour base duration");

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece-1");

        uint40 endBefore = inst.getAuction(1).endTime;
        assertEq(endBefore, uint40(vm.getBlockTimestamp()) + 1 hours, "auction opens with a one-hour clock");

        // An ordinary bidder bids ONE second in, on an auction that says it ends in an hour.
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");

        uint40 endAfter = inst.getAuction(1).endTime;
        emit log_named_uint("endTime before bid (seconds from now)", endBefore - vm.getBlockTimestamp());
        emit log_named_uint("endTime after  bid (seconds from now)", endAfter - vm.getBlockTimestamp());
        emit log_named_uint("years the bidder's ETH is locked", (endAfter - vm.getBlockTimestamp()) / 365 days);

        assertEq(endAfter, uint40(vm.getBlockTimestamp()) + century, "one bid reset endTime to now + timeBuffer");
        assertEq(address(inst).balance, 5.1 ether, "bidder's 5 ETH is in escrow");
        assertEq(bidder.balance, 0, "bidder has nothing left");

        // Both exits are shut for the next century.
        vm.expectRevert(); // AuctionNotEnded
        inst.settleAuction(1);
        vm.expectRevert(); // HasBids (and AuctionNotEnded)
        inst.reclaimUnsold(1);

        // Fast-forward 99 years: still shut.
        vm.warp(vm.getBlockTimestamp() + 99 * 365 days);
        vm.expectRevert();
        inst.settleAuction(1);

        // The line is frozen with it: the piece never settles, so lineQueueHead never advances.
        assertEq(inst.getActiveAuction(0), 1, "line 0 still pinned to token 1 after 99 years");
    }

    /// @dev There is no withdraw, cancel, or rescue: the ONLY way out for the locked bidder is for a
    ///      third party to volunteer strictly more ETH — which then locks the volunteer instead.
    function test_A_noWithdrawPath_rescueOnlyMovesTheLoss() public {
        ERC721AuctionInstance inst = _deploy(1 hours, uint40(365 days) * 100);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece-1");

        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");
        assertEq(bidder.balance, 0, "bidder locked");

        // A rescuer outbids; the original bidder is made whole, the rescuer is now the locked one.
        vm.deal(rescuer, 6 ether);
        vm.prank(rescuer);
        inst.createBid{ value: 5.01 ether }(1, "");

        assertEq(bidder.balance, 5 ether, "original bidder refunded only because someone else paid more");
        assertEq(rescuer.balance, 6 ether - 5.01 ether, "the loss simply moved to the rescuer");
        assertEq(address(inst).balance, 5.11 ether, "escrow still holds the deposit + the new high bid");

        // And the clock was reset AGAIN by the rescue bid.
        assertEq(
            inst.getAuction(1).endTime,
            uint40(vm.getBlockTimestamp()) + uint40(365 days) * 100,
            "every bid re-arms the century"
        );
    }

    /// @dev The realistic misconfiguration, not the adversarial one: a creator who reads "anti-snipe
    ///      buffer" as "how long a bid keeps the auction alive" and enters a year. Same shape, and
    ///      every fresh bid rolls the year forward, so the auction can never end while bidding is live.
    function test_A_plausibleMisconfig_oneYearBuffer_rollsForwardForever() public {
        ERC721AuctionInstance inst = _deploy(1 days, uint40(365 days));

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece-1");

        vm.deal(bidder, 10 ether);
        vm.deal(rescuer, 10 ether);

        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(bidder);
        inst.createBid{ value: 1 ether }(1, "");
        assertEq(inst.getAuction(1).endTime, uint40(t0) + 365 days, "first bid: +1 year");

        // 300 days later, one more bid pushes it out another full year from THEN.
        vm.warp(t0 + 300 days);
        vm.prank(rescuer);
        inst.createBid{ value: 1.01 ether }(1, "");
        assertEq(inst.getAuction(1).endTime, uint40(t0 + 300 days) + 365 days, "second bid: +1 year again");

        emit log_named_uint("total auction life so far (days)", (inst.getAuction(1).endTime - t0) / 1 days);

        vm.warp(t0 + 600 days);
        vm.expectRevert(); // AuctionNotEnded: 600 days into a "1 day" auction
        inst.settleAuction(1);
    }
}
