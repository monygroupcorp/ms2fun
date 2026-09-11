// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @dev Drives the endowment through deposits, deploys of every size (including the drain-to-a-sliver shape
///      that prices the pool at the floor), harvests, yield, solvency haircuts, the residue flush, and the
///      one-way de-curation + release, and an Aave liquidity cap. Yield is injected in every state, an emptied position included — that
///      is the neighbourhood the residue defect lived in, so the invariant must be able to see it. What lands
///      on an empty basis is tracked in `yieldInjectedWhileEmpty`, and with `yieldStrandedByCapOnDrain` it is
///      EXACTLY what a zero basis stands over (up to dust): both reset when a deposit lands on the empty basis,
///      because from then on that value is pending yield the next harvest takes.
contract EndowmentBasisZeroHandler is Test {
    AlignmentEndowmentVault public vault;
    MockWETH public weth;
    MockStataToken public stata;
    MockAmbassadorRegistry public ambassadorRegistry;
    address public ambassador;
    uint256 public targetId;
    address[] public benefactors;
    address public deploySink = address(0xD3B1);

    uint256 public closes; // rounds closed by the price floor (RoundResidueAccrued observed)
    uint256 internal constant REDEEM_DUST = 1e6; // mirror of the vault constant

    uint256 public yieldInjectedWhileEmpty; // Σ yield landed on a position with a zero basis, since it emptied
    // The yield a liquidity cap kept the harvest-first step from redeeming on the call that drained the basis
    // to zero: `pending − min(pending, cap)`, from the PRE-CALL position value, basis and cap — never from the
    // vault's own counters, which a mis-booked redeem keeps consistent with itself. Under a cap the crystallize
    // inside execute / release takes `min(pending, cap)` and the rest stays in the position above a basis the
    // same call empties: unchanged behaviour from before the cap lever existed here; the lever is what makes
    // it visible. The one thing subtracted is the mock's own rounding, measured from the mock and the WETH
    // balance, not from the vault (see `_bookStrandedIfDrained`). The invariant holds the position to this
    // number EXACTLY (± dust), never "at most", so principal a drain left behind — whatever the counters
    // say about it — is value the ghost does not explain.
    uint256 public yieldStrandedByCapOnDrain;
    uint256 public floorDrains; // drain-to-sliver deploys that landed
    bool public decurated;

    // The deposit guard, watched from both sides. `guardFired` counts `RoundClosePending` reverts;
    // `ghost_guardFiredAboveTheFloor` is set if one came from a pool that was NOT under the floor with a
    // nonzero basis, `ghost_depositMintedUnderTheFloor` if a deposit LANDED on a pool that was.
    uint256 public guardFired;
    bool public ghost_guardFiredAboveTheFloor;
    bool public ghost_depositMintedUnderTheFloor;
    uint256 public calls; // every handler call, so `crunchUnderTheFloor` can wait for the random walk to run

    constructor(
        AlignmentEndowmentVault _vault,
        MockWETH _weth,
        MockStataToken _stata,
        MockAmbassadorRegistry _reg,
        address _ambassador,
        uint256 _targetId,
        uint256 n
    ) {
        vault = _vault;
        weth = _weth;
        stata = _stata;
        ambassadorRegistry = _reg;
        ambassador = _ambassador;
        targetId = _targetId;
        for (uint256 i = 0; i < n; i++) {
            benefactors.push(address(new MockOwnable(address(this))));
        }
    }

    receive() external payable { }

    function _b(uint256 seed) internal view returns (address) {
        return benefactors[seed % benefactors.length];
    }

    /// @dev The floor test the guard makes, on the basis the deposit will price against: `_realizeImpairment`
    ///      runs first inside the call, so that basis is `min(totalPrincipal, position value)`.
    function _underTheFloor() internal view returns (bool) {
        uint256 basis = vault.totalPrincipal();
        uint256 value = vault.currentPositionValue();
        if (value < basis) basis = value;
        return basis != 0 && basis * 1e9 < vault.totalPrincipalShares();
    }

    function deposit(uint256 seed, uint256 amount) external {
        calls++;
        _deposit(seed, bound(amount, 1, 100 ether));
    }

    /// @notice Steer into the one state the deposit guard exists for. The random walk cannot reach it: it
    ///         takes a floor-priced pool, a de-curation, and then a cap inside a window about 1e-9 of the
    ///         corpus wide — wide enough for the partial to leave the price under the floor, narrow enough for
    ///         the shortfall to exceed `REDEEM_DUST` so the close is skipped — and a random cap in
    ///         `[0, value]` lands there never. So this builds it: a ≥ 1 ETH deposit (the open round then has
    ///         ≥ 1e18 shares, since the price never exceeds 1), de-curation, a cap leaving exactly
    ///         `REDEEM_DUST + 1` of basis behind — under the floor by construction — and a deposit into it.
    ///         It waits out the first 300 calls so the execute surface stays live for most of every run, and
    ///         acts on every call after that so no run of the default depth (500) ends without reaching the
    ///         state; `afterInvariant` refuses the run that does.
    function crunchUnderTheFloor(uint256 seed, uint256 amount) external {
        calls++;
        if (calls < 300) return;
        amount = bound(amount, 1 ether, 10 ether);
        stata.setMaxWithdrawCap(0);
        try vault.harvest() { } catch { }
        _deposit(seed, amount); // refused by the guard if the pool is already in the window — counted there
        if (!decurated) {
            ambassadorRegistry.deactivateAlignmentTarget(targetId);
            decurated = true;
        }
        DrainSnap memory d = _snap();
        if (d.basis <= REDEEM_DUST + 1) return;
        stata.setMaxWithdrawCap(d.basis - (REDEEM_DUST + 1));
        try vault.releaseCorpusToCommunity() {
            _bookStrandedIfDrained(d);
        } catch { }
        _deposit(seed, amount);
    }

    function _deposit(uint256 seed, uint256 amount) internal {
        vm.deal(address(this), amount);
        bool under = _underTheFloor();
        bool wasEmpty = vault.totalPrincipal() == 0;
        uint256 roundBefore = vault.fundingRound();
        try vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, _b(seed)) {
            // A mint that opened a round priced against nothing: the basis was zero when the shares were
            // priced. The mock can get there from a nonzero basis inside the call — its ceiling share-burn
            // on the harvest-first yield redeem can take the last share at a tiny share count, and
            // `_realizeImpairment` then writes the basis to 0 — so "under the floor" is judged on the round
            // the shares were actually minted in.
            bool opened = vault.fundingRound() != roundBefore;
            if (under && !opened) ghost_depositMintedUnderTheFloor = true;
            if (wasEmpty || opened) {
                // Whatever the empty position held is now pending yield over a live basis; the next harvest
                // takes it, so the zero-basis ghost starts over.
                yieldInjectedWhileEmpty = 0;
                yieldStrandedByCapOnDrain = 0;
            }
        } catch (bytes memory err) {
            if (err.length == 4 && bytes4(err) == AlignmentEndowmentVault.RoundClosePending.selector) {
                guardFired++;
                if (!under) ghost_guardFiredAboveTheFloor = true;
            }
        }
    }

    /// @notice Aave liquidity crunch: cap what `maxWithdraw` returns (0 = uncapped). This is what makes a
    ///         release partial, and a partial release on a floor-priced de-curated pool is the one state the
    ///         deposit guard exists for.
    function setLiquidityCap(uint256 cap) external {
        calls++;
        uint256 value = vault.currentPositionValue();
        cap = bound(cap, 0, value == 0 ? 1 ether : value);
        stata.setMaxWithdrawCap(cap);
    }

    /// @dev A snapshot before a call that may drain the basis, taken from the position and the mock — nothing
    ///      the vault books: the basis, the position value, the cap, and the WETH the stata holds.
    struct DrainSnap {
        uint256 basis;
        uint256 value;
        uint256 cap;
        uint256 stataWeth;
    }

    function _snap() internal view returns (DrainSnap memory d) {
        d.basis = vault.totalPrincipal();
        d.value = vault.currentPositionValue();
        d.cap = stata.maxWithdrawCap();
        d.stataWeth = weth.balanceOf(address(stata));
    }

    /// @dev If the call emptied the basis, book the yield it had to leave behind: `pending − min(pending, cap)`
    ///      from the pre-call numbers (a cap of 0 is no cap). The vault's counters are not consulted — a redeem
    ///      that books more than it pulled keeps them consistent with the basis debit, and a ghost derived from
    ///      them would call the wei it left behind "yield". What IS subtracted is the mock's rounding: its
    ///      ceiling share-burn on withdraw can take more value off the position than the WETH it hands over, so
    ///      `(value before − value after) − WETH delivered` is value the mock destroyed, measured from the mock
    ///      and the WETH balance alone. Principal left in the position by ANY route then shows as value above
    ///      this number, and the equality below fails by exactly that much.
    function _bookStrandedIfDrained(DrainSnap memory d) internal {
        if (d.basis == 0 || vault.totalPrincipal() != 0) return;
        uint256 pending = d.value > d.basis ? d.value - d.basis : 0;
        uint256 taken = d.cap == 0 || pending < d.cap ? pending : d.cap;
        uint256 stranded = pending - taken;
        uint256 valueAfter = vault.currentPositionValue();
        uint256 delivered = d.stataWeth - weth.balanceOf(address(stata));
        uint256 drop = d.value > valueAfter ? d.value - valueAfter : 0;
        uint256 mockRounding = drop > delivered ? drop - delivered : 0;
        yieldStrandedByCapOnDrain = stranded > mockRounding ? stranded - mockRounding : 0;
        yieldInjectedWhileEmpty = 0;
    }

    /// @notice Deploy any fraction of the corpus.
    function execute(uint256 amount) external {
        calls++;
        uint256 corpus = vault.deployableCorpus();
        if (corpus == 0) return;
        amount = bound(amount, 1, corpus);
        DrainSnap memory d = _snap();
        vm.prank(ambassador);
        try vault.execute(deploySink, amount, "") {
            _bookStrandedIfDrained(d);
        } catch { }
    }

    /// @notice Deploy all but a sliver — the shape that prices the pool at or under the floor.
    function executeLeaveSliver(uint256 sliver) external {
        calls++;
        uint256 corpus = vault.deployableCorpus();
        if (corpus < 2) return;
        sliver = bound(sliver, 1, corpus < 1e10 ? corpus - 1 : 1e10);
        uint256 residueBefore = vault.roundResidue();
        DrainSnap memory d = _snap();
        vm.prank(ambassador);
        try vault.execute(deploySink, corpus - sliver, "") {
            floorDrains++;
            if (vault.roundResidue() > residueBefore) closes++;
            _bookStrandedIfDrained(d);
        } catch { }
    }

    function harvest(uint256) external {
        calls++;
        try vault.harvest() { } catch { }
    }

    function accrueYield(uint256 amount) external {
        calls++;
        amount = bound(amount, 1, 10 ether);
        vm.deal(address(weth), address(weth).balance + amount);
        weth.mint(address(this), amount);
        weth.approve(address(stata), amount);
        uint256 before = vault.currentPositionValue();
        try stata.simulateYield(amount) {
            // Only what the vault can actually SEE counts (a position with no stata shares reads 0 whatever
            // the venue holds); on a zero basis that is exactly the excess a later harvest will split.
            if (vault.totalPrincipal() == 0) yieldInjectedWhileEmpty += vault.currentPositionValue() - before;
        } catch { }
    }

    function induceImpairment(uint256 bps) external {
        calls++;
        uint256 managed = stata.totalManaged();
        if (managed == 0) return;
        bps = bound(bps, 1, 9_000);
        uint256 lost = (managed * bps) / 10_000;
        if (lost == 0) return;
        uint256 before = vault.currentPositionValue();
        try stata.simulateLoss(lost) {
            // A haircut on an empty basis takes its share of the yield the ghosts hold the position to: the
            // ghosts fall by exactly what the vault can see leaving, and by nothing else.
            if (vault.totalPrincipal() == 0) {
                uint256 drop = before - vault.currentPositionValue();
                uint256 fromStranded = drop < yieldStrandedByCapOnDrain ? drop : yieldStrandedByCapOnDrain;
                yieldStrandedByCapOnDrain -= fromStranded;
                uint256 rest = drop - fromStranded;
                yieldInjectedWhileEmpty = rest < yieldInjectedWhileEmpty ? yieldInjectedWhileEmpty - rest : 0;
            }
        } catch { }
    }

    function flushResidue(uint256) external {
        calls++;
        try vault.flushRoundResidue() { } catch { }
    }

    /// @notice One-way: de-curate (freezes execute for the rest of the run) and release everything.
    function decurateAndRelease(uint256 seed) external {
        calls++;
        if (!decurated) {
            if (seed % 8 != 0) return; // rare, so most runs keep the execute surface live
            ambassadorRegistry.deactivateAlignmentTarget(targetId);
            decurated = true;
        }
        DrainSnap memory d = _snap();
        try vault.releaseCorpusToCommunity() {
            _bookStrandedIfDrained(d);
        } catch { }
    }
}

/// @title  EndowmentBasisZeroInvariant
/// @notice The invariant the round-close fix exists to hold, in the overseer's words: "basis is 0 while ETH
///         is still in the position" is UNREACHABLE. After any sequence of deposit / execute / close / harvest /
///         impairment / flush / release, `totalPrincipal == 0` implies the position's realizable value is at
///         most `REDEEM_DUST` plus whatever yield the venue paid onto an already-empty position (which no
///         contract path put there, and which is the one thing a zero basis may legitimately stand over). A
///         close that zeroed the basis without redeeming would trip it on the first floor-priced drain; a
///         close that redeemed short would trip it by the shortfall.
contract EndowmentBasisZeroInvariantTest is StdInvariant, Test {
    AlignmentEndowmentVault public vault;
    MockWETH public weth;
    MockStataToken public stata;
    MockMasterRegistry public masterRegistry;
    MockAmbassadorRegistry public ambassadorRegistry;
    EndowmentBasisZeroHandler public handler;

    address public vaultOwner = address(0xA0FF);
    address public treasury = address(0xA0FE);
    address public alignmentToken = address(0xA0FD);
    address public communityPayout = address(0xA0FC);
    address public ambassador = address(0xA0FB);
    uint256 public constant TARGET_ID = 42;
    uint256 internal constant REDEEM_DUST = 1e6;

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

        handler = new EndowmentBasisZeroHandler(vault, weth, stata, ambassadorRegistry, ambassador, TARGET_ID, 3);

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.execute.selector;
        selectors[2] = handler.executeLeaveSliver.selector;
        selectors[3] = handler.harvest.selector;
        selectors[4] = handler.accrueYield.selector;
        selectors[5] = handler.induceImpairment.selector;
        selectors[6] = handler.flushResidue.selector;
        selectors[7] = handler.decurateAndRelease.selector;
        selectors[8] = handler.setLiquidityCap.selector;
        selectors[9] = handler.crunchUnderTheFloor.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// @dev THE invariant: a zero basis means an empty position — holding EXACTLY (± dust) the yield the venue
    ///      paid onto it after it was emptied plus the yield a liquidity cap kept the draining call's
    ///      harvest-first step from taking, and not a wei more. An equality, not a bound: a principal leak of
    ///      any size on the drain path is value the two ghosts do not explain, and it fails here.
    ///      Never "principal in Aave with nothing owning it".
    function invariant_basisZeroImpliesPositionEmpty() public view {
        if (vault.totalPrincipal() == 0) {
            assertApproxEqAbs(
                vault.currentPositionValue(),
                handler.yieldInjectedWhileEmpty() + handler.yieldStrandedByCapOnDrain(),
                REDEEM_DUST,
                "endowment: basis is 0 and the position holds value the yield ghosts do not explain"
            );
        }
    }

    /// @dev The residue and the accrued fees are vault-held native ETH: the balance always covers both.
    function invariant_residueAndFeesAreBackedByTheVaultBalance() public view {
        assertGe(
            address(vault).balance,
            vault.roundResidue() + vault.accumulatedTargetFees(),
            "endowment: vault-held counters exceed the vault's native balance"
        );
    }

    /// @dev Once de-curated, the residue never sits alongside a curated-only door: `flushRoundResidue` reverts.
    function invariant_flushRoundResidueClosedAfterDecuration() public {
        if (!handler.decurated()) return;
        (bool ok,) = address(vault).call(abi.encodeCall(vault.flushRoundResidue, ()));
        assertFalse(ok, "endowment: flushRoundResidue reachable on a de-curated target");
    }

    /// @dev Coverage, not belief: a run of the default depth reached the guarded state at least once, or the
    ///      two-sided ghost below proved nothing about the guard. Checked once the walk is past the point
    ///      `crunchUnderTheFloor` starts steering (it acts from call 300; this asks from call 400) rather than
    ///      in `afterInvariant`, so that a shrunk replay of some OTHER failure — a few calls long — is not
    ///      itself failed here and the real sequence stays readable.
    function invariant_depositGuardStateWasReached() public view {
        if (handler.calls() < 400) return;
        assertGe(handler.guardFired(), 1, "endowment: this run never reached the state the deposit guard exists for");
    }

    /// @dev The deposit guard fires exactly on the under-the-floor pool with principal in it, and nowhere else:
    ///      every `RoundClosePending` came from that state, and no deposit ever minted in it.
    function invariant_depositGuardFiresOnlyUnderTheFloor() public view {
        assertFalse(
            handler.ghost_guardFiredAboveTheFloor(),
            "endowment: RoundClosePending on a pool that was not under the floor with basis > 0"
        );
        assertFalse(
            handler.ghost_depositMintedUnderTheFloor(),
            "endowment: a deposit minted against a pool under the floor with basis > 0"
        );
    }
}
