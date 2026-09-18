// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MetadataUtils } from "../shared/libraries/MetadataUtils.sol";
import { ICurationRegistry } from "./interfaces/ICurationRegistry.sol";

/**
 * @title CurationRegistry
 * @notice Minimal, ownerless, non-upgradeable registry of curations — named, published sets of
 *         collections and pieces that any address can assemble.
 * @dev Sibling of `ProfileRegistry`, and deliberately the same shape: no owner, no upgrade path, no
 *      admin surface, no fee. The reason is the whole point of the contract. Every other way onto
 *      a noesis discovery surface runs through something the caller must first have or buy — a
 *      deployed instance to be listed at all, a `PromotionBadges.purchaseBadge` payment to be
 *      ranked in the featured grid. Selection is the one creative act on this platform that needs
 *      neither, so nothing here gates it: `createCuration` takes no value, checks no registry, and
 *      admits any address.
 *
 *      What the chain holds is the minimum selection needs — curator, last write, on-view flag, and
 *      one pointer at the JSON carrying the name, the note and the set (ADR-0004). Keeping the set
 *      itself off-chain is what makes a curation of two pieces and a curation of two hundred cost
 *      the same to publish, which a surface meant for people who buy rather than mint has to be.
 *
 *      Authority is split so the two halves can move independently: a COLLABORATOR may repoint the
 *      curation (assembling is the shared act), and only the CURATOR may retire it or change who
 *      collaborates. The record never transfers — a curation permanently names who assembled it.
 */
contract CurationRegistry is ICurationRegistry {
    // ┌─────────────────────────┐
    // │      Custom Errors      │
    // └─────────────────────────┘

    error InvalidURI();
    error UnknownCuration();
    error NotCurator();
    error NotEditor();
    error InvalidCollaborator();

    // ┌─────────────────────────┐
    // │      State Variables    │
    // └─────────────────────────┘

    /// @dev Ids are dense and 1-based, so id 0 is always "no curation" and needs no sentinel.
    uint256 private _count;

    mapping(uint256 => Curation) private _curations;
    mapping(uint256 => mapping(address => bool)) private _collaborators;
    mapping(address => uint256[]) private _byCurator;

    // ┌─────────────────────────┐
    // │        Modifiers        │
    // └─────────────────────────┘

    modifier known(uint256 id) {
        _requireKnown(id);
        _;
    }

    function _requireKnown(uint256 id) private view {
        if (id == 0 || id > _count) revert UnknownCuration();
    }

    // ┌─────────────────────────┐
    // │     Write Functions     │
    // └─────────────────────────┘

    /// @inheritdoc ICurationRegistry
    // slither-disable-next-line timestamp
    function createCuration(string calldata uri) external returns (uint256 id) {
        if (!MetadataUtils.isValidURI(uri)) revert InvalidURI();

        unchecked {
            id = ++_count;
        }
        _curations[id] = Curation({ curator: msg.sender, updatedAt: uint64(block.timestamp), retired: false, uri: uri });
        _byCurator[msg.sender].push(id);

        emit CurationCreated(id, msg.sender, uri);
    }

    /// @inheritdoc ICurationRegistry
    // slither-disable-next-line timestamp
    function setCurationURI(uint256 id, string calldata uri) external known(id) {
        Curation storage c = _curations[id];
        if (msg.sender != c.curator && !_collaborators[id][msg.sender]) revert NotEditor();
        if (!MetadataUtils.isValidURI(uri)) revert InvalidURI();

        c.uri = uri;
        c.updatedAt = uint64(block.timestamp);

        emit CurationUpdated(id, msg.sender, uri);
    }

    /// @inheritdoc ICurationRegistry
    // slither-disable-next-line timestamp
    function setRetired(uint256 id, bool retired) external known(id) {
        Curation storage c = _curations[id];
        if (msg.sender != c.curator) revert NotCurator();

        c.retired = retired;
        c.updatedAt = uint64(block.timestamp);

        emit CurationRetired(id, retired);
    }

    /// @inheritdoc ICurationRegistry
    function setCollaborator(uint256 id, address collaborator, bool allowed) external known(id) {
        Curation storage c = _curations[id];
        if (msg.sender != c.curator) revert NotCurator();
        // The curator already edits by virtue of being the curator; a row saying so could be
        // revoked, which would read as removing their own access and would not.
        if (collaborator == address(0) || collaborator == c.curator) revert InvalidCollaborator();

        _collaborators[id][collaborator] = allowed;

        emit CurationCollaboratorSet(id, collaborator, allowed);
    }

    // ┌─────────────────────────┐
    // │      Read Functions     │
    // └─────────────────────────┘

    /// @inheritdoc ICurationRegistry
    function totalCurations() external view returns (uint256) {
        return _count;
    }

    /// @inheritdoc ICurationRegistry
    function getCuration(uint256 id) external view known(id) returns (Curation memory) {
        return _curations[id];
    }

    /// @inheritdoc ICurationRegistry
    function getCurations(uint256[] calldata ids) external view returns (Curation[] memory out) {
        out = new Curation[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (id == 0 || id > _count) revert UnknownCuration();
            out[i] = _curations[id];
        }
    }

    /// @inheritdoc ICurationRegistry
    function curationIdsOf(address curator) external view returns (uint256[] memory) {
        return _byCurator[curator];
    }

    /// @inheritdoc ICurationRegistry
    function canEdit(uint256 id, address who) external view returns (bool) {
        if (id == 0 || id > _count) return false;
        return who == _curations[id].curator || _collaborators[id][who];
    }

    /**
     * @inheritdoc ICurationRegistry
     * @dev Returns only curations that are on view: a retired one is skipped rather than returned
     *      as a hole, so a caller asking for twelve gets twelve if twelve exist. `offset` therefore
     *      counts ON-VIEW curations, not ids — paging stays correct while a curator retires things
     *      underneath it. The walk is descending over ids and bounded by `totalCurations()`; this is
     *      an off-chain read path (no contract calls it) and callers page rather than ask for all.
     */
    function latestCurations(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Curation[] memory curations)
    {
        ids = new uint256[](limit);
        curations = new Curation[](limit);
        if (limit == 0) return (ids, curations);

        uint256 seen;
        uint256 filled;
        for (uint256 id = _count; id > 0 && filled < limit; id--) {
            Curation storage c = _curations[id];
            if (c.retired) continue;
            if (seen++ < offset) continue;
            ids[filled] = id;
            curations[filled] = c;
            filled++;
        }

        // Trim to what was actually found — the tail of a short last page is not zero-valued rows.
        assembly ("memory-safe") {
            mstore(ids, filled)
            mstore(curations, filled)
        }
    }
}
