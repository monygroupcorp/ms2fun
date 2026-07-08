// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { AlignmentTargetRequestRegistry } from "../../src/master/AlignmentTargetRequestRegistry.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";

contract AlignmentTargetRequestRegistryTest is Test {
    AlignmentTargetRequestRegistry reg;
    MockAlignmentRegistry registry;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address token = makeAddr("cultToken");

    uint256 constant DEPOSIT = 0.1 ether;
    uint256 constant MAX_PENDING = 3;
    uint256 constant TTL = 7 days;

    function setUp() public {
        registry = new MockAlignmentRegistry();
        reg = new AlignmentTargetRequestRegistry(
            owner, IAlignmentRegistry(address(registry)), treasury, DEPOSIT, MAX_PENDING, TTL
        );
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _assets() internal view returns (IAlignmentRegistry.AlignmentAsset[] memory a) {
        a = new IAlignmentRegistry.AlignmentAsset[](1);
        a[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "CULT", info: "Cult DAO", metadataURI: "" });
    }

    function _submit(address who, address tok) internal returns (uint256 id) {
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        if (tok != token) a[0].token = tok;
        vm.prank(who);
        id = reg.submitRequest{ value: DEPOSIT }(tok, "Cult DAO", "desc", "ipfs://x", a);
    }

    /// @dev Simulate the admin having registered a target for `tok` (the register step of the two-tx
    ///      approve flow) so `approveRequest` sees the token as active.
    function _register(address tok, uint256 targetId) internal {
        registry.pushTokenTarget(tok, targetId);
        registry.setTargetActive(targetId, true);
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    function test_submit_storesPendingRequest() public {
        uint256 id = _submit(alice, token);
        assertEq(id, 1);
        AlignmentTargetRequestRegistry.Request memory r = reg.getRequest(id);
        assertEq(r.requester, alice);
        assertEq(r.token, token);
        assertEq(r.deposit, DEPOSIT);
        assertEq(uint8(r.status), uint8(AlignmentTargetRequestRegistry.Status.Pending));
        assertEq(reg.pendingCount(), 1);
        assertEq(reg.getPending()[0], 1);
        assertEq(reg.getRequestAssets(id).length, 1);
        assertEq(reg.getRequestAssets(id)[0].symbol, "CULT");
        assertEq(address(reg).balance, DEPOSIT); // escrowed
    }

    function test_submit_revertsOnWrongDeposit() public {
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        vm.prank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.IncorrectDeposit.selector);
        reg.submitRequest{ value: DEPOSIT - 1 }(token, "t", "d", "u", a);
    }

    function test_submit_revertsOnEmptyTitleAndNoAssets() public {
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        vm.startPrank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.InvalidTitle.selector);
        reg.submitRequest{ value: DEPOSIT }(token, "", "d", "u", a);

        IAlignmentRegistry.AlignmentAsset[] memory none = new IAlignmentRegistry.AlignmentAsset[](0);
        vm.expectRevert(AlignmentTargetRequestRegistry.NoAssets.selector);
        reg.submitRequest{ value: DEPOSIT }(token, "t", "d", "u", none);
        vm.stopPrank();
    }

    function test_submit_revertsOnZeroToken() public {
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        vm.prank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.InvalidAddress.selector);
        reg.submitRequest{ value: DEPOSIT }(address(0), "t", "d", "u", a);
    }

    function test_submit_revertsWhenPrimaryTokenNotInAssets() public {
        // assets list exists but none of its tokens is the primary token.
        IAlignmentRegistry.AlignmentAsset[] memory a = new IAlignmentRegistry.AlignmentAsset[](1);
        a[0] = IAlignmentRegistry.AlignmentAsset({ token: makeAddr("other"), symbol: "OTH", info: "", metadataURI: "" });
        vm.prank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.TokenNotInAssets.selector);
        reg.submitRequest{ value: DEPOSIT }(token, "t", "d", "u", a);
    }

    function test_submit_revertsWhenQueueFull() public {
        _submit(alice, makeAddr("t1"));
        _submit(alice, makeAddr("t2"));
        _submit(alice, makeAddr("t3"));
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        a[0].token = makeAddr("t4");
        vm.prank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.QueueFull.selector);
        reg.submitRequest{ value: DEPOSIT }(makeAddr("t4"), "t", "d", "u", a);
    }

    function test_submit_revertsWhenTokenAlreadyActive() public {
        // Dup guard: token already belongs to an active target.
        registry.pushTokenTarget(token, 5);
        registry.setTargetActive(5, true);
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        vm.prank(alice);
        vm.expectRevert(AlignmentTargetRequestRegistry.TokenAlreadyActive.selector);
        reg.submitRequest{ value: DEPOSIT }(token, "t", "d", "u", a);
    }

    function test_submit_allowedWhenTokenTargetInactive() public {
        registry.pushTokenTarget(token, 5);
        registry.setTargetActive(5, false); // exists but not active → allowed
        uint256 id = _submit(alice, token);
        assertEq(id, 1);
    }

    // ── Approve ────────────────────────────────────────────────────────────────

    function test_approve_refundsAndDelists() public {
        uint256 id = _submit(alice, token);
        _register(token, 99); // admin registered the target (register step) → approve is now allowed
        uint256 balBefore = alice.balance;

        vm.prank(owner);
        reg.approveRequest(id);

        AlignmentTargetRequestRegistry.Request memory r = reg.getRequest(id);
        assertEq(uint8(r.status), uint8(AlignmentTargetRequestRegistry.Status.Approved));
        assertEq(r.deposit, 0);
        assertEq(reg.pendingCount(), 0, "delisted");
        // Pull-payment: refund is CREDITED, not sent, until the requester claims it.
        assertEq(reg.refunds(alice), DEPOSIT, "refund credited");
        assertEq(alice.balance, balBefore, "not sent until withdrawn");
        assertEq(address(reg).balance, DEPOSIT, "still held until withdrawn");

        vm.prank(alice);
        reg.withdrawRefund();
        assertEq(alice.balance, balBefore + DEPOSIT, "withdrawn");
        assertEq(reg.refunds(alice), 0);
        assertEq(address(reg).balance, 0);
    }

    function test_withdrawRefund_revertsWhenNothingOwed() public {
        vm.prank(bob);
        vm.expectRevert(AlignmentTargetRequestRegistry.NoRefund.selector);
        reg.withdrawRefund();
    }

    /// @dev A requester that can't receive ETH can't brick approve — only its own claim reverts.
    function test_pullPayment_badReceiverCannotBrickApprove() public {
        RevertingReceiver bad = new RevertingReceiver();
        vm.deal(address(bad), 1 ether);
        uint256 id = bad.submit(reg, token, _assets(), DEPOSIT);
        _register(token, 99);

        vm.prank(owner);
        reg.approveRequest(id); // must NOT revert despite the bad receiver
        assertEq(reg.refunds(address(bad)), DEPOSIT, "credited");

        // The bad receiver's own claim reverts (its problem, not the protocol's).
        vm.prank(address(bad));
        vm.expectRevert();
        reg.withdrawRefund();
    }

    function test_approve_onlyOwner() public {
        uint256 id = _submit(alice, token);
        vm.prank(bob);
        vm.expectRevert();
        reg.approveRequest(id);
    }

    function test_approve_revertsIfNotPending() public {
        uint256 id = _submit(alice, token);
        _register(token, 99);
        vm.startPrank(owner);
        reg.approveRequest(id);
        vm.expectRevert(AlignmentTargetRequestRegistry.NotPending.selector);
        reg.approveRequest(id);
        vm.stopPrank();
    }

    function test_approve_revertsIfTargetNotRegistered() public {
        uint256 id = _submit(alice, token);
        // No register step → the target doesn't exist yet → approve must not refund + delist.
        vm.prank(owner);
        vm.expectRevert(AlignmentTargetRequestRegistry.TargetNotRegistered.selector);
        reg.approveRequest(id);
        assertEq(reg.pendingCount(), 1, "request stays pending");
        assertEq(address(reg).balance, DEPOSIT, "deposit still escrowed");
    }

    // ── Reject ────────────────────────────────────────────────────────────────

    function test_reject_forfeitSendsToTreasury() public {
        uint256 id = _submit(alice, token);
        uint256 tBefore = treasury.balance;
        uint256 aBefore = alice.balance;

        vm.prank(owner);
        reg.rejectRequest(id, true); // forfeit

        assertEq(treasury.balance, tBefore + DEPOSIT, "forfeited to treasury");
        assertEq(alice.balance, aBefore, "requester not refunded");
        assertEq(uint8(reg.getRequest(id).status), uint8(AlignmentTargetRequestRegistry.Status.Rejected));
        assertEq(reg.pendingCount(), 0);
    }

    function test_reject_noForfeitRefundsRequester() public {
        uint256 id = _submit(alice, token);
        uint256 aBefore = alice.balance;

        vm.prank(owner);
        reg.rejectRequest(id, false);

        assertEq(reg.refunds(alice), DEPOSIT, "credited on good-faith reject");
        assertEq(alice.balance, aBefore, "not sent until withdrawn");
        assertEq(treasury.balance, 0);

        vm.prank(alice);
        reg.withdrawRefund();
        assertEq(alice.balance, aBefore + DEPOSIT, "withdrawn");
    }

    function test_reject_onlyOwner() public {
        uint256 id = _submit(alice, token);
        vm.prank(alice);
        vm.expectRevert();
        reg.rejectRequest(id, true);
    }

    // ── Expiry ──────────────────────────────────────────────────────────────────

    function test_pruneExpired_refundsAfterTTL() public {
        uint256 id = _submit(alice, token);
        uint256 aBefore = alice.balance;

        vm.expectRevert(AlignmentTargetRequestRegistry.NotExpired.selector);
        reg.pruneExpired(id);

        vm.warp(block.timestamp + TTL + 1);
        // anyone can prune
        vm.prank(bob);
        reg.pruneExpired(id);

        assertEq(reg.refunds(alice), DEPOSIT, "expiry credits requester");
        assertEq(uint8(reg.getRequest(id).status), uint8(AlignmentTargetRequestRegistry.Status.Expired));
        assertEq(reg.pendingCount(), 0);

        vm.prank(alice);
        reg.withdrawRefund();
        assertEq(alice.balance, aBefore + DEPOSIT, "expiry refunds requester on claim");
    }

    // ── Config ────────────────────────────────────────────────────────────────

    function test_config_onlyOwner() public {
        vm.startPrank(owner);
        reg.setRequestDeposit(0.5 ether);
        reg.setMaxPending(10);
        reg.setRequestTTL(1 days);
        reg.setProtocolTreasury(bob);
        vm.stopPrank();
        assertEq(reg.requestDeposit(), 0.5 ether);
        assertEq(reg.maxPending(), 10);
        assertEq(reg.requestTTL(), 1 days);
        assertEq(reg.protocolTreasury(), bob);

        vm.prank(alice);
        vm.expectRevert();
        reg.setRequestDeposit(0);
    }

    function test_zeroDeposit_disablesEscrow() public {
        vm.prank(owner);
        reg.setRequestDeposit(0);
        IAlignmentRegistry.AlignmentAsset[] memory a = _assets();
        vm.prank(alice);
        uint256 id = reg.submitRequest{ value: 0 }(token, "t", "d", "u", a);
        assertEq(reg.getRequest(id).deposit, 0);
        assertEq(address(reg).balance, 0);
    }

    // Swap-and-pop delisting keeps the pending list consistent when removing a middle entry.
    function test_delist_middleEntry_keepsListConsistent() public {
        uint256 id1 = _submit(alice, makeAddr("a"));
        uint256 id2 = _submit(alice, makeAddr("b"));
        uint256 id3 = _submit(alice, makeAddr("c"));
        assertEq(reg.pendingCount(), 3);

        _register(makeAddr("b"), 99);
        vm.prank(owner);
        reg.approveRequest(id2); // remove middle

        uint256[] memory pend = reg.getPending();
        assertEq(pend.length, 2);
        // id1 and id3 remain, id2 gone
        assertTrue((pend[0] == id1 || pend[1] == id1), "id1 present");
        assertTrue((pend[0] == id3 || pend[1] == id3), "id3 present");
    }
}

/// @dev A requester contract that rejects incoming ETH — used to prove pull-payment can't be griefed.
contract RevertingReceiver {
    function submit(
        AlignmentTargetRequestRegistry reg,
        address token,
        IAlignmentRegistry.AlignmentAsset[] memory assets,
        uint256 deposit
    ) external returns (uint256) {
        return reg.submitRequest{ value: deposit }(token, "Cult DAO", "desc", "ipfs://x", assets);
    }

    receive() external payable {
        revert("no eth");
    }
}
