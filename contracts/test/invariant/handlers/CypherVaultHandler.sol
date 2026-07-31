// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TestableCypherAlignmentVault } from "../../helpers/TestableCypherAlignmentVault.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter } from "../../mocks/MockCypherAlgebra.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @notice Invariant handler for CypherAlignmentVault's MasterChef fee accumulator.
/// @dev Structural clone of ZAMMVaultHandler (ETH-contribution basis, accRewardPerContribution over ETH),
///      adapted to Cypher's Algebra surface: fees accrue via `harvest` collecting from the vault's LP
///      position (staged on the mock position manager) and distributing through the accumulator, exactly
///      as the CypherAlignmentVault unit test drives it. The action set — contribute, harvest (fee
///      accrual), claim, withdrawProtocolFees — mirrors ZAMM's, so the same accumulator invariants apply.
contract CypherVaultHandler is Test {
    TestableCypherAlignmentVault public vault;
    MockAlgebraPositionManager public positionManager;
    MockAlgebraSwapRouter public swapRouter;
    MockWETH public weth;
    MockERC20 public alignmentToken;
    address public refPool;
    address public treasury;

    address[] public actors;
    mapping(address => bool) public isActor;

    // Ghost variables for tracking
    uint256 public ghost_totalContributed;
    mapping(address => uint256) public ghost_actorContributed;
    uint256 public ghost_totalClaimed;
    // Σ of the benefactor portion of fees recorded into the accumulator across all harvests.
    uint256 public ghost_feesRecorded;
    uint256 public ghost_harvests;
    // Count of genuine contributions (receiveContribution calls). Each `_addContribution` floors the
    // benefactor's rewardDebt down, so a contribution made while acc>0 can under-count debt by <1 wei,
    // inflating that benefactor's later claimable by <1 wei. This counter bounds that MasterChef dust:
    // total over-report across all benefactors is < ghost_contributions wei (see the invariant tolerance).
    uint256 public ghost_contributions;
    // Max accRewardPerContribution ever observed — the accumulator is monotone-nondecreasing, so the
    // live value always equals this max (checked in invariant_accumulatorMonotonic).
    uint256 public ghost_maxAcc;
    bool public ghost_positionSet;

    constructor(
        TestableCypherAlignmentVault _vault,
        MockAlgebraPositionManager _positionManager,
        MockAlgebraSwapRouter _swapRouter,
        MockWETH _weth,
        MockERC20 _alignmentToken,
        address _refPool,
        address _treasury,
        address[] memory _actors
    ) {
        vault = _vault;
        positionManager = _positionManager;
        swapRouter = _swapRouter;
        weth = _weth;
        alignmentToken = _alignmentToken;
        refPool = _refPool;
        treasury = _treasury;
        for (uint256 i = 0; i < _actors.length; i++) {
            actors.push(_actors[i]);
            isActor[_actors[i]] = true;
        }
    }

    function _getActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function contribute(uint256 actorSeed, uint256 amount) external {
        amount = bound(amount, 0.01 ether, 10 ether);
        address actor = _getActor(actorSeed);

        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, actor);

        ghost_totalContributed += amount;
        ghost_actorContributed[actor] += amount;
        ghost_contributions++;
    }

    function contributeViaReceive(uint256 actorSeed, uint256 amount) external {
        // The bare receive() does NOT credit contributions (only receiveContribution does); this exercises
        // that path to confirm accumulator weights track ONLY genuine contributions.
        amount = bound(amount, 0.01 ether, 10 ether);
        address actor = _getActor(actorSeed);

        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        (bool ok,) = address(vault).call{ value: amount }("");
        require(ok, "send failed");
        // Intentionally NOT tracked as a contribution — bare receive is spendable dust, not weight.
    }

    /// @dev Ensure the vault holds its single alignment LP position (tokenId 1). Uses the Testable subclass
    ///      hook + the mock position manager, mirroring the unit test's `_stageHarvest` — NOT a src change.
    function _ensurePosition() internal {
        if (ghost_positionSet) return;
        // tokenIsZero = true: position ordered (alignmentToken, weth); weth is the fee leg we stage.
        vault.setPositionForTest(1, refPool, true);
        positionManager.setPosition(1, address(alignmentToken), address(weth), address(vault));
        ghost_positionSet = true;
    }

    /// @dev Accrue fees to the accumulator. Stage WETH-only fees on the position (no target->WETH swap leg,
    ///      so no reference-floor dependence), then harvest: collect → withdraw WETH to ETH → distribute.
    function harvest(uint256 feeSeed) external {
        if (vault.totalContributions() == 0) return;
        _ensurePosition();

        uint256 wethFees = bound(feeSeed, 0.001 ether, 5 ether);

        // Stage collectable WETH fees on the vault's position and back them with real ETH in the WETH mock
        // so the vault's `weth.withdraw` during harvest can pay out.
        weth.mint(address(positionManager), wethFees);
        positionManager.setFees(1, 0, wethFees);
        vm.deal(address(weth), address(weth).balance + wethFees);

        uint256 accBefore = vault.accRewardPerContribution();
        uint256 feesBefore = vault.accumulatedFees();

        vault.harvest(0);

        // The benefactor portion actually recorded into the accumulator this harvest.
        ghost_feesRecorded += vault.accumulatedFees() - feesBefore;
        ghost_harvests++;

        uint256 accAfter = vault.accRewardPerContribution();
        require(accAfter >= accBefore, "accumulator decreased");
        if (accAfter > ghost_maxAcc) ghost_maxAcc = accAfter;
    }

    function claimFees(uint256 actorSeed) external {
        address actor = _getActor(actorSeed);
        if (vault.benefactorContribution(actor) == 0) return;

        uint256 claimable = vault.calculateClaimableAmount(actor);
        if (claimable == 0) return;

        vm.prank(actor);
        uint256 claimed = vault.claimFees();
        ghost_totalClaimed += claimed;
    }

    function withdrawProtocolFees() external {
        if (vault.accumulatedProtocolFees() == 0) return;
        vm.prank(treasury);
        vault.withdrawProtocolFees();
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}
