// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { TestableCypherAlignmentVault } from "../helpers/TestableCypherAlignmentVault.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter, MockAlgebraFactory } from "../mocks/MockCypherAlgebra.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { CypherVaultHandler } from "./handlers/CypherVaultHandler.sol";

/// @notice StdInvariant fuzz harness for the CypherAlignmentVault MasterChef fee accumulator.
/// @dev Cypher was the ONE LP vault with zero invariant backing — Uni (UniVaultInvariant) and ZAMM
///      (ZAMMVaultInvariant) already fuzz their accumulators; this closes that gap. Cypher's accumulator
///      is structurally identical to ZAMM's — `accRewardPerContribution` (1e18-scaled) over ETH
///      contributed, with a per-benefactor `rewardDebt` checkpoint at contribution — so this suite is a
///      clone of the ZAMM harness, re-driven through Cypher's Algebra-based `harvest` fee path.
///
///      Invariants pinned: (1) no over-claim — Σ claimed ≤ Σ benefactor fees recorded; (2) accumulator
///      monotone-nondecreasing; (3) no late-joiner retro-claim — total lifetime entitlement (claimed +
///      still-claimable) never exceeds recorded benefactor fees, which a benefactor checkpointed at mint
///      claiming pre-join fees would violate; (4) rounding favors the vault — protocol + benefactor
///      obligations never exceed the vault's ETH balance.
contract CypherVaultInvariantTest is StdInvariant, Test {
    TestableCypherAlignmentVault public vault;
    MockERC20 public alignmentToken;
    MockWETH public weth;
    MockAlgebraPositionManager public positionManager;
    MockAlgebraSwapRouter public swapRouter;
    MockAlgebraFactory public factory;
    MockAlignmentRegistry public registry;
    MockVaultPriceValidator public validator;
    CypherVaultHandler public handler;

    address public treasury = address(0x99);
    address public refPool = address(0xBEEF);
    uint256 constant TARGET_ID = 1;
    uint256 constant ETH_PER_TOKEN = 1e18; // reference TWAP: 1 ETH per 1e18 tokens

    address[] public actors;

    function setUp() public {
        alignmentToken = new MockERC20("Alignment", "ALN");
        weth = new MockWETH();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        factory = new MockAlgebraFactory();
        registry = new MockAlignmentRegistry();
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(ETH_PER_TOKEN);

        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: refPool, kind: 1, twapWindow: 0 })
        );
        registry.setAcquireRoute(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.AcquireRoute({
                venue: IAlignmentRegistry.Venue.ALGEBRA, fee: 0, tickSpacing: 0, feeOrHook: 0
            })
        );

        TestableCypherAlignmentVault impl = new TestableCypherAlignmentVault();
        vault = TestableCypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            address(alignmentToken),
            treasury,
            address(0), // zRouter
            address(0), // zQuoter
            address(validator),
            registry,
            TARGET_ID
        );

        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCAFE));
        actors.push(address(0xDEAD));

        handler = new CypherVaultHandler(
            vault, positionManager, swapRouter, weth, alignmentToken, refPool, treasury, actors
        );

        targetContract(address(handler));
    }

    /// @dev MasterChef floor-rounding dust bound. `_addContribution` floors the benefactor's rewardDebt
    ///      down, so each genuine contribution made while `accRewardPerContribution > 0` can inflate that
    ///      benefactor's later claimable by strictly less than 1 wei. Total over-report across all
    ///      benefactors is therefore < (number of contributions); `+ actors.length` is slack margin. This
    ///      is the same "1 wei per benefactor per accrual" dust the ZAMM/Uni invariant suites tolerate.
    function _dustTolerance() internal view returns (uint256) {
        return handler.ghost_contributions() + actors.length;
    }

    // ── Invariant 1: no over-claim ──
    // Σ ETH actually paid out via claimFees ≤ Σ benefactor fees recorded into the accumulator (+ dust).
    // A benefactor being paid materially more than was recorded as their-side fees is impossible; only
    // MasterChef floor-rounding dust (< 1 wei per contribution, see _dustTolerance) is allowed.

    function invariant_noOverClaim() public view {
        assertLe(
            handler.ghost_totalClaimed(),
            handler.ghost_feesRecorded() + _dustTolerance(),
            "Cypher: claimed exceeds benefactor fees recorded"
        );
    }

    // ── Invariant 2: accumulator monotone-nondecreasing ──
    // accRewardPerContribution only ever grows (harvest does `+=`), never resets. Since nothing but harvest
    // moves it, the live value always equals the max the handler observed across all harvests.

    function invariant_accumulatorMonotonic() public view {
        assertEq(vault.accRewardPerContribution(), handler.ghost_maxAcc(), "Cypher: accRewardPerContribution decreased");
    }

    // ── Invariant 3: no late-joiner retro-claim ──
    // Total lifetime entitlement (already-claimed + still-claimable across every actor) never exceeds the
    // benefactor fees actually recorded (+ dust). A contributor checkpointed at mint (rewardDebt snapshot)
    // claiming fees that accrued BEFORE it joined would push lifetime entitlement MATERIALLY past recorded
    // fees — this bounds it to within MasterChef floor-rounding dust (< 1 wei per contribution), so a
    // genuine retro-claim (which would be a full pre-join fee share, not sub-wei) is caught.

    function invariant_lateJoinerNoRetroClaim() public view {
        uint256 sumClaimable;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            sumClaimable += vault.calculateClaimableAmount(a[i]);
        }
        assertLe(
            handler.ghost_totalClaimed() + sumClaimable,
            handler.ghost_feesRecorded() + _dustTolerance(),
            "Cypher: lifetime entitlement exceeds recorded fees (retro-claim)"
        );
    }

    // ── Invariant 4: rounding favors the vault (no phantom ETH) ──
    // accumulatedProtocolFees + Σ claimable ≤ vault ETH balance. The vault can always honor every
    // outstanding obligation; MasterChef floor-rounding never mints an obligation it cannot pay.

    function invariant_roundingFavorsVault() public view {
        if (vault.totalContributions() == 0) return;

        uint256 sumClaimable;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            sumClaimable += vault.calculateClaimableAmount(a[i]);
        }

        uint256 obligations = vault.accumulatedProtocolFees() + sumClaimable;
        assertLe(obligations, address(vault).balance, "Cypher: obligations exceed vault balance (phantom ETH)");
    }

    // ── Invariant 5: contribution accounting consistency ──
    // Σ benefactorContribution == totalContributions (the MasterChef weight base is never desynced).

    function invariant_contributionSumEqualsTotal() public view {
        uint256 sumContributions;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            sumContributions += vault.benefactorContribution(a[i]);
        }
        assertEq(
            sumContributions, vault.totalContributions(), "Cypher: sum(benefactorContribution) != totalContributions"
        );
    }
}
