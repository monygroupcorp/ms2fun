// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICurationRegistry
 * @notice Curations: named, published sets of collections and pieces, assembled by anyone.
 * @dev A curation is an act of selection, not of issuance — the curator mints nothing and owns
 *      nothing new. So the chain stores what selection needs and no more: who assembled it, when it
 *      last changed, whether it is on view, and ONE pointer at the JSON that carries the name, the
 *      note and the set itself (ADR-0004, the same backend-free model as `ProfileRegistry`).
 */
interface ICurationRegistry {
    /**
     * @notice One curation's on-chain record.
     * @param curator The address that published it. Only the curator retires, restores, or changes
     *        who may edit; the record never transfers, so a curation always names who assembled it.
     * @param updatedAt Unix seconds of the last write. Off-chain ordering reads this; nothing
     *        on-chain branches on it.
     * @param retired True when the curator has taken it off view. The record and its id survive —
     *        a link to a retired curation resolves to a retired curation, not to nothing.
     * @param uri Pointer at the curation JSON (`ipfs://`, `ar://`, `https://`, or inline
     *        `data:application/json`). The set lives there; see `MetadataUtils.isValidURI`.
     */
    struct Curation {
        address curator;
        uint64 updatedAt;
        bool retired;
        string uri;
    }

    /// @notice Emitted when a curation is first published. `id` is dense and 1-based.
    event CurationCreated(uint256 indexed id, address indexed curator, string uri);

    /// @notice Emitted on every pointer change, naming the editor — curator or collaborator.
    event CurationUpdated(uint256 indexed id, address indexed editor, string uri);

    /// @notice Emitted when the curator takes a curation off view (`retired`) or puts it back.
    event CurationRetired(uint256 indexed id, bool retired);

    /// @notice Emitted when the curator grants or revokes another address's edit rights.
    event CurationCollaboratorSet(uint256 indexed id, address indexed collaborator, bool allowed);

    /// @notice Publish a new curation. Open to any address. Returns its id.
    function createCuration(string calldata uri) external returns (uint256 id);

    /// @notice Repoint an existing curation. Curator or collaborator only.
    function setCurationURI(uint256 id, string calldata uri) external;

    /// @notice Take a curation off view, or put it back. Curator only.
    function setRetired(uint256 id, bool retired) external;

    /// @notice Grant or revoke another address's right to edit this curation. Curator only.
    function setCollaborator(uint256 id, address collaborator, bool allowed) external;

    /// @notice How many curations have ever been published. Ids run 1..totalCurations().
    function totalCurations() external view returns (uint256);

    /// @notice One curation's record. Reverts on an id that was never published.
    function getCuration(uint256 id) external view returns (Curation memory);

    /// @notice Many records in one call, in the order asked. Reverts on any unknown id.
    function getCurations(uint256[] calldata ids) external view returns (Curation[] memory);

    /**
     * @notice The ids `curator` published, oldest first — retired ones included, since a curation
     *         taken off view is still theirs.
     * @dev Returns the whole list; it grows with every curation that address publishes and is never
     *      pruned. An off-chain read path, like the rest of this section.
     */
    function curationIdsOf(address curator) external view returns (uint256[] memory);

    /// @notice True when `who` may repoint curation `id` — its curator, or a collaborator on it.
    function canEdit(uint256 id, address who) external view returns (bool);

    /**
     * @notice A page of the curations that are on view, newest first, skipping `offset` of them.
     * @dev `offset` counts ON-VIEW curations, not ids, and `limit` is clamped to `totalCurations()`.
     */
    function latestCurations(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Curation[] memory curations);
}
