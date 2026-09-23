// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
// Reuse the endowment unit test's inline mocks (impairment/liquidity levers live on MockStataToken).
import {
    MockWETH,
    MockStataToken,
    MockAmbassadorRegistry,
    MockOwnable
} from "../../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @notice Invariant handler for `AlignmentEndowmentVault` impairment socialization.
/// @dev    Drives the vault's ACTUAL socialization surface — there is NO per-benefactor exit (principal is
///         a permanent donation), so no first-mover claim-ordering can be fuzzed. Principal only leaves via
///         (1) the aggregate owner-only `migratePosition` and (2) an ambassador `execute`, both of which
///         act on the one pooled bucket. This handler exercises deposits, yield accrual, the flat harvest,
///         ambassador execute, owner migrate, plus solvency (`simulateLoss`) and liquidity
///         (`setMaxWithdrawCap`) impairment levers, ghost-tracking the conservation quantities and pinning
///         the split at each harvest.
contract EndowmentVaultHandler is Test {
    // Split constants mirrored from AlignmentEndowmentVault (internal there) to recompute the harvest split.
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    uint256 internal constant TARGET_BPS = 1_900; // 19%
    uint256 internal constant REDEEM_DUST = 1e6; // wei — mirror of the vault constant
    uint256 internal constant ACC_PRECISION = 1e18; // mirror of the vault's accumulator scale

    AlignmentEndowmentVault public immutable vault;
    MockWETH public immutable weth;
    MockStataToken public immutable stata;
    MockAmbassadorRegistry public immutable ambReg;

    address public immutable vaultOwner;
    address public immutable ambassador;
    uint256 public immutable targetId;

    address public recovery; // migrate recipient (the relocated position)
    address public deploySink; // execute recipient (corpus deployment sink)

    address[] public benefactors; // contract benefactors (permanent donors)

    // ── Ghost conservation state ──────────────────────────────────────────────
    uint256 public sumDeposited; // Σ principal ever deposited
    uint256 public sumRedeemedViaMigrate; // Σ ETH redeemed to `recovery` by migrate
    uint256 public sumDeployedViaExecute; // Σ principal deployed to `deploySink` by execute
    // Σ value that legitimately entered the yield pool, on a REALIZED basis (see `_yieldPoolValue`): the
    // `simulateYield` injections PLUS any principal a dust-tolerated partial redeem stranded into the pool.
    // NOT the raw intended `simulateYield` arg.
    uint256 public sumYieldInjected;
    // Σ yield the vault has distributed (creator+target+proto), across EVERY path that distributes — not
    // just `harvest()`. `deposit`, `execute` and `migratePosition` each open with the same
    // `_crystallizeYield` body, so each of them can pay the three legs, and a leg a handler action did not
    // book is a distribution the conservation bound never sees. `releaseCorpusToCommunity` opens with it
    // too and this handler drives no action that reaches it. See `_legsPaid` for the whole call-site set.
    uint256 public sumHarvestDistributed;
    // Σ strand a deposit handed back to the pool (see `_strandedInPosition`). A component of
    // `sumYieldInjected`, kept separately so the quantity is readable rather than absorbed.
    uint256 public sumStrandRecoveredAtDeposit;

    uint256 public depositCount;
    uint256 public harvestCount;
    uint256 public executeCount;
    uint256 public migrateCount;
    uint256 public impairmentCount;

    // ── Ghost violation flags (invariants assert these stay false) ────────────
    bool public ghost_migrateNotWholePosition; // migrate redeemed != the whole realizable basis
    bool public ghost_overRedeemToRecipient; // migrate redeemed more than the position could back
    bool public ghost_solvencyMigrateReverted; // migrate RedeemShortfall'd under a solvency-only haircut (cap==0)
    bool public ghost_harvestSplitViolation; // harvest split (80/19/1) mismatched
    bool public ghost_creatorYieldHeldWhenItCouldBeCredited; // held creator leg large enough to move the accumulator
    bool public ghost_principalExceedsBasis; // Σ live per-benefactor principal drifted above the basis
    bool public ghost_depositMintedYield; // a deposit raised the yield pool by more than the strand it inherited

    constructor(
        AlignmentEndowmentVault _vault,
        MockWETH _weth,
        MockStataToken _stata,
        MockAmbassadorRegistry _ambReg,
        address _vaultOwner,
        address _ambassador,
        uint256 _targetId,
        uint256 _numBenefactors
    ) {
        vault = _vault;
        weth = _weth;
        stata = _stata;
        ambReg = _ambReg;
        vaultOwner = _vaultOwner;
        ambassador = _ambassador;
        targetId = _targetId;

        recovery = makeAddr("endowment_recovery");
        deploySink = makeAddr("endowment_deploySink");

        // Benefactors must be contracts (the vault rejects codeless benefactors). MockOwnable is one.
        for (uint256 i = 0; i < _numBenefactors; i++) {
            benefactors.push(address(new MockOwnable(address(this))));
        }
    }

    function _benefactor(uint256 seed) internal view returns (address) {
        return benefactors[seed % benefactors.length];
    }

    /// @dev The vault's live "yield pool": position value above the tracked principal basis — exactly what
    ///      `harvest()` realizes and splits (mirrors the vault's `_pendingYield`). Used to keep the injected
    ///      ghost on a REALIZED basis: `migratePosition` and `execute` debit the principal basis but may
    ///      redeem strictly less from the position (the vault tolerates a shortfall up to `REDEEM_DUST` on a
    ///      partial redeem, per its `got + REDEEM_DUST < value` guard). That un-redeemed principal STAYS in the
    ///      position with the basis already decremented, so it becomes position-value-above-basis — genuine,
    ///      distributable yield the vault WILL split on the next harvest, with no corresponding `simulateYield`.
    ///      Counting the pool's increase across those calls into `sumYieldInjected` makes the conservation
    ///      invariant (`sumHarvestDistributed <= sumYieldInjected`) hold on a realized basis and stay
    ///      deterministic, while still catching any harvest that distributes MORE than the pool ever held.
    function _yieldPoolValue() internal view returns (uint256) {
        uint256 basis = vault.totalPrincipal();
        uint256 val = vault.currentPositionValue();
        return val > basis ? val - basis : 0;
    }

    /// @dev Σ of the three yield legs the vault has booked to date. The creator leg is the counter PLUS the
    ///      carried remainder, for the reason `harvest` states: the counter holds only the wei the per-share
    ///      accumulator could take on, and a leg too small to move it waits in the remainder.
    ///
    ///      This is read before and after every action that can distribute, and the difference is booked
    ///      into `sumHarvestDistributed`. `harvest()` is not the only such action. The vault calls
    ///      `_crystallizeYield` from FIVE places, and `harvest()`'s own body is only one of them: `_deposit`,
    ///      `execute`, `migratePosition` and `releaseCorpusToCommunity` each open with it too, so any of
    ///      those can pay all three legs before it touches principal. Booking only the `harvest()` ones
    ///      leaves `sumHarvestDistributed` an undercount — which matters twice over. It leaves those
    ///      distributions outside `invariant_harvestFlatSplitConserves` altogether, and it corrupts the one
    ///      quantity the deposit-side strand booking has to reason about: how much of `sumYieldInjected` is
    ///      still OUTSTANDING rather than already paid out.
    ///
    ///      Four of the five are driven here. `releaseCorpusToCommunity` is NOT — this handler exposes no
    ///      release action, so the leg it can pay is unreachable and the omission costs nothing today. It is
    ///      named rather than left out because the enumeration is what a future action would be read
    ///      against: add a release to this handler without bracketing it in `_legsPaid` the way `execute`
    ///      and `migrate` are, and it distributes yield the conservation bound never sees, silently.
    function _legsPaid() internal view returns (uint256) {
        return vault.totalYieldToCreators() + vault.creatorYieldRemainder() + vault.totalYieldToTarget()
            + vault.totalProtocolFees();
    }

    /// @dev The pool value an action created out of value the ghost has not seen, given the pool before the
    ///      call, the pool after it, and what the call distributed on the way through.
    ///
    ///      `poolAfter - poolBefore` is the wrong measure the moment an action distributes: the call's own
    ///      `_crystallizeYield` takes `distributed` OUT of the pool before anything new lands in it, so the
    ///      raw difference nets a creation against a payout and under-books the creation by exactly that
    ///      much. The pool the creation landed on top of is `poolBefore - distributed` — call it the mid
    ///      pool — and the creation is what stands above THAT.
    ///
    ///      Booking `created` into `sumYieldInjected` and `distributed` into `sumHarvestDistributed` keeps
    ///      the handler's slack `sumYieldInjected - sumHarvestDistributed` at or above the vault's live pool
    ///      across every action: an injection raises both by the same wei, a distribution lowers both by the
    ///      same wei, and an impairment lowers only the pool. That is what makes the slack safe to SUBTRACT
    ///      in `deposit`, and it is why the fix is to book what was missing rather than to add a second
    ///      counter beside the two that already exist.
    function _created(uint256 poolBefore, uint256 poolAfter, uint256 distributed) internal pure returns (uint256) {
        uint256 poolMid = poolBefore > distributed ? poolBefore - distributed : 0;
        return poolAfter > poolMid ? poolAfter - poolMid : 0;
    }

    /// @dev Assets the ERC-4626 is holding that the vault's position does NOT price — the strand, measured
    ///      from outside the vault.
    ///
    ///      `_yieldPoolValue` books a strand at the call that CREATES it, which is right whenever the
    ///      position still prices the strand at that moment. There is one shape where it does not. A
    ///      withdrawal sized so the 4626's ceiling share-burn takes the LAST share leaves assets behind with
    ///      no share supply outstanding, and `convertToAssets` on a zero supply is zero — so the vault reads
    ///      its position as empty, and the strand is invisible to `_yieldPoolValue` at the instant it is
    ///      made. It reappears only at the NEXT deposit, which mints against a zero supply at 1:1 and so
    ///      re-attributes the orphaned assets to the vault's fresh shares: position value comes back one
    ///      strand above the basis the deposit credited, and the following harvest splits it 80/19/1.
    ///
    ///      So the deposit is the second place the realized-basis rule has to be applied, and this reader is
    ///      what bounds it: a pool that appears across a deposit is legitimate only up to the strand that was
    ///      already sitting in the 4626 before it. Anything beyond that is a deposit minting yield, which is
    ///      the defect `ghost_depositMintedYield` names.
    function _strandedInPosition() internal view returns (uint256) {
        uint256 held = stata.totalManaged();
        uint256 priced = vault.currentPositionValue();
        return held > priced ? held - priced : 0;
    }

    /// @dev Σ of every benefactor's live principal must never exceed the basis the position actually holds.
    ///      The per-benefactor figure is a share of one pool, so this is the check that the share arithmetic
    ///      never promises out more principal than there is.
    function _checkPrincipalConserves() internal {
        uint256 sum;
        for (uint256 i = 0; i < benefactors.length; i++) {
            sum += vault.principalOf(benefactors[i]);
        }
        if (sum > vault.totalPrincipal()) ghost_principalExceedsBasis = true;
    }

    function getBenefactors() external view returns (address[] memory) {
        return benefactors;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Actions
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice A benefactor pledges permanent principal.
    function deposit(uint256 seed, uint256 amount) external {
        if (vault.migrated()) return; // intake closed post-migrate
        address b = _benefactor(seed);
        amount = bound(amount, 1e12, 100 ether);

        vm.deal(address(this), address(this).balance + amount);
        Currency native = Currency.wrap(address(0));
        // Measured BEFORE the call: the strand already parked in the 4626, the pool the vault prices, and
        // the legs to date (`_deposit` opens with `_crystallizeYield`, so this call may distribute).
        uint256 strandBefore = _strandedInPosition();
        uint256 poolBefore = _yieldPoolValue();
        uint256 legsBefore = _legsPaid();
        try vault.receiveContribution{ value: amount }(native, amount, b) {
            sumDeposited += amount;
            depositCount++;

            uint256 distributed = _legsPaid() - legsBefore;
            sumHarvestDistributed += distributed;

            // A deposit adds `amount` to BOTH the position value and the basis, so on its own it moves the
            // yield pool by nothing. A pool that appears here is a strand the 4626 was holding unpriced,
            // handed to the fresh shares — realized yield the vault WILL split, booked on the same basis as
            // `sumHarvestDistributed`, exactly as `execute` and `migrate` already book theirs. It is bounded
            // by the strand that was there to hand over; a larger one is the deposit itself minting yield.
            uint256 poolAfter = _yieldPoolValue();
            if (poolAfter > poolBefore && poolAfter - poolBefore > strandBefore) ghost_depositMintedYield = true;

            uint256 created = _created(poolBefore, poolAfter, distributed);
            if (created > 0) {
                // Book only the part of the strand that is NOT already outstanding in `sumYieldInjected`.
                //
                // A strand is not necessarily orphaned PRINCIPAL. Everything the wrapper holds that the
                // position does not price lands in it, and an `accrueYield` the vault has been paid for but
                // has not yet distributed is one of the things that can be sitting there: a liquidity-capped
                // harvest redeems less than the pending yield and the ceiling burn can still take the last
                // share, leaving the remainder of that injection orphaned exactly as the principal is. Those
                // wei are already in `sumYieldInjected` from the `accrueYield` call, so booking the whole
                // strand here counts them twice and hands `invariant_harvestFlatSplitConserves` that much
                // unwatched slack in the safe direction. `ghost_depositMintedYield` cannot see it — the
                // strand genuinely holds the money, so the magnitude bound above is satisfied.
                //
                // `outstanding` is what the ghost has booked and the vault has not yet paid out, and
                // `_legsPaid` is what makes it exact rather than an estimate — every path that distributes
                // now subtracts from it. Of that, the part sitting ABOVE the pool the vault still prices is
                // precisely the part that went into the strand, so it is what this deposit is handing back
                // rather than meeting for the first time.
                uint256 outstanding =
                    sumYieldInjected > sumHarvestDistributed ? sumYieldInjected - sumHarvestDistributed : 0;
                uint256 poolMid = poolBefore > distributed ? poolBefore - distributed : 0;
                uint256 alreadyStranded = outstanding > poolMid ? outstanding - poolMid : 0;
                uint256 fresh = created > alreadyStranded ? created - alreadyStranded : 0;
                sumYieldInjected += fresh;
                sumStrandRecoveredAtDeposit += fresh;
            }
            _checkPrincipalConserves();
        } catch { }
    }

    /// @notice Inject Aave yield (value-per-share appreciation) so harvest has something to split.
    function accrueYield(uint256 amount) external {
        // The guard reads the ERC-4626's SHARE SUPPLY, and it has to. `simulateYield` raises the wrapper's
        // managed assets without minting, so the outstanding supply is what decides whether the injected
        // value lands on anything. With no supply it lands on nothing: it sits in the wrapper unpriced by
        // `convertToAssets`, and `deposit` books it as strand when the next mint hands it to fresh shares.
        // Counting it here as well books the same wei twice and hands `invariant_harvestFlatSplitConserves`
        // exactly that much slack.
        //
        // NOT `vault.totalShares()`. The endowment has no tradable shares and that accessor returns the
        // principal BASIS. A basis can stand over an emptied supply — the shape
        // `EndowmentStrandedPrincipalRegression` pins — so reading it here passes the guard in the one state
        // the guard exists to refuse.
        if (stata.totalShares() == 0) return; // no share supply → injected value is unassignable, skip
        amount = bound(amount, 1e9, 50 ether);
        // Back the WETH so downstream redemptions settle in ETH (mirrors the unit test's _simulateYield).
        vm.deal(address(weth), address(weth).balance + amount);
        weth.mint(address(this), amount);
        weth.approve(address(stata), amount);
        try stata.simulateYield(amount) {
            sumYieldInjected += amount;
        } catch { }
    }

    /// @notice Realize + split the compounded yield 80/19/1, and pin the split wei-exactly.
    function harvest(uint256) external {
        // The creator LEG is `totalYieldToCreators` plus `creatorYieldRemainder`. The counter books only the
        // wei the per-share accumulator could actually take on; a leg the accumulator cannot express at the
        // live share count waits in the remainder for a later harvest to fold in. Reading the counter alone
        // under-reports the leg by whatever is held, and the 80/19/1 recomputation below would fail on a
        // pool whose share count has outrun it — which is the state the share-price floor admits.
        uint256 c0 = vault.totalYieldToCreators() + vault.creatorYieldRemainder();
        uint256 t0 = vault.totalYieldToTarget();
        uint256 p0 = vault.totalProtocolFees();

        try vault.harvest() {
            uint256 dCred = (vault.totalYieldToCreators() + vault.creatorYieldRemainder()) - c0;
            uint256 dTgt = vault.totalYieldToTarget() - t0;
            uint256 dProt = vault.totalProtocolFees() - p0;
            uint256 got = dCred + dTgt + dProt; // realized+distributed yield this harvest
            sumHarvestDistributed += got;
            harvestCount++;

            // Recompute the exact split and compare to the counters.
            if (got > 0) {
                uint256 expProt = (got * PROTOCOL_BPS) / BPS;
                uint256 expTgt = (got * TARGET_BPS) / BPS;
                uint256 expCred = got - expProt - expTgt;

                if (dCred != expCred || dTgt != expTgt || dProt != expProt) {
                    ghost_harvestSplitViolation = true;
                }
            }

            // Creator yield is held ONLY because one unit of the accumulator costs more than the held pot:
            // the moment that pot can buy a unit, the harvest must spend it. A pot standing at or above a
            // unit after a harvest is a creator leg parked where no benefactor can reach it.
            uint256 shares = vault.totalPrincipalShares();
            if (shares > 0 && vault.creatorYieldRemainder() * ACC_PRECISION >= shares) {
                ghost_creatorYieldHeldWhenItCouldBeCredited = true;
            }
        } catch { }
    }

    /// @notice Ambassador deploys corpus capital (value-only) — principal leaving via the withdraw path.
    function execute(uint256 amount) external {
        uint256 corpus = vault.deployableCorpus();
        if (corpus == 0) return;
        amount = bound(amount, 1, corpus);
        uint256 poolBefore = _yieldPoolValue();
        uint256 legsBefore = _legsPaid();
        uint256 sinkBefore = deploySink.balance;
        vm.prank(ambassador);
        try vault.execute(deploySink, amount, "") returns (bytes memory) {
            // Count the ACTUAL ETH that left the vault (`got`), not the requested `amount`: on a
            // liquidity-capped redeem `execute` forwards `got = amount − dust` and RETAINS the dust as still-
            // deployable corpus (debits the basis by `got`, not `amount`). Counting `amount` would over-report
            // principal-out by the retained-and-redeployable dust and spuriously trip `invariant_neverOverRedeem`.
            sumDeployedViaExecute += deploySink.balance - sinkBefore;
            executeCount++;
            // `execute` opens with `_crystallizeYield`, so it pays the three legs before it moves any
            // principal. Book that as distributed: it is a distribution the conservation bound must cover,
            // and it is also what tells `deposit` how much of `sumYieldInjected` is still outstanding.
            uint256 distributed = _legsPaid() - legsBefore;
            sumHarvestDistributed += distributed;
            // A dust-tolerated partial redeem (got < value, within REDEEM_DUST) strands the un-redeemed
            // principal in the position with its basis already debited → it surfaces as realized yield.
            // Book it on the same realized basis as `sumHarvestDistributed`, measured against the pool this
            // call's own distribution left behind rather than the pool it started with (see `_created`).
            sumYieldInjected += _created(poolBefore, _yieldPoolValue(), distributed);
            _checkPrincipalConserves();
        } catch { }
    }

    /// @notice Solvency haircut: lower value-per-share (Aave bad-debt), the case the write-down socializes.
    function induceImpairment(uint256 bps) external {
        uint256 managed = stata.totalManaged();
        if (managed == 0) return;
        bps = bound(bps, 1, 9_000); // up to 90% haircut
        uint256 lost = (managed * bps) / BPS;
        if (lost == 0) return;
        try stata.simulateLoss(lost) {
            impairmentCount++;
        } catch { }
    }

    /// @notice Liquidity crunch: cap what maxWithdraw returns (Aave can't service the full redemption now).
    ///         Distinct from a solvency haircut — this is the ONLY thing that may legitimately RedeemShortfall.
    function setLiquidityCap(uint256 cap) external {
        uint256 value = vault.currentPositionValue();
        cap = bound(cap, 0, value == 0 ? 1 ether : value); // 0 == uncapped
        stata.setMaxWithdrawCap(cap);
    }

    /// @notice Aggregate owner-only migration — the sole owner-side socialization surface. Under a
    ///         solvency-only position (liquidity cap cleared) it must redeem EXACTLY the written-down basis,
    ///         never more than the position can back, and never RedeemShortfall.
    function migrate(uint256) external {
        if (vault.migrated()) return;
        if (vault.totalPrincipal() == 0) return; // would revert NoPrincipal

        // Solvency-only conditions: clear any liquidity cap so a RedeemShortfall here would be a real defect,
        // and expel unrealized yield so the redemption is a PRINCIPAL redemption (Σredeemed ≤ Σdeposited).
        stata.setMaxWithdrawCap(0);
        // The preparatory harvest distributes for real whether or not the migration below goes through, so
        // book its legs here rather than inside the `try` — the vault has paid them either way.
        uint256 legsBefore = _legsPaid();
        try vault.harvest() { } catch { }
        sumHarvestDistributed += _legsPaid() - legsBefore;

        uint256 basis = vault.totalPrincipal();
        uint256 value = vault.currentPositionValue();
        uint256 expected = value < basis ? value : basis; // the written-down, realizable basis

        uint256 balBefore = recovery.balance;
        uint256 poolBefore = _yieldPoolValue();
        legsBefore = _legsPaid();
        vm.prank(vaultOwner);
        try vault.migratePosition(recovery) {
            uint256 got = recovery.balance - balBefore;
            if (got != expected) ghost_migrateNotWholePosition = true;
            if (got > basis || got > value) ghost_overRedeemToRecipient = true;
            sumRedeemedViaMigrate += got;
            migrateCount++;
            // `migratePosition` crystallizes too, so it can pay the legs on its way through; book that as
            // distributed for the same two reasons `execute` does.
            uint256 distributed = _legsPaid() - legsBefore;
            sumHarvestDistributed += distributed;
            // Zeroing the basis while redeeming only the floor of the realizable value can leave a sub-wei
            // residual as position-value-above-basis (realized yield); book it on the realized basis, net of
            // what this call distributed out of the pool it started with (see `_created`).
            sumYieldInjected += _created(poolBefore, _yieldPoolValue(), distributed);
        } catch {
            // Under a solvency-only position the written-down basis is always redeemable — a shortfall here
            // is a solvency/liquidity confusion (the very bug this suite guards against).
            ghost_solvencyMigrateReverted = true;
        }
    }
}
