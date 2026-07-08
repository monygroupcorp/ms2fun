// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console } from "forge-std/Test.sol";
import {
    ERC404BondingInstance,
    ICarveParamsSource,
    MaxCostExceeded,
    BondingNotConfigured,
    NoReserve,
    InvalidRefund,
    InvalidDeclaredMaxAllowance
} from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IGatingModule } from "../../../src/gating/IGatingModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";

// ── Mock contracts ────────────────────────────────────────────────────────────

contract MockGatingModule is IGatingModule {
    function canMint(address, uint256, bytes calldata) external pure override returns (bool allowed, bool permanent) {
        return (true, false);
    }
    function onMint(address, uint256) external override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

contract PermanentGatingModule is IGatingModule {
    function canMint(address, uint256, bytes calldata) external pure override returns (bool allowed, bool permanent) {
        return (true, true);
    }
    function onMint(address, uint256) external override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

contract MockLiquidityDeployer is ILiquidityDeployerModule {
    bool public called;
    ILiquidityDeployerModule.DeployParams public lastParams;

    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata p) external payable override {
        called = true;
        lastParams = p;
    }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title ERC404BondingInstanceTest
 * @notice Comprehensive test suite for ERC404BondingInstance
 */
contract ERC404BondingInstanceTest is Test {
    ERC404BondingInstance public instance;

    address public owner = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);

    // Test parameters
    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;

    BondingCurveMath.Params curveParams;

    bytes32 public passwordHash1;

    // Mock addresses
    address public mockMasterRegistry = address(0x400);
    address public mockLiquidityDeployer = address(0x600);
    address public mockGlobalMsgRegistry = address(0x700);

    CurveParamsComputer public curveComputer;

    function setUp() public {
        curveComputer = new CurveParamsComputer(address(this));

        vm.startPrank(owner);

        passwordHash1 = keccak256("password1");

        curveParams = BondingCurveMath.Params({
            initialPrice: 0.025 ether,
            quarticCoeff: 3 gwei,
            cubicCoeff: 1333333333,
            quadraticCoeff: 2 gwei,
            normalizationFactor: 1e7
        });

        ERC404BondingInstance impl = new ERC404BondingInstance();
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        _initInstance(instance, address(0xBEEF), address(0xFEE), 100);
        instance.initializeMetadata("Test Token", "TEST", "", "");

        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _bondingParams() internal view returns (ERC404BondingInstance.BondingParams memory) {
        return ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: 1_000_000 ether,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
    }

    /**
     * @dev 3-step initialize helper. Must be called within vm.startPrank(owner) context
     *      because factory = msg.sender is captured during initialize().
     */
    function _initInstance(ERC404BondingInstance inst, address vault_, address treasury_, uint256 bondingFeeBps_)
        internal
    {
        inst.initialize(owner, vault_, _bondingParams(), mockLiquidityDeployer, address(0));

        ERC404BondingInstance.ProtocolParams memory proto = ERC404BondingInstance.ProtocolParams({
            globalMessageRegistry: mockGlobalMsgRegistry,
            protocolTreasury: treasury_,
            masterRegistry: mockMasterRegistry,
            bondingFeeBps: bondingFeeBps_,
            weth: address(0xBEEF)
        });
        inst.initializeProtocol(proto);
    }

    function test_Deployment() public {
        assertEq(instance.maxSupply(), MAX_SUPPLY);
        assertEq(instance.liquidityReserve(), MAX_SUPPLY * LIQUIDITY_RESERVE_BPS / 10000);
        assertFalse(instance.graduated());
        assertFalse(instance.gatingActive()); // no gating module set in setUp
    }

    function test_SetBondingOpenTime() public {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);
        assertEq(instance.bondingOpenTime(), futureTime);
        vm.stopPrank();
    }

    function test_SetBondingOpenTime_RevertIfNotOwner() public {
        vm.startPrank(user1);
        vm.expectRevert();
        instance.setBondingOpenTime(block.timestamp + 1 days);
        vm.stopPrank();
    }

    function test_SetBondingActive() public {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);

        instance.setBondingActive(true);
        assertTrue(instance.bondingActive());
        vm.stopPrank();
    }

    function test_TierPasswordVerification() public {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);
        instance.setBondingActive(true);
        vm.stopPrank();

        vm.warp(futureTime);
        vm.deal(user1, 10 ether);

        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + fee;
        instance.buyBonding{ value: totalWithFee }(buyAmount, totalWithFee, false, passwordHash1, bytes(""), 0);
        vm.stopPrank();
    }

    function test_CalculateCost() public {
        uint256 amount = 1000 * 1e18;
        uint256 cost = _getCost(instance, amount);
        assertGt(cost, 0);
    }

    function test_CalculateRefund() public {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);
        instance.setBondingActive(true);
        vm.stopPrank();

        vm.warp(futureTime);
        vm.deal(user1, 10 ether);

        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + fee;
        instance.buyBonding{ value: totalWithFee }(buyAmount, totalWithFee, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        uint256 refund = _getRefund(instance, buyAmount);
        assertGt(refund, 0);
        assertEq(refund, cost);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _getCost(ERC404BondingInstance inst, uint256 amount) internal view returns (uint256) {
        (uint256 ip, uint256 qc, uint256 cc, uint256 qdc, uint256 nf) = inst.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({
            initialPrice: ip, quarticCoeff: qc, cubicCoeff: cc, quadraticCoeff: qdc, normalizationFactor: nf
        });
        return curveComputer.calculateCost(p, inst.totalBondingSupply(), amount);
    }

    function _getRefund(ERC404BondingInstance inst, uint256 amount) internal view returns (uint256) {
        (uint256 ip, uint256 qc, uint256 cc, uint256 qdc, uint256 nf) = inst.curveParams();
        BondingCurveMath.Params memory p = BondingCurveMath.Params({
            initialPrice: ip, quarticCoeff: qc, cubicCoeff: cc, quadraticCoeff: qdc, normalizationFactor: nf
        });
        return curveComputer.calculateRefund(p, inst.totalBondingSupply(), amount);
    }

    // ── Bonding Fee Tests ─────────────────────────────────────────────────────

    function _activateBonding() internal {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);
    }

    /// @dev Buying charges exactly the curve cost — no buy-side fee reaches the treasury (the protocol
    ///      fee is taken on exit only, see the sell tests).
    function test_BuyBonding_NoTreasuryFee() public {
        _activateBonding();

        address treasury = address(0xFEE);
        uint256 treasuryBalanceBefore = treasury.balance;

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);

        instance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        assertEq(treasury.balance, treasuryBalanceBefore, "buy must not pay any fee to the treasury");
        assertEq(instance.reserve(), cost, "reserve receives the full cost");
    }

    function test_BuyBondingWithFee_ReserveOnlyGetsCost() public {
        _activateBonding();

        uint256 reserveBefore = instance.reserve();
        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + fee;

        instance.buyBonding{ value: totalWithFee }(buyAmount, totalWithFee, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        assertEq(instance.reserve() - reserveBefore, cost, "Reserve should only increase by cost, not fee");
    }

    function test_BuyBonding_RefundsExcessAboveCost() public {
        _activateBonding();

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);

        uint256 overpay = 1 ether;
        uint256 balanceBefore = user1.balance;
        instance.buyBonding{ value: cost + overpay }(buyAmount, cost + overpay, false, bytes32(0), bytes(""), 0);
        uint256 balanceAfter = user1.balance;

        assertEq(balanceBefore - balanceAfter, cost, "buyer pays exactly the curve cost; excess refunded");
        vm.stopPrank();
    }

    /// @dev With no buy fee, maxCost == cost is sufficient; maxCost below cost still reverts.
    function test_BuyBonding_MaxCostEqualsCostSucceeds() public {
        _activateBonding();

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);

        // maxCost just below cost reverts.
        vm.expectRevert(MaxCostExceeded.selector);
        instance.buyBonding{ value: 10 ether }(buyAmount, cost - 1, false, bytes32(0), bytes(""), 0);

        // maxCost exactly cost succeeds.
        instance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);
        assertEq(instance.reserve(), cost, "reserve equals cost after buy");
        vm.stopPrank();
    }

    function test_BuyBondingWithFee_ZeroFee() public {
        vm.startPrank(owner);
        ERC404BondingInstance zeroFeeImpl = new ERC404BondingInstance();
        ERC404BondingInstance zeroFeeInstance = ERC404BondingInstance(payable(LibClone.clone(address(zeroFeeImpl))));
        _initInstance(zeroFeeInstance, address(0xBEEF), address(0xFEE), 0);
        zeroFeeInstance.initializeMetadata("Zero Fee Token", "ZFT", "", "");
        uint256 futureTime = block.timestamp + 1 days;
        zeroFeeInstance.setBondingOpenTime(futureTime);
        zeroFeeInstance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        address treasury = address(0xFEE);
        uint256 treasuryBefore = treasury.balance;

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(zeroFeeInstance, buyAmount);
        zeroFeeInstance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        assertEq(treasury.balance, treasuryBefore, "Treasury balance unchanged with 0% fee");
    }

    function test_BuyBondingWithFee_NoTreasury() public {
        vm.startPrank(owner);
        ERC404BondingInstance noTreasuryImplInst = new ERC404BondingInstance();
        ERC404BondingInstance noTreasuryInstance =
            ERC404BondingInstance(payable(LibClone.clone(address(noTreasuryImplInst))));
        _initInstance(noTreasuryInstance, address(0xBEEF), address(0), 100);
        noTreasuryInstance.initializeMetadata("No Treasury Token", "NTT", "", "");
        uint256 futureTime = block.timestamp + 1 days;
        noTreasuryInstance.setBondingOpenTime(futureTime);
        noTreasuryInstance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(noTreasuryInstance, buyAmount);
        uint256 fee = (cost * noTreasuryInstance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + fee;
        noTreasuryInstance.buyBonding{ value: totalWithFee }(buyAmount, totalWithFee, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();
    }

    function test_SellBondingAfterFee_CurveSolvency() public {
        _activateBonding();

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + fee;

        instance.buyBonding{ value: totalWithFee }(buyAmount, totalWithFee, false, bytes32(0), bytes(""), 0);

        uint256 refund = _getRefund(instance, buyAmount);
        assertEq(refund, cost, "Refund should equal curve cost, preserving solvency");
        assertGe(instance.reserve(), refund, "Reserve must be >= refund amount");
        vm.stopPrank();
    }

    // ── Bonding sell fee (F3 follow-up: skim curve exits into protocol revenue) ─────────

    /// @dev sellBonding skims bondingFeeBps from the gross refund to the treasury; the seller receives
    ///      the net, the reserve is debited the FULL gross refund, and reserve == balance is preserved.
    function test_SellBondingWithFee_SkimsToTreasuryAndPreservesSolvency() public {
        _activateBonding();
        address treasury = address(0xFEE);

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        instance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);

        uint256 refund = _getRefund(instance, buyAmount);
        uint256 sellFee = (refund * instance.bondingFeeBps()) / 10000;
        uint256 netRefund = refund - sellFee;
        assertGt(sellFee, 0, "precondition: nonzero sell fee");

        uint256 treasuryBefore = treasury.balance;
        uint256 reserveBefore = instance.reserve();
        uint256 userBefore = user1.balance;

        vm.expectEmit(true, false, false, true);
        emit ERC404BondingInstance.BondingFeePaid(user1, sellFee);
        // minRefund is the seller's NET floor — passing exactly netRefund must succeed.
        instance.sellBonding(buyAmount, netRefund, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        assertEq(treasury.balance - treasuryBefore, sellFee, "treasury receives the sell skim");
        assertEq(user1.balance - userBefore, netRefund, "seller receives refund net of fee");
        assertEq(reserveBefore - instance.reserve(), refund, "reserve debited the full gross refund");
        assertEq(instance.reserve(), address(instance).balance, "reserve == balance after sell");
    }

    /// @dev minRefund is enforced against the NET (post-fee) proceeds: a floor above net reverts.
    function test_SellBondingWithFee_MinRefundIsNetOfFee() public {
        _activateBonding();
        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        instance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);

        uint256 refund = _getRefund(instance, buyAmount);
        // Asking for the full gross refund as the floor must revert — the seller only nets refund-fee.
        vm.expectRevert(InvalidRefund.selector);
        instance.sellBonding(buyAmount, refund, bytes32(0), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev Zero fee rate ⇒ no skim: the seller receives the full curve refund.
    function test_SellBonding_NoFeeWhenRateZero() public {
        vm.startPrank(owner);
        ERC404BondingInstance zeroImpl = new ERC404BondingInstance();
        ERC404BondingInstance zeroFeeInstance = ERC404BondingInstance(payable(LibClone.clone(address(zeroImpl))));
        _initInstance(zeroFeeInstance, address(0xBEEF), address(0xFEE), 0); // bondingFeeBps = 0
        zeroFeeInstance.initializeMetadata("Zero Fee Token", "ZFT", "", "");
        uint256 futureTime = block.timestamp + 1 days;
        zeroFeeInstance.setBondingOpenTime(futureTime);
        zeroFeeInstance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        address treasury = address(0xFEE);
        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(zeroFeeInstance, buyAmount);
        zeroFeeInstance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);

        uint256 refund = _getRefund(zeroFeeInstance, buyAmount);
        uint256 treasuryBefore = treasury.balance;
        uint256 userBefore = user1.balance;
        zeroFeeInstance.sellBonding(buyAmount, refund, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        assertEq(treasury.balance, treasuryBefore, "no skim when fee rate is zero");
        assertEq(user1.balance - userBefore, refund, "seller receives the full refund");
    }

    /// @dev BondingFeePaid is emitted on the SELL (exit) path only — buying is fee-free.
    function test_BondingFeePaid_OnSellNotBuy() public {
        _activateBonding();
        address treasury = address(0xFEE);

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);

        // Buy is fee-free: the treasury balance does not move.
        uint256 treasuryBefore = treasury.balance;
        instance.buyBonding{ value: cost }(buyAmount, cost, false, bytes32(0), bytes(""), 0);
        assertEq(treasury.balance, treasuryBefore, "buy must not pay a fee");

        // Sell pays the protocol fee → BondingFeePaid fires.
        uint256 refund = _getRefund(instance, buyAmount);
        uint256 sellFee = (refund * instance.bondingFeeBps()) / 10000;
        vm.expectEmit(true, false, false, true);
        emit ERC404BondingInstance.BondingFeePaid(user1, sellFee);
        instance.sellBonding(buyAmount, refund - sellFee, bytes32(0), bytes(""), 0);
        vm.stopPrank();
    }

    // ── Graduation Fee Math Tests ─────────────────────────────────────────────

    function test_GraduationSplit_MathCorrectness() public {
        uint256 deployETH = 15 ether;
        uint256 protocolFee = deployETH / 100;
        uint256 vaultCut = (deployETH * 19) / 100;
        uint256 ethForPool = deployETH - protocolFee - vaultCut;

        assertEq(protocolFee, 0.15 ether, "1% of 15 ETH should be 0.15 ETH");
        assertEq(vaultCut, 2.85 ether, "19% of 15 ETH should be 2.85 ETH");
        assertEq(ethForPool, 12 ether, "80% of 15 ETH should be 12 ETH");
    }

    function test_GraduationFee_SmallAmountPrecision() public {
        uint256 deployETH = 0.01 ether;
        uint256 feeBps = 200;
        uint256 fee = (deployETH * feeBps) / 10000;
        assertEq(fee, 0.0002 ether);
        assertGt(fee, 0);
    }

    // ── deployLiquidity Tests ─────────────────────────────────────────────────

    function test_deployLiquidity_noParams() public {
        vm.prank(owner);
        vm.expectRevert(BondingNotConfigured.selector);
        instance.deployLiquidity(0);
    }

    function test_deployLiquidity_revertsForNonOwner() public {
        _activateBonding();

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        instance.buyBonding{ value: cost + fee }(buyAmount, cost + fee, false, bytes32(0), bytes(""), 0);

        // Graduation is a creator action: a non-owner is rejected even after buying into the curve.
        vm.expectRevert(Ownable.Unauthorized.selector);
        instance.deployLiquidity(0);
        vm.stopPrank();
    }

    /// @notice The permissionless full/matured path is gone: a non-owner is rejected even once the
    ///         curve has matured (previously anyone could graduate a matured curve). All other guards
    ///         are satisfied (open, active, reserve > 0, not graduated) so the ONLY reason it reverts
    ///         is the owner gate.
    function test_deployLiquidity_revertsForNonOwner_evenWhenMatured() public {
        vm.startPrank(owner);
        uint256 openTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(openTime);
        instance.setBondingMaturityTime(openTime + 1 days);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(openTime);

        // Non-zero reserve so NoReserve() can't be why it reverts.
        vm.deal(user1, 100 ether);
        vm.startPrank(user1);
        uint256 amount = 1000 * 1e18;
        uint256 cost = _getCost(instance, amount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        instance.buyBonding{ value: cost + fee }(amount, cost + fee, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();

        // Warp past maturity — the condition that USED to make graduation permissionless.
        vm.warp(openTime + 1 days + 1);

        vm.prank(user2);
        vm.expectRevert(Ownable.Unauthorized.selector);
        instance.deployLiquidity(0);

        assertFalse(instance.graduated(), "matured curve must not graduate from a non-owner call");
    }

    /// @notice The owner bypass is retained: the owner can graduate a curve that is NEITHER full NOR
    ///         matured. This is the whole point of owner-only (vs a pure full/matured gate) — the
    ///         creator decides when to graduate.
    function test_deployLiquidity_ownerGraduatesBeforeFullOrMaturity() public {
        MockLiquidityDeployer mockDepl = new MockLiquidityDeployer();
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        inst2.initialize(owner, address(0xBEEF), _bondingParams(), address(mockDepl), address(0));
        inst2.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGlobalMsgRegistry,
                protocolTreasury: address(0),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 0,
                weth: address(0xBEEF)
            })
        );
        inst2.initializeMetadata("T", "T", "", "");
        uint256 openTime = block.timestamp + 1 days;
        inst2.setBondingOpenTime(openTime);
        inst2.setBondingMaturityTime(openTime + 30 days); // maturity far in the future
        inst2.setBondingActive(true);
        vm.stopPrank();
        vm.warp(openTime);

        // A small buy — nowhere near the cap — and we sit well before maturity.
        uint256 amount = 1000 ether;
        uint256 cost = _getCost(inst2, amount);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst2.buyBonding{ value: cost }(amount, cost, false, bytes32(0), "", 0);
        assertFalse(inst2.graduated());

        vm.prank(owner);
        inst2.deployLiquidity(0);

        assertTrue(inst2.graduated(), "owner may graduate a partial, un-matured curve");
        assertTrue(mockDepl.called(), "liquidity deployer module must be invoked");
    }

    function test_deployLiquidity_requiresReserve() public {
        _activateBonding();
        vm.prank(owner);
        vm.expectRevert(NoReserve.selector);
        instance.deployLiquidity(0);
    }

    // ── Creator carve (graduation carve-out) ─────────────────────────────────

    /// @dev Build + open a fresh instance with a custom declaredMaxAllowanceBps, wired to a
    ///      recording mock deployer. factory == owner (an EOA) — exactly the pre-carve harness —
    ///      so these tests also prove which paths do NOT touch the factory.
    function _freshCarveInstance(uint16 declaredBps, MockLiquidityDeployer depl)
        internal
        returns (ERC404BondingInstance inst)
    {
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        ERC404BondingInstance.BondingParams memory bp = _bondingParams();
        bp.declaredMaxAllowanceBps = declaredBps;
        inst.initialize(owner, address(0xBEEF), bp, address(depl), address(0));
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGlobalMsgRegistry,
                protocolTreasury: address(0),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 0,
                weth: address(0xBEEF)
            })
        );
        inst.initializeMetadata("T", "T", "", "");
        uint256 openTime = block.timestamp + 1 days;
        inst.setBondingOpenTime(openTime);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(openTime);
    }

    function test_initialize_revertsOnDeclaredMaxOver10000() public {
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        ERC404BondingInstance.BondingParams memory bp = _bondingParams();
        bp.declaredMaxAllowanceBps = 10001;
        vm.expectRevert(InvalidDeclaredMaxAllowance.selector);
        inst2.initialize(owner, address(0xBEEF), bp, mockLiquidityDeployer, address(0));
        vm.stopPrank();
    }

    /// @notice declaredMax == 0 short-circuits BEFORE the factory call: a nonzero request still
    ///         graduates with carve 0 even though the "factory" here is a code-less EOA (any
    ///         factory read would revert). creator is still forwarded as owner().
    function test_deployLiquidity_declaredZero_skipsFactoryEntirely() public {
        MockLiquidityDeployer depl = new MockLiquidityDeployer();
        ERC404BondingInstance inst = _freshCarveInstance(0, depl);

        uint256 amount = 1_000_000 ether;
        uint256 cost = _getCost(inst, amount);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(amount, cost, false, bytes32(0), "", 0);

        vm.prank(owner);
        inst.deployLiquidity(10000);

        assertTrue(inst.graduated());
        (,,,,,, address creatorArg, uint256 carveArg) = depl.lastParams();
        assertEq(creatorArg, owner, "creator must be owner()");
        assertEq(carveArg, 0, "declaredMax 0 -> carve 0, no factory dependency");
    }

    /// @notice request == 0 short-circuits the same way — today's graduation, byte for byte.
    function test_deployLiquidity_zeroRequest_skipsFactoryEntirely() public {
        MockLiquidityDeployer depl = new MockLiquidityDeployer();
        ERC404BondingInstance inst = _freshCarveInstance(10000, depl);

        uint256 amount = 1_000_000 ether;
        uint256 cost = _getCost(inst, amount);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(amount, cost, false, bytes32(0), "", 0);

        vm.prank(owner);
        inst.deployLiquidity(0);

        assertTrue(inst.graduated());
        (,,,,,, address creatorArg, uint256 carveArg) = depl.lastParams();
        assertEq(creatorArg, owner, "creator must be owner()");
        assertEq(carveArg, 0, "request 0 -> carve 0");
    }

    /// @notice With a declared max and a nonzero request, the instance asks the factory's
    ///         effectiveCarveEth(raise, declaredMax, request) LIVE and forwards the resolved ETH
    ///         amount to the module untouched.
    function test_deployLiquidity_forwardsFactoryResolvedCarve() public {
        MockLiquidityDeployer depl = new MockLiquidityDeployer();
        ERC404BondingInstance inst = _freshCarveInstance(8000, depl);

        uint256 amount = 1_000_000 ether;
        uint256 cost = _getCost(inst, amount);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst.buyBonding{ value: cost }(amount, cost, false, bytes32(0), "", 0);

        uint256 raise = inst.reserve();
        // The instance's factory is the owner EOA here — mock its carve-math endpoint with EXACT
        // calldata so the test also pins the (raise, declaredMax, request) argument wiring.
        vm.mockCall(
            owner,
            abi.encodeWithSelector(ICarveParamsSource.effectiveCarveEth.selector, raise, uint256(8000), uint256(4000)),
            abi.encode(uint256(0.37 ether))
        );
        assertEq(inst.previewCarve(4000), 0.37 ether, "previewCarve routes through the factory");

        vm.prank(owner);
        inst.deployLiquidity(4000);

        (,,,,,, address creatorArg, uint256 carveArg) = depl.lastParams();
        assertEq(creatorArg, owner, "creator must be owner()");
        assertEq(carveArg, 0.37 ether, "resolved carve forwarded to the module");
    }

    // ── Vault migration tests ─────────────────────────────────────────────────

    function test_MigrateVault_UpdatesActiveVault() public {
        address newVault = makeAddr("newVault");
        vm.mockCall(
            mockMasterRegistry,
            abi.encodeWithSignature("migrateVault(address,address)", address(instance), newVault),
            abi.encode()
        );
        vm.prank(owner);
        instance.migrateVault(newVault);
        assertEq(address(instance.vault()), newVault);
    }

    function test_ClaimAllFees_IteratesAllVaults() public {
        address vault1 = address(0xBEEF);
        address vault2 = makeAddr("vault2");

        address[] memory vaults = new address[](2);
        vaults[0] = vault1;
        vaults[1] = vault2;

        vm.mockCall(
            mockMasterRegistry,
            abi.encodeWithSignature("getInstanceVaults(address)", address(instance)),
            abi.encode(vaults)
        );
        vm.mockCall(vault1, abi.encodeWithSignature("claimFees()"), abi.encode(uint256(0)));
        vm.mockCall(vault2, abi.encodeWithSignature("claimFees()"), abi.encode(uint256(0)));

        vm.prank(owner);
        instance.claimAllFees();
    }

    function test_MigrateVault_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        instance.migrateVault(makeAddr("newVault"));
    }

    // ── New gating + deployer tests (TDD) ────────────────────────────────────

    function test_gatingActive_startsTrue_whenGatingModuleSet() public {
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        address mockGating = address(new MockGatingModule());
        inst2.initialize(owner, address(0xBEEF), _bondingParams(), mockLiquidityDeployer, mockGating);
        vm.stopPrank();
        assertTrue(inst2.gatingActive());
    }

    function test_gatingActive_startsFalse_whenNoGatingModule() public view {
        assertFalse(instance.gatingActive());
    }

    function test_gating_selfDeactivates_whenPermanent() public {
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        address mockGating = address(new PermanentGatingModule());
        inst2.initialize(owner, address(0xBEEF), _bondingParams(), mockLiquidityDeployer, mockGating);
        inst2.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGlobalMsgRegistry,
                protocolTreasury: address(0xFEE),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        inst2.initializeMetadata("T", "T", "", "");
        uint256 futureTime = block.timestamp + 1 days;
        inst2.setBondingOpenTime(futureTime);
        inst2.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        assertTrue(inst2.gatingActive());

        uint256 amount = 1_000_000 ether; // 1 UNIT
        uint256 cost = _getCost(inst2, amount);
        uint256 fee = (cost * inst2.bondingFeeBps()) / 10000;
        vm.deal(user1, cost + fee);
        vm.prank(user1);
        inst2.buyBonding{ value: cost + fee }(amount, cost + fee, false, bytes32(0), "", 0);

        assertFalse(inst2.gatingActive());
    }

    function test_deployLiquidity_callsUniformInterface() public {
        MockLiquidityDeployer mockDepl = new MockLiquidityDeployer();
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        inst2.initialize(owner, address(0xBEEF), _bondingParams(), address(mockDepl), address(0));
        inst2.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGlobalMsgRegistry,
                protocolTreasury: address(0),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 0,
                weth: address(0xBEEF)
            })
        );
        inst2.initializeMetadata("T", "T", "", "");
        uint256 futureTime = block.timestamp + 1 days;
        inst2.setBondingOpenTime(futureTime);
        inst2.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        uint256 amount = 1_000_000 ether;
        uint256 cost = _getCost(inst2, amount);
        vm.deal(user1, cost);
        vm.prank(user1);
        inst2.buyBonding{ value: cost }(amount, cost, false, bytes32(0), "", 0);

        vm.prank(owner);
        inst2.deployLiquidity(0);

        assertTrue(inst2.graduated());
        assertTrue(mockDepl.called());
    }

    function test_initialize_noHookParam() public {
        vm.startPrank(owner);
        ERC404BondingInstance impl2 = new ERC404BondingInstance();
        ERC404BondingInstance inst2 = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));
        inst2.initialize(owner, address(0xBEEF), _bondingParams(), mockLiquidityDeployer, address(0));
        vm.stopPrank();
    }

    function test_buy_doesNotRequireHook() public {
        vm.startPrank(owner);
        uint256 futureTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(futureTime);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(futureTime);

        vm.deal(user1, 10 ether);
        vm.startPrank(user1);
        uint256 buyAmount = 1000 * 1e18;
        uint256 cost = _getCost(instance, buyAmount);
        uint256 fee = (cost * instance.bondingFeeBps()) / 10000;
        instance.buyBonding{ value: cost + fee }(buyAmount, cost + fee, false, bytes32(0), bytes(""), 0);
        vm.stopPrank();
        assertGt(instance.balanceOf(user1), 0);
    }
}
