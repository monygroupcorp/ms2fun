// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";
import { FeaturedQueueManager } from "../../src/master/FeaturedQueueManager.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

contract MockRegistryS {
    mapping(address => bool) public isAgent;
    mapping(address => bool) internal _registered;

    function setAgent(address a, bool v) external {
        isAgent[a] = v;
    }

    function setRegistered(address i, bool v) external {
        _registered[i] = v;
    }

    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }

    function isInstanceFromApprovedFactory(address) external pure returns (bool) {
        return false;
    }
    error NotRegistered();

    function getInstanceInfo(address i) external view returns (IMasterRegistry.InstanceInfo memory info) {
        if (!_registered[i]) revert NotRegistered();
        info.instance = i;
    }
}

contract MockVaultS {
    function vaultType() external pure returns (string memory) {
        return "ZAMMLP";
    }
    function receiveContribution(address, uint256, address) external payable { }
    receive() external payable { }
}

/// @title  QueueSpamAndSquatDisproof
/// @notice Two reported attacks on the auction line queue and the featured queue, driven end to end
///         and shown to harm nobody. Kept because both are plausible enough to be re-reported: queue
///         spam lands BEHIND the creator's own pieces and is funded by the spammer, and a featured-slot
///         squatter pays the treasury to put their rival into the featured set while every path that
///         decides position stays permissionlessly open. See contracts/audits/2026-09-17-pre-testnet.md.
contract QueueSpamAndSquatDisproofTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal agent = address(0xA6E7);
    address internal rival = address(0xDEADBEEF);
    address internal fan = address(0xFA11);
    address internal gmr = address(0xDEAD);

    MockRegistryS internal registry;

    function _deployAuction() internal returns (ERC721AuctionInstance inst) {
        registry = new MockRegistryS();
        ERC721AuctionInstance.ConstructorParams memory p = ERC721AuctionInstance.ConstructorParams({
            vault: address(new MockVaultS()),
            protocolTreasury: treasury,
            owner: creator,
            name: "QueueSpam",
            symbol: "QS",
            metadataURI: "ipfs://meta",
            lines: 1,
            baseDuration: 1 hours,
            timeBuffer: 5 minutes,
            bidIncrement: 0.01 ether,
            globalMessageRegistry: gmr,
            masterRegistry: address(registry),
            factory: address(0xFAC7),
            weth: address(0)
        });
        inst = new ERC721AuctionInstance(p);
    }

    // ── B ────────────────────────────────────────────────────────────────────

    /// @dev B, part 1: `queuePiece` is NOT open to "any globally-approved agent" by default.
    ///      `agentDelegationEnabled` is false unless the factory flipped it for an agent-CREATED
    ///      instance, and the creator can flip it back off at will.
    function test_B_queuePiece_closedToAgentsUnlessCreatorOptedIn() public {
        ERC721AuctionInstance inst = _deployAuction();
        registry.setAgent(agent, true);

        assertFalse(inst.agentDelegationEnabled(), "delegation is OFF on a creator-made instance");
        vm.deal(agent, 1 ether);
        vm.prank(agent);
        vm.expectRevert(); // Unauthorized
        inst.queuePiece{ value: 1 wei }("ipfs://spam");

        // Creator opts in; now the agent can queue. Creator can revoke at any time.
        vm.prank(creator);
        inst.setAgentDelegation(true);
        vm.prank(agent);
        inst.queuePiece{ value: 1 wei }("ipfs://spam-1");
        assertEq(inst.getQueueLength(0), 1, "agent queued once delegation is on");

        vm.prank(creator);
        inst.setAgentDelegation(false);
        vm.prank(agent);
        vm.expectRevert(); // Unauthorized again, same block
        inst.queuePiece{ value: 1 wei }("ipfs://spam-2");
    }

    /// @dev B, part 2 — the decisive one. The filing's stated harm is that spam "locks the creator's
    ///      escrowed deposits behind it". `lineQueues[line].push(...)` APPENDS, so spam lands BEHIND
    ///      everything the creator already queued: the creator's deposits are strictly ahead and
    ///      settle first. And every spam piece is funded by the SPAMMER (`msg.value`), whose deposit
    ///      is refunded to `owner()` — the creator — on `reclaimUnsold`. The spammer pays the creator.
    function test_B_spamQueuesBehindCreatorAndIsFundedByTheSpammer() public {
        ERC721AuctionInstance inst = _deployAuction();
        registry.setAgent(agent, true);

        // Creator queues two real pieces first.
        vm.deal(creator, 10 ether);
        vm.startPrank(creator);
        inst.queuePiece{ value: 1 ether }("ipfs://real-1");
        inst.queuePiece{ value: 1 ether }("ipfs://real-2");
        inst.setAgentDelegation(true);
        vm.stopPrank();

        // Rogue agent spams three pieces at 1 wei each.
        vm.deal(agent, 1 ether);
        vm.startPrank(agent);
        for (uint256 i = 0; i < 3; i++) {
            inst.queuePiece{ value: 1 wei }("ipfs://spam");
        }
        vm.stopPrank();

        // The ACTIVE piece is still the creator's first, not the spam.
        assertEq(inst.getActiveAuction(0), 1, "creator's piece 1 is still the live auction");
        assertEq(inst.getAuction(1).minBid, 1 ether, "and it is the creator's 1 ETH deposit");
        assertEq(inst.getQueueLength(0), 5, "5 queued: creator 1,2 then spam 3,4,5 BEHIND them");

        // Creator's piece 1 clears on schedule; the refund goes to the creator in full.
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        uint256 creatorBefore = creator.balance;
        inst.reclaimUnsold(1);
        assertEq(inst.getActiveAuction(0), 2, "line advanced to the creator's SECOND piece, not spam");

        // Creator's piece 2 clears next. Only then does spam reach the front.
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        inst.reclaimUnsold(2);
        assertEq(inst.getActiveAuction(0), 3, "spam only reaches the front after every creator piece");
        assertGt(creator.balance, creatorBefore + 1.9 ether, "both creator deposits came back");

        // And clearing the spam PAYS the creator the spammer's wei.
        uint256 beforeSpam = creator.balance;
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        inst.reclaimUnsold(3);
        assertEq(creator.balance, beforeSpam + 1, "the spammer's own deposit is refunded to the creator");
    }

    // ── H ────────────────────────────────────────────────────────────────────

    function _deployQueue() internal returns (FeaturedQueueManager q) {
        registry = new MockRegistryS();
        q = new FeaturedQueueManager();
        q.initialize(address(registry), address(this));
        q.setProtocolTreasury(treasury);
        q.setWeth(address(0xBEEF00));
    }

    /// @dev H: "a competitor can squat a project's own slot and lock the project out". A squatter
    ///      pays the protocol to PUT THE RIVAL IN the featured set, and the rival is not locked out
    ///      of anything that matters: `boostRank` and `renewDuration` are both permissionless and
    ///      stay open for the whole squatted window, so the project can still buy rank and extend.
    function test_H_squattingFundsTheRival_andLocksNothing() public {
        FeaturedQueueManager q = _deployQueue();
        address project = address(0x9317);
        registry.setRegistered(project, true);

        // Rival "squats" the project's slot for the minimum 7 days.
        uint256 cost = 0.001 ether * 7; // dailyRate * 7 days
        vm.deal(rival, 1 ether);
        uint256 treasuryBefore = treasury.balance;
        vm.prank(rival);
        q.rentFeatured{ value: cost }(project, 7 days, 0);

        assertEq(treasury.balance, treasuryBefore + cost, "the squat's rent went to the protocol treasury");
        (,,, uint256 expiresAt) = q.slots(project);
        assertGt(expiresAt, vm.getBlockTimestamp(), "the RIVAL'S project is now the featured one");

        // Re-renting is refused while the (rival-funded) slot is live...
        vm.deal(project, 1 ether);
        vm.prank(project);
        vm.expectRevert(); // AlreadyFeatured
        q.rentFeatured{ value: cost }(project, 7 days, 0);

        // ...but the two things that decide POSITION are wide open to the project and its fans.
        vm.prank(project);
        q.boostRank{ value: 0.5 ether }(project);
        vm.deal(fan, 1 ether);
        vm.prank(fan);
        q.renewDuration{ value: cost }(project, 7 days);

        (, uint256 rank,, uint256 newExpiry) = q.slots(project);
        assertEq(rank, 0.5 ether, "project bought rank during the squat");
        assertEq(newExpiry, expiresAt + 7 days, "and a fan extended the squatted slot");
    }
}
