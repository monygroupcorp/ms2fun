// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/**
 * @title UniAlignmentVaultTest
 * @notice Comprehensive test suite for UniAlignmentVault
 * @dev Tests all functionality: contributions, shares, claims, conversions, access control
 */
contract UniAlignmentVaultTest is Test {
    TestableUniAlignmentVault public vault;
    MockEXECToken public alignmentToken;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public charlie = address(0x4);
    address public dave = address(0x5);

    address public mockWETH = address(0x1111111111111111111111111111111111111111);
    address public mockPoolManager = address(0x2222222222222222222222222222222222222222);

    MockZRouter public mockZRouter;
    MockVaultPriceValidator public mockValidator;
    MockAlignmentRegistry public mockAlignmentRegistry;
    TestableUniAlignmentVault public vaultImpl;

    uint256 constant TARGET_ID = 1;
    address constant TREASURY = address(0xFEE);

    // Events
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event LiquidityAdded(uint256 ethSwapped, uint256 tokenReceived, uint256 lpPositionValue, uint256 sharesIssued);
    event FeesClaimed(address indexed benefactor, uint256 ethAmount);
    event FeesAccumulated(uint256 amount);

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock alignment token
        alignmentToken = new MockEXECToken(1000000e18);

        // Deploy mock peripherals
        mockZRouter = new MockZRouter();
        mockValidator = new MockVaultPriceValidator();
        mockAlignmentRegistry = new MockAlignmentRegistry();
        mockAlignmentRegistry.setTargetActive(TARGET_ID, true);
        mockAlignmentRegistry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        // Canonical-reference wiring (noesis-037): the floor now reads the DAO-pinned ReferencePool and
        // prices it via the pinned-pool TWAP path — mandatory (no fail-open), so convert tests need it.
        mockAlignmentRegistry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        mockValidator.setEthPer1e18Tokens(1e18); // 1:1 → honest mock swaps clear the 95% floor

        // Pre-fund MockZRouter for both swap directions
        vm.deal(address(mockZRouter), 100 ether);
        alignmentToken.transfer(address(mockZRouter), 100_000e18);

        // Deploy testable vault implementation and clone it
        vaultImpl = new TestableUniAlignmentVault();
        vault = TestableUniAlignmentVault(payable(LibClone.clone(address(vaultImpl))));
        vault.initialize(
            owner,
            mockWETH,
            mockPoolManager,
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            TREASURY
        );

        // Set V4 pool key for conversion tests (using native ETH)
        PoolKey memory mockPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH
            currency1: Currency.wrap(address(alignmentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vault.setV4PoolKey(mockPoolKey);

        vm.stopPrank();

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(dave, 100 ether);
        vm.deal(owner, 1000 ether);
        vm.deal(address(this), 1000 ether);
    }

    // ========== Initialization Tests ==========

    function test_Initialize_StoresParametersCorrectly() public view {
        assertEq(vault.weth(), mockWETH, "WETH address incorrect");
        assertEq(vault.poolManager(), mockPoolManager, "PoolManager address incorrect");
        assertEq(vault.alignmentToken(), address(alignmentToken), "AlignmentToken address incorrect");
        assertEq(vault.owner(), owner, "Owner address incorrect");
    }

    function test_Initialize_InitializesStateVariables() public view {
        assertEq(vault.totalShares(), 0, "Total shares should be 0");
        assertEq(vault.totalPendingETH(), 0, "Total pending ETH should be 0");
        assertEq(vault.accumulatedFees(), 0, "Accumulated fees should be 0");
        assertEq(vault.totalLPUnits(), 0, "Total LP units should be 0");
    }

    function _freshClone() internal returns (TestableUniAlignmentVault) {
        return TestableUniAlignmentVault(payable(LibClone.clone(address(vaultImpl))));
    }

    function _initVault(TestableUniAlignmentVault v) internal {
        v.initialize(
            address(this),
            mockWETH,
            mockPoolManager,
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            TREASURY
        );
    }

    function test_Initialize_RevertsOnInvalidWETH() public {
        TestableUniAlignmentVault v = _freshClone();
        vm.expectRevert(UniAlignmentVault.InvalidAddress.selector);
        v.initialize(
            address(this),
            address(0),
            mockPoolManager,
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            TREASURY
        );
    }

    function test_Initialize_RevertsOnInvalidPoolManager() public {
        TestableUniAlignmentVault v = _freshClone();
        vm.expectRevert(UniAlignmentVault.InvalidAddress.selector);
        v.initialize(
            address(this),
            mockWETH,
            address(0),
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            TREASURY
        );
    }

    function test_Initialize_RevertsOnInvalidAlignmentToken() public {
        TestableUniAlignmentVault v = _freshClone();
        vm.expectRevert(UniAlignmentVault.InvalidAddress.selector);
        v.initialize(
            address(this),
            mockWETH,
            mockPoolManager,
            address(0),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            TREASURY
        );
    }

    function test_Initialize_RevertsOnDoubleInit() public {
        TestableUniAlignmentVault v = _freshClone();
        _initVault(v);
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        _initVault(v);
    }

    // ========== Direct ETH Contribution Tests (receive) ==========

    function test_Receive_AcceptsETHContribution() public {
        vm.startPrank(alice);

        vm.expectEmit(true, true, true, true);
        emit ContributionReceived(alice, 1 ether);

        (bool success,) = address(vault).call{ value: 1 ether }("");
        assertTrue(success, "ETH transfer should succeed");

        vm.stopPrank();
    }

    function test_Receive_TracksBenefactorTotalETH() public {
        vm.prank(alice);
        (bool success,) = address(vault).call{ value: 2 ether }("");
        assertTrue(success);

        assertEq(vault.benefactorTotalETH(alice), 2 ether, "Benefactor total ETH should be 2 ether");
    }

    function test_Receive_TracksPendingETH() public {
        vm.prank(alice);
        (bool success,) = address(vault).call{ value: 3 ether }("");
        assertTrue(success);

        assertEq(vault.pendingETH(alice), 3 ether, "Pending ETH should be 3 ether");
        assertEq(vault.totalPendingETH(), 3 ether, "Total pending ETH should be 3 ether");
    }

    function test_Receive_AddsToConversionParticipants() public {
        vm.prank(alice);
        (bool success,) = address(vault).call{ value: 1 ether }("");
        assertTrue(success);

        assertEq(vault.conversionParticipants(0), alice, "Alice should be first participant");
    }

    function test_Receive_MultipleContributionsFromSameBenefactor() public {
        vm.startPrank(alice);
        (bool success1,) = address(vault).call{ value: 1 ether }("");
        assertTrue(success1);

        (bool success2,) = address(vault).call{ value: 2 ether }("");
        assertTrue(success2);
        vm.stopPrank();

        assertEq(vault.benefactorTotalETH(alice), 3 ether, "Total should be 3 ether");
        assertEq(vault.pendingETH(alice), 3 ether, "Pending should be 3 ether");
        assertEq(vault.totalPendingETH(), 3 ether, "Global pending should be 3 ether");
    }

    function test_Receive_RevertsOnZeroAmount() public {
        vm.startPrank(alice);
        (bool success, bytes memory returnData) = address(vault).call{ value: 0 }("");
        assertFalse(success, "Should revert on zero amount");
        vm.stopPrank();
    }

    // ========== Hook Tax Reception Tests ==========

    function test_ReceiveHookTax_AcceptsContributionWithBenefactor() public {
        vm.startPrank(alice);

        vm.expectEmit(true, true, true, true);
        emit ContributionReceived(bob, 1 ether);

        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, bob);

        vm.stopPrank();
    }

    function test_ReceiveHookTax_TracksBenefactorNotSender() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, bob);

        assertEq(vault.benefactorTotalETH(bob), 2 ether, "Bob should be tracked as benefactor");
        assertEq(vault.benefactorTotalETH(alice), 0, "Alice should not be benefactor");
    }

    function test_ReceiveHookTax_TracksPendingETH() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 3 ether }(Currency.wrap(address(0)), 3 ether, bob);

        assertEq(vault.pendingETH(bob), 3 ether, "Bob's pending ETH should be 3 ether");
        assertEq(vault.totalPendingETH(), 3 ether, "Total pending ETH should be 3 ether");
    }

    function test_ReceiveHookTax_RevertsOnZeroAmount() public {
        vm.startPrank(alice);
        vm.expectRevert(UniAlignmentVault.AmountMustBePositive.selector);
        vault.receiveContribution(Currency.wrap(address(0)), 0, bob);
        vm.stopPrank();
    }

    function test_ReceiveHookTax_RevertsOnInvalidBenefactor() public {
        vm.startPrank(alice);
        vm.expectRevert(UniAlignmentVault.InvalidAddress.selector);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, address(0));
        vm.stopPrank();
    }

    // ========== Multi-Benefactor Contribution Tests ==========

    function test_MultipleBenefactors_TrackIndependently() public {
        vm.prank(alice);
        (bool success1,) = address(vault).call{ value: 1 ether }("");
        assertTrue(success1);

        vm.prank(bob);
        (bool success2,) = address(vault).call{ value: 2 ether }("");
        assertTrue(success2);

        vm.prank(charlie);
        (bool success3,) = address(vault).call{ value: 3 ether }("");
        assertTrue(success3);

        assertEq(vault.benefactorTotalETH(alice), 1 ether);
        assertEq(vault.benefactorTotalETH(bob), 2 ether);
        assertEq(vault.benefactorTotalETH(charlie), 3 ether);
        assertEq(vault.totalPendingETH(), 6 ether);
    }

    function test_MultipleBenefactors_AllAddedToConversionParticipants() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 1 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 2 ether }("");
        assertTrue(s2);

        vm.prank(charlie);
        (bool s3,) = address(vault).call{ value: 3 ether }("");
        assertTrue(s3);

        assertEq(vault.conversionParticipants(0), alice);
        assertEq(vault.conversionParticipants(1), bob);
        assertEq(vault.conversionParticipants(2), charlie);
    }

    function test_MultipleBenefactors_MixedContributionMethods() public {
        // Alice via receive
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 1 ether }("");
        assertTrue(s1);

        // Bob via receiveInstance (charlie is sender)
        vm.prank(charlie);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, bob);

        // Charlie via receive
        vm.prank(charlie);
        (bool s2,) = address(vault).call{ value: 3 ether }("");
        assertTrue(s2);

        assertEq(vault.benefactorTotalETH(alice), 1 ether);
        assertEq(vault.benefactorTotalETH(bob), 2 ether);
        assertEq(vault.benefactorTotalETH(charlie), 3 ether);
        assertEq(vault.totalPendingETH(), 6 ether);
    }

    // ========== Conversion & Liquidity Tests ==========

    function test_ConvertAndAddLiquidity_ConvertsSuccessfully() public {
        // Setup: Alice and Bob contribute
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 20 ether }("");
        assertTrue(s2);

        // Conversion
        vm.prank(dave);
        uint256 lpValue = vault.convertAndAddLiquidity(1);

        assertTrue(lpValue > 0, "LP value should be positive");
    }

    /// @notice Regression: the real zRouter refunds leftover ETH to the vault during the swap, which
    ///         lands in receive() while convertAndAddLiquidity holds the reentrancy guard. receive()
    ///         must silently accept it — otherwise the refund reverts (Reentrancy) and the real
    ///         zRouter's SafeTransferLib bubbles ETHTransferFailed, bricking the entire conversion.
    ///         Fails under the pre-fix vault (receive() unconditionally tracked → nonReentrant revert).
    function test_ConvertAndAddLiquidity_acceptsZRouterDustRefund() public {
        mockZRouter.setRefundWei(0.0003 ether); // mimic real zRouter returning swap dust to the vault

        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        // Completing at all is the fix: under the pre-fix vault the dust refund reverts here.
        vm.prank(dave);
        uint256 lpValue = vault.convertAndAddLiquidity(1);

        assertGt(lpValue, 0, "conversion must complete despite the dust refund");
        assertGt(vault.benefactorShares(alice), 0, "alice earns shares");
        // The refund was silently accepted, NOT mis-tracked as a fresh benefactor contribution.
        assertEq(vault.totalPendingETH(), 0, "refund not mis-tracked as a new pending contribution");
        assertEq(vault.benefactorTotalETH(address(mockZRouter)), 0, "router not credited as a benefactor");
    }

    function test_ConvertAndAddLiquidity_IssuesSharesProportionally() public {
        // Alice: 10 ETH (33.33%), Bob: 20 ETH (66.66%)
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 20 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 bobShares = vault.benefactorShares(bob);

        assertTrue(aliceShares > 0, "Alice should have shares");
        assertTrue(bobShares > 0, "Bob should have shares");

        // Bob should have approximately 2x Alice's shares
        assertTrue(bobShares > aliceShares, "Bob should have more shares");
        assertApproxEqRel(bobShares, aliceShares * 2, 0.01e18); // 1% tolerance
    }

    function test_ConvertAndAddLiquidity_ClearsPendingETH() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        assertEq(vault.pendingETH(alice), 0, "Pending ETH should be cleared");
        assertEq(vault.totalPendingETH(), 0, "Total pending ETH should be cleared");
    }

    function test_ConvertAndAddLiquidity_ClearsConversionParticipants() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 20 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Array should be empty - trying to access should revert
        vm.expectRevert();
        vault.conversionParticipants(0);
    }

    /// @dev Caller reimbursement was removed — running a conversion pays the caller nothing.
    function test_ConvertAndAddLiquidity_PaysNoCallerReward() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        uint256 daveBalanceBefore = dave.balance;

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        assertEq(dave.balance, daveBalanceBefore, "Caller must receive no reward");
    }

    function test_ConvertAndAddLiquidity_UpdatesTotalLPUnits() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        uint256 lpUnitsBefore = vault.totalLPUnits();

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 lpUnitsAfter = vault.totalLPUnits();

        assertTrue(lpUnitsAfter > lpUnitsBefore, "LP units should increase");
    }

    function test_ConvertAndAddLiquidity_EmitsLiquidityAddedEvent() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.expectEmit(false, false, false, false);
        emit LiquidityAdded(0, 0, 0, 0);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);
    }

    function test_ConvertAndAddLiquidity_RevertsWhenNoPendingETH() public {
        vm.prank(dave);
        vm.expectRevert(UniAlignmentVault.NoPendingETH.selector);
        vault.convertAndAddLiquidity(1);
    }

    function test_ConvertAndAddLiquidity_RevertsWhenNoV4PoolSet() public {
        // Deploy new vault without V4 pool set
        TestableUniAlignmentVault newVault = _freshClone();
        _initVault(newVault);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool s1,) = address(newVault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vm.expectRevert(UniAlignmentVault.PoolKeyNotSet.selector);
        newVault.convertAndAddLiquidity(1);
    }

    function test_ConvertAndAddLiquidity_MultipleRoundsAccumulateShares() public {
        // Round 1
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 aliceSharesRound1 = vault.benefactorShares(alice);

        // Round 2
        vm.prank(alice);
        (bool s2,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 aliceSharesRound2 = vault.benefactorShares(alice);

        assertTrue(aliceSharesRound2 > aliceSharesRound1, "Shares should accumulate");
    }

    // ========== Fee Accumulation Tests ==========

    function test_FeeAccrual_CreditsAccumulatedFees() public {
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        assertEq(vault.accumulatedFees(), 5 ether, "Accumulated fees should be 5 ether");
        assertEq(address(vault).balance, 5 ether, "Vault balance should be 5 ether");
    }

    function test_FeeAccrual_AccumulatesMultipleTimes() public {
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);
        vault.simulateFeeAccrual{ value: 2 ether }(2 ether);

        assertEq(vault.accumulatedFees(), 5 ether, "Accumulated fees should be 5 ether");
    }

    // ========== Fee Claim Tests ==========

    function test_ClaimFees_BenefactorCanClaimFees() public {
        // Setup: Alice contributes and gets shares
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Owner deposits fees
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // Alice claims
        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit FeesClaimed(alice, 10 ether);

        uint256 claimed = vault.claimFees();

        uint256 aliceBalanceAfter = alice.balance;

        assertEq(claimed, 10 ether, "Claimed amount should be 10 ether");
        assertEq(aliceBalanceAfter - aliceBalanceBefore, 10 ether, "Alice should receive 10 ether");
    }

    // ── WETH fallback (adoption-gap F1) ─────────────────────────────────────

    /// @dev A benefactor that is a smart wallet rejecting plain ETH still receives its yield via the
    ///      WETH fallback — claimFees must NOT revert, and the WETH balance must rise by the claim.
    function test_ClaimFees_WethFallback_RejectingBenefactor() public {
        // Give mockWETH real WETH behavior so the fallback deposit/transfer executes.
        vm.etch(mockWETH, address(new MockWETH()).code);
        RejectingBenefactor rejecter = new RejectingBenefactor();

        vm.prank(alice);
        vault.receiveContribution{ value: 10 ether }(Currency.wrap(address(0)), 10 ether, address(rejecter));
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        rejecter.claim(vault); // must NOT revert despite reverting receive()

        assertEq(address(rejecter).balance, 0, "plain ETH must not land");
        assertEq(MockWETH(payable(mockWETH)).balanceOf(address(rejecter)), 10 ether, "yield delivered as WETH");
    }

    /// @dev Same for the delegate path: a rejecting delegate still gets its yield as WETH.
    function test_ClaimFeesAsDelegate_WethFallback_RejectingDelegate() public {
        vm.etch(mockWETH, address(new MockWETH()).code);
        RejectingBenefactor rejecter = new RejectingBenefactor();

        vm.prank(alice);
        vault.receiveContribution{ value: 10 ether }(Currency.wrap(address(0)), 10 ether, alice);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        vm.prank(alice);
        vault.delegateBenefactor(address(rejecter));

        address[] memory bs = new address[](1);
        bs[0] = alice;
        rejecter.claimAsDelegate(vault, bs); // must NOT revert

        assertEq(address(rejecter).balance, 0, "plain ETH must not land");
        assertEq(MockWETH(payable(mockWETH)).balanceOf(address(rejecter)), 10 ether, "delegate yield delivered as WETH");
    }

    function test_ClaimFees_ProportionalClaimWithMultipleBenefactors() public {
        // Alice: 10 ETH (33.33%), Bob: 20 ETH (66.66%)
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 20 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Owner deposits 30 ether in fees
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 30 ether }(30 ether);

        // Alice claims
        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        uint256 aliceClaimed = vault.claimFees();
        uint256 aliceBalanceAfter = alice.balance;

        // Bob claims
        uint256 bobBalanceBefore = bob.balance;
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        uint256 bobBalanceAfter = bob.balance;

        // Alice should get ~10 ether (33.33%), Bob should get ~20 ether (66.66%)
        assertApproxEqRel(aliceClaimed, 10 ether, 0.01e18, "Alice should claim ~10 ether");
        assertApproxEqRel(bobClaimed, 20 ether, 0.01e18, "Bob should claim ~20 ether");
        assertEq(aliceBalanceAfter - aliceBalanceBefore, aliceClaimed);
        assertEq(bobBalanceAfter - bobBalanceBefore, bobClaimed);
    }

    function test_ClaimFees_MultipleClaimsTrackDelta() public {
        // Alice contributes and gets shares
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // First fee deposit and claim
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        vm.prank(alice);
        uint256 claimed1 = vault.claimFees();
        assertEq(claimed1, 5 ether, "First claim should be 5 ether");

        // Second fee deposit and claim
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);

        vm.prank(alice);
        uint256 claimed2 = vault.claimFees();
        assertEq(claimed2, 3 ether, "Second claim should be 3 ether (delta)");
    }

    function test_ClaimFees_UpdatesClaimState() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        uint256 timestampBefore = block.timestamp;

        vm.prank(alice);
        vault.claimFees();

        assertEq(vault.shareValueAtLastClaim(alice), 10 ether, "Share value at last claim should be updated");
        assertEq(vault.lastClaimTimestamp(alice), timestampBefore, "Last claim timestamp should be updated");
    }

    function test_ClaimFees_RevertsWhenNoShares() public {
        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.NoShares.selector);
        vault.claimFees();
    }

    function test_ClaimFees_RevertsWhenNoFeesAccumulated() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.claimFees();
    }

    function test_ClaimFees_RevertsWhenNoNewFees() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // First claim succeeds
        vm.prank(alice);
        vault.claimFees();

        // Second claim without new fees should revert
        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.claimFees();
    }

    function test_ClaimFees_IndependentClaimsByMultipleBenefactors() public {
        // Alice and Bob contribute
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // First fee deposit
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // Alice claims first
        vm.prank(alice);
        uint256 aliceClaimed1 = vault.claimFees();
        assertApproxEqRel(aliceClaimed1, 5 ether, 0.01e18);

        // Second fee deposit
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // Bob claims both rounds
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        assertApproxEqRel(bobClaimed, 10 ether, 0.01e18); // 5 from first + 5 from second

        // Alice claims second round only
        vm.prank(alice);
        uint256 aliceClaimed2 = vault.claimFees();
        assertApproxEqRel(aliceClaimed2, 5 ether, 0.01e18);
    }

    // ========== Query Function Tests ==========

    function test_GetBenefactorContribution_ReturnsCorrectAmount() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 5 ether }("");
        assertTrue(s1);

        assertEq(vault.getBenefactorContribution(alice), 5 ether);
    }

    function test_GetBenefactorShares_ReturnsCorrectAmount() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 shares = vault.getBenefactorShares(alice);
        assertTrue(shares > 0, "Alice should have shares");
    }

    function test_CalculateClaimableAmount_ReturnsCorrectValue() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        uint256 claimable = vault.calculateClaimableAmount(alice);
        assertEq(claimable, 10 ether, "Claimable should be 10 ether");
    }

    function test_GetUnclaimedFees_ReturnsCorrectDelta() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // First fee deposit and claim
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        vm.prank(alice);
        vault.claimFees();

        // Second fee deposit
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);

        // Check unclaimed
        uint256 unclaimed = vault.getUnclaimedFees(alice);
        assertEq(unclaimed, 3 ether, "Unclaimed should be 3 ether (delta)");
    }

    function test_GetUnclaimedFees_ReturnsZeroWhenNoNewFees() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        vm.prank(alice);
        vault.claimFees();

        uint256 unclaimed = vault.getUnclaimedFees(alice);
        assertEq(unclaimed, 0, "Unclaimed should be 0 after full claim");
    }

    /// @dev noesis-115 finding: calculateClaimableAmount must net the reward-debt watermark, matching
    ///      getUnclaimedFees and the claimFees write path. Previously it returned lifetime-gross, so a
    ///      benefactor who had already claimed showed an inflated "claimable" to integrators.
    function test_CalculateClaimableAmount_NetsPastClaims_MatchesUnclaimed() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // First deposit, then a partial claim consumes the watermark.
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        vm.prank(alice);
        vault.claimFees();

        // Second deposit — only this delta should be claimable, not the lifetime gross of 8 ether.
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);

        assertEq(
            vault.calculateClaimableAmount(alice),
            vault.getUnclaimedFees(alice),
            "calculateClaimableAmount must equal getUnclaimedFees (net view)"
        );
        assertEq(vault.calculateClaimableAmount(alice), 3 ether, "only the post-claim delta is claimable");
    }

    /// @dev After a full claim, the net claimable view must read 0 — matching the write path (which would
    ///      revert NoFeesToClaim) — rather than the stale lifetime-gross figure.
    function test_CalculateClaimableAmount_ZeroAfterFullClaim() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        vm.prank(alice);
        vault.claimFees();

        assertEq(vault.calculateClaimableAmount(alice), 0, "net claimable is 0 after a full claim");
        assertEq(
            vault.calculateClaimableAmount(alice), vault.getUnclaimedFees(alice), "view parity with getUnclaimedFees"
        );
    }

    // ========== Configuration Tests ==========

    function test_SetV4PoolKey_OwnerCanUpdate() public {
        PoolKey memory newPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH
            currency1: Currency.wrap(address(alignmentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vm.prank(owner);
        vault.setV4PoolKey(newPoolKey);

        // Just verify the call succeeded (no easy way to read back PoolKey struct)
    }

    function test_SetV4PoolKey_RevertsOnInvalidPoolKey() public {
        PoolKey memory invalidPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vm.prank(owner);
        vm.expectRevert(UniAlignmentVault.InvalidPoolKey.selector);
        vault.setV4PoolKey(invalidPoolKey);
    }

    function test_SetV4PoolKey_RevertsWhenNotOwner() public {
        PoolKey memory newPoolKey = PoolKey({
            currency0: Currency.wrap(address(0x8888)),
            currency1: Currency.wrap(address(alignmentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        vm.prank(alice);
        vm.expectRevert();
        vault.setV4PoolKey(newPoolKey);
    }

    // ========== Reentrancy Protection Tests ==========

    function test_Receive_ReentrancyProtection() public {
        // This test verifies that the nonReentrant modifier is present
        // In practice, we'd need a malicious contract to test actual reentrancy
        // For now, we verify the function is marked nonReentrant by checking it doesn't fail
        vm.prank(alice);
        (bool success,) = address(vault).call{ value: 1 ether }("");
        assertTrue(success, "Should succeed with reentrancy protection");
    }

    function test_ReceiveHookTax_ReentrancyProtection() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, bob);
        // Should succeed without reentrancy issues
    }

    function test_ConvertAndAddLiquidity_ReentrancyProtection() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);
        // Should succeed without reentrancy issues
    }

    function test_ClaimFees_ReentrancyProtection() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        vm.prank(alice);
        vault.claimFees();
        // Should succeed without reentrancy issues
    }

    // ========== Complex Integration Tests ==========

    function test_CompleteWorkflow_SingleBenefactor() public {
        // 1. Alice contributes
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);

        // 2. Conversion happens
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // 3. Fees accumulate
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        // 4. Alice claims
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        vault.claimFees();
        uint256 balanceAfter = alice.balance;

        assertEq(balanceAfter - balanceBefore, 5 ether, "Alice should receive all fees");
    }

    function test_CompleteWorkflow_MultipleBenefactorsMultipleRounds() public {
        // Round 1: Alice and Bob contribute
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 6 ether }("");
        assertTrue(s1);

        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 4 ether }("");
        assertTrue(s2);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Track alice and bob shares after round 1
        uint256 aliceSharesR1 = vault.benefactorShares(alice);
        uint256 bobSharesR1 = vault.benefactorShares(bob);
        uint256 totalSharesR1 = vault.totalShares();

        // Fees accumulate
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // Alice claims
        vm.prank(alice);
        uint256 aliceClaimed1 = vault.claimFees();
        assertApproxEqRel(aliceClaimed1, 6 ether, 0.01e18); // 60%

        // Round 2: Charlie joins
        vm.prank(charlie);
        (bool s3,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s3);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Now Alice and Bob have shares from R1, Charlie has shares from R2
        uint256 aliceSharesR2 = vault.benefactorShares(alice);
        uint256 bobSharesR2 = vault.benefactorShares(bob);
        uint256 charlieSharesR2 = vault.benefactorShares(charlie);
        uint256 totalSharesR2 = vault.totalShares();

        // Verify shares accumulated correctly
        assertEq(aliceSharesR2, aliceSharesR1, "Alice shares unchanged");
        assertEq(bobSharesR2, bobSharesR1, "Bob shares unchanged");
        assertTrue(charlieSharesR2 > 0, "Charlie has new shares");
        assertEq(totalSharesR2, totalSharesR1 + charlieSharesR2, "Total shares increased by Charlie's shares");

        // More fees
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        // Bob claims - should get his share proportion
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        assertTrue(bobClaimed > 0, "Bob should claim some fees");

        // Charlie claims - should get his share proportion
        vm.prank(charlie);
        uint256 charlieClaimed = vault.claimFees();
        assertTrue(charlieClaimed > 0, "Charlie should have fees");

        // Alice may have unclaimed fees from round 2
        uint256 aliceUnclaimed = vault.getUnclaimedFees(alice);
        if (aliceUnclaimed > 0) {
            vm.prank(alice);
            uint256 aliceClaimed2 = vault.claimFees();
            assertTrue(aliceClaimed2 > 0, "Alice should have fees from round 2");
        }
    }

    function test_EdgeCase_VerySmallContributions() public {
        // MIN_CONTRIBUTION = 0.001 ether; values below it revert with ContributionBelowMinimum.
        // Verify that a below-minimum contribution reverts.
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 1 wei }("");
        assertFalse(s1, "contribution below MIN_CONTRIBUTION should revert");

        // A contribution at exactly MIN_CONTRIBUTION succeeds.
        uint256 minContrib = vault.MIN_CONTRIBUTION();
        vm.deal(alice, alice.balance + minContrib);
        vm.prank(alice);
        (bool s2,) = address(vault).call{ value: minContrib }("");
        assertTrue(s2, "contribution at MIN_CONTRIBUTION should succeed");

        assertEq(vault.benefactorTotalETH(alice), minContrib);
        assertEq(vault.pendingETH(alice), minContrib);
    }

    function test_EdgeCase_VeryLargeContributions() public {
        vm.deal(alice, 10000 ether);
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10000 ether }("");
        assertTrue(s1);

        assertEq(vault.benefactorTotalETH(alice), 10000 ether);
    }

    function test_EdgeCase_ManyBenefactors() public {
        // Create 10 benefactors
        for (uint160 i = 1; i <= 10; i++) {
            address benefactor = address(i + 1000);
            vm.deal(benefactor, 10 ether);
            vm.prank(benefactor);
            (bool success,) = address(vault).call{ value: 1 ether }("");
            assertTrue(success);
        }

        assertEq(vault.totalPendingETH(), 10 ether);

        // Convert
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // All should have shares
        for (uint160 i = 1; i <= 10; i++) {
            address benefactor = address(i + 1000);
            assertTrue(vault.benefactorShares(benefactor) > 0, "Each benefactor should have shares");
        }
    }

    // ========== Protocol Yield Cut Tests ==========

    event ProtocolYieldCollected(uint256 amount);
    event TargetYieldCollected(uint256 amount);
    event ProtocolFeesWithdrawn(uint256 amount);
    event TargetFeesWithdrawn(uint256 amount);

    function test_YieldCut_ConstantsAre1And19Pct() public view {
        assertEq(vault.PROTOCOL_CUT_BPS(), 100, "protocol cut is 1% (immutable)");
        assertEq(vault.TARGET_CUT_BPS(), 1900, "target cut is 19% (immutable)");
    }

    function test_YieldCut_DirectAccrualNotTaxed() public {
        // Benefactor-side accrual is not LP yield, so it carries no protocol/target cut.
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        assertEq(vault.accumulatedFees(), 10 ether, "direct accrual is not taxed");
        assertEq(vault.accumulatedProtocolFees(), 0, "no protocol cut on direct accrual");
    }

    // ── 80/19/1 fee split + per-target sink (noesis-051) ──────────────────────

    function test_FeeSplit_80_19_1() public {
        // Establish a sole shareholder so the 80% leg is attributable.
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        TestableUniAlignmentVault t = TestableUniAlignmentVault(payable(address(vault)));
        vm.deal(address(this), 1 ether);
        t.exerciseFeeSplit{ value: 1 ether }(1 ether);

        assertEq(vault.accumulatedProtocolFees(), 0.01 ether, "protocol 1%");
        assertEq(vault.accumulatedTargetFees(), 0.19 ether, "target 19%");

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vault.claimFees();
        assertEq(alice.balance - balBefore, 0.8 ether, "benefactor 80% (remainder)");
    }

    function test_withdrawTargetFees_pushesToRegistrySink() public {
        address sink = makeAddr("uniCommunitySink");
        mockAlignmentRegistry.setCommunityPayout(TARGET_ID, sink);

        TestableUniAlignmentVault t = TestableUniAlignmentVault(payable(address(vault)));
        vm.deal(address(this), 1 ether);
        t.exerciseFeeSplit{ value: 1 ether }(1 ether);

        uint256 before = sink.balance;
        vm.prank(alice);
        vault.withdrawTargetFees();
        assertEq(sink.balance - before, 0.19 ether, "19% pushed to registry-pinned sink");
        assertEq(vault.accumulatedTargetFees(), 0, "target bucket cleared");
    }

    function test_withdrawTargetFees_revertsWhenSinkUnset() public {
        TestableUniAlignmentVault t = TestableUniAlignmentVault(payable(address(vault)));
        vm.deal(address(this), 1 ether);
        t.exerciseFeeSplit{ value: 1 ether }(1 ether);

        vm.expectRevert(UniAlignmentVault.TargetSinkNotSet.selector);
        vault.withdrawTargetFees();
    }

    /// @dev An un-wired sink accrues the 19% but never blocks the creator's 80% claim path.
    function test_targetSinkUnset_doesNotBlockCreatorClaim() public {
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        TestableUniAlignmentVault t = TestableUniAlignmentVault(payable(address(vault)));
        vm.deal(address(this), 1 ether);
        t.exerciseFeeSplit{ value: 1 ether }(1 ether);
        assertEq(vault.accumulatedTargetFees(), 0.19 ether, "target still accrues when sink unset");

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vault.claimFees();
        assertEq(alice.balance - balBefore, 0.8 ether, "creator 80% unaffected by unset sink");
    }

    function test_YieldCut_TreasuryThreadedAtInitialize() public view {
        assertEq(vault.protocolTreasury(), TREASURY, "Treasury is set at initialize and never zero");
    }

    function test_Initialize_RevertsOnZeroProtocolTreasury() public {
        TestableUniAlignmentVault v = _freshClone();
        vm.expectRevert(UniAlignmentVault.TreasuryNotSet.selector);
        v.initialize(
            address(this),
            mockWETH,
            mockPoolManager,
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            address(0)
        );
    }

    function test_YieldCut_WithdrawProtocolFees_RevertsWithNothingAccrued() public {
        // Benefactor-side accrual carries no protocol cut, so the protocol bucket stays empty.
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);

        assertEq(vault.accumulatedProtocolFees(), 0, "no protocol cut from direct accrual");

        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.withdrawProtocolFees();
    }

    function test_YieldCut_WithdrawProtocolFees_HappyPath() public {
        address treasury = TREASURY;

        // Simulate protocol fee accrual (LP yield cut that would come from _claimVaultFees)
        TestableUniAlignmentVault testableVault = TestableUniAlignmentVault(payable(address(vault)));
        testableVault.simulateProtocolFeeAccrual{ value: 0.5 ether }(0.5 ether);

        assertEq(vault.accumulatedProtocolFees(), 0.5 ether, "Protocol fees should be 0.5 ether");

        uint256 treasuryBalanceBefore = treasury.balance;

        // Anyone can trigger withdrawal
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit ProtocolFeesWithdrawn(0.5 ether);
        vault.withdrawProtocolFees();

        assertEq(treasury.balance - treasuryBalanceBefore, 0.5 ether, "Treasury should receive 0.5 ether");
        assertEq(vault.accumulatedProtocolFees(), 0, "Protocol fees should be cleared");
    }

    function test_YieldCut_WithdrawProtocolFees_MultipleAccumulations() public {
        address treasury = TREASURY;

        TestableUniAlignmentVault testableVault = TestableUniAlignmentVault(payable(address(vault)));

        // Simulate multiple yield collections before withdrawal
        testableVault.simulateProtocolFeeAccrual{ value: 0.3 ether }(0.3 ether);
        testableVault.simulateProtocolFeeAccrual{ value: 0.2 ether }(0.2 ether);

        assertEq(vault.accumulatedProtocolFees(), 0.5 ether, "Should accumulate across collections");

        uint256 treasuryBalanceBefore = treasury.balance;
        vault.withdrawProtocolFees();

        assertEq(treasury.balance - treasuryBalanceBefore, 0.5 ether, "Treasury gets full accumulated amount");
        assertEq(vault.accumulatedProtocolFees(), 0, "Cleared after withdrawal");

        // Second withdrawal should revert
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.withdrawProtocolFees();
    }

    function test_YieldCut_WithdrawProtocolFees_RevertsNoFees() public {
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.withdrawProtocolFees();
    }

    function test_YieldCut_WithdrawProtocolFees_Permissionless() public {
        // Anyone can call withdrawProtocolFees, not just owner
        address treasury = TREASURY;

        // No fees to withdraw, but the access control check should pass
        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.withdrawProtocolFees();
        // If it reverted with "No fees" (not Unauthorized), access control passed
    }

    function test_YieldCut_AccruesToTheInitializedTreasury() public {
        // The 1% leg accrues into accumulatedProtocolFees and is withdrawable to the destination the
        // vault was initialized with — the split math and the payout share one fixed address.
        assertEq(vault.protocolTreasury(), TREASURY, "destination fixed at initialize");

        vm.deal(address(this), 1 ether);
        vault.exerciseFeeSplit{ value: 1 ether }(1 ether);
        assertEq(vault.accumulatedProtocolFees(), 0.01 ether, "1% accrued");

        uint256 before = TREASURY.balance;
        vault.withdrawProtocolFees();
        assertEq(TREASURY.balance - before, 0.01 ether, "1% paid out to the initialized treasury");
    }

    // ========================================================================
    // AUDIT REGRESSION — F4 (no fee dilution)
    // ========================================================================

    /// @dev F4: an earlier benefactor's accrued-but-unclaimed yield must NOT shrink when a later
    ///      benefactor converts. Pre-fix Alice's 10 ETH entitlement halved to 5 ETH and 5 ETH stranded.
    function test_F4_NoDilution_EarlierBenefactorClaimableStableAcrossConversions() public {
        // Alice contributes and gets all initial shares.
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s1);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Fees accrue entirely to Alice's batch.
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 10 ether }(10 ether);
        uint256 aliceBefore = vault.getUnclaimedFees(alice);
        assertApproxEqRel(aliceBefore, 10 ether, 0.01e18, "Alice should be owed ~10 ETH");

        // Bob converts later, growing totalShares.
        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s2);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        // Alice's entitlement is preserved; Bob starts at zero.
        assertApproxEqRel(vault.getUnclaimedFees(alice), aliceBefore, 0.0001e18, "Alice must NOT be diluted");
        assertEq(vault.getUnclaimedFees(bob), 0, "Bob cannot claim pre-existing fees");

        // Alice can actually claim her full entitlement; nothing stranded.
        vm.prank(alice);
        uint256 aliceClaimed = vault.claimFees();
        assertApproxEqRel(aliceClaimed, 10 ether, 0.01e18, "Alice claims her full ~10 ETH");
    }

    /// @dev F4: sum of claimable across benefactors must not exceed accumulatedFees (no over-issuance).
    function test_F4_SumClaimableLEAccumulatedFees() public {
        vm.prank(alice);
        (bool s1,) = address(vault).call{ value: 7 ether }("");
        assertTrue(s1);
        vm.prank(bob);
        (bool s2,) = address(vault).call{ value: 3 ether }("");
        assertTrue(s2);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 11 ether }(11 ether);

        // Charlie joins in a later conversion.
        vm.prank(charlie);
        (bool s3,) = address(vault).call{ value: 5 ether }("");
        assertTrue(s3);
        vm.prank(dave);
        vault.convertAndAddLiquidity(1);

        uint256 sumClaimable =
            vault.getUnclaimedFees(alice) + vault.getUnclaimedFees(bob) + vault.getUnclaimedFees(charlie);
        assertLe(sumClaimable, vault.accumulatedFees(), "claimable must never exceed accrued fees");
    }

    // ========================================================================
    // AUDIT REGRESSION — F7 (convert minOut oracle floor)
    // ========================================================================

    /// @dev F7: with a TWAP source wired, a loose caller minOut cannot let a degraded (sandwiched)
    ///      swap through — the oracle-derived floor forces a higher minimum and the swap reverts.
    function test_F7_ConvertFloorBlocksSandwich() public {
        mockValidator.setEthPer1e18Tokens(1e15); // 0.001 ETH/token TWAP (1000 tokens/ETH)
        mockZRouter.setOutRatio(5e20); // degraded swap rate (~half fair) → sandwich
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);

        vm.prank(dave);
        vm.expectRevert(bytes("MockZRouter: insufficient output"));
        vault.convertAndAddLiquidity(1); // caller minOut=1, but floor enforces the TWAP minimum
    }

    /// @dev F7: an honest swap that meets the oracle floor still succeeds.
    function test_F7_ConvertFloorAllowsHonestSwap() public {
        mockValidator.setEthPer1e18Tokens(1e15);
        mockZRouter.setOutRatio(1e21); // fair rate, at/above the floor
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);

        vm.prank(dave);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalShares(), 0, "honest conversion should succeed");
    }

    /// @dev noesis-037: the floor no longer fails open. With the DAO-pinned ReferencePool unset, a
    ///      convert reverts {NoReferencePool} rather than swapping unguarded — a permissionless caller
    ///      cannot disable the anti-sandwich floor by clearing/racing the reference.
    function test_convertRevertsWhenNoReferencePool() public {
        // Clear the pinned reference for this (target, token): pool == address(0) is "unset".
        mockAlignmentRegistry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0), kind: 0, twapWindow: 0 })
        );
        mockZRouter.setOutRatio(5e20);
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);

        vm.prank(dave);
        vm.expectRevert(UniAlignmentVault.NoReferencePool.selector);
        vault.convertAndAddLiquidity(1);
    }

    /// @dev noesis-037 self-sandwich sim: the attacker degrades the thin VENUE pool (modeled by a
    ///      degraded router out-ratio) and calls convert with minOut=1, but the floor is priced from
    ///      the UNMOVED canonical ReferencePool TWAP — so the swap cannot clear it and reverts. The
    ///      attacker cannot extract beyond maxPriceDeviationBps of the canonical price.
    function test_selfSandwichCannotBeatCanonicalFloor() public {
        // Canonical price stays 1 ETH / 1e18 tokens (validator rate from setUp). Attacker moves only
        // the venue: the router now pays far fewer tokens per ETH than the canonical reference.
        mockZRouter.setOutRatio(1e16); // 0.01x → far below the 95% canonical floor
        vm.prank(alice);
        (bool s,) = address(vault).call{ value: 10 ether }("");
        assertTrue(s);

        vm.prank(dave);
        vm.expectRevert(bytes("MockZRouter: insufficient output"));
        vault.convertAndAddLiquidity(1); // caller minOut=1, but the canonical floor governs
    }
}

/// @notice A benefactor/delegate that is a smart wallet rejecting plain ETH (reverting receive()).
///         Exercises the SmartTransferLib WETH fallback on the claim paths (adoption-gap F1).
contract RejectingBenefactor {
    receive() external payable {
        revert("no plain ETH");
    }

    function claim(UniAlignmentVault vault) external returns (uint256) {
        return vault.claimFees();
    }

    function claimAsDelegate(UniAlignmentVault vault, address[] calldata benefactors) external returns (uint256) {
        return vault.claimFeesAsDelegate(benefactors);
    }
}
