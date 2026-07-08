// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { GlobalMessageRegistry } from "../../src/registry/GlobalMessageRegistry.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MessageTypes } from "../../src/libraries/MessageTypes.sol";

contract GlobalMessageRegistryTest is Test {
    GlobalMessageRegistry public registry;
    MockMasterRegistry public masterRegistry;

    address public owner = address(this);
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public instance = address(0x100);

    event MessagePosted(
        uint256 indexed messageId,
        address indexed instance,
        address indexed sender,
        uint8 messageType,
        uint256 refId,
        bytes32 actionRef,
        bytes32 metadata,
        uint256 value,
        string content
    );

    event PostThresholdSet(uint256 threshold);

    function setUp() public {
        masterRegistry = new MockMasterRegistry();
        registry = new GlobalMessageRegistry();
        registry.initialize(owner, address(masterRegistry));
    }

    // ── Initialize ──

    function test_constructor() public view {
        assertEq(registry.messageCount(), 0);
        assertEq(address(registry.masterRegistry()), address(masterRegistry));
    }

    function test_initialize_revertZeroOwner() public {
        GlobalMessageRegistry r = new GlobalMessageRegistry();
        vm.expectRevert(GlobalMessageRegistry.InvalidAddress.selector);
        r.initialize(address(0), address(masterRegistry));
    }

    function test_initialize_revertZeroRegistry() public {
        GlobalMessageRegistry r = new GlobalMessageRegistry();
        vm.expectRevert(GlobalMessageRegistry.InvalidAddress.selector);
        r.initialize(owner, address(0));
    }

    function test_initialize_revertAlreadyInitialized() public {
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        registry.initialize(owner, address(masterRegistry));
    }

    // ── postForAction ──

    function test_postForAction_emitsEvent() public {
        bytes memory messageData = abi.encode(uint8(MessageTypes.POST), uint256(0), bytes32(0), bytes32(0), "gm");

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "gm");

        vm.prank(instance);
        registry.postForAction(user1, instance, messageData);

        assertEq(registry.messageCount(), 1);
    }

    function test_postForAction_incrementsCount() public {
        bytes memory messageData = abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), "a");

        vm.prank(instance);
        registry.postForAction(user1, instance, messageData);

        vm.prank(instance);
        registry.postForAction(user2, instance, messageData);

        assertEq(registry.messageCount(), 2);
    }

    function test_postForAction_revertInstanceNotCaller() public {
        bytes memory messageData = abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), "x");

        vm.prank(user1); // user1 is not `instance`
        vm.expectRevert(GlobalMessageRegistry.InstanceMustBeCaller.selector);
        registry.postForAction(user1, instance, messageData);
    }

    function test_postForAction_revertZeroSender() public {
        bytes memory messageData = abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), "x");

        vm.prank(instance);
        vm.expectRevert(GlobalMessageRegistry.InvalidAddress.selector);
        registry.postForAction(address(0), instance, messageData);
    }

    // ── post (direct user call) ──

    function test_post_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "hello");

        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "hello");

        assertEq(registry.messageCount(), 1);
    }

    function test_post_reply() public {
        // First post
        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "original");

        // Reply to message 0
        vm.expectEmit(true, true, true, true);
        emit MessagePosted(1, instance, user2, MessageTypes.REPLY, 0, bytes32(0), bytes32(0), 0, "reply");

        vm.prank(user2);
        registry.post(instance, MessageTypes.REPLY, 0, bytes32(0), bytes32(0), "reply");

        assertEq(registry.messageCount(), 2);
    }

    function test_post_quote() public {
        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "quotable");

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(1, instance, user2, MessageTypes.QUOTE, 0, bytes32(0), bytes32(0), 0, "quoting this");

        vm.prank(user2);
        registry.post(instance, MessageTypes.QUOTE, 0, bytes32(0), bytes32(0), "quoting this");
    }

    function test_post_react() public {
        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "react to me");

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(1, instance, user2, MessageTypes.REACT, 0, bytes32(0), bytes32(0), 0, "fire");

        vm.prank(user2);
        registry.post(instance, MessageTypes.REACT, 0, bytes32(0), bytes32(0), "fire");
    }

    function test_post_withActionRefAndMetadata() public {
        bytes32 actionRef = keccak256("tx:buy:123");
        bytes32 metadata = bytes32(uint256(42));

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, actionRef, metadata, 0, "bought!");

        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, actionRef, metadata, "bought!");
    }

    // ── post to arbitrary address (groupchat) ──

    function test_post_arbitraryAddress() public {
        address groupchat = address(0xDEAD);

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, groupchat, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "gm group");

        vm.prank(user1);
        registry.post(groupchat, MessageTypes.POST, 0, bytes32(0), bytes32(0), "gm group");

        assertEq(registry.messageCount(), 1);
    }

    function test_post_zeroAddress() public {
        vm.prank(user1);
        registry.post(address(0), MessageTypes.POST, 0, bytes32(0), bytes32(0), "broadcast");
        assertEq(registry.messageCount(), 1);
    }

    // ── postBatch ──

    function test_postBatch_multipleActions() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](3);

        // React to something
        posts[0] = GlobalMessageRegistry.PostParams({
            instance: instance,
            messageType: MessageTypes.REACT,
            refId: 42,
            actionRef: bytes32(0),
            metadata: bytes32(0),
            value: 0,
            content: "fire"
        });

        // Reply to something else
        posts[1] = GlobalMessageRegistry.PostParams({
            instance: instance,
            messageType: MessageTypes.REPLY,
            refId: 10,
            actionRef: bytes32(0),
            metadata: bytes32(0),
            value: 0,
            content: "great post"
        });

        // Post in a groupchat
        posts[2] = GlobalMessageRegistry.PostParams({
            instance: address(0xDEAD),
            messageType: MessageTypes.POST,
            refId: 0,
            actionRef: bytes32(0),
            metadata: bytes32(0),
            value: 0,
            content: "gm"
        });

        vm.prank(user1);
        registry.postBatch(posts);

        assertEq(registry.messageCount(), 3);
    }

    function test_postBatch_emitsCorrectEvents() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](2);
        posts[0] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "first");
        posts[1] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "second");

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "first");
        vm.expectEmit(true, true, true, true);
        emit MessagePosted(1, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "second");

        vm.prank(user1);
        registry.postBatch(posts);
    }

    function test_postBatch_emptyReverts() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](0);

        vm.prank(user1);
        vm.expectRevert(GlobalMessageRegistry.EmptyBatch.selector);
        registry.postBatch(posts);
    }

    function test_postBatch_singleItem() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](1);
        posts[0] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "solo");

        vm.prank(user1);
        registry.postBatch(posts);

        assertEq(registry.messageCount(), 1);
    }

    // ── Configuration ──

    function test_setMasterRegistry() public {
        MockMasterRegistry newRegistry = new MockMasterRegistry();
        registry.setMasterRegistry(address(newRegistry));
        assertEq(address(registry.masterRegistry()), address(newRegistry));
    }

    function test_setMasterRegistry_revertNonOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        registry.setMasterRegistry(address(0x999));
    }

    function test_setMasterRegistry_revertZero() public {
        vm.expectRevert(GlobalMessageRegistry.InvalidAddress.selector);
        registry.setMasterRegistry(address(0));
    }

    function test_withdrawETH() public {
        vm.deal(address(registry), 1 ether);
        uint256 balBefore = address(this).balance;
        registry.withdrawETH();
        assertEq(address(this).balance, balBefore + 1 ether);
    }

    receive() external payable { }

    function test_withdrawETH_revertNoBalance() public {
        vm.expectRevert(GlobalMessageRegistry.NoETHToWithdraw.selector);
        registry.withdrawETH();
    }

    function test_withdrawETH_revertNonOwner() public {
        vm.deal(address(registry), 1 ether);
        vm.prank(user1);
        vm.expectRevert();
        registry.withdrawETH();
    }

    // ── Post value (spam threshold) ──

    function test_post_recordsValue() public {
        vm.deal(user1, 1 ether);

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.3 ether, "priced");

        vm.prank(user1);
        registry.post{ value: 0.3 ether }(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "priced");

        // ETH accumulates in the registry; the existing onlyOwner withdrawETH() sweeps it.
        assertEq(address(registry).balance, 0.3 ether);
    }

    function test_postForAction_recordsValue() public {
        bytes memory messageData = abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), "action");
        vm.deal(instance, 1 ether);

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.1 ether, "action");

        vm.prank(instance);
        registry.postForAction{ value: 0.1 ether }(user1, instance, messageData);

        assertEq(address(registry).balance, 0.1 ether);
    }

    function test_postBatch_recordsPerPostValue() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](2);
        posts[0] = GlobalMessageRegistry.PostParams(
            instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.2 ether, "cheap"
        );
        posts[1] =
            GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.5 ether, "dear");

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.2 ether, "cheap");
        vm.expectEmit(true, true, true, true);
        emit MessagePosted(1, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.5 ether, "dear");

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        registry.postBatch{ value: 0.7 ether }(posts);

        assertEq(address(registry).balance, 0.7 ether);
    }

    function test_postBatch_revertsOnUnderpay() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](2);
        posts[0] =
            GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.2 ether, "a");
        posts[1] =
            GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.5 ether, "b");

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        // Sum of per-post values (0.7) must equal msg.value — underpay reverts.
        vm.expectRevert(GlobalMessageRegistry.ValueMismatch.selector);
        registry.postBatch{ value: 0.6 ether }(posts);
    }

    function test_postBatch_revertsOnOverpay() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](2);
        posts[0] =
            GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.2 ether, "a");
        posts[1] =
            GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.5 ether, "b");

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        // Overpay is also rejected — no unattributed surplus ETH can land in the registry.
        vm.expectRevert(GlobalMessageRegistry.ValueMismatch.selector);
        registry.postBatch{ value: 0.8 ether }(posts);
    }

    function test_postBatch_revertsWhenValueSentButAllZero() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](1);
        posts[0] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "z");

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        // ETH sent but no post claims any of it — reverts so ETH can't be stranded unattributed.
        vm.expectRevert(GlobalMessageRegistry.ValueMismatch.selector);
        registry.postBatch{ value: 1 }(posts);
    }

    function test_postBatch_mixedZeroAndValued() public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](3);
        posts[0] = GlobalMessageRegistry.PostParams(
            instance, MessageTypes.REPLY, 5, bytes32(0), bytes32(0), 0, "free reply"
        );
        posts[1] = GlobalMessageRegistry.PostParams(
            instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0.3 ether, "paid post"
        );
        posts[2] = GlobalMessageRegistry.PostParams(
            instance, MessageTypes.REACT, 1, bytes32(0), bytes32(0), 0, "free react"
        );

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        registry.postBatch{ value: 0.3 ether }(posts);

        assertEq(registry.messageCount(), 3);
        assertEq(address(registry).balance, 0.3 ether);
    }

    function test_post_valueAccruesAndWithdrawable() public {
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        registry.post{ value: 0.4 ether }(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "paid");

        // owner == address(this); the existing onlyOwner withdrawETH() sweeps the accrued ETH.
        uint256 ownerBefore = address(this).balance;
        registry.withdrawETH();
        assertEq(address(this).balance, ownerBefore + 0.4 ether);
        assertEq(address(registry).balance, 0);
    }

    function testFuzz_post_recordsValue(uint96 v) public {
        vm.deal(user1, v);

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), v, "f");

        vm.prank(user1);
        registry.post{ value: v }(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "f");
        assertEq(address(registry).balance, v);
    }

    function testFuzz_postBatch_sumMustEqualMsgValue(uint96 a, uint96 b) public {
        GlobalMessageRegistry.PostParams[] memory posts = new GlobalMessageRegistry.PostParams[](2);
        posts[0] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), a, "x");
        posts[1] = GlobalMessageRegistry.PostParams(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), b, "y");

        // uint96 operands: sum + 1 cannot overflow uint256, and deal amounts stay realistic.
        uint256 sum = uint256(a) + uint256(b);

        // Exact sum settles.
        vm.deal(user1, sum);
        vm.prank(user1);
        registry.postBatch{ value: sum }(posts);
        assertEq(address(registry).balance, sum);

        // One wei off reverts (re-fund so the revert is ValueMismatch, not insufficient balance).
        vm.deal(user1, sum + 1);
        vm.prank(user1);
        vm.expectRevert(GlobalMessageRegistry.ValueMismatch.selector);
        registry.postBatch{ value: sum + 1 }(posts);
    }

    function test_post_zeroValueStillWorks() public {
        // Display-filter only: posting below the threshold is NOT rejected on-chain.
        registry.setPostThreshold(0.5 ether);

        vm.expectEmit(true, true, true, true);
        emit MessagePosted(0, instance, user1, MessageTypes.POST, 0, bytes32(0), bytes32(0), 0, "free");

        vm.prank(user1);
        registry.post(instance, MessageTypes.POST, 0, bytes32(0), bytes32(0), "free");
        assertEq(registry.messageCount(), 1);
    }

    // ── postThreshold lever ──

    function test_postThreshold_defaultsZero() public view {
        assertEq(registry.postThreshold(), 0);
    }

    function test_setPostThreshold_setsAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit PostThresholdSet(0.42 ether);
        registry.setPostThreshold(0.42 ether);
        assertEq(registry.postThreshold(), 0.42 ether);
    }

    function test_setPostThreshold_revertNonOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        registry.setPostThreshold(1 ether);
    }
}
