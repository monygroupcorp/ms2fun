// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../src/peripherals/zRouter.sol";

/// @notice Audit finding L-5: `src/peripherals/zRouter.sol`'s fork of the upstream router had
///         dropped the `+ 1` rounding buffer that upstream applies to every Curve backward-pass
///         quote (`lib/zRouter/src/zRouter.sol:488,490,496,498,507,512,516,520`).
///
///         Curve's `get_dx` rounds DOWN, so `exchange(get_dx(out))` yields `out - 1` on any pool
///         whose forward and backward math truncate in the same direction. The fork's forward pass
///         then hits `if (amount < swapAmount) revert Slippage();` and the whole exact-out route
///         reverts. Upstream's `+ 1` is what keeps that from happening.
///
///         The buffer is restored on all eight lines, and this file now asserts the route EXECUTES.
///
///         The mock below is the minimum pool that exhibits the rounding: forward `out = dx*999/1000`,
///         backward `dx = out*1000/999`, both floored — exactly the shape real StableNg pools have.
///         Both directions are *consistent* (the mock is not lying); the one-wei truncation is all
///         that separates the two routers.
contract CurveExactOutRoundingBufferTest is Test {
    zRouter internal router;
    MockToken internal tokenIn;
    MockToken internal tokenOut;
    MockCurveStableNgPool internal pool;

    address internal trader = makeAddr("trader");

    function setUp() public {
        tokenIn = new MockToken();
        tokenOut = new MockToken();
        pool = new MockCurveStableNgPool(address(tokenIn), address(tokenOut));

        ChainConfig memory c;
        c.weth = address(new MockToken()); // only the non-zero requirement matters here
        router = new zRouter(c, address(this));

        tokenOut.mint(address(pool), 1_000_000 ether);
        tokenIn.mint(trader, 1_000_000 ether);

        vm.prank(trader);
        tokenIn.approve(address(router), type(uint256).max);
    }

    /// @dev The exact-out route the fork could not execute. `swapAmount` is the desired OUT amount.
    function test_exactOutCurve_executesWithTheRestoredBuffer() public {
        uint256 want = 1000; // desired tokenOut

        // What the backward pass computes, and what that dx actually buys.
        uint256 dxNoBuffer = pool.get_dx(int128(0), int128(1), want);
        uint256 dxUpstream = dxNoBuffer + 1;
        uint256 producedNoBuffer = pool.previewExchange(dxNoBuffer);
        uint256 producedUpstream = pool.previewExchange(dxUpstream);

        emit log_named_uint("desired out                       ", want);
        emit log_named_uint("get_dx(out)            [no buffer] ", dxNoBuffer);
        emit log_named_uint("  -> exchange() produces           ", producedNoBuffer);
        emit log_named_uint("get_dx(out) + 1        [restored]  ", dxUpstream);
        emit log_named_uint("  -> exchange() produces           ", producedUpstream);

        assertLt(producedNoBuffer, want, "no-buffer dx must under-deliver for this test to mean anything");
        assertGe(producedUpstream, want, "the +1 must clear the target");

        uint256 before = tokenOut.balanceOf(trader);

        vm.prank(trader);
        (uint256 amountIn, uint256 amountOut) = router.swapCurve(
            trader,
            true, // exactOut
            _route(),
            _params(),
            _basePools(),
            want,
            type(uint256).max, // amountLimit: no input cap, so nothing here is a slippage bound
            block.timestamp + 1
        );

        assertEq(amountIn, dxUpstream, "the quote carries the one-wei buffer");
        assertGe(amountOut, want, "the leg delivered at least what was asked for");
        assertEq(tokenOut.balanceOf(trader) - before, amountOut, "and the trader actually received it");
    }

    /// @dev The buffer is one wei per hop and nothing more — it is a rounding repair, not a fee. The
    ///      caller's own `amountLimit` still binds, so a route that really is too expensive still
    ///      reverts `Slippage()` rather than being waved through.
    function test_exactOutCurve_amountLimitStillBinds() public {
        uint256 want = 1000;
        uint256 quoted = pool.get_dx(int128(0), int128(1), want) + 1;

        vm.prank(trader);
        vm.expectRevert(zRouter.Slippage.selector);
        router.swapCurve(trader, true, _route(), _params(), _basePools(), want, quoted - 1, block.timestamp + 1);

        // One wei of room is all it needs.
        vm.prank(trader);
        (uint256 amountIn,) =
            router.swapCurve(trader, true, _route(), _params(), _basePools(), want, quoted, block.timestamp + 1);
        assertEq(amountIn, quoted, "the buffer costs exactly one wei per hop");
    }

    /// @dev Control: the same pool, the same route, EXACT-IN. The forward pass never consults
    ///      `get_dx`, so the exact-in leg is unaffected — isolating the defect to the exact-out
    ///      backward pass.
    function test_exactInCurve_stillWorks() public {
        uint256 amountIn = 1000;

        vm.prank(trader);
        (uint256 ain, uint256 aout) =
            router.swapCurve(trader, false, _route(), _params(), _basePools(), amountIn, 0, block.timestamp + 1);

        emit log_named_uint("exact-in  amountIn ", ain);
        emit log_named_uint("exact-in  amountOut", aout);
        assertEq(ain, amountIn);
        assertEq(aout, pool.previewExchange(amountIn));
    }

    function _route() internal view returns (address[11] memory route) {
        route[0] = address(tokenIn);
        route[1] = address(pool);
        route[2] = address(tokenOut);
    }

    function _params() internal pure returns (uint256[4][5] memory swapParams) {
        swapParams[0] = [uint256(0), uint256(1), uint256(1), uint256(10)];
    }

    function _basePools() internal pure returns (address[5] memory p) { }
}

contract MockToken {
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
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A consistent, floor-rounding StableNg-shaped pool. `get_dx` is the exact inverse of
///      `exchange`, both truncating — which is what every real Curve pool does.
contract MockCurveStableNgPool {
    address public immutable coin0;
    address public immutable coin1;

    constructor(address c0, address c1) {
        coin0 = c0;
        coin1 = c1;
    }

    function previewExchange(uint256 dx) public pure returns (uint256) {
        return (dx * 999) / 1000;
    }

    function get_dx(int128, int128, uint256 outAmount) public pure returns (uint256) {
        return (outAmount * 1000) / 999;
    }

    function exchange(int128, int128, uint256 dx, uint256 minDy) external returns (uint256 dy) {
        MockToken(coin0).transferFrom(msg.sender, address(this), dx);
        dy = previewExchange(dx);
        require(dy >= minDy, "curve: slippage");
        MockToken(coin1).transfer(msg.sender, dy);
    }
}
