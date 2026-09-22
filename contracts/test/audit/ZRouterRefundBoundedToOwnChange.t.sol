// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig, V4PoolKey, V4SwapParams } from "../../src/peripherals/zRouter.sol";

/// @dev WETH9, as much of it as these legs touch. `swapV3`'s callback wraps through `receive()` and
///      then ERC-20-transfers to the pool; `swapCurve` wraps its input, approves the pool, lets the pool
///      pull it, and unwraps whatever the refund hands back. A bare `receive()` was enough while only
///      `swapVZ` was exercised; the legs added below need the token half as well.
contract StubWETH {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{ value: amount }("");
        require(ok, "withdraw");
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

/// @dev A Curve-shaped pool on the ETH side of the route: same 1:1 quote as {StubCurvePool}, but its
///      input is WETH, because `swapCurve` wraps an ETH input before the first hop and the pool pulls
///      the wrapped balance off the router.
contract StubCurveWethPool {
    StubWETH internal immutable tokenIn;
    StubToken internal immutable tokenOut;

    constructor(StubWETH _tokenIn, StubToken _tokenOut) {
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
    }

    function get_dx(uint256, uint256, uint256 out_amount) external pure returns (uint256) {
        return out_amount;
    }

    function exchange(uint256, uint256, uint256 dx, uint256) external {
        tokenIn.transferFrom(msg.sender, address(this), dx);
        tokenOut.mint(msg.sender, dx);
    }
}

/// @dev A v3 pool that fills any exact-out order for one wei and calls the router's callback for it.
///      It holds no state and reads none: it is reached by `vm.etch` at the CREATE2 address the router
///      derives, where a constructor never ran.
contract StubV3Pool {
    function swap(address, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified < 0, "exact-out only");
        int256 out = -amountSpecified;
        int256 owed = 1; // the cheapest honest fill, which is the whole point of the walk being tested
        (amount0, amount1) = zeroForOne ? (owed, -out) : (-out, owed);

        // `uniswapV3SwapCallback` is the router's `fallback()`; it settles the input to this address.
        (bool ok,) = msg.sender
            .call(abi.encodeWithSignature("uniswapV3SwapCallback(int256,int256,bytes)", amount0, amount1, data));
        require(ok, "callback");
        // Delivering the output is not what this proof measures — the ETH refund below the swap is.
    }
}

/// @dev A v4 PoolManager that unlocks, fills any exact-out order for one wei, and accepts the settle.
///      `take` is a no-op for the same reason the v3 stub does not deliver: the leg under test is the
///      ETH refund at the bottom of `unlockCallback`.
contract StubV4Manager {
    function unlock(bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = msg.sender.call(abi.encodeWithSignature("unlockCallback(bytes)", data));
        require(ok, "unlockCallback");
        return abi.decode(ret, (bytes));
    }

    function swap(V4PoolKey memory, V4SwapParams memory params, bytes calldata) external pure returns (int256) {
        require(params.amountSpecified > 0, "exact-out only");
        require(params.zeroForOne, "currency0 in");
        // currency0 (ETH) is owed to the pool, currency1 is paid out: `amount0` negative, `amount1`
        // positive, packed as v4 packs a BalanceDelta.
        int128 amount0 = -1; // one wei, the cheapest honest fill
        int128 amount1 = int128(params.amountSpecified);
        return (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
    }

    function sync(address) external { }

    function settle() external payable returns (uint256) {
        return msg.value;
    }

    function take(address, address, uint256) external { }

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
 *         here. It has two halves, and they are not held by the same cases. `swapVZ` refunds
 *         `amountLimit - amountIn` — the leg's own arithmetic, which cannot reach past what the hop took
 *         in. The other three legs refund `_changeOver(baseline, token)`, the shared helper, at five
 *         sites: one in `swapV3`, one in `swapV4`, and THREE in `swapCurve`, which has an ERC-20 branch
 *         and an ETH branch whose pair of refunds (ETH dust, then WETH dust) are separate reads.
 *
 *         Every one of those six sites is exercised below, by a case that is red with that site alone
 *         restored to the whole-balance read it replaced and green with the fix in place. None of them
 *         needs a fork: the router's venues are chain config, so a v4 PoolManager is a stub the harness
 *         constructs, and a v3 pool is a stub etched at the CREATE2 address the router derives from
 *         bindings this file chooses.
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

    /// @dev Arbitrary v3 bindings: nothing about them has to be Uniswap's, only that the router and this
    ///      test derive the same pool address from them.
    address internal constant V3_FACTORY = address(uint160(0x3FAC));
    bytes32 internal constant V3_POOL_INIT_CODE_HASH = keccak256("stub-v3-pool");
    uint24 internal constant V3_FEE = 3000;

    function setUp() public {
        weth = new StubWETH();
        token = new StubToken();
        zamm = new StubZAMM();

        ChainConfig memory c;
        c.weth = address(weth);
        c.zamm = address(zamm);
        // The v3 and v4 legs are reached the same way their pools are on a real chain: v4 through the
        // PoolManager this deployment is bound to, v3 through the CREATE2 address these two bindings
        // derive. Both are chain config, so an offline harness can choose them — which is what lets the
        // refunds at the bottom of those legs be measured rather than inspected.
        c.v4PoolManager = address(new StubV4Manager());
        c.v3Factory = V3_FACTORY;
        c.v3PoolInitCodeHash = V3_POOL_INIT_CODE_HASH;
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

    /// @dev The CREATE2 address `_v3PoolFor` derives, recomputed here from the same three bindings so
    ///      the stub can be etched where the router will look for it.
    function _v3PoolFor(address tokenA, address tokenB, uint24 fee) internal pure returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff", V3_FACTORY, keccak256(abi.encode(token0, token1, fee)), V3_POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }

    /// `swapV3`'s exact-out ETH refund. The header above records that this leg and `swapV4` reached
    /// `_changeOver` "through a pool this suite cannot mint, and are covered by inspection" — and
    /// inspection is not a test that fails before. Measured: with `_changeOver(restingEth, address(0))`
    /// here put back to the `address(this).balance` it replaced, and the other four refund sites left
    /// alone, every case in this file was green. The pool CAN be minted: its address is CREATE2-derived
    /// from bindings this harness chooses, so the stub goes there by `vm.etch`.
    function test_theEthSweepGuardIsNotWalkedByTheV3Refund() public {
        StubToken tokenOut = new StubToken();
        vm.etch(_v3PoolFor(address(weth), address(tokenOut), V3_FEE), address(new StubV3Pool()).code);

        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 0, attacker);
        assertEq(address(router).balance, RESTING, "sweep moved nothing, as the fix intends");

        vm.prank(attacker);
        router.swapV3{ value: 1 wei }({
            to: attacker,
            exactOut: true,
            swapFee: V3_FEE,
            tokenIn: address(0),
            tokenOut: address(tokenOut),
            swapAmount: 1,
            amountLimit: 1 wei,
            deadline: block.timestamp + 1
        });

        assertEq(address(router).balance, RESTING, "the resting ETH stayed where it was");
        assertEq(attacker.balance, 1 ether - 1 wei, "and the caller got none of what sweep refused");
    }

    /// `swapV4`'s exact-out ETH refund, which is made inside `unlockCallback` where `msg.value` is zero
    /// — which is why the baseline is taken in `swapV4` and carried across in the callback data. Same
    /// measurement as the v3 case above: the whole-balance read put back left this file green without
    /// this case.
    function test_theEthSweepGuardIsNotWalkedByTheV4Refund() public {
        StubToken tokenOut = new StubToken();

        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 0, attacker);
        assertEq(address(router).balance, RESTING, "sweep moved nothing, as the fix intends");

        vm.prank(attacker);
        router.swapV4{ value: 1 wei }({
            to: attacker,
            exactOut: true,
            swapFee: 3000,
            tickSpace: 60,
            tokenIn: address(0),
            tokenOut: address(tokenOut),
            swapAmount: 1,
            amountLimit: 1 wei,
            deadline: block.timestamp + 1
        });

        assertEq(address(router).balance, RESTING, "the resting ETH stayed where it was");
        assertEq(attacker.balance, 1 ether - 1 wei, "and the caller got none of what sweep refused");
    }

    /// `swapCurve` has THREE leftover-input refunds, not one. The case above measures the ERC-20 branch;
    /// these two measure the ETH branch's pair. Restoring either of them to its whole-balance read left
    /// every other case in this file green, so neither was held by anything.
    ///
    /// This one is the ETH dust refund: `e` was `address(this).balance`.
    function test_theEthSweepGuardIsNotWalkedByTheCurveRefund() public {
        (address[11] memory route, uint256[4][5] memory swapParams) = _ethCurveRoute(new StubToken());
        address[5] memory basePools;

        vm.deal(address(router), RESTING);
        vm.deal(attacker, 1 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(0), 0, 0, attacker);
        assertEq(address(router).balance, RESTING, "sweep moved nothing, as the fix intends");

        // The stub quotes 1:1 and the router adds its `+ 1` rounding buffer, so a one-wei order wraps two.
        vm.prank(attacker);
        router.swapCurve{ value: 2 wei }({
            to: attacker,
            exactOut: true,
            route: route,
            swapParams: swapParams,
            basePools: basePools,
            swapAmount: 1,
            amountLimit: 2 wei,
            deadline: block.timestamp + 1
        });

        assertEq(address(router).balance, RESTING, "the resting ETH stayed where it was");
        assertEq(attacker.balance, 1 ether - 2 wei, "and the caller got none of what sweep refused");
    }

    /// The other half of the same branch: the WETH dust refund, `w`, which was `balanceOf(WETH)` — the
    /// router's whole resting WETH, unwrapped and paid out to whoever ran the leg. `sweep` refuses that
    /// balance one line earlier, so this is the same walk on the wrapped side.
    function test_theWethSweepGuardIsNotWalkedByTheCurveRefund() public {
        (address[11] memory route, uint256[4][5] memory swapParams) = _ethCurveRoute(new StubToken());
        address[5] memory basePools;

        // A resting WETH balance, backed by the ETH the stub took in for it.
        vm.deal(address(this), RESTING);
        weth.deposit{ value: RESTING }();
        weth.transfer(address(router), RESTING);

        vm.deal(attacker, 1 ether);

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.sweep(address(weth), 0, 0, attacker);
        assertEq(weth.balanceOf(address(router)), RESTING, "sweep moved nothing, as the fix intends");

        vm.prank(attacker);
        router.swapCurve{ value: 2 wei }({
            to: attacker,
            exactOut: true,
            route: route,
            swapParams: swapParams,
            basePools: basePools,
            swapAmount: 1,
            amountLimit: 2 wei,
            deadline: block.timestamp + 1
        });

        assertEq(weth.balanceOf(address(router)), RESTING, "the resting WETH stayed where it was");
        assertEq(attacker.balance, 1 ether - 2 wei, "and the caller got none of what sweep refused");
    }

    /// @dev An ETH-in, one-hop Curve route through a pool that really consumes its input, so anything
    ///      the leftover-input refund hands back came from the resting balance.
    function _ethCurveRoute(StubToken tokenOut)
        internal
        returns (address[11] memory route, uint256[4][5] memory swapParams)
    {
        StubCurveWethPool pool = new StubCurveWethPool(weth, tokenOut);
        route[0] = address(0); // ETH in: `swapCurve` wraps it before the first hop
        route[1] = address(pool);
        route[2] = address(tokenOut);
        // [i, j, swap_type, pool_type] — a plain crypto-ng `exchange`, as in the ERC-20 case above.
        swapParams[0] = [uint256(0), uint256(1), uint256(1), uint256(0)];
    }
}
