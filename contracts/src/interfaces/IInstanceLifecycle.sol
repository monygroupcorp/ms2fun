// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ── Standard lifecycle state constants ────────────────────────────────────────
// The recommended standard states. Instance types SHOULD use these where applicable
// and MAY define additional bytes32 states. Any bytes32 value is valid, so indexers
// must handle unknown states gracefully.

// ── Standard instance type constants ──────────────────────────────────────────
// Used by instanceType() — the on-chain source of truth for instance type.

bytes32 constant TYPE_ERC404 = keccak256("erc404");
bytes32 constant TYPE_ERC1155 = keccak256("erc1155");
bytes32 constant TYPE_ERC721 = keccak256("erc721");

bytes32 constant STATE_NOT_STARTED = keccak256("not-started"); // Deployed, not open
bytes32 constant STATE_MINTING = keccak256("minting"); // Accepting mints / open editions
bytes32 constant STATE_BONDING = keccak256("bonding"); // Active bonding curve
bytes32 constant STATE_ACTIVE = keccak256("active"); // General "live" state
bytes32 constant STATE_GRADUATED = keccak256("graduated"); // Bonding complete, LP deployed
bytes32 constant STATE_PAUSED = keccak256("paused"); // Suspended
bytes32 constant STATE_ENDED = keccak256("ended"); // Permanently closed

/**
 * @title IInstanceLifecycle
 * @notice Standardized lifecycle events for all MS2 instance types.
 * @dev All instance types (ERC404, ERC1155, ERC721) MUST implement.
 *      Enables unified state-based filtering on the discovery page without requiring
 *      instance-type-specific indexer logic.
 *
 *      State is maintained entirely off-chain by the indexer; no on-chain storage tracks
 *      lifecycle. The STATE_* constants above are the recommended standard set; instance
 *      types may emit custom states beyond these.
 *
 *      Indexer integration flow:
 *        1. Discover instances via MasterRegistry.CreatorInstanceAdded events
 *        2. Subscribe to StateChanged across all addresses for state updates
 *        3. Replay StateChanged from each instance's deploy block to bootstrap
 */
interface IInstanceLifecycle {
    /**
     * @notice Returns the type identifier for this instance.
     * @dev MUST be implemented as a pure function returning a compile-time constant
     *      (e.g. TYPE_ERC404, TYPE_ERC1155, TYPE_ERC721, or a custom bytes32).
     *      MasterRegistry calls this during registerInstance — failure reverts registration,
     *      making it the enforcement gate for IInstanceLifecycle compliance.
     * @return Bytes32 type identifier matching one of the TYPE_* constants (or custom).
     */
    function instanceType() external pure returns (bytes32);

    /**
     * @notice Emitted when the instance transitions to a new lifecycle state.
     * @param newState The state being entered. Should match a STATE_* constant
     *        where applicable, but may be any bytes32 for custom states.
     *        Block timestamp is available from the enclosing block; not duplicated here.
     */
    event StateChanged(bytes32 indexed newState);
}
