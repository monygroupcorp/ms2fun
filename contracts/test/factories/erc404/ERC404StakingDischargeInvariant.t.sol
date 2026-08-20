// test/factories/erc404/ERC404StakingDischargeInvariant.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";

/// @dev Minimal registry surface the module needs. Everything is a registered instance.
contract StubRegistry {
    function isRegisteredInstance(address) external pure returns (bool) {
        return true;
    }
}

/**
 * @title ERC404StakingDischargeInvariant
 * @notice noesis-341 — pins the DIRECTION in which the staking module may err when it discharges the
 *         instance's `stakingReserve`.
 *
 *         The instance credits `stakingReserve += delta` for the whole fee delta it hands the module
 *         (`ERC404BondingOps.claimAllFees`), and `withdrawDust` refuses to sweep anything at or below
 *         `reserve + stakingReserve`. That reserve is discharged by exactly two things:
 *
 *           1. ETH paid to a staker — `recordUnstake` / `computeClaim`, and
 *           2. `settleAndReleaseLeak()`'s `streamLeak`: wei a stream scheduled across an interval in
 *              which `totalStaked == 0`, which no staker can ever accrue.
 *
 *         INVARIANT (asserted below over five scenarios): across any sequence of stakes, unstakes,
 *         claims and fee events, the sum of every payout plus every released leak is <= the sum of
 *         every `delta` passed to `recordFeesReceived` while `totalStaked > 0`.
 *
 *         Under-discharge leaves a rounding residue inside `stakingReserve`, which locks a sliver of
 *         the owner's otherwise-recoverable dust — the safe direction. Over-discharge would drop
 *         `stakingReserve` below the ETH still owed to stakers and let `withdrawDust` sweep staker
 *         money; that is what these tests pin against.
 *
 *         Deliberately NOT asserted: the exact residue, or any claim that it is zero. It is neither,
 *         and asserting it away would encode a source change nobody has ruled on.
 */
contract ERC404StakingDischargeInvariantTest is Test {
    ERC404StakingModule internal module;
    StubRegistry internal registry;

    address internal instance = address(0xA1);
    address internal alice = address(0xB1);
    address internal bob = address(0xB2);
    address internal carol = address(0xB3);

    /// @dev The two sides of the invariant, accumulated by the helpers below.
    uint256 internal owed; // Σ delta recorded while totalStaked > 0
    uint256 internal discharged; // Σ payouts + Σ released leak

    /// @dev Staked amounts are coin base units (18 decimals), i.e. 1e9 ether == 1e9 coin.
    uint256 internal constant STAKE = 1e9 ether;

    /// @dev Explicit clock. `block.timestamp` is transaction-invariant to the optimizer, so reading it
    ///      back between cheatcode calls can fold to a stale value; this tracks the warped time itself.
    uint256 internal constant T0 = 1_000_000;
    uint256 internal clock;

    function setUp() public {
        registry = new StubRegistry();
        module = new ERC404StakingModule(address(registry));
        clock = T0;
        vm.warp(clock);
        vm.prank(instance);
        module.enableStaking();
    }

    function _advance(uint256 dt) internal {
        clock += dt;
        vm.warp(clock);
    }

    function _advanceTo(uint256 t) internal {
        clock = t;
        vm.warp(clock);
    }

    // ── helpers: every module call the instance makes, mirrored into the test's ledger ──────────

    function _stake(address user, uint256 amount) internal {
        vm.prank(instance);
        module.recordStake(user, amount);
    }

    /// @dev Only a delta recorded while something is staked is ever owed: `recordFeesReceived` starts
    ///      no stream at `totalStaked == 0`, and the instance's own credit guard mirrors that.
    function _fee(uint256 delta) internal {
        if (module.totalStaked(instance) > 0) owed += delta;
        vm.prank(instance);
        module.recordFeesReceived(delta);
    }

    function _unstake(address user, uint256 amount) internal returns (uint256 paid) {
        vm.prank(instance);
        paid = module.recordUnstake(user, amount);
        discharged += paid;
    }

    function _claim(address user) internal returns (uint256 paid) {
        vm.prank(instance);
        paid = module.computeClaim(user);
        discharged += paid;
    }

    function _releaseLeak() internal returns (uint256 leaked) {
        vm.prank(instance);
        (, leaked) = module.settleAndReleaseLeak();
        discharged += leaked;
    }

    function _assertNoOverDischarge(string memory ctx) internal view {
        assertLe(discharged, owed, ctx);
    }

    // ── 1. single staker, single window, full exit ──────────────────────────────────────────────

    /// @notice The baseline shape: one staker present for the whole window, one fee event, full exit
    ///         at `periodFinish`. Payout is bounded by the delta and the residue is rounding dust.
    function test_singleStakerFullWindow_dischargeStaysUnderTheDelta() public {
        uint256 delta = 1 ether;

        _stake(alice, STAKE);
        _fee(delta);

        _advance(module.rewardsDuration());
        _unstake(alice, STAKE);
        assertEq(_releaseLeak(), 0, "no zero-stake interval, so no un-accruable wei");

        _assertNoOverDischarge("payout must not exceed the fee delta");

        uint256 residue = owed - discharged;
        emit log_named_uint("residue (wei) left in stakingReserve", residue);
        // A generous ceiling: this pins the residue as rounding dust, not a material share of the fee.
        assertLt(residue, 1e12, "residue must stay rounding dust");
    }

    // ── 2. two stakers, overlapping entry and exit ──────────────────────────────────────────────

    /// @notice Entries and exits interleave so the two `rewardPerTokenPaid` checkpoints diverge, and
    ///         one staker takes an intermediate `computeClaim` before exiting.
    function test_overlappingStakers_dischargeStaysUnderTheDelta() public {
        uint256 delta = 3 ether;

        _stake(alice, STAKE);
        _fee(delta);

        _advance(1 days);
        _stake(bob, STAKE / 2);

        _advance(2 days);
        _claim(alice);
        _assertNoOverDischarge("mid-window claim must not exceed the delta");

        _advance(1 days);
        _unstake(alice, STAKE);

        _advance(4 days); // past periodFinish
        _unstake(bob, STAKE / 2);
        _releaseLeak();

        _assertNoOverDischarge("two-staker payouts must not exceed the delta");
    }

    // ── 3. two fee events inside one window (the leftover fold) ─────────────────────────────────

    /// @notice The second `recordFeesReceived` lands before `periodFinish`, so the unfinished window's
    ///         leftover is folded into the new rate. Neither delta may be paid out twice.
    function test_overlappingFeeWindows_dischargeStaysUnderTheSumOfDeltas() public {
        _stake(alice, STAKE);
        _stake(bob, STAKE);

        _fee(1 ether);
        _advance(2 days);
        _fee(2 ether); // folds the leftover of the first window into the new rate

        _advance(module.rewardsDuration()); // past the repriced periodFinish
        _unstake(alice, STAKE);
        _unstake(bob, STAKE);
        _releaseLeak();

        assertEq(owed, 3 ether, "both deltas landed while something was staked");
        _assertNoOverDischarge("folded windows must not pay out more than the two deltas");
    }

    // ── 4. zero-stake gap mid-window: both discharge paths in one scenario ──────────────────────

    /// @notice Everyone exits mid-window, the stream keeps scheduling into nobody, a fee event lands
    ///         while nothing is staked, and then someone re-stakes. The released leak and the payouts
    ///         are discharged against the same reserve, so this is where a double count would surface.
    function test_zeroStakeGap_leakAndPayoutsShareOneReserve() public {
        _stake(alice, STAKE);
        _fee(4 ether);

        _advance(1 days);
        _unstake(alice, STAKE); // totalStaked -> 0, stream still live

        _advance(2 days);
        _fee(1 ether); // no stream is started at totalStaked == 0, so nothing more is owed
        assertEq(owed, 4 ether, "a delta recorded at zero stake is not owed to anyone");

        uint256 gapLeak = _releaseLeak();
        assertGt(gapLeak, 0, "the zero-stake interval must release un-accruable wei");
        _assertNoOverDischarge("payouts plus the released leak must not exceed the delta");

        // Re-stake into the remainder of the same stream and run it out.
        _stake(bob, 2 * STAKE);
        _advance(2 days);
        _fee(1 ether); // now there is a staker again, so this delta is owed

        _advance(module.rewardsDuration());
        _unstake(bob, 2 * STAKE);
        _releaseLeak();

        assertEq(owed, 5 ether, "only the two deltas recorded at non-zero stake are owed");
        _assertNoOverDischarge("leak plus payouts across the gap must not exceed the deltas");

        // The same wei may not be released twice.
        assertEq(_releaseLeak(), 0, "a settled leak is released exactly once");
        _assertNoOverDischarge("a second settle must not discharge anything further");
    }

    // ── 5. permissionless checkpoint pressure ───────────────────────────────────────────────────

    /// @dev One self-contained window on a fresh module: `pressure` third-party stakes spread across
    ///      the streaming window, each forcing a global `_updateReward`, then a full exit for everyone.
    ///      Returns the residue left in `stakingReserve` (delta minus everything discharged).
    function _runPressuredWindow(uint256 pressure, uint256 delta) internal returns (uint256 residue) {
        StubRegistry reg = new StubRegistry();
        ERC404StakingModule m = new ERC404StakingModule(address(reg));
        clock = T0; // identical clock for every run, so the runs are comparable
        vm.warp(clock);
        vm.prank(instance);
        m.enableStaking();

        vm.prank(instance);
        m.recordStake(alice, STAKE);
        vm.prank(instance);
        m.recordFeesReceived(delta);

        uint256 step = m.rewardsDuration() / (pressure + 1);
        for (uint256 i = 0; i < pressure; ++i) {
            _advance(step);
            vm.prank(instance);
            m.recordStake(carol, 1); // 1 base unit: `stake()` is callable by anyone, every block
        }

        _advanceTo(T0 + m.rewardsDuration());
        vm.prank(instance);
        uint256 paid = m.recordUnstake(alice, STAKE);
        if (pressure > 0) {
            vm.prank(instance);
            paid += m.recordUnstake(carol, pressure);
        }
        vm.prank(instance);
        (, uint256 leaked) = m.settleAndReleaseLeak();

        assertLe(paid + leaked, delta, "pressured window must not over-discharge the reserve");
        residue = delta - paid - leaked;
    }

    /// @notice `ERC404BondingInstance.stake(amount)` is permissionless, so a third party can force a
    ///         global checkpoint every block for the whole window. The invariant holds throughout, and
    ///         the residue those checkpoints add is bounded by one rounding quantum each
    ///         (`totalStaked / 1e18` wei of payout per truncated `rewardPerToken` step) — a bound set by
    ///         the size of the stake, not by the size of the fee.
    function test_checkpointPressure_residueGrowthIsBoundedByTheRoundingQuantum() public {
        uint256 pressure = 3000;

        uint256 quietSmall = _runPressuredWindow(0, 1 ether);
        uint256 pressuredSmall = _runPressuredWindow(pressure, 1 ether);
        uint256 quietLarge = _runPressuredWindow(0, 10 ether);
        uint256 pressuredLarge = _runPressuredWindow(pressure, 10 ether);

        emit log_named_uint("residue, quiet window, 1 ETH fee (wei)", quietSmall);
        emit log_named_uint("residue, pressured window, 1 ETH fee (wei)", pressuredSmall);
        emit log_named_uint("residue, quiet window, 10 ETH fee (wei)", quietLarge);
        emit log_named_uint("residue, pressured window, 10 ETH fee (wei)", pressuredLarge);

        // One truncation of `rewardPerToken` per checkpoint, each worth at most `totalStaked / 1e18`
        // wei of payout, plus a wei of `_earned` truncation per user checkpoint.
        uint256 quantum = (STAKE + pressure) / 1e18 + 1;
        assertLe(pressuredSmall - quietSmall, pressure * quantum, "checkpoint residue: one quantum each");
        // The SAME bound at ten times the fee: what a third party can lock up is set by the stake size,
        // not by the fee it is drawn from.
        assertLe(pressuredLarge - quietLarge, pressure * quantum, "checkpoint residue does not scale with the fee");

        // And in absolute terms the pressured residue stays negligible against the fee it comes from.
        assertLt(pressuredSmall, 1 ether / 1e5, "pressured residue stays negligible");
        assertLt(pressuredLarge, 10 ether / 1e5, "pressured residue stays negligible at a larger fee");
    }
}
