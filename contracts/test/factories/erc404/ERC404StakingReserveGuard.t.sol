// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
// noesis-148: `withdrawDust` and `claimFreeMint` now run in ERC404BondingOps behind discard-returndata
// trampolines, so their specific reverts (NothingToWithdraw / BondingEnded) reach the caller as the
// generic per-entry-point errors. The guards themselves are unchanged and still fire.
import {
    WithdrawDustFailed,
    FreeMintFailed,
    StakeFailed,
    UnstakeFailed,
    ClaimRewardsFailed
} from "../../../src/factories/erc404/ERC404BondingStorage.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
import { IGatingModule, GatingScope } from "../../../src/gating/IGatingModule.sol";
import { IERC404StakingModule } from "../../../src/interfaces/IERC404StakingModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

// ── Mocks ───────────────────────────────────────────────────────────────────

/// @dev A vault that, on claimFees(), pushes its whole ETH balance to the caller (the instance) —
///      exactly how real fee delivery lands staking-reward ETH in the instance balance.
contract MockFeeVault {
    function claimFees() external returns (uint256 ethClaimed) {
        ethClaimed = address(this).balance;
        if (ethClaimed > 0) {
            (bool ok,) = msg.sender.call{ value: ethClaimed }("");
            require(ok, "fee push failed");
        }
    }

    receive() external payable { }
}

contract MockDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/// @dev A vault whose `claimFees()` always reverts — the AlignmentEndowmentVault shape (no pull-claim
///      model). `claimAllFees` wraps each vault call in `try/catch` precisely so one of these cannot
///      brick fee delivery for the whole instance (noesis-148 kept that try/catch verbatim).
contract MockRevertingFeeVault {
    error NotSupported();

    function claimFees() external pure returns (uint256) {
        revert NotSupported();
    }

    receive() external payable { }
}

/// @dev THE reentrancy probe (noesis-148). Every probe below re-enters the instance through the SAME
///      neutral target — `claimStakingRewards()` with a zero pending reward, which is a guarded but
///      otherwise side-effect-free call (`SmartTransferLib.smartTransferETH` returns early on 0). That
///      makes each probe an exact A/B: the identical call SUCCEEDS outside a guarded window and MUST
///      FAIL inside one. The only thing that differs is whether the reentrancy guard is held — and the
///      guard now lives on the far side of a `delegatecall`, which is the single most load-bearing new
///      assumption this item makes.
///      The probe uses a RAW call and records the outcome rather than bubbling: `claimAllFees` catches
///      vault reverts by design, so a bubbling revert would be swallowed and prove nothing.
library ReentrancyProbe {
    function fire(address payable instance) internal returns (bool ok) {
        (ok,) = instance.call(abi.encodeWithSelector(ERC404BondingInstance.claimStakingRewards.selector));
    }
}

/// @dev A staking module that fires the probe from whichever hook is armed, proving the Ops-side
///      `nonReentrant` still engages for `stake` / `unstake` / `claimStakingRewards` through the
///      trampoline. Pays zero rewards, so it perturbs no accounting.
contract ReentrantStakingModule is IERC404StakingModule {
    enum Hook {
        NONE,
        STAKE,
        UNSTAKE,
        CLAIM
    }

    Hook public armed;
    address payable public instance;
    bool public probeRan;
    bool public probeOk;

    function setInstance(address payable inst) external {
        instance = inst;
    }

    function arm(Hook h) external {
        armed = h;
        probeRan = false;
        probeOk = false;
    }

    /// @dev Fires at most once: if the guard ever FAILED to engage, self-recursion would otherwise run
    ///      until out-of-gas instead of producing a legible assertion.
    function _probe() private {
        if (probeRan) return;
        probeRan = true;
        probeOk = ReentrancyProbe.fire(instance);
    }

    function enableStaking() external { }
    function recordFeesReceived(uint256) external { }

    function recordStake(address, uint256) external {
        if (armed == Hook.STAKE) _probe();
    }

    function recordUnstake(address, uint256) external returns (uint256) {
        if (armed == Hook.UNSTAKE) _probe();
        return 0;
    }

    function computeClaim(address) external returns (uint256) {
        if (armed == Hook.CLAIM) _probe();
        return 0;
    }

    /// @dev `claimAllFees` reaches this through the `IStakingTotals` interface.
    function settleAndReleaseLeak() external pure returns (uint256, uint256) {
        return (0, 0);
    }
}

/// @dev A gating module that fires the probe from `canMint` — `claimFreeMint`'s reentrancy surface.
contract ReentrantGatingModule is IGatingModule {
    address payable public instance;
    bool public armed;
    bool public probeRan;
    bool public probeOk;

    function setInstance(address payable inst) external {
        instance = inst;
    }

    function arm(bool a) external {
        armed = a;
        probeRan = false;
        probeOk = false;
    }

    function canMint(address, uint256, uint256, uint256, bytes calldata) external returns (bool, bool) {
        if (armed && !probeRan) {
            probeRan = true;
            probeOk = ReentrancyProbe.fire(instance);
        }
        return (true, false);
    }

    function onMint(address, uint256, uint256) external { }

    function metadataURI() external pure returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external { }
}

/// @dev An instance owner that fires the probe from `receive()` — the ETH payout is the only
///      reentrancy surface `withdrawDust` has, and it hands control to the owner by construction.
contract ReentrantOwner {
    address payable public instance;
    bool public armed;
    bool public probeRan;
    bool public probeOk;

    function setInstance(address payable inst) external {
        instance = inst;
    }

    function arm(bool a) external {
        armed = a;
        probeRan = false;
        probeOk = false;
    }

    function callWithdrawDust() external {
        ERC404BondingInstance(instance).withdrawDust();
    }

    function callClaimAllFees() external {
        ERC404BondingInstance(instance).claimAllFees();
    }

    function callClaimStakingRewards() external {
        ERC404BondingInstance(instance).claimStakingRewards();
    }

    receive() external payable {
        if (armed && !probeRan) {
            probeRan = true;
            probeOk = ReentrancyProbe.fire(instance);
        }
    }
}

/// @dev A fee vault that IS the instance owner, so its `claimFees()` runs inside `claimAllFees`'s
///      guarded window with an owner-authorized caller. Fires the probe from there.
contract ReentrantOwnerVault {
    address payable public instance;
    bool public armed;
    bool public probeRan;
    bool public probeOk;

    function setInstance(address payable inst) external {
        instance = inst;
    }

    function arm(bool a) external {
        armed = a;
        probeRan = false;
        probeOk = false;
    }

    function callClaimAllFees() external {
        ERC404BondingInstance(instance).claimAllFees();
    }

    function callClaimStakingRewards() external {
        ERC404BondingInstance(instance).claimStakingRewards();
    }

    function claimFees() external returns (uint256 ethClaimed) {
        if (armed && !probeRan) {
            probeRan = true;
            probeOk = ReentrancyProbe.fire(instance);
        }
        ethClaimed = address(this).balance;
        if (ethClaimed > 0) {
            (bool sent,) = msg.sender.call{ value: ethClaimed }("");
            require(sent, "fee push failed");
        }
    }

    receive() external payable { }
}

/**
 * @title ERC404StakingReserveGuardTest
 * @notice noesis-061: withdrawDust must never sweep ETH owed to stakers (F1), and claimFreeMint
 *         must revert once the curve has graduated (F2).
 */
contract ERC404StakingReserveGuardTest is Test {
    address public owner = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);
    address public mockGMR = address(0x700);

    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant UNIT = 1_000_000 ether;

    BondingCurveMath.Params curveParams;
    CurveParamsComputer public curveComputer;
    MockMasterRegistry public registry;
    ERC404StakingModule public module;

    function setUp() public {
        curveComputer = new CurveParamsComputer(address(this));
        registry = new MockMasterRegistry();
        module = new ERC404StakingModule(address(registry));

        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function _bondingParams() internal view returns (ERC404BondingInstance.BondingParams memory) {
        return ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
    }

    /// @dev owner acts as the factory (initialize captures msg.sender), so factory-only setters
    ///      (initializeStaking / initializeFreeMint) are callable from `owner` here.
    function _newInstance() internal returns (ERC404BondingInstance inst) {
        return _newInstanceFor(owner, address(0));
    }

    /// @dev Same harness, with the instance OWNER and the gating module parameterized. `owner` still
    ///      acts as the factory (initialize captures msg.sender), so the factory-only setters stay
    ///      callable from `owner` even when the instance is owned by a probe contract.
    function _newInstanceFor(address instOwner, address gating) internal returns (ERC404BondingInstance inst) {
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(
            instOwner,
            address(0xBEEF),
            _bondingParams(),
            address(new MockDeployer()),
            gating,
            address(new DN404Mirror(owner))
        );
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGMR,
                protocolTreasury: address(0),
                masterRegistry: address(registry),
                bondingFeeBps: 0,
                weth: address(0xBEEF)
            })
        );
        inst.initializeMetadata("T", "T", "", "", "");
        vm.stopPrank();
    }

    function _openActivate(ERC404BondingInstance inst) internal {
        uint256 openTime = block.timestamp + 1 days;
        vm.startPrank(owner);
        inst.setBondingOpenTime(openTime);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(openTime);
    }

    function _activateStaking(ERC404BondingInstance inst) internal {
        vm.startPrank(owner);
        inst.initializeStaking(address(module)); // factory-only; owner == factory in this harness
        inst.activateStaking();
        vm.stopPrank();
    }

    function _cost(ERC404BondingInstance inst, uint256 amount) internal view returns (uint256) {
        (uint256 ip, uint256 qc, uint256 nf) = inst.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({ kCoeff: ip, poleWad: qc, normalizationFactor: nf });
        return curveComputer.calculateCost(p, inst.totalBondingSupply(), amount);
    }

    /// @dev Point getInstanceVaults(inst) at a single fee vault holding `amount` ETH, and run
    ///      claimAllFees so that ETH lands in the instance balance as a staking-reward liability.
    function _pushFees(ERC404BondingInstance inst, uint256 amount) internal {
        MockFeeVault vault = new MockFeeVault();
        vm.deal(address(vault), amount);
        address[] memory vaults = new address[](1);
        vaults[0] = address(vault);
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(IMasterRegistry.getInstanceVaults.selector, address(inst)),
            abi.encode(vaults)
        );
        vm.prank(owner);
        inst.claimAllFees();
    }

    // ── F1: withdrawDust staking-reserve guard ────────────────────────────────

    /// @notice With a live staker and fees accrued, withdrawDust cannot touch the staker-owed ETH:
    ///         only ETH above reserve + stakingReserve is sweepable, and the staker can still fully
    ///         claim afterwards.
    function test_withdrawDust_cannotSweepStakerOwedETH() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        // user1 buys a unit's worth of tokens and stakes them.
        uint256 buyAmt = UNIT;
        uint256 cost = _cost(inst, buyAmt);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(buyAmt, cost, false, "", "", 0);
        vm.prank(user1);
        inst.stake(buyAmt);
        assertEq(inst.reserve(), cost, "bonding reserve == curve cost");

        // 5 ETH of fees arrive with a live staker → credited to stakingReserve.
        _pushFees(inst, 5 ether);
        assertEq(inst.stakingReserve(), 5 ether, "distributable fees credited to staking reserve");
        assertEq(address(inst).balance, cost + 5 ether, "instance holds curve + reward ETH");

        // balance == reserve + stakingReserve → nothing is genuine surplus.
        vm.prank(owner);
        vm.expectRevert(WithdrawDustFailed.selector); // Ops: NothingToWithdraw
        inst.withdrawDust();

        // Inject 1 ETH of genuine dust; only that is sweepable — staker ETH stays locked.
        vm.deal(address(inst), address(inst).balance + 1 ether);
        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        inst.withdrawDust();
        assertEq(owner.balance - ownerBefore, 1 ether, "only true surplus is swept");
        assertEq(inst.stakingReserve(), 5 ether, "staking reserve untouched by dust sweep");

        // Rewards now STREAM over the window (noesis-098 F6): let it fully elapse so the staker's
        // entitlement reaches the full delta. The liability was credited in full at fee-arrival time,
        // so the 061 guard is unaffected — streaming defers WHEN it's claimable, not the amount owed.
        vm.warp(block.timestamp + module.rewardsDuration());

        // The staker can still claim their full rewards; the reserve drains as they are paid.
        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.claimStakingRewards();
        assertApproxEqAbs(user1.balance - u1Before, 5 ether, 1e10, "staker paid full rewards after a dust sweep");
        assertApproxEqAbs(inst.stakingReserve(), 0, 1e10, "staking reserve drained after payout");
        assertEq(inst.reserve(), cost, "bonding reserve intact throughout");
    }

    /// @notice unstake pays and debits the staking reserve too (auto-claim leg).
    function test_unstake_debitsStakingReserve() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        uint256 buyAmt = UNIT;
        uint256 cost = _cost(inst, buyAmt);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(buyAmt, cost, false, "", "", 0);
        vm.prank(user1);
        inst.stake(buyAmt);

        _pushFees(inst, 4 ether);
        assertEq(inst.stakingReserve(), 4 ether);

        // Let the streaming window elapse so the auto-claim on unstake pays the full delta (F6).
        vm.warp(block.timestamp + module.rewardsDuration());

        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.unstake(buyAmt);
        assertApproxEqAbs(user1.balance - u1Before, 4 ether, 1e10, "unstake auto-claims the rewards");
        assertApproxEqAbs(inst.stakingReserve(), 0, 1e10, "unstake debits the staking reserve");
    }

    /// @notice Regression (the withdrawDust NatSpec case): fees pushed while totalStaked == 0 are
    ///         genuinely undistributable dust and MUST stay recoverable by withdrawDust.
    function test_withdrawDust_recoversDust_whenNoStakers() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        // No stakers. 5 ETH of fees arrive.
        _pushFees(inst, 5 ether);
        assertEq(inst.stakingReserve(), 0, "no staker => no staking liability credited");
        assertEq(address(inst).balance, 5 ether, "dust sits in the instance balance");

        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        inst.withdrawDust();
        assertEq(owner.balance - ownerBefore, 5 ether, "true dust recoverable when totalStaked == 0");
    }

    // ── F2: claimFreeMint graduated guard ─────────────────────────────────────

    /// @notice claimFreeMint works pre-graduation but reverts once the curve has graduated, so a
    ///         late claimer cannot mint against a drained curve / deployed pool.
    function test_claimFreeMint_revertsAfterGraduation() public {
        ERC404BondingInstance inst = _newInstance();
        vm.prank(owner);
        inst.initializeFreeMint(3, GatingScope.BOTH);
        _openActivate(inst);

        // Pre-graduation: a free mint claim succeeds.
        vm.prank(user1);
        inst.claimFreeMint("");
        assertEq(inst.freeMintsClaimed(), 1, "free mint claimable before graduation");

        // Create reserve then graduate.
        uint256 buyAmt = UNIT;
        uint256 cost = _cost(inst, buyAmt);
        vm.deal(user2, cost);
        vm.prank(user2);
        inst.buyBonding{ value: cost }(buyAmt, cost, false, "", "", 0);
        vm.prank(owner);
        inst.deployLiquidity(0);
        assertTrue(inst.graduated(), "curve graduated");

        // Post-graduation: an unclaimed free mint can no longer be claimed.
        address late = address(0x9);
        vm.prank(late);
        vm.expectRevert(FreeMintFailed.selector); // Ops: BondingEnded
        inst.claimFreeMint("");
        assertEq(inst.freeMintsClaimed(), 1, "no post-graduation claim was recorded");
    }

    // ── F7: instance exit paths survive registry de-listing (noesis-098) ───────

    /// @notice End-to-end: after MasterRegistry de-lists the instance, its staker can still
    ///         claimStakingRewards() + unstake() (principal + accrued rewards recovered), but a fresh
    ///         stake() is refused (recordStake stays gated). Proves F7 at the instance boundary.
    function test_F7_instanceStakerExitsAfterDeregistration() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        uint256 buyAmt = 2 * UNIT;
        uint256 cost = _cost(inst, buyAmt);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(buyAmt, cost, false, "", "", 0);
        vm.prank(user1);
        inst.stake(UNIT); // stake one unit, keep one in the wallet

        _pushFees(inst, 5 ether);
        vm.warp(block.timestamp + module.rewardsDuration());

        // Registry revokes the instance.
        registry.setRegisteredInstance(address(inst), false);

        // EXIT still works: the staker claims streamed rewards despite the de-listing.
        uint256 balBefore = user1.balance;
        vm.prank(user1);
        inst.claimStakingRewards();
        assertApproxEqAbs(user1.balance - balBefore, 5 ether, 1e10, "de-listed instance staker still claims rewards");

        // ...and unstakes principal.
        vm.prank(user1);
        inst.unstake(UNIT);
        assertEq(module.stakedBalance(address(inst), user1), 0, "principal recovered after de-listing");

        // But ACCEPTING a fresh stake is refused — recordStake remains gated. The module's
        // `NotRegisteredInstance` reaches the caller as the generic `StakeFailed()`: `stake` runs in
        // ERC404BondingOps behind a discard-returndata trampoline (noesis-148). The gate still fires.
        vm.prank(user1);
        vm.expectRevert(StakeFailed.selector); // staking module: NotRegisteredInstance
        inst.stake(UNIT);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  noesis-148 (D3 diet): the six value-path bodies now run in ERC404BondingOps under delegatecall.
    //  Everything below proves the MOVE changed nothing that matters:
    //    (a) the reentrancy guard still engages, from the far side of the delegatecall, for all six;
    //    (b) claimAllFees's anti-brick try/catch survives a mixed vault set;
    //    (c) msg.sender identity is preserved, so onlyOwner and the staker-keyed module calls hold.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// @dev Wire a probe staking module in and activate staking. `owner` is the factory in this harness.
    function _activateProbeStaking(ERC404BondingInstance inst, address mod) internal {
        vm.startPrank(owner);
        inst.initializeStaking(mod);
        vm.stopPrank();
        vm.prank(inst.owner());
        inst.activateStaking();
    }

    /// @dev Buy `nUnits` units' worth of curve tokens for `buyer`.
    function _buy(ERC404BondingInstance inst, address buyer, uint256 nUnits) internal {
        uint256 amt = UNIT * nUnits;
        uint256 cost = _cost(inst, amt);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        inst.buyBonding{ value: cost }(amt, cost, false, "", "", 0);
    }

    /// @notice `stake` — the guard engages through the trampoline.
    function test_148_reentrancy_stake() public {
        ERC404BondingInstance inst = _newInstance();
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));
        _openActivate(inst);
        _buy(inst, user1, 2);

        // Control: the probe target is genuinely callable from the module OUTSIDE any guarded window.
        assertTrue(ReentrancyProbeHarness.callable(payable(address(inst))), "probe target callable at rest");

        mod.arm(ReentrantStakingModule.Hook.STAKE);
        vm.prank(user1);
        inst.stake(UNIT);
        assertTrue(mod.probeRan(), "probe fired from inside stake");
        assertFalse(mod.probeOk(), "reentrancy guard must reject the re-entrant call inside stake");
    }

    /// @notice `unstake` — the guard engages through the trampoline.
    function test_148_reentrancy_unstake() public {
        ERC404BondingInstance inst = _newInstance();
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));
        _openActivate(inst);
        _buy(inst, user1, 2);

        vm.prank(user1);
        inst.stake(UNIT);

        mod.arm(ReentrantStakingModule.Hook.UNSTAKE);
        vm.prank(user1);
        inst.unstake(UNIT);
        assertTrue(mod.probeRan(), "probe fired from inside unstake");
        assertFalse(mod.probeOk(), "reentrancy guard must reject the re-entrant call inside unstake");
    }

    /// @notice `claimStakingRewards` — the guard engages through the trampoline.
    function test_148_reentrancy_claimStakingRewards() public {
        ERC404BondingInstance inst = _newInstance();
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));
        _openActivate(inst);

        mod.arm(ReentrantStakingModule.Hook.CLAIM);
        vm.prank(user1);
        inst.claimStakingRewards();
        assertTrue(mod.probeRan(), "probe fired from inside claimStakingRewards");
        assertFalse(mod.probeOk(), "reentrancy guard must reject the re-entrant call inside claimStakingRewards");
    }

    /// @notice `claimFreeMint` — the guard engages through the trampoline (gating-module surface).
    function test_148_reentrancy_claimFreeMint() public {
        ReentrantGatingModule gate = new ReentrantGatingModule();
        ERC404BondingInstance inst = _newInstanceFor(owner, address(gate));
        gate.setInstance(payable(address(inst)));
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));
        vm.prank(owner); // factory-only
        inst.initializeFreeMint(3, GatingScope.BOTH);
        _openActivate(inst);

        gate.arm(true);
        vm.prank(user1);
        inst.claimFreeMint("");
        assertEq(inst.freeMintsClaimed(), 1, "the outer claim still completed");
        assertTrue(gate.probeRan(), "probe fired from inside claimFreeMint");
        assertFalse(gate.probeOk(), "reentrancy guard must reject the re-entrant call inside claimFreeMint");
    }

    /// @notice `withdrawDust` — the guard engages through the trampoline (owner payout surface).
    function test_148_reentrancy_withdrawDust() public {
        ReentrantOwner ro = new ReentrantOwner();
        ERC404BondingInstance inst = _newInstanceFor(address(ro), address(0));
        ro.setInstance(payable(address(inst)));
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));
        // No `_openActivate` here: this instance is owned by the probe contract, and the sweep path
        // needs no live curve — only surplus ETH above zero locked liabilities.

        // Pure surplus: no curve reserve, no staking reserve.
        vm.deal(address(inst), 1 ether);

        // Control: unarmed, the sweep succeeds and the owner is paid.
        ro.arm(false);
        ro.callWithdrawDust();
        assertEq(address(ro).balance, 1 ether, "surplus swept to the owner");

        // Armed: the payout hands control to the owner mid-sweep and it re-enters. The probe records
        // the rejection rather than bubbling it, so the outer sweep still completes — what matters is
        // that the re-entrant call was REFUSED, i.e. the guard held across the delegatecall.
        vm.deal(address(inst), 1 ether);
        ro.arm(true);
        ro.callWithdrawDust();
        assertTrue(ro.probeRan(), "probe fired from inside withdrawDust");
        assertFalse(ro.probeOk(), "reentrancy guard must reject the re-entrant call inside withdrawDust");
        assertEq(address(ro).balance, 2 ether, "the sweep itself still paid out exactly once");
        assertEq(address(inst).balance, 0, "no double-sweep: the instance was drained once, not twice");
    }

    /// @notice `claimAllFees` — the guard engages through the trampoline (vault callback surface).
    function test_148_reentrancy_claimAllFees() public {
        ReentrantOwnerVault rv = new ReentrantOwnerVault();
        ERC404BondingInstance inst = _newInstanceFor(address(rv), address(0));
        rv.setInstance(payable(address(inst)));
        ReentrantStakingModule mod = new ReentrantStakingModule();
        mod.setInstance(payable(address(inst)));
        _activateProbeStaking(inst, address(mod));

        address[] memory vaults = new address[](1);
        vaults[0] = address(rv);
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(IMasterRegistry.getInstanceVaults.selector, address(inst)),
            abi.encode(vaults)
        );

        // Control: the vault IS the owner, so an un-armed claim clears `onlyOwner` on the Ops side —
        // proof that `msg.sender` survives the delegatecall.
        rv.arm(false);
        rv.callClaimAllFees();

        rv.arm(true);
        rv.callClaimAllFees();
        assertTrue(rv.probeRan(), "probe fired from inside claimAllFees");
        assertFalse(rv.probeOk(), "reentrancy guard must reject the re-entrant call inside claimAllFees");
    }

    /// @notice The anti-brick invariant: one vault that reverts `claimFees()` cannot stop the
    ///         supporting vault's delta from being credited. `claimAllFees`'s `try/catch` moved to Ops
    ///         verbatim; this proves it still swallows per-vault failure.
    function test_148_claimAllFees_mixedVaultSet_stillCreditsSupportingVault() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        // A live staker, so the noesis-061 credit guard (`totalStaked != 0`) is satisfied.
        _buy(inst, user1, 1);
        vm.prank(user1);
        inst.stake(UNIT);

        MockRevertingFeeVault bad = new MockRevertingFeeVault();
        MockFeeVault good = new MockFeeVault();
        vm.deal(address(good), 3 ether);

        address[] memory vaults = new address[](2);
        vaults[0] = address(bad); // reverting vault FIRST — it must not short-circuit the loop
        vaults[1] = address(good);
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(IMasterRegistry.getInstanceVaults.selector, address(inst)),
            abi.encode(vaults)
        );

        uint256 reserveBefore = inst.stakingReserve();
        vm.prank(inst.owner());
        inst.claimAllFees();

        assertEq(inst.stakingReserve() - reserveBefore, 3 ether, "supporting vault's delta still credited");
        assertEq(address(good).balance, 0, "supporting vault was drained despite the reverting sibling");
    }

    /// @notice `withdrawDust` still refuses to touch `reserve + stakingReserve` after the move: with a
    ///         live curve reserve AND a staking liability, only the excess is sweepable.
    function test_148_withdrawDust_stillRefusesLockedLiabilities() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        _buy(inst, user1, 1);
        vm.prank(user1);
        inst.stake(UNIT);
        _pushFees(inst, 2 ether); // credited to stakingReserve (a staker is live)

        uint256 locked = inst.reserve() + inst.stakingReserve();
        assertEq(address(inst).balance, locked, "balance is exactly the locked liabilities");

        vm.prank(inst.owner());
        vm.expectRevert(WithdrawDustFailed.selector); // Ops: NothingToWithdraw
        inst.withdrawDust();

        // One wei of genuine surplus, and exactly one wei is sweepable.
        vm.deal(address(inst), address(inst).balance + 1);
        uint256 ownerBefore = inst.owner().balance;
        vm.prank(inst.owner());
        inst.withdrawDust();
        assertEq(inst.owner().balance - ownerBefore, 1, "only the true surplus is swept");
        assertEq(address(inst).balance, locked, "locked liabilities untouched");
    }
}

/// @dev Helper so a test can assert the neutral probe target is callable OUTSIDE a guarded window —
///      the control half of every A/B above.
library ReentrancyProbeHarness {
    function callable(address payable instance) internal returns (bool ok) {
        (ok,) = instance.call(abi.encodeWithSelector(ERC404BondingInstance.claimStakingRewards.selector));
    }
}
