// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    ERC404BondingInstance,
    BondingEnded,
    NothingToWithdraw
} from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";

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

        curveParams = BondingCurveMath.Params({
            initialPrice: 0.025 ether,
            quarticCoeff: 3 gwei,
            cubicCoeff: 1333333333,
            quadraticCoeff: 2 gwei,
            normalizationFactor: 1e7
        });
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
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance();
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(owner, address(0xBEEF), _bondingParams(), address(new MockDeployer()), address(0));
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
        inst.initializeStaking(address(module)); // factory-only; owner == factory in this harness
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
        vm.expectRevert(NothingToWithdraw.selector);
        inst.withdrawDust();

        // Inject 1 ETH of genuine dust; only that is sweepable — staker ETH stays locked.
        vm.deal(address(inst), address(inst).balance + 1 ether);
        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        inst.withdrawDust();
        assertEq(owner.balance - ownerBefore, 1 ether, "only true surplus is swept");
        assertEq(inst.stakingReserve(), 5 ether, "staking reserve untouched by dust sweep");

        // The staker can still claim their full rewards; the reserve drains as they are paid.
        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.claimStakingRewards();
        assertEq(user1.balance - u1Before, 5 ether, "staker paid full rewards after a dust sweep");
        assertEq(inst.stakingReserve(), 0, "staking reserve drained after payout");
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

        uint256 u1Before = user1.balance;
        vm.prank(user1);
        inst.unstake(buyAmt);
        assertEq(user1.balance - u1Before, 4 ether, "unstake auto-claims the rewards");
        assertEq(inst.stakingReserve(), 0, "unstake debits the staking reserve");
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
        vm.expectRevert(BondingEnded.selector);
        inst.claimFreeMint("");
        assertEq(inst.freeMintsClaimed(), 1, "no post-graduation claim was recorded");
    }
}
