// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ERC404BondingStorage,
    IStakingTotals,
    InsufficientTokenBalance,
    TokenAmountMustBePositive,
    TokenAmountMustRepresentNFT,
    BalanceMismatchAfterReroll,
    TiersNotConfigured,
    InvalidBand,
    BandExhausted,
    NotBandId,
    NotTierZeroId,
    TierOpFailed,
    BondingEnded,
    BondingNotConfigured,
    TooEarly,
    GatingNotAllowed,
    FreeMintDisabled,
    FreeMintAlreadyClaimed,
    FreeMintExhausted,
    StakingModuleNotSet,
    NothingToWithdraw,
    WithdrawFailed,
    OnlyFactory,
    NotInitialized,
    AlreadyInitialized,
    InvalidOwner,
    InvalidGlobalMessageRegistry,
    ModuleAlreadySet,
    TimeMustBeInFuture,
    OpenTimeMustBeSetFirst,
    MaturityMustBeAfterOpenTime,
    OpenTimeNotSet,
    CannotActivateAfterLiquidityDeployed,
    StakingAlreadyActive,
    AlreadyDeployed,
    NoReserve,
    NothingForPool
} from "./ERC404BondingStorage.sol";
// Interface-only import (no bytecode, no storage): `ICarveParamsSource` is declared alongside the
// instance because that file is what the app's binding generator globs. See the note there.
import { ICarveParamsSource } from "./ERC404BondingInstance.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IGlobalMessageRegistry } from "../../registry/interfaces/IGlobalMessageRegistry.sol";
import { IERC404StakingModule } from "../../interfaces/IERC404StakingModule.sol";
import {
    IInstanceLifecycle,
    STATE_BONDING,
    STATE_PAUSED,
    STATE_GRADUATED
} from "../../interfaces/IInstanceLifecycle.sol";
import { GatingScope } from "../../gating/IGatingModule.sol";

/**
 * @title ERC404BondingOps
 * @notice Externalized bodies for `ERC404BondingInstance` (EIP-170 diet — noesis-091 for reroll,
 *         noesis-142 for the tier ops, noesis-148 for the six value-path functions, noesis-149 for the
 *         thirteen init/admin/setter config functions). This contract is
 *         NEVER deployed as a token nor called directly: the master instance reaches every function here
 *         via a discard-returndata `delegatecall`, so each body executes in the instance's own storage
 *         context. It inherits the identical `ERC404BondingStorage` base as the instance, so the
 *         storage layout is byte-identical (CI-gated) and the shared DN404 `$` / Ownable owner /
 *         ReentrancyGuard slots resolve to the same fixed hashed slots across the delegatecall boundary.
 * @dev    HARD CONSTRAINT: Ops declares ZERO storage of its own outside the inherited base. Adding any
 *         state variable here is a storage-collision bug — put new state in `ERC404BondingStorage`.
 *         `_ops` immutable is deliberately NOT here: immutables live in code, not storage.
 * @dev    `msg.sender` and `msg.value` are preserved across `delegatecall`, so `onlyOwner` (Ownable's
 *         shared slot) and every staker-keyed module call resolve exactly as they did in the instance.
 */
contract ERC404BondingOps is ERC404BondingStorage {
    // ┌─────────────────────────┐
    // │   Reroll (delegatecall) │
    // └─────────────────────────┘

    /// @notice Reroll body, moved verbatim from the instance. Keeps `nonReentrant`: the guard uses the
    ///         shared fixed slot, so it engages in the instance's context under delegatecall. No owner
    ///         gate (matches the instance's historic access exactly).
    /// @dev    REROLL NEVER DISSOLVES A TIER NFT. The coin round trip below is a debit like any other,
    ///         so an unexempted band id sitting in the burned range of the outward leg is destroyed and
    ///         its denomination converted to a `pendingEscrowRelease` claim by the T3 hook. That is the
    ///         one destruction the holder did not aim at — every other one (spend, sell, stake) is a
    ///         deliberate move of coin — so the protection is in the contract rather than in a caller:
    ///         `_effectiveExemptions` appends every band id the caller owns to the supplied list, and
    ///         the whole body reads that combined list. No caller — this project's app, a third party,
    ///         or a direct contract call — can reroll a band away. Deliberate dissolution remains
    ///         available through `mintDown`, which returns the escrow as spendable coin first.
    /// @param  tokenAmount How much of the caller's position goes through the shuffle. A protected band
    ///         NFT is one unit of that position and consumes one unit of this budget, exactly as an
    ///         explicitly exempted id always has: a holder of one band plus three ordinary ids passing
    ///         `3 * unit` rerolls two ordinary ids and keeps the band.
    function rerollSelectedNFTs(uint256 tokenAmount, uint256[] calldata exemptedNFTIds) external nonReentrant {
        if (tokenAmount == 0) revert TokenAmountMustBePositive();
        if (balanceOf(msg.sender) < tokenAmount) revert InsufficientTokenBalance();

        // The effective list, used at EVERY site below. A single site left reading calldata would
        // exempt an id on one leg and burn it on the other.
        uint256[] memory exempted = _effectiveExemptions(exemptedNFTIds);

        DN404Storage storage $ = _getDN404Storage();
        AddressData storage addressData = $.addressData[msg.sender];

        uint256 unitSize = _unit();
        uint256 exemptCount = exempted.length;
        if (tokenAmount < exemptCount * unitSize) revert TokenAmountMustRepresentNFT();

        uint256 rerollAmount = tokenAmount - (exemptCount * unit);
        // Round down: standard integer NFT count. A holder whose ENTIRE position is band NFTs lands
        // here — auto-exemption leaves no rerollable remainder — and reverts with their NFTs intact.
        if (rerollAmount / unit == 0) revert TokenAmountMustRepresentNFT();

        uint256 balanceBefore = addressData.balance;

        // The effective list, not the caller's: an indexer reading the caller's list would misreport
        // which ids were protected.
        emit RerollInitiated(msg.sender, tokenAmount, exempted);

        for (uint256 i = 0; i < exemptCount; i++) {
            _initiateTransferFromNFT(msg.sender, address(this), exempted[i], msg.sender);
        }

        _transfer(msg.sender, address(this), rerollAmount);

        bool originalSkipNFT = getSkipNFT(msg.sender);
        _setSkipNFT(msg.sender, false);
        _transfer(address(this), msg.sender, rerollAmount);
        _setSkipNFT(msg.sender, originalSkipNFT);

        for (uint256 i = 0; i < exemptCount; i++) {
            _initiateTransferFromNFT(address(this), msg.sender, exempted[i], address(this));
        }

        if (addressData.balance != balanceBefore) revert BalanceMismatchAfterReroll();

        emit RerollCompleted(msg.sender, tokenAmount);
    }

    /// @dev The caller's `exemptedNFTIds` plus every band id the caller owns that is not already in it.
    ///
    ///      PLACEMENT IS DELIBERATE: this lives in `ERC404BondingOps`, NOT in the shared
    ///      `ERC404BondingStorage` base. The base compiles into BOTH contracts, so a helper declared
    ///      there would spend `ERC404BondingInstance`'s scarce EIP-170 headroom on code the instance can
    ///      never reach — reroll's body is here and the instance only trampolines to it.
    ///
    ///      COST. On a tiered whole-position reroll this is CHEAPER than the path it replaces: routing
    ///      a band through `_initiateTransferFromNFT` (a re-home) costs less than burn -> escrow-release
    ///      hook -> fresh mint. Untiered instances pay one `tierBands.length` SLOAD and a calldata copy.
    ///      The scan is O(owned) with an O(supplied) inner dedupe, and it is self-inflicted: the caller
    ///      pays for the size of their own position. See the PR body for measured numbers.
    ///
    ///      DEDUPE is load-bearing, not tidiness. An id present twice in the effective list would be
    ///      transferred to the instance twice on the outward leg — the second transfer reverts, since
    ///      the caller no longer owns it — and would inflate `exemptCount`, which feeds the
    ///      `tokenAmount < exemptCount * unitSize` guard. The scan compares against EVERY entry the
    ///      caller supplied, so a caller who already named their band gets a byte-identical result.
    ///      A caller who names the same id twice themselves reverts exactly as it does today; this
    ///      helper neither creates nor repairs that case.
    /// @param  supplied The caller's calldata exemption list, passed through unchanged and first.
    /// @return effective `supplied` for an untiered instance; otherwise `supplied` followed by the
    ///         caller's un-named band ids in `owned` order.
    function _effectiveExemptions(uint256[] calldata supplied) private view returns (uint256[] memory effective) {
        // Untiered instances structurally cannot hold a band id: one SLOAD, then out.
        if (tierBands.length == 0) return supplied;

        DN404Storage storage $ = _getDN404Storage();
        // Band ids live STRICTLY above `idLimit`: `initTierBands` seeds its ascending-band check with
        // `prevEnd = idLimit` and reverts `InvalidBand` on `idStart <= prevEnd`, and DN404 bounds every
        // auto-minted id with `_wrapNFTId(.., idLimit)`. So `id <= idLimit` proves "ordinary" and the
        // band walk can be skipped for it. `totalSupply` is fixed at `maxSupply` for this instance's
        // life, so this is the same `idLimit` the seal validated against.
        uint256 idLimit = uint256($.totalSupply) / _unit();

        uint256[] memory owned = _ownedIds(msg.sender, 0, type(uint256).max);
        uint256 suppliedLen = supplied.length;
        uint256 ownedLen = owned.length;

        // Over-allocate to the maximum possible length, fill, then shrink to the true count.
        effective = new uint256[](suppliedLen + ownedLen);
        for (uint256 i = 0; i < suppliedLen; i++) {
            effective[i] = supplied[i];
        }

        uint256 count = suppliedLen;
        for (uint256 i = 0; i < ownedLen; i++) {
            uint256 id = owned[i];
            if (id <= idLimit) continue; // ordinary id space — the O(1) early-out
            (bool isBand,,) = _bandOf(id); // the shared band walk (noesis-143); one source of truth
            if (!isBand) continue;
            bool alreadyNamed;
            for (uint256 j = 0; j < suppliedLen; j++) {
                if (supplied[j] == id) {
                    alreadyNamed = true;
                    break;
                }
            }
            if (alreadyNamed) continue;
            effective[count] = id;
            count++;
        }

        // Shrink the length in place. `count <= suppliedLen + ownedLen` by construction, so this only
        // ever narrows an allocation this function made — it never reaches memory it does not own and
        // never extends past the free-memory pointer.
        /// @solidity memory-safe-assembly
        assembly {
            mstore(effective, count)
        }
    }

    // ┌──────────────────────────────┐
    // │  Token Tiers (delegatecall)  │
    // └──────────────────────────────┘
    // Denominations, not sacrifice. A tier-N NFT is ONE DN404 unit of balance (DN404 auto-reconciles
    // `ownedLength == balance / unit` on every transfer, so an NFT can never natively be worth more)
    // PLUS `(w_N - 1) * unit` of the holder's own coin escrowed in the instance. Both ops are therefore
    // an in-place ID SWAP (which changes neither `ownedLength` nor `balance`) plus an escrow transfer.
    // Nothing is minted, burned, or taken from the curve: `reserve` and `totalBondingSupply` are never
    // touched, and the buy cap is counter-based (`ERC404BondingInstance.buyBonding`), so escrow sitting
    // in the instance's own balance cannot inflate the buyable pool.

    /// @notice Convert `w_N` units' worth of holdings into a single tier-N band NFT: `tierZeroId` is
    ///         swapped for a band id and `(w_N - 1) * unit` of the caller's coin is escrowed here.
    /// @dev    Fully reversible by `mintDown`. Keeps `nonReentrant` (shared fixed slot, engages in the
    ///         instance's context under delegatecall) — the instance trampoline must NOT also guard.
    /// @param  tierN 1-based tier (tier 0 is the implicit ordinary id space; `tierBands[tierN - 1]`).
    /// @param  tierZeroId An ordinary id (`<= idLimit`) the caller owns. Prefer a LOW index in the
    ///         caller's `owned` array: the escrow leg burns the caller's NFTs LIFO from the END of that
    ///         array, and an id caught by that burn reverts the whole call (see step (b)).
    function mintUp(uint8 tierN, uint256 tierZeroId) external nonReentrant {
        (TierBand memory band, uint256 idx) = _bandOfTier(tierN);
        DN404Storage storage $ = _getDN404Storage();
        uint256 unitSize = _unit();

        // (a) `tierZeroId` must be in the ORDINARY id space — never another band's id.
        if (tierZeroId == 0 || tierZeroId > uint256($.totalSupply) / unitSize) revert NotTierZeroId();

        uint256 escrowAmount = (uint256(band.weight) - 1) * unitSize;

        // (b) ESCROW LEG FIRST, then re-read ownership. DN404 reconciles this transfer by burning the
        //     caller's NFTs LIFO off the tail of `owned[caller]` until `ownedLength == balance / unit`,
        //     and `tierZeroId` may itself be in that tail. Of the two orderings the plan allows, this
        //     one is chosen because the alternative (swap first, transfer second) is strictly WORSE:
        //     the freshly installed BAND id would then be the LIFO burn candidate, and a burned band id
        //     leaves its escrow orphaned. Here the worst case is a clean revert with no state change.
        //     The instance's own skipNFT is set at `_initializeDN404`, so the escrow mints it no NFTs.
        _transfer(msg.sender, address(this), escrowAmount);

        Uint32Map storage oo = $.oo;
        uint32 holderAlias = _get(oo, _ownershipIndex(tierZeroId));
        if ($.aliasToAddress[holderAlias] != msg.sender) revert NotTierZeroId();

        // (c) Pop a band id: LIFO of returned ids first, then the never-issued high-water cursor.
        uint256 bandId = _popBandId(idx, band);

        // (d) Swap the ids IN PLACE, mirroring `DN404._transferFromNFT`'s map writes. `ownedLength`,
        //     `balance` and `totalNFTSupply` are all unchanged — one id leaves, one arrives.
        _swapOwnedId($, oo, msg.sender, holderAlias, tierZeroId, bandId);

        // (d2) Move the band id to owned index 0, so a later debit's LIFO tail burn reaches it LAST.
        //      Must run AFTER the swap: the band id has to be installed in `owned` before it can move.
        //      Purely a reorder — no balance, `ownedLength` or escrow effect (see `_moveOwnedIdToFront`).
        _moveOwnedIdToFront($, oo, msg.sender, holderAlias, bandId);

        // (e) Escrow accounting.
        totalTierEscrow += escrowAmount;

        // (f) ERC721 face: the tier-0 id burns, the band id mints.
        _logMirrorTransfer($, msg.sender, address(0), tierZeroId);
        _logMirrorTransfer($, address(0), msg.sender, bandId);
        emit MintedUp(msg.sender, tierN, tierZeroId, bandId);
    }

    /// @notice The exact inverse of `mintUp`: swap an owned band id back to a free ordinary id and
    ///         return the escrowed `(w_N - 1) * unit` to the caller.
    /// @dev    The returned coin re-materializes the caller's tier-0 NFTs through DN404's own mint
    ///         loop (subject to the caller's skipNFT setting) — nothing is hand-minted here.
    function mintDown(uint256 bandId) external nonReentrant {
        if (!_tiersSealed) revert TiersNotConfigured();
        // `_bandOf` is the shared, non-reverting range walk in `ERC404BondingStorage` (noesis-143): the
        // burn-safety hook and `coinBalanceOf` resolve escrow with the exact same code, so the amount
        // credited on a burn can never drift from the amount charged on a `mintUp`.
        (bool isBand, uint256 idx, uint256 weight) = _bandOf(bandId);
        if (!isBand) revert NotBandId();

        DN404Storage storage $ = _getDN404Storage();
        Uint32Map storage oo = $.oo;
        uint32 holderAlias = _get(oo, _ownershipIndex(bandId));
        if ($.aliasToAddress[holderAlias] != msg.sender) revert NotBandId();

        uint256 unitSize = _unit();
        uint256 idLimit = uint256($.totalSupply) / unitSize;
        uint256 tierZeroId = _nextFreeTierZeroId($, oo, idLimit);

        _swapOwnedId($, oo, msg.sender, holderAlias, bandId, tierZeroId);
        // Advance the mint cursor exactly as DN404's own mint loop does after consuming an id.
        $.nextTokenId = uint32(_wrapNFTId(tierZeroId + 1, idLimit));

        bandFreed[idx].push(uint32(bandId));

        uint256 escrowAmount = (weight - 1) * unitSize;
        totalTierEscrow -= escrowAmount;

        _logMirrorTransfer($, msg.sender, address(0), bandId);
        _logMirrorTransfer($, address(0), msg.sender, tierZeroId);

        // Release the escrow LAST: this is the leg that mints the caller's replacement tier-0 NFTs,
        // and it must see the swap already settled (`tierZeroId` marked owned + existing) so the mint
        // loop cannot hand out the very id we just installed.
        _transfer(address(this), msg.sender, escrowAmount);

        emit MintedDown(msg.sender, uint8(idx + 1), bandId, tierZeroId);
    }

    // ── Token Tiers internals ────────────────────────────────────────────────────────────────────

    /// @dev Resolve a 1-based tier number to its sealed band.
    function _bandOfTier(uint8 tierN) private view returns (TierBand memory band, uint256 idx) {
        if (!_tiersSealed) revert TiersNotConfigured();
        if (tierN == 0 || tierN > tierBands.length) revert InvalidBand();
        unchecked {
            idx = uint256(tierN) - 1;
        }
        band = tierBands[idx];
    }

    /// @dev Per-band LIFO free list, then the high-water cursor. O(1), never scans.
    function _popBandId(uint256 idx, TierBand memory band) private returns (uint256 bandId) {
        uint32[] storage freed = bandFreed[idx];
        uint256 n = freed.length;
        if (n != 0) {
            unchecked {
                bandId = freed[n - 1];
            }
            freed.pop();
        } else {
            uint256 cursor = bandNextFree[idx];
            if (cursor > band.idEnd) revert BandExhausted();
            bandId = cursor;
            unchecked {
                bandNextFree[idx] = cursor + 1;
            }
        }
    }

    /// @dev Replace `oldId` with `newId` in `holder`'s owned array, in the same slot. Byte-for-byte the
    ///      map writes `DN404._transferFromNFT` performs, minus the balance legs (there is no balance
    ///      movement here — that is the whole point: `ownedLength == balance / unit` is preserved, so
    ///      the next transfer's reconciliation has nothing to undo).
    function _swapOwnedId(
        DN404Storage storage $,
        Uint32Map storage oo,
        address holder,
        uint32 holderAlias,
        uint256 oldId,
        uint256 newId
    ) private {
        uint32 slot = _get(oo, _ownedIndex(oldId));
        _set($.owned[holder], slot, uint32(newId));
        _setOwnerAliasAndOwnedIndex(oo, newId, holderAlias, slot);
        _setOwnerAliasAndOwnedIndex(oo, oldId, 0, 0);
        if (_useExistsLookup()) {
            _set($.exists, oldId, false);
            _set($.exists, newId, true);
        }
        if (_get($.mayHaveNFTApproval, oldId)) {
            _set($.mayHaveNFTApproval, oldId, false);
            delete $.nftApprovals[oldId];
        }
    }

    /// @dev Move `id` to owned index 0 in `holder`'s array by swapping it with whatever sits there.
    ///      WHY: DN404 reconciles `ownedLength == balance / unit` on every debit by burning ids LIFO off
    ///      the TAIL of `owned[holder]`, so an id's index decides how much of a partial spend it can
    ///      survive. Index 0 is the last position the burn loop reaches: a holder with any spare liquid
    ///      coin can transfer without endangering the tier NFT. This is NOT a guarantee of immortality —
    ///      the final unit of a full spend still burns it, which is the 1-unit floor by design.
    ///
    ///      Pure reorder: two `owned` entries trade places and their two `oo` owned-index entries follow.
    ///      `balance`, `ownedLength`, `totalNFTSupply` and `totalTierEscrow` are all untouched. BOTH ids
    ///      are rewritten — updating only the moved one would leave the displaced id's owned index
    ///      pointing at a slot it no longer occupies, and DN404 trusts `oo` absolutely.
    ///
    ///      `displacedId` is by construction owned by `holder` (it came out of `holder`'s own array), so
    ///      it keeps the same `holderAlias`. A holder whose only NFT is `id` has it at index 0 already
    ///      and returns early.
    function _moveOwnedIdToFront(
        DN404Storage storage $,
        Uint32Map storage oo,
        address holder,
        uint32 holderAlias,
        uint256 id
    ) private {
        uint32 slot = _get(oo, _ownedIndex(id));
        if (slot == 0) return;

        Uint32Map storage ownedIds = $.owned[holder];
        uint256 displacedId = _get(ownedIds, 0);

        _set(ownedIds, 0, uint32(id));
        _set(ownedIds, slot, uint32(displacedId));

        _setOwnerAliasAndOwnedIndex(oo, id, holderAlias, 0);
        _setOwnerAliasAndOwnedIndex(oo, displacedId, holderAlias, slot);
    }

    /// @dev The next free ORDINARY id, found exactly the way DN404's mint loop finds one (the `exists`
    ///      bitmap scan, bounded by `idLimit`, so band ids are never seen). Termination is guaranteed
    ///      while a band NFT is outstanding: every NFT in existence is backed by one unit of some
    ///      holder's balance, band NFTs consume ids ABOVE `idLimit`, and the total balance is fixed at
    ///      `idLimit` units — so at least one id in `[1..idLimit]` is always free here.
    function _nextFreeTierZeroId(DN404Storage storage $, Uint32Map storage oo, uint256 idLimit)
        private
        view
        returns (uint256 id)
    {
        id = _wrapNFTId($.nextTokenId, idLimit);
        while (_get(oo, _ownershipIndex(id)) != 0) {
            id = _useExistsLookup()
                ? _wrapNFTId(_findFirstUnset($.exists, id + 1, idLimit), idLimit)
                : _wrapNFTId(id + 1, idLimit);
        }
    }

    /// @dev Emit one ERC721 {Transfer} on the mirror. DN404's own `_directLogsSend` helper is `private`,
    ///      so this reproduces its call verbatim: `logDirectTransfer(address,address,uint256[])`
    ///      (selector 0x144027d3), which the mirror accepts only from its `baseERC20` — under
    ///      delegatecall that is this instance, so the authorization holds.
    function _logMirrorTransfer(DN404Storage storage $, address from, address to, uint256 id) private {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        (bool ok, bytes memory ret) = $.mirrorERC721.call(abi.encodeWithSelector(0x144027d3, from, to, ids));
        if (!ok || ret.length != 32 || abi.decode(ret, (uint256)) != 1) revert TierOpFailed();
    }

    // ┌────────────────────────────────────────┐
    // │  Value paths (delegatecall) — 148 D3   │
    // └────────────────────────────────────────┘
    // The six bodies below were MOVED VERBATIM out of `ERC404BondingInstance` by noesis-148 to buy back
    // EIP-170 headroom. Nothing about them changed: same order, same checks, same guards. Every
    // dependency they have is shared STORAGE in the base (`masterRegistry`, `stakingModule`,
    // `stakingActive`, `reserve`, `stakingReserve`, `weth`, the free-mint counters) — Ops has no
    // constructor and no immutables, so there is nothing that could read differently on this side.
    // `nonReentrant` and `onlyOwner` live HERE ONLY: the reentrancy guard engages through the shared
    // fixed slot under delegatecall, and guarding both ends would self-revert.

    /// @notice Claim one free mint (= 1 NFT worth of tokens) at zero ETH cost.
    /// @param gatingData Passed to gatingModule.canMint if scope requires it.
    // slither-disable-next-line reentrancy-no-eth
    function claimFreeMint(bytes calldata gatingData) external nonReentrant {
        if (freeMintAllocation == 0) revert FreeMintDisabled();
        // Free mints are part of the bonding curve: once graduated the curve is closed, so a late
        // claim would mint tokens against a drained curve / already-deployed pool (noesis-061 F2).
        if (graduated) revert BondingEnded();
        // Free mints are part of the curve, not a pre-sale — they cannot be claimed before it opens
        // (same open reference the buy/graduation paths use).
        if (bondingOpenTime == 0) revert BondingNotConfigured();
        if (block.timestamp < bondingOpenTime) revert TooEarly();
        if (freeMintClaimed[msg.sender]) revert FreeMintAlreadyClaimed();
        if (freeMintsClaimed >= freeMintAllocation) revert FreeMintExhausted();

        if (address(gatingModule) != address(0) && gatingActive && gatingScope != GatingScope.PAID_ONLY) {
            // Single curve → editionId 0; bondingOpenTime is the authoritative open reference.
            (bool allowed, bool permanent) = gatingModule.canMint(msg.sender, 0, unit, bondingOpenTime, gatingData);
            if (!allowed) revert GatingNotAllowed();
            if (permanent) gatingActive = false;
            gatingModule.onMint(msg.sender, 0, unit);
        }

        freeMintClaimed[msg.sender] = true;
        freeMintsClaimed++;
        _transfer(address(this), msg.sender, unit);
        emit FreeMintClaimed(msg.sender);
    }

    // slither-disable-next-line calls-loop,unused-return
    function claimAllFees() external onlyOwner nonReentrant {
        uint256 before = address(this).balance;
        address[] memory allVaults = masterRegistry.getInstanceVaults(address(this));
        for (uint256 i = 0; i < allVaults.length; i++) {
            // Some vaults (e.g. AlignmentEndowmentVault) intentionally revert NotSupported() on
            // claimFees() — they have no pull-claim model. Skip those silently so one such vault
            // can't brick fee delivery for the whole instance; the balance-delta below still
            // credits whatever the supporting vaults DID push.
            try IAlignmentVault(payable(allVaults[i])).claimFees() { } catch { }
        }
        if (stakingActive) {
            address sm = address(stakingModule); // cache: one SLOAD for the module calls below
            uint256 delta = address(this).balance - before;
            if (delta != 0) {
                IERC404StakingModule(sm).recordFeesReceived(delta);
            }
            // Single round-trip (noesis-127): settle the stream, read totalStaked for the noesis-061
            // credit guard, and release any un-accruable stream leak (ETH a prior stream scheduled during
            // a zero-stake gap that no staker can ever accrue). Folding the guard-read and the release
            // into one call keeps the instance under EIP-170.
            (uint256 totalStaked, uint256 leaked) = IStakingTotals(sm).settleAndReleaseLeak();
            // Credit the staker-owed reserve ONLY when the module can distribute (totalStaked > 0),
            // mirroring recordFeesReceived's own guard. When totalStaked == 0 the delta is genuine
            // undistributable dust the module cannot pay out — leave it recoverable by withdrawDust.
            // `delta` is a conservative over-estimate of the true liability (the module truncates
            // rewardPerToken), the safe direction for a sweep guard.
            if (delta != 0 && totalStaked != 0) {
                stakingReserve += delta;
            }
            // Debit the released leak so it drops out of `stakingReserve` and withdrawDust can sweep it
            // (a grief-locked remainder is thus always clearable by the owner). `_debitStakingReserve`
            // clamps, so a 0 leak — the case while a live staker is still accruing — is a safe no-op.
            _debitStakingReserve(leaked);
        }
    }

    /// @notice Recover ETH held by the instance that is NOT part of the bonding `reserve`.
    /// @dev Surplus ETH can accumulate here — e.g. staking fees pushed by a vault while
    ///      totalStaked == 0 (the staking module can't distribute them, so they sit in the
    ///      instance balance). Only the balance ABOVE the tracked `reserve` AND the tracked
    ///      `stakingReserve` is withdrawable; `reserve` backs sellBonding refunds and
    ///      `stakingReserve` is ETH owed to stakers — neither is ever sweepable (noesis-061 F1).
    /// @dev `claimAllFees` first releases any un-accruable stream leak out of `stakingReserve`
    ///      (noesis-127), so by the time this runs `stakingReserve` holds only genuinely-owed ETH and
    ///      the previously-locked gap remainder has become recoverable surplus here.
    function withdrawDust() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        uint256 locked = reserve + stakingReserve;
        // Guard against underflow: never withdraw if balance is at/below the locked liabilities.
        if (bal <= locked) revert NothingToWithdraw();
        uint256 surplus = bal - locked;
        (bool ok,) = payable(owner()).call{ value: surplus }("");
        if (!ok) revert WithdrawFailed();
    }

    /// @notice Stake `amount` tokens. Tokens are held by this contract while staked.
    function stake(uint256 amount) external nonReentrant {
        if (!stakingActive) revert StakingModuleNotSet();
        _transfer(msg.sender, address(this), amount);
        stakingModule.recordStake(msg.sender, amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake `amount` tokens and auto-claim any pending ETH rewards.
    function unstake(uint256 amount) external nonReentrant {
        if (!stakingActive) revert StakingModuleNotSet();
        uint256 rewardAmount = stakingModule.recordUnstake(msg.sender, amount);
        _transfer(address(this), msg.sender, amount);
        if (rewardAmount > 0) {
            _debitStakingReserve(rewardAmount);
            SmartTransferLib.smartTransferETH(msg.sender, rewardAmount, weth);
        }
        emit Unstaked(msg.sender, amount, rewardAmount);
    }

    /// @notice Claim pending ETH staking rewards without unstaking.
    function claimStakingRewards() external nonReentrant {
        if (!stakingActive) revert StakingModuleNotSet();
        uint256 rewardAmount = stakingModule.computeClaim(msg.sender);
        _debitStakingReserve(rewardAmount);
        SmartTransferLib.smartTransferETH(msg.sender, rewardAmount, weth);
        emit StakingRewardsClaimed(msg.sender, rewardAmount);
    }

    // ┌────────────────────────────────────────┐
    // │  Graduation (delegatecall) — 188       │
    // └────────────────────────────────────────┘
    // `deployLiquidity` moved here from `ERC404BondingInstance` on the same discard-returndata
    // trampoline the other value paths use. It carries the guards (`_requireOwnerOrAgent`, the bonding
    // clock, `graduated`, `reserve != 0`) and `nonReentrant` on THIS side only, resolving against the
    // same `msg.sender`, the same Ownable slot and the same shared reentrancy slot under delegatecall.

    /**
     * @notice Graduate the collection: open the venue pool at the curve's marginal price, settle the
     *         raise, and burn whatever coin the pool did not take.
     * @dev SIZING (noesis-188). The pool's coin side is no longer the create-time `liquidityReserve`.
     *      `liquidityReserve` was sized on the assumption that the curve sold out; graduation is
     *      permitted at any point past the bonding open time with a non-zero raise, and at a partial
     *      raise a fixed coin side against a smaller ETH side opens the pool beneath the price the last
     *      curve buyer paid. The coin side is therefore derived at graduation from the price the curve
     *      actually reached:
     *
     *        p(S) = kCoeff / ((poleWad - s) * normalizationFactor),  s = totalBondingSupply / normFactor
     *        tokensForPool = ethForPool / p(S)
     *
     *      which is the hyperbolic family's own marginal price at the supply the curve stopped at. At a
     *      full sale this reproduces `liquidityReserve` exactly, because the pole is solved at create so
     *      the curve's end price IS the pool's opening price (`CurveParamsComputer`).
     * @dev THE CLAMP. Parity is not always affordable in coin: above roughly 85% sold (at the shipping
     *      reserve preset) the coin the parity price calls for exceeds every coin the instance still
     *      holds — LP reserve, unsold bonding supply and unclaimed free-mint allocation combined. The
     *      ETH is clamped, never the parity: the pool takes `min(availableCoin, ethForPool / p)` coin
     *      and exactly that coin valued at `p`. Parity therefore holds at EVERY stopping point on every
     *      preset, and the pool never opens below the curve.
     * @dev THE EXCESS. LP-share ETH the clamp could not place rides the module's existing 80/19/1 tithe
     *      rail (`RevenueSplitLib.splitGraduation`) alongside the creator carve — 1% protocol, 19%
     *      alignment vault, 80% creator — rather than being held here, where it would be a second
     *      unowned overhang. `GraduationEthDiverted` reports the carve and the clamp residue separately
     *      so the creator's declared carve stays distinguishable on-chain from the clamp's output.
     * @dev THE BURN. Coin the pool did not take is burned, not stranded and not returned: after
     *      `graduated` no path can move instance-held coin (`buyBonding`, `sellBonding` and
     *      `claimFreeMint` all revert `BondingEnded`, and no deployer module has a withdrawal path), so
     *      stranding it leaves a permanent unowned overhang in circulating supply; returning it to the
     *      creator would pay them in proportion to how early they cut the sale. `availableCoin` is read
     *      from live balances net of custodial liabilities, never from create-time arithmetic — a
     *      create-time constant ceasing to describe reality is the defect this sizing removes.
     * @param carveRequestBps Fraction (bps) of the protocol carve allowance the creator takes NOW, on
     *        the same axis as `declaredMaxAllowanceBps`. Effective carve ETH = min(request,
     *        allowance(raise) × declaredMaxAllowanceBps / 10000, headroom above the pool floor).
     */
    // slither-disable-next-line reentrancy-eth,timestamp,reentrancy-events
    function deployLiquidity(uint256 carveRequestBps) external nonReentrant {
        _requireOwnerOrAgent();
        if (bondingOpenTime == 0) revert BondingNotConfigured();
        if (block.timestamp < bondingOpenTime) revert TooEarly();
        if (graduated) revert AlreadyDeployed();
        if (reserve == 0) revert NoReserve();

        // CEI: capture and zero reserve before external calls
        uint256 ethToSend = reserve;
        reserve = 0;
        bondingActive = false;

        // The LP share of the raise, from the SAME primitive the deployer module recomputes it with, so
        // the two can never disagree about the pool's ETH. `splitGraduation(raise, carve, 0)` is this
        // `split` plus the carve clamp on the next line — reproduced here rather than called so the
        // clamp can be re-run against the combined carve below.
        uint256 lp = RevenueSplitLib.split(ethToSend).remainder;
        uint256 carveEth = _effectiveCarve(ethToSend, carveRequestBps);
        if (carveEth > lp) carveEth = lp;

        (uint256 tokensForPool, uint256 ethForPool) = _sizePoolAtCurvePrice(lp - carveEth);

        // Excess LP-share ETH the clamp could not place at the parity price joins the carve on the
        // module's 80/19/1 rail. `carveEth + excess == lp - ethForPool <= lp`, so the module's own
        // headroom clamp never engages on the combined figure.
        uint256 excessEth = lp - carveEth - ethForPool;

        _markGraduationCounterpartiesSkipNFT();
        _transfer(address(this), address(liquidityDeployer), tokensForPool);

        liquidityDeployer.deployLiquidity{ value: ethToSend }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethToSend,
                tokenReserve: tokensForPool,
                protocolTreasury: protocolTreasury,
                vault: address(vault),
                token: address(this),
                instance: address(this),
                creator: owner(),
                carveEth: carveEth + excessEth
            })
        );

        graduated = true;
        emit GraduationEthDiverted(ethForPool, excessEth, carveEth);
        emit LiquidityDeployed(address(liquidityDeployer), tokensForPool, ethToSend);
        emit IInstanceLifecycle.StateChanged(STATE_GRADUATED);
    }

    /// @dev The coin side of the pool and the ETH that buys it, both at the curve's marginal price at
    ///      `totalBondingSupply`. Returns `(tokensForPool, ethToPool)` with
    ///      `ethToPool / tokensForPool == p(S)` to within one wei of rounding, and `ethToPool <=
    ///      ethForPool` always. Burns the residue as a side effect — it is the same walk, and splitting
    ///      it costs the caller a second read of every term.
    ///
    ///      Rounding is deliberately asymmetric so neither branch can open the pool UNDER the curve:
    ///      the token count rounds down (`fullMulDiv`) and, when the clamp engages, the ETH rounds up
    ///      (`fullMulDivUp`). `ethToPool <= ethForPool` survives the round-up because the clamp branch
    ///      only runs when `tokensForPool` is strictly the floor of `ethForPool / p`.
    function _sizePoolAtCurvePrice(uint256 ethForPool) private returns (uint256 tokensForPool, uint256 ethToPool) {
        BondingCurveMath.Params memory c = curveParams;
        // The library's own floor: supply is normalized by truncating division everywhere it is read.
        uint256 sWad = totalBondingSupply / c.normalizationFactor;
        if (sWad >= c.poleWad) revert NothingForPool();
        // 1 / p(S), scaled: tokens per wei = (poleWad - s) * normalizationFactor / kCoeff.
        uint256 inversePriceNum = (c.poleWad - sWad) * c.normalizationFactor;

        uint256 available = _placeableCoin();
        uint256 want = FixedPointMathLib.fullMulDiv(ethForPool, inversePriceNum, c.kCoeff);

        if (want <= available) {
            // Parity is affordable: the pool takes the full LP-share ETH and the coin that price buys.
            tokensForPool = want;
            ethToPool = ethForPool;
        } else {
            // Parity costs more coin than the instance holds. Clamp the ETH, never the parity.
            tokensForPool = available;
            ethToPool = FixedPointMathLib.fullMulDivUp(available, c.kCoeff, inversePriceNum);
        }

        // Nothing to open a pool with — a raise too small to buy one base unit at the curve's price, or
        // a carve that consumed the entire LP share. Refuse before any coin is destroyed.
        if (tokensForPool == 0) revert NothingForPool();

        uint256 burned = available - tokensForPool;
        if (burned != 0) _burn(address(this), burned);
        emit GraduationSupplyBurned(available, tokensForPool, burned);
    }

    /// @dev Every coin this instance holds and is FREE to place at graduation: the LP reserve, the
    ///      unsold bonding supply and the unclaimed free-mint allocation, together, read off the live
    ///      balance rather than reconstructed from create-time constants.
    ///
    ///      Three parts of the balance are custodial and are NOT placeable: coin staked through the
    ///      staking module, coin escrowed behind outstanding tier-band NFTs, and escrow already
    ///      released by a band burn but not yet pulled. Each is owed to a holder and each remains
    ///      claimable after graduation, so placing or burning it would raid a holder's position.
    function _placeableCoin() private view returns (uint256) {
        uint256 custodial = totalTierEscrow + totalPendingEscrowRelease;
        if (stakingActive) custodial += IStakingTotals(address(stakingModule)).totalStaked(address(this));
        uint256 bal = balanceOf(address(this));
        return bal > custodial ? bal - custodial : 0;
    }

    /// @dev Mark the graduation counterparties as NFT-skipping before the pool's coin side moves.
    ///
    ///      This instance overrides `_skipNFTDefault` to `false` for EVERY address, so a recipient that
    ///      has never set the flag — including a contract — takes delivery of one NFT id per `unit` it
    ///      receives. Graduation routes the coin through two contracts in a single call: the instance
    ///      sends it to the deployer module, and the module settles it on to the venue's pool. Without
    ///      this, the module is minted one id per unit and burns them again on the settle leg, and the
    ///      pool is minted the same count and keeps them — a mint/burn/mint round trip whose cost scales
    ///      linearly with the collection size and dominates the graduation transaction. Neither
    ///      counterparty is a collector; neither has any use for an id.
    ///
    ///      The flag is set permanently rather than saved and restored (the `buyBonding` idiom), because
    ///      the pool goes on holding and receiving the coin for the life of the market: a restored
    ///      `false` would re-mint the same ids into the pool on the sell side of every subsequent swap.
    ///
    ///      The pool address is read from the wired deployer through a guarded `staticcall`, so a
    ///      deployer that does not expose it degrades to the previous behavior instead of reverting
    ///      graduation. Follow-on: the ZAMM and Cypher deployer modules do not expose an equivalent
    ///      accessor, so their pools are not covered here.
    // slither-disable-next-line low-level-calls
    function _markGraduationCounterpartiesSkipNFT() private {
        address deployer = address(liquidityDeployer);
        _setSkipNFT(deployer, true);
        // `v4PoolManager()` on the Uniswap V4 deployer module.
        (bool ok, bytes memory ret) = deployer.staticcall(abi.encodeWithSignature("v4PoolManager()"));
        if (ok && ret.length == 32) {
            _setSkipNFT(address(uint160(abi.decode(ret, (uint256)))), true);
        }
    }

    /// @dev Effective carve ETH for a raise + request. Zero-request / zero-declared short-circuits
    ///      BEFORE touching the factory, so a plain `deployLiquidity(0)` never depends on the factory
    ///      exposing carve math. Mirrors the instance's `previewCarve` seam exactly.
    function _effectiveCarve(uint256 raise, uint256 carveRequestBps) private view returns (uint256) {
        uint256 declared = declaredMaxAllowanceBps;
        if (carveRequestBps == 0 || declared == 0 || raise == 0) return 0;
        return ICarveParamsSource(factory).effectiveCarveEth(raise, declared, carveRequestBps);
    }

    // ┌────────────────────────────────────────┐
    // │  Config paths (delegatecall) — 149 D2  │
    // └────────────────────────────────────────┘
    // The thirteen init/admin/setter bodies below were MOVED VERBATIM out of `ERC404BondingInstance` by
    // noesis-149 to buy back EIP-170 headroom. Nothing about them changed: same order, same checks, same
    // gates. NO VALUE MOVES on any of these paths — no ETH transfer, no coin transfer, no curve
    // arithmetic, no staking liability — which is exactly why D2 was taken before any further value-path
    // move. Every dependency is shared STORAGE in the base (`factory`, `masterRegistry`, `modules`, the
    // tier ladder, the bonding clock), and `msg.sender` is preserved across `delegatecall`, so the
    // factory-only gates (`msg.sender != factory`), the owner gate in `setAgentDelegation`, and the
    // shared `_requireOwnerOrAgent` all resolve against exactly the caller they did in-instance.
    // Guards live HERE ONLY — the instance trampolines carry none.
    //
    // `setContractURI` (noesis-085) is the one body here that was never in the instance: it was AUTHORED
    // on this side, on the same contract as the thirteen, because the instance is the EIP-170 subject and
    // a new setter belongs where the other setters already live.
    //
    // `migrateVault` is deliberately NOT here: it is value-extracting (bare `onlyOwner`, alongside
    // `withdrawDust`/`claimAllFees`) and is noesis-148's CONTROL proving the trampoline error-collapse is
    // an artifact rather than a weakened gate. `initialize` and `initializeMetadata` also stay.

    /// @dev Structural mirror of `ERC404BondingInstance.ProtocolParams`, field-for-field. Ops needs the
    ///      identical calldata tuple to decode `initializeProtocol`'s argument, and the ABI selector is
    ///      STRUCTURAL — `initializeProtocol((address,address,address,uint256,address))` either way — so
    ///      the two declarations are interchangeable at the wire and the ABI does not change.
    ///      Deliberately NOT hoisted into the shared `ERC404BondingStorage` base: Solidity does not
    ///      expose an inherited struct through the derived contract's name, so hoisting would break every
    ///      `ERC404BondingInstance.ProtocolParams` reference — including `ERC404Factory` and the bonding
    ///      invariant suite, both outside this item's scope. `ERC404BondingOpsSelectorParity.t.sol`
    ///      asserts the two selectors stay equal, so the mirror cannot silently drift.
    struct ProtocolParams {
        address globalMessageRegistry;
        address protocolTreasury;
        address masterRegistry;
        uint256 bondingFeeBps;
        address weth;
    }

    /**
     * @notice Set protocol params. Called by factory immediately after initialize().
     */
    function initializeProtocol(ProtocolParams calldata protocol) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (!_initialized) revert NotInitialized();

        if (protocol.globalMessageRegistry == address(0)) revert InvalidGlobalMessageRegistry();

        masterRegistry = IMasterRegistry(protocol.masterRegistry);
        globalMessageRegistry = IGlobalMessageRegistry(protocol.globalMessageRegistry);
        protocolTreasury = protocol.protocolTreasury;
        weth = protocol.weth;
        bondingFeeBps = protocol.bondingFeeBps;
    }

    /// @notice Update the PER-TOKEN base URI consumed by `tokenURI(tokenId)`.
    function setMetadataURI(string calldata uri) external {
        _requireOwnerOrAgent();
        metadataURI = uri;
    }

    /// @notice Update the COLLECTION-level ERC-7572 `contractURI` (noesis-085). Exact mirror of
    ///         `setMetadataURI` above — same owner-or-agent gate, same shape — but a different slot:
    ///         `contractURI` is the project document marketplaces and `QueryAggregator`'s §6
    ///         read-through consume, while `metadataURI` is the per-token base for `tokenURI`. Never
    ///         conflate the two.
    function setContractURI(string calldata uri) external {
        _requireOwnerOrAgent();
        contractURI = uri;
    }

    /// @notice Set free mint params. Called by factory once after initialize().
    /// @param allocation NFT count reserved for free claims (0 = disabled).
    /// @param scope      Controls which entry points the gating module guards.
    function initializeFreeMint(uint256 allocation, GatingScope scope) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_freeMintInitialized) revert AlreadyInitialized();
        _freeMintInitialized = true;
        freeMintAllocation = allocation;
        gatingScope = scope;
    }

    /// @notice Seal this instance's Token Tiers ladder. Factory-only, set-once — mutable weights would
    ///         retroactively reprice every outstanding band NFT, so there is no owner setter.
    /// @dev    `bands[i]` describes tier `i + 1`; tier 0 is the implicit ordinary id space `[1..idLimit]`
    ///         with `w_0 = 1` and is never stored. Every band must sit ABOVE `idLimit` — that is what
    ///         makes band ids unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///         `_wrapNFTId(.., idLimit)` where `idLimit = totalSupply / unit`, fixed for this instance's
    ///         life), so a reserved band carves NOTHING out of the sellable supply. Band size is a
    ///         PRODUCT CHOICE bounded above by `band_N <= S / w_N` (S = the tier-0 id count), rounded
    ///         DOWN — an uncapped band at exactly `S / w_N` can hold the entire supply if it all
    ///         concentrated there, and a band deliberately capped BELOW that is a scarce tier: it can
    ///         sell out while coin remains, so `BandExhausted` is reachable by design on such a band
    ///         (and reopens as holders `mintDown`). The ceiling is what the bound protects — a band
    ///         larger than `S / w_N` would promise ids the coin supply can never back.
    /// @dev    THE LADDER SEAL. Every check below is load-bearing for T2/T3: the burn-safety hook's
    ///         `id < tierBands[0].idStart` early-out assumes ASCENDING bands strictly above `idLimit`,
    ///         and its `(weight - 1)` escrow arithmetic assumes `weight >= 2`.
    /// @dev    The caller supplies `idEnd` through `TierBand`'s `uint32` field, so a sealed band id is
    ///         bounded by `type(uint32).max` structurally — DN404's `_restrictNFTId` ceiling is met by
    ///         the field width, and a check for it here could never fire. The live uint32 rejection is
    ///         in `ERC404Factory._wireMetadata`, where ranges are derived in `uint256` and packed ABOVE
    ///         `idLimit`: DN404 permits an `idLimit` up to `0xfffffffe`, so a derived `idEnd` genuinely
    ///         exceeds `uint32` on a large supply and must be rejected before it is narrowed.
    /// @param  bands Ascending, non-overlapping bands with strictly increasing weights (`w >= 2`).
    function initTierBands(TierBand[] calldata bands) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_tiersSealed) revert AlreadyInitialized();
        if (unit == 0) revert NotInitialized();
        _tiersSealed = true;

        uint256 n = bands.length;
        if (n == 0) revert InvalidBand();
        uint256 idLimit = maxSupply / unit; // == DN404's idLimit: totalSupply is fixed at maxSupply
        uint256 prevEnd = idLimit; // bands start strictly above the ordinary id space
        uint256 prevWeight = 1; // w_0
        for (uint256 i = 0; i < n; i++) {
            uint256 idStart = bands[i].idStart;
            uint256 idEnd = bands[i].idEnd;
            uint256 weight = bands[i].weight;
            if (idStart <= prevEnd) revert InvalidBand();
            if (weight <= prevWeight) revert InvalidBand();
            if (idEnd < idStart) revert InvalidBand();
            uint256 maxSize = idLimit / weight; // round down: a band never over-promises ids
            if (maxSize == 0) revert InvalidBand();
            uint256 actual = idEnd - idStart + 1;
            if (actual > maxSize) revert InvalidBand();
            tierBands.push(bands[i]);
            bandNextFree[i] = idStart;
            prevEnd = idEnd;
            prevWeight = weight;
        }
        emit TierBandsSealed(n);
    }

    /// @notice Wire in a staking module. Called by factory after masterRegistry.registerInstance.
    ///         The module is dormant until the owner calls activateStaking().
    function initializeStaking(address _stakingModule) external {
        if (msg.sender != factory) revert OnlyFactory();
        stakingModule = IERC404StakingModule(_stakingModule);
    }

    /// @notice Wire a generic keyed module pointer (e.g. METADATA_RESOLVER). Factory-only, set-once
    ///         per role — the resolution mechanism is sealed at construction (ADR-0006/0007). The
    ///         factory registry-validates `m` before calling; the read path stays defensive (try/catch).
    function initModule(bytes32 role, address m) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (modules[role] != address(0)) revert ModuleAlreadySet();
        modules[role] = m;
        emit ModuleSet(role, m);
    }

    /// @notice Toggle agent delegation for this instance
    function setAgentDelegation(bool enabled) external {
        if (msg.sender != owner()) revert InvalidOwner();
        agentDelegationEnabled = enabled;
        emit AgentDelegationChanged(enabled);
    }

    /// @notice Called by factory to enable delegation for agent-created instances
    function setAgentDelegationFromFactory() external {
        if (msg.sender != factory) revert OnlyFactory();
        agentDelegationEnabled = true;
    }

    // slither-disable-next-line timestamp
    function setBondingOpenTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        bondingOpenTime = timestamp;
        emit BondingOpenTimeSet(timestamp);
    }

    // slither-disable-next-line timestamp
    function setBondingMaturityTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        if (bondingOpenTime == 0) revert OpenTimeMustBeSetFirst();
        if (timestamp <= bondingOpenTime) revert MaturityMustBeAfterOpenTime();
        bondingMaturityTime = timestamp;
        emit BondingMaturityTimeSet(timestamp);
    }

    /// @dev `StateChanged` is declared on `IInstanceLifecycle`, which the INSTANCE implements and Ops
    ///      deliberately does not (inheriting it would drag `instanceType()` onto Ops for no reason).
    ///      The qualified `emit IInstanceLifecycle.StateChanged(...)` form (legal since solc 0.8.21;
    ///      this tree is pinned at 0.8.28) emits the byte-identical topic0 from the instance's address
    ///      under delegatecall — same event, same log, no interface inheritance.
    function setBondingActive(bool _active) external {
        _requireOwnerOrAgent();
        if (bondingOpenTime == 0) revert OpenTimeNotSet();
        if (_active && graduated) revert CannotActivateAfterLiquidityDeployed();
        bondingActive = _active;
        emit BondingActiveChanged(_active);
        emit IInstanceLifecycle.StateChanged(_active ? STATE_BONDING : STATE_PAUSED);
    }

    function setStyle(string memory uri) external {
        _requireOwnerOrAgent();
        styleUri = uri;
    }

    /// @notice Activate staking for this instance. Irreversible. Requires stakingModule to be set.
    function activateStaking() external {
        _requireOwnerOrAgent();
        if (address(stakingModule) == address(0)) revert StakingModuleNotSet();
        if (stakingActive) revert StakingAlreadyActive();
        stakingActive = true;
        stakingModule.enableStaking();
        emit StakingActivated(address(stakingModule));
    }

    // ┌─────────────────────────┐
    // │  DN404 concrete stubs   │
    // └─────────────────────────┘
    // DN404 leaves name()/symbol()/_tokenURI() abstract. Ops must be concrete (it is deployed as the
    // shared delegatecall target), so it provides trivial stubs. Ops is never used as a token surface,
    // so these are never observed; they add code only, no storage, preserving layout equality.

    function name() public view virtual override returns (string memory) {
        return "";
    }

    function symbol() public view virtual override returns (string memory) {
        return "";
    }

    function _tokenURI(uint256) internal view virtual override returns (string memory) {
        return "";
    }

    /// @dev Parity with `ERC404BondingInstance`'s override. Ops runs under delegatecall in the
    ///      instance's storage, so `getSkipNFT` must resolve the SAME default here as it does there for
    ///      an address that has never set the flag — otherwise `mintDown`'s escrow release would skip
    ///      NFT materialization for contract holders that the instance itself would have minted for
    ///      (DN404's base default is `extcodesize(owner) != 0`). Code only; no storage, layout intact.
    function _skipNFTDefault(address) internal pure virtual override returns (bool) {
        return false;
    }
}
