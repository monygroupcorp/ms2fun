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
/// @notice Fuzz-invariant harness backing the endowment's impairment-socialization correctness
///         (spec-completeness-critic §4.4, punch-list P2 #14). REFRAMED to the post-095 reworked vault's
///         ACTUAL surface: principal is a PERMANENT donation with NO per-benefactor refund/exit path, so
///         "first-mover advantage / claim ordering / refunded ≤ deposited" is structurally impossible and is
///         asserted by CONSTRUCTION (this suite exposes no per-benefactor exit; a `withdrawPrincipal` selector
///         does not exist). The only socialization surface is the aggregate owner-only `migratePosition`
///         (escrow pro-rata) plus the ambassador `execute` on the vested corpus and the two-class `harvest`.
///
/// @dev    Under fuzzed interleavings of deposit / accrueYield / harvest / vest / execute / induceImpairment
///         (solvency haircut) / setLiquidityCap / migrate, the suite proves:
///           - migrate redeems EXACTLY floor(impairedValue·escrowed/basis), never above the escrow principal;
///           - Σ(migrate + execute) principal ever leaving the vault ≤ Σ deposited (no over-redeem, dust
///             strands in the position, never over-redeemed to the recipient);
///           - a RedeemShortfall is a liquidity gap, never a solvency haircut (the socialized value conserves);
///           - the 80/19/1 escrowed + 0/99/1 vested harvest accumulator never credits more than Σ harvested.
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

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            treasury,
            address(masterRegistry),
            alignmentToken,
            TARGET_ID,
            communityPayout
        );

        // Deterministic base timestamp so vesting math is stable across runs.
        vm.warp(1_000_000);

        handler = new EndowmentVaultHandler(
            vault, weth, stata, ambassadorRegistry, vaultOwner, ambassador, TARGET_ID, NUM_BENEFACTORS
        );

        // Fuzz only the handler's action surface (skip its view getters).
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.accrueYield.selector;
        selectors[2] = handler.harvest.selector;
        selectors[3] = handler.vest.selector;
        selectors[4] = handler.execute.selector;
        selectors[5] = handler.induceImpairment.selector;
        selectors[6] = handler.setLiquidityCap.selector;
        selectors[7] = handler.migrate.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    // ── Principal never over-redeems ──────────────────────────────────────────
    // The only two paths principal can leave the vault are the aggregate escrow migrate and the vested-corpus
    // execute. Their cumulative sum can never exceed everything ever deposited — no path mints principal, and
    // impairment only ever redeems LESS (pro-rata) than the escrow basis.
    function invariant_neverOverRedeem() public view {
        assertLe(
            handler.sumRedeemedViaMigrate() + handler.sumDeployedViaExecute(),
            handler.sumDeposited(),
            "endowment: principal over-redeemed (Sum migrate+execute > Sum deposited)"
        );
    }

    // ── Migrate is exactly pro-rata to the escrow basis ───────────────────────
    // Every aggregate migrate redeemed EXACTLY floor(impairedValue·escrowed/basis) — socialized pro-rata,
    // never first-come-first-served.
    function invariant_migrateProRataToBasis() public view {
        assertFalse(handler.ghost_proRataViolation(), "endowment: migrate redemption not pro-rata to escrow basis");
    }

    // ── Dust strands in the position; the recipient is never over-paid ────────
    // Migrate never redeems more than the escrow principal / its pro-rata claim, so rounding dust and the
    // vested tranche's value strand in the position rather than being over-redeemed to `to`.
    function invariant_dustStrandsInPosition() public view {
        assertFalse(
            handler.ghost_overRedeemToRecipient(), "endowment: migrate over-redeemed to recipient (dust not stranded)"
        );
    }

    // ── RedeemShortfall is a liquidity event, not a solvency haircut ──────────
    // With the liquidity cap cleared, the socialized escrow claim is always redeemable: a solvency haircut is
    // reflected in the (pro-rated) claim, never surfaced as a RedeemShortfall revert.
    function invariant_redeemShortfallIsLiquidityNotSolvency() public view {
        assertFalse(
            handler.ghost_solvencyMigrateReverted(),
            "endowment: migrate RedeemShortfall under a solvency-only haircut (should be liquidity-only)"
        );
    }

    // ── Two-class harvest accumulator conserves ───────────────────────────────
    // Each harvest split the realized yield exactly (80/19/1 on escrowed, 0/99/1 on vested), and the running
    // accumulator never distributed more yield than was ever injected.
    function invariant_harvestTwoClassConserves() public view {
        assertFalse(handler.ghost_harvestSplitViolation(), "endowment: two-class harvest split mismatch");
        assertLe(
            handler.sumHarvestDistributed(),
            handler.sumYieldInjected(),
            "endowment: harvest distributed more yield than was injected"
        );
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
