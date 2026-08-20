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

/// @title Harvest-first ordering regressions (noesis-125)
/// @notice Proves the fix for re-audit (2026-08-02) findings #1/#2: `execute`, `vest`, and `_deposit` now
///         `_crystallizeYield()` BEFORE mutating the escrowed/vested principal weights, so pending Aave yield
///         is always apportioned at the PRE-mutation weights and the `execute` last-principal strand is gone.
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
    uint256 constant VEST = 26 weeks;

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);

        benefactorContract = new MockOwnable(alice);

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
    // vest — finding #2: yield earned while escrowed keeps its 80% creator leg
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Single escrowed benefactor B; yield Y accrues unharvested; `vest(B)` then `harvest()`. The escrow
    ///      yield's creator leg (≈80% of Y) must land in B's purse — NOT 0. Pre-fix, vest reclassified B to
    ///      vested before crystallizing, so the next harvest apportioned Y at the 0/99/1 vested split and B
    ///      received nothing (stripped to communityPayout).
    function test_vest_crystallizesEscrowYieldBeforeReclassifying() public {
        _contribute(benefactorContract, alice, 1 ether);
        vm.warp(block.timestamp + VEST);

        _simulateYield(1 ether); // Y = 1 ETH accrued while B still escrowed

        vault.vest(address(benefactorContract));
        vault.harvest(); // no-op now — vest already crystallized

        assertEq(
            vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "B keeps the escrow creator leg (80% of Y)"
        );
        assertEq(vault.totalYieldToCreators(), 0.8 ether, "creator leg booked, not routed to community");
        assertEq(vault.vestedOf(address(benefactorContract)), 1 ether, "principal still vested");
    }

    // ════════════════════════════════════════════════════════════════════════
    // execute — finding #1a: split apportioned at PRE-execute weights
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Mixed position (A vested 1 ETH, B escrowed 1 ETH), pending Y = 1 ETH. An ambassador deploys the
    ///      full vested corpus before any harvest. The pending yield must be split at the PRE-execute 1:1
    ///      class weights: escrowed leg 0.5 → 0.4 creator (B) / 0.095 target / 0.005 proto; vested leg 0.5 →
    ///      0.495 target / 0.005 proto → community keeps its vested 99% (target total 0.59). Pre-fix, execute
    ///      drained the vested class first, so a later harvest saw only the escrowed weight and reweighted the
    ///      vested class's 0.495 target leg into the escrowed 80/19/1 split.
    function test_execute_apportionsPendingYieldAtPreExecuteWeights() public {
        _contribute(benefactorContract, alice, 1 ether); // A → will vest
        MockOwnable b = _newBenefactor(address(0xCAFE));
        _contribute(b, address(0xCAFE), 1 ether); // B → stays escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A vested; B escrowed
        assertEq(vault.deployableCorpus(), 1 ether);

        _simulateYield(1 ether); // pending Y = 1 ETH at weights escrowed 1 : vested 1

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, ""); // crystallizes first, then deploys

        assertEq(sink.balance, 1 ether, "full vested corpus deployed");
        assertEq(
            communityPayout.balance - communityBefore, 0.59 ether, "target leg at pre-execute weights (0.095 + 0.495)"
        );
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1% of Y");
        assertEq(vault.pendingYieldOf(address(b)), 0.4 ether, "B (escrowed) keeps its 0.4 creator leg, not reweighted");
    }

    // ════════════════════════════════════════════════════════════════════════
    // execute — finding #1b: draining the LAST principal no longer strands yield
    // ════════════════════════════════════════════════════════════════════════

    /// @dev A single vested benefactor (no escrowed); pending Y present; the ambassador deploys the LAST
    ///      principal (`totalInAave → 0`). The yield must be distributed (vested 99/1), not trapped behind
    ///      `_crystallizeYield`'s `totalInAave == 0` guard. Pre-fix the drain preceded the crystallize, so
    ///      after it `totalInAave == 0` and the pending Y was stranded in the position forever.
    function test_execute_drainingLastPrincipalDoesNotStrandYield() public {
        _contribute(benefactorContract, alice, 1 ether);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // 1 ETH vested, 0 escrowed
        assertEq(vault.deployableCorpus(), 1 ether);

        _simulateYield(1 ether); // pending Y = 1 ETH

        uint256 communityBefore = communityPayout.balance;

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, ""); // drains the last principal — but crystallizes first

        assertEq(sink.balance, 1 ether, "last principal deployed");
        assertEq(communityPayout.balance - communityBefore, 0.99 ether, "vested target leg realized, not stranded");
        assertEq(vault.totalYieldToTarget(), 0.99 ether, "yield distributed to target");

        vault.harvest(); // nothing left pending
        assertEq(vault.accumulatedFees(), 0, "no residual pending yield stranded in the position");
    }

    // ════════════════════════════════════════════════════════════════════════
    // _deposit — lead: a new depositor cannot capture pre-join yield
    // ════════════════════════════════════════════════════════════════════════

    /// @dev A escrows; yield Y accrues during A's exclusive window; B then deposits; `harvest()`. A's creator
    ///      leg must reflect the full escrow creator leg of Y (0.8 ETH) earned before B joined; B captures
    ///      none of it. Pre-fix, B's deposit grew the escrow weight before crystallizing, so the harvest split
    ///      Y's creator leg across A and B by weight — B siphoned half of A's pre-join yield.
    function test_deposit_crystallizesBeforeNewWeightJoins() public {
        _contribute(benefactorContract, alice, 1 ether); // A escrows

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
    ///      `_deposit`, `vest`, `harvest` and `execute`, so a target leg with no sink must not revert:
    ///      the leg accrues into `accumulatedTargetFees` and all four paths stay open. Asserts the whole
    ///      sequence — a second deposit after yield, vest at maturity, harvest — succeeds with no sink, and
    ///      that the accrued balance flushes once one is set.
    function test_unsetPayout_depositVestHarvestAllRemainOpen() public {
        AlignmentEndowmentVault v0 = _deployVaultWithPayout(address(0));

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
        assertEq(v0.accumulatedTargetFees(), 0.19 ether, "escrowed target leg accrued (19% of Y)");
        assertEq(v0.pendingYieldOf(address(a)), 0.8 ether, "A keeps the full pre-join creator leg");

        // 2. Vest at maturity still runs.
        vm.warp(block.timestamp + VEST);
        v0.vest(address(a));
        assertEq(v0.vestedOf(address(a)), 1 ether, "principal vested");

        // 3. Harvest still runs.
        v0.harvest();

        // 4. The accrued leg is delivered once a sink exists, and only then.
        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v0.flushTargetFees();

        uint256 accrued = v0.accumulatedTargetFees();
        assertEq(accrued, 0.19 ether, "nothing lost across deposit/vest/harvest");
        vm.prank(vaultOwner);
        v0.setCommunityPayout(communityPayout);

        uint256 before = communityPayout.balance;
        assertEq(v0.flushTargetFees(), accrued, "accrued leg delivered");
        assertEq(communityPayout.balance - before, accrued, "sink received it");
        assertEq(v0.accumulatedTargetFees(), 0, "accumulator zeroed");
    }

    /// @dev Clone the implementation with an explicit community payout (mirrors `setUp`).
    function _deployVaultWithPayout(address payout) internal returns (AlignmentEndowmentVault v) {
        address impl = address(new AlignmentEndowmentVault());
        v = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            treasury,
            address(masterRegistry),
            alignmentToken,
            TARGET_ID,
            payout
        );
    }
}
