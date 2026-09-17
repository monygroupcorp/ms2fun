// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance, InvalidTimeBuffer } from "../../src/factories/erc721/ERC721AuctionInstance.sol";

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

/// @notice Finding A (M-5), now defended. `timeBuffer` was an unbounded uint40 immutable checked only
///         for `!= 0`, and the anti-snipe rule RESETS `endTime` to `block.timestamp + timeBuffer`
///         (absolute, not an increment) on any bid landing inside the buffer. With nothing enforcing
///         the implicit invariant `timeBuffer <= baseDuration`, the FIRST bid on a fresh auction could
///         push `endTime` arbitrarily far out, and the high bid has no withdraw path: `settleAuction`
///         and `reclaimUnsold` are the only exits and both gate on `endTime`.
///
///         The constructor now refuses `timeBuffer > baseDuration`, so the two scenarios this proof
///         was written around can no longer be constructed. These tests hold that line: each one
///         builds the exact configuration the finding described and asserts the refusal, then runs the
///         same bid sequence at the largest buffer still legal to show what the bound buys — the
///         escrow lock is capped at one `baseDuration` from the last bid, and the auction always ends.
///
///         The bound's own edges (one-over reverts, equal-is-legal, through the real factory) are
///         pinned in `test/factories/erc721/ERC721AuctionFactory.t.sol`; what is proved here is that
///         the finding's own scenarios are dead.
contract AuctionTimeBufferLockTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal bidder = address(0xB1D);
    address internal rescuer = address(0xBEEF);
    address internal gmr = address(0xDEAD);

    MockRegistryTB internal registry;
    MockVaultTB internal vault;

    function _params(uint40 baseDuration, uint40 timeBuffer)
        internal
        returns (ERC721AuctionInstance.ConstructorParams memory p)
    {
        registry = new MockRegistryTB();
        vault = new MockVaultTB();
        p = ERC721AuctionInstance.ConstructorParams({
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
    }

    function _deploy(uint40 baseDuration, uint40 timeBuffer) internal returns (ERC721AuctionInstance inst) {
        inst = new ERC721AuctionInstance(_params(baseDuration, timeBuffer));
    }

    /// @dev The adversarial configuration: a ~100-year `timeBuffer` on a one-hour auction. It used to
    ///      construct, and one ordinary bid then locked the bidder's ETH for ~100 years. The
    ///      constructor now refuses it outright, so there is no instance to bid into.
    function test_A_hundredYearTimeBuffer_isRefusedAtConstruction() public {
        uint40 century = uint40(365 days) * 100;
        // Built first and deliberately: `_params` deploys the stubs, and `expectRevert` claims the very
        // next call, so inlining it would arm the cheatcode on a stub constructor instead of the auction.
        ERC721AuctionInstance.ConstructorParams memory p = _params(1 hours, century);

        vm.expectRevert(InvalidTimeBuffer.selector);
        new ERC721AuctionInstance(p);
    }

    /// @dev The same bid-and-rescue sequence the original proof ran, at the largest buffer still legal
    ///      (`timeBuffer == baseDuration`). There is still no withdraw, cancel or rescue path — that
    ///      part of the finding was never fixed and is not what was wrong. What the bound buys is that
    ///      the wait is finite and bounded by the auction's own advertised length: every bid can only
    ///      ever push `endTime` to `now + baseDuration`, and the auction does end and settle.
    function test_A_atTheMaximumLegalBuffer_theLockIsBoundedByOneBaseDuration() public {
        uint40 baseDuration = 1 hours;
        ERC721AuctionInstance inst = _deploy(baseDuration, baseDuration);
        assertEq(inst.timeBuffer(), baseDuration, "a buffer equal to the base duration is legal");

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece-1");

        uint40 endBefore = inst.getAuction(1).endTime;
        assertEq(endBefore, uint40(vm.getBlockTimestamp()) + baseDuration, "auction opens with a one-hour clock");

        // The same bid, one second in, that used to arm a century.
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");

        uint40 endAfterBid = inst.getAuction(1).endTime;
        assertEq(endAfterBid, uint40(vm.getBlockTimestamp()) + baseDuration, "the reset is capped at one baseDuration");
        assertLe(endAfterBid - vm.getBlockTimestamp(), baseDuration, "the bidder's ETH is escrowed for at most an hour");

        // A rescue bid still moves the loss rather than withdrawing it, and still re-arms the clock —
        // but only by another baseDuration, so the re-arm cannot outrun the auction's own length.
        vm.deal(rescuer, 6 ether);
        vm.prank(rescuer);
        inst.createBid{ value: 5.01 ether }(1, "");
        assertEq(bidder.balance, 5 ether, "original bidder refunded by the higher bid");
        assertEq(
            inst.getAuction(1).endTime,
            uint40(vm.getBlockTimestamp()) + baseDuration,
            "the re-arm is one baseDuration, not a century"
        );

        // And it ends. One baseDuration after the last bid, the only exit the finding named is open.
        vm.warp(vm.getBlockTimestamp() + baseDuration);
        inst.settleAuction(1);
        assertEq(inst.ownerOf(1), rescuer, "the auction settled to the high bidder");
        assertEq(inst.getAuction(1).settled, true, "the line is not frozen");
    }

    /// @dev The realistic misconfiguration, not the adversarial one: a creator who reads "anti-snipe
    ///      buffer" as "how long a bid keeps the auction alive" and enters a year on a one-day auction.
    ///      That is the shape the finding expected to meet in the wild, and the constructor now refuses
    ///      it — the creator is told at deploy time instead of discovering it from a locked bidder.
    function test_A_plausibleMisconfig_oneYearBufferOnADayAuction_isRefused() public {
        ERC721AuctionInstance.ConstructorParams memory p = _params(1 days, uint40(365 days));

        vm.expectRevert(InvalidTimeBuffer.selector);
        new ERC721AuctionInstance(p);
    }

    /// @dev The roll-forward itself is untouched: bids inside the buffer still reset the clock, and a
    ///      contested auction still outlives its advertised end. The bound is what makes that bounded —
    ///      each reset is one `baseDuration` from the bid, so quiet for one `baseDuration` ends it.
    function test_A_rollForward_survivesTheFixButIsBoundedPerBid() public {
        uint40 baseDuration = 1 days;
        ERC721AuctionInstance inst = _deploy(baseDuration, baseDuration);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece-1");

        vm.deal(bidder, 10 ether);
        vm.deal(rescuer, 10 ether);

        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(bidder);
        inst.createBid{ value: 1 ether }(1, "");
        assertEq(inst.getAuction(1).endTime, uint40(t0) + baseDuration, "first bid: +1 day, not +1 year");

        // 12 hours later a contesting bid lands inside the buffer and rolls the clock another day.
        vm.warp(t0 + 12 hours);
        vm.prank(rescuer);
        inst.createBid{ value: 1.01 ether }(1, "");
        assertEq(inst.getAuction(1).endTime, uint40(t0 + 12 hours) + baseDuration, "second bid: +1 day again");

        // Bidding stops. One baseDuration of quiet and it is over — the roll-forward cannot outlive it.
        vm.warp(t0 + 12 hours + baseDuration);
        inst.settleAuction(1);
        assertEq(inst.ownerOf(1), rescuer, "a contested auction still ends within a day of the last bid");
    }
}
