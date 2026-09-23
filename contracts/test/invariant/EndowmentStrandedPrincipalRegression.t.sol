// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { EndowmentVaultHandler } from "./handlers/EndowmentVaultHandler.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry
} from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @title  EndowmentStrandedPrincipalRegression
/// @notice The invisible-strand shape behind `invariant_harvestFlatSplitConserves`, pinned as fixed calls
///         so it does not need a fuzzer to find it again.
///
/// @dev    WHY THIS FILE EXISTS. The conservation property found this as a one-wei overpay after 21,000
///         calls of a ten-thousand-run invariant campaign — a defect the per-push profile cannot reach and
///         which a different seed does not reproduce. Seed-dependence is not a bound, so the shape is
///         written out here with the arithmetic that makes it, and it runs in every profile at unit-test
///         cost — milliseconds, no fuzzing. If the handler's strand booking is deleted, these tests fail on
///         the next push instead of the defect surfacing on a weekly deep run, or not at all.
///
///         THE SHAPE, in four steps:
///           1. a deposit and an `accrueYield`, harvested — the harvest's redeem burns ERC-4626 shares with
///              CEILING rounding (EIP-4626 requires it), so the position comes back with a share count well
///              below its asset count: a share price above one;
///           2. an `execute` sized to leave a remainder SMALLER than that share price. The ceiling burn then
///              takes the LAST share while assets remain, so supply hits zero with assets still held;
///           3. `convertToAssets` on a zero supply is zero, so the vault reads its position as EMPTY. The
///              remainder is invisible: not in `currentPositionValue`, not in the basis, and the round close
///              that follows redeems nothing and zeroes the basis over it;
///           4. the next deposit mints against that zero supply at 1:1 and inherits the orphan. Position
///              value comes back one strand ABOVE the basis the deposit credited, and the next harvest
///              splits that strand 80/19/1 as yield.
///
///         WHAT IT IS AND IS NOT. No value is minted: every wei the harvest pays out was redeemed from the
///         position, and it is the vault's own principal — stranded at step 3 and reclassified as yield at
///         step 4. The conservation break is against the handler's ghost of what was INJECTED, which books
///         a strand at the call that creates it and could not see one created while the position priced at
///         zero. Direction is the safety property and it holds: the vault never distributes more than it
///         holds, and it never pays out value that was not its own. Magnitude is a different question, and
///         the answer is NOT one wei: the strand is the position's share price at the moment of the drain,
///         and the tests below drive it to 5e7 wei and then to the entire principal. What that costs is
///         real — principal reclassified as yield leaves 20% of it routed to the target and protocol legs
///         rather than to the pool the benefactors own.
///
///         SCOPE, and it is what keeps this an accounting finding rather than an open hole.
///         `MockStataToken` prices shares as a `totalManaged / totalShares` RATIO, so every redemption's
///         ceiling burn ratchets that price and a large enough one burns the supply out from under a live
///         position — which is what makes the strand unbounded here. A production static aToken prices off
///         Aave's liquidity index, which no redemption moves, so the supply tracks the position and the
///         residual stays at conversion dust: the one-wei family the pre-testnet audit's `_realizeImpairment`
///         note and the fork suite's `ERC4626_FLOOR_WEI` already bound. The magnitudes below are therefore
///         the mock's own; whether step 4's re-attribution happens at all against the real token is a fork
///         question, and this suite does not answer it.
contract EndowmentStrandedPrincipalRegression is Test {
    AlignmentEndowmentVault internal vault;
    MockWETH internal weth;
    MockStataToken internal stata;
    MockMasterRegistry internal masterRegistry;
    MockAmbassadorRegistry internal ambassadorRegistry;
    EndowmentVaultHandler internal handler;

    address internal vaultOwner = address(0xA0FF);
    address internal treasury = address(0xA0FE);
    address internal alignmentToken = address(0xA0FD);
    address internal communityPayout = address(0xA0FC);
    address internal ambassador = address(0xA0FB);

    uint256 internal constant TARGET_ID = 42;
    uint256 internal constant MAX = type(uint256).max;

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );
        vm.warp(1_000_000);

        handler =
            new EndowmentVaultHandler(vault, weth, stata, ambassadorRegistry, vaultOwner, ambassador, TARGET_ID, 4);
    }

    /// @notice The fuzzer's own six calls, as fixed arguments: deposit, accrue, harvest, execute, deposit,
    ///         harvest. Every intermediate figure is asserted, so a change to any step in the chain names
    ///         itself rather than moving the totals silently.
    function test_invisibleStrandIsRecoveredAndConservationHolds() public {
        // `bound` maps `MAX - 3` to `max - 3` of the deposit range [1e12, 100 ether].
        handler.deposit(MAX, MAX - 3);
        assertEq(vault.totalPrincipal(), 99_999_999_999_999_999_997, "deposit#1 basis");

        // `bound` maps MAX to the top of the accrual range: 50 ether.
        handler.accrueYield(MAX);
        assertEq(handler.sumYieldInjected(), 50 ether, "the only injection in the sequence");

        handler.harvest(0);
        assertEq(handler.sumHarvestDistributed(), 50 ether, "harvest#1 took the whole pool");
        // Step 1: the redeem's ceiling share-burn leaves the position priced at 1.5 assets per share.
        assertEq(stata.totalManaged(), 99_999_999_999_999_999_997, "position assets after harvest#1");
        assertEq(stata.totalShares(), 66_666_666_666_666_666_664, "position shares after harvest#1");

        // Step 2/3: `bound` maps `MAX - 1` to `corpus - 1`, a remainder of 1 — under the share price, so the
        // burn takes the last share and the wei is left behind unpriced.
        handler.execute(MAX - 1);
        assertEq(stata.totalShares(), 0, "every share burned");
        assertEq(stata.totalManaged(), 1, "one wei of real assets left in the position");
        assertEq(vault.currentPositionValue(), 0, "and the vault reads its position as empty");
        assertEq(vault.totalPrincipal(), 0, "the round close zeroed the basis over it");
        assertEq(vault.roundResidue(), 0, "the close redeemed nothing to book as residue");

        // Step 4: the next deposit mints 1:1 against the zero supply and inherits the orphan.
        handler.deposit(1, MAX - 1);
        assertEq(vault.totalPrincipal(), 99_999_999_999_999_999_999, "deposit#2 basis");
        assertEq(vault.currentPositionValue(), 100_000_000_000_000_000_000, "position value is basis + strand");
        assertEq(handler.sumStrandRecoveredAtDeposit(), 1, "the strand is booked where it becomes visible");
        assertFalse(handler.ghost_depositMintedYield(), "and it is within the strand that was there to hand over");

        // The harvest splits the strand as yield, and the ghost now covers it.
        handler.harvest(MAX - 1);
        assertEq(handler.sumHarvestDistributed(), 50 ether + 1, "harvest#2 distributed the recovered strand");
        assertEq(handler.sumYieldInjected(), 50 ether + 1, "which the realized-basis ghost accounts for");
        assertLe(
            handler.sumHarvestDistributed(),
            handler.sumYieldInjected(),
            "endowment: harvest distributed more yield than was injected"
        );
    }

    /// @notice The magnitude is the position's share price, not a wei. Same shape, driven with a small
    ///         principal and a large yield so the post-harvest share price is ~5e7 assets per share — and
    ///         the strand, and the phantom yield the next harvest splits, is that whole figure.
    function test_strandScalesWithTheSharePriceNotWithOneWei() public {
        handler.deposit(0, 1e12); // the floor of the deposit range
        handler.accrueYield(MAX); // 50 ether against 1e12 of principal
        handler.harvest(0);

        uint256 managed = stata.totalManaged();
        uint256 shares = stata.totalShares();
        assertEq(managed, 1e12, "position assets after the harvest");
        assertEq(shares, 19_999, "the ceiling burn left a share price of ~5e7");

        // The largest remainder the ceiling burn still swallows every share for.
        uint256 strand = managed / shares - 1;
        assertEq(strand, 50_002_499, "strand targeted: five thousand times the fuzzer's example");

        address sink = handler.deploySink();
        uint256 value = vault.deployableCorpus() - strand;
        vm.prank(ambassador);
        vault.execute(sink, value, "");

        assertEq(stata.totalShares(), 0, "every share burned");
        assertEq(stata.totalManaged(), strand, "the whole strand left unpriced");
        assertEq(vault.currentPositionValue(), 0, "and invisible to the vault");

        uint256 distributedBefore = handler.sumHarvestDistributed();
        handler.deposit(1, MAX - 1);
        assertEq(handler.sumStrandRecoveredAtDeposit(), strand, "the whole strand is booked at the deposit");
        assertFalse(handler.ghost_depositMintedYield(), "still within the strand that was there");

        handler.harvest(0);
        assertEq(handler.sumHarvestDistributed() - distributedBefore, strand, "one harvest split the whole strand");
        assertLe(
            handler.sumHarvestDistributed(),
            handler.sumYieldInjected(),
            "endowment: harvest distributed more yield than was injected"
        );
    }

    /// @notice The ceiling of the strand is the whole position, not a dust figure — and no ambassador is
    ///         needed to reach it. A SECOND accrue-and-harvest against the already-ratcheted share price
    ///         burns the last share on the harvest's own redeem, orphaning the entire principal. The basis
    ///         stands over an unpriced position until the next deposit, where `_realizeImpairment` reads the
    ///         position as empty and writes the basis to zero; the deposit then re-mints against the zero
    ///         supply and inherits the whole of it as yield.
    ///
    ///         This is the reason the finding was worth chasing past "one wei of rounding": the MAGNITUDE
    ///         does not come from the vault's `REDEEM_DUST` tolerance, it comes from how far the position's
    ///         share price has been ratcheted, and nothing here bounds that. What DOES bound it is the
    ///         wrapper: `MockStataToken` prices shares as an assets/shares ratio, so a harvest that redeems
    ///         almost the whole position multiplies that price without limit. A production static aToken
    ///         prices off Aave's liquidity index, which no redemption moves — so the supply cannot be burned
    ///         out from under a live position and the residual stays at conversion dust, the one-wei family
    ///         the pre-testnet audit's `_realizeImpairment` note and the fork suite's `ERC4626_FLOOR_WEI`
    ///         already describe. The magnitude below is the mock's; the mechanism is the vault's.
    function test_aHarvestAloneCanOrphanTheWholePosition() public {
        handler.deposit(0, 1e12);

        handler.accrueYield(MAX);
        handler.harvest(0);
        assertEq(stata.totalShares(), 19_999, "first harvest ratchets the share price to ~5e7");

        handler.accrueYield(MAX);
        handler.harvest(0);
        assertEq(stata.totalShares(), 0, "the second harvest's redeem burns the last share");
        assertEq(stata.totalManaged(), 1e12, "the whole principal is left in the wrapper, unpriced");
        assertEq(vault.currentPositionValue(), 0, "the vault reads its position as empty");
        assertEq(vault.totalPrincipal(), 1e12, "while the basis still stands over it");

        uint256 distributedBefore = handler.sumHarvestDistributed();
        handler.deposit(1, MAX - 1);
        assertEq(handler.sumStrandRecoveredAtDeposit(), 1e12, "the whole principal comes back as pool");
        assertFalse(handler.ghost_depositMintedYield(), "within the strand, so not minted");

        handler.harvest(0);
        assertEq(
            handler.sumHarvestDistributed() - distributedBefore,
            1e12,
            "and one harvest splits the whole of it 80/19/1 as yield"
        );
        assertLe(
            handler.sumHarvestDistributed(),
            handler.sumYieldInjected(),
            "endowment: harvest distributed more yield than was injected"
        );
    }

    /// @notice The bound is not reachable from the vault as written, and that is the claim, not an excuse.
    ///         A deposit adds the same `amount` to the position value and to the basis, so it moves the yield
    ///         pool by nothing of its own; everything that appears across one is a strand handed back. This
    ///         test states that equality directly, so a change that makes a deposit credit the basis by less
    ///         than it adds to the position — the only way `ghost_depositMintedYield` can fire — fails here
    ///         first, with the two figures named.
    ///
    ///         Checked that the flag bites, by mutating `_deposit`'s basis credit to `amount - 1`:
    ///         `invariant_depositRecoversAStrandButNeverMintsOne` fails on the first sequence, and all three
    ///         tests here fail on their pinned figures. `invariant_harvestFlatSplitConserves` still PASSES
    ///         under that mutation at 256 runs / 128,000 calls — a deposit quietly minting a wei of pool
    ///         looks exactly like the strand it is allowed to recover — which is why the magnitude is a
    ///         separate assertion rather than a wider tolerance on the conservation one. The mutation is not
    ///         committed; these tests are what stand in the tree.
    function test_aDepositMovesBasisAndPositionValueTogether() public {
        handler.deposit(MAX, MAX - 3);

        uint256 basisBefore = vault.totalPrincipal();
        uint256 valueBefore = vault.currentPositionValue();
        assertEq(valueBefore, basisBefore, "the pool is empty before the second deposit");

        handler.deposit(1, MAX - 1);

        assertEq(
            vault.totalPrincipal() - basisBefore,
            vault.currentPositionValue() - valueBefore,
            "a deposit credited the basis by a different amount than it added to the position"
        );
        assertEq(handler.sumStrandRecoveredAtDeposit(), 0, "no strand, so nothing to recover");
        assertFalse(handler.ghost_depositMintedYield(), "and nothing minted");
    }
}
