// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

// ── Mocks (same shapes as the sibling staking-reserve suites) ───────────────

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
 * @title ERC404StakingRevokedCreditTest
 * @notice A revoked instance STOPS BEING CREDITED fees; it does not lose the ability to sweep them.
 *
 *         `ERC404StakingModule.recordFeesReceived` is `onlyRegisteredInstance`. `claimAllFees` pulls
 *         from every vault, then records the balance delta with the staking module, then calls
 *         `settleAndReleaseLeak` (which is deliberately NOT registration-gated, so exit paths survive
 *         de-listing). Recording the delta unconditionally makes the whole sweep hostage to the
 *         registration: after a revocation the pull is rolled back and the leak release never runs, so
 *         swept fees and an already-accrued leak are both stranded with no other route out.
 *
 *         The behaviour asserted here is the intended one: the sweep completes, the vault ETH really
 *         lands in the instance, the live stream is left exactly as it was, the delta is credited
 *         NEITHER to the stream NOR to `stakingReserve` (crediting the reserve without a stream would
 *         lock ETH nobody can accrue and nobody can sweep), and the leak still releases exactly once.
 */
contract ERC404StakingRevokedCreditTest is Test {
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

        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });
    }

    // ── Helpers (mirror the ERC404StakingReserveOverlock harness) ──────────────

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
        inst.initializeStaking(address(module));
        inst.activateStaking();
        vm.stopPrank();
    }

    function _cost(ERC404BondingInstance inst, uint256 amount) internal view returns (uint256) {
        (uint256 ip, uint256 qc, uint256 nf) = inst.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({ kCoeff: ip, poleWad: qc, normalizationFactor: nf });
        return curveComputer.calculateCost(p, inst.totalBondingSupply(), amount);
    }

    /// @dev Point getInstanceVaults(inst) at a single fee vault holding `amount` ETH, and run
    ///      claimAllFees so that ETH lands in the instance balance.
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

    // ── The sweep survives revocation, and credits nothing ──────────────────────

    /// @notice A live stream, a live staker, then the instance is revoked and more fees arrive.
    ///         `claimAllFees` completes, the vault ETH lands in the instance, and the running stream is
    ///         byte-for-byte untouched: no staker's accrual changes because the instance left the
    ///         registry. The delta reaches neither the stream nor `stakingReserve`, so it is ordinary
    ///         surplus the owner recovers with `withdrawDust` rather than ETH locked behind a liability
    ///         no one can ever claim.
    function test_revoked_claimAllFeesCompletes_streamUntouched_nothingCredited() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        uint256 cost = _buyAndStake(inst, user1);

        // A first, ordinary fee delivery while registered: the stream starts and the reserve is credited.
        uint256 firstDelta = 7 ether;
        _pushFees(inst, firstDelta);
        uint256 rateBefore = module.rewardRate(address(inst));
        uint256 finishBefore = module.periodFinish(address(inst));
        assertGt(rateBefore, 0, "a stream is running before the revocation");
        assertEq(inst.stakingReserve(), firstDelta, "first delta credited while registered");

        // The instance is de-curated mid-window. The staker is still live, so this is the case where the
        // credit guard is actually load-bearing: totalStaked != 0.
        registry.setRegisteredInstance(address(inst), false);
        assertGt(module.totalStaked(address(inst)), 0, "the staker is still live across the revocation");

        vm.warp(block.timestamp + 1 days);
        uint256 balBefore = address(inst).balance;

        // The sweep still runs. Pre-fix this reverted on the bare recordFeesReceived and rolled the pull
        // back, stranding both this delta and the vault's ETH.
        uint256 secondDelta = 3 ether;
        _pushFees(inst, secondDelta);

        assertEq(address(inst).balance, balBefore + secondDelta, "vault ETH really landed in the instance");
        assertEq(module.rewardRate(address(inst)), rateBefore, "rewardRate unchanged by a revoked-instance sweep");
        assertEq(module.periodFinish(address(inst)), finishBefore, "periodFinish unchanged by a revoked-instance sweep");
        assertEq(inst.stakingReserve(), firstDelta, "the revoked delta is not added to the staker-owed reserve");

        // Nothing is stranded: the uncredited delta is sweepable surplus, and the staker still collects
        // exactly the stream that was running when the revocation landed.
        vm.warp(finishBefore + 1);
        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.unstake(UNIT);
        uint256 stakerPaid = user1.balance - u1Before;
        assertApproxEqAbs(stakerPaid, firstDelta, 1e14, "staker paid the pre-revocation stream in full");

        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        inst.withdrawDust();
        assertApproxEqAbs(owner.balance - ownerBefore, secondDelta, 1e14, "owner recovers the uncredited delta");
        assertEq(inst.reserve(), cost, "bonding reserve intact throughout");
    }

    /// @notice The leak release is the half of the sweep that has no other route out — `withdrawDust`
    ///         refuses to touch ETH still counted in `stakingReserve`, and only `settleAndReleaseLeak`
    ///         debits it. Post-revocation it must still run, and still run exactly once.
    function test_revoked_settleAndReleaseLeakStillZeroesTheLeakOnce() public {
        ERC404BondingInstance inst = _newInstance();
        _activateStaking(inst);
        _openActivate(inst);

        _buyAndStake(inst, user1);

        uint256 delta = 7 ether;
        _pushFees(inst, delta);
        assertEq(inst.stakingReserve(), delta, "full delta credited while a staker is live");

        // Staker exits halfway; the rest of the window streams into a zero-stake gap and can never accrue.
        uint256 half = module.rewardsDuration() / 2;
        vm.warp(block.timestamp + half);
        vm.prank(user1);
        inst.unstake(UNIT);
        vm.warp(block.timestamp + half + 1);

        uint256 leak = module.pendingStreamLeak(address(inst));
        assertGt(leak, 0, "a zero-stake gap remainder is outstanding");

        // Revoke, THEN sweep. The release is registration-independent by design and must survive.
        registry.setRegisteredInstance(address(inst), false);
        uint256 reserveBefore = inst.stakingReserve();

        // A non-zero delta, so the sweep really does reach the registration-gated record call on its
        // way to the release: pre-fix this reverted and the leak stayed locked in `stakingReserve`
        // with `withdrawDust` refusing to touch it.
        _pushFees(inst, 1 ether);

        assertEq(module.pendingStreamLeak(address(inst)), 0, "leak released while revoked");
        assertEq(inst.stakingReserve(), reserveBefore - leak, "reserve debited by exactly the leak");

        // Once, not once per sweep: a second revoked sweep finds nothing left to release.
        uint256 reserveAfter = inst.stakingReserve();
        _pushFees(inst, 1 ether);
        assertEq(module.pendingStreamLeak(address(inst)), 0, "nothing further to release");
        assertEq(inst.stakingReserve(), reserveAfter, "no second debit for the same leak");
    }
}
