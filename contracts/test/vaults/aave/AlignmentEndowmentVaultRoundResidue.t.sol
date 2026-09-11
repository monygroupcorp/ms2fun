// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "./AlignmentEndowmentVault.t.sol";

/// @dev A community sink that tries to re-enter every vault entrypoint from `receive()`. It never reverts
///      itself (so the force-send lands on the plain path, not the selfdestruct fallback) and records, in ONE
///      packed word, which attempts were refused with the guard's `Reentrancy()` — so the test can assert the
///      ordering rather than infer it from balances alone.
contract ReenteringSink {
    AlignmentEndowmentVault public immutable vault;
    Currency internal constant NATIVE = Currency.wrap(address(0));

    /// @dev bit i set ⇔ attempt i reverted with `Reentrancy()`; `attempts` counts receive() entries.
    uint256 public refusedMask;
    uint256 public attempts;
    uint256 public received;

    uint256 internal constant N_ATTEMPTS = 7;

    constructor(AlignmentEndowmentVault _vault) {
        vault = _vault;
    }

    function _try(bytes memory data, uint256 value) internal returns (bool refused) {
        (bool ok, bytes memory ret) = address(vault).call{ value: value }(data);
        if (ok) return false;
        return ret.length == 4 && bytes4(ret) == ReentrancyGuard.Reentrancy.selector;
    }

    receive() external payable {
        received += msg.value;
        attempts += 1;
        if (attempts > 1) return; // one probe per test; the second delivery is plain
        uint256 mask;
        if (_try(abi.encodeCall(vault.execute, (address(this), 1, "")), 0)) mask |= 1 << 0;
        if (_try(abi.encodeCall(vault.receiveContribution, (NATIVE, 1, address(this))), 1)) mask |= 1 << 1;
        if (_try(abi.encodeCall(vault.flushTargetFees, ()), 0)) mask |= 1 << 2;
        if (_try(abi.encodeCall(vault.flushRoundResidue, ()), 0)) mask |= 1 << 3;
        if (_try(abi.encodeCall(vault.releaseCorpusToCommunity, ()), 0)) mask |= 1 << 4;
        if (_try(abi.encodeCall(vault.harvest, ()), 0)) mask |= 1 << 5;
        if (_try(abi.encodeCall(vault.claimYieldPurse, (address(this))), 0)) mask |= 1 << 6;
        refusedMask = mask;
    }

    function allRefused() external view returns (bool) {
        return refusedMask == (1 << N_ATTEMPTS) - 1;
    }
}

/// @dev The round-close residue: a close is a withdrawal. The residual principal is redeemed OUT of the Aave
///      position into `roundResidue`, delivered to the curated target by `flushRoundResidue`, and swept to the
///      community by `releaseCorpusToCommunity` after de-curation. These pin the delivery, the de-curation
///      routing, the unset-sink case, the reentrancy ordering at every site a sink is paid, and the one bound
///      the close relies on at the release site.
contract AlignmentEndowmentVaultRoundResidueTest is Test {
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
    uint256 internal constant REDEEM_DUST = 1e6;

    /// @dev The residue the canonical floor sequence leaves: B's 1 ETH + A's 1 gwei − the 1 wei deployed.
    uint256 internal constant FLOOR_RESIDUE = 1 ether + 1e9 - 1;

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

    function _execute(address to, uint256 amount) internal {
        vm.prank(ambassador);
        vault.execute(to, amount, "");
    }

    /// @dev The audit's sequence: A funds 1 ETH, the ambassador drains to the floor, B funds 1 ETH, one wei
    ///      out closes the round. Returns B.
    function _closeAtFloor() internal returns (MockOwnable b) {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        _execute(makeAddr("deploy_sink"), 1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // The close is a withdrawal: residue out of the position, into the counter, delivered by the flush
    // ═══════════════════════════════════════════════════════════════════════

    function test_close_redeemsResidueIntoCounterAndFlushDeliversItToTheCuratedSink() public {
        uint256 vaultBefore = address(vault).balance;
        _closeAtFloor();

        assertEq(vault.totalPrincipal(), 0, "round closed");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "residue left the position");
        assertApproxEqAbs(vault.roundResidue(), FLOOR_RESIDUE, 2, "residue booked in the counter");
        assertEq(address(vault).balance - vaultBefore, vault.roundResidue(), "held as native ETH, wei for wei");
        assertEq(vault.accumulatedTargetFees(), 0, "not booked as a target fee");
        assertEq(vault.deployableCorpus(), 0, "not deployable");
        uint256 deployedByExecute = 1 ether - 1e9 + 1;
        assertEq(vault.totalDeployedByTarget(), deployedByExecute, "the close books nothing: no departure yet");

        // flushTargetFees moves ONLY fees: nothing here.
        assertEq(vault.flushTargetFees(), 0, "the fee flush does not see corpus residue");
        assertApproxEqAbs(vault.roundResidue(), FLOOR_RESIDUE, 2);

        uint256 sinkBefore = communityPayout.balance;
        uint256 residue = vault.roundResidue();
        uint256 flushed = vault.flushRoundResidue(); // permissionless
        assertEq(flushed, residue, "flush delivers exactly the counter");
        assertEq(communityPayout.balance - sinkBefore, residue, "to the registry's sink");
        assertEq(vault.roundResidue(), 0, "counter zeroed");
        assertEq(vault.totalDeployedByTarget(), deployedByExecute + residue, "booked at departure, by the flush");
        assertEq(vault.flushRoundResidue(), 0, "nothing twice");
    }

    /// @dev A close reached with NO sink pinned must not revert (that would be an ambassador-triggered brick
    ///      of `execute` on a sinkless target); the residue accrues and is delivered once a sink exists.
    function test_close_withSinkUnsetAccruesInsteadOfReverting() public {
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(0));
        _closeAtFloor(); // does not revert
        assertApproxEqAbs(vault.roundResidue(), FLOOR_RESIDUE, 2);

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        vault.flushRoundResidue();

        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);
        uint256 residue = vault.roundResidue();
        assertEq(vault.flushRoundResidue(), residue);
        assertEq(communityPayout.balance, residue);
    }

    /// @dev The invariant the fix exists to hold, at the exact boundary the audit pinned: AT the floor the round
    ///      stays open and nothing is redeemed; one wei under it closes and the position is empty.
    function test_close_boundaryStaysExactAndRedeemsNothingWhileOpen() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        assertEq(vault.totalPrincipal(), 1e9, "at the floor: open");
        assertEq(vault.roundResidue(), 0, "nothing redeemed while open");
        assertEq(vault.currentPositionValue(), 1e9);

        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        assertEq(vault.totalPrincipal() * 1e9, vault.totalPrincipalShares(), "basis * 1e9 == shares: still open");
        assertEq(vault.roundResidue(), 0);

        _execute(makeAddr("deploy_sink"), 1);
        assertEq(vault.totalPrincipal(), 0, "one wei under: closed");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "and the position is empty");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // De-curation: the residue is corpus, so it goes to the community and only to the community
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Closes a round with fees ALSO accrued (sink unset during a harvest), so the two counters are
    ///      populated side by side and the test can show which flush reaches which. Then de-curates and shows:
    ///      (i) the residue lands with the COMMUNITY sink via release, (ii) the counter reads zero after,
    ///      (iii) `flushTargetFees` cannot reach it before, during (see the reentering-sink tests) or after.
    function test_release_sweepsResidueToCommunityAndTheFeeFlushNeverReachesIt() public {
        // Fees accrue while the sink is unset, so `accumulatedTargetFees` is non-zero alongside the residue.
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(0));
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _yield(1 ether);
        vault.harvest();
        assertEq(vault.accumulatedTargetFees(), 0.19 ether, "fees held: sink unset");

        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        _execute(makeAddr("deploy_sink"), 1);
        uint256 residue = vault.roundResidue();
        assertApproxEqAbs(residue, FLOOR_RESIDUE, 2);
        uint256 deployedAfterClose = vault.totalDeployedByTarget();

        // BEFORE de-curation: the fee flush moves the fees and only the fees.
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);
        assertEq(vault.flushTargetFees(), 0.19 ether, "fees only");
        assertEq(vault.roundResidue(), residue, "residue untouched by the fee flush");
        assertEq(vault.accumulatedTargetFees(), 0);

        // De-curate. The curated-only door closes; the fee flush still cannot see the residue.
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        vm.expectRevert(AlignmentEndowmentVault.TargetDecurated.selector);
        vault.flushRoundResidue();
        assertEq(vault.flushTargetFees(), 0, "after de-curation the fee flush still finds no residue");
        assertEq(vault.roundResidue(), residue);

        // Every wei of native ETH the vault holds is in exactly one named bucket, before the release...
        uint256 purses = vault.pendingYieldOf(address(a)) + vault.pendingYieldOf(address(b));
        assertEq(
            address(vault).balance,
            purses + vault.accumulatedTargetFees() + vault.roundResidue(),
            "before: balance == purses + fees + residue"
        );

        // Release: corpus in the position is 0 (the close emptied it); the residue is the whole delivery.
        uint256 sinkBefore = communityPayout.balance;
        uint256 released = vault.releaseCorpusToCommunity();
        // ...and after it, with the residue bucket gone.
        assertEq(
            address(vault).balance,
            purses + vault.accumulatedTargetFees() + vault.roundResidue(),
            "after: balance == purses + fees + residue(0)"
        );
        assertEq(released, residue, "release returns corpus + residue = the residue");
        assertEq(communityPayout.balance - sinkBefore, residue, "(i) landed with the community sink");
        assertEq(vault.roundResidue(), 0, "(ii) counter zero afterwards");
        // Departure booking: the counter did not move at the close, moved by the residue at the sweep, and
        // totals exactly what left the vault on the target's behalf (two executes + the swept residue).
        assertEq(deployedAfterClose, 1 ether - 1e9 + 1, "no booking at the close");
        assertEq(vault.totalDeployedByTarget(), deployedAfterClose + residue, "booked at the sweep");
        assertEq(vault.totalDeployedByTarget(), 2 ether, "== everything that left the vault as corpus");
        assertEq(vault.flushTargetFees(), 0, "(iii) nothing for the fee flush after either");
        assertEq(vault.releaseCorpusToCommunity(), 0, "nothing twice");
        // What the vault still holds is exactly A's creator purse from the one harvest: nothing unowed.
        assertEq(address(vault).balance, vault.pendingYieldOf(address(a)), "the vault holds nothing it does not owe");
        assertEq(address(vault).balance, 0.8 ether);
    }

    /// @dev Release with corpus still in the position AND a residue from an earlier close: one delivery, the sum.
    function test_release_deliversCorpusAndResidueInOneSend() public {
        _closeAtFloor();
        uint256 residue = vault.roundResidue();
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 2 ether); // opens round 1
        assertEq(vault.fundingRound(), 1);

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        uint256 sinkBefore = communityPayout.balance;
        uint256 released = vault.releaseCorpusToCommunity();
        assertApproxEqAbs(released, 2 ether + residue, 2);
        assertEq(communityPayout.balance - sinkBefore, released);
        assertEq(vault.roundResidue(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2);
    }

    /// @dev The close call at the release site: what it can find there is bounded by `REDEEM_DUST` (the guard
    ///      on the line above it), driven here to that MAXIMUM with a liquidity cap that leaves exactly 1e6 wei
    ///      short. It is still needed: that dust basis sits under a floor-sized share count, which is the
    ///      overflow state the floor exists for. The close moves the dust into the residue, the sweep delivers
    ///      it, and the next deposit opens a fresh round at 1:1 instead of pricing against 1e6 wei.
    function test_release_closeAtReleaseFindsAtMostDustAndStillClosesTheRound() public {
        // A floor-priced pool with a big share count and 1 ETH of corpus still in it.
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        uint256 corpus = vault.totalPrincipal();
        uint256 shares = vault.totalPrincipalShares();
        assertEq(shares, 1e27 + 1e18);

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        // Redeem exactly REDEEM_DUST short: the largest shortfall the release tolerates.
        stata.setMaxWithdrawCap(corpus - REDEEM_DUST);
        uint256 sinkBefore = communityPayout.balance;
        uint256 released = vault.releaseCorpusToCommunity();
        // The main redeem got corpus − 1e6; the close found the 1e6 dust basis under 1e27 shares, redeemed it
        // (the cap still allows 1e6 of what is left) into the residue, and the sweep delivered both.
        assertEq(released, corpus, "the dust the close found was delivered too");
        assertEq(communityPayout.balance - sinkBefore, corpus);
        assertEq(vault.totalPrincipal(), 0, "closed, not left at a 1e6-wei basis");
        assertEq(vault.roundResidue(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2);

        // Without the close the next deposit would mint 3e18 · (1e27+1e18) / 1e6 ≈ 3e39 shares; with it, 1:1.
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 3 ether);
        assertEq(vault.fundingRound(), 1);
        assertEq(vault.principalShares(address(c)), 3 ether, "fresh round, 1:1");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Reentrancy: a sink paid at any site cannot land between a redeem and a state write
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `flushRoundResidue`: the sink re-enters every entrypoint from receive(). Each is refused by the
    ///      guard; the counter was zeroed before the send; the residue is delivered exactly once.
    function test_reentrancy_sinkReenteringFromFlushRoundResidueIsRefusedEverywhere() public {
        ReenteringSink sink = new ReenteringSink(vault);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(sink));
        ambassadorRegistry.setAmbassador(TARGET_ID, address(sink), true); // so `execute` fails on the guard, not auth
        vm.deal(address(sink), 1); // for the 1-wei receiveContribution probe
        _closeAtFloor();
        uint256 residue = vault.roundResidue();

        uint256 flushed = vault.flushRoundResidue();
        assertEq(flushed, residue);
        assertEq(sink.attempts(), 1, "the sink was paid once");
        assertEq(sink.received(), residue, "and received exactly the residue");
        assertTrue(
            sink.allRefused(),
            "execute/receiveContribution/flushTargetFees/flushRoundResidue/release/harvest/claim all Reentrancy()"
        );
        assertEq(vault.roundResidue(), 0);
        assertEq(vault.totalPrincipal(), 0, "no principal minted by the re-entered deposit");
        assertEq(vault.fundingRound(), 0, "no round opened");
    }

    /// @dev `execute`: the sink is both the community payout (paid the 19% leg by the harvest-first inside
    ///      execute, BEFORE the close) and the deploy target (paid AFTER the close, with the residue already in
    ///      the counter). Both landings are inside the guard: every re-entry is refused, and the residue is
    ///      neither flushed early nor double-counted.
    function test_reentrancy_sinkReenteringFromInsideExecuteIsRefused() public {
        ReenteringSink sink = new ReenteringSink(vault);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(sink));
        ambassadorRegistry.setAmbassador(TARGET_ID, address(sink), true);
        vm.deal(address(sink), 1);

        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        _yield(1e9); // so the harvest-first inside the closing execute pays the sink its 19% (probe #1)

        // The closing execute, deployed TO the sink: the sink is paid twice inside one guarded call.
        uint256 vaultBefore = address(vault).balance;
        _execute(address(sink), 1);
        assertEq(sink.attempts(), 2, "paid the target leg, then the deployed wei");
        assertTrue(sink.allRefused(), "every re-entry from inside execute refused");
        assertEq(vault.totalPrincipal(), 0, "closed");
        assertApproxEqAbs(vault.roundResidue(), FLOOR_RESIDUE, 2, "residue intact in the counter");
        // The vault grew by the residue plus the harvest's creator leg (80% of 1e9, held as A/B purses).
        assertEq(address(vault).balance - vaultBefore, vault.roundResidue() + 0.8e9, "residue + creator purses");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2);
    }

    /// @dev `releaseCorpusToCommunity`: the sweep zeroes the counter before the send, so a re-entering sink finds
    ///      nothing and every entrypoint refuses it.
    function test_reentrancy_sinkReenteringFromReleaseIsRefused() public {
        ReenteringSink sink = new ReenteringSink(vault);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(sink));
        vm.deal(address(sink), 1);
        _closeAtFloor();
        uint256 residue = vault.roundResidue();
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        uint256 released = vault.releaseCorpusToCommunity();
        assertEq(released, residue);
        assertEq(sink.received(), residue, "delivered once");
        assertEq(sink.attempts(), 1);
        assertTrue(sink.allRefused());
        assertEq(vault.roundResidue(), 0);
        assertEq(vault.releaseCorpusToCommunity(), 0, "and nothing a second time");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Ghost basis: impairment is realized on the execute and deposit paths
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A deposit onto an impaired position writes the basis down first, so the newcomer is priced against
    ///      what the position holds and the loss stays with the shares that held it.
    function test_impairment_depositWritesTheBasisDownBeforePricingTheNewShares() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 100 ether);
        stata.simulateLoss(50 ether);
        vm.deal(address(weth), 200 ether);

        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 50 ether);
        assertEq(vault.totalPrincipal(), 100 ether, "50 written down + 50 new");
        assertEq(vault.principalOf(address(a)), 50 ether, "A carries the loss");
        assertEq(vault.principalOf(address(b)), 50 ether, "B owns what B put in");

        _yield(1 ether);
        vault.harvest();
        assertEq(vault.pendingYieldOf(address(a)), 0.4 ether, "half the creator leg each");
        assertEq(vault.pendingYieldOf(address(b)), 0.4 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Liquidity crunch: what the close's shortfall guard does on each path
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `execute`: a floor-crossing deploy under a liquidity cap that cannot also cover the residue reverts
    ///      `RedeemShortfall` — the same no-partial rule the deploy itself is under, on the ambassador's own
    ///      path. Nothing moves, and the same call settles once liquidity returns.
    function test_crunch_executeCrossingTheFloorRevertsWholeAndRetriesClean() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        uint256 basis = vault.totalPrincipal();

        // Aave can service the 1 wei but not the ~1 ETH residue the close must redeem.
        stata.setMaxWithdrawCap(1e12);
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.RedeemShortfall.selector);
        vault.execute(makeAddr("deploy_sink"), 1, "");
        assertEq(vault.totalPrincipal(), basis, "nothing moved");
        assertEq(vault.roundResidue(), 0);
        assertEq(vault.currentPositionValue(), basis);

        stata.setMaxWithdrawCap(0);
        _execute(makeAddr("deploy_sink"), 1);
        assertEq(vault.totalPrincipal(), 0, "settles once liquidity is back");
        assertApproxEqAbs(vault.roundResidue(), FLOOR_RESIDUE, 2);
    }

    /// @dev `releaseCorpusToCommunity` under a crunch: the exit never reverts. It delivers what Aave will give,
    ///      leaves the remainder as live basis (no close on a partial — a close would need a second redeem the
    ///      same crunch refuses), and sweeps the residue counter on the FIRST call regardless (native ETH does
    ///      not depend on Aave liquidity). With liquidity back the next call takes the rest, closes, and
    ///      leaves basis and counter at zero.
    function test_crunch_releaseIsPartialTolerantAndSweepsTheResidueFirst() public {
        // A residue from an earlier close, then a fresh round with corpus in the position.
        _closeAtFloor();
        uint256 residue = vault.roundResidue();
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 4 ether);
        assertEq(vault.totalPrincipal(), 4 ether);
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        // Crunch: Aave can only give 1 ETH of the 4.
        stata.setMaxWithdrawCap(1 ether);
        uint256 sinkBefore = communityPayout.balance;
        uint256 first = vault.releaseCorpusToCommunity();
        assertEq(first, 1 ether + residue, "delivers the cap plus the whole residue, no revert");
        assertEq(communityPayout.balance - sinkBefore, first);
        assertEq(vault.roundResidue(), 0, "the residue was swept on the first call");
        assertEq(vault.totalPrincipal(), 3 ether, "the remainder is live basis");
        assertEq(vault.currentPositionValue(), 3 ether, "and still in the position");
        assertEq(vault.fundingRound(), 1, "no close on a partial");

        // Still crunched: another partial, still no revert, still live.
        second_partial(sinkBefore + first);

        // Liquidity returns: the rest leaves, the round closes, nothing remains.
        stata.setMaxWithdrawCap(0);
        uint256 before3 = communityPayout.balance;
        uint256 third = vault.releaseCorpusToCommunity();
        assertEq(third, 2 ether, "the rest");
        assertEq(communityPayout.balance - before3, third);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(vault.roundResidue(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2);
        assertEq(vault.releaseCorpusToCommunity(), 0, "nothing left");
    }

    function second_partial(uint256 sinkAfterFirst) internal {
        uint256 second = vault.releaseCorpusToCommunity();
        assertEq(second, 1 ether, "second partial");
        assertEq(communityPayout.balance - sinkAfterFirst, second);
        assertEq(vault.totalPrincipal(), 2 ether);
    }

    /// @dev The crunch at a FLOOR-PRICED pool: the partial leaves the price under the floor, and the close is
    ///      deliberately not run (it would revert on the same crunch). The next full call closes it.
    function test_crunch_releaseAtTheFloorDefersTheCloseToTheFullCall() public {
        MockOwnable a = _benefactor(address(0xA11CE));
        _deposit(a, 1 ether);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable b = _benefactor(address(0xB0B));
        _deposit(b, 1 ether);
        uint256 corpus = vault.totalPrincipal();
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        stata.setMaxWithdrawCap(0.5 ether);
        assertEq(vault.releaseCorpusToCommunity(), 0.5 ether, "partial, no revert");
        assertEq(vault.totalPrincipal(), corpus - 0.5 ether, "live basis under the floor, round open");
        assertLt(vault.totalPrincipal() * 1e9, vault.totalPrincipalShares(), "price is under the floor");
        assertEq(vault.roundResidue(), 0, "the close did not run");

        stata.setMaxWithdrawCap(0);
        uint256 sinkBefore = communityPayout.balance;
        assertEq(vault.releaseCorpusToCommunity(), corpus - 0.5 ether, "the rest, closed and swept");
        assertEq(communityPayout.balance - sinkBefore, corpus - 0.5 ether);
        assertEq(vault.totalPrincipal(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // migratePosition leaves the residue where it is, with both doors still open
    // ═══════════════════════════════════════════════════════════════════════

    function test_migrate_leavesResidueFlushableWhileCurated() public {
        _closeAtFloor();
        uint256 residue = vault.roundResidue();
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 2 ether); // so migrate has a position to move

        address recovery = makeAddr("recovery");
        vm.prank(vaultOwner);
        vault.migratePosition(recovery);
        assertEq(recovery.balance, 2 ether, "migrate moved the position only");
        assertEq(vault.roundResidue(), residue, "the residue stayed");
        assertTrue(vault.migrated());

        uint256 sinkBefore = communityPayout.balance;
        assertEq(vault.flushRoundResidue(), residue, "still flushable to the curated target");
        assertEq(communityPayout.balance - sinkBefore, residue);
        assertEq(vault.roundResidue(), 0);
    }

    function test_migrate_leavesResidueReleasableAfterDecuration() public {
        _closeAtFloor();
        uint256 residue = vault.roundResidue();
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 2 ether);

        vm.prank(vaultOwner);
        vault.migratePosition(makeAddr("recovery"));
        assertEq(vault.roundResidue(), residue);

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        vm.expectRevert(AlignmentEndowmentVault.TargetDecurated.selector);
        vault.flushRoundResidue();
        uint256 sinkBefore = communityPayout.balance;
        assertEq(vault.releaseCorpusToCommunity(), residue, "released: corpus 0 after migrate + the residue");
        assertEq(communityPayout.balance - sinkBefore, residue);
        assertEq(vault.roundResidue(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Departure booking and reconciliation: one residue out by each door, counted exactly once
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Two residues: the first leaves by `flushRoundResidue` (curated), the second by the release sweep
    ///      (de-curated). `totalDeployedByTarget` does not move at either close, moves by each residue exactly
    ///      once at its departure, and the vault's native balance reconciles to purses + fees + residue at
    ///      every instant the residue counter is LOADED, not only at the endpoints.
    function test_booking_eachResidueCountedOnceAtItsDoorAndTheBalanceReconcilesWhileLoaded() public {
        // Residue #1.
        MockOwnable b1 = _closeAtFloor();
        uint256 r1 = vault.roundResidue();
        assertApproxEqAbs(r1, FLOOR_RESIDUE, 2);
        uint256 deployed0 = 1 ether - 1e9 + 1; // the two executes
        assertEq(vault.totalDeployedByTarget(), deployed0, "close #1 booked nothing");
        assertEq(
            address(vault).balance, _purses(b1) + vault.accumulatedTargetFees() + vault.roundResidue(), "loaded #1"
        );

        assertEq(vault.flushRoundResidue(), r1);
        assertEq(vault.totalDeployedByTarget(), deployed0 + r1, "flush booked r1 once");
        assertEq(address(vault).balance, _purses(b1) + vault.accumulatedTargetFees(), "drained #1");

        // Residue #2, in the next round, closed the same way.
        MockOwnable c = _benefactor(address(0xC0C));
        _deposit(c, 1 ether);
        _yield(1e15);
        vault.harvest(); // so the purse bucket is non-zero for the reconciliation below
        _benefs.push(c);
        assertEq(_purses(b1), 0.8e15);
        _execute(makeAddr("deploy_sink"), 1 ether - 1e9);
        MockOwnable d = _benefactor(address(0xD0D));
        _deposit(d, 1 ether);
        _benefs.push(d);
        _execute(makeAddr("deploy_sink"), 1);
        uint256 r2 = vault.roundResidue();
        assertApproxEqAbs(r2, FLOOR_RESIDUE, 2);
        uint256 deployed1 = deployed0 + r1 + deployed0;
        assertEq(vault.totalDeployedByTarget(), deployed1, "close #2 booked nothing");
        assertEq(
            address(vault).balance, _purses(b1) + vault.accumulatedTargetFees() + vault.roundResidue(), "loaded #2"
        );

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);
        assertEq(
            address(vault).balance,
            _purses(b1) + vault.accumulatedTargetFees() + vault.roundResidue(),
            "still loaded after de-curation"
        );
        assertEq(vault.releaseCorpusToCommunity(), r2);
        assertEq(vault.totalDeployedByTarget(), deployed1 + r2, "sweep booked r2 once");
        assertEq(vault.roundResidue(), 0);
        assertEq(address(vault).balance, _purses(b1) + vault.accumulatedTargetFees(), "drained #2");
        assertEq(vault.totalDeployedByTarget(), 4 ether, "== everything that ever left the vault as corpus");
    }

    MockOwnable[] internal _benefs;

    /// @dev Σ creator purses (settled + live) across every benefactor the test registered plus `b1`.
    function _purses(MockOwnable b1) internal view returns (uint256 sum) {
        sum = vault.pendingYieldOf(address(b1));
        for (uint256 i = 0; i < _benefs.length; i++) {
            sum += vault.pendingYieldOf(address(_benefs[i]));
        }
    }
}
