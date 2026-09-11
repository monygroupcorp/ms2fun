// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "./AlignmentEndowmentVault.t.sol";

/// @dev Re-audit of the one-bucket money model: the pooled-withdrawal law ("a slice stops earning only
///      when it is physically withdrawn"), the funding-round settlement path, and the round-closing bound.
///      Every test states the law it pins in its own name; a test that fails here names a place the
///      contract departs from the law, not a place the test is wrong.
contract AlignmentEndowmentVaultPooledLawTest is Test {
    AlignmentEndowmentVault internal vault;
    MockWETH internal weth;
    MockStataToken internal stata;
    MockMasterRegistry internal masterRegistry;
    MockAmbassadorRegistry internal ambassadorRegistry;

    address internal vaultOwner = address(0xAA01);
    address internal treasury = address(0xAA02);
    address internal alignmentToken = address(0xAA03);
    address internal communityPayout = address(0xAA04);
    address internal ambassador = address(0xBB04);
    uint256 internal constant TARGET_ID = 7;

    Currency internal constant NATIVE = Currency.wrap(address(0));

    /// @dev Mirrors the contract's `MIN_SHARE_PRICE_INVERSE` (internal there).
    uint256 internal constant PRICE_INVERSE = 1e9;

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
        vm.deal(address(this), 1000 ether);
        vm.warp(1_000_000);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _benefactor(address owner_) internal returns (MockOwnable b) {
        b = new MockOwnable(owner_);
    }

    function _deposit(MockOwnable b, uint256 amount) internal {
        vault.receiveContribution{ value: amount }(NATIVE, amount, address(b));
    }

    function _yield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    function _execute(uint256 amount) internal {
        vm.prank(ambassador);
        vault.execute(makeAddr("deploy_sink"), amount, "");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Funding-round settlement: no earned yield is lost across a round close
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev The hard direction of the boundary: the benefactor whose shares are being retired is the one
    ///      whose deposit OPENS the new round, with creator yield still unsettled on the old shares. The
    ///      retirement and the re-mint happen in the same call, and the settlement against the frozen
    ///      accumulator must land in between.
    function test_roundClose_reopenerWithUnsettledYieldIsSettledBeforeRetirement() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 2 ether);
        _yield(1 ether);
        vault.harvest(); // 0.8 ETH accrued to A, NOT settled (no touch since)
        assertEq(vault.yieldPurse(address(a)), 0, "nothing settled into the purse yet");
        assertEq(vault.pendingYieldOf(address(a)), 0.8 ether);

        _execute(2 ether); // spent to the wei
        assertEq(vault.totalPrincipal(), 0);

        // A re-funds: this single call closes round 0, retires A's old shares and mints A's new ones.
        _deposit(a, 3 ether);
        assertEq(vault.fundingRound(), 1);
        assertEq(vault.fundingRoundOf(address(a)), 1);
        assertEq(vault.principalShares(address(a)), 3 ether, "new shares are 1:1 on the fresh round");
        assertEq(vault.yieldPurse(address(a)), 0.8 ether, "old-round yield settled into the purse first");
        assertEq(vault.principalOf(address(a)), 3 ether);

        // The new shares earn only what is harvested from here.
        _yield(1 ether);
        vault.harvest();
        // (±2 wei: the accumulator floors `creatorLeg · 1e18 / shares`, the same dust a fresh vault leaves.)
        assertApproxEqAbs(vault.pendingYieldOf(address(a)), 1.6 ether, 2, "0.8 old + 0.8 new, nothing double-counted");
        vm.prank(address(0xA11CE));
        assertApproxEqAbs(vault.claimYieldPurse(address(a)), 1.6 ether, 2);
    }

    /// @dev A benefactor who sleeps through TWO round closes settles against the accumulator frozen at
    ///      the end of THEIR round, not the later one. Yield harvested in rounds they had no principal in
    ///      does not reach them, and yield they earned is not lost.
    function test_roundClose_staleAcrossTwoRoundsSettlesAgainstOwnFrozenAccumulator() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        MockOwnable b = _benefactor(address(0xB0B));
        MockOwnable c = _benefactor(address(0xC0C));

        _deposit(a, 1 ether);
        _yield(1 ether);
        vault.harvest(); // A: 0.8 unsettled
        _execute(1 ether); // round 0 spent

        _deposit(b, 1 ether); // opens round 1
        _yield(1 ether);
        vault.harvest(); // B: 0.8
        _execute(1 ether); // round 1 spent

        _deposit(c, 1 ether); // opens round 2
        _yield(1 ether);
        vault.harvest(); // C: 0.8

        assertEq(vault.fundingRound(), 2);
        assertEq(vault.pendingYieldOf(address(a)), 0.8 ether, "A: exactly round 0's creator leg");
        assertEq(vault.pendingYieldOf(address(b)), 0.8 ether, "B: exactly round 1's creator leg");
        assertEq(vault.pendingYieldOf(address(c)), 0.8 ether, "C: exactly round 2's creator leg");
        assertEq(vault.principalOf(address(a)), 0);
        assertEq(vault.principalOf(address(b)), 0);
        assertEq(vault.principalOf(address(c)), 1 ether);

        vm.prank(address(0xA11CE));
        assertEq(vault.claimYieldPurse(address(a)), 0.8 ether);
        vm.prank(address(0xB0B));
        assertEq(vault.claimYieldPurse(address(b)), 0.8 ether);
        assertEq(vault.principalShares(address(a)), 0, "A's stale shares retired on touch");
        assertEq(vault.fundingRoundOf(address(a)), 2);
    }

    /// @dev Yield that is still IN THE POSITION (not yet harvested) when the closing withdrawal lands is
    ///      crystallized at the pre-withdrawal weights and survives the close.
    function test_roundClose_unharvestedYieldAtTheClosingWithdrawalIsNotLost() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(a, 1 ether);
        _deposit(b, 3 ether);
        _yield(1 ether); // never harvested by anyone

        _execute(4 ether); // execute crystallizes first, then drains the pool to zero
        assertEq(vault.totalPrincipal(), 0);
        assertEq(vault.pendingYieldOf(address(a)), 0.2 ether, "A's quarter of the creator leg");
        assertEq(vault.pendingYieldOf(address(b)), 0.6 ether, "B's three quarters");

        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 1 ether); // opens round 1
        assertEq(vault.pendingYieldOf(address(a)), 0.2 ether, "unchanged by the round boundary");
        assertEq(vault.pendingYieldOf(address(b)), 0.6 ether);
        vm.prank(address(0xB0B));
        assertEq(vault.claimYieldPurse(address(b)), 0.6 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // The round-closing bound: arithmetic at the boundary
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Exactly AT the price floor (basis · 1e9 == shares) the round stays open; one wei below closes
    ///      it. Shares after a floor-priced deposit are bounded by amount · 1e9.
    function test_priceFloor_boundaryIsExactAndSharesAreBounded() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether); // shares 1e18, basis 1e18

        // Withdraw down to basis = shares / 1e9 = 1e9 wei: price is exactly 1e-9.
        _execute(1 ether - 1e9);
        assertEq(vault.totalPrincipal(), 1e9, "at the floor the round is still open");
        assertEq(vault.totalPrincipalShares(), 1e18);

        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        // newShares = 1e18 · 1e18 / 1e9 = 1e27 = amount · 1e9: the bound is tight.
        assertEq(vault.principalShares(address(b)), 1 ether * PRICE_INVERSE);
        assertEq(vault.totalPrincipalShares(), 1e27 + 1e18);
        assertEq(vault.totalPrincipal(), 1 ether + 1e9);

        // basis · 1e9 == shares exactly: still open.
        assertEq(vault.totalPrincipal() * PRICE_INVERSE, vault.totalPrincipalShares());

        // One wei out crosses the floor.
        _execute(1);
        assertEq(vault.totalPrincipal(), 0, "one wei below the floor closes the round");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // The round-closing bound: what a close is worth to the party who forces it
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev THE LAW: a slice stops being corpus only when it is physically withdrawn, and a round close is
    ///      a withdrawal — of the residue, as CORPUS, to the target's non-discretionary sink. Today the close
    ///      zeroes the BASIS and leaves the ETH in Aave: when the pool is priced at the floor the close is one
    ///      wei away, and everything still in the position (up to the whole of the last deposit) becomes
    ///      position-value-above-basis, i.e. "yield", which the next harvest hands 80% of to whichever
    ///      benefactor deposits next. The contract's own comment bounds the residue at a billionth of the
    ///      pool; that holds at price 1 and not at price 1e-9, which the design explicitly allows.
    ///
    ///      Sequence: A funds 1 ETH; the ambassador deploys all but 1 gwei (price → 1e-9, round open);
    ///      B funds 1 ETH; the ambassador deploys ONE WEI. The round closing there is correct (pinned green
    ///      by `test_priceFloor_boundaryIsExactAndSharesAreBounded`, the control); what must also hold is
    ///      that the residue LEFT THE POSITION with the close and is not reachable as anyone's yield.
    ///
    ///      PINS (every symbol exists at 9ae810c; RED there, for the stated reason):
    ///        - `currentPositionValue()` ≈ 0 after the closing withdrawal — the residue was redeemed out.
    ///          Today: ≈ 1 ETH, still in Aave with a zero basis.
    ///        - the vault's native balance holds the residue — it was moved somewhere the contract counts.
    ///          Today: 0.
    ///        - a 1-wei benefactor into the next round, plus a harvest, claims NOTHING and the community
    ///          sink receives nothing from that harvest. Today: 0.8 ETH to the raider, 0.19 to the sink.
    ///      COVER (post-fix only; not expressible against 9ae810c because the accounting class does not
    ///      exist there — to be added in their own commit once it does): the residue counter reads
    ///      ≈ 1e18 + 1e9 − 1; the flush delivers exactly that to `_targetSink()` while curated and nothing
    ///      else; `releaseCorpusToCommunity` sweeps it on de-curation (the sweep half is already pinned by
    ///      `test_priceFloor_closedRoundResidueMustNotBeClaimableAsCreatorYield`).
    function test_priceFloor_closingWithdrawalMovesTheResidueOutAsCorpusNotYield() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(1 ether - 1e9); // legit-looking near-total deploy; leaves the pool at the floor

        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        assertApproxEqAbs(vault.principalOf(address(b)), 1 ether, 2, "B owns the pool they funded");

        uint256 residue = 1 ether + 1e9 - 1;
        uint256 vaultBalanceBefore = address(vault).balance;

        _execute(1); // one wei: crosses the floor, the round closes (the control test pins that)
        assertEq(vault.totalPrincipal(), 0, "round closed (same claim as the control)");

        // PIN: the residue is no longer in the Aave position — it left as corpus, with the close.
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "the residue was redeemed out of the position");
        // PIN: and it went somewhere the contract still counts — the vault's own balance, awaiting delivery.
        assertApproxEqAbs(address(vault).balance - vaultBalanceBefore, residue, 2, "the residue is held as corpus");
        // Correct post-close, and stated so the reader does not mistake them for the defect: B's ETH did
        // physically leave the position, so B's live principal and the deployable corpus are both zero.
        assertEq(vault.principalOf(address(b)), 0);
        assertEq(vault.deployableCorpus(), 0);

        // PIN: nothing of it is reachable as creator yield by the next round's first benefactor.
        address raider = address(0xBAD);
        MockOwnable c = _benefactor(raider);
        _deposit(c, 1);
        uint256 sinkBefore = communityPayout.balance;
        vault.harvest();
        assertEq(communityPayout.balance - sinkBefore, 0, "no 19% of B's principal reaches the sink as yield");
        vm.prank(raider);
        assertEq(vault.claimYieldPurse(address(c)), 0, "a one-wei benefactor claims nothing of B's principal");
    }

    /// @dev The other half of the same defect, stated from the winner's side: after the one-wei close, a
    ///      1-wei deposit from any contract benefactor plus a permissionless harvest routes 80% of B's
    ///      principal into that depositor's creator purse. With `execute` frozen by de-curation this is an
    ///      exit for the corpus that is neither `execute` nor `releaseCorpusToCommunity`.
    function test_priceFloor_closedRoundResidueMustNotBeClaimableAsCreatorYield() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        _execute(1);

        // De-curation: the ambassador's execute is frozen and the corpus should leave only to the sink.
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        uint256 sinkBefore = communityPayout.balance;
        uint256 released = vault.releaseCorpusToCommunity();

        address raider = address(0xBAD);
        MockOwnable c = _benefactor(raider);
        _deposit(c, 1); // one wei buys the whole next round
        vault.harvest();
        vm.prank(raider);
        uint256 claimed = vault.claimYieldPurse(address(c));

        // The law: B's ETH went to the community sink, none of it became a creator's purse.
        assertApproxEqAbs(released, 1 ether + 1e9 - 1, 2, "the whole remaining corpus released to the sink");
        assertEq(communityPayout.balance - sinkBefore, released);
        assertEq(claimed, 0, "a one-wei benefactor claims nothing of B's principal");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Impairment: a withdrawn slice must not keep earning through ghost basis
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `_realizeImpairment` runs on migrate and release only. On `execute` the corpus is CLAMPED to
    ///      the position value but the basis is never written down, so after an impaired position is
    ///      deployed to zero the basis still carries the lost half. A's ETH is entirely gone — half to Aave
    ///      bad debt, half deployed — yet A's shares are still priced against the phantom basis: the next
    ///      depositor buys in at the wrong price and A keeps half of every harvest on money that is 100% B's.
    ///      Harvest is also dead until B's ETH doubles, because `_pendingYield` is measured against a basis
    ///      the position does not hold.
    function test_impairment_aFullyWithdrawnSliceMustNotKeepEarningOnTheNextDepositor() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 100 ether);

        stata.simulateLoss(50 ether); // Aave bad debt: the position is worth 50
        vm.deal(address(weth), 200 ether);
        assertEq(vault.deployableCorpus(), 50 ether, "clamped to what the position holds");

        _execute(50 ether); // the ambassador deploys everything the position can realize
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "A's ETH is physically all gone");

        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 50 ether);

        // The law: the position holds only B's 50 ETH, so B's principal is 50 and A's is 0.
        assertEq(vault.principalOf(address(b)), 50 ether, "B owns what B put in");
        assertEq(vault.principalOf(address(a)), 0, "A's slice was physically withdrawn");

        _yield(1 ether);
        vault.harvest();
        assertEq(vault.pendingYieldOf(address(b)), 0.8 ether, "the whole creator leg is B's");
        assertEq(vault.pendingYieldOf(address(a)), 0, "A earns nothing on nothing");
    }
}
