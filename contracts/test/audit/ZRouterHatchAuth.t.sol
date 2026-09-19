// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../src/peripherals/zRouter.sol";

/// @dev WETH is reached through a raw value call with empty calldata, so accepting the transfer is the
///      whole of what this stub owes the constructor.
contract StubWETH {
    receive() external payable { }
}

/// @dev A NameNFT that takes the reveal's ETH and hands back a token id, so `revealName` moving the
///      router's balance is observable as this contract's balance.
contract StubNameNFT {
    uint256 public revealed;

    function reveal(string calldata, bytes32) external payable returns (uint256) {
        revealed += msg.value;
        return 1;
    }

    function transferFrom(address, address, uint256) external { }
}

/// @dev Minimal ERC-20: enough for a balance to rest in the router and be swept out of it.
contract StubToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A target worth trusting, so `execute` can be measured on an OPEN map rather than a closed one.
contract StubTarget {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}

/**
 * @title ZRouterHatchAuth
 * @notice Audit L-6..L-9 pass, finding L-9: `zRouter`'s value-moving hatches were unauthenticated —
 *         `sweep`, `execute`, `snwap`/`snwapMulti`'s zero-`amountIn` branch, and `revealName`. Each moves
 *         the ROUTER's own balance to a destination the caller picks, and each would do it for anybody.
 *
 *         The audit files this as Low because there is nothing resting in the router to take: every leg
 *         ships its output to `to` in the same transaction, balances are transient-tracked, and no
 *         protocol contract holds a standing approval against it. That is a fact about what happens to
 *         be lying there, not a guard — a donation, a rebase, a leg that leaves dust, or a future caller
 *         who stages funds across a multicall all put something in reach.
 *
 *         The guard is the router's own model of whose money is here: a caller may move what THIS
 *         transaction credited to the router, and the owner may move anything, so a stray balance stays
 *         recoverable. `execute` takes `onlyOwner` instead — it is an arbitrary call, not a balance, and
 *         no credit describes it.
 *
 *         Each test below is red against the previous revision, where every one of these calls went
 *         through and the attacker kept the proceeds.
 */
contract ZRouterHatchAuthTest is Test {
    StubWETH internal weth;
    StubNameNFT internal nameNft;
    StubToken internal token;
    zRouter internal router;

    address internal owner = address(uint160(0x0FF1CE));
    address internal attacker = address(uint160(0xBAD1));

    /// @dev What a donation, a rebase or a leg's dust leaves behind — the balance the hatches reach.
    uint256 internal constant RESTING = 5 ether;

    function setUp() public {
        weth = new StubWETH();
        nameNft = new StubNameNFT();
        token = new StubToken();

        ChainConfig memory c;
        c.weth = address(weth);
        c.nameNft = address(nameNft);
        router = new zRouter(c, owner);
    }

    // ── sweep ────────────────────────────────────────────────────────────────────────────────────

    /// THE FINDING, in its plainest form: the router's resting ETH, to an address the caller names.
    function test_sweepOfTheRoutersRestingEthIsRefused() public {
        vm.deal(address(router), RESTING);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 0, attacker);

        assertEq(address(router).balance, RESTING, "the resting balance did not move");
        assertEq(attacker.balance, 0, "and the caller got none of it");
    }

    /// The same for an ERC-20 resting in the router.
    function test_sweepOfARestingTokenIsRefused() public {
        token.mint(address(router), 1_000 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(token), 0, 0, attacker);

        assertEq(token.balanceOf(address(router)), 1_000 ether, "the resting token did not move");
    }

    /// Naming the amount rather than passing 0 is the same call; the guard is on the balance, not on
    /// the shorthand that resolves it.
    function test_sweepOfANamedAmountIsRefusedToo() public {
        vm.deal(address(router), RESTING);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 1 wei, attacker);
    }

    /// The recovery path the owner branch exists for: a balance no credit describes still has an exit,
    /// which is why the guard is "owner or own credit" rather than credit alone.
    function test_theOwnerCanStillRecoverAStrayBalance() public {
        vm.deal(address(router), RESTING);

        vm.prank(owner);
        router.sweep(address(0), 0, 0, owner);

        assertEq(owner.balance, RESTING, "the owner recovered the stray balance");
        assertEq(address(router).balance, 0, "and the router holds nothing");
    }

    /// The legitimate caller-facing shape is untouched: deposit into the router and sweep it back out
    /// in the SAME transaction, which is exactly what the transient credit describes. The attacker's
    /// own ETH, not the router's — and the router's resting balance is still there afterwards.
    function test_aDepositorCanStillSweepWhatThisTransactionPutIn() public {
        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 1 ether));
        calls[1] = abi.encodeCall(zRouter.sweep, (address(0), 0, 1 ether, attacker));

        vm.prank(attacker);
        router.multicall{ value: 1 ether }(calls);

        assertEq(attacker.balance, 1 ether, "the depositor got their own ETH back");
        assertEq(address(router).balance, RESTING, "and reached none of the resting balance");
    }

    /// Non-vacuity of the credit: one wei more than this transaction deposited is one wei of somebody
    /// else's, and the guard is what tells them apart.
    function test_aDepositorCannotSweepOneWeiMoreThanTheyPutIn() public {
        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 1 ether));
        calls[1] = abi.encodeCall(zRouter.sweep, (address(0), 0, 1 ether + 1, attacker));

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.multicall{ value: 1 ether }(calls);
    }

    // ── execute ──────────────────────────────────────────────────────────────────────────────────

    /// `execute` was gated on the trusted-target map alone, and `trust()` is called nowhere in this
    /// repository — so the surface is inert as deployed and the finding is about what ONE `trust()`
    /// call would open. Measured against an open map, which is the state that matters.
    function test_executeOnATrustedTargetIsRefusedToANonOwner() public {
        StubTarget target = new StubTarget();
        vm.deal(address(router), RESTING);

        vm.prank(owner);
        router.trust(address(target), true);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.execute(address(target), RESTING, "");

        assertEq(target.received(), 0, "the router's ETH stayed with the router");
    }

    /// And the owner's own use of a trusted target is unchanged: the fix narrows who, not what.
    function test_theOwnerCanStillExecuteATrustedTarget() public {
        StubTarget target = new StubTarget();
        vm.deal(address(router), RESTING);

        vm.startPrank(owner);
        router.trust(address(target), true);
        router.execute(address(target), RESTING, "");
        vm.stopPrank();

        assertEq(target.received(), RESTING, "the owner's call went through");
    }

    /// An untrusted target is still refused for the owner too — the trusted-target map is kept, not
    /// replaced.
    function test_anUntrustedTargetIsStillRefusedToTheOwner() public {
        StubTarget target = new StubTarget();

        vm.prank(owner);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.execute(address(target), 0, "");
    }

    // ── snwap ────────────────────────────────────────────────────────────────────────────────────

    /// `amountIn == 0` means "send the executor what is already here" — the router's balance, to an
    /// executor the caller supplies. The same hatch as `sweep`, with a different destination.
    function test_snwapCannotForwardTheRoutersRestingToken() public {
        token.mint(address(router), 1_000 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.snwap(address(token), 0, attacker, address(0), 0, attacker, "");

        assertEq(token.balanceOf(address(router)), 1_000 ether, "the resting token stayed put");
        assertEq(token.balanceOf(attacker), 0, "and the executor received nothing");
    }

    /// The pull-from-sender branch needs no guard and does not get one: it moves the caller's own
    /// tokens under the caller's own allowance. Pinned so the guard is not read as closing snwap.
    function test_snwapStillPullsTheCallersOwnTokens() public {
        token.mint(attacker, 10 ether);

        address executor = address(uint160(0xE0E0));

        vm.startPrank(attacker);
        token.approve(address(router), type(uint256).max);
        router.snwap(address(token), 10 ether, attacker, address(0), 0, executor, "");
        vm.stopPrank();

        assertEq(token.balanceOf(executor), 10 ether, "the caller's own tokens reached the executor");
    }

    // ── revealName ───────────────────────────────────────────────────────────────────────────────

    /// The reveal spent `address(this).balance` and threw away the credit check it had already made,
    /// so the router's ETH bought a name for whoever asked and landed it on their `to`.
    function test_revealNameCannotSpendTheRoutersRestingEth() public {
        vm.deal(address(router), RESTING);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.revealName("name", bytes32(uint256(1)), attacker);

        assertEq(nameNft.revealed(), 0, "no ETH reached the registrar");
        assertEq(address(router).balance, RESTING, "and the router still holds its balance");
    }

    /// The documented shape — deposit (or swap) into the router and reveal with the proceeds in the
    /// same transaction — still works, because that is precisely what the credit describes.
    function test_revealNameStillSpendsWhatThisTransactionPutIn() public {
        vm.deal(attacker, 1 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 1 ether));
        calls[1] = abi.encodeCall(zRouter.revealName, ("name", bytes32(uint256(1)), attacker));

        vm.prank(attacker);
        router.multicall{ value: 1 ether }(calls);

        assertEq(nameNft.revealed(), 1 ether, "the depositor's own ETH bought the name");
    }
}
