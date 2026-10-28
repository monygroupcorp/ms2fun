// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MetadataUtils } from "../shared/libraries/MetadataUtils.sol";
import { ICurationRegistry } from "./interfaces/ICurationRegistry.sol";

/**
 * @title CurationRegistry
 * @notice Minimal, ownerless, non-upgradeable registry of curations — named, published sets of
 *         collections and pieces that any address can assemble.
 * @dev Same shape as `ProfileRegistry`: no owner, no upgrade path, no admin surface, no fee. Every
 *      other way onto a noesis discovery surface needs something the caller must first have or buy
 *      (a deployed instance, a featured-queue rental); selection needs neither, so `createCuration`
 *      takes no value, checks no registry, and admits any address.
 *
 *      The chain holds the minimum selection needs: curator, last write, on-view flag, and one
 *      pointer at the JSON carrying the name, the note and the set (ADR-0004). The set stays off-chain
 *      so a curation of two pieces and one of two hundred cost the same to publish.
 *
 *      A collaborator may repoint the curation (assembling is the shared act); only the curator may
 *      retire it or change who collaborates. The record never transfers: a curation permanently names
 *      who assembled it.
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
    function setCurationURI(uint256 id, string calldata uri) external known(id) {
        Curation storage c = _curations[id];
        if (msg.sender != c.curator && !_collaborators[id][msg.sender]) revert NotEditor();
        if (!MetadataUtils.isValidURI(uri)) revert InvalidURI();

        c.uri = uri;
        c.updatedAt = uint64(block.timestamp);

        emit CurationUpdated(id, msg.sender, uri);
    }

    /// @inheritdoc ICurationRegistry
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
     *      as a hole, so a caller asking for twelve gets twelve if twelve exist. `offset` counts
     *      on-view curations, not ids, so paging stays correct while a curator retires things. The
     *      walk is descending over ids and bounded by `totalCurations()`; it is an off-chain read path
     *      and callers page rather than ask for all.
     *
     *      `limit` is clamped to `totalCurations()` before allocation; a page can never hold more rows
     *      than there are curations, so nothing is truncated.
     */
    function latestCurations(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Curation[] memory curations)
    {
        uint256 count = _count;
        if (limit > count) limit = count;
        ids = new uint256[](limit);
        curations = new Curation[](limit);
        if (limit == 0) return (ids, curations);

        uint256 seen;
        uint256 filled;
        for (uint256 id = count; id > 0 && filled < limit; id--) {
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
