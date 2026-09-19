// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";

/**
 * @title FreeMintCurveHandler
 * @notice Invariant handler for `ERC404BondingInstance` with a free-mint allocation ON.
 *
 * @dev TWO DISJOINT WALLET SETS, and the split is the whole point of this handler. `traders` buy and
 *      sell; `claimants` claim free and sell, and the buy leg will never select one. So every sell by a
 *      claimant is UNAMBIGUOUSLY a sale of coin that entered circulation without paying the curve —
 *      no per-wallet cost basis has to be reconstructed to know it, and the suite's non-vacuity gate can
 *      be an exact count rather than an inference.
 *
 *      HOUSE STYLE, taken from `BondingCurveHandler`: a guard miss `return`s instead of reverting, so
 *      the fuzzer keeps its sequence instead of having the call discarded; and every in-call observation
 *      is recorded in a `ghost_*` counter that a real `invariant_*` asserts on, because the suite runs
 *      with `invariant.fail_on_revert = false` and a reverting `assert*` inside a handler call would be
 *      swallowed by the runner.
 */
contract FreeMintCurveHandler is Test {
    ERC404BondingInstance public instance;
    BondingCurveMath.Params public curveParams;

    address[] public traders;
    address[] public claimants;

    // ── Ghost variables ──────────────────────────────────────────────────────────────────────────
    /// @dev Every handler entry, guard-missed or not. Read by the non-vacuity gate to tell a completed
    ///      fuzz run from a shrunk replay of a persisted failure, which forge re-runs ahead of fuzzing.
    uint256 public ghost_calls;

    uint256 public ghost_buyCount;
    uint256 public ghost_sellCount;

    /// @dev CURVE ISOLATION, accumulated from the buy/sell legs ONLY — never from a free claim, and
    ///      never re-read from the contract. `reserve` and `totalBondingSupply` must equal these at all
    ///      times, which is the statement that a free claim is not a curve event.
    uint256 public ghost_expectedReserve;
    uint256 public ghost_expectedBondingSupply;

    /// @dev Free claims that landed. The allocation is finite, so this tops out at `freeMintAllocation`.
    uint256 public ghost_claimCount;

    /// @dev Claims REFUSED after this handler had already read every precondition live off the instance
    ///      (allocation non-zero, not graduated, open, this wallet has not claimed, allocation not
    ///      exhausted, no gating module). MUST stay 0: it is the reachability of a wallet that is
    ///      entitled to a free mint and cannot take it.
    uint256 public ghost_claimFailures;

    /// @dev Claims correctly refused because the allocation was spent. Not a defect — tracked so the
    ///      suite can assert the exhaustion edge was actually reached rather than assumed.
    uint256 public ghost_exhaustedRefusals;

    /// @dev Sells by a CLAIMANT: free coin going back into the curve. The non-vacuity spine — a run
    ///      that never landed one has tested the allocation's existence and not its effect.
    uint256 public ghost_freeCoinSellCount;

    /// @dev Gross reserve debited by those sells, in wei. Not asserted against a bound: it is the drain
    ///      `FreeMintReserveDrainTest` measures, reported here so a run says how far it actually pushed.
    uint256 public ghost_reserveDrainedByFreeCoin;

    /// @dev Tokens handed out by free claims, from this handler's own count rather than the contract's.
    uint256 public ghost_freeTokensClaimed;

    constructor(
        ERC404BondingInstance _instance,
        BondingCurveMath.Params memory _curveParams,
        address[] memory _traders,
        address[] memory _claimants
    ) {
        instance = _instance;
        curveParams = _curveParams;
        for (uint256 i = 0; i < _traders.length; i++) {
            traders.push(_traders[i]);
        }
        for (uint256 i = 0; i < _claimants.length; i++) {
            claimants.push(_claimants[i]);
        }
    }

    function tradersLength() external view returns (uint256) {
        return traders.length;
    }

    function claimantsLength() external view returns (uint256) {
        return claimants.length;
    }

    /// @dev The cap the instance itself enforces on both trade paths, re-derived here from live reads so
    ///      the handler's guard and the contract's check cannot drift apart.
    function _maxBondingSupply() internal view returns (uint256) {
        return instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * instance.unit());
    }

    // ┌─────────────────────────┐
    // │   Curve legs            │
    // └─────────────────────────┘

    /// @notice A paid buy, by a TRADER only.
    function buy(uint256 actorSeed, uint256 amount) public {
        ghost_calls++;
        address actor = traders[actorSeed % traders.length];

        uint256 unit_ = instance.unit();
        amount = bound(amount, unit_, 5 * unit_);

        uint256 currentSupply = instance.totalBondingSupply();
        if (currentSupply + amount > _maxBondingSupply()) return;

        uint256 cost = BondingCurveMath.calculateCost(curveParams, currentSupply, amount);
        if (cost == 0) return;

        // No buy-side fee on the shipped path (`buyBonding`: the protocol fee is taken on exit only), so
        // the call is funded with exactly the cost.
        vm.deal(actor, actor.balance + cost);
        vm.prank(actor);
        instance.buyBonding{ value: cost }(amount, cost, false, bytes(""), "", 0);

        ghost_buyCount++;
        ghost_expectedReserve += cost;
        ghost_expectedBondingSupply += amount;
    }

    /// @notice A sell by a TRADER — coin that paid the curve on the way in.
    function sell(uint256 actorSeed, uint256 nftCount) external {
        ghost_calls++;
        _sell(traders[actorSeed % traders.length], nftCount, false);
    }

    /// @notice A sell by a CLAIMANT — coin that did NOT pay the curve on the way in. This is the leg the
    ///         suite exists for: it debits the reserve for the integral at the top of the curve against
    ///         a position the seller was handed, so if either solvency invariant can be broken by the
    ///         allocation, it is broken here.
    function sellFreeCoin(uint256 actorSeed, uint256 nftCount) external {
        ghost_calls++;
        _sell(claimants[actorSeed % claimants.length], nftCount, true);
    }

    function _sell(address actor, uint256 nftCount, bool isFreeCoin) internal {
        uint256 unit_ = instance.unit();
        uint256 balance = instance.balanceOf(actor);
        if (balance < unit_) return;

        uint256 supply = instance.totalBondingSupply();
        // `calculateRefund` reverts `AmountExceedsSupply` rather than integrating below zero, so a
        // claimant can never sell into a span paid buyers have not funded. Bounding by the live supply
        // keeps that a GUARD here rather than a discarded call — the revert itself is asserted in
        // `FreeMintReserveDrainTest`.
        uint256 maxNfts = balance / unit_;
        uint256 supplyNfts = supply / unit_;
        if (supplyNfts == 0) return;
        if (maxNfts > supplyNfts) maxNfts = supplyNfts;
        nftCount = bound(nftCount, 1, maxNfts);
        uint256 amount = nftCount * unit_;

        if (supply >= _maxBondingSupply()) return; // the contract reverts ExceedsBonding at the cap

        uint256 refund = BondingCurveMath.calculateRefund(curveParams, supply, amount);
        if (refund == 0 || instance.reserve() < refund) return;

        vm.prank(actor);
        instance.sellBonding(amount, 0, bytes32(0), "", 0);

        ghost_sellCount++;
        // `reserve` is debited by the GROSS refund — the exit fee is split out of it and paid in ETH to
        // the treasury, which is why `reserve == address(this).balance` survives — so the ghost tracks
        // gross on both legs.
        ghost_expectedReserve -= refund;
        ghost_expectedBondingSupply -= amount;
        if (isFreeCoin) {
            ghost_freeCoinSellCount++;
            ghost_reserveDrainedByFreeCoin += refund;
        }
    }

    // ┌─────────────────────────┐
    // │   Free-mint leg         │
    // └─────────────────────────┘

    /// @notice Claim one free mint, by a CLAIMANT. Every precondition is read live before the call, so a
    ///         refusal that is not `FreeMintExhausted` is counted as a failure rather than shrugged off.
    function claimFree(uint256 actorSeed) public {
        ghost_calls++;
        address actor = claimants[actorSeed % claimants.length];

        if (instance.freeMintAllocation() == 0) return;
        if (instance.graduated()) return;
        if (instance.freeMintClaimed(actor)) return;
        if (instance.freeMintsClaimed() >= instance.freeMintAllocation()) {
            // The exhaustion edge, confirmed by the contract rather than only by the counter above.
            vm.prank(actor);
            try instance.claimFreeMint(bytes("")) {
                ghost_claimFailures++; // claimed PAST the allocation — an oversubscription
            } catch {
                ghost_exhaustedRefusals++;
            }
            return;
        }

        uint256 unit_ = instance.unit();
        vm.prank(actor);
        try instance.claimFreeMint(bytes("")) {
            ghost_claimCount++;
            ghost_freeTokensClaimed += unit_;
        } catch {
            ghost_claimFailures++;
        }
    }
}
