// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {ZAMMAlignmentVault, IZAMM} from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import {MockZAMM} from "../mocks/MockZAMM.sol";
import {MockZRouter} from "../mocks/MockZRouter.sol";
import {MockEXECToken} from "../mocks/MockEXECToken.sol";
import {MockVaultPriceValidator} from "../mocks/MockVaultPriceValidator.sol";
import {Currency} from "v4-core/types/Currency.sol";

contract ZAMMAlignmentVaultTest is Test {
    // Mirror events for expectEmit matching
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event Harvested(uint256 totalFees, uint256 benefactorFees);
    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    ZAMMAlignmentVault public vault;
    ZAMMAlignmentVault public impl;
    MockZAMM public mockZamm;
    MockZRouter public mockZRouter;
    MockEXECToken public alignmentToken;

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

        // Fund mocks
        vm.deal(address(mockZamm), 100 ether);
        vm.deal(address(mockZRouter), 100 ether);
        alignmentToken.transfer(address(mockZamm), 100_000e18);
        alignmentToken.transfer(address(mockZRouter), 100_000e18);

        poolKey = IZAMM.PoolKey({
            id0: 0,
            id1: 0,
            token0: address(0),          // ETH
            token1: address(alignmentToken),
            feeOrHook: 30                 // 0.3%
        });

        vm.prank(owner);
        impl = new ZAMMAlignmentVault();

        vault = ZAMMAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(mockZamm),
            address(mockZRouter),
            address(alignmentToken),
            poolKey,
            treasury,
            address(0)
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
        assertEq(vault.protocolYieldCutBps(), 100);
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
            address(alignmentToken),
            poolKey,
            treasury,
            address(0)
        );
    }

    // ── receiveInstance ──────────────────────────────────────────────

    function test_receiveInstance_tracksPending() public {
        vm.prank(alice);
        vault.receiveContribution{value: 1 ether}(Currency.wrap(address(0)), 1 ether, alice);

        assertEq(vault.pendingETH(), 1 ether);
        assertEq(vault.pendingContribution(alice), 1 ether);
    }

    function test_receiveInstance_accumulatesMultiple() public {
        vm.prank(alice);
        vault.receiveContribution{value: 1 ether}(Currency.wrap(address(0)), 1 ether, alice);

        vm.prank(bob);
        vault.receiveContribution{value: 2 ether}(Currency.wrap(address(0)), 2 ether, bob);

        assertEq(vault.pendingETH(), 3 ether);
        assertEq(vault.pendingContribution(alice), 1 ether);
        assertEq(vault.pendingContribution(bob), 2 ether);
    }

    function test_receiveInstance_emitsContributionReceived() public {
        vm.expectEmit(true, false, false, true);
        emit ContributionReceived(alice, 1 ether);

        vm.prank(alice);
        vault.receiveContribution{value: 1 ether}(Currency.wrap(address(0)), 1 ether, alice);
    }

    function test_receiveInstance_revertOnNonEthCurrency() public {
        vm.expectRevert();
        vm.prank(alice);
        vault.receiveContribution{value: 0}(
            Currency.wrap(address(alignmentToken)),
            1 ether,
            alice
        );
    }

    function test_receive_tracksSenderAsBenefactor() public {
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(vault.pendingContribution(alice), 0.5 ether);
    }

    // ── convertAndAddLiquidity ────────────────────────────────────────────

    function _receiveFromAlice(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{value: amount}(Currency.wrap(address(0)), amount, alice);
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

    function test_convertAndAddLiquidity_clearsPending() public {
        _receiveFromAlice(2 ether);
        _setupPool(10 ether, 10_000e18);

        vault.convertAndAddLiquidity(0, 0, 0);

        assertEq(vault.pendingETH(), 0);
        assertEq(vault.pendingContribution(alice), 0);
    }

    function test_convertAndAddLiquidity_tracksBenefactorContribution() public {
        _receiveFromAlice(1 ether);

        vm.prank(bob);
        vault.receiveContribution{value: 3 ether}(Currency.wrap(address(0)), 3 ether, bob);

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
        emit Harvested(0, 0); // values ignored, just check event fires
        vault.harvest(0);
    }

    // ── harvest: IL-as-fees mislabel regression (audit #36 Tier-2) ──────────
    //
    // The vault holds the entire LP supply at a known 1:1 ratio so the invariant math is exact.
    // setOutRatio(1e18) makes the convert swap 1 ETH-wei → 1 token-wei, so after convert the pool
    // is reserves=(2e18, 2e18), supply=1000e18, lpHeld=1000e18 → principalInvariant = 2e18.
    function _seedSoleLP() internal {
        uint256 pid = vault.poolId();
        mockZamm.setPool(pid, 0, 0, 0);     // empty pool: vault becomes the sole LP
        mockZRouter.setOutRatio(1e18);      // 1 ETH-wei : 1 token-wei
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
        vault.receiveContribution{value: 2 ether}(Currency.wrap(address(0)), 2 ether, bob);
        vm.prank(charlie);
        vault.receiveContribution{value: 2 ether}(Currency.wrap(address(0)), 2 ether, charlie);

        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        // Both delegate to a staking contract
        address staking = address(0xDEAD);
        vm.prank(bob); vault.delegateBenefactor(staking);
        vm.prank(charlie); vault.delegateBenefactor(staking);

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
        vault.receiveContribution{value: 1 ether}(Currency.wrap(address(0)), 1 ether, alice);
        _setupPool(10 ether, 10_000e18);
        vault.convertAndAddLiquidity(0, 0, 0);

        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;

        vm.expectRevert();
        vm.prank(bob); // bob is not alice's delegate
        vault.claimFeesAsDelegate(benefactors);
    }

    // ── Governance ────────────────────────────────────────────────────────

    function test_setProtocolYieldCutBps_ownerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setProtocolYieldCutBps(300);

        vm.prank(vault.owner());
        vault.setProtocolYieldCutBps(300);
        assertEq(vault.protocolYieldCutBps(), 300);
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
    function testFuzz_AccRewardPerContributionGrowsMonotonically(
        uint8 rounds,
        uint72 contribSeed,
        uint72 feeSeed
    ) public {
        rounds = uint8(bound(uint256(rounds), 2, 10));

        uint256 prevAcc = 0;

        for (uint256 i = 0; i < rounds; i++) {
            // Contribute
            uint256 contribution = bound(uint256(contribSeed) + i, 0.01 ether, 5 ether);
            vm.deal(alice, alice.balance + contribution);
            vm.prank(alice);
            vault.receiveContribution{value: contribution}(Currency.wrap(address(0)), contribution, alice);

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
    function testFuzz_ClaimableNeverExceedsDeposited(
        uint72 aliceAmount,
        uint72 bobAmount,
        uint8 harvestCount
    ) public {
        uint256 aliceContrib = bound(uint256(aliceAmount), 0.1 ether, 10 ether);
        uint256 bobContrib = bound(uint256(bobAmount), 0.1 ether, 10 ether);
        harvestCount = uint8(bound(uint256(harvestCount), 1, 5));

        // Both contribute
        vm.deal(alice, alice.balance + aliceContrib);
        vm.prank(alice);
        vault.receiveContribution{value: aliceContrib}(Currency.wrap(address(0)), aliceContrib, alice);

        vm.deal(bob, bob.balance + bobContrib);
        vm.prank(bob);
        vault.receiveContribution{value: bobContrib}(Currency.wrap(address(0)), bobContrib, bob);

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

        assertLe(
            aliceClaimable,
            totalFeesHarvested,
            "Alice claimable exceeds total fees deposited"
        );
        assertLe(
            bobClaimable,
            totalFeesHarvested,
            "Bob claimable exceeds total fees deposited"
        );
        assertLe(
            aliceClaimable + bobClaimable,
            totalFeesHarvested,
            "Sum of claimable exceeds total fees deposited"
        );
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
        _wireValidator(1e15);          // 0.001 ETH/token TWAP
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

    /// @dev F5: with no validator wired (default), behaviour is unchanged — caller minimums govern.
    function test_F5_NoFloorWhenValidatorUnset() public {
        mockZRouter.setOutRatio(1e20); // degraded, but no oracle floor configured
        _receiveFromAlice(10 ether);
        _setupPool(10 ether, 10_000e18);

        vault.convertAndAddLiquidity(0, 0, 0); // succeeds — no validator to floor against
        assertGt(vault.totalContributions(), 0);
    }
}
