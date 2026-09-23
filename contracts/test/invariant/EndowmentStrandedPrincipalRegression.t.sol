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

    /// @notice An injection made while the wrapper's share supply is EMPTY is booked once, at the deposit
    ///         that surfaces it — not once by the injection and again by the strand.
    ///
    /// @dev    The orphan state above is also a state the handler can keep injecting into: `simulateYield`
    ///         raises the wrapper's managed assets whether or not any shares are outstanding. With no supply
    ///         the injected value is unpriced exactly as the orphaned principal is, so it leaves in the same
    ///         strand and the next deposit hands the two back together. Book the injection at the call as
    ///         well and the same wei is in `sumYieldInjected` twice.
    ///
    ///         That double booking is invisible to the magnitude bound: `ghost_depositMintedYield` compares
    ///         what appeared against the strand that was sitting there, and the injection is legitimately
    ///         PART of that strand. What it moves is the conservation bound — `sumYieldInjected` runs ahead
    ///         of anything the vault can distribute, so `invariant_harvestFlatSplitConserves` holds with the
    ///         whole injection as slack and would keep holding over an overpay of that size. Measured before
    ///         the handler's guard read the wrapper's supply: an `accrueYield` of 50 ether here left
    ///         `sumHarvestDistributed` 50 ether below `sumYieldInjected`. The assertion at the end is that
    ///         the gap is zero, not that it is small.
    function test_anAccrualIntoAnEmptySupplyIsBookedOnceNotTwice() public {
        handler.deposit(0, 1e12);
        handler.accrueYield(MAX);
        handler.harvest(0);
        handler.accrueYield(MAX);
        handler.harvest(0);

        // The orphan: no share supply, the principal still in the wrapper, the basis still standing over it.
        assertEq(stata.totalShares(), 0, "the setup did not reach the orphaned position");
        assertEq(stata.totalManaged(), 1e12, "the principal is not in the wrapper to be injected alongside");
        assertNotEq(vault.totalShares(), 0, "the basis is zero: the wrong guard would skip for the right reason");

        uint256 injectedBefore = handler.sumYieldInjected();
        uint256 distributedBefore = handler.sumHarvestDistributed();
        assertEq(injectedBefore, distributedBefore, "the two harvests left a gap before the probe even starts");

        // The injection the position cannot assign. It must not be booked here.
        handler.accrueYield(MAX);
        assertEq(handler.sumYieldInjected(), injectedBefore, "an unassignable injection was booked at the call");
        assertEq(stata.totalManaged(), 1e12, "the wrapper took an injection it had no supply to price");

        // The deposit hands back the strand, and the strand is the principal alone.
        handler.deposit(1, MAX - 1);
        assertEq(handler.sumYieldInjected() - injectedBefore, 1e12, "the deposit booked more than the strand held");
        assertEq(handler.sumStrandRecoveredAtDeposit(), 1e12, "the strand is the orphaned principal, nothing more");
        assertFalse(handler.ghost_depositMintedYield(), "and it is within the strand that was there to hand over");

        // And the vault distributes every wei of it, so the conservation bound is tight rather than slack.
        handler.harvest(0);
        assertEq(handler.sumHarvestDistributed() - distributedBefore, 1e12, "the harvest split something else");
        assertEq(
            handler.sumYieldInjected(),
            handler.sumHarvestDistributed(),
            "the injected ghost stands above what the vault could distribute: that gap is unwatched slack"
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

    /// @notice Yield that an injection already booked, left behind by a LIQUIDITY-CAPPED harvest and then
    ///         orphaned into the strand, is booked ONCE — the deposit that hands the strand back books only
    ///         the part of it that is not already outstanding.
    ///
    /// @dev    The sibling above closes the double-booking an `accrueYield` into an EMPTY share supply made.
    ///         This is the same double-booking reached with the supply still live, so the injection is
    ///         legitimately booked at the call and the guard there cannot help. A liquidity cap sized to
    ///         leave a remainder under the position's ratcheted share price makes the harvest's ceiling burn
    ///         take the LAST share: the harvest distributes only what the cap let it redeem, and the rest of
    ///         the injection — value `sumYieldInjected` is still carrying as outstanding — is orphaned in the
    ///         wrapper alongside the principal. The next deposit inherits BOTH as one strand.
    ///
    ///         Booking the whole strand there counts the injected part twice, and nothing catches it:
    ///         `ghost_depositMintedYield` compares what appeared against the strand that was sitting in the
    ///         wrapper, and the injected part is genuinely PART of that strand. What moves is the
    ///         conservation bound. Measured before the fix, on exactly this sequence:
    ///         `sumYieldInjected - sumHarvestDistributed` ended at 2_499_125_056_252_812 wei, so
    ///         `invariant_harvestFlatSplitConserves` would have held over an overpay of that size.
    ///
    ///         The window the cap has to land in is (share price - the wei the burn may not swallow), which
    ///         is narrow while the price is near one and widens without bound as each redemption's ceiling
    ///         burn ratchets it — the same unbounded quantity the tests above drive from 1 wei to the whole
    ///         principal. The assertion at the end is that the gap is zero, not that it is small.
    function test_aCappedHarvestLeavesAnInjectionInTheStrandBookedOnce() public {
        handler.deposit(0, 1e12);
        handler.accrueYield(MAX);
        handler.harvest(0);
        assertEq(stata.totalShares(), 19_999, "the first harvest ratchets the share price to ~5e7");

        // A second injection, this time with the supply still live: it lands on the outstanding shares, so
        // it is assignable and `accrueYield` books it at the call, exactly as it should.
        handler.accrueYield(MAX);
        uint256 managed = stata.totalManaged();
        uint256 shares = stata.totalShares();
        assertEq(managed, 50_000_001_000_000_000_000, "position assets carrying the second injection");
        assertEq(shares, 19_999, "an injection mints no shares");
        assertEq(handler.sumYieldInjected() - handler.sumHarvestDistributed(), 50 ether, "the whole injection");

        // The largest cap whose ceiling burn still swallows every share: the remainder it leaves is the
        // position's share price, and a burn of `ceil(cap * shares / managed)` at that size takes all 19_999.
        uint256 cap = (managed * (shares - 1)) / shares + 1;
        assertEq(cap, 49_997_500_874_943_747_188, "cap targeted at the last share");
        handler.setLiquidityCap(cap);

        handler.harvest(0);
        assertEq(stata.totalShares(), 0, "the capped redeem's ceiling burn took the last share");
        assertEq(stata.totalManaged(), managed - cap, "the rest of the injection is left in the wrapper");
        assertEq(vault.currentPositionValue(), 0, "and the vault reads its position as empty");
        assertEq(vault.totalPrincipal(), 1e12, "while the basis still stands over the orphaned principal");

        // What the harvest could not take is still outstanding in the injected ghost. It is ALSO now sitting
        // in the strand, which is what makes the deposit below able to book it a second time.
        uint256 outstanding = handler.sumYieldInjected() - handler.sumHarvestDistributed();
        assertEq(outstanding, 50 ether - cap, "the capped harvest left this much of the injection outstanding");
        assertEq(stata.totalManaged(), outstanding + 1e12, "strand = the outstanding injection + the principal");

        handler.setLiquidityCap(0);
        uint256 distributedBefore = handler.sumHarvestDistributed();
        uint256 strandBefore = stata.totalManaged();
        uint256 recoveredBefore = handler.sumStrandRecoveredAtDeposit();

        handler.deposit(1, 1e12);
        assertEq(vault.currentPositionValue() - vault.totalPrincipal(), strandBefore, "the whole strand came back");
        assertEq(
            handler.sumStrandRecoveredAtDeposit() - recoveredBefore,
            1e12,
            "the deposit booked the outstanding injection a second time"
        );
        assertFalse(handler.ghost_depositMintedYield(), "the strand genuinely held it, so the magnitude bound is mute");

        // The vault distributes every wei of the strand, and the ghost has room for exactly that and no more.
        handler.harvest(0);
        assertEq(handler.sumHarvestDistributed() - distributedBefore, strandBefore, "the harvest split the strand");
        assertEq(
            handler.sumYieldInjected(),
            handler.sumHarvestDistributed(),
            "the injected ghost stands above what the vault could distribute: that gap is unwatched slack"
        );
    }

    /// @dev The three yield legs as the handler reads them — the creator counter PLUS the carried remainder,
    ///      because a leg too small to move the per-share accumulator waits in the remainder rather than in
    ///      the counter.
    function _legsPaid() internal view returns (uint256) {
        return vault.totalYieldToCreators() + vault.creatorYieldRemainder() + vault.totalYieldToTarget()
            + vault.totalProtocolFees();
    }

    /// @notice `execute` distributes yield before it moves principal, and the ghost books it — so the
    ///         handler's view of what is still OUTSTANDING is what the vault actually owes, not an overstate.
    ///
    /// @dev    This is the direction the strand fix above could have gone wrong in. That fix books only the
    ///         part of a strand that is not already outstanding, and it reads "outstanding" as
    ///         `sumYieldInjected - sumHarvestDistributed`. `execute` opens with the same `_crystallizeYield`
    ///         body `harvest()` does, so it pays all three legs; a handler that books `harvest()`'s legs and
    ///         not `execute`'s leaves that difference standing over money the vault already paid out, and the
    ///         subtraction then treats a genuinely fresh strand as already-booked and UNDER-books it — the
    ///         ghost running BELOW what the vault can distribute, which is the direction no invariant here
    ///         watches.
    ///
    ///         So the leg delta is booked on every path that crystallizes, and this pins it on `execute` end
    ///         to end, with the two roles separated: the first execute distributes the yield and the second
    ///         orphans a strand worth ~5e7 wei, so the fresh strand and the money already paid out are
    ///         different orders of magnitude and a confusion between them cannot hide in rounding.
    ///
    ///         Checked that it bites, by deleting the `execute` leg booking: `sumHarvestDistributed` stays 0
    ///         where the vault has paid 50 ether, `outstanding` reads 50 ether instead of 0, the deposit
    ///         books 0 of the strand instead of all of it, and the run ends with `sumYieldInjected` 50 ether
    ///         against `sumHarvestDistributed` of one strand. The mutation is not committed.
    function test_anExecuteDistributesAndTheGhostBooksItSoTheStrandIsNotUnderBooked() public {
        handler.deposit(0, 1e12);
        handler.accrueYield(MAX);
        assertEq(handler.sumYieldInjected(), 50 ether, "the only injection so far");
        assertEq(handler.sumHarvestDistributed(), 0, "and no harvest has run");

        // Step 1: an `execute` with yield pending. Its own crystallize pays the legs; no `harvest()` is
        // involved, so this is exactly the distribution a harvest-only ghost cannot see. One wei of corpus
        // is deployed alongside, which leaves the position live and its share price ratcheted.
        uint256 legsBefore = _legsPaid();
        handler.execute(1);
        assertEq(_legsPaid() - legsBefore, 50 ether, "the execute crystallized the pending yield");
        assertEq(handler.sumHarvestDistributed(), 50 ether, "and the ghost booked it as distributed");
        assertEq(
            handler.sumYieldInjected() - handler.sumHarvestDistributed(),
            0,
            "nothing is outstanding: every injected wei has been paid out"
        );

        // Step 2: a second execute, sized to leave a remainder under the ratcheted share price, so the
        // ceiling burn takes the last share and the remainder is orphaned unpriced.
        uint256 strand = stata.totalManaged() / stata.totalShares() - 1;
        assertEq(strand, 50_004_999, "strand targeted at the ratcheted share price");
        handler.execute(vault.deployableCorpus() - strand);
        assertEq(stata.totalShares(), 0, "every share burned");
        assertEq(stata.totalManaged(), strand, "the whole strand left unpriced");
        assertEq(vault.currentPositionValue(), 0, "and the vault reads its position as empty");

        // Step 3: the deposit inherits it. With `outstanding` at zero the whole strand is fresh, so it is
        // booked in full — the assertion an unbooked execute-side distribution turns red.
        handler.deposit(1, 1e12);
        assertEq(handler.sumStrandRecoveredAtDeposit(), strand, "the strand was under-booked at the deposit");
        assertFalse(handler.ghost_depositMintedYield(), "and it is within the strand that was there");

        handler.harvest(0);
        assertEq(
            handler.sumYieldInjected(),
            handler.sumHarvestDistributed(),
            "the ghost and the vault disagree about what has been distributed"
        );
    }

    /// @notice `migrate` distributes on two sub-calls — its preparatory `harvest()` and `migratePosition`'s
    ///         own crystallize — and the ghost books both.
    ///
    /// @dev    Same direction as the `execute` test above. `migrate` is the other path whose distribution a
    ///         harvest-only ghost misses, and it misses it twice over: the handler harvests first to make the
    ///         redemption a principal redemption, and `migratePosition` crystallizes again on the way in. The
    ///         preparatory harvest is booked OUTSIDE the `try`, because the vault has paid those legs whether
    ///         or not the migration that follows goes through.
    function test_aMigrateDistributesOnBothLegsAndTheGhostBooksBoth() public {
        handler.deposit(0, 1e12);
        handler.accrueYield(MAX);
        assertEq(handler.sumHarvestDistributed(), 0, "no harvest has run");

        uint256 legsBefore = _legsPaid();
        handler.migrate(0);
        assertEq(handler.migrateCount(), 1, "the migration did not go through");
        assertEq(_legsPaid() - legsBefore, 50 ether, "the migrate crystallized the pending yield");
        assertEq(handler.sumHarvestDistributed(), 50 ether, "and the ghost booked every wei of it");
        assertEq(
            handler.sumYieldInjected(),
            handler.sumHarvestDistributed(),
            "the ghost is carrying yield the vault has already paid out as still outstanding"
        );
    }
}
