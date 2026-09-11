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
    // What the position held the moment a call drained the basis to zero, LESS any principal that call did
    // not account for leaving. Under a liquidity cap the harvest-first step inside execute / release takes
    // `min(pending, cap)` of the yield and the rest stays in the position above a basis the same call
    // empties — unchanged behaviour from before the cap lever existed here; the lever is what makes it
    // visible. It is booked as yield only to the extent the principal is accounted for: the call's basis must
    // have left the position wei for wei (`totalDeployedByTarget` + `roundResidue` deltas), and a shortfall
    // beyond dust is SUBTRACTED, so the invariant — an equality, never "at most" — fails by exactly the
    // principal a drain left behind.
    uint256 public yieldStrandedByCapOnDrain;
    uint256 public floorDrains; // drain-to-sliver deploys that landed
    bool public decurated;

    // The deposit guard, watched from both sides. `guardFired` counts `RoundClosePending` reverts;
    // `ghost_guardFiredAboveTheFloor` is set if one came from a pool that was NOT under the floor with a
    // nonzero basis, `ghost_depositMintedUnderTheFloor` if a deposit LANDED on a pool that was.
    uint256 public guardFired;
    bool public ghost_guardFiredAboveTheFloor;
    bool public ghost_depositMintedUnderTheFloor;

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
        _deposit(seed, bound(amount, 1, 100 ether));
    }

    function _deposit(uint256 seed, uint256 amount) internal {
        vm.deal(address(this), amount);
        bool under = _underTheFloor();
        bool wasEmpty = vault.totalPrincipal() == 0;
        try vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, _b(seed)) {
            if (under) ghost_depositMintedUnderTheFloor = true;
            if (wasEmpty) {
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
        uint256 value = vault.currentPositionValue();
        cap = bound(cap, 0, value == 0 ? 1 ether : value);
        stata.setMaxWithdrawCap(cap);
    }

    /// @dev A snapshot before a call that may drain the basis: the basis as the call will write it down
    ///      (`min(totalPrincipal, position value)`, what `_realizeImpairment` does first) and the two counters
    ///      every departure of principal from the position is booked in.
    struct DrainSnap {
        uint256 basis;
        uint256 deployed;
        uint256 residue;
    }

    function _snap() internal view returns (DrainSnap memory d) {
        d.basis = vault.totalPrincipal();
        uint256 value = vault.currentPositionValue();
        if (value < d.basis) d.basis = value;
        d.deployed = vault.totalDeployedByTarget();
        d.residue = vault.roundResidue();
    }

    /// @dev If the call emptied the basis, book what the position still holds as the stranded yield — less
    ///      whatever of the basis did NOT leave the position. Principal leaves by `execute`'s forward (booked
    ///      in `totalDeployedByTarget`), by the release send (same counter, residue swept included) and by the
    ///      close into `roundResidue`; so `Δdeployed + Δresidue` is the principal that left, and
    ///      `basis − that` is principal still in the position with nothing owning it. Up to `REDEEM_DUST` of it
    ///      is the ERC-4626 rounding the vault tolerates; beyond that it is subtracted from the yield the
    ///      position is allowed to hold, and the equality below fails by exactly that amount.
    function _bookStrandedIfDrained(DrainSnap memory d) internal {
        if (d.basis == 0 || vault.totalPrincipal() != 0) return;
        uint256 left = (vault.totalDeployedByTarget() - d.deployed) + vault.roundResidue() - d.residue;
        uint256 unaccounted = d.basis > left ? d.basis - left : 0;
        if (unaccounted <= REDEEM_DUST) unaccounted = 0;
        uint256 value = vault.currentPositionValue();
        yieldStrandedByCapOnDrain = value > unaccounted ? value - unaccounted : 0;
        yieldInjectedWhileEmpty = 0;
    }

    /// @notice Deploy any fraction of the corpus.
    function execute(uint256 amount) external {
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
        uint256 corpus = vault.deployableCorpus();
        if (corpus < 2) return;
        sliver = bound(sliver, 1, corpus < 1e10 ? corpus - 1 : 1e10);
        DrainSnap memory d = _snap();
        vm.prank(ambassador);
        try vault.execute(deploySink, corpus - sliver, "") {
            floorDrains++;
            if (vault.roundResidue() > d.residue) closes++;
            _bookStrandedIfDrained(d);
        } catch { }
    }

    function harvest(uint256) external {
        try vault.harvest() { } catch { }
    }

    function accrueYield(uint256 amount) external {
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
        try vault.flushRoundResidue() { } catch { }
    }

    /// @notice One-way: de-curate (freezes execute for the rest of the run) and release everything.
    function decurateAndRelease(uint256 seed) external {
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

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.execute.selector;
        selectors[2] = handler.executeLeaveSliver.selector;
        selectors[3] = handler.harvest.selector;
        selectors[4] = handler.accrueYield.selector;
        selectors[5] = handler.induceImpairment.selector;
        selectors[6] = handler.flushResidue.selector;
        selectors[7] = handler.decurateAndRelease.selector;
        selectors[8] = handler.setLiquidityCap.selector;
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
