// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UniAlignmentVault } from "../../../src/vaults/uni/UniAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../../helpers/TestableUniAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @notice Invariant handler for UniAlignmentVault share accounting
contract UniVaultHandler is Test {
    TestableUniAlignmentVault public vault;

    address[] public actors;
    mapping(address => bool) public isActor;

    // Ghost variables for tracking
    uint256 public ghost_totalContributed;
    mapping(address => uint256) public ghost_actorContributed;
    uint256 public ghost_totalClaimed;
    bool public ghost_hasLP;
    uint256 public ghost_conversions;
    // Snapshot shares at each conversion to track dilution
    mapping(address => uint256) public ghost_sharesSnapshot;
    mapping(address => uint256) public ghost_ethAtConversion;

    constructor(TestableUniAlignmentVault _vault, address[] memory _actors) {
        vault = _vault;
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
    }

    function contributeViaReceive(uint256 actorSeed, uint256 amount) external {
        amount = bound(amount, 0.01 ether, 10 ether);
        address actor = _getActor(actorSeed);

        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        (bool ok,) = address(vault).call{ value: amount }("");
        require(ok, "send failed");

        ghost_totalContributed += amount;
        ghost_actorContributed[actor] += amount;
    }

    function convertAndAddLiquidity() external {
        if (vault.totalPendingETH() == 0) return;

        // Snapshot pre-conversion shares AND the pending ETH each actor brought to THIS batch. The
        // pending side matters: the convert zeroes it, so it cannot be read back afterwards, and it is
        // the only figure the batch's share split is actually proportional to.
        uint256[] memory preShares = new uint256[](actors.length);
        uint256[] memory prePending = new uint256[](actors.length);
        for (uint256 i = 0; i < actors.length; i++) {
            preShares[i] = vault.benefactorShares(actors[i]);
            prePending[i] = vault.pendingETH(actors[i]);
        }
        uint256 preTotalShares = vault.totalShares();

        vault.convertAndAddLiquidity(1);
        ghost_convertsLanded++;
        if (vault.totalPendingETH() > 0) ghost_convertsWithResidual++;
        ghost_hasLP = true;
        ghost_conversions++;

        // Track new shares issued this conversion per actor
        uint256 newTotalShares = vault.totalShares() - preTotalShares;
        if (newTotalShares > 0) {
            uint256[] memory gained = new uint256[](actors.length);
            for (uint256 i = 0; i < actors.length; i++) {
                gained[i] = vault.benefactorShares(actors[i]) - preShares[i];
                ghost_sharesSnapshot[actors[i]] += gained[i];
            }
            _recordDilutionOrdering(prePending, gained);
        }
    }

    /// @dev Within ONE conversion the split is a single proportion of one liquidity mint, so more ETH
    ///      into this batch must never buy fewer shares out of it. That is the dilution property that
    ///      actually holds. It is recorded per batch rather than read off cumulative totals because
    ///      shares are LP UNITS, and the LP minted per ETH differs from batch to batch — so a holder who
    ///      contributed more ETH across their lifetime can legitimately hold fewer shares than someone
    ///      who contributed less into a batch that minted more liquidity.
    function _recordDilutionOrdering(uint256[] memory prePending, uint256[] memory gained) internal {
        for (uint256 i = 0; i < actors.length; i++) {
            for (uint256 j = 0; j < actors.length; j++) {
                if (i == j) continue;
                if (prePending[i] < prePending[j]) continue;
                // i put in at least as much as j, so i must come out with at least as much, up to the
                // one-unit round-down each of the two divisions in the split can cost.
                if (gained[j] > gained[i] && gained[j] - gained[i] > 1) {
                    ghost_dilutionInversions++;
                }
            }
        }
    }

    /// @dev Count of converts that actually landed. Asserted non-zero by the suite: this handler's
    ///      `convertAndAddLiquidity` reverted on EVERY call until the reference pool was wired, so every
    ///      invariant that only holds interestingly after a conversion was passing on an empty path.
    uint256 public ghost_convertsLanded;
    /// @dev Count of within-batch orderings where more ETH in bought fewer shares out. Must stay 0.
    uint256 public ghost_dilutionInversions;

    /// @dev Count of converts that left a residual behind. Also asserted non-zero: a run in which the
    ///      mock pool always absorbed the whole ETH leg cannot observe the carry-forward at all.
    uint256 public ghost_convertsWithResidual;

    /// @dev Let the fuzzer choose how much of the ETH leg the mock pool refuses to absorb, so the
    ///      conversion residual is a value the run varies rather than a structural zero. Without this the
    ///      harness reported the whole ETH leg as deposited on every convert, `ethUnabsorbed` was always
    ///      0, and `invariant_pendingSumConsistency` could not observe the case it exists to catch
    ///      (audit M-2). Capped well under 10_000 so every convert still deploys the bulk of the leg.
    function setUnabsorbed(uint256 bps) external {
        vault.setLpUnabsorbedBps(bound(bps, 0, 2_000));
    }

    /// @dev Fee accrual via the test-only seam (production accrual needs a live V4 PoolManager).
    function accrueFees(uint256 amount) external {
        amount = bound(amount, 0.001 ether, 1 ether);
        if (vault.totalShares() == 0) return;

        vm.deal(address(this), address(this).balance + amount);
        vault.simulateFeeAccrual{ value: amount }(amount);
    }

    function claimFees(uint256 actorSeed) external {
        address actor = _getActor(actorSeed);
        if (vault.benefactorShares(actor) == 0) return;
        if (vault.accumulatedFees() == 0) return;

        uint256 currentShareValue = (vault.accumulatedFees() * vault.benefactorShares(actor)) / vault.totalShares();
        uint256 ethClaimed = currentShareValue > vault.shareValueAtLastClaim(actor)
            ? currentShareValue - vault.shareValueAtLastClaim(actor)
            : 0;
        if (ethClaimed == 0) return;

        vm.prank(actor);
        uint256 claimed = vault.claimFees();
        ghost_totalClaimed += claimed;
    }

    function withdrawProtocolFees() external {
        if (vault.accumulatedProtocolFees() == 0) return;
        if (vault.protocolTreasury() == address(0)) return;

        vault.withdrawProtocolFees();
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}
