// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ERC404BondingStorage,
    InsufficientTokenBalance,
    TokenAmountMustBePositive,
    TokenAmountMustRepresentNFT,
    BalanceMismatchAfterReroll,
    TiersNotConfigured,
    InvalidBand,
    BandExhausted,
    NotBandId,
    NotTierZeroId,
    TierOpFailed
} from "./ERC404BondingStorage.sol";

/**
 * @title ERC404BondingOps
 * @notice Externalized reroll body for `ERC404BondingInstance` (EIP-170 diet — noesis-091). This
 *         contract is NEVER deployed as a token nor called directly: the master instance reaches it via
 *         a discard-returndata `delegatecall`, so `rerollSelectedNFTs` executes in the instance's own
 *         storage context. It inherits the identical `ERC404BondingStorage` base as the instance, so the
 *         storage layout is byte-identical (CI-gated) and the shared DN404 `$` / Ownable owner /
 *         ReentrancyGuard slots resolve to the same fixed hashed slots across the delegatecall boundary.
 * @dev    HARD CONSTRAINT: Ops declares ZERO storage of its own outside the inherited base. Adding any
 *         state variable here is a storage-collision bug — put new state in `ERC404BondingStorage`.
 *         `_ops` immutable is deliberately NOT here: immutables live in code, not storage.
 */
contract ERC404BondingOps is ERC404BondingStorage {
    // ┌─────────────────────────┐
    // │   Reroll (delegatecall) │
    // └─────────────────────────┘

    /// @notice Reroll body, moved verbatim from the instance. Keeps `nonReentrant`: the guard uses the
    ///         shared fixed slot, so it engages in the instance's context under delegatecall. No owner
    ///         gate (matches the instance's historic access exactly).
    function rerollSelectedNFTs(uint256 tokenAmount, uint256[] calldata exemptedNFTIds) external nonReentrant {
        if (tokenAmount == 0) revert TokenAmountMustBePositive();
        if (balanceOf(msg.sender) < tokenAmount) revert InsufficientTokenBalance();

        DN404Storage storage $ = _getDN404Storage();
        AddressData storage addressData = $.addressData[msg.sender];

        uint256 unitSize = _unit();
        uint256 exemptCount = exemptedNFTIds.length;
        if (tokenAmount < exemptCount * unitSize) revert TokenAmountMustRepresentNFT();

        uint256 rerollAmount = tokenAmount - (exemptCount * unit);
        if (rerollAmount / unit == 0) revert TokenAmountMustRepresentNFT(); // round down: standard integer NFT count

        uint256 balanceBefore = addressData.balance;

        emit RerollInitiated(msg.sender, tokenAmount, exemptedNFTIds);

        for (uint256 i = 0; i < exemptCount; i++) {
            _initiateTransferFromNFT(msg.sender, address(this), exemptedNFTIds[i], msg.sender);
        }

        _transfer(msg.sender, address(this), rerollAmount);

        bool originalSkipNFT = getSkipNFT(msg.sender);
        _setSkipNFT(msg.sender, false);
        _transfer(address(this), msg.sender, rerollAmount);
        _setSkipNFT(msg.sender, originalSkipNFT);

        for (uint256 i = 0; i < exemptCount; i++) {
            _initiateTransferFromNFT(address(this), msg.sender, exemptedNFTIds[i], address(this));
        }

        if (addressData.balance != balanceBefore) revert BalanceMismatchAfterReroll();

        emit RerollCompleted(msg.sender, tokenAmount);
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
        (uint256 idx, uint256 weight) = _bandOfId(bandId);

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

    /// @dev Resolve an id to the band containing it. Reverts `NotBandId` for ordinary ids.
    function _bandOfId(uint256 id) private view returns (uint256 idx, uint256 weight) {
        uint256 n = tierBands.length;
        for (uint256 i; i < n; ++i) {
            TierBand storage b = tierBands[i];
            if (id >= b.idStart && id <= b.idEnd) return (i, b.weight);
        }
        revert NotBandId();
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
