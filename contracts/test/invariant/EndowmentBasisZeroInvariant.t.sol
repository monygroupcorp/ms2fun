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
///      one-way de-curation + release. Yield is injected in every state, an emptied position included — that
///      is the neighbourhood the residue defect lived in, so the invariant must be able to see it. What lands
///      on an empty basis is tracked in `yieldInjectedWhileEmpty` (monotone) and is the only excess over dust
///      a zero basis may ever stand over.
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
    uint256 public yieldInjectedWhileEmpty; // Σ yield landed on a position with a zero basis
    uint256 public floorDrains; // drain-to-sliver deploys that landed
    bool public decurated;

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

    function deposit(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1, 100 ether);
        vm.deal(address(this), amount);
        try vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, _b(seed)) { } catch { }
    }

    /// @notice Deploy any fraction of the corpus.
    function execute(uint256 amount) external {
        uint256 corpus = vault.deployableCorpus();
        if (corpus == 0) return;
        amount = bound(amount, 1, corpus);
        vm.prank(ambassador);
        try vault.execute(deploySink, amount, "") { } catch { }
    }

    /// @notice Deploy all but a sliver — the shape that prices the pool at or under the floor.
    function executeLeaveSliver(uint256 sliver) external {
        uint256 corpus = vault.deployableCorpus();
        if (corpus < 2) return;
        sliver = bound(sliver, 1, corpus < 1e10 ? corpus - 1 : 1e10);
        uint256 residueBefore = vault.roundResidue();
        vm.prank(ambassador);
        try vault.execute(deploySink, corpus - sliver, "") {
            floorDrains++;
            if (vault.roundResidue() > residueBefore) closes++;
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
        try stata.simulateLoss(lost) { } catch { }
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
        try vault.releaseCorpusToCommunity() { } catch { }
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

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.execute.selector;
        selectors[2] = handler.executeLeaveSliver.selector;
        selectors[3] = handler.harvest.selector;
        selectors[4] = handler.accrueYield.selector;
        selectors[5] = handler.induceImpairment.selector;
        selectors[6] = handler.flushResidue.selector;
        selectors[7] = handler.decurateAndRelease.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// @dev THE invariant: a zero basis means an empty position — up to dust and the yield the venue paid onto
    ///      it AFTER it was emptied. Never "principal in Aave with nothing owning it".
    function invariant_basisZeroImpliesPositionEmpty() public view {
        if (vault.totalPrincipal() == 0) {
            assertLe(
                vault.currentPositionValue(),
                REDEEM_DUST + handler.yieldInjectedWhileEmpty(),
                "endowment: basis is 0 while ETH is still in the position (residue left behind as 'yield')"
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
}
