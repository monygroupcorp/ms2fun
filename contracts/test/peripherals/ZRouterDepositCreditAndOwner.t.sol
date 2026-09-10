// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig } from "../../src/peripherals/zRouter.sol";

/// @dev Accepts the venue call `swapVZ` makes and reports a fixed output, so the ETH leg of the swap
///      is observable as this stub's balance.
contract StubZAMM {
    uint256 public constant OUT = 1;

    fallback() external payable {
        assembly ("memory-safe") {
            mstore(0x00, 1)
            return(0x00, 0x20)
        }
    }

    receive() external payable { }
}

/// @dev WETH is wrapped through a raw value call with empty calldata, so a stub only needs to accept
///      the transfer for the wrap leg to be observable.
contract StubWETH {
    receive() external payable { }
}

/// @notice Two vendored-periphery defects in `zRouter`, pinned:
///
///         1. `deposit` credited native ETH that was never paid. `deposit(address(0), 0, amount)` with
///            `msg.value == 0` fell through both of the function's branches — the first is gated on
///            `msg.value != 0`, the second on `token != address(0)` — and still reached the
///            unconditional `depositFor`, tstoring an `amount` ETH credit out of nothing. The credit is
///            spendable in the same transaction: `swapVZ` consumes it through `_useTransientBalance`
///            and, finding it satisfied, pulls nothing in and forwards the router's OWN ETH to the
///            venue. The fix makes the native path require payment the way the WETH path already did.
///
///         2. The constructor took its owner from `tx.origin`. Ownership is now an explicit
///            constructor argument, so it no longer depends on which EOA broadcast the deploy.
contract ZRouterDepositCreditAndOwnerTest is Test {
    StubWETH internal weth;
    StubZAMM internal zamm;
    zRouter internal router;

    address internal attacker = address(uint160(0xBAD1));
    address internal owner = address(uint160(0x0FF1CE));

    function setUp() public {
        weth = new StubWETH();
        zamm = new StubZAMM();

        ChainConfig memory c;
        c.weth = address(weth);
        c.zamm = address(zamm);
        router = new zRouter(c, address(this));
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1;
    }

    // ── 1. A zero-value native deposit no longer mints a credit ───────────────────────────────

    function test_zeroValueNativeDeposit_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(zRouter.InvalidMsgVal.selector);
        router.deposit(address(0), 0, 1 ether);
    }

    /// @dev An underpaid native deposit is the same defect with a smaller number, so it is pinned too.
    function test_underpaidNativeDeposit_reverts() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(zRouter.InvalidMsgVal.selector);
        router.deposit{ value: 1 wei }(address(0), 0, 1 ether);
    }

    /// @dev The zero-amount native call stays legal and credits nothing — the multicall no-op shapes
    ///      rely on it, so the guard must not widen into them.
    function test_zeroAmountNativeDeposit_staysLegal() public {
        vm.prank(attacker);
        router.deposit(address(0), 0, 0);
    }

    // ── 2. The proof-of-concept: the unpaid credit no longer spends the router's balance ──────

    function test_unpaidCreditCannotSpendTheRoutersOwnBalance() public {
        vm.deal(address(router), 5 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 5 ether));
        calls[1] = abi.encodeCall(
            zRouter.swapVZ, (attacker, false, 30, address(0), address(weth), 0, 0, 5 ether, 0, _deadline())
        );

        assertEq(attacker.balance, 0, "the attacker must pay nothing for the sequence to be the PoC");

        vm.prank(attacker);
        vm.expectRevert(zRouter.InvalidMsgVal.selector);
        router.multicall(calls);

        assertEq(address(router).balance, 5 ether, "the router's own ETH must be untouched");
        assertEq(address(zamm).balance, 0, "and none of it may reach the venue");
    }

    /// @dev Non-vacuity for the test above: the identical sequence, PAID for, still reaches the venue
    ///      and still spends only what the caller sent. Without this the revert above could be an
    ///      artefact of the call shape rather than of the payment requirement.
    function test_paidNativeDepositStillFundsTheSwap() public {
        vm.deal(address(router), 5 ether);
        vm.deal(attacker, 3 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(zRouter.deposit, (address(0), 0, 3 ether));
        calls[1] = abi.encodeCall(
            zRouter.swapVZ, (attacker, false, 30, address(0), address(weth), 0, 0, 3 ether, 0, _deadline())
        );

        vm.prank(attacker);
        router.multicall{ value: 3 ether }(calls);

        assertEq(address(zamm).balance, 3 ether, "the paid credit must fund the swap leg");
        assertEq(address(router).balance, 5 ether, "and must not draw on the router's own balance");
        assertEq(attacker.balance, 0, "the caller pays for exactly what it spends");
    }

    // ── 3. The honest deposit paths are unchanged ─────────────────────────────────────────────

    function test_paidNativeDeposit_credits() public {
        vm.deal(attacker, 2 ether);
        vm.prank(attacker);
        router.deposit{ value: 2 ether }(address(0), 0, 2 ether);
        assertEq(address(router).balance, 2 ether, "the router holds what it was paid");
    }

    function test_wethDeposit_stillWraps() public {
        vm.deal(attacker, 2 ether);
        vm.prank(attacker);
        router.deposit{ value: 2 ether }(address(weth), 0, 2 ether);
        assertEq(address(weth).balance, 2 ether, "the WETH path must still wrap");
        assertEq(address(router).balance, 0, "and must not retain the stake");
    }

    // ── 4. Ownership comes from the constructor argument, not from tx.origin ──────────────────

    function test_constructorOwnerIsTheSuppliedArgument() public {
        // Deploy with an origin that is deliberately NOT the intended owner: under the old
        // `tx.origin` capture this router would have been owned by `attacker`.
        vm.prank(attacker, attacker);
        ChainConfig memory c;
        c.weth = address(weth);
        zRouter r = new zRouter(c, owner);

        vm.prank(owner);
        r.trust(address(zamm), true); // onlyOwner — succeeds for the supplied owner

        vm.prank(attacker, attacker);
        vm.expectRevert(zRouter.Unauthorized.selector);
        r.trust(address(zamm), true); // and not for the deploying origin
    }

    function test_constructorRejectsZeroOwner() public {
        ChainConfig memory c;
        c.weth = address(weth);
        vm.expectRevert(zRouter.Unauthorized.selector);
        new zRouter(c, address(0));
    }
}
