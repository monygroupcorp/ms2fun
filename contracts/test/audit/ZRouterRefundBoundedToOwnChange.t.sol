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

/// @dev A Curve-shaped pool that quotes one wei of input for the order and then actually consumes it:
///      `exchange` pulls `dx` off the router with the allowance the router grants it and hands back the
///      output. Consuming the input is the point — it leaves the router's balance exactly where it
///      started, so anything the refund at the bottom of `swapCurve` hands out came from the resting
///      balance and not from this leg.
contract StubCurvePool {
    StubToken internal immutable tokenIn;
    StubToken internal immutable tokenOut;

    constructor(StubToken _tokenIn, StubToken _tokenOut) {
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
    }

    /// @dev One wei in per wei out; the router adds its own `+ 1` rounding buffer on top.
    function get_dx(uint256, uint256, uint256 out_amount) external pure returns (uint256) {
        return out_amount;
    }

    function exchange(uint256, uint256, uint256 dx, uint256) external {
        tokenIn.transferFrom(msg.sender, address(this), dx);
        tokenOut.mint(msg.sender, dx);
    }
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
 *         stubbed. `swapCurve` is exercised below too: its pools arrive as `route` arguments rather than
 *         at an address derived from the pair, so it is the one leg of the three that DOES reach
 *         `_changeOver` — the shared helper — from an offline harness. `swapV3` and `swapV4` reach the
 *         same helper through a pool this suite cannot mint, and are covered by inspection.
 *
 *         That distinction matters, because `swapVZ` does not use `_changeOver` at all: its refund is
 *         `amountLimit - amountIn`, the leg's own arithmetic. Restoring `_changeOver` to the whole-balance
 *         read it replaced leaves every `swapVZ` case here green, so without the `swapCurve` case below
 *         nothing in this tree held that half of the fix.
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

    /// @dev The same, on the ERC-20 side.
    uint256 internal constant RESTING_TOKEN = 1_000 ether;

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

    /// The same walk again, through `swapCurve` — and this is the case that holds `_changeOver`, the
    /// helper `swapV3`, `swapV4` and `swapCurve` share and `swapVZ` does not. Curve pools arrive as
    /// `route` arguments rather than at an address derived from the pair, which is what makes this leg
    /// reachable offline where the other two are not.
    ///
    /// Red against the whole-balance read: the pool consumes every wei the attacker staged, so the
    /// router's token balance is back at its resting 1000 ether by the time the refund is computed, and
    /// a refund of `balanceOf(firstToken)` hands all of it to the caller for the price of a one-wei fill.
    function test_theTokenSweepGuardIsNotWalkedByTheCurveRefund() public {
        StubToken tokenOut = new StubToken();
        StubCurvePool pool = new StubCurvePool(token, tokenOut);

        token.mint(address(router), RESTING_TOKEN);
        // The stub quotes 1:1 and the router adds `+ 1` to every Curve quote — the rounding buffer that
        // makes an exact-out route executable — so a one-wei order costs this caller two.
        token.mint(attacker, 2 wei);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(token), 0, 0, attacker);
        assertEq(token.balanceOf(address(router)), RESTING_TOKEN, "sweep moved nothing, as the fix intends");

        vm.prank(attacker);
        token.approve(address(router), type(uint256).max);

        address[11] memory route;
        route[0] = address(token);
        route[1] = address(pool);
        route[2] = address(tokenOut);

        uint256[4][5] memory swapParams;
        // [i, j, swap_type, pool_type] — a plain crypto-ng `exchange`, the simplest hop the router serves.
        swapParams[0] = [uint256(0), uint256(1), uint256(1), uint256(0)];

        address[5] memory basePools;

        vm.prank(attacker);
        router.swapCurve({
            to: attacker,
            exactOut: true,
            route: route,
            swapParams: swapParams,
            basePools: basePools,
            swapAmount: 1,
            amountLimit: 2 wei,
            deadline: block.timestamp + 1
        });

        assertEq(token.balanceOf(address(router)), RESTING_TOKEN, "the resting token stayed where it was");
        assertEq(token.balanceOf(attacker), 0, "and the caller got none of what sweep refused");
        // The wei they ordered, plus the buffer wei returned as surplus OUTPUT — which is a different
        // refund path from the leftover-INPUT one under test, and is bounded by the leg's own arithmetic.
        assertEq(tokenOut.balanceOf(attacker), 2, "they got the output they paid for, and nothing else");
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
