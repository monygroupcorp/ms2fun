// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../src/peripherals/zRouter.sol";

contract StubWETH {
    receive() external payable { }
}

/// @dev Minimal ERC-20: enough for a balance to rest in the router and leave it again.
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

/// @dev A zAMM that fills any exact-output order for `COST` and hands the unspent input straight back,
///      which is what makes the router's own refund leg reachable and worth measuring. The venue is not
///      what is under test — the refund at the end of `swapVZ` is — so the cheapest honest fill will do.
contract StubZAMM {
    uint256 internal constant COST = 1 wei;

    fallback() external payable {
        if (msg.value > COST) {
            (bool ok,) = msg.sender.call{ value: msg.value - COST }("");
            require(ok, "refund");
        }
        uint256 spent = COST;
        assembly {
            mstore(0x00, spent)
            return(0x00, 0x20)
        }
    }

    receive() external payable { }
}

/**
 * @title ZRouterRefundBoundedToOwnChange
 * @notice Audit L-9, second pass. The fix authenticated the four hatches the report named — `sweep`,
 *         `execute`, `snwap`'s zero-`amountIn` branch and `revealName` — so that a caller may move only
 *         what THIS transaction credited to the router, and the owner may move anything.
 *
 *         Four swap legs end in a refund of the same shape the fix closed, and the fix did not reach
 *         them: `swapV3:252`, `swapV4:398`, `swapVZ:495-503` and `swapCurve:741` each read the router's
 *         WHOLE resting balance — `address(this).balance`, `balanceOf(tokenIn)` — and send it to
 *         `msg.sender`, for anybody. `swapV2:180` is the counter-example that shows this is a slip and
 *         not a policy: its refund is `msg.value - amountIn`, bounded by the caller's own input.
 *
 *         So the guard on `sweep` was walkable. An attacker refused by `sweep` ran the cheapest exact-out
 *         swap they could construct and was handed the same balance as a "refund" — a swap leg is not a
 *         donation-recovery path, and nothing about paying for a one-wei fill makes the resting balance
 *         theirs.
 *
 *         The fix measures every one of those refunds against a baseline taken before the leg touches
 *         anything, so what goes back is this transaction's change and not the balance that was already
 *         here. `swapVZ` is the leg exercised below because its venue is a plain external call and can be
 *         stubbed; the other three reach the same helper through a pool this offline harness cannot mint.
 *
 *         Each test below is red against the previous revision, where the refund read the whole balance.
 */
contract ZRouterRefundBoundedToOwnChangeTest is Test {
    StubWETH internal weth;
    StubToken internal token;
    StubZAMM internal zamm;
    zRouter internal router;

    address internal owner = address(uint160(0x0FF1CE));
    address internal attacker = address(uint160(0xBAD1));

    /// @dev What a donation, a rebase or a leg's dust leaves behind — the balance the hatches reach.
    uint256 internal constant RESTING = 5 ether;

    function setUp() public {
        weth = new StubWETH();
        token = new StubToken();
        zamm = new StubZAMM();

        ChainConfig memory c;
        c.weth = address(weth);
        c.zamm = address(zamm);
        router = new zRouter(c, owner);
    }

    /// THE FINDING. `sweep` refuses the attacker the router's resting ETH, and the refund at the end of
    /// `swapVZ` must refuse it too — otherwise the guard is bought for the price of a one-wei fill.
    function test_theEthSweepGuardIsNotWalkedByTheExactOutRefund() public {
        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        // The door the fix closed.
        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 0, attacker);
        assertEq(address(router).balance, RESTING, "sweep moved nothing, as the fix intends");

        // The door beside it, which used to be open.
        vm.prank(attacker);
        router.swapVZ{ value: 1 wei }({
            to: attacker,
            exactOut: true,
            feeOrHook: 30,
            tokenIn: address(0),
            tokenOut: address(token),
            idIn: 0,
            idOut: 0,
            swapAmount: 1,
            amountLimit: 1 wei,
            deadline: block.timestamp + 1
        });

        assertEq(address(router).balance, RESTING, "the resting ETH stayed where it was");
        // Their one wei bought the fill; the resting balance was never theirs to be given back.
        assertEq(attacker.balance, 1 ether - 1 wei, "and the caller got none of what sweep refused");
    }

    /// The same walk on the ERC-20 branch: `refund = balanceOf(tokenIn)` was the router's whole resting
    /// token balance, which is verbatim what `sweep(token, ...)` refuses one line earlier.
    function test_theTokenSweepGuardIsNotWalkedByTheExactOutRefund() public {
        token.mint(address(router), 1_000 ether);
        token.mint(attacker, 1 wei);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(token), 0, 0, attacker);
        assertEq(token.balanceOf(address(router)), 1_000 ether, "sweep moved nothing, as the fix intends");

        vm.prank(attacker);
        token.approve(address(router), type(uint256).max);

        vm.prank(attacker);
        router.swapVZ({
            to: attacker,
            exactOut: true,
            feeOrHook: 30,
            tokenIn: address(token),
            tokenOut: address(weth),
            idIn: 0,
            idOut: 0,
            swapAmount: 1,
            amountLimit: 1 wei,
            deadline: block.timestamp + 1
        });

        // The resting 1000 ether never moved. The extra wei is the attacker's OWN input, staged into the
        // router and reported as consumed by a stub venue that does not trouble to collect it — an
        // artifact of the harness, and the side of the ledger that costs the attacker rather than pays.
        assertEq(token.balanceOf(address(router)), 1_000 ether + 1 wei, "the resting token stayed put");
        assertEq(token.balanceOf(attacker), 0, "and the caller got none of what sweep refused");
    }

    /// Non-vacuity, and the shape the refund is FOR: a caller who overpays their own exact-out swap
    /// must still get their own change back. This is what any fix has to keep working.
    function test_theCallersOwnChangeIsStillRefunded() public {
        vm.deal(attacker, 1 ether);

        vm.prank(attacker);
        router.swapVZ{ value: 1 ether }({
            to: attacker,
            exactOut: true,
            feeOrHook: 30,
            tokenIn: address(0),
            tokenOut: address(token),
            idIn: 0,
            idOut: 0,
            swapAmount: 1,
            amountLimit: 1 ether,
            deadline: block.timestamp + 1
        });

        assertEq(attacker.balance, 1 ether - 1 wei, "the caller's unspent input came back to them");
    }

    /// `multicall` reaches the legs by `delegatecall`, so every sub-call sees the ORIGINAL `msg.value`
    /// and a refund that re-derived its baseline per hop would read the same wei as unspent on each of
    /// them. The guard has to hold through the chained shape too, which is the one an attacker would
    /// reach for once the direct call is closed.
    function test_theGuardHoldsThroughAMulticall() public {
        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(
            zRouter.swapVZ, (attacker, true, 30, address(0), address(token), 0, 0, 1, 1 wei, block.timestamp + 1)
        );

        vm.prank(attacker);
        router.multicall{ value: 1 wei }(calls);

        assertEq(address(router).balance, RESTING, "the resting ETH stayed where it was");
        assertEq(attacker.balance, 1 ether - 1 wei, "and the chained caller got none of it either");
    }

    /// The chained shape's legitimate half: change still comes back when the caller really did overpay.
    function test_theCallersOwnChangeIsStillRefundedThroughAMulticall() public {
        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(
            zRouter.swapVZ, (attacker, true, 30, address(0), address(token), 0, 0, 1, 1 ether, block.timestamp + 1)
        );

        vm.prank(attacker);
        router.multicall{ value: 1 ether }(calls);

        assertEq(attacker.balance, 1 ether - 1 wei, "the caller's unspent input came back to them");
        assertEq(address(router).balance, RESTING, "and the resting balance is still untouched");
    }
}
