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
    MaturityTooFarAfterOpenTime,
    OpenTimeNotSet,
    CannotActivateAfterLiquidityDeployed,
    StakingAlreadyActive,
    NoFeeClaimingVault,
    NotSupported,
    AlreadyDeployed,
    NoReserve,
    NothingForPool,
    MAX_BONDING_DURATION
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
 * @notice Externalized bodies for `ERC404BondingInstance` (EIP-170 headroom): reroll, tier ops, the
 *         value-path functions and the init/admin/setter config functions. This contract is never
 *         deployed as a token nor called directly: the master instance reaches every function here
 *         via a discard-returndata `delegatecall`, so each body executes in the instance's own storage
 *         context. It inherits the identical `ERC404BondingStorage` base as the instance, so the
 *         storage layout is byte-identical (CI-gated) and the shared DN404 `$` / Ownable owner /
 *         ReentrancyGuard slots resolve to the same fixed hashed slots across the delegatecall boundary.
 * @dev    Ops declares no storage of its own outside the inherited base; a state variable here would
 *         collide with the instance's layout. New state goes in `ERC404BondingStorage`. The instance's
 *         `_ops` is immutable, so it lives in code, not storage.
 * @dev    `msg.sender` and `msg.value` are preserved across `delegatecall`, so `onlyOwner` (Ownable's
 *         shared slot) and every staker-keyed module call resolve against the instance's caller.
 */
contract ERC404BondingOps is ERC404BondingStorage {
    // ┌─────────────────────────┐
    // │   Reroll (delegatecall) │
    // └─────────────────────────┘

    /// @notice Reroll the caller's NFTs, keeping any exempted ids and every owned band NFT. Guarded by
    ///         `nonReentrant` (shared fixed slot, engages in the instance's context under delegatecall);
    ///         no owner gate.
    /// @dev    Reroll never dissolves a tier NFT. The coin round trip below is a debit like any other,
    ///         so an unexempted band id sitting in the burned range of the outward leg would be
    ///         destroyed and its denomination converted to a `pendingEscrowRelease` claim by the
    ///         burn-safety hook. Every other destruction (spend, sell, stake) is a deliberate move of
    ///         coin, so the protection is in the contract rather than in a caller:
    ///         `_effectiveExemptions` appends every band id the caller owns to the supplied list, and
    ///         the whole body reads that combined list. Deliberate dissolution is available through
    ///         `mintDown`, which returns the escrow as spendable coin first.
    /// @param  tokenAmount How much of the caller's position goes through the shuffle. A protected band
    ///         NFT is one unit of that position and consumes one unit of this budget, as an
    ///         explicitly exempted id does: a holder of one band plus three ordinary ids passing
    ///         `3 * unit` rerolls two ordinary ids and keeps the band.
    function rerollSelectedNFTs(uint256 tokenAmount, uint256[] calldata exemptedNFTIds) external nonReentrant {
        if (tokenAmount == 0) revert TokenAmountMustBePositive();
        if (balanceOf(msg.sender) < tokenAmount) revert InsufficientTokenBalance();

        // The effective list is used at every site below; reading calldata at any one site would
        // exempt an id on one leg and burn it on the other.
        uint256[] memory exempted = _effectiveExemptions(exemptedNFTIds);

        DN404Storage storage $ = _getDN404Storage();
        AddressData storage addressData = $.addressData[msg.sender];

        uint256 unitSize = _unit();
        uint256 exemptCount = exempted.length;
        if (tokenAmount < exemptCount * unitSize) revert TokenAmountMustRepresentNFT();

        uint256 rerollAmount = tokenAmount - (exemptCount * unit);
        // Round down: integer NFT count. A holder whose entire position is band NFTs lands here —
        // auto-exemption leaves no rerollable remainder — and reverts with their NFTs intact.
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
    ///      It lives here, not in the shared `ERC404BondingStorage` base: the base compiles into both
    ///      contracts, so a helper there would spend `ERC404BondingInstance`'s scarce EIP-170 headroom
    ///      on code the instance never reaches.
    ///
    ///      Cost: routing a band through `_initiateTransferFromNFT` (a re-home) costs less than burn ->
    ///      escrow-release hook -> fresh mint. Untiered instances pay one `tierBands.length` SLOAD and
    ///      a calldata copy. The scan is O(owned) with an O(supplied) inner dedupe; the caller pays
    ///      for the size of their own position.
    ///
    ///      Dedupe is load-bearing. An id present twice in the effective list would be transferred to
    ///      the instance twice on the outward leg — the second transfer reverts, since the caller no
    ///      longer owns it — and would inflate `exemptCount`, which feeds the
    ///      `tokenAmount < exemptCount * unitSize` guard. The scan compares against every entry the
    ///      caller supplied, so a caller who already named their band gets the supplied list back.
    ///      A caller who names the same id twice reverts; this helper neither creates nor repairs
    ///      that case.
    /// @param  supplied The caller's calldata exemption list, passed through unchanged and first.
    /// @return effective `supplied` for an untiered instance; otherwise `supplied` followed by the
    ///         caller's un-named band ids in `owned` order.
    function _effectiveExemptions(uint256[] calldata supplied) private view returns (uint256[] memory effective) {
        // Untiered instances structurally cannot hold a band id: one SLOAD, then out.
        if (tierBands.length == 0) return supplied;

        DN404Storage storage $ = _getDN404Storage();
        // Band ids live strictly above `idLimit`: `initTierBands` seeds its ascending-band check with
        // `prevEnd = idLimit` and reverts `InvalidBand` on `idStart <= prevEnd`, and DN404 bounds every
        // auto-minted id with `_wrapNFTId(.., idLimit)`. So `id <= idLimit` proves "ordinary" and the
        // band walk can be skipped for it. The ceiling is sealed at create against `maxSupply / unit`,
        // the expression `initTierBands` validated the ladder against. Graduation burns instance-held
        // coin and lowers live `totalSupply` but not this ceiling: an ordinary id up to
        // `maxSupply / unit` can be outstanding for the instance's whole life, so the sealed bound is
        // read here, never `$.totalSupply`.
        uint256 idLimit = maxSupply / _unit();

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
            (bool isBand,,) = _bandOf(id); // the shared band walk
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
    // Denominations, not sacrifice. A tier-N NFT is one DN404 unit of balance (DN404 reconciles
    // `ownedLength == balance / unit` on every transfer, so an NFT is never natively worth more) plus
    // `(w_N - 1) * unit` of the holder's own coin escrowed in the instance. Both ops are an in-place
    // id swap (which changes neither `ownedLength` nor `balance`) plus an escrow transfer. Nothing is
    // minted, burned, or taken from the curve: `reserve` and `totalBondingSupply` are untouched, and
    // the buy cap is counter-based (`ERC404BondingInstance.buyBonding`), so escrow sitting in the
    // instance's own balance cannot inflate the buyable pool.

    /// @notice Convert `w_N` units' worth of holdings into a single tier-N band NFT: `tierZeroId` is
    ///         swapped for a band id and `(w_N - 1) * unit` of the caller's coin is escrowed here.
    /// @dev    Reversible by `mintDown`. `nonReentrant` (shared fixed slot, engages in the instance's
    ///         context under delegatecall); the instance trampoline must not also guard.
    /// @param  tierN 1-based tier (tier 0 is the implicit ordinary id space; `tierBands[tierN - 1]`).
    /// @param  tierZeroId An ordinary id (`<= idLimit`) the caller owns. Prefer a LOW index in the
    ///         caller's `owned` array: the escrow leg burns the caller's NFTs LIFO from the END of that
    ///         array, and an id caught by that burn reverts the whole call (see step (b)).
    function mintUp(uint8 tierN, uint256 tierZeroId) external nonReentrant {
        (TierBand memory band, uint256 idx) = _bandOfTier(tierN);
        DN404Storage storage $ = _getDN404Storage();
        uint256 unitSize = _unit();

        // (a) `tierZeroId` must be in the ordinary id space, never another band's id. The ceiling is
        //     the sealed `maxSupply / unit` (what `initTierBands` packed the bands strictly above), not
        //     live `totalSupply`: graduation burns instance-held coin and lowers live supply, but every
        //     ordinary id the instance ever minted stays `<= maxSupply / unit` and remains usable.
        if (tierZeroId == 0 || tierZeroId > maxSupply / unitSize) revert NotTierZeroId();

        uint256 escrowAmount = (uint256(band.weight) - 1) * unitSize;

        // (b) Escrow leg first, then re-read ownership. DN404 reconciles this transfer by burning the
        //     caller's NFTs LIFO off the tail of `owned[caller]` until `ownedLength == balance / unit`,
        //     and `tierZeroId` may itself be in that tail. Swapping first and transferring second
        //     would make the freshly installed band id the LIFO burn candidate, and a burned band id
        //     leaves its escrow orphaned. In this order the worst case is a clean revert with no state
        //     change.
        //     The instance's own skipNFT is set at `_initializeDN404`, so the escrow mints it no NFTs.
        _transfer(msg.sender, address(this), escrowAmount);

        Uint32Map storage oo = $.oo;
        uint32 holderAlias = _get(oo, _ownershipIndex(tierZeroId));
        if ($.aliasToAddress[holderAlias] != msg.sender) revert NotTierZeroId();

        // (c) Pop a band id: LIFO of returned ids first, then the never-issued high-water cursor.
        uint256 bandId = _popBandId(idx, band);

        // (d) Swap the ids in place, mirroring `DN404._transferFromNFT`'s map writes. `ownedLength`,
        //     `balance` and `totalNFTSupply` are unchanged — one id leaves, one arrives.
        _swapOwnedId($, oo, msg.sender, holderAlias, tierZeroId, bandId);

        // (d2) Swap the band id into owned index 0, so a later debit's LIFO tail burn reaches it last.
        //      This is a swap, not an insert: `_moveOwnedIdToFront` writes whatever id sat at index 0
        //      into the slot the band id vacated. So the protection covers the most recently moved
        //      band only. With two or more bands, the earlier one is displaced to an arbitrary
        //      interior slot and is burnable by a partial spend that never touches index 0.
        //      No escrow value is lost when that happens — the burn-safety hook credits escrow off
        //      `_bandOf` — but the band NFT itself is gone. Hence the naming contract: exact count
        //      always, exact naming at one band, worst case at two or more.
        //      Runs after the swap: the band id must be installed in `owned` before it can move.
        //      A pure reorder — no balance, `ownedLength` or escrow effect (see `_moveOwnedIdToFront`).
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
        // `_bandOf` is the shared, non-reverting range walk in `ERC404BondingStorage`: the burn-safety
        // hook and `coinBalanceOf` resolve escrow with the same code, so the amount credited on a
        // burn cannot drift from the amount charged on a `mintUp`.
        (bool isBand, uint256 idx, uint256 weight) = _bandOf(bandId);
        if (!isBand) revert NotBandId();

        DN404Storage storage $ = _getDN404Storage();
        Uint32Map storage oo = $.oo;
        uint32 holderAlias = _get(oo, _ownershipIndex(bandId));
        if ($.aliasToAddress[holderAlias] != msg.sender) revert NotBandId();

        uint256 unitSize = _unit();
        // The ordinary-id ceiling is the sealed `maxSupply / unit`, not live `totalSupply / unit`: a
        // post-graduation burn lowers live supply, but the free-id search must range over the full
        // ordinary space the ladder was sealed against so the id it returns is one `mintUp` would accept.
        uint256 idLimit = maxSupply / unitSize;
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

    /// @dev The next free ordinary id, found the way DN404's mint loop finds one (the `exists`
    ///      bitmap scan, bounded by `idLimit`, so band ids are never seen). `idLimit` is the sealed
    ///      `maxSupply / unit`, the ceiling the whole ordinary id space was carved from. Termination is
    ///      guaranteed while a band NFT is outstanding: every NFT in existence is backed by one unit of
    ///      some holder's balance, total balance is at most `idLimit` units (graduation only lowers it),
    ///      and a band NFT consumes an id ABOVE `idLimit` while still costing a unit of that balance — so
    ///      fewer than `idLimit` ordinary ids can be outstanding, and at least one id in `[1..idLimit]`
    ///      is always free here.
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
    // │      Value paths (delegatecall)        │
    // └────────────────────────────────────────┘
    // Every dependency of the bodies below is shared storage in the base (`masterRegistry`,
    // `stakingModule`, `stakingActive`, `reserve`, `stakingReserve`, `weth`, the free-mint counters);
    // Ops has no constructor and no immutables, so nothing reads differently on this side.
    // `nonReentrant` and `onlyOwner` live here only: the reentrancy guard engages through the shared
    // fixed slot under delegatecall, and guarding both ends would self-revert.

    /// @notice Claim one free mint (= 1 NFT worth of tokens) at zero ETH cost.
    /// @param gatingData Passed to gatingModule.canMint if scope requires it.
    // slither-disable-next-line reentrancy-no-eth
    function claimFreeMint(bytes calldata gatingData) external nonReentrant {
        if (freeMintAllocation == 0) revert FreeMintDisabled();
        // Free mints are part of the bonding curve: once graduated the curve is closed, so a claim
        // would mint tokens against a drained curve / already-deployed pool.
        if (graduated) revert BondingEnded();
        // Free mints are part of the curve, not a pre-sale: no claim before it opens (the same open
        // reference the buy/graduation paths use).
        if (bondingOpenTime == 0) revert BondingNotConfigured();
        if (block.timestamp < bondingOpenTime) revert TooEarly();
        if (freeMintClaimed[msg.sender]) revert FreeMintAlreadyClaimed();
        if (freeMintsClaimed >= freeMintAllocation) revert FreeMintExhausted();

        if (address(gatingModule) != address(0) && gatingActive && gatingScope != GatingScope.PAID_ONLY) {
            // Single curve → editionId 0.
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
        address[] memory allVaults = _instanceVaults();
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
            // Revocation stops crediting. The staking module gates `recordFeesReceived` behind
            // `onlyRegisteredInstance`, so once this instance's registration is revoked a bare call
            // reverts and takes the whole sweep down with it — the vault pull above is undone and
            // `settleAndReleaseLeak` below never runs, stranding both the swept fees and any released
            // stream leak. A revoked instance is not credited: the delta is not streamed to stakers and
            // not added to `stakingReserve`, which leaves it as ordinary surplus the owner recovers
            // through `withdrawDust`. Crediting the reserve without a matching stream would lock ETH
            // nobody can accrue and nobody can sweep.
            bool credited = delta != 0 && masterRegistry.isRegisteredInstance(address(this));
            if (credited) {
                IERC404StakingModule(sm).recordFeesReceived(delta);
            }
            // Single round-trip: settle the stream, read totalStaked for the credit guard, and release
            // any un-accruable stream leak (ETH a prior stream scheduled during a zero-stake gap that
            // no staker can accrue). One call keeps the instance under EIP-170.
            (uint256 totalStaked, uint256 leaked) = IStakingTotals(sm).settleAndReleaseLeak();
            // Credit the staker-owed reserve only when the delta was streamed (`credited`) and the
            // module can distribute (totalStaked > 0), mirroring recordFeesReceived's own guard.
            // Otherwise the delta is undistributable dust the module cannot pay out; it stays
            // recoverable by withdrawDust.
            // `delta` is a conservative over-estimate of the true liability (the module truncates
            // rewardPerToken), the safe direction for a sweep guard.
            if (credited && totalStaked != 0) {
                stakingReserve += delta;
            }
            // Debit the released leak so it drops out of `stakingReserve` and withdrawDust can sweep it.
            // `_debitStakingReserve` clamps, so a 0 leak (a live staker still accruing) is a no-op.
            _debitStakingReserve(leaked);
        }
    }

    /// @notice Recover ETH held by the instance that is NOT part of the bonding `reserve`.
    /// @dev Surplus ETH can accumulate here — e.g. staking fees pushed by a vault while
    ///      totalStaked == 0 (the staking module can't distribute them, so they sit in the
    ///      instance balance). Only the balance above the tracked `reserve` and `stakingReserve` is
    ///      withdrawable; `reserve` backs sellBonding refunds and `stakingReserve` is ETH owed to
    ///      stakers — neither is sweepable.
    /// @dev `claimAllFees` first releases any un-accruable stream leak out of `stakingReserve`, so
    ///      `stakingReserve` holds only owed ETH and the gap remainder is recoverable surplus here.
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
    // │       Graduation (delegatecall)        │
    // └────────────────────────────────────────┘
    // `deployLiquidity` carries the guards (`_requireOwnerOrAgent`, the bonding clock, `graduated`,
    // `reserve != 0`) and `nonReentrant` on this side only, resolving against the same `msg.sender`,
    // Ownable slot and shared reentrancy slot under delegatecall.

    /**
     * @notice Graduate the collection: open the venue pool at the curve's marginal price, settle the
     *         raise, and burn whatever coin the pool did not take.
     * @dev Sizing. The pool's coin side is derived at graduation, not taken from the create-time
     *      `liquidityReserve`, which assumes the curve sold out. Graduation is permitted at any point
     *      past the bonding open time with a non-zero raise, and at a partial raise a fixed coin side
     *      against a smaller ETH side opens the pool beneath the price the last curve buyer paid. The
     *      coin side comes from the price the curve actually reached:
     *
     *        p(S) = kCoeff / ((poleWad - s) * normalizationFactor),  s = totalBondingSupply / normFactor
     *        tokensForPool = ethForPool / p(S)
     *
     *      which is the hyperbolic family's own marginal price at the supply the curve stopped at. At a
     *      full sale this reproduces `liquidityReserve`, because the pole is solved at create so the
     *      curve's end price is the pool's opening price (`CurveParamsComputer`).
     * @dev The clamp. Parity is not always affordable in coin: when the curve is nearly sold, the
     *      coin the parity price calls for exceeds every coin the instance still holds — LP reserve,
     *      unsold bonding supply and unclaimed free-mint allocation combined. The ETH is clamped,
     *      never the parity: the pool takes `min(availableCoin, ethForPool / p)` coin and exactly that
     *      coin valued at `p`. Parity holds at every stopping point on every preset, and the pool
     *      never opens below the curve.
     * @dev The excess. LP-share ETH the clamp could not place rides the module's 80/19/1 tithe
     *      rail (`RevenueSplitLib.splitGraduation`) alongside the creator carve — 1% protocol, 19%
     *      alignment vault, 80% creator — rather than being held here as unowned overhang. The two
     *      legs travel to the module as separate `DeployParams` fields and `GraduationEthDiverted`
     *      reports them separately, so the creator's declared carve stays distinguishable on-chain
     *      from the clamp's output on both sides of the call.
     * @dev The burn. Coin the pool did not take is burned, not stranded and not returned: after
     *      `graduated` no path can move instance-held coin (`buyBonding`, `sellBonding` and
     *      `claimFreeMint` all revert `BondingEnded`, and no deployer module has a withdrawal path), so
     *      stranding it leaves a permanent unowned overhang in circulating supply; returning it to the
     *      creator would pay them in proportion to how early they cut the sale. `availableCoin` is read
     *      from live balances net of custodial liabilities, never from create-time arithmetic.
     * @dev The agent cannot choose the amount. Graduation is one-shot and this argument is supplied by
     *      the caller, so an agent calling `deployLiquidity(0)` would forfeit the creator's entire carve
     *      into the pool with no way back. The request is floored at `declaredMaxAllowanceBps` for
     *      every caller that is not the owner: an agent takes the full declared carve or it does not
     *      graduate. Flooring rather than rejecting a zero is what makes it hold — a rejected zero is
     *      defeated by requesting one bps, which forfeits 99.99% of the carve just as permanently. The
     *      owner's own path waives down to nothing, a choice only the party losing the money makes.
     *      The upper clamp, the split and `creator: owner()` are unaffected, so the floor can only
     *      move ETH toward the creator.
     * @param carveRequestBps Fraction (bps) of the protocol carve allowance the creator takes, on
     *        the same axis as `declaredMaxAllowanceBps`. Effective carve ETH = min(request,
     *        allowance(raise) × declaredMaxAllowanceBps / 10000, headroom above the pool floor).
     *        From an agent the request is first raised to `declaredMaxAllowanceBps`.
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

        // The LP share of the raise, from the same primitive the deployer module recomputes it with,
        // so the two agree on the pool's ETH. `splitGraduation(raise, carve, 0)` is this `split` plus
        // the carve clamp on the next line; it is reproduced here so the clamp can be re-run against
        // the combined carve below.
        uint256 lp = RevenueSplitLib.split(ethToSend).remainder;
        // Floor an agent's request at the creator's declared allowance (see "The agent cannot choose
        // the amount" above). `_requireOwnerOrAgent` has run, so a caller that is not the owner is an
        // agent; `msg.sender` survives the instance trampoline's delegatecall, so this reads the caller
        // the gate read.
        uint256 carveBps = carveRequestBps;
        if (msg.sender != owner()) {
            uint256 declaredBps = declaredMaxAllowanceBps;
            if (carveBps < declaredBps) carveBps = declaredBps;
        }
        // A renounced launch has no creator to pay, and the deployer module knows it: with
        // `creator == address(0)` it zeroes the whole diverted leg and puts the full LP share in the
        // pool (`LiquidityDeployerModule._computeAmounts`). Sizing the coin side against a carve the
        // module will not take opens the pool above the curve's last price — graduation guarantees
        // it never does — and makes `GraduationEthDiverted` report a carve nobody received. The
        // module's own rule is applied here so the two agree on the pool's ETH. Graduation is
        // reachable in that state through a pre-configured agent.
        uint256 carveEth = owner() == address(0) ? 0 : _effectiveCarve(ethToSend, carveBps);
        if (carveEth > lp) carveEth = lp;

        (uint256 tokensForPool, uint256 ethForPool) = _sizePoolAtCurvePrice(lp - carveEth);

        // Excess LP-share ETH the clamp could not place at the parity price joins the carve on the
        // module's 80/19/1 rail. It travels as its own `DeployParams` leg rather than folded into
        // `carveEth`, so the module tithes the sum but reports the two apart — `CreatorCarvePaid`
        // states the creator's request alone, the figure `declaredMaxAllowanceBps` measures. The
        // module's headroom clamp relies on `carveEth + excessEth == lp - ethForPool <= lp`, so
        // `splitGraduation`'s defensive re-clamp never engages on their sum.
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
                carveEth: carveEth,
                excessEth: excessEth
            })
        );

        // Second burn pass. `_sizePoolAtCurvePrice` burned the coin the pool was never going to be
        // offered; this burns the coin it was offered and declined. A venue that finds its pool
        // already initialized away from the graduation price takes only one side in full and hands the
        // rest of the other back; the deployer modules return it here rather than stranding it in a
        // singleton. It is burned for the same reason as the first pass: after `graduated` no path can
        // move instance-held coin, so leaving it here is a permanent unowned overhang.
        // `_placeableCoin` nets out custodial coin, so this reaches only what just came back.
        uint256 declined = _placeableCoin();
        if (declined != 0) {
            _burn(address(this), declined);
            emit GraduationResidueBurned(declined);
        }

        graduated = true;
        emit GraduationEthDiverted(ethForPool, excessEth, carveEth);
        emit LiquidityDeployed(address(liquidityDeployer), tokensForPool, ethToSend);
        emit IInstanceLifecycle.StateChanged(STATE_GRADUATED);
    }

    /// @dev The coin side of the pool and the ETH that buys it, both at the curve's marginal price at
    ///      `totalBondingSupply`. Returns `(tokensForPool, ethToPool)` with
    ///      `ethToPool / tokensForPool == p(S)` to within one wei of rounding, and `ethToPool <=
    ///      ethForPool` always. Burns the residue as a side effect, sharing the same walk.
    ///
    ///      Rounding is asymmetric so neither branch can open the pool under the curve:
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

    /// @dev Every coin this instance holds and is free to place at graduation: the LP reserve, the
    ///      unsold bonding supply and the unclaimed free-mint allocation, together, read off the live
    ///      balance rather than reconstructed from create-time constants.
    ///
    ///      Three parts of the balance are custodial and not placeable: coin staked through the
    ///      staking module, coin escrowed behind outstanding tier-band NFTs, and escrow already
    ///      released by a band burn but unpulled. Each is owed to a holder and each remains
    ///      claimable after graduation, so placing or burning it would raid a holder's position.
    function _placeableCoin() private view returns (uint256) {
        uint256 custodial = totalTierEscrow + totalPendingEscrowRelease;
        if (stakingActive) custodial += IStakingTotals(address(stakingModule)).totalStaked(address(this));
        uint256 bal = balanceOf(address(this));
        return bal > custodial ? bal - custodial : 0;
    }

    /// @dev Mark the deployer module NFT-skipping before the pool's coin side moves.
    ///
    ///      This instance overrides `_skipNFTDefault` to `false` for every address, so a recipient that
    ///      has never set the flag — including a contract — takes delivery of one NFT id per `unit` it
    ///      receives. Graduation routes the coin through two contracts in a single call: the instance
    ///      sends it to the deployer module, and the module settles it on to the venue's counterparties.
    ///      Without this, the module is minted one id per unit and burns them again on the settle leg —
    ///      a round trip whose cost scales linearly with the collection size and dominates the
    ///      graduation transaction. The module is not a collector and has no use for an id.
    ///
    ///      The flag is set permanently rather than saved and restored (the `buyBonding` idiom): the
    ///      venue-side counterparties the module flags go on receiving coin for the life of the market.
    ///
    ///      This leg is venue-independent — the deployer module is the one counterparty the instance
    ///      always knows. The venue's own counterparties are named by the module through
    ///      `markGraduationSkipNFT` (`IGraduationSkipNFTTarget`), which is the only mechanism that can
    ///      cover a venue whose pool is created during graduation.
    function _markGraduationCounterpartiesSkipNFT() private {
        _setSkipNFT(address(liquidityDeployer), true);
    }

    /// @dev Effective carve ETH for a raise + request. Zero-request / zero-declared short-circuits
    ///      before touching the factory, so a plain `deployLiquidity(0)` never depends on the factory
    ///      exposing carve math. Mirrors the instance's `previewCarve`.
    function _effectiveCarve(uint256 raise, uint256 carveRequestBps) private view returns (uint256) {
        uint256 declared = declaredMaxAllowanceBps;
        if (carveRequestBps == 0 || declared == 0 || raise == 0) return 0;
        return ICarveParamsSource(factory).effectiveCarveEth(raise, declared, carveRequestBps);
    }

    // ┌────────────────────────────────────────┐
    // │      Config paths (delegatecall)       │
    // └────────────────────────────────────────┘
    // No value moves on any of these paths: no ETH transfer, no coin transfer, no curve arithmetic,
    // no staking liability. Every dependency is shared storage in the base (`factory`,
    // `masterRegistry`, `modules`, the tier ladder, the bonding clock), and `msg.sender` is preserved
    // across `delegatecall`, so the factory-only gates (`msg.sender != factory`), the owner gate in
    // `setAgentDelegation`, and the shared `_requireOwnerOrAgent` resolve against the instance's
    // caller. Guards live here only; the instance trampolines carry none.
    //
    // `migrateVault` stays in the instance: it is value-extracting (bare `onlyOwner`, alongside
    // `withdrawDust`/`claimAllFees`) and keeps its specific revert there. `initialize` and
    // `initializeMetadata` also stay.

    /// @dev Structural mirror of `ERC404BondingInstance.ProtocolParams`, field-for-field. Ops needs the
    ///      identical calldata tuple to decode `initializeProtocol`'s argument, and the ABI selector is
    ///      structural — `initializeProtocol((address,address,address,uint256,address))` either way — so
    ///      the two declarations are interchangeable at the wire.
    ///      It is not hoisted into the shared `ERC404BondingStorage` base: Solidity does not expose an
    ///      inherited struct through the derived contract's name, so hoisting would break every
    ///      `ERC404BondingInstance.ProtocolParams` reference, including `ERC404Factory` and the bonding
    ///      invariant suite. `ERC404BondingOpsSelectorParity.t.sol` asserts the two selectors stay
    ///      equal.
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

    /// @notice Update the per-token base URI consumed by `tokenURI(tokenId)`.
    function setMetadataURI(string calldata uri) external {
        _requireOwnerOrAgent();
        metadataURI = uri;
    }

    /// @notice Update the collection-level ERC-7572 `contractURI`. Same owner-or-agent gate as
    ///         `setMetadataURI`, a different slot: `contractURI` is the project document marketplaces
    ///         and `QueryAggregator`'s §6 read-through consume, while `metadataURI` is the per-token
    ///         base for `tokenURI`.
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
    ///         with `w_0 = 1` and is never stored. Every band sits above `idLimit` — that makes band
    ///         ids unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///         `_wrapNFTId(.., idLimit)` where its live idLimit is `totalSupply / unit`; at create
    ///         `totalSupply == maxSupply`, so no ordinary id above `maxSupply / unit` is ever minted, and
    ///         a graduation burn only lowers live `totalSupply`, never that ceiling), so a reserved
    ///         band carves nothing out of the sellable supply. Band size is a product choice bounded
    ///         above by `band_N <= S / w_N` (S = the tier-0 id count), rounded down — an uncapped band
    ///         at exactly `S / w_N` can hold the entire supply if it all concentrated there, and a
    ///         band capped below that is a scarce tier: it can sell out while coin remains, so
    ///         `BandExhausted` is reachable by design on such a band (and reopens as holders
    ///         `mintDown`). A band larger than `S / w_N` would promise ids the coin supply can never
    ///         back.
    /// @dev    Every check below is load-bearing for the burn-safety hook: its
    ///         `id < tierBands[0].idStart` early-out assumes ascending bands strictly above `idLimit`,
    ///         and its `(weight - 1)` escrow arithmetic assumes `weight >= 2`.
    /// @dev    The caller supplies `idEnd` through `TierBand`'s `uint32` field, so a sealed band id is
    ///         bounded by `type(uint32).max` structurally — DN404's `_restrictNFTId` ceiling is met by
    ///         the field width, and a check for it here could never fire. The uint32 rejection is
    ///         in `ERC404Factory._wireMetadata`, where ranges are derived in `uint256` and packed above
    ///         `idLimit`: DN404 permits an `idLimit` up to `0xfffffffe`, so a derived `idEnd` can
    ///         exceed `uint32` on a large supply and is rejected before it is narrowed.
    /// @param  bands Ascending, non-overlapping bands with strictly increasing weights (`w >= 2`).
    function initTierBands(TierBand[] calldata bands) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (_tiersSealed) revert AlreadyInitialized();
        if (unit == 0) revert NotInitialized();
        _tiersSealed = true;

        uint256 n = bands.length;
        if (n == 0) revert InvalidBand();
        uint256 idLimit = maxSupply / unit; // the sealed ceiling: DN404's idLimit at create, when
        // totalSupply == maxSupply. The tier paths read this number at runtime too —
        // graduation lowers live totalSupply but never this ceiling.
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

    /// @dev The window bound is a property of the pair, so both writers enforce it.
    ///      `setBondingMaturityTime` caps `maturity - open` at `MAX_BONDING_DURATION` against the open
    ///      time stored when it runs; moving the open time afterwards moves the same window, so this
    ///      setter re-checks it. Without that, setting open far out, maturity at the cap, then walking
    ///      the open time back would store a pair spanning an arbitrarily long bonding period.
    ///
    ///      A violation is refused rather than repaired by clearing `bondingMaturityTime`: clearing
    ///      would silently lose a date the creator set and other consumers read as real, on the
    ///      success path where nothing tells the caller. The owner moves maturity first, then the
    ///      open time.
    // slither-disable-next-line timestamp
    function setBondingOpenTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        uint256 maturity = bondingMaturityTime;
        if (maturity != 0) {
            // Same two bounds `setBondingMaturityTime` applies, read from the other side of the pair.
            if (maturity <= timestamp) revert MaturityMustBeAfterOpenTime();
            if (maturity - timestamp > MAX_BONDING_DURATION) revert MaturityTooFarAfterOpenTime();
        }
        bondingOpenTime = timestamp;
        emit BondingOpenTimeSet(timestamp);
    }

    /// @dev Bounded on both sides. `MAX_BONDING_DURATION` caps the bonding period at the protocol's
    ///      outer horizon for a creator bond (see the constant's derivation in `ERC404BondingStorage`).
    ///      The cap is measured from `bondingOpenTime`, not from `now`, so the legal window is the
    ///      same whenever within the pre-open period it is set.
    ///
    ///      The ceiling lives at the writer, not only in the escrow: `DeployBondEscrow.forfeit` fixes
    ///      its deadline at the terms the bond was posted under and does not read this value, but the
    ///      field is an owner-or-agent setter that other consumers (the app's bonding-phase logic,
    ///      any on-chain reader) take as a real date. A bound at the writer keeps it safe for all
    ///      of them.
    // slither-disable-next-line timestamp
    function setBondingMaturityTime(uint256 timestamp) external {
        _requireOwnerOrAgent();
        if (timestamp <= block.timestamp) revert TimeMustBeInFuture();
        if (bondingOpenTime == 0) revert OpenTimeMustBeSetFirst();
        if (timestamp <= bondingOpenTime) revert MaturityMustBeAfterOpenTime();
        if (timestamp - bondingOpenTime > MAX_BONDING_DURATION) revert MaturityTooFarAfterOpenTime();
        bondingMaturityTime = timestamp;
        emit BondingMaturityTimeSet(timestamp);
    }

    /// @dev `StateChanged` is declared on `IInstanceLifecycle`, which the instance implements and Ops
    ///      does not (inheriting it would add `instanceType()` to Ops). The qualified
    ///      `emit IInstanceLifecycle.StateChanged(...)` form (solc 0.8.21+) emits the same topic0 from
    ///      the instance's address under delegatecall without interface inheritance.
    function setBondingActive(bool _active) external {
        _requireOwnerOrAgent();
        if (bondingOpenTime == 0) revert OpenTimeNotSet();
        if (_active && graduated) revert CannotActivateAfterLiquidityDeployed();
        bondingActive = _active;
        emit BondingActiveChanged(_active);
        emit IInstanceLifecycle.StateChanged(_active ? STATE_BONDING : STATE_PAUSED);
    }

    /// @notice Activate staking for this instance. Irreversible. Requires stakingModule to be set.
    /// @dev Refused when no vault registered to this instance has a pull-claim model, because the
    ///      staking stream has one source and that source is a pull. `claimAllFees` above credits
    ///      stakers with the ETH balance delta its `claimFees()` sweep produces; a vault with no
    ///      pull-claim model reverts that call by design (`AlignmentEndowmentVault.claimFees` is
    ///      `revert NotSupported()`) and the sweep skips it. An instance whose whole vault set is of
    ///      that kind has a structurally zero delta: `rewardRate` never leaves 0 and stakers accrue
    ///      nothing, and activation is irreversible. The refusal at that irreversible moment is the
    ///      only place this can be said.
    ///
    ///      The pairing itself is allowed: an endowment-aligned ERC404 collection can be created;
    ///      only turning on a rewards stream that cannot be fed is refused, and only while that is
    ///      true — registering a fee-pushing vault alongside the endowment makes the call succeed.
    ///
    ///      The condition is read off the vaults themselves rather than a list of type names, so a
    ///      new vault type answers for itself; `_vaultSetCannotFundStaking` explains how it is asked.
    ///      An instance with no registered vault set is not refused: that is an instance the registry
    ///      does not know, which `ERC404Factory` never creates and which `claimAllFees` declines to
    ///      credit through its `isRegisteredInstance` gate.
    function activateStaking() external {
        _requireOwnerOrAgent();
        if (address(stakingModule) == address(0)) revert StakingModuleNotSet();
        if (stakingActive) revert StakingAlreadyActive();
        if (_vaultSetCannotFundStaking()) revert NoFeeClaimingVault();
        stakingActive = true;
        stakingModule.enableStaking();
        emit StakingActivated(address(stakingModule));
    }

    /// @dev The instance's registered vault set. One accessor for `claimAllFees`, which pulls on the
    ///      set, and the guard below, which asks whether pulling on it could yield anything: the ABI
    ///      decode of a returned `address[]` costs bytes on a contract this close to EIP-170, and the
    ///      two must mean the same set.
    function _instanceVaults() internal view returns (address[] memory) {
        return masterRegistry.getInstanceVaults(address(this));
    }

    /// @dev Gas handed to one vault's `claimFees()` probe. Sized for a refusal, not for a claim: a
    ///      clone hop plus an unconditional revert costs a few thousand gas. See
    ///      `_vaultSetCannotFundStaking` for why an under-budgeted probe is safe.
    uint256 private constant _PROBE_GAS = 50_000;

    /// @dev True when the instance has a registered vault set and every member of it answers
    ///      `claimFees()` with "I have no pull-claim model". See `activateStaking` for why that, and
    ///      not the empty set, is the condition.
    ///
    ///      The probe asks each vault the question the sweep asks, through a `staticcall` so the
    ///      asking cannot move anything. A vault that would really deliver fees fails that staticcall
    ///      — paying out writes storage and moves ETH, which a static context disallows — so failure
    ///      alone says nothing. What separates the two is the answer's content: a vault with no
    ///      pull-claim model refuses by design, with `NotSupported()`, and that is the only reply
    ///      counted as "not a source". Everything else — success, an empty revert from the write the
    ///      staticcall blocked, `NothingToClaim`, an unknown vault type — counts as a source.
    ///      Refusing to activate is the disruptive outcome, so only the explicit "there is nothing
    ///      to pull here" signal earns it.
    ///
    ///      The gas cap is load-bearing. A vault that really has fees to deliver tries to move ETH,
    ///      and a value-bearing call inside a static context is an exceptional halt, not an ordinary
    ///      revert: it consumes every unit of gas forwarded to that frame. Uncapped, one funded vault
    ///      burns 63/64 of the gas in the transaction. The cap bounds the walk at `_PROBE_GAS` per
    ///      vault. Running out of gas is not `NotSupported`, so a probe that dies early reads as a
    ///      source, the outcome that lets activation proceed. `NotSupported` is an unconditional
    ///      first-statement revert, so the cap cannot cut a real refusal short.
    // slither-disable-next-line calls-loop,low-level-calls
    function _vaultSetCannotFundStaking() internal view returns (bool) {
        address[] memory allVaults = _instanceVaults();
        for (uint256 i = 0; i < allVaults.length; i++) {
            (bool ok, bytes memory ret) =
                allVaults[i].staticcall{ gas: _PROBE_GAS }(abi.encodeWithSelector(IAlignmentVault.claimFees.selector));
            if (ok || ret.length < 4 || bytes4(ret) != NotSupported.selector) return false;
        }
        return allVaults.length != 0;
    }

    // ┌─────────────────────────┐
    // │  DN404 concrete stubs   │
    // └─────────────────────────┘
    // DN404 leaves name()/symbol()/_tokenURI() abstract. Ops must be concrete (it is deployed as the
    // shared delegatecall target), so it provides trivial stubs. Ops is never a token surface, so
    // these are never observed; they add code only, no storage.

    function name() public view virtual override returns (string memory) {
        return "";
    }

    function symbol() public view virtual override returns (string memory) {
        return "";
    }

    function _tokenURI(uint256) internal view virtual override returns (string memory) {
        return "";
    }

    /// @dev Matches `ERC404BondingInstance`'s override. Ops runs under delegatecall in the
    ///      instance's storage, so `getSkipNFT` must resolve the same default here as there for an
    ///      address that has never set the flag — otherwise `mintDown`'s escrow release would skip
    ///      NFT materialization for contract holders the instance itself mints for (DN404's base
    ///      default is `extcodesize(owner) != 0`).
    function _skipNFTDefault(address) internal pure virtual override returns (bool) {
        return false;
    }
}
