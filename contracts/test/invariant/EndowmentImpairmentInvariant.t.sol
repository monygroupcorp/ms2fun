// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { EndowmentVaultHandler } from "./handlers/EndowmentVaultHandler.sol";
// Inline mocks live in the endowment unit test; reuse them so impairment is induced identically (no fork).
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry
} from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @title  EndowmentImpairmentInvariant
/// @notice Fuzz-invariant harness backing the endowment's impairment-socialization correctness. Principal
///         is a PERMANENT donation with NO per-benefactor refund/exit path, so "first-mover advantage /
///         claim ordering / refunded ≤ deposited" is structurally impossible and is asserted by
///         CONSTRUCTION (this suite exposes no per-benefactor exit; a `withdrawPrincipal` selector does not
///         exist). The socialization surface is the aggregate owner-only `migratePosition`, the ambassador
///         `execute` on the corpus, and the flat `harvest` — all acting on ONE pooled principal bucket.
///
/// @dev    Under fuzzed interleavings of deposit / accrueYield / harvest / execute / induceImpairment
///         (solvency haircut) / setLiquidityCap / migrate, the suite proves:
///           - migrate redeems EXACTLY the written-down realizable basis, never more than the position holds;
///           - Σ(migrate + execute) principal ever leaving the vault ≤ Σ deposited (no over-redeem, dust
///             strands in the position, never over-redeemed to the recipient);
///           - a RedeemShortfall is a liquidity gap, never a solvency haircut (the socialized value conserves);
///           - the 80/19/1 harvest accumulator never credits more than Σ harvested;
///           - a deposit hands back principal the position stranded, and never mints yield beyond it;
///           - Σ per-benefactor live principal never exceeds the basis the position actually holds.
contract EndowmentImpairmentInvariantTest is StdInvariant, Test {
    AlignmentEndowmentVault public vault;
    MockWETH public weth;
    MockStataToken public stata;
    MockMasterRegistry public masterRegistry;
    MockAmbassadorRegistry public ambassadorRegistry;
    EndowmentVaultHandler public handler;

    address public vaultOwner = address(0xA0FF);
    address public treasury = address(0xA0FE);
    address public alignmentToken = address(0xA0FD);
    address public communityPayout = address(0xA0FC);
    address public ambassador = address(0xA0FB);

    uint256 public constant TARGET_ID = 42;
    uint256 public constant NUM_BENEFACTORS = 4;

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);
        // The sink is registry state — the vault reads it live and keeps no copy.
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );

        // Deterministic base timestamp.
        vm.warp(1_000_000);

        handler = new EndowmentVaultHandler(
            vault, weth, stata, ambassadorRegistry, vaultOwner, ambassador, TARGET_ID, NUM_BENEFACTORS
        );

        // Fuzz only the handler's action surface (skip its view getters).
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.accrueYield.selector;
        selectors[2] = handler.harvest.selector;
        selectors[3] = handler.execute.selector;
        selectors[4] = handler.induceImpairment.selector;
        selectors[5] = handler.setLiquidityCap.selector;
        selectors[6] = handler.migrate.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    // ── Principal never over-redeems ──────────────────────────────────────────
    // The only two paths principal can leave the vault are the aggregate migrate and the ambassador execute.
    // Their cumulative sum can never exceed everything ever deposited — no path mints principal, and
    // impairment only ever redeems LESS than the nominal basis.
    function invariant_neverOverRedeem() public view {
        assertLe(
            handler.sumRedeemedViaMigrate() + handler.sumDeployedViaExecute(),
            handler.sumDeposited(),
            "endowment: principal over-redeemed (Sum migrate+execute > Sum deposited)"
        );
    }

    // ── Migrate redeems the whole realizable basis ────────────────────────────
    // Every aggregate migrate redeemed EXACTLY min(position value, basis) — the loss is socialized by the
    // write-down across the one bucket, never taken first-come-first-served out of somebody's share.
    function invariant_migrateTakesTheWholeRealizableBasis() public view {
        assertFalse(handler.ghost_migrateNotWholePosition(), "endowment: migrate redemption != the realizable basis");
    }

    // ── Dust strands in the position; the recipient is never over-paid ────────
    // Migrate never redeems more than the basis or the position value, so rounding dust strands in the
    // position rather than being over-redeemed to `to`.
    function invariant_dustStrandsInPosition() public view {
        assertFalse(
            handler.ghost_overRedeemToRecipient(), "endowment: migrate over-redeemed to recipient (dust not stranded)"
        );
    }

    // ── RedeemShortfall is a liquidity event, not a solvency haircut ──────────
    // With the liquidity cap cleared, the written-down basis is always redeemable: a solvency haircut is
    // reflected in the write-down, never surfaced as a RedeemShortfall revert.
    function invariant_redeemShortfallIsLiquidityNotSolvency() public view {
        assertFalse(
            handler.ghost_solvencyMigrateReverted(),
            "endowment: migrate RedeemShortfall under a solvency-only haircut (should be liquidity-only)"
        );
    }

    // ── The flat harvest accumulator conserves ────────────────────────────────
    // Each harvest split the realized yield exactly 80/19/1, and the running accumulator never distributed
    // more yield than was ever injected.
    //
    // "Injected" is on a REALIZED basis, not the raw `simulateYield` total: principal a withdrawal debited
    // from the basis but left behind in the position is genuine distributable yield with no injection behind
    // it, and the handler books it at the call that surfaces it. `EndowmentVaultHandler`'s `_yieldPoolValue`
    // and `_strandedInPosition` name the two shapes that produce one, and
    // `EndowmentStrandedPrincipalRegression` pins the second deterministically.
    function invariant_harvestFlatSplitConserves() public view {
        assertFalse(handler.ghost_harvestSplitViolation(), "endowment: harvest split mismatch");
        assertLe(
            handler.sumHarvestDistributed(),
            handler.sumYieldInjected(),
            "endowment: harvest distributed more yield than was injected"
        );
    }

    // ── A deposit hands back a strand; it never mints one ─────────────────────
    // Booking a strand into the injected ghost would be a hole if a deposit could raise the yield pool by an
    // arbitrary amount, so the MAGNITUDE is bounded separately from the direction above: what appears across
    // a deposit may not exceed the assets the ERC-4626 was already holding unpriced. A pool that outruns that
    // strand is a deposit minting yield out of the share arithmetic — the defect, rather than the rounding.
    function invariant_depositRecoversAStrandButNeverMintsOne() public view {
        assertFalse(
            handler.ghost_depositMintedYield(),
            "endowment: a deposit raised the yield pool beyond the strand it inherited"
        );
    }

    // ── A creator leg is never held once the accumulator could carry it ───────
    // The creator leg reaches a benefactor only through the per-share accumulator, so a leg the accumulator
    // cannot express is held rather than booked as paid. That hold is legitimate only while it is too small
    // to move the accumulator at all: once the held pot is worth a whole unit, the next harvest must spend
    // it. A pot standing at or above a unit after a harvest is the stranded-leg defect returning.
    function invariant_heldCreatorYieldIsAlwaysTooSmallToCredit() public view {
        assertFalse(
            handler.ghost_creatorYieldHeldWhenItCouldBeCredited(),
            "endowment: creator yield held while the accumulator could have carried it"
        );
    }

    // ── Live per-benefactor principal never exceeds the basis ─────────────────
    // Each benefactor's principal is a share of one pool. Σ of those shares must never promise out more
    // principal than the position's basis actually holds — that would be the share arithmetic minting money.
    function invariant_perBenefactorPrincipalNeverExceedsBasis() public view {
        assertFalse(handler.ghost_principalExceedsBasis(), "endowment: Sum per-benefactor principal exceeded the basis");
    }

    // ── No per-benefactor exit exists (structural: no first-mover advantage) ──
    // The reworked vault has no refund path. A `withdrawPrincipal(address)` call hits no function and no
    // fallback (only `receive()` for empty calldata) → it reverts. Principal is permanent; there is no
    // per-benefactor claim ordering to advantage, so "no first-mover advantage" holds by construction.
    function invariant_noPerBenefactorExitSelector() public view {
        (bool ok,) = address(vault).staticcall(abi.encodeWithSignature("withdrawPrincipal(address)", address(0xBEEF)));
        assertFalse(ok, "endowment: a per-benefactor withdraw path was reintroduced");
    }
}
