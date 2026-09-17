// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { LiquidityAmounts } from "../../src/libraries/v4/LiquidityAmounts.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";

/// @notice Vault whose `_addToLpPosition` reproduces the REAL v4 sizing rule instead of the
///         "ETH leg always fully absorbed" shortcut that `TestableUniAlignmentVault` takes.
/// @dev The production `_addToLpPosition` calls `LiquidityAmounts.getLiquidityForAmounts` and then
///      lets PoolManager pull whatever that liquidity requires. This override does exactly that,
///      against a caller-supplied spot price, using the SAME production library — so `ethDeposited`
///      is the real binding-leg amount. No behaviour is invented here; the only thing mocked away is
///      the PoolManager round trip.
contract RealSizingUniAlignmentVault is UniAlignmentVault {
    uint160 public spotSqrtPriceX96;

    /// @dev The vault is used as a CLONE, so an inline field initializer never runs. Set it explicitly.
    function setSpot(uint160 p) external {
        spotSqrtPriceX96 = p;
    }

    function _addToLpPosition(uint256 amount0, uint256 amount1, int24 tickLower, int24 tickUpper)
        internal
        override
        returns (uint128 liquidityUnits, uint256 ethDeposited)
    {
        if (amount0 == 0 || amount1 == 0) revert AmountMustBePositive();
        lastTickLower = tickLower;
        lastTickUpper = tickUpper;

        uint160 sa = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sb = TickMath.getSqrtPriceAtTick(tickUpper);
        liquidityUnits = LiquidityAmounts.getLiquidityForAmounts(spotSqrtPriceX96, sa, sb, amount0, amount1);
        if (liquidityUnits == 0) revert InsufficientLiquidity();
        (uint256 used0, uint256 used1) =
            LiquidityAmounts.getAmountsForLiquidity(spotSqrtPriceX96, sa, sb, liquidityUnits);
        bool ethIs0 = Currency.unwrap(v4PoolKey.currency0) == address(0);
        ethDeposited = ethIs0 ? used0 : used1;
        // Simulate PoolManager pulling ONLY the token the liquidity actually needs, so whatever the
        // vault is left holding is the genuine token-side residual (finding D).
        uint256 tokenUsed = ethIs0 ? used1 : used0;
        if (tokenUsed > 0) SafeTransferLib.safeTransfer(alignmentToken, address(0xDEAD), tokenUsed);
    }
}

/**
 * @title UniVaultShareAccountingTest
 * @notice PoC for the unowned-pending-ETH share-accounting defect in UniAlignmentVault.
 *
 *  `_distributeSharesAndCleanup` (src/vaults/uni/UniAlignmentVault.sol:441-497) zeroes every
 *  `pendingETH[b]` while carrying the unabsorbed LP ETH forward in `totalPendingETH` (:495). The
 *  carried ETH therefore belongs to NOBODY. The next batch mints shares for it, the loop can only
 *  attribute `sum(pendingETH) < ethToAdd`, and the shortfall lands in `accumulatedDustShares` —
 *  which is handed to THAT batch's `largestContributor` (:476-483), a party who funded none of it.
 *
 *  The ZAMM sibling does not have this hole: ZAMMAlignmentVault.sol:398-425 carries the residual
 *  back as per-benefactor `pendingContribution[b]`.
 */
contract UniVaultShareAccountingTest is Test {
    RealSizingUniAlignmentVault internal vault;
    MockEXECToken internal token;
    MockZRouter internal router;
    MockVaultPriceValidator internal validator;
    MockAlignmentRegistry internal registry;

    address internal owner = address(0xB055);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal mallory = address(0x4A11);

    address internal constant WETH_ = address(0x1111111111111111111111111111111111111111);
    address internal constant PM_ = address(0x2222222222222222222222222222222222222222); // codeless => fee collect no-ops
    address internal constant TREASURY = address(0xFEE);
    uint256 internal constant TARGET_ID = 1;

    function setUp() public {
        token = new MockEXECToken(10_000_000e18);
        router = new MockZRouter();
        validator = new MockVaultPriceValidator();
        registry = new MockAlignmentRegistry();

        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(token), true);
        registry.setReferencePool(
            TARGET_ID,
            address(token),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        validator.setEthPer1e18Tokens(1e18); // 1 token == 1 ETH at the oracle

        vm.deal(address(router), 10_000 ether);
        token.transfer(address(router), 5_000_000e18);

        RealSizingUniAlignmentVault impl = new RealSizingUniAlignmentVault();
        vault = RealSizingUniAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            owner,
            WETH_,
            PM_,
            address(token),
            address(router),
            3000,
            60,
            IVaultPriceValidator(address(validator)),
            IAlignmentRegistry(address(registry)),
            TARGET_ID,
            TREASURY
        );

        vm.prank(owner);
        vault.setV4PoolKey(
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(address(token)),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(0))
            })
        );

        vault.setSpot(79228162514264337593543950336); // 1 token == 1 ETH, matching the oracle

        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(mallory, 10_000 ether);
    }

    function _contribute(address who, uint256 amt) internal {
        vm.prank(who);
        vault.receiveContribution{ value: amt }(Currency.wrap(address(0)), amt, who);
    }

    // ------------------------------------------------------------------
    // A.1 — the carried residual is owned by nobody: sum(pendingETH) != totalPendingETH
    // ------------------------------------------------------------------
    /// @dev This is exactly `invariant_pendingSumConsistency` from test/invariant/UniVaultInvariant.t.sol.
    ///      That invariant is VACUOUS today because TestableUniAlignmentVault._addToLpPosition hardcodes
    ///      `ethDeposited` to the whole ETH leg, so `ethUnabsorbed` is always 0 under the mock.
    function test_A1_carriedResidualIsOwnedByNobody() public {
        // A 5% shortfall on the token leg is the WORST the oracle floor permits:
        // _floorTokenOut = expected * (10000 - maxPriceDeviationBps)/10000, maxPriceDeviationBps = 500.
        router.setOutRatio(0.95e18);

        _contribute(alice, 100 ether);
        assertEq(vault.pendingETH(alice), 100 ether, "pre: alice pending");
        assertEq(vault.totalPendingETH(), 100 ether, "pre: total pending");

        vault.convertAndAddLiquidity(1);

        uint256 orphaned = vault.totalPendingETH();
        console2.log("orphaned totalPendingETH (wei):", orphaned);
        console2.log("alice pendingETH after convert :", vault.pendingETH(alice));
        console2.log("alice shares                   :", vault.getBenefactorShares(alice));

        assertGt(orphaned, 0, "no residual was carried - test setup is wrong");
        // THE DEFECT: the carried ETH is credited to no benefactor.
        assertEq(vault.pendingETH(alice), orphaned, "UniAlignmentVault:495 - carried residual has no owner");
    }

    // ------------------------------------------------------------------
    // A.2 — the orphaned ETH mints shares that are handed to a later batch's largest contributor
    // ------------------------------------------------------------------
    function test_A2_orphanedEthMintsSharesForSomeoneElse() public {
        router.setOutRatio(0.95e18);

        // Batch 1: alice alone. 100 ETH in; part of the ETH leg is not absorbed and is carried.
        _contribute(alice, 100 ether);
        vault.convertAndAddLiquidity(1);

        uint256 aliceShares = vault.getBenefactorShares(alice);
        uint256 lpAfter1 = vault.totalLPUnits();
        uint256 orphaned = vault.totalPendingETH();
        assertGt(orphaned, 0, "no residual carried - setup wrong");

        // Batch 2: bob small, mallory large. Mallory is this batch's `largestContributor`.
        _contribute(bob, 100 ether);
        _contribute(mallory, 400 ether);

        uint256 malloryBefore = vault.getBenefactorShares(mallory);
        vault.convertAndAddLiquidity(1);

        uint256 malloryGain = vault.getBenefactorShares(mallory) - malloryBefore;
        uint256 lpBatch2 = vault.totalLPUnits() - lpAfter1;
        uint256 batchEth = 500 ether + orphaned;
        uint256 malloryFair = lpBatch2 * 400 ether / batchEth;

        console2.log("alice contributed (wei)        :", uint256(100 ether));
        console2.log("alice ETH orphaned by batch 1  :", orphaned);
        console2.log("alice shares before batch 2    :", aliceShares);
        console2.log("alice shares after  batch 2    :", vault.getBenefactorShares(alice));
        console2.log("batch-2 liquidity units        :", lpBatch2);
        console2.log("mallory FAIR (400/batchEth)    :", malloryFair);
        console2.log("mallory ACTUAL                 :", malloryGain);
        console2.log("mallory windfall               :", malloryGain > malloryFair ? malloryGain - malloryFair : 0);
        console2.log("accumulatedDustShares left     :", vault.accumulatedDustShares());

        // Alice is never credited for the ETH the vault carried forward on her behalf.
        assertEq(vault.getBenefactorShares(alice), aliceShares, "alice got nothing for her carried ETH");

        // THE DEFECT: mallory receives more than the liquidity her own ETH funded, because the
        // dust block minted by alice's orphaned ETH is handed to the batch's largestContributor.
        assertLe(malloryGain, malloryFair, "UniAlignmentVault:476-483 - mallory took shares she did not fund");
    }

    // ------------------------------------------------------------------
    // C — the two-step sharePercent division: how much dust does it actually create?
    // ------------------------------------------------------------------
    /// @dev Residual is forced to zero (ETH leg binds) so the ONLY dust is the :461-462 rounding.
    function test_C_transposedDivisionDustIsWeiScale() public {
        router.setOutRatio(1.05e18); // token surplus -> ETH leg binds -> ethUnabsorbed == 0

        _contribute(alice, 1 ether);
        _contribute(bob, 1 ether);
        _contribute(mallory, 1 ether);

        vault.convertAndAddLiquidity(1);

        assertLe(vault.totalPendingETH(), 2, "residual must be ~zero for this measurement");
        uint256 dust = vault.accumulatedDustShares();
        uint256 minted = vault.totalLPUnits();
        console2.log("liquidity units minted         :", minted);
        console2.log("accumulatedDustShares (C only) :", dust);
        console2.log("dustDistributionThreshold      :", vault.dustDistributionThreshold());
        assertLt(dust, 1000, "C: transposition dust is wei-scale, not material");
    }

    // ------------------------------------------------------------------
    // D — token-side residual is never re-credited
    // ------------------------------------------------------------------
    function test_D_tokenResidualStrandedInVault() public {
        router.setOutRatio(1.05e18); // token surplus -> ETH leg binds -> token left over

        _contribute(alice, 100 ether);
        vault.convertAndAddLiquidity(1);
        uint256 stranded1 = token.balanceOf(address(vault));

        _contribute(bob, 100 ether);
        vault.convertAndAddLiquidity(1);
        uint256 stranded2 = token.balanceOf(address(vault));

        console2.log("token stranded after batch 1   :", stranded1);
        console2.log("token stranded after batch 2   :", stranded2);
        assertGt(stranded1, 0, "no token residual produced");
        assertGt(stranded2, stranded1, "D: token residual accretes with no path out");
    }
}
