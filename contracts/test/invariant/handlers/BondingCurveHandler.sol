// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";

/// @notice Invariant handler for ERC404BondingInstance bonding curve reserve accounting.
/// @dev noesis-152 added the Token Tiers legs (`mintUp` / `mintDown` / `claimReleasedEscrow`) so the
///      fuzzer can INTERLEAVE tier ops with curve ops. Before that, every curve invariant in
///      `BondingCurveInvariant.t.sol` had only ever been evaluated on a tier-free instance: the two
///      shipped tier suites are bounded single-purpose loops that never return to the curve once tier
///      ops begin, and this — the only stateful, multi-actor, fuzzer-sequenced suite over this
///      contract — never sealed a ladder at all.
///
///      HOUSE STYLE, kept from the original two legs: a guard miss `return`s instead of reverting, so
///      the fuzzer keeps its sequence instead of having the call discarded.
///
///      HANDLER-SIDE ASSERTIONS ARE COUNTERS, NOT `assert*`. The suite runs with
///      `invariant.fail_on_revert = false` (foundry default), so a revert inside a handler call — which
///      is what a failed `assertEq` is — would be SWALLOWED by the runner and the check would be
///      vacuous. Every in-call observation below is therefore recorded in a `ghost_*` counter that a
///      real `invariant_*` function asserts on.
contract BondingCurveHandler is Test {
    ERC404BondingInstance public instance;
    BondingCurveMath.Params public curveParams;

    address[] public actors;
    mapping(address => bool) public isActor;

    /// @dev Number of sealed tier bands (`tierBands.length`). The array has a public element getter but
    ///      no public length getter, so the count is handed in at construction; `setUp` asserts it
    ///      against the sealed ladder, so it cannot drift from the instance.
    uint256 public immutable tierCount;

    /// @dev Ceiling on the ordinary-id scan in `mintUp`. Not a correctness bound — a miss only costs one
    ///      `mintUp` opportunity — but it bounds the worst-case cost of a handler call. DN404 issues ids
    ///      ascending from 1 and refills freed low ids first (`_findFirstUnset`), so in practice the
    ///      actors' holdings live at the bottom of the space and the scan exits in a few probes.
    uint256 internal constant ORDINARY_ID_PROBE_BUDGET = 1000;

    /// @dev How many of the actor's own ids `mintUp` will try before giving up on the call.
    ///
    ///      THIS IS WHAT MAKES THE LEG NON-VACUOUS, and the number is load-bearing. `mintUp`'s escrow leg
    ///      burns the caller's NFTs LIFO off the TAIL of `owned`, so exactly `w - 1` of their ids are
    ///      unusable as `tierZeroId` and an id caught by that burn reverts the whole call. Trying MORE
    ///      than `w - 1` distinct ids therefore guarantees at least one candidate is in the surviving
    ///      prefix: for the bottom rung (`w = 10`) affordability alone — the caller holds `w` units, hence
    ///      `w` ids — now IMPLIES success, with no dependence on where in the array the ids sit. A single
    ///      candidate (the previous shape) instead made the leg fail whenever churn had moved the actor's
    ///      lowest id into the tail, and a whole 256-run campaign then contained runs with zero tier ops.
    uint256 internal constant MINTUP_ATTEMPT_CAP = 32;

    /// @dev Ceiling on how many AFFORDABLE (actor, tier) pairs one `mintUp` call will try before giving
    ///      up. Bounds the worst-case cost of a call; the bottom rung's affordability-implies-success
    ///      property means a landing pair, if one exists, is normally the first.
    uint256 internal constant MINTUP_PAIR_CAP = 2;

    // ── Ghost variables ──────────────────────────────────────────────────────────────────────────
    /// @dev Every handler entry, guard-missed or not. Read by the suite's non-vacuity gate to tell a run
    ///      the fuzzer actually COMPLETED from a shrunk replay of a persisted failure (forge re-runs those
    ///      minimized sequences — often a single call — before fuzzing).
    uint256 public ghost_calls;

    uint256 public ghost_totalBuyCost;
    uint256 public ghost_totalSellRefund;
    uint256 public ghost_buyCount;
    uint256 public ghost_sellCount;

    /// @dev CURVE ISOLATION, accumulated from the buy/sell legs ONLY. `reserve` and
    ///      `totalBondingSupply` must equal these at all times, whatever tier ops ran in between. They
    ///      are accumulated from the handler's own pre-computed cost/refund and its own bounded amount —
    ///      never re-derived from the contract — so the assertion is independent of the code under test.
    uint256 public ghost_expectedReserve;
    uint256 public ghost_expectedBondingSupply;

    // Token Tiers activity counters. `ghost_tierOpCount` is the non-vacuity spine: a completed fuzz run
    // that never landed a single tier op has tested nothing this item exists to test.
    uint256 public ghost_mintUpCount;
    uint256 public ghost_mintDownCount;
    uint256 public ghost_claimCount;
    uint256 public ghost_tierOpCount;
    /// @dev Sells that burned at least one band NFT off the tail of `owned` and left a pending claim —
    ///      the T3 hook firing in the middle of DN404's reconciliation, mid-sequence.
    uint256 public ghost_burnReleaseCount;

    /// @dev A tier op that moved `reserve` or `totalBondingSupply`. MUST stay 0: tier ops are an in-place
    ///      id swap plus an escrow `_transfer`, and touch neither counter. Non-zero = the curve is
    ///      reachable from the tier surface, i.e. escrow can be minted out of, or paid for by, the curve.
    uint256 public ghost_curvePerturbedByTierOp;

    /// @dev A `mintDown` that failed AFTER the handler confirmed the caller owns that band id, or a
    ///      `claimReleasedEscrow` that failed AFTER the handler read a non-zero credit. Both MUST stay 0:
    ///      they are the reachability of `EscrowReleaseFailed` / a stuck redemption, i.e. a holder who
    ///      cannot get their escrowed coin back. Counted rather than asserted in-call for the reason in
    ///      the contract doc above.
    uint256 public ghost_mintDownFailures;
    uint256 public ghost_claimFailures;

    /// @dev `mintUp` rejections. EXPECTED and not a defect: the escrow leg burns the caller's NFTs LIFO
    ///      off the tail of `owned`, and an id caught by that burn reverts the whole call (a clean revert
    ///      with no state change, by design). Tracked only so a run's mintUp hit rate is legible.
    uint256 public ghost_mintUpRejections;

    constructor(
        ERC404BondingInstance _instance,
        BondingCurveMath.Params memory _curveParams,
        address[] memory _actors,
        uint256 _tierCount
    ) {
        instance = _instance;
        curveParams = _curveParams;
        tierCount = _tierCount;
        for (uint256 i = 0; i < _actors.length; i++) {
            actors.push(_actors[i]);
            isActor[_actors[i]] = true;
        }
    }

    function _getActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // ┌─────────────────────────┐
    // │   Curve legs            │
    // └─────────────────────────┘

    function buy(uint256 actorSeed, uint256 amount) external {
        ghost_calls++;
        address actor = _getActor(actorSeed);

        uint256 unit_ = instance.unit();
        // Bound to at least 1 NFT worth, at most 5 NFTs worth
        amount = bound(amount, unit_, 5 * unit_);

        uint256 maxBondingSupply =
            instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * unit_);
        uint256 currentSupply = instance.totalBondingSupply();

        // Skip if would exceed bonding cap
        if (currentSupply + amount > maxBondingSupply) return;

        uint256 cost = BondingCurveMath.calculateCost(curveParams, currentSupply, amount);
        if (cost == 0) return;

        uint256 bondingFee = (cost * instance.bondingFeeBps()) / 10000;
        uint256 totalWithFee = cost + bondingFee;

        vm.deal(actor, actor.balance + totalWithFee);
        vm.prank(actor);
        instance.buyBonding{ value: totalWithFee }(amount, totalWithFee, false, bytes(""), "", 0);

        ghost_totalBuyCost += cost;
        ghost_buyCount++;
        ghost_expectedReserve += cost;
        ghost_expectedBondingSupply += amount;
    }

    function sell(uint256 actorSeed, uint256 nftCount) external {
        ghost_calls++;
        address actor = _getActor(actorSeed);

        uint256 unit_ = instance.unit();
        uint256 balance = instance.balanceOf(actor);
        if (balance < unit_) return;

        // Bound NFT count between 1 and what actor holds
        uint256 maxNfts = balance / unit_;
        nftCount = bound(nftCount, 1, maxNfts);
        uint256 amount = nftCount * unit_;

        // Don't sell if bonding is capped (the contract reverts)
        uint256 maxBondingSupply =
            instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * unit_);
        if (instance.totalBondingSupply() >= maxBondingSupply) return;

        uint256 refund = BondingCurveMath.calculateRefund(curveParams, instance.totalBondingSupply(), amount);
        if (refund == 0 || instance.reserve() < refund) return;

        // A seller who holds a band NFT can have it burned by THIS call: the curve takes no NFTs, so
        // DN404 reconciles the debit by burning ids LIFO off the tail of `owned[actor]`, and the T3
        // `_afterNFTTransfers` hook credits the escrow behind any band caught in that burn. Nothing
        // anywhere else drives that path inside a SEQUENCE.
        uint256 pendingBefore = instance.totalPendingEscrowRelease();

        vm.prank(actor);
        instance.sellBonding(amount, 0, bytes32(0), "", 0);

        if (instance.totalPendingEscrowRelease() > pendingBefore) ghost_burnReleaseCount++;

        ghost_totalSellRefund += refund;
        ghost_sellCount++;
        // `reserve` is debited by the GROSS refund (the fee is split out of it and paid in ETH to the
        // treasury, which is why `reserve == address(this).balance` survives), so the ghost tracks gross.
        ghost_expectedReserve -= refund;
        ghost_expectedBondingSupply -= amount;
    }

    // ┌─────────────────────────┐
    // │   Token Tiers legs      │
    // └─────────────────────────┘

    /// @notice Convert `w_N` units of an actor's holdings into one tier-N band NFT.
    /// @dev The (actor, tier) pair is chosen by SEED PREFERENCE, then rotated to the first pair the live
    ///      state can actually afford. A blind pick spends the call whenever the chosen actor cannot reach
    ///      the chosen rung — the top rung costs its full weight in units and is affordable only
    ///      occasionally — and measured campaigns then contained whole 500-call runs with ZERO landed tier
    ///      ops while the fixture was perfectly capable of one. The seed still decides WHICH affordable
    ///      pair is taken (it sets where the rotation starts); it no longer decides whether the call does
    ///      anything at all. The id walk itself is in `_tryMintUp`.
    function mintUp(uint256 actorSeed, uint256 tierSeed) external {
        ghost_calls++;
        if (tierCount == 0) return;

        uint256 unit_ = instance.unit();
        uint256 actorStart = actorSeed % actors.length;
        uint256 tierStart = bound(tierSeed, 0, tierCount - 1);

        uint256 pairsTried;
        for (uint256 ai = 0; ai < actors.length; ai++) {
            address actor = actors[(actorStart + ai) % actors.length];
            for (uint256 ti = 0; ti < tierCount; ti++) {
                uint256 idx = (tierStart + ti) % tierCount;
                (,, uint32 weight) = instance.tierBands(idx);
                // `w` units are needed, not `w - 1`: the escrow leg moves `(w - 1) * unit` out (burning
                // that many NFTs off the tail) and one unit must remain to carry the band id.
                if (instance.balanceOf(actor) < uint256(weight) * unit_) continue;
                if (_tryMintUp(actor, idx, unit_)) return;
                ghost_mintUpRejections++;
                if (++pairsTried == MINTUP_PAIR_CAP) return;
            }
        }
    }

    /// @dev One (actor, tier) attempt: walk the actor's own ids from the lowest upward and stop at the
    ///      first that lands. See `MINTUP_ATTEMPT_CAP` — trying more than `w - 1` distinct ids is what
    ///      makes affordability at the bottom rung imply success. A rejected attempt reverts atomically
    ///      and changes nothing, so the next candidate is read against identical state.
    function _tryMintUp(address actor, uint256 idx, uint256 unit_) internal returns (bool) {
        uint256 idLimit = instance.maxSupply() / unit_;
        uint256 budget = idLimit < ORDINARY_ID_PROBE_BUDGET ? idLimit : ORDINARY_ID_PROBE_BUDGET;
        uint256 reserveBefore = instance.reserve();
        uint256 supplyBefore = instance.totalBondingSupply();

        uint256 attempts;
        for (uint256 id = 1; id <= budget && attempts < MINTUP_ATTEMPT_CAP; id++) {
            if (_ownerOrZero(id) != actor) continue;
            attempts++;
            vm.prank(actor);
            // Low-level call: a guard miss must not revert the fuzzer's sequence. The instance trampoline
            // collapses every Ops-side revert into the generic `TierOpFailed()` anyway (noesis-091).
            (bool ok,) = address(instance).call(abi.encodeWithSignature("mintUp(uint8,uint256)", uint8(idx + 1), id));
            if (!ok) continue;

            _recordCurveDelta(reserveBefore, supplyBefore);
            ghost_mintUpCount++;
            ghost_tierOpCount++;
            return true;
        }
        return false;
    }

    /// @notice Turn an actor's band NFT back into an ordinary NFT and release its escrow.
    /// @dev The candidate band id is resolved LIVE from on-chain ownership, never from a handler-side
    ///      mirror: a band NFT can be burned out from under its holder by any ordinary debit, and a
    ///      stale mirror would then feed `mintDown` an id nobody owns — every call would early-return
    ///      and this leg would go quietly vacuous.
    function mintDown(uint256 actorSeed, uint256 bandSeed) external {
        ghost_calls++;
        if (tierCount == 0) return;
        // Seed preference, then fall back to whichever actor actually holds a band — same reasoning as
        // `mintUp`: only the fuzzer's PREFERENCE should be blind, not whether the leg ever runs.
        (address actor, uint256 bandId) = _bandHeldByAnyActor(actors[actorSeed % actors.length], bandSeed);
        if (bandId == 0) return;

        uint256 reserveBefore = instance.reserve();
        uint256 supplyBefore = instance.totalBondingSupply();

        vm.prank(actor);
        (bool ok,) = address(instance).call(abi.encodeWithSignature("mintDown(uint256)", bandId));
        if (!ok) {
            // The caller demonstrably owns this band id and the ladder is sealed, so there is no
            // legitimate rejection left: a failure here is a holder who cannot redeem their own escrow.
            ghost_mintDownFailures++;
            return;
        }

        _recordCurveDelta(reserveBefore, supplyBefore);
        ghost_mintDownCount++;
        ghost_tierOpCount++;
    }

    /// @notice Pull the escrow credited when DN404 burned a band NFT the actor owned.
    /// @dev The PULL leg of the T3 hook. `TierBurnSafety` covers it per-call; nothing covered it inside a
    ///      fuzzer-driven sequence, where the credit is created by an ordinary curve `sell` and then has
    ///      to survive whatever runs before the claim.
    function claimReleasedEscrow(uint256 actorSeed) external {
        ghost_calls++;
        // Seed preference, then rotate to whichever actor actually has a credit.
        address actor;
        uint256 actorStart = actorSeed % actors.length;
        for (uint256 ai = 0; ai < actors.length; ai++) {
            actor = actors[(actorStart + ai) % actors.length];
            if (instance.pendingEscrowRelease(actor) != 0) break;
            if (ai + 1 == actors.length) return;
        }

        uint256 reserveBefore = instance.reserve();
        uint256 supplyBefore = instance.totalBondingSupply();

        vm.prank(actor);
        (bool ok,) = address(instance).call(abi.encodeWithSignature("claimReleasedEscrow()"));
        if (!ok) {
            // A non-zero credit was read one call earlier and this handler never reenters, so neither
            // `NothingToClaim` nor the reentrancy guard can be the cause. What is left is the solvency
            // revert (`EscrowReleaseFailed`) — the coin that `mintUp` escrowed is not in the instance's
            // balance any more, and the holder cannot be paid.
            ghost_claimFailures++;
            return;
        }

        _recordCurveDelta(reserveBefore, supplyBefore);
        ghost_claimCount++;
        ghost_tierOpCount++;
    }

    // ┌─────────────────────────┐
    // │   Internals             │
    // └─────────────────────────┘

    /// @dev Record (never assert — see the contract doc) whether a tier op moved the curve counters.
    function _recordCurveDelta(uint256 reserveBefore, uint256 supplyBefore) internal {
        if (instance.reserve() != reserveBefore || instance.totalBondingSupply() != supplyBefore) {
            ghost_curvePerturbedByTierOp++;
        }
    }

    function _ownerOrZero(uint256 id) internal view returns (address who) {
        try instance.ownerOf(id) returns (address o) {
            who = o;
        } catch {
            who = address(0);
        }
    }

    /// @dev A live band id held by `preferred` if it holds one, else by any actor. Ownership is read
    ///      on-chain, never from a handler-side mirror: a band NFT can be burned out from under its holder
    ///      by any ordinary debit, and a stale mirror would then feed `mintDown` an id nobody owns — every
    ///      call would early-return and this leg would go quietly vacuous.
    /// @dev ONE pass over the band space, resolving the preferred and the fallback answer together. Only
    ///      the ISSUED window of each band is walked (`[idStart, bandNextFree)`) — ids at or above the
    ///      high-water cursor were never handed out, so nobody can hold one. The tier the walk starts at is
    ///      seed-derived so both rungs of the ladder get exercised.
    function _bandHeldByAnyActor(address preferred, uint256 seed)
        internal
        view
        returns (address holder, uint256 bandId)
    {
        uint256 start = seed % tierCount;
        for (uint256 i = 0; i < tierCount; i++) {
            uint256 idx = (start + i) % tierCount;
            (uint32 idStart,,) = instance.tierBands(idx);
            uint256 cursor = instance.bandNextFree(idx);
            for (uint256 id = idStart; id < cursor; id++) {
                address who = _ownerOrZero(id);
                if (who == address(0) || !isActor[who]) continue;
                if (who == preferred) return (who, id);
                if (bandId == 0) (holder, bandId) = (who, id);
            }
        }
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }
}
