// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { UniAlignmentVault } from "src/vaults/uni/UniAlignmentVault.sol";
import { FeeSeamUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { UniswapVaultPriceValidator } from "src/peripherals/UniswapVaultPriceValidator.sol";
import { IVaultPriceValidator } from "src/interfaces/IVaultPriceValidator.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/**
 * @title VaultUniswapIntegration
 * @notice Comprehensive integration tests for UniAlignmentVault
 * @dev Tests vault logic (shares, fees, conversion rounds) with stubbed swap routing
 *      Run with: forge test --mp test/fork/VaultUniswapIntegration.t.sol --fork-url $ETH_RPC_URL -vvv
 */
contract VaultUniswapIntegrationTest is ForkTestBase {
    FeeSeamUniAlignmentVault vault;
    MockAlignmentRegistry mockRegistry;
    address owner;
    address alice;
    address bob;
    address charlie;
    address alignmentToken;
    address constant TREASURY = address(0xFEE);
    uint256 constant TARGET_ID = 1;

    function setUp() public {
        loadAddresses();

        // Create test addresses
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        alignmentToken = USDC; // Use real USDC for fork tests (has V3 pool with WETH)

        // Deploy peripherals and vault (clone pattern)
        UniswapVaultPriceValidator priceValidator =
            new UniswapVaultPriceValidator(WETH, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800);
        mockRegistry = new MockAlignmentRegistry();
        mockRegistry.setTargetActive(TARGET_ID, true);
        mockRegistry.setTokenInTarget(TARGET_ID, alignmentToken, true);
        // Canonical reference pool (noesis-035/037): the vault's swap floor reads the pinned
        // ReferencePool for (target, token) and reverts NoReferencePool when it is unset, so a fork run
        // needs it wired to a real pool. The WETH/USDC V3 0.05% pool is the deepest mainnet reference
        // for this alignment token and carries the observation history the TWAP path requires.
        mockRegistry.setReferencePool(
            TARGET_ID,
            alignmentToken,
            IAlignmentRegistry.ReferencePool({ pool: WETH_USDC_V3_005, kind: 0, twapWindow: 1800 })
        );

        // FeeSeam subclass: the accrual seam only — the real V4 _addToLpPosition is kept.
        FeeSeamUniAlignmentVault vaultImpl = new FeeSeamUniAlignmentVault();
        vault = FeeSeamUniAlignmentVault(payable(LibClone.clone(address(vaultImpl))));
        vm.prank(owner);
        vault.initialize(
            owner,
            WETH,
            UNISWAP_V4_POOL_MANAGER,
            alignmentToken,
            ZROUTER,
            3000,
            60,
            IVaultPriceValidator(address(priceValidator)),
            IAlignmentRegistry(address(mockRegistry)),
            TARGET_ID,
            TREASURY
        );

        // Set V4 pool key - H-02: Hook requires native ETH (address(0)), not WETH
        vm.prank(owner);
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH
            currency1: Currency.wrap(alignmentToken),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vault.setV4PoolKey(poolKey);

        // Label addresses for better trace output
        vm.label(address(vault), "UniAlignmentVault");
        vm.label(owner, "Owner");
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(charlie, "Charlie");

        // CRITICAL: In fork mode, makeAddr() might generate addresses that already have code on mainnet
        // Remove any existing code from test addresses to ensure they behave as EOAs
        vm.etch(alice, "");
        vm.etch(bob, "");
        vm.etch(charlie, "");
        vm.etch(owner, "");
    }

    // ========== Helper Functions ==========

    /// @notice Contribute ETH as a specific address
    function _contribute(address contributor, uint256 amount) internal {
        vm.deal(contributor, amount);
        vm.prank(contributor);
        (bool success,) = address(vault).call{ value: amount }("");
        require(success, "Contribution failed");
    }

    /// @notice Assert the post-conversion residual is accounted for to the wei, and to the right people.
    /// @dev A convert against a live pool never absorbs the whole ETH leg. The vault swaps half the batch
    ///      for the alignment token and pairs the two sides, so the swap's own cost -- fee plus the price
    ///      it moves -- leaves the ETH side over-supplied, and `modifyLiquidity` pulls only what the
    ///      position needs. Against the mainnet ETH/USDC v4 pool this suite opens into, that residual
    ///      measured 0.173% of a 5 ETH batch, 0.171% of 10 ETH and 0.162% of 30 ETH: a swap cost, not
    ///      dust, and not a constant to assert against. The mock these tests were written for reported
    ///      the whole ETH leg as deposited, making the residual structurally zero -- the same blind spot
    ///      `UniVaultInvariant.afterInvariant` pins for the invariant suite.
    ///
    ///      So "the dragnet clears" is not the vault's promise and never was. The promise is that no wei
    ///      goes missing and none of it changes hands: `_distributeSharesAndCleanup` carries each
    ///      benefactor their own pro-rata slice and hands the sub-wei remainder to the last eligible one,
    ///      so the ETH stays theirs and buys them shares in the batch that finally deploys it.
    ///
    ///      The per-benefactor half of this is the half that bites. Asserting only that
    ///      `sum(pendingETH) == totalPendingETH` passes even with the carry-forward removed, because the
    ///      remainder settlement then hands one contributor the whole batch's residual and the sum still
    ///      balances -- which is audit M-2 exactly. Checked by reverting the carry to zero and watching
    ///      the pro-rata bounds below fail while the aggregate ones stayed green.
    function _assertResidualFullyOwned(
        address[] memory benefactors,
        uint256[] memory contributions,
        uint256 contributedTotal
    ) internal view {
        uint256 residual = vault.totalPendingETH();
        assertGt(residual, 0, "a live pool always leaves a residual: this assertion would be vacuous at zero");

        uint256 sumPending;
        for (uint256 i = 0; i < benefactors.length; i++) {
            sumPending += vault.pendingETH(benefactors[i]);
        }
        assertEq(sumPending, residual, "residual is not owned: sum(pendingETH) != totalPendingETH");

        // Backed by ETH the vault actually holds, not by an accounting entry.
        assertEq(address(vault).balance, residual, "residual is not backed by the vault's ETH balance");

        // Nothing evaporated between the contribution and the position.
        assertEq(
            vault.totalEthLocked() + residual, contributedTotal, "ETH went missing: deployed + residual != contributed"
        );

        // And it is owned by the RIGHT people. Aggregate ownership alone is too weak to catch audit M-2:
        // the post-loop remainder settlement hands the leftover to the last eligible benefactor, so a
        // carry-forward that credited nobody pro-rata would still keep `sum(pendingETH)` exact while
        // parking one batch's whole residual on one contributor. Each carry is
        // `floor(contribution * residual / contributedTotal)`, and the round-down remainder is under one
        // wei per benefactor, so that floor plus `benefactors.length` is a tight upper bound.
        for (uint256 i = 0; i < benefactors.length; i++) {
            uint256 proRata = (contributions[i] * residual) / contributedTotal;
            uint256 owned = vault.pendingETH(benefactors[i]);
            assertGe(owned, proRata, "benefactor carries less residual than their contribution earned");
            assertLe(owned, proRata + benefactors.length, "benefactor carries residual that is not theirs");
        }
    }

    /// @notice Assert a carried-forward contributor's gain in a later round is pro rata within that round.
    /// @dev The batch that round converts is `carried + otherContribution`, and
    ///      `_distributeSharesAndCleanup` issues shares in proportion to each benefactor's slice of it.
    ///      So `gain / otherShares` must equal `carried / otherContribution`. Cross-multiplied to stay in
    ///      integers. This is what separates "alice's residual bought her shares" from "alice's shares
    ///      moved for some other reason": a mis-attribution would land the gain on the wrong benefactor
    ///      or in the wrong size, and either one breaks the ratio rather than nudging it.
    function _assertRoundGainIsProRata(uint256 gain, uint256 carried, uint256 otherShares, uint256 otherContribution)
        internal
        pure
    {
        assertGt(gain, 0, "a carried residual must buy shares in the round that converts it");
        assertApproxEqRel(
            gain * otherContribution,
            otherShares * carried,
            0.0001e18, // 0.01%: the issuance floors, it does not drift
            "carried residual did not buy shares in proportion to what it was"
        );
    }

    /// @notice Assert share percentage matches expected (with AMM tolerance)
    function _assertSharePercentage(
        address benefactor,
        uint256 expectedBps, // 10000 = 100%
        uint256 toleranceBps // typically 100 = 1%
    )
        internal
        view
    {
        uint256 shares = vault.benefactorShares(benefactor);
        uint256 total = vault.totalShares();
        require(total > 0, "No shares issued yet");

        uint256 actualBps = (shares * 10000) / total;

        // Check within tolerance
        if (actualBps > expectedBps) {
            assertLe(actualBps - expectedBps, toleranceBps, "Share % too high");
        } else {
            assertLe(expectedBps - actualBps, toleranceBps, "Share % too low");
        }
    }

    // ┌─────────────────────────────────────┐
    // │  A. Vault Setup & Deployment Tests  │
    // └─────────────────────────────────────┘

    function test_deployVault_withValidParameters() public {
        // Deploy fresh vault (clone pattern)
        UniAlignmentVault newVaultImpl = new UniAlignmentVault();
        UniAlignmentVault newVault = UniAlignmentVault(payable(LibClone.clone(address(newVaultImpl))));
        vm.prank(owner);
        newVault.initialize(
            owner,
            WETH,
            UNISWAP_V4_POOL_MANAGER,
            alignmentToken,
            ZROUTER,
            3000,
            60,
            IVaultPriceValidator(
                address(new UniswapVaultPriceValidator(WETH, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800))
            ),
            IAlignmentRegistry(address(mockRegistry)),
            TARGET_ID,
            TREASURY
        );

        // Verify initial state
        assertEq(newVault.totalPendingETH(), 0, "Should start with 0 pending");
        assertEq(newVault.totalShares(), 0, "Should start with 0 shares");
        assertEq(newVault.accumulatedFees(), 0, "Should start with 0 fees");
        assertEq(newVault.totalLPUnits(), 0, "Should start with 0 LP units");
        assertEq(newVault.weth(), WETH, "WETH address mismatch");
        assertEq(newVault.poolManager(), UNISWAP_V4_POOL_MANAGER, "Pool manager mismatch");
        assertEq(newVault.alignmentToken(), alignmentToken, "Alignment token mismatch");

        emit log_string("[PASS] Vault deploys with correct initial state");
    }

    function test_setV4PoolKey_success() public {
        // H-02: Pool key must use native ETH (address(0))
        PoolKey memory newPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH
            currency1: Currency.wrap(alignmentToken),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });

        vm.prank(owner);
        vault.setV4PoolKey(newPoolKey);

        // Verify PoolKey was updated by checking we can use it in conversion
        // (actual validation would require reading struct fields which isn't exposed)
        emit log_string("[PASS] Owner can update V4 pool key");
    }

    // ┌─────────────────────────────────────┐
    // │  B. Contribution Flow Tests         │
    // └─────────────────────────────────────┘

    function test_receiveETH_basic() public {
        uint256 amount = 1 ether;
        _contribute(alice, amount);

        // Verify state changes
        assertEq(vault.pendingETH(alice), amount, "Pending ETH not tracked");
        assertEq(vault.benefactorTotalETH(alice), amount, "Total ETH not tracked");
        assertEq(vault.totalPendingETH(), amount, "Global pending not updated");

        emit log_string("[PASS] Basic ETH contribution tracked correctly");
    }

    function test_receiveETH_multipleContributors() public {
        _contribute(alice, 5 ether);
        _contribute(bob, 3 ether);

        assertEq(vault.pendingETH(alice), 5 ether, "Alice pending incorrect");
        assertEq(vault.pendingETH(bob), 3 ether, "Bob pending incorrect");
        assertEq(vault.totalPendingETH(), 8 ether, "Total pending incorrect");

        emit log_string("[PASS] Multiple contributors tracked separately");
    }

    function test_receiveETH_multipleContributionsSameBenefactor() public {
        _contribute(alice, 2 ether);
        _contribute(alice, 3 ether);

        assertEq(vault.pendingETH(alice), 5 ether, "Pending should accumulate");
        assertEq(vault.benefactorTotalETH(alice), 5 ether, "Total should accumulate");

        emit log_string("[PASS] Multiple contributions from same benefactor accumulate");
    }

    function test_receiveContribution_withBenefactor() public {
        uint256 amount = 1 ether;
        address hookCaller = makeAddr("hookCaller");

        vm.deal(hookCaller, amount);
        vm.prank(hookCaller);
        vault.receiveContribution{ value: amount }(
            Currency.wrap(vault.weth()), // currency (unused in current implementation)
            amount,
            alice // benefactor attribution
        );

        // Verify alice is credited (not hookCaller)
        assertEq(vault.pendingETH(alice), amount, "Alice should be credited");
        assertEq(vault.pendingETH(hookCaller), 0, "Hook caller should not be credited");
        assertEq(vault.benefactorTotalETH(alice), amount, "Alice total should increase");

        emit log_string("[PASS] Hook tax correctly attributes to benefactor");
    }

    // ┌─────────────────────────────────────┐
    // │  C. Share Issuance Tests (Core)     │
    // └─────────────────────────────────────┘

    function test_convertAndAddLiquidity_singleContributor() public {
        _contribute(alice, 5 ether);

        // Execute conversion
        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        vault.convertAndAddLiquidity(1);

        // Verify shares issued
        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 totalShares = vault.totalShares();

        assertGt(aliceShares, 0, "Alice should have shares");
        assertEq(aliceShares, totalShares, "Alice should have 100% of shares");

        // The residual a real pool leaves is alice's, and all of it.
        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;
        uint256[] memory contributions = new uint256[](1);
        contributions[0] = 5 ether;
        _assertResidualFullyOwned(benefactors, contributions, 5 ether);
        assertEq(vault.pendingETH(alice), vault.totalPendingETH(), "sole contributor owns the whole residual");

        // Caller reimbursement was removed: running a conversion never pays the caller.
        // (alice.balance only moves by gas spent.)

        emit log_string("[PASS] Single contributor receives all shares; the AMM residual stays theirs");
    }

    function test_convertAndAddLiquidity_twoEqualContributors_AMMAware() public {
        // Both contribute equal amounts BEFORE CONVERSION (same dragnet cycle)
        // Use larger amounts for stub compatibility (stub has integer division issues < 1 ether)
        _contribute(alice, 5 ether);
        _contribute(bob, 5 ether);

        // Execute conversion
        vault.convertAndAddLiquidity(1);

        // Verify shares with AMM tolerance
        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 bobShares = vault.benefactorShares(bob);
        uint256 totalShares = vault.totalShares();

        // Alice and Bob should have ~50% each (within 1%)
        _assertSharePercentage(alice, 5000, 100); // 50% ± 1%
        _assertSharePercentage(bob, 5000, 100);

        // Verify shares approximately equal
        uint256 ratio = (aliceShares * 1e18) / bobShares;
        assertApproxEqRel(ratio, 1e18, 0.01e18, "Shares should be ~equal");

        // The residual is split between them and fully owned.
        address[] memory benefactors = new address[](2);
        benefactors[0] = alice;
        benefactors[1] = bob;
        uint256[] memory contributions = new uint256[](2);
        contributions[0] = 5 ether;
        contributions[1] = 5 ether;
        _assertResidualFullyOwned(benefactors, contributions, 10 ether);

        emit log_string("[PASS] Equal contributors get equal shares (within AMM tolerance)");
    }

    function test_convertAndAddLiquidity_twoUnequalContributors() public {
        // Alice contributes 5 ETH, Bob contributes 3 ETH (5:3 ratio)
        _contribute(alice, 5 ether);
        _contribute(bob, 3 ether);

        // Execute conversion
        vault.convertAndAddLiquidity(1);

        // Verify shares match contribution ratio
        // Alice: 5/8 = 62.5% → 6250 bps
        // Bob: 3/8 = 37.5% → 3750 bps
        _assertSharePercentage(alice, 6250, 100); // 62.5% ± 1%
        _assertSharePercentage(bob, 3750, 100); // 37.5% ± 1%

        // Verify contribution ratio matches share ratio
        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 bobShares = vault.benefactorShares(bob);
        // Expected ratio: 5:3 (verify Alice has ~1.67x Bob's shares)
        // Calculate ratio: aliceShares / bobShares should be ~1.666...
        uint256 actualRatio = (aliceShares * 1e18) / bobShares;
        uint256 expectedMin = 1.6e18; // 1.6
        uint256 expectedMax = 1.7e18; // 1.7
        assertGe(actualRatio, expectedMin, "Ratio too low");
        assertLe(actualRatio, expectedMax, "Ratio too high");

        emit log_string("[PASS] Unequal contributors get proportional shares");
    }

    function test_convertAndAddLiquidity_tenContributors() public {
        // Create 10 contributors with varying amounts
        address[10] memory contributors;
        uint256 totalContributed = 0;

        // Define amounts individually to avoid array literal type issues
        uint256[10] memory amounts;
        amounts[0] = 1 ether;
        amounts[1] = 2 ether;
        amounts[2] = 3 ether;
        amounts[3] = 4 ether;
        amounts[4] = 5 ether;
        amounts[5] = 1 ether;
        amounts[6] = 2 ether;
        amounts[7] = 3 ether;
        amounts[8] = 4 ether;
        amounts[9] = 5 ether;

        for (uint256 i = 0; i < 10; i++) {
            contributors[i] = makeAddr(string(abi.encodePacked("contributor", vm.toString(i))));
            _contribute(contributors[i], amounts[i]);
            totalContributed += amounts[i];
        }

        // Execute conversion
        vault.convertAndAddLiquidity(1);

        // Verify each contributor's share percentage
        for (uint256 i = 0; i < 10; i++) {
            uint256 expectedBps = (amounts[i] * 10000) / totalContributed;
            _assertSharePercentage(contributors[i], expectedBps, 100); // ±1%
        }

        // The residual is spread across all ten and fully owned.
        address[] memory benefactors = new address[](10);
        uint256[] memory contributions = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            benefactors[i] = contributors[i];
            contributions[i] = amounts[i];
        }
        _assertResidualFullyOwned(benefactors, contributions, totalContributed);

        emit log_string("[PASS] 10 contributors all receive proportional shares");
    }

    function test_convertWithZeroPending_reverts() public {
        // Try to convert with no pending contributions
        vm.expectRevert(UniAlignmentVault.NoPendingETH.selector);
        vault.convertAndAddLiquidity(1);

        emit log_string("[PASS] Cannot convert with zero pending ETH");
    }

    // ┌─────────────────────────────────────┐
    // │  D. Multiple Conversion Tests       │
    // └─────────────────────────────────────┘

    function test_multipleConversions_sharesAccumulate() public {
        // Round 1: Alice contributes 5 ETH
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);
        uint256 aliceSharesRound1 = vault.benefactorShares(alice);
        // Round 1 leaves alice the AMM residual (see `_assertResidualFullyOwned`), so she is still a
        // participant going into round 2 and that ETH is hers to convert.
        uint256 aliceCarry = vault.pendingETH(alice);
        assertGt(aliceCarry, 0, "round 1 must leave a carry, or round 2 proves nothing");

        // Round 2: Bob contributes 5 ETH
        _contribute(bob, 5 ether);
        vault.convertAndAddLiquidity(1);

        // Alice's round-1 shares are never taken from her.
        uint256 aliceSharesRound2 = vault.benefactorShares(alice);
        assertGe(aliceSharesRound2, aliceSharesRound1, "Alice shares must never decrease");

        // Bob now has shares
        uint256 bobShares = vault.benefactorShares(bob);
        assertGt(bobShares, 0, "Bob should have shares");

        // Alice GAINS in round 2, and exactly in proportion to what she brought to it. Round 2's batch
        // is her carry plus bob's 5 ETH, and `_distributeSharesAndCleanup` issues shares pro rata within
        // the batch, so alice's gain stands to bob's shares as her carry stands to his contribution.
        // Asserting she is unchanged is the mock's world, where the residual was structurally zero.
        _assertRoundGainIsProRata(aliceSharesRound2 - aliceSharesRound1, aliceCarry, bobShares, 5 ether);

        // Total shares = Alice + Bob, alice read AFTER round 2.
        assertEq(vault.totalShares(), aliceSharesRound2 + bobShares, "Total should be sum");

        emit log_string("[PASS] Shares accumulate across multiple conversions");
    }

    function test_multipleConversions_newContributorDilution() public {
        // Round 1: Alice contributes 10 ETH
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 aliceCarry = vault.pendingETH(alice);
        assertGt(aliceCarry, 0, "round 1 must leave a carry, or round 2 proves nothing");

        // Round 2: Bob contributes 10 ETH (same amount as Alice)
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);
        uint256 bobShares = vault.benefactorShares(bob);

        // Both Alice and Bob contributed equal ETH across separate conversion rounds.
        // On a real fork, liquidity units differ between rounds due to pool state changes
        // (price movement from round 1's swap, different sqrtPriceX96, etc.)
        // Key invariants: both have shares, total shares grew after round 2.

        // Alice must be re-read after round 2: her round-1 residual rode along with bob's batch and
        // bought her more shares, so the round-1 figure is stale by exactly that gain.
        uint256 aliceSharesAfter = vault.benefactorShares(alice);
        uint256 totalShares = vault.totalShares();
        assertGt(aliceShares, 0, "Alice should have shares from round 1");
        assertGt(bobShares, 0, "Bob should have shares from round 2");
        assertGe(aliceSharesAfter, aliceShares, "Alice shares must never decrease");
        _assertRoundGainIsProRata(aliceSharesAfter - aliceShares, aliceCarry, bobShares, 10 ether);
        assertEq(aliceSharesAfter + bobShares, totalShares, "Total shares should equal sum");

        emit log_string("[PASS] Shares accumulate across multiple conversion rounds");
    }

    function test_conversionPaysNoExecutorReward() public {
        _contribute(alice, 10 ether);

        // Bob executes the conversion (not Alice). With reimbursement removed, Bob is only
        // out his gas — he receives no reward credit.
        vm.deal(bob, 0);
        vm.prank(bob);
        vault.convertAndAddLiquidity(1);

        assertEq(bob.balance, 0, "executor must receive no reward");
        emit log_string("[PASS] Conversion pays the executor no reward");
    }

    // ┌─────────────────────────────────────┐
    // │  E. Fee Accumulation & Claims        │
    // └─────────────────────────────────────┘

    function test_claimFees_singleContributor() public {
        // Setup: Alice gets shares
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        // Simulate fees accumulating
        vm.deal(owner, 2 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 2 ether }(2 ether);

        // Alice claims (should get all fees since she has 100% shares)
        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimFees();

        assertEq(claimed, 2 ether, "Alice should claim all fees");
        // On fork, actual received = claimed - gas cost
        assertGe(alice.balance, aliceBalanceBefore, "Alice balance should increase");
        assertApproxEqAbs(
            alice.balance - aliceBalanceBefore, 2 ether, 0.01 ether, "Alice should receive ~2 ETH minus gas"
        );

        emit log_string("[PASS] Single contributor claims all fees");
    }

    function test_claimFees_multipleContributors_proportional() public {
        // Setup: Alice 5 ETH, Bob 3 ETH → Alice gets 62.5%, Bob gets 37.5%
        _contribute(alice, 5 ether);
        _contribute(bob, 3 ether);
        vault.convertAndAddLiquidity(1);

        // Accumulate 1 ETH in fees
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 1 ether }(1 ether);

        // Calculate expected claims (with tolerance for share rounding)
        uint256 aliceShares = vault.benefactorShares(alice);
        uint256 bobShares = vault.benefactorShares(bob);
        uint256 totalShares = vault.totalShares();

        uint256 expectedAliceClaim = (1 ether * aliceShares) / totalShares;
        uint256 expectedBobClaim = (1 ether * bobShares) / totalShares;

        // Alice claims
        vm.prank(alice);
        uint256 aliceClaimed = vault.claimFees();
        assertEq(aliceClaimed, expectedAliceClaim, "Alice claim mismatch");

        // Bob claims
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        assertEq(bobClaimed, expectedBobClaim, "Bob claim mismatch");

        // Total claimed should equal total fees (within rounding)
        assertApproxEqAbs(aliceClaimed + bobClaimed, 1 ether, 2, "Total claims should equal total fees");

        emit log_string("[PASS] Multiple contributors claim proportional fees");
    }

    function test_claimFees_multipleClaimsAcrossDeposits() public {
        // Setup shares
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        // First fee deposit
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 1 ether }(1 ether);

        // Alice claims
        vm.prank(alice);
        uint256 firstClaim = vault.claimFees();
        assertEq(firstClaim, 1 ether, "First claim should be 1 ETH");

        // Second fee deposit
        vm.deal(owner, 2 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 2 ether }(2 ether);

        // Alice claims again (should only get delta)
        vm.prank(alice);
        uint256 secondClaim = vault.claimFees();
        assertEq(secondClaim, 2 ether, "Second claim should be delta (2 ETH)");

        // Third fee deposit
        vm.deal(owner, 3 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);

        // Alice claims third time
        vm.prank(alice);
        uint256 thirdClaim = vault.claimFees();
        assertEq(thirdClaim, 3 ether, "Third claim should be delta (3 ETH)");

        emit log_string("[PASS] Multi-claim delta calculation works correctly");
    }

    function test_claimFees_zeroSharesReverts() public {
        // Charlie has no shares
        vm.prank(charlie);
        vm.expectRevert(UniAlignmentVault.NoShares.selector);
        vault.claimFees();

        emit log_string("[PASS] Cannot claim fees with zero shares");
    }

    function test_claimFees_noFeesReverts() public {
        // Give Alice shares but no fees
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        // Try to claim with no accumulated fees
        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.NoFeesToClaim.selector);
        vault.claimFees();

        emit log_string("[PASS] Cannot claim when no fees accumulated");
    }

    // ┌─────────────────────────────────────┐
    // │  F. Edge Cases & Validation          │
    // └─────────────────────────────────────┘

    function test_contributionAfterConversion_startsNewDragnet() public {
        // Dragnet cycle 1 - use larger amount for stub compatibility
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        // A real pool leaves alice a residual rather than clearing her to zero, and it is hers.
        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;
        uint256[] memory contributions = new uint256[](1);
        contributions[0] = 5 ether;
        _assertResidualFullyOwned(benefactors, contributions, 5 ether);
        uint256 carried = vault.pendingETH(alice);
        assertGt(carried, 0, "a real pool leaves a residual to carry");

        // Dragnet cycle 2 - the new contribution accumulates ON TOP of what cycle 1 carried, which is
        // what makes the carried ETH reachable: it rides along with the next batch that converts.
        _contribute(alice, 3 ether);
        assertEq(vault.pendingETH(alice), 3 ether + carried, "new dragnet carries cycle 1's residual");
        assertEq(vault.totalPendingETH(), 3 ether + carried, "Global should update");

        emit log_string("[PASS] A new contribution accumulates on top of the carried residual");
    }

    function test_verySmallContribution_weiLevel() public {
        // Use 0.01 ETH instead of 1 wei (stub requires amounts >= 1 ether to produce non-zero tokens)
        _contribute(alice, 0.01 ether);

        assertEq(vault.pendingETH(alice), 0.01 ether, "Small contribution tracked");
        assertEq(vault.totalPendingETH(), 0.01 ether, "Global updated");

        // Note: Due to stub implementation, very small amounts may not work
        // In production with real swaps, this would route through actual DEX
        // For now, skip conversion test for wei-level as stub limitation

        emit log_string("[PASS] Small contributions tracked correctly (conversion skipped due to stub)");
    }

    function test_veryLargeContribution_1000ETH() public {
        _contribute(alice, 1000 ether);

        assertEq(vault.pendingETH(alice), 1000 ether, "Large contribution tracked");

        vault.convertAndAddLiquidity(1);
        assertGt(vault.benefactorShares(alice), 0, "Alice should have shares");

        // Verify LP units created (stub uses simple formula)
        uint256 lpUnits = vault.totalLPUnits();
        assertGt(lpUnits, 0, "LP units should be created");

        // With stub, LP units are roughly proportional to contribution
        // Exact calculation depends on stub's swap ratio and formula
        // Just verify it's reasonable (> 0 and < total contribution)
        assertLt(lpUnits, 1000 ether, "LP units should be less than contribution");

        emit log_string("[PASS] Large contributions (1000 ETH) handled correctly");
    }

    function test_manyBenefactors_gasCheck() public {
        // Create 20 contributors
        for (uint256 i = 0; i < 20; i++) {
            address contributor = makeAddr(string(abi.encodePacked("contrib", vm.toString(i))));
            _contribute(contributor, 1 ether);
        }

        // Measure gas for conversion with 20 benefactors
        uint256 gasBefore = gasleft();
        vault.convertAndAddLiquidity(1);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas used for 20 benefactors", gasUsed);
        assertLt(gasUsed, 3_000_000, "Should complete within reasonable gas");

        emit log_string("[PASS] 20 benefactors handled efficiently");
    }

    // ┌─────────────────────────────────────┐
    // │  Query Function Tests                │
    // └─────────────────────────────────────┘

    function test_getBenefactorContribution() public {
        _contribute(alice, 5 ether);
        _contribute(alice, 3 ether);

        assertEq(vault.getBenefactorContribution(alice), 8 ether, "Total contribution incorrect");

        emit log_string("[PASS] getBenefactorContribution returns historical total");
    }

    function test_getBenefactorShares() public {
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        uint256 shares = vault.getBenefactorShares(alice);
        assertGt(shares, 0, "Alice should have shares");
        assertEq(shares, vault.benefactorShares(alice), "Getter should match storage");

        emit log_string("[PASS] getBenefactorShares returns current shares");
    }

    function test_calculateClaimableAmount() public {
        // Setup shares
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);

        // Add fees
        vm.deal(owner, 5 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 5 ether }(5 ether);

        // Calculate claimable (total, not delta)
        uint256 claimable = vault.calculateClaimableAmount(alice);
        assertEq(claimable, 5 ether, "Alice should be able to claim all fees");

        // Claim some
        vm.prank(alice);
        vault.claimFees();

        // Note: calculateClaimableAmount returns TOTAL (not delta)
        // So it still shows 5 ETH even after claiming
        assertEq(vault.calculateClaimableAmount(alice), 5 ether, "Total still 5 ETH");

        // But getUnclaimedFees (delta) should be 0
        assertEq(vault.getUnclaimedFees(alice), 0, "No new fees yet (delta)");

        // Add more fees
        vm.deal(owner, 3 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 3 ether }(3 ether);

        // Total claimable now 8 ETH
        assertEq(vault.calculateClaimableAmount(alice), 8 ether, "Total now 8 ETH");

        // Unclaimed (delta) should be 3 ETH
        assertEq(vault.getUnclaimedFees(alice), 3 ether, "Delta is 3 ETH");

        emit log_string("[PASS] calculateClaimableAmount shows total, getUnclaimedFees shows delta");
    }

    function test_getUnclaimedFees() public {
        // Setup and verify it matches calculateClaimableAmount
        _contribute(alice, 5 ether);
        vault.convertAndAddLiquidity(1);

        vm.deal(owner, 2 ether);
        vm.prank(owner);
        vault.simulateFeeAccrual{ value: 2 ether }(2 ether);

        uint256 unclaimed = vault.getUnclaimedFees(alice);
        uint256 claimable = vault.calculateClaimableAmount(alice);

        assertEq(unclaimed, claimable, "getUnclaimedFees should match calculateClaimableAmount");

        emit log_string("[PASS] getUnclaimedFees returns correct amount");
    }

    // ========== ETH Reception ==========

    /// @notice Accept ETH from vault (caller rewards, refunds, etc.)
    receive() external payable { }
}
