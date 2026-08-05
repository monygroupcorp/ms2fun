// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance, NothingToWithdraw } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
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

/**
 * @title ERC404StakingReserveOverlockTest
 * @notice noesis-127 — F6 stream over-lock. When a fee stream outlives its stakers, the ETH the stream
 *         schedules during the zero-stake gap can never accrue to anyone AND was counted in
 *         `stakingReserve`, which `withdrawDust` refuses to sweep — permanently locked ETH. The fix
 *         tracks that un-accruable "stream leak" in the module and releases it from `stakingReserve`
 *         so `withdrawDust` recovers it, without touching genuinely-owed staker ETH.
 */
contract ERC404StakingReserveOverlockTest is Test {
    address public owner = address(0x1);
    address public user1 = address(0x2);
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

        curveParams = BondingCurveMath.Params({
            initialPrice: 0.025 ether,
            quarticCoeff: 3 gwei,
            cubicCoeff: 1333333333,
            quadraticCoeff: 2 gwei,
            normalizationFactor: 1e7
        });
    }

    // ── Helpers (mirror ERC404StakingReserveGuard harness) ─────────────────────

    function _bondingParams() internal view returns (ERC404BondingInstance.BondingParams memory) {
        return ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
    }

    function _newInstance() internal returns (ERC404BondingInstance inst) {
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(
            owner,
            address(0xBEEF),
            _bondingParams(),
            address(new MockDeployer()),
            address(0),
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
        inst.initializeMetadata("T", "T", "", "");
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
        inst.initializeStaking(address(module));
        inst.activateStaking();
        vm.stopPrank();
    }

    function _cost(ERC404BondingInstance inst, uint256 amount) internal view returns (uint256) {
        (uint256 ip, uint256 qc, uint256 cc, uint256 qdc, uint256 nf) = inst.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({
            initialPrice: ip, quarticCoeff: qc, cubicCoeff: cc, quadraticCoeff: qdc, normalizationFactor: nf
        });
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

    /// @dev Buy one UNIT for `who` and stake it, returning the bonding cost paid.
    function _buyAndStake(ERC404BondingInstance inst, address who) internal returns (uint256 cost) {
        cost = _cost(inst, UNIT);
        vm.deal(who, cost);
        vm.prank(who);
        inst.buyBonding{ value: cost }(UNIT, cost, false, "", "", 0);
        vm.prank(who);
        inst.stake(UNIT);
    }

    // ── Reproduction + recovery ────────────────────────────────────────────────

    /// @notice The over-lock strand: a stream started with a live staker, the staker exits mid-window,
    ///         and the window then finishes with no one staked. The remainder the stream scheduled for
    ///         the zero-stake gap can never accrue to a staker. Pre-fix it stayed inside `stakingReserve`
    ///         and `withdrawDust` refused to sweep it (permanently locked). Post-fix `withdrawDust`
    ///         recovers exactly that remainder to the owner and the reserve reflects only true liability.
    function test_overlock_zeroStakeGapRemainderRecoverable() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        uint256 cost = _buyAndStake(inst, user1);
        assertEq(inst.reserve(), cost, "bonding reserve == curve cost");

        // 7 ETH of fees arrive with a live staker → full delta credited to stakingReserve, stream starts.
        uint256 delta = 7 ether;
        _pushFees(inst, delta);
        assertEq(inst.stakingReserve(), delta, "full delta credited while a staker is live");

        uint256 half = module.rewardsDuration() / 2;

        // Advance halfway, then the staker exits — auto-claims ~delta/2, debiting stakingReserve.
        vm.warp(block.timestamp + half);
        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.unstake(UNIT);
        uint256 stakerPaid = user1.balance - u1Before;
        assertApproxEqAbs(stakerPaid, delta / 2, 1e14, "exiting staker paid ~half the stream");
        assertEq(module.totalStaked(address(inst)), 0, "no stakers remain");

        // Finish the window with nobody staked. The remainder (~delta/2) scheduled for this gap can
        // never accrue to a staker.
        vm.warp(block.timestamp + half + 1);

        // The module now recognises the un-accruable leak (~delta/2).
        uint256 leak = module.pendingStreamLeak(address(inst));
        assertApproxEqAbs(leak, delta / 2, 1e14, "zero-stake gap remainder tracked as leak");

        // Instance balance = curve cost + the unpaid remainder still sitting in the instance.
        uint256 remainderInInstance = address(inst).balance - cost;
        assertApproxEqAbs(remainderInInstance, delta - stakerPaid, 1e14, "unpaid remainder held by instance");

        // Pre-fix: the remainder sat inside stakingReserve and withdrawDust refused to sweep it —
        // balance == reserve + stakingReserve → NothingToWithdraw, permanently locked.
        assertApproxEqAbs(
            inst.stakingReserve(), delta - stakerPaid, 1e14, "un-owed remainder still counted as liability pre-release"
        );

        // ── The fix: a routine claimAllFees (here with zero new fees) releases the un-accruable leak
        //    out of stakingReserve; withdrawDust then sweeps the now-recoverable surplus to the owner. ──
        _pushFees(inst, 0); // zero-delta fee claim still runs releaseStreamLeak
        assertApproxEqAbs(inst.stakingReserve(), 0, 1e13, "leak debited: reserve reflects only true (zero) liability");
        assertEq(module.pendingStreamLeak(address(inst)), 0, "leak released exactly once");

        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        inst.withdrawDust();
        uint256 recovered = owner.balance - ownerBefore;

        assertApproxEqAbs(recovered, leak, 1e12, "owner recovers exactly the un-accruable leak");
        assertEq(inst.reserve(), cost, "bonding reserve intact throughout");

        // Σ-conservation: staker claims + recovered leak never exceed the posted fees.
        assertLe(stakerPaid + recovered, delta, "no over-release / double-count");
    }

    /// @notice Guard: while a staker is still live and the window is active, NOTHING is released. The
    ///         genuinely-owed streamed ETH stays locked (noesis-061 F1 preserved); withdrawDust reverts
    ///         with no true surplus and the staker can still claim the full delta afterwards.
    function test_stillStaked_unaffected_noPrematureRelease() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        uint256 cost = _buyAndStake(inst, user1);
        uint256 delta = 5 ether;
        _pushFees(inst, delta);
        assertEq(inst.stakingReserve(), delta, "full delta credited");

        // Halfway through the live window: no leak (a staker is present the whole time).
        vm.warp(block.timestamp + module.rewardsDuration() / 2);
        assertEq(module.pendingStreamLeak(address(inst)), 0, "no leak while a staker is live");

        // balance == reserve + stakingReserve → withdrawDust finds no surplus and must not release
        // any staker-owed ETH.
        vm.prank(owner);
        vm.expectRevert(NothingToWithdraw.selector);
        inst.withdrawDust();
        assertEq(inst.stakingReserve(), delta, "reserve untouched: owed ETH stays locked");

        // Let the window fully elapse; the committed staker still claims essentially the whole delta.
        vm.warp(block.timestamp + module.rewardsDuration());
        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.claimStakingRewards();
        assertApproxEqAbs(user1.balance - u1Before, delta, 1e10, "live staker keeps the full delta");
        assertApproxEqAbs(inst.stakingReserve(), 0, 1e10, "reserve drains as the staker is paid");
        assertEq(inst.reserve(), cost, "bonding reserve intact");
    }
}
