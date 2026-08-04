// test/factories/erc404/ERC404StakingStreamAndExit.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";

/// @dev Minimal registry: default-registered, individually toggleable (for the F7 de-listing test).
contract MockReg {
    mapping(address => bool) private _unregistered;

    function setRegistered(address a, bool v) external {
        _unregistered[a] = !v;
    }

    function isRegisteredInstance(address a) external view returns (bool) {
        return !_unregistered[a];
    }
}

/**
 * @title ERC404StakingStreamAndExit
 * @notice noesis-098 — F6 (stream rewards, kill the flash-stake sandwich) + F7 (exit paths survive
 *         deregistration) + the load-bearing adversarial invariant (Σ claims ≤ Σ fees, any ordering).
 */
contract ERC404StakingStreamAndExitTest is Test {
    ERC404StakingModule public module;
    MockReg public reg;

    address public instance = address(0xA1);
    address public alice = address(0xB1); // honest staker
    address public bob = address(0xB2); // attacker / late joiner

    function setUp() public {
        reg = new MockReg();
        module = new ERC404StakingModule(address(reg));
        vm.prank(instance);
        module.enableStaking();
    }

    // ── F6: the flash-stake sandwich now yields only a one-block sliver ─────────

    /// @notice Reproduces the spec's concrete sandwich. Pre-fix (instant lump) the attacker extracted
    ///         ~9 of 10 ETH for one block of exposure; with streaming they earn only ~1 block of
    ///         rewardRate, and the honest staker keeps essentially the whole delta.
    function test_F6_flashStakeSandwich_yieldsOnlySliver() public {
        // Honest staker Alice is in for the long haul.
        vm.prank(instance);
        module.recordStake(alice, 100 ether);

        // Attacker Bob front-runs the fee-post with a huge stake (totalStaked 100 -> 1000).
        vm.prank(instance);
        module.recordStake(bob, 900 ether);

        // Owner posts 10 ETH of fees (public mempool tx). Under the OLD lump this set
        // rewardPerToken += 1e16 instantly, handing Bob 900*1e16/1e18 = 9 ETH.
        vm.prank(instance);
        module.recordFeesReceived(10 ether);

        // Bob back-runs one block later (~12s) and unstakes, auto-claiming.
        vm.warp(block.timestamp + 12);
        vm.prank(instance);
        uint256 bobPayout = module.recordUnstake(bob, 900 ether);

        // Bob earns only ~1 block of his share of rewardRate — orders of magnitude below 9 ETH.
        // rewardRate = 10e18 / 7 days; one block ~= rewardRate * 12 * (900/1000) ~= 1.5e14 wei.
        assertLt(bobPayout, 0.01 ether, "attacker limited to a one-block sliver, not ~9 ETH");

        // The committed staker keeps essentially the entire delta once the window elapses.
        vm.warp(block.timestamp + module.rewardsDuration());
        vm.prank(instance);
        uint256 alicePayout = module.computeClaim(alice);
        assertGt(alicePayout, 9.9 ether, "honest staker keeps ~the whole delta");

        // Global safety: nobody over-claimed.
        assertLe(bobPayout + alicePayout, 10 ether, "total claims never exceed the posted fees");
    }

    // ── Streaming correctness ──────────────────────────────────────────────────

    /// @notice A single fee delta with a constant staker set pays out linearly and, after periodFinish,
    ///         the claimable total equals the delta (± truncation dust that stays in the pool).
    function test_streaming_linearThenFullDelta() public {
        vm.prank(instance);
        module.recordStake(alice, 100 ether);
        vm.prank(instance);
        module.recordFeesReceived(10 ether);

        uint256 t0 = block.timestamp;
        assertEq(module.calculatePendingRewards(instance, alice), 0, "nothing at t0");

        // Half the window ~= half the delta.
        vm.warp(t0 + module.rewardsDuration() / 2);
        assertApproxEqAbs(module.calculatePendingRewards(instance, alice), 5 ether, 1e14, "linear at 50%");

        // Full window (and beyond) ~= the full delta, never more.
        vm.warp(t0 + module.rewardsDuration());
        uint256 full = module.calculatePendingRewards(instance, alice);
        assertApproxEqAbs(full, 10 ether, 1e10, "full delta by periodFinish");
        assertLe(full, 10 ether, "never over the delta");

        // No further accrual past periodFinish.
        vm.warp(t0 + module.rewardsDuration() + 30 days);
        assertEq(module.calculatePendingRewards(instance, alice), full, "capped at periodFinish");
    }

    /// @notice A mid-window new staker is checkpointed at the current rate — no retroactive claim on
    ///         accrual that happened before they staked.
    function test_streaming_midWindowStake_noRetroactive() public {
        vm.prank(instance);
        module.recordStake(alice, 100 ether);
        vm.prank(instance);
        module.recordFeesReceived(10 ether);

        // Halfway through, Bob stakes.
        vm.warp(block.timestamp + module.rewardsDuration() / 2);
        vm.prank(instance);
        module.recordStake(bob, 100 ether);

        // Bob has earned nothing yet (no retroactive share of the first half).
        assertEq(module.calculatePendingRewards(instance, bob), 0, "no retroactive accrual for late joiner");

        // Finish the window. Bob shares only the second half's stream (~2.5 ETH of the 10).
        vm.warp(block.timestamp + module.rewardsDuration());
        uint256 bobEarned = module.calculatePendingRewards(instance, bob);
        assertGt(bobEarned, 2 ether, "late joiner shares the post-stake stream");
        assertLt(bobEarned, 3 ether, "but only the second-half portion");

        // Σ still bounded by the delta.
        uint256 aliceEarned = module.calculatePendingRewards(instance, alice);
        assertLe(aliceEarned + bobEarned, 10 ether, "claims never exceed the delta");
    }

    // ── F7: exit paths survive deregistration ──────────────────────────────────

    /// @notice After the registry de-lists the instance, its stakers can still claim + unstake
    ///         (principal + accrued rewards recovered), but NEW stakes and fee-posts are refused.
    function test_F7_exitPathsSurviveDeregistration() public {
        vm.prank(instance);
        module.recordStake(alice, 100 ether);
        vm.prank(instance);
        module.recordFeesReceived(10 ether);
        vm.warp(block.timestamp + module.rewardsDuration());

        // Registry revokes the instance.
        reg.setRegistered(instance, false);

        // Exit paths STILL work: Alice can claim her streamed rewards...
        vm.prank(instance);
        uint256 claimed = module.computeClaim(alice);
        assertApproxEqAbs(claimed, 10 ether, 1e10, "de-listed instance's staker still claims rewards");

        // ...and unstake her principal.
        vm.prank(instance);
        module.recordUnstake(alice, 100 ether);
        assertEq(module.stakedBalance(instance, alice), 0, "principal recovered after de-listing");

        // But the ACCEPTING paths are refused for a revoked instance.
        vm.prank(instance);
        vm.expectRevert(ERC404StakingModule.NotRegisteredInstance.selector);
        module.recordStake(bob, 50 ether);

        vm.prank(instance);
        vm.expectRevert(ERC404StakingModule.NotRegisteredInstance.selector);
        module.recordFeesReceived(5 ether);
    }
}

/// @dev Stateful fuzz handler: drives arbitrary stake/unstake/fee/claim/warp orderings against one
///      instance and tracks ghost totals for the Σ claims ≤ Σ fees invariant.
contract StakingInvariantHandler is Test {
    ERC404StakingModule public module;
    address public instance;
    address[3] public users = [address(0xC1), address(0xC2), address(0xC3)];

    uint256 public totalFeesStreamed; // fees that actually started a stream (totalStaked > 0)
    uint256 public totalClaimed; // ETH the module told the instance to pay out
    uint256 public totalLeakReleased; // un-accruable stream leak the module authorized for recovery (127)

    constructor(ERC404StakingModule _module, address _instance) {
        module = _module;
        instance = _instance;
    }

    function _user(uint256 seed) internal view returns (address) {
        return users[seed % users.length];
    }

    function stake(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1, 1_000_000 ether);
        vm.prank(instance);
        module.recordStake(_user(seed), amount);
    }

    function unstake(uint256 seed, uint256 amount) external {
        address u = _user(seed);
        uint256 bal = module.stakedBalance(instance, u);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(instance);
        uint256 paid = module.recordUnstake(u, amount);
        totalClaimed += paid;
    }

    function postFees(uint256 amount) external {
        amount = bound(amount, 0, 100 ether);
        if (module.totalStaked(instance) > 0) totalFeesStreamed += amount;
        vm.prank(instance);
        module.recordFeesReceived(amount);
    }

    function claim(uint256 seed) external {
        address u = _user(seed);
        if (module.stakedBalance(instance, u) == 0) return;
        try module.computeClaim(u) returns (uint256 paid) {
            totalClaimed += paid;
        } catch { }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 14 days));
    }

    /// @dev Drives the F6 stream-leak release path (127): folds any leak accrued during zero-stake gaps
    ///      and reports the wei the module authorized as recoverable. No external transfer in this
    ///      module-only harness, so `totalLeakReleased` just tracks the authorized amount.
    function releaseLeak() external {
        vm.prank(instance);
        (, uint256 leaked) = module.settleAndReleaseLeak();
        totalLeakReleased += leaked;
    }
}

/// @notice The load-bearing invariant: across any ordering of stakes, unstakes, fee-posts, claims and
///         time skips, the module never authorizes paying out more ETH than was streamed in.
contract ERC404StakingInvariantTest is Test {
    ERC404StakingModule public module;
    MockReg public reg;
    StakingInvariantHandler public handler;
    address public instance = address(0xA1);

    function setUp() public {
        reg = new MockReg();
        module = new ERC404StakingModule(address(reg));
        vm.prank(instance);
        module.enableStaking();

        handler = new StakingInvariantHandler(module, instance);
        targetContract(address(handler));
    }

    function invariant_claimsNeverExceedFees() public view {
        assertLe(handler.totalClaimed(), handler.totalFeesStreamed(), "over-claim: Sum(claims) > Sum(fees)");
        assertLe(
            handler.totalClaimed() + handler.totalLeakReleased(),
            handler.totalFeesStreamed(),
            "over-release: claims + released leak > fees streamed"
        );
    }
}
