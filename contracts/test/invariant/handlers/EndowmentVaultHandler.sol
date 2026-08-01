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

/// @notice Invariant handler for `AlignmentEndowmentVault` impairment socialization (noesis-103, §4.4).
/// @dev    Drives the reworked vault's ACTUAL socialization surface — there is NO per-benefactor exit
///         (principal is a permanent donation), so no first-mover claim-ordering can be fuzzed. Principal
///         only leaves the vault via (1) the aggregate owner-only `migratePosition` (escrow pro-rata) and
///         (2) an ambassador `execute` on the vested corpus. This handler exercises deposits, yield accrual,
///         two-class harvest, vesting, ambassador execute, owner migrate, plus solvency (`simulateLoss`) and
///         liquidity (`setMaxWithdrawCap`) impairment levers, ghost-tracking the conservation quantities and
///         pinning the socialization math at each migrate/harvest.
contract EndowmentVaultHandler is Test {
    // Split constants mirrored from AlignmentEndowmentVault (internal there) to recompute the harvest split.
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PROTOCOL_BPS = 100; // 1%
    uint256 internal constant TARGET_BPS_ESCROW = 1_900; // 19%
    uint256 internal constant REDEEM_DUST = 1e6; // wei — mirror of the vault constant

    AlignmentEndowmentVault public immutable vault;
    MockWETH public immutable weth;
    MockStataToken public immutable stata;
    MockAmbassadorRegistry public immutable ambReg;

    address public immutable vaultOwner;
    address public immutable ambassador;
    uint256 public immutable targetId;
    uint256 public immutable vestDuration;

    address public recovery; // migrate recipient (escrow pro-rata redemption sink)
    address public deploySink; // execute recipient (vested corpus deployment sink)

    address[] public benefactors; // contract benefactors (permanent donors)

    // ── Ghost conservation state ──────────────────────────────────────────────
    uint256 public sumDeposited; // Σ principal ever deposited
    uint256 public sumRedeemedViaMigrate; // Σ ETH redeemed to `recovery` by migrate (escrow pro-rata)
    uint256 public sumDeployedViaExecute; // Σ vested principal deployed to `deploySink` by execute
    // Σ value that legitimately entered the yield pool, on a REALIZED basis (see `_yieldPoolValue`): the
    // `simulateYield` injections PLUS any principal a dust-tolerated partial redeem stranded into the pool.
    // NOT the raw intended `simulateYield` arg.
    uint256 public sumYieldInjected;
    uint256 public sumHarvestDistributed; // Σ yield distributed across the two classes (creator+target+proto)

    uint256 public depositCount;
    uint256 public harvestCount;
    uint256 public vestCount;
    uint256 public executeCount;
    uint256 public migrateCount;
    uint256 public impairmentCount;

    // ── Ghost violation flags (invariants assert these stay false) ────────────
    bool public ghost_proRataViolation; // migrate redeemed != floor(value·escrowed/basis)
    bool public ghost_overRedeemToRecipient; // migrate redeemed more than the escrow principal / pro-rata claim
    bool public ghost_solvencyMigrateReverted; // migrate RedeemShortfall'd under a solvency-only haircut (cap==0)
    bool public ghost_harvestSplitViolation; // harvest two-class split (80/19/1 + 0/99/1) mismatched

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
        vestDuration = _vault.VEST_DURATION();

        recovery = makeAddr("noesis103_recovery");
        deploySink = makeAddr("noesis103_deploySink");

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
        uint256 basis = vault.totalEscrowedPrincipal() + vault.totalVestedDeployable();
        uint256 val = vault.currentPositionValue();
        return val > basis ? val - basis : 0;
    }

    function getBenefactors() external view returns (address[] memory) {
        return benefactors;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Actions
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice A benefactor pledges permanent principal (escrowed, vesting).
    function deposit(uint256 seed, uint256 amount) external {
        if (vault.migrated()) return; // intake closed post-migrate
        address b = _benefactor(seed);
        amount = bound(amount, 1e12, 100 ether);

        vm.deal(address(this), address(this).balance + amount);
        Currency native = Currency.wrap(address(0));
        try vault.receiveContribution{ value: amount }(native, amount, b) {
            sumDeposited += amount;
            depositCount++;
        } catch { }
    }

    /// @notice Inject Aave yield (value-per-share appreciation) so harvest has something to split.
    function accrueYield(uint256 amount) external {
        if (vault.totalShares() == 0) return; // no shares → injected value is unassignable, skip
        amount = bound(amount, 1e9, 50 ether);
        // Back the WETH so downstream redemptions settle in ETH (mirrors the unit test's _simulateYield).
        vm.deal(address(weth), address(weth).balance + amount);
        weth.mint(address(this), amount);
        weth.approve(address(stata), amount);
        try stata.simulateYield(amount) {
            sumYieldInjected += amount;
        } catch { }
    }

    /// @notice Realize + split the compounded yield (two classes: 80/19/1 escrowed, 0/99/1 vested), and
    ///         pin the split wei-exactly.
    function harvest(uint256) external {
        uint256 escrowedB = vault.totalEscrowedPrincipal();
        uint256 vestedB = vault.totalVestedDeployable();
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

            // Recompute the exact two-class split against the pre-harvest basis and compare to the counters.
            uint256 totalInAave = escrowedB + vestedB;
            if (totalInAave > 0 && got > 0) {
                uint256 escrowedYield = (got * escrowedB) / totalInAave;
                uint256 vestedYield = got - escrowedYield;

                uint256 protoE = (escrowedYield * PROTOCOL_BPS) / BPS;
                uint256 targetE = (escrowedYield * TARGET_BPS_ESCROW) / BPS;
                uint256 creatorLeg = escrowedYield - protoE - targetE;

                uint256 protoV = (vestedYield * PROTOCOL_BPS) / BPS;
                uint256 targetV = vestedYield - protoV;

                uint256 expCred = creatorLeg;
                uint256 expTgt = targetE + targetV;
                uint256 expProt = protoE + protoV;

                if (dCred != expCred || dTgt != expTgt || dProt != expProt) {
                    ghost_harvestSplitViolation = true;
                }
            }
        } catch { }
    }

    /// @notice Mature a benefactor's escrow into the target's deployable (vested) corpus.
    function vest(uint256 seed) external {
        if (vault.migrated()) return; // vesting closed post-migrate
        address b = _benefactor(seed);
        if (vault.escrowedPrincipal(b) == 0) return;
        vm.warp(block.timestamp + vestDuration + 1); // advance past every live tranche's clock
        try vault.vest(b) {
            vestCount++;
        } catch { }
    }

    /// @notice Ambassador deploys vested corpus capital (value-only) — principal leaving via the vested path.
    function execute(uint256 amount) external {
        uint256 corpus = vault.deployableCorpus();
        if (corpus == 0) return;
        amount = bound(amount, 1, corpus);
        uint256 poolBefore = _yieldPoolValue();
        vm.prank(ambassador);
        try vault.execute(deploySink, amount, "") returns (bytes memory) {
            sumDeployedViaExecute += amount;
            executeCount++;
            // A dust-tolerated partial redeem (got < value, within REDEEM_DUST) strands the un-redeemed
            // principal in the position with its basis already debited → it surfaces as realized yield.
            // Book it on the same realized basis as `sumHarvestDistributed`.
            uint256 poolAfter = _yieldPoolValue();
            if (poolAfter > poolBefore) sumYieldInjected += poolAfter - poolBefore;
        } catch { }
    }

    /// @notice Solvency haircut: lower value-per-share (Aave bad-debt), the case migrate socializes pro-rata.
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

    /// @notice Aggregate owner-only escrow migration — the sole socialization surface. Under a solvency-only
    ///         position (liquidity cap cleared) it must redeem EXACTLY floor(value·escrowed/basis), never more
    ///         than the escrow principal, and never RedeemShortfall.
    function migrate(uint256) external {
        if (vault.migrated()) return;
        uint256 escrowed = vault.totalEscrowedPrincipal();
        if (escrowed == 0) return; // would revert NoPrincipal

        // Solvency-only conditions: clear any liquidity cap so a RedeemShortfall here would be a real defect,
        // and expel unrealized yield so the redemption is a PRINCIPAL-share redemption (Σredeemed ≤ Σdeposited).
        stata.setMaxWithdrawCap(0);
        try vault.harvest() { } catch { }

        uint256 basis = escrowed + vault.totalVestedDeployable();
        uint256 value = vault.currentPositionValue();
        uint256 expectedEscrowValue = (value * escrowed) / basis; // floor — the pro-rata escrow claim

        uint256 balBefore = recovery.balance;
        uint256 poolBefore = _yieldPoolValue();
        vm.prank(vaultOwner);
        try vault.migratePosition(recovery) {
            uint256 got = recovery.balance - balBefore;
            if (got != expectedEscrowValue) ghost_proRataViolation = true;
            if (got > escrowed || got > expectedEscrowValue) ghost_overRedeemToRecipient = true;
            sumRedeemedViaMigrate += got;
            migrateCount++;
            // Zeroing the escrow basis while redeeming only its floor pro-rata can leave a sub-wei residual
            // as position-value-above-basis (realized yield); book it on the realized basis (see execute).
            uint256 poolAfter = _yieldPoolValue();
            if (poolAfter > poolBefore) sumYieldInjected += poolAfter - poolBefore;
        } catch {
            // Under a solvency-only position the socialized claim is always redeemable — a shortfall here is
            // a solvency/liquidity confusion (the very bug this suite guards against).
            ghost_solvencyMigrateReverted = true;
        }
    }
}
