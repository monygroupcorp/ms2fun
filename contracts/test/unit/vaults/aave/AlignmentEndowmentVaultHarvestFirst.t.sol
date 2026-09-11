// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "../../../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @title Harvest-first ordering regressions
/// @notice Proves the fix for re-audit (2026-08-02) findings #1/#2: `execute` and `_deposit`
///         `_crystallizeYield()` BEFORE mutating the principal weights, so pending Aave yield is always
///         apportioned at the PRE-mutation weights and the `execute` last-principal strand is gone.
///         Reuses the proven mock stack from the sibling endowment unit suite.
contract AlignmentEndowmentVaultHarvestFirstTest is Test {
    AlignmentEndowmentVault public vault;
    MockWETH public weth;
    MockStataToken public stata;
    MockMasterRegistry public masterRegistry;
    MockAmbassadorRegistry public ambassadorRegistry;
    MockOwnable public benefactorContract; // benefactor A (owned by alice)

    address public vaultOwner = address(0xAA01);
    address public treasury = address(0xAA02);
    address public alignmentToken = address(0xAA03);
    address public communityPayout = address(0xAA04);
    uint256 public constant TARGET_ID = 7;

    address public alice = address(0xBB01);
    address public ambassador = address(0xBB04);

    Currency public nativeCurrency = Currency.wrap(address(0));

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);

        benefactorContract = new MockOwnable(alice);
        // The sink is registry state — the vault reads it live and keeps no copy.
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );

        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);
        vm.warp(1_000_000);
    }

    // ── Helpers (mirror the sibling suite) ──────────────────────────────────────

    function _contribute(MockOwnable b, address owner_, uint256 amount) internal {
        vm.deal(owner_, owner_.balance + amount);
        vm.prank(owner_);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, address(b));
    }

    function _newBenefactor(address owner_) internal returns (MockOwnable b) {
        b = new MockOwnable(owner_);
    }

    /// @dev Inject yield: back the WETH with ETH, mint the WETH to this test, approve, raise value-per-share.
    function _simulateYield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    // ════════════════════════════════════════════════════════════════════════
    // execute — finding #1a: the split is apportioned at PRE-execute weights
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Two benefactors of equal weight, pending Y = 1 ETH. An ambassador deploys the whole corpus
    ///      before any harvest. The pending yield must be split at the PRE-execute weights — 0.8 creator
    ///      (0.4 each) / 0.19 target / 0.01 protocol — not against the emptied position the deploy leaves.
    function test_execute_apportionsPendingYieldAtPreExecuteWeights() public {
        _contribute(benefactorContract, alice, 1 ether); // A
        MockOwnable b = _newBenefactor(address(0xCAFE));
        _contribute(b, address(0xCAFE), 1 ether); // B
        assertEq(vault.deployableCorpus(), 2 ether);

        _simulateYield(1 ether); // pending Y = 1 ETH at weights A 1 : B 1

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 2 ether, ""); // crystallizes first, then deploys

        assertEq(sink.balance, 2 ether, "full corpus deployed");
        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg at pre-execute weights");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1% of Y");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.4 ether, "A keeps its half of the creator leg");
        assertEq(vault.pendingYieldOf(address(b)), 0.4 ether, "and B keeps its half");
    }

    // ════════════════════════════════════════════════════════════════════════
    // execute — finding #1b: draining the LAST principal no longer strands yield
    // ════════════════════════════════════════════════════════════════════════

    /// @dev A single benefactor; pending Y present; the ambassador deploys the LAST principal
    ///      (`totalPrincipal → 0`). The yield must be distributed 80/19/1, not trapped behind
    ///      `_crystallizeYield`'s `totalPrincipal == 0` guard. Pre-fix the drain preceded the crystallize,
    ///      so after it the basis was zero and the pending Y was stranded in the position forever.
    function test_execute_drainingLastPrincipalDoesNotStrandYield() public {
        _contribute(benefactorContract, alice, 1 ether);
        assertEq(vault.deployableCorpus(), 1 ether);

        _simulateYield(1 ether); // pending Y = 1 ETH

        uint256 communityBefore = communityPayout.balance;

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, ""); // drains the last principal — but crystallizes first

        assertEq(sink.balance, 1 ether, "last principal deployed");
        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg realized, not stranded");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "creator leg realized too");
        assertEq(vault.totalYieldToTarget(), 0.19 ether, "yield distributed to target");

        vault.harvest(); // nothing left pending
        assertEq(vault.accumulatedFees(), 0, "no residual pending yield stranded in the position");
    }

    // ════════════════════════════════════════════════════════════════════════
    // _deposit — lead: a new depositor cannot capture pre-join yield
    // ════════════════════════════════════════════════════════════════════════

    /// @dev A deposits; yield Y accrues during A's exclusive window; B then deposits; `harvest()`. A's
    ///      creator leg must reflect the full creator leg of Y (0.8 ETH) earned before B joined; B captures
    ///      none of it. Pre-fix, B's deposit grew the weight before crystallizing, so the harvest split Y's
    ///      creator leg across A and B by weight — B siphoned half of A's pre-join yield.
    function test_deposit_crystallizesBeforeNewWeightJoins() public {
        _contribute(benefactorContract, alice, 1 ether); // A deposits

        _simulateYield(1 ether); // Y = 1 ETH earned during A's exclusive window

        MockOwnable b = _newBenefactor(address(0xCAFE));
        _contribute(b, address(0xCAFE), 1 ether); // B joins — crystallizes A's yield first

        vault.harvest(); // no-op now

        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "A keeps the full pre-join creator leg");
        assertEq(vault.pendingYieldOf(address(b)), 0, "B captured none of the pre-join yield");
        assertEq(vault.totalYieldToCreators(), 0.8 ether);
    }

    // ════════════════════════════════════════════════════════════════════════
    // unset community sink (noesis-339) — crystallize accrues, it never reverts
    // ════════════════════════════════════════════════════════════════════════

    /// @dev A clone whose `communityPayout` is unset at initialize. Crystallize is the first statement of
    ///      `_deposit`, `harvest` and `execute`, so a target leg with no sink must not revert: the leg
    ///      accrues into `accumulatedTargetFees` and all three paths stay open. Asserts the whole sequence —
    ///      a second deposit after yield, then harvest — succeeds with no sink, and that the accrued balance
    ///      flushes once one is set.
    function test_unsetPayout_depositAndHarvestRemainOpen() public {
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(0));
        AlignmentEndowmentVault v0 = _deployVault();

        MockOwnable a = _newBenefactor(alice);
        vm.prank(alice);
        v0.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(a));

        _simulateYield(1 ether); // yield accrues → the target leg now has nowhere to go

        // 1. A further deposit still lands (crystallizes first, accruing the target leg).
        MockOwnable b = _newBenefactor(address(0xCAFE));
        vm.deal(address(0xCAFE), 1 ether);
        vm.prank(address(0xCAFE));
        v0.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(b));
        assertEq(v0.getBenefactorShares(address(b)), 1 ether, "second benefactor accepted");
        assertEq(v0.accumulatedTargetFees(), 0.19 ether, "target leg accrued (19% of Y)");
        assertEq(v0.pendingYieldOf(address(a)), 0.8 ether, "A keeps the full pre-join creator leg");

        // 2. Harvest still runs.
        v0.harvest();

        // 3. The accrued leg is delivered once a sink exists, and only then.
        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v0.flushTargetFees();

        uint256 accrued = v0.accumulatedTargetFees();
        assertEq(accrued, 0.19 ether, "nothing lost across deposit/harvest");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

        uint256 before = communityPayout.balance;
        assertEq(v0.flushTargetFees(), accrued, "accrued leg delivered");
        assertEq(communityPayout.balance - before, accrued, "sink received it");
        assertEq(v0.accumulatedTargetFees(), 0, "accumulator zeroed");
    }

    /// @dev Clone the implementation (mirrors `setUp`). The clone carries no sink of its own — whatever
    ///      the registry answers for `TARGET_ID` at send time is the sink.
    function _deployVault() internal returns (AlignmentEndowmentVault v) {
        address impl = address(new AlignmentEndowmentVault());
        v = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );
    }
}
