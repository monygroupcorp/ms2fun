// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ZAMMAlignmentVault, IZAMM } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

contract ZAMMAlignmentVaultTest is Test {
    // Mirror events for expectEmit matching
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event Harvested(uint256 totalFees, uint256 benefactorFees, uint256 protocolFees, uint256 targetFees);
    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    ZAMMAlignmentVault public vault;
    ZAMMAlignmentVault public impl;
    MockZAMM public mockZamm;
    MockZRouter public mockZRouter;
    MockWETH public weth;
    MockEXECToken public alignmentToken;
    MockAlignmentRegistry public registry;
    MockVaultPriceValidator public validator;

    uint256 internal constant TARGET_ID = 1;
    address internal constant REF_POOL = address(0xBEEF);

    address public owner = address(0x1);
    address public treasury = address(0x99);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public charlie = address(0x4);

    IZAMM.PoolKey public poolKey;

    function setUp() public {
        alignmentToken = new MockEXECToken(1_000_000e18);
        mockZamm = new MockZAMM();
        mockZRouter = new MockZRouter();
        weth = new MockWETH();

        // Fund mocks
        vm.deal(address(mockZamm), 100 ether);
        vm.deal(address(mockZRouter), 100 ether);
        alignmentToken.transfer(address(mockZamm), 100_000e18);
        alignmentToken.transfer(address(mockZRouter), 100_000e18);

        poolKey = IZAMM.PoolKey({
            id0: 0,
            id1: 0,
            token0: address(0), // ETH
            token1: address(alignmentToken),
            feeOrHook: 30 // 0.3%
        });

        // Canonical-reference wiring: the anti-sandwich floor reads the DAO-pinned ReferencePool from
        // the registry and prices it via the validator's pinned-pool TWAP path. A usable reference is
        // mandatory now (no fail-open), so every convert/harvest path needs both set.
        registry = new MockAlignmentRegistry();
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: REF_POOL, kind: 0, twapWindow: 1800 })
        );
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(1e18); // 1 ETH per 1e18 tokens → honest 1:1 mock swaps clear the floor

        vm.prank(owner);
        impl = new ZAMMAlignmentVault();

        vault = ZAMMAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(mockZamm),
            address(mockZRouter),
            address(weth),
            address(alignmentToken),
            poolKey,
            treasury,
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // ── Initialization ──────────────────────────────────────────────

    function test_initialize_setsConfig() public view {
        assertEq(vault.zamm(), address(mockZamm));
        assertEq(vault.zRouter(), address(mockZRouter));
        assertEq(vault.alignmentToken(), address(alignmentToken));
        assertEq(vault.protocolTreasury(), treasury);
        assertEq(vault.PROTOCOL_CUT_BPS(), 100);
        assertEq(vault.TARGET_CUT_BPS(), 1900);
    }

    function test_initialize_locksPoolKey() public view {
        IZAMM.PoolKey memory k = vault.getPoolKey();
        assertEq(k.token0, address(0));
        assertEq(k.token1, address(alignmentToken));
        assertEq(k.feeOrHook, 30);
    }

    function test_initialize_revertIfCalledTwice() public {
        vm.expectRevert();
        vault.initialize(
            address(mockZamm),
            address(mockZRouter),
            address(weth),
            address(alignmentToken),
            poolKey,
            treasury,
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
    }

    // ── receiveInstance ──────────────────────────────────────────────

    function test_receiveInstance_tracksPending() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, alice);

        assertEq(vault.pendingETH(), 1 ether);
        assertEq(vault.pendingContribution(alice), 1 ether);
    }

    function test_receiveInstance_accumulatesMultiple() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, alice);

        vm.prank(bob);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, bob);

        assertEq(vault.pendingETH(), 3 ether);
        assertEq(vault.pendingContribution(alice), 1 ether);
        assertEq(vault.pendingContribution(bob), 2 ether);
    }

    function test_receiveInstance_emitsContributionReceived() public {
        vm.expectEmit(true, false, false, true);
        emit ContributionReceived(alice, 1 ether);

        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, alice);
    }

    function test_receiveInstance_revertOnNonEthCurrency() public {
        vm.expectRevert();
        vm.prank(alice);
        vault.receiveContribution{ value: 0 }(Currency.wrap(address(alignmentToken)), 1 ether, alice);
    }

    /// @dev Uni-parity hardening (noesis-119): the declared `amount` must equal the ETH sent.
    function test_receiveContribution_revertsOnAmountMismatch() public {
        vm.prank(alice);
        vm.expectRevert(ZAMMAlignmentVault.AmountMismatch.selector);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 2 ether, alice);
    }

    /// @dev Uni-parity hardening (noesis-119): receiveContribution is `nonReentrant`. A benefactor that
    ///      re-enters it from its claim-payout callback is blocked by the guard, so no phantom pending
    ///      contribution is registered mid-claim. Without the guard the reentrant call would succeed.
    function test_receiveContribution_reentrancyBlocked() public {
        ReentrantContributor attacker = new ReentrantContributor(vault);
        vm.deal(address(attacker), 1 ether);

        vm.prank(alice);
        vault.receiveContribution{ value: 4 ether }(Currency.wrap(address(0)), 4 ether, address(attacker));
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);
        _triggerHarvestWithFees();

        assertGt(vault.calculateClaimableAmount(address(attacker)), 0, "attacker has claimable yield");

        // The conversion carries the ratio-unconsumed residual back as the attacker's pending
        // contribution, so the check below is that the reentry adds NOTHING to that standing balance.
        uint256 pendingBefore = vault.pendingContribution(address(attacker));

        attacker.claim(); // claim payout hits attacker.receive() → reentry attempt

        assertTrue(attacker.reentryAttempted(), "attacker attempted reentry");
        assertFalse(attacker.reentrySucceeded(), "reentrant receiveContribution must be guard-blocked");
        assertEq(vault.pendingContribution(address(attacker)), pendingBefore, "no reentrant contribution registered");
    }

    function test_receive_tracksSenderAsBenefactor() public {
        vm.prank(alice);
        (bool ok,) = address(vault).call{ value: 0.5 ether }("");
        assertTrue(ok);
        assertEq(vault.pendingContribution(alice), 0.5 ether);
    }

    // ── convertAndAddLiquidity ────────────────────────────────────────────

    function _receiveFromAlice(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, alice);
    }

    function _setupPool(uint112 r0, uint112 r1) internal {
        uint256 pid = vault.poolId();
        mockZamm.setPool(pid, r0, r1, 0);
    }

    function test_convertAndAddLiquidity_mintsLP() public {
        _receiveFromAlice(1 ether);
        _setupPool(10 ether, 10_000e18);

        uint256 lpBefore = mockZamm.lpBalances(address(vault), vault.poolId());
        vault.convertAndAddLiquidity(0, 0, 0);
        uint256 lpAfter = mockZamm.lpBalances(address(vault), vault.poolId());

        assertGt(lpAfter, lpBefore, "LP should increase");
    }

    /// @dev Conversion clears everything it actually deploys. What survives is exactly the ETH the
    ///      pool's ratio refused, still owned by the benefactor who put it in — see
    ///      `test_convertAndAddLiquidity_recreditsUnconsumedEth`. Against a pool that consumes the
    ///      whole LP side, nothing survives.
    function test_convertAndAddLiquidity_clearsPending() public {
        _receiveFromAlice(2 ether);
        _setupPool(10 ether, 10_000e18);

        vault.convertAndAddLiquidity(0, 0, 0);

        uint256 residual = vault.pendingETH();
        assertLt(residual, 2 ether, "conversion must deploy most of the batch");
        assertEq(vault.pendingContribution(alice), residual, "only the residual survives, and it is alice's");
    }

    function test_convertAndAddLiquidity_tracksBenefactorContribution() public {
        _receiveFromAlice(1 ether);

        vm.prank(bob);
        vault.receiveContribution{ value: 3 ether }(Currency.wrap(address(0)), 3 ether, bob);

        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        uint256 aliceContrib = vault.benefactorContribution(alice);
        uint256 bobContrib = vault.benefactorContribution(bob);
        // Alice contributed 1/4, Bob contributed 3/4
        assertEq(aliceContrib * 3, bobContrib, "proportions wrong");
    }

    function test_convertAndAddLiquidity_growsPrincipal() public {
        _receiveFromAlice(1 ether);
        _setupPool(10 ether, 10_000e18);

        vault.convertAndAddLiquidity(0, 0, 0);

        assertGt(vault.principalETH(), 0, "principalETH should grow");
        assertGt(vault.principalToken(), 0, "principalToken should grow");
    }

    function test_convertAndAddLiquidity_revertIfNoPending() public {
        vm.expectRevert();
        vault.convertAndAddLiquidity(0, 0, 0);
    }

    /// @dev Caller reimbursement was removed — conversion pays the caller nothing.
    function test_convertAndAddLiquidity_paysNoCallerReward() public {
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        address caller = address(0xCAFE);
        vm.deal(caller, 0);
        vm.prank(caller);
        vault.convertAndAddLiquidity(0, 0, 0);

        assertEq(caller.balance, 0, "caller must receive no reward");
    }

    // ── harvest ───────────────────────────────────────────────────────────

    function _setupWithLiquidity() internal {
        _receiveFromAlice(4 ether);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);
    }

    function test_harvest_updatesAccumulator() public {
        _setupWithLiquidity();

        uint256 accBefore = vault.accRewardPerContribution();

        // Simulate fee accrual: set ethPerLp so removeLiquidity returns more than principal
        mockZamm.setEthPerLp(0.002 ether); // returns 2x
        mockZamm.setTokenPerLp(0.002 ether);

        vault.harvest(0);

        assertGt(vault.accRewardPerContribution(), accBefore, "accumulator should grow");
    }

    /// @dev Caller reimbursement was removed — harvest pays the caller nothing.
    function test_harvest_paysNoCallerReward() public {
        _setupWithLiquidity();

        vm.deal(address(mockZamm), 10 ether);
        mockZamm.setEthPerLp(0.002 ether);

        address caller = address(0xBEEF);
        vm.deal(caller, 0);
        vm.prank(caller);
        vault.harvest(0);

        assertEq(caller.balance, 0, "caller must receive no reward");
    }

    function test_harvest_emitsFeesAccumulated() public {
        _setupWithLiquidity();
        mockZamm.setEthPerLp(0.002 ether);
        mockZamm.setTokenPerLp(0.002 ether);
        vm.deal(address(mockZRouter), 10 ether);
        alignmentToken.transfer(address(mockZamm), 50_000e18);

        vm.expectEmit(false, false, false, false);
        emit Harvested(0, 0, 0, 0); // values ignored, just check event fires
        vault.harvest(0);
    }

    // ── harvest: IL-as-fees mislabel regression (audit #36 Tier-2) ──────────
    //
    // The vault holds the entire LP supply at a known 1:1 ratio so the invariant math is exact.
    // setOutRatio(1e18) makes the convert swap 1 ETH-wei → 1 token-wei, so after convert the pool
    // is reserves=(2e18, 2e18), supply=1000e18, lpHeld=1000e18 → principalInvariant = 2e18.
    function _seedSoleLP() internal {
        uint256 pid = vault.poolId();
        mockZamm.setPool(pid, 0, 0, 0); // empty pool: vault becomes the sole LP
        mockZRouter.setOutRatio(1e18); // 1 ETH-wei : 1 token-wei
        _receiveFromAlice(4 ether);
        vault.convertAndAddLiquidity(0, 0, 0);
    }

    /// @dev THE fix: pure price movement (token appreciates → ETH-side reserve rises) at constant k
    ///      must NOT be harvested as fees. Under the old `reserve0*share > principalETH` heuristic this
    ///      paid out impermanent loss / principal as phantom "yield", bleeding the alignment LP.
    function test_harvest_ignoresPurePriceMovement() public {
        _seedSoleLP();
        uint256 accBefore = vault.accRewardPerContribution();
        uint256 lpBefore = mockZamm.lpBalances(address(vault), vault.poolId());

        // Move price hard while holding k constant: 2*2 = 4 == 4*1. sqrt(k)/share is unchanged,
        // but the ETH-side reserve doubled — exactly the IL signal the old code mistook for fees.
        mockZamm.setPool(vault.poolId(), 4 ether, 1 ether, 1000 ether);

        vm.roll(block.number + 1);
        uint256 fees = vault.harvest(0);

        assertEq(fees, 0, "pure price movement must yield zero fees");
        assertEq(vault.accRewardPerContribution(), accBefore, "accumulator must not move on IL");
        assertEq(
            mockZamm.lpBalances(address(vault), vault.poolId()),
            lpBefore,
            "no principal LP may be burned on pure price movement"
        );
    }

    /// @dev Counterpart: genuine fee growth (k rises, supply fixed) IS detected and harvested.
    function test_harvest_detectsInvariantGrowth() public {
        _seedSoleLP();
        uint256 accBefore = vault.accRewardPerContribution();
        vm.deal(address(mockZamm), 100 ether);

        // Real LP fees retained in the pool: both reserves +10% → k grows, sqrt(k)/share rises.
        mockZamm.setPool(vault.poolId(), 2.2 ether, 2.2 ether, 1000 ether);

        vm.roll(block.number + 1);
        uint256 fees = vault.harvest(0);

        assertGt(fees, 0, "invariant growth must be harvested as fees");
        assertGt(vault.accRewardPerContribution(), accBefore, "accumulator must grow on real fees");
    }

    /// @dev Fee detection is price-agnostic: the same k-growth at a wildly different price ratio
    ///      yields fees, and a second harvest with no further growth converges to zero (the baseline
    ///      is never reduced, so it cannot be re-mined).
    function test_harvest_convergesAfterFeesPriceAgnostic() public {
        _seedSoleLP();
        vm.deal(address(mockZamm), 100 ether);

        // k grows to 4.84e36 (sqrt = 2.2e18) but at a skewed 4.84 : 1 ratio — price moved AND fees
        // accrued. Only the invariant delta (0.2e18) should be paid, not the price-driven reserve swing.
        mockZamm.setPool(vault.poolId(), 4.84 ether, 1 ether, 1000 ether);

        vm.roll(1000);
        uint256 first = vault.harvest(0);
        assertGt(first, 0, "k-growth must be harvested regardless of price ratio");

        // No new fees since: the proportional-burn mock has pulled the per-share invariant back to the
        // baseline, so a second harvest finds nothing.
        vm.roll(2000);
        uint256 second = vault.harvest(0);
        assertEq(second, 0, "baseline must not be re-mineable after a full-fee harvest");
    }

    // ── claimFees + delegation ────────────────────────────────────────────

    function _triggerHarvestWithFees() internal {
        mockZamm.setEthPerLp(0.002 ether);
        mockZamm.setTokenPerLp(0.002 ether);
        vm.deal(address(mockZamm), 10 ether);
        vm.deal(address(mockZRouter), 10 ether);
        alignmentToken.transfer(address(mockZamm), 50_000e18);
        vault.harvest(0);
    }

    function test_claimFees_transfersEth() public {
        _setupWithLiquidity();
        _triggerHarvestWithFees();

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimFees();

        assertGt(claimed, 0, "should claim nonzero");
        assertEq(alice.balance - balBefore, claimed);
    }

    function test_claimFees_updatesRewardDebt() public {
        _setupWithLiquidity();
        _triggerHarvestWithFees();

        vm.prank(alice);
        vault.claimFees();

        // Second claim should return 0
        vm.prank(alice);
        uint256 secondClaim = vault.claimFees();
        assertEq(secondClaim, 0);
    }

    function test_calculateClaimableAmount_matchesClaim() public {
        _setupWithLiquidity();
        _triggerHarvestWithFees();

        uint256 pending = vault.calculateClaimableAmount(alice);
        assertGt(pending, 0);

        vm.prank(alice);
        uint256 claimed = vault.claimFees();
        assertEq(pending, claimed);
    }

    function test_delegation_routesYieldToDelegate() public {
        _setupWithLiquidity();

        // Alice delegates to a staking contract
        address stakingContract = address(0xBEEF);
        vm.prank(alice);
        vault.delegateBenefactor(stakingContract);

        assertEq(vault.getBenefactorDelegate(alice), stakingContract);

        _triggerHarvestWithFees();

        uint256 balBefore = stakingContract.balance;
        vm.prank(alice);
        vault.claimFees();

        assertGt(stakingContract.balance - balBefore, 0, "delegate should receive ETH");
    }

    function test_claimFeesAsDelegate_batchClaim() public {
        // Bob and Charlie both receive from alice (as benefactors)
        vm.prank(bob);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, bob);
        vm.prank(charlie);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, charlie);

        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        // Both delegate to a staking contract
        address staking = address(0xDEAD);
        vm.prank(bob);
        vault.delegateBenefactor(staking);
        vm.prank(charlie);
        vault.delegateBenefactor(staking);

        _triggerHarvestWithFees();

        address[] memory benefactors = new address[](2);
        benefactors[0] = bob;
        benefactors[1] = charlie;

        uint256 balBefore = staking.balance;
        vm.prank(staking);
        uint256 total = vault.claimFeesAsDelegate(benefactors);

        assertGt(total, 0);
        assertEq(staking.balance - balBefore, total);
    }

    function test_claimFeesAsDelegate_revertIfNotDelegate() public {
        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, alice);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;

        vm.expectRevert();
        vm.prank(bob); // bob is not alice's delegate
        vault.claimFeesAsDelegate(benefactors);
    }

    // ── WETH fallback (adoption-gap F1) ─────────────────────────────────────

    /// @dev A benefactor that is a smart wallet rejecting plain ETH still receives its yield via the
    ///      WETH fallback — claimFees must NOT revert, and the WETH balance must rise by the claim.
    function test_claimFees_wethFallback_rejectingBenefactor() public {
        RejectingBenefactor rejecter = new RejectingBenefactor();

        // alice funds a contribution attributed to the rejecting-wallet benefactor
        vm.prank(alice);
        vault.receiveContribution{ value: 4 ether }(Currency.wrap(address(0)), 4 ether, address(rejecter));
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);
        _triggerHarvestWithFees();

        uint256 pending = vault.calculateClaimableAmount(address(rejecter));
        assertGt(pending, 0, "rejecter should have claimable yield");

        rejecter.claim(vault); // must NOT revert despite reverting receive()

        assertEq(address(rejecter).balance, 0, "plain ETH must not land");
        assertEq(weth.balanceOf(address(rejecter)), pending, "yield delivered as WETH");
        assertEq(vault.calculateClaimableAmount(address(rejecter)), 0, "claim settled");
    }

    /// @dev Same for the delegate path: a rejecting delegate still gets its yield as WETH.
    function test_claimFeesAsDelegate_wethFallback_rejectingDelegate() public {
        RejectingBenefactor rejecter = new RejectingBenefactor();

        vm.prank(alice);
        vault.receiveContribution{ value: 4 ether }(Currency.wrap(address(0)), 4 ether, alice);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        vm.prank(alice);
        vault.delegateBenefactor(address(rejecter));

        _triggerHarvestWithFees();

        uint256 pending = vault.calculateClaimableAmount(alice);
        assertGt(pending, 0, "alice should have claimable yield");

        address[] memory bs = new address[](1);
        bs[0] = alice;
        rejecter.claimAsDelegate(vault, bs); // must NOT revert

        assertEq(address(rejecter).balance, 0, "plain ETH must not land");
        assertEq(weth.balanceOf(address(rejecter)), pending, "delegate yield delivered as WETH");
    }

    function test_initialize_revertsOnZeroWeth() public {
        ZAMMAlignmentVault v = ZAMMAlignmentVault(payable(LibClone.clone(address(impl))));
        vm.expectRevert(ZAMMAlignmentVault.InvalidAddress.selector);
        v.initialize(
            address(mockZamm),
            address(mockZRouter),
            address(0), // zero WETH → reject
            address(alignmentToken),
            poolKey,
            treasury,
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
    }

    function test_initialize_storesWeth() public view {
        assertEq(vault.weth(), address(weth));
    }

    // ── Governance ────────────────────────────────────────────────────────

    // ── 80/19/1 fee split + per-target sink (noesis-051) ──────────────────────

    function test_harvest_splits_80_19_1() public {
        _setupWithLiquidity();
        uint256 fees = _triggerHarvestReturnFees();
        assertGt(fees, 0, "harvest should collect nonzero fees");
        assertEq(vault.accumulatedProtocolFees(), fees * 100 / 10000, "protocol 1%");
        assertEq(vault.accumulatedTargetFees(), fees * 1900 / 10000, "target 19%");
    }

    // ── accumulatedFees reports the unclaimed benefactor entitlement ──────

    /// @dev Pins `accumulatedFees()` to what benefactors can actually claim, across a harvest and a
    ///      claim, with two benefactors so a partial claim is visible.
    ///
    ///      This is the regression test for the figure it replaced. `address(this).balance -
    ///      pendingETH` swept the whole vault balance into one number, so it counted the accrued 1%
    ///      protocol cut and 19% target cut — ETH owed to the treasury and the alignment sink, not to
    ///      benefactors — as benefactor yield. The assertions below name that gap explicitly and by
    ///      derivation, so the test goes red against the old expression rather than merely restating
    ///      the new one: under it `accumulatedFees()` IS the balance-derived figure, and the two
    ///      cannot differ.
    ///
    ///      Exactness: `accRewardPerContribution` truncates when it divides by `totalContributions`,
    ///      so here — one harvest, one settle apiece — the sum of all claims falls short of the booked
    ///      total by a few wei, and the counter is a ceiling. That is not universal; settling a
    ///      benefactor repeatedly walks it the other way, which is what
    ///      {test_accumulatedFees_saturatesWhenSettleFloorsOutrunTheBooking} pins.
    function test_accumulatedFees_tracksUnclaimedBenefactorEntitlement() public {
        // Two benefactors, so the counter has to hold an aggregate and survive one of them claiming.
        _receiveFromAlice(4 ether);
        vm.prank(bob);
        vault.receiveContribution{ value: 2 ether }(Currency.wrap(address(0)), 2 ether, bob);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        uint256 fees = _triggerHarvestReturnFees();
        assertGt(fees, 0, "harvest must collect real fees or every assertion below is vacuous");

        // The dust the accumulator's round-down leaves behind: strictly under one wei of
        // `accRewardPerContribution` per benefactor, plus the accumulator's own truncation over the
        // whole contribution base. Derived, not tuned.
        uint256 dustBound = vault.totalContributions() / 1e18 + 2;

        // ── after harvest ────────────────────────────────────────────────
        uint256 owed = vault.calculateClaimableAmount(alice) + vault.calculateClaimableAmount(bob);
        assertGt(owed, 0, "benefactors must have a real claim");
        assertGe(vault.accumulatedFees(), owed, "one harvest, one settle apiece: the counter covers what is owed");
        assertLe(
            vault.accumulatedFees() - owed, dustBound, "counter must not exceed what is owed beyond round-down dust"
        );

        // The defect this replaces: the balance-derived figure over-reports by the two cuts that are
        // owed elsewhere. Red against the old expression, where these two are the same number.
        uint256 balanceDerived = address(vault).balance - vault.pendingETH();
        uint256 owedElsewhere = vault.accumulatedProtocolFees() + vault.accumulatedTargetFees();
        assertGt(owedElsewhere, 0, "the cuts must be nonzero or the contrast proves nothing");
        assertEq(
            balanceDerived - vault.accumulatedFees(),
            owedElsewhere,
            "balance-derived figure over-reports by exactly the protocol and target cuts"
        );

        // ── after a claim ────────────────────────────────────────────────
        uint256 bobOwedBefore = vault.calculateClaimableAmount(bob);
        uint256 counterBefore = vault.accumulatedFees();
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimFees();
        assertGt(claimed, 0, "alice must actually be paid");
        assertEq(alice.balance - aliceBefore, claimed, "alice must receive what she claimed");

        // The interface's contract: it "decreases when fees claimed", by exactly what was paid out.
        assertEq(vault.accumulatedFees(), counterBefore - claimed, "counter falls by exactly what was paid out");
        assertEq(vault.calculateClaimableAmount(alice), 0, "alice has nothing left to claim");

        // Bob's entitlement is untouched and still counted — the counter is an aggregate, not a
        // per-claim scratch value.
        assertEq(vault.calculateClaimableAmount(bob), bobOwedBefore, "bob's claim must be unaffected");
        assertGe(vault.accumulatedFees(), bobOwedBefore, "counter must still cover bob");
        assertLe(vault.accumulatedFees() - bobOwedBefore, dustBound, "counter must be bob's claim plus dust");

        // ── after every claim ────────────────────────────────────────────
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        assertEq(bobClaimed, bobOwedBefore, "bob is paid what he was owed");
        assertLe(vault.accumulatedFees(), dustBound, "nothing owed, so nothing reported but dust");

        // And the vault is still holding the two cuts it never owed benefactors. With every claim
        // settled, the old expression would report that ETH — a fifth of every fee ever harvested —
        // as claimable benefactor yield; the counter reports only the unclaimable dust.
        assertEq(
            address(vault).balance - vault.pendingETH() - vault.accumulatedFees(),
            owedElsewhere,
            "the cuts remain in the vault, owed to the treasury and the sink and to no benefactor"
        );
    }

    /// @dev Pins the claim path against the counter's one unavoidable inexactness: a benefactor who
    ///      is settled many times is paid slightly more than the harvests booked for them, so the
    ///      decrement on claim has to saturate instead of subtracting.
    ///
    ///      Where the drift comes from. `rewardDebt` is credited per settle as
    ///      `floor(settled * acc / 1e18)`, each conversion flooring on its own, while a claim is one
    ///      `floor(contribution * acc / 1e18)` over the aggregate net of that chain — and a floor of
    ///      a sum is never smaller than the sum of the floors. Every settle can therefore hand the
    ///      benefactor up to a wei the harvest never booked, and a benefactor is settled on every
    ///      conversion they have ETH in, which the ratio-capped residual re-credit guarantees is more
    ///      than once: whatever ZAMM refuses is carried forward and settles again next time.
    ///      Contributions here are fractions of an ether, so `accRewardPerContribution`'s own
    ///      round-down leaves under a wei of slack per harvest to absorb it, so within a couple of
    ///      conversions the claim has already outrun the booking.
    ///
    ///      Non-vacuous against the bare `_totalAccumulatedFees -= pending` this replaces: there the
    ///      `claimFees()` below reverts with an arithmetic underflow, and every benefactor's yield is
    ///      stranded in the vault permanently.
    function test_accumulatedFees_saturatesWhenSettleFloorsOutrunTheBooking() public {
        // Odd wei amounts so nothing divides evenly and each settle floors off a real remainder.
        uint256[5] memory amounts =
            [uint256(0.3 ether + 7), 0.11 ether + 13, 0.07 ether + 3, 0.05 ether + 11, 0.13 ether + 17];

        bool sawResidualRecredit;
        for (uint256 i = 0; i < amounts.length; i++) {
            vm.roll(block.number + 10);
            _receiveFromAlice(amounts[i]);
            if (i == 0) _setupPool(10 ether, 10_000e18);
            // Conversion harvests first, then settles — so each round credits `rewardDebt` at a
            // different accumulator value, which is the whole point.
            vault.convertAndAddLiquidity(0, 0, 0);
            if (vault.pendingContribution(alice) != 0) sawResidualRecredit = true;
            _growPoolReserves();
        }
        assertTrue(sawResidualRecredit, "the residual must be re-credited or alice is settled only once per round");

        vm.roll(block.number + 10);
        assertGt(vault.harvest(0), 0, "a final harvest must book real fees or the claim below is vacuous");

        // The drift itself: alice can claim more than the harvests booked. Sub-wei per settle, but
        // enough to underflow a bare subtraction.
        uint256 owed = vault.calculateClaimableAmount(alice);
        uint256 booked = vault.accumulatedFees();
        assertGt(owed, booked, "settle floors must have outrun the booking or this test proves nothing");
        assertLe(owed - booked, amounts.length, "and they must outrun it only by dust: at most a wei per settle");

        // The claim must go through. Against the old code this is where it reverted.
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimFees();
        assertEq(claimed, owed, "alice is paid exactly what she was owed, the counter notwithstanding");
        assertEq(alice.balance - balanceBefore, claimed, "and she actually receives it");

        // Nothing is owed any more, and the counter says so rather than wrapping to 2^256.
        assertEq(vault.accumulatedFees(), 0, "counter saturates at zero when the payout exceeds the booking");
        assertEq(vault.calculateClaimableAmount(alice), 0, "alice has nothing left to claim");

        // And the vault is not left in a state where the next claim reverts either.
        vm.prank(alice);
        assertEq(vault.claimFees(), 0, "a second claim is a no-op, not a revert");
    }

    /// @dev Grow the pool's reserves so the vault's per-share invariant exceeds its baseline and the
    ///      next harvest sees real fees, without disturbing LP supply or the vault's LP balance.
    function _growPoolReserves() internal {
        uint256 pid = vault.poolId();
        (uint112 r0, uint112 r1,,,,, uint256 supply) = mockZamm.pools(pid);
        mockZamm.setPool(pid, uint112(uint256(r0) * 103 / 100 + 1), uint112(uint256(r1) * 103 / 100 + 1), supply);
        vm.deal(address(mockZamm), 100 ether);
        vm.deal(address(mockZRouter), 100 ether);
    }

    function test_withdrawTargetFees_pushesToRegistrySink() public {
        address sink = makeAddr("communitySink");
        registry.setCommunityPayout(TARGET_ID, sink);
        _setupWithLiquidity();
        uint256 fees = _triggerHarvestReturnFees();
        uint256 expected = fees * 1900 / 10000;

        uint256 before = sink.balance;
        vault.withdrawTargetFees();
        assertEq(sink.balance - before, expected, "19% pushed to registry-pinned sink");
        assertEq(vault.accumulatedTargetFees(), 0, "target bucket cleared");
    }

    function test_withdrawTargetFees_revertsWhenSinkUnset() public {
        _setupWithLiquidity();
        _triggerHarvestReturnFees();
        vm.expectRevert(ZAMMAlignmentVault.TargetSinkNotSet.selector);
        vault.withdrawTargetFees();
    }

    /// @dev An un-wired sink accrues the 19% but never blocks the creator's claim path.
    function test_targetSinkUnset_doesNotBlockCreatorClaim() public {
        _setupWithLiquidity();
        uint256 fees = _triggerHarvestReturnFees();
        assertEq(vault.accumulatedTargetFees(), fees * 1900 / 10000, "target still accrues when sink unset");

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimFees();
        assertGt(claimed, 0, "creator claim unaffected by unset sink");
        assertEq(alice.balance - balBefore, claimed);
    }

    /// @dev Same staging as {_triggerHarvestWithFees} but surfaces the collected fee total for
    ///      per-leg assertions.
    function _triggerHarvestReturnFees() internal returns (uint256 fees) {
        mockZamm.setEthPerLp(0.002 ether);
        mockZamm.setTokenPerLp(0.002 ether);
        vm.deal(address(mockZamm), 10 ether);
        vm.deal(address(mockZRouter), 10 ether);
        alignmentToken.transfer(address(mockZamm), 50_000e18);
        fees = vault.harvest(0);
    }

    function test_setProtocolTreasury_ownerOnly() public {
        address newTreasury = address(0xABCD);
        vm.prank(vault.owner());
        vault.setProtocolTreasury(newTreasury);
        assertEq(vault.protocolTreasury(), newTreasury);
    }

    function test_withdrawProtocolFees_sendToTreasury() public {
        _setupWithLiquidity();
        _triggerHarvestWithFees();

        uint256 treasuryBefore = treasury.balance;
        vault.withdrawProtocolFees();
        assertGt(treasury.balance - treasuryBefore, 0);
        assertEq(vault.accumulatedProtocolFees(), 0);
    }

    // ── Solady slot invariant ────────────────────────────────────────────

    function test_reentrancyGuardSlotMatchesSolady() public pure {
        // Solady derives the slot as: uint72(bytes9(keccak256("_REENTRANCY_GUARD_SLOT")))
        uint256 expected = uint256(uint72(bytes9(keccak256("_REENTRANCY_GUARD_SLOT"))));
        assertEq(expected, 0x929eee149b4bd21268, "Solady reentrancy guard slot has changed");
    }

    // ── Fuzz: vault accumulator properties ─────────────────────────────

    /// @notice accRewardPerContribution must never decrease across harvests.
    function testFuzz_AccRewardPerContributionGrowsMonotonically(uint8 rounds, uint72 contribSeed, uint72 feeSeed)
        public
    {
        rounds = uint8(bound(uint256(rounds), 2, 10));

        uint256 prevAcc = 0;

        for (uint256 i = 0; i < rounds; i++) {
            // Contribute
            uint256 contribution = bound(uint256(contribSeed) + i, 0.01 ether, 5 ether);
            vm.deal(alice, alice.balance + contribution);
            vm.prank(alice);
            vault.receiveContribution{ value: contribution }(Currency.wrap(address(0)), contribution, alice);

            // Set pool reserves for swap math
            uint256 pid = vault.poolId();
            mockZamm.setPool(pid, 10 ether, 10_000e18, 1000 ether);

            // Convert
            vault.convertAndAddLiquidity(0, 0, 0);

            // Simulate fee growth and harvest
            uint256 feeGrowth = bound(uint256(feeSeed) + i, 0.001 ether, 0.01 ether);
            mockZamm.setEthPerLp(feeGrowth);
            mockZamm.setTokenPerLp(feeGrowth);
            vm.deal(address(mockZamm), 1000 ether);

            vm.roll(block.number + 1 + i); // unique block per round (naive +1 collided across rounds)
            vault.harvest(0);

            uint256 currentAcc = vault.accRewardPerContribution();
            assertGe(currentAcc, prevAcc, "accRewardPerContribution decreased");
            prevAcc = currentAcc;

            // Reset mock
            mockZamm.setEthPerLp(1e15);
            mockZamm.setTokenPerLp(1e15);
        }
    }

    /// @notice No benefactor can claim more than total fees deposited into the vault.
    function testFuzz_ClaimableNeverExceedsDeposited(uint72 aliceAmount, uint72 bobAmount, uint8 harvestCount) public {
        uint256 aliceContrib = bound(uint256(aliceAmount), 0.1 ether, 10 ether);
        uint256 bobContrib = bound(uint256(bobAmount), 0.1 ether, 10 ether);
        harvestCount = uint8(bound(uint256(harvestCount), 1, 5));

        // Both contribute
        vm.deal(alice, alice.balance + aliceContrib);
        vm.prank(alice);
        vault.receiveContribution{ value: aliceContrib }(Currency.wrap(address(0)), aliceContrib, alice);

        vm.deal(bob, bob.balance + bobContrib);
        vm.prank(bob);
        vault.receiveContribution{ value: bobContrib }(Currency.wrap(address(0)), bobContrib, bob);

        // Set pool reserves and convert
        uint256 pid = vault.poolId();
        mockZamm.setPool(pid, 10 ether, 10_000e18, 1000 ether);
        vault.convertAndAddLiquidity(0, 0, 0);

        // Accumulate fees over multiple harvests
        uint256 totalFeesHarvested = 0;
        for (uint256 i = 0; i < harvestCount; i++) {
            mockZamm.setEthPerLp(0.002 ether);
            mockZamm.setTokenPerLp(0.002 ether);
            vm.deal(address(mockZamm), 1000 ether);

            vm.roll(block.number + 1 + i); // unique block per round (naive +1 collided across rounds)
            uint256 fees = vault.harvest(0);
            totalFeesHarvested += fees;

            mockZamm.setEthPerLp(1e15);
            mockZamm.setTokenPerLp(1e15);
        }

        // Check each benefactor's claimable
        uint256 aliceClaimable = vault.calculateClaimableAmount(alice);
        uint256 bobClaimable = vault.calculateClaimableAmount(bob);

        assertLe(aliceClaimable, totalFeesHarvested, "Alice claimable exceeds total fees deposited");
        assertLe(bobClaimable, totalFeesHarvested, "Bob claimable exceeds total fees deposited");
        assertLe(aliceClaimable + bobClaimable, totalFeesHarvested, "Sum of claimable exceeds total fees deposited");
    }

    // ========================================================================
    // AUDIT REGRESSION — F5 (convert/harvest oracle floor on ZAMM swaps)
    // ========================================================================

    function _wireValidator(uint256 ethPer1e18Tokens) internal returns (MockVaultPriceValidator val) {
        val = new MockVaultPriceValidator();
        val.setEthPer1e18Tokens(ethPer1e18Tokens);
        vm.prank(vault.owner());
        vault.setPriceValidator(address(val));
    }

    /// @dev F5: with a price validator wired, a permissionless caller passing minTokenOut=0 cannot
    ///      push a degraded (flash-sandwiched) ETH->token swap through — the floor reverts it.
    function test_F5_ConvertFloorBlocksSandwich() public {
        _wireValidator(1e15); // 0.001 ETH/token TWAP
        mockZRouter.setOutRatio(1e20); // degraded rate → sandwich
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        vm.expectRevert(bytes("MockZRouter: insufficient output"));
        vault.convertAndAddLiquidity(0, 0, 0); // caller minOut=0, but oracle floor enforces
    }

    /// @dev F5: an honest swap that clears the oracle floor still succeeds.
    function test_F5_ConvertFloorAllowsHonestSwap() public {
        _wireValidator(1e15);
        mockZRouter.setOutRatio(2e21); // fair/high rate, above the floor
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        vault.convertAndAddLiquidity(0, 0, 0);
        assertGt(vault.totalContributions(), 0, "honest conversion should succeed");
    }

    /// @dev noesis-037: the floor no longer fails open. With the DAO-pinned ReferencePool unset, a
    ///      convert reverts {NoReferencePool} instead of swapping unguarded — a permissionless caller
    ///      cannot disable the anti-sandwich floor by racing an approval or clearing the reference.
    function test_convertRevertsWhenNoReferencePool() public {
        // Clear the pinned reference for this (target, token): pool == address(0) is "unset".
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0), kind: 0, twapWindow: 0 })
        );
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        vm.expectRevert(ZAMMAlignmentVault.NoReferencePool.selector);
        vault.convertAndAddLiquidity(0, 0, 0);
    }

    /// @dev noesis-037 self-sandwich sim: an attacker degrades the thin VENUE pool (modeled by a
    ///      degraded router out-ratio) and calls convert with minTokenOut=1, but the floor is priced
    ///      from the UNMOVED canonical ReferencePool — so the swap cannot clear it and reverts. The
    ///      attacker cannot extract beyond maxPriceDeviationBps of the canonical price.
    function test_selfSandwichCannotBeatCanonicalFloor() public {
        // Canonical price stays 1 ETH / 1e18 tokens (validator rate from setUp). Attacker moves only
        // the venue: router now pays 100x fewer tokens per ETH than canonical.
        mockZRouter.setOutRatio(1e16); // 0.01x → far below the 95% canonical floor
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        vm.expectRevert(bytes("MockZRouter: insufficient output"));
        vault.convertAndAddLiquidity(1, 0, 0); // caller minOut=1, but the canonical floor governs
    }

    // ── addLiquidity residual ─────────────────────────────────────────────

    /// @dev ZAMM adds liquidity at the POOL's ratio, so it consumes at most the `ethForLP` the vault
    ///      sends and refunds the rest. That refund arrives in `receive()` under the reentrancy guard
    ///      and is untracked there, so without an accrual it becomes ETH the vault holds but nothing
    ///      accounts for: no withdrawal path reaches it and `accumulatedFees()` misreports it as yield.
    ///      Here the ETH side is the abundant one (a 1:1 mock swap against a 1:1000 pool), so the
    ///      token bought caps the ETH consumed and the residual is large.
    function test_convertAndAddLiquidity_recreditsUnconsumedEth() public {
        uint256 deployETH = 1 ether;
        uint112 reserve0 = 10 ether;
        uint112 reserve1 = 10_000e18;

        _receiveFromAlice(deployETH);
        _setupPool(reserve0, reserve1);

        // Mirror the vault's own swap/LP split so the expectation is derived, not hardcoded.
        uint256 r0 = reserve0;
        uint256 ethToSwap = FixedPointMathLib.sqrt(r0 * r0 + deployETH * r0) - r0;
        uint256 ethForLP = deployETH - ethToSwap;

        uint256 vaultBalBefore = address(vault).balance;
        (uint112 poolEthBefore,,,,,,) = mockZamm.pools(vault.poolId());

        vault.convertAndAddLiquidity(0, 0, 0);

        (uint112 poolEthAfter,,,,,,) = mockZamm.pools(vault.poolId());
        uint256 ethUsed = uint256(poolEthAfter) - uint256(poolEthBefore);
        uint256 expectedResidual = ethForLP - ethUsed;

        // Guards the failure mode this test exists for: a mock that consumes everything it is handed
        // makes every assertion below vacuous.
        assertGt(expectedResidual, 0, "mock must leave a real residual");

        assertEq(vault.pendingETH(), expectedResidual, "residual must be re-credited to pendingETH");
        // The vault really is still holding that ETH, and it is no longer counted as harvestable yield.
        assertEq(address(vault).balance, vaultBalBefore - ethUsed - ethToSwap, "vault must hold the residual");
        assertEq(vault.accumulatedFees(), 0, "residual must not be reported as fees");
        // The sole benefactor keeps the residual as a pending claim rather than being credited shares
        // for ETH that never became liquidity.
        assertEq(vault.pendingContribution(alice), expectedResidual, "residual must stay alice's");
        assertEq(vault.benefactorContribution(alice), deployETH - expectedResidual, "shares must exclude residual");
        assertEq(vault.totalContributions(), deployETH - expectedResidual, "totalContributions must exclude residual");
    }

    /// @dev The re-credited residual is deployable: a second conversion consumes it with no fresh
    ///      contribution, so the ETH is not merely parked.
    function test_convertAndAddLiquidity_residualIsRedeployable() public {
        _receiveFromAlice(1 ether);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        uint256 residual = vault.pendingETH();
        assertGt(residual, 0, "first conversion must leave a residual");

        uint256 principalBefore = vault.principalETH();
        vault.convertAndAddLiquidity(0, 0, 0); // no new contribution needed
        assertGt(vault.principalETH(), principalBefore, "re-credited ETH must reach the pool");
    }

    // ── L-10: the TOKEN side of the same rounding ─────────────────────────────

    /// @dev A pool ratio where the ETH leg binds leaves unconsumed alignment TOKEN in the vault:
    ///      `_swapAndAddLiquidity` buys `tokenBought` and ZAMM takes only `tokenUsed`. The ETH half of
    ///      that rounding has been re-credited since noesis-034 (the two tests above); the token half
    ///      had no reader at all, so it accreted monotonically with no path out. It is now sold on the
    ///      next harvest and split 80/19/1 like any other yield.
    function _convertLeavingTokenResidue() internal returns (uint256 residue) {
        _receiveFromAlice(1 ether);
        // reserve1/reserve0 well under 1 makes `amount1Optimal` the smaller side, so ZAMM pulls only a
        // fraction of the token the vault bought and the rest stays here.
        _setupPool(10 ether, 1e18);
        vault.convertAndAddLiquidity(0, 0, 0);
        residue = alignmentToken.balanceOf(address(vault));
    }

    function test_harvest_sellsTheTokenSideResidual() public {
        uint256 residue = _convertLeavingTokenResidue();
        assertGt(residue, 0, "no token residual produced - setup wrong");

        vm.roll(block.number + 1);
        vault.harvest(0);

        // Before the fix `_removeFeeLP` sold only what the fee-LP removal returned, so this balance
        // was still the whole residue after a harvest.
        assertEq(alignmentToken.balanceOf(address(vault)), 0, "the residue is gone from the vault");
    }

    /// @dev The exact accounting, with the LP leg taken out of the picture: reserves set below the
    ///      deposit baseline mean no fee growth and no fee LP to burn, so everything the harvest
    ///      collects is the residue. The mock router is 1:1, so the ETH is the residue itself.
    function test_harvest_withNoFeeGrowth_stillSellsTheResidual() public {
        uint256 residue = _convertLeavingTokenResidue();
        assertGt(residue, 0, "no token residual produced - setup wrong");

        // A pool worth less than the deposit baseline: invFees == 0, feeLP == 0. Before the fix this
        // returned early and the residue survived every such harvest.
        mockZamm.setPool(vault.poolId(), 1, 1, 1e30);

        vm.roll(block.number + 1);
        uint256 collected = vault.harvest(0);

        assertEq(alignmentToken.balanceOf(address(vault)), 0, "swept with no fee LP to burn");
        assertEq(collected, residue, "the whole residue, and only the residue");
        assertEq(vault.accumulatedProtocolFees(), residue / 100, "1% of the swept residue");
        assertEq(vault.accumulatedTargetFees(), residue * 19 / 100, "19% of the swept residue");
    }

    /// @dev And a harvest with nothing at all to do stays a no-op: no fee growth and no residue
    ///      collects nothing and accrues nothing, so removing the early return costs no behaviour.
    function test_harvest_withNothingToSweep_isANoOp() public {
        _receiveFromAlice(1 ether);
        _setupPool(10 ether, 10_000e18); // token side binds: no token residue, only ETH
        vault.convertAndAddLiquidity(0, 0, 0);
        assertEq(alignmentToken.balanceOf(address(vault)), 0, "precondition: nothing to sweep");

        mockZamm.setPool(vault.poolId(), 1, 1, 1e30); // and nothing to harvest either
        vm.roll(block.number + 1);
        assertEq(vault.harvest(0), 0, "nothing collected");
        assertEq(vault.accumulatedProtocolFees(), 0, "and nothing accrued");
        assertEq(vault.accumulatedTargetFees(), 0, "nor to the target sink");
    }
}

/// @notice A benefactor/delegate that is a smart wallet rejecting plain ETH (reverting receive()).
///         Exercises the SmartTransferLib WETH fallback on the claim paths.
contract RejectingBenefactor {
    receive() external payable {
        revert("no plain ETH");
    }

    function claim(ZAMMAlignmentVault vault) external returns (uint256) {
        return vault.claimFees();
    }

    function claimAsDelegate(ZAMMAlignmentVault vault, address[] calldata benefactors) external returns (uint256) {
        return vault.claimFeesAsDelegate(benefactors);
    }
}

/// @notice A benefactor that, on receiving its claim payout, attempts to re-enter receiveContribution.
///         The vault's `nonReentrant` guard must revert that inner call (captured via try/catch) so the
///         reentry cannot register a fresh pending contribution mid-claim.
contract ReentrantContributor {
    ZAMMAlignmentVault public vault;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(ZAMMAlignmentVault _vault) {
        vault = _vault;
    }

    receive() external payable {
        if (!reentryAttempted && msg.value > 0) {
            reentryAttempted = true;
            try vault.receiveContribution{ value: 0.001 ether }(Currency.wrap(address(0)), 0.001 ether, address(this)) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }

    function claim() external returns (uint256) {
        return vault.claimFees();
    }
}
