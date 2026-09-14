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
    uint256 public sumHarvestDistributed; // Σ yield distributed (creator+target+proto)

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
    bool public ghost_principalExceedsBasis; // Σ live per-benefactor principal drifted above the basis

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
        try vault.receiveContribution{ value: amount }(native, amount, b) {
            sumDeposited += amount;
            depositCount++;
            _checkPrincipalConserves();
        } catch { }
    }

    /// @notice Inject Aave yield (value-per-share appreciation) so harvest has something to split.
    function accrueYield(uint256 amount) external {
        if (vault.totalShares() == 0) return; // no basis → injected value is unassignable, skip
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
        uint256 c0 = vault.totalYieldToCreators();
        uint256 t0 = vault.totalYieldToTarget();
        uint256 p0 = vault.totalProtocolFees();

        try vault.harvest() {
            uint256 dCred = vault.totalYieldToCreators() - c0;
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
        } catch { }
    }

    /// @notice Ambassador deploys corpus capital (value-only) — principal leaving via the withdraw path.
    function execute(uint256 amount) external {
        uint256 corpus = vault.deployableCorpus();
        if (corpus == 0) return;
        amount = bound(amount, 1, corpus);
        uint256 poolBefore = _yieldPoolValue();
        uint256 sinkBefore = deploySink.balance;
        vm.prank(ambassador);
        try vault.execute(deploySink, amount, "") returns (bytes memory) {
            // Count the ACTUAL ETH that left the vault (`got`), not the requested `amount`: on a
            // liquidity-capped redeem `execute` forwards `got = amount − dust` and RETAINS the dust as still-
            // deployable corpus (debits the basis by `got`, not `amount`). Counting `amount` would over-report
            // principal-out by the retained-and-redeployable dust and spuriously trip `invariant_neverOverRedeem`.
            sumDeployedViaExecute += deploySink.balance - sinkBefore;
            executeCount++;
            // A dust-tolerated partial redeem (got < value, within REDEEM_DUST) strands the un-redeemed
            // principal in the position with its basis already debited → it surfaces as realized yield.
            // Book it on the same realized basis as `sumHarvestDistributed`.
            uint256 poolAfter = _yieldPoolValue();
            if (poolAfter > poolBefore) sumYieldInjected += poolAfter - poolBefore;
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
        try vault.harvest() { } catch { }

        uint256 basis = vault.totalPrincipal();
        uint256 value = vault.currentPositionValue();
        uint256 expected = value < basis ? value : basis; // the written-down, realizable basis

        uint256 balBefore = recovery.balance;
        uint256 poolBefore = _yieldPoolValue();
        vm.prank(vaultOwner);
        try vault.migratePosition(recovery) {
            uint256 got = recovery.balance - balBefore;
            if (got != expected) ghost_migrateNotWholePosition = true;
            if (got > basis || got > value) ghost_overRedeemToRecipient = true;
            sumRedeemedViaMigrate += got;
            migrateCount++;
            // Zeroing the basis while redeeming only the floor of the realizable value can leave a sub-wei
            // residual as position-value-above-basis (realized yield); book it on the realized basis.
            uint256 poolAfter = _yieldPoolValue();
            if (poolAfter > poolBefore) sumYieldInjected += poolAfter - poolBefore;
        } catch {
            // Under a solvency-only position the written-down basis is always redeemable — a shortfall here
            // is a solvency/liquidity confusion (the very bug this suite guards against).
            ghost_solvencyMigrateReverted = true;
        }
    }
}
