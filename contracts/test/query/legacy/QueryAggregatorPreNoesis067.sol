// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../../../src/shared/SafeOwnableUUPS.sol";

/// @title QueryAggregatorPreNoesis067
/// @notice LOAD-BEARING storage-layout snapshot of QueryAggregator as deployed BEFORE noesis-067.
/// @dev Reproduces the EXACT pre-067 state-var order — the layout live behind the UUPS proxy:
///
///        slot 0: masterRegistry          (address)
///        slot 1: featuredQueueManager     (address)
///        slot 2: globalMessageRegistry     (address)   <-- the slot noesis-067 deprecates in place
///        (MAX_QUERY_LIMIT is constant — no slot)
///        slot 3: _initialized              (bool)
///
///      The upgrade test seeds this layout behind a real ERC1967 proxy, upgrades the SAME proxy to the
///      post-067 QueryAggregator (which keeps slot 2 as `__deprecated_globalMessageRegistry`), and
///      asserts every pre-existing slot reads back identically. If the deprecation had REMOVED the slot
///      instead of retaining a placeholder, `_initialized` (slot 3) would shift into slot 2 and the
///      registry pointers would corrupt — this test would fail loudly. Only the fields the layout proof
///      needs are reproduced; the query methods are irrelevant to storage and omitted.
contract QueryAggregatorPreNoesis067 is SafeOwnableUUPS {
    error InvalidAddress();

    // ── storage: order and widths must match the deployed pre-067 contract exactly ──
    address public masterRegistry; // slot 0
    address public featuredQueueManager; // slot 1
    address public globalMessageRegistry; // slot 2

    uint256 public constant MAX_QUERY_LIMIT = 50; // constant — occupies no slot

    bool private _initialized; // slot 3

    constructor() {
        _initializeOwner(msg.sender);
    }

    /// @dev The original 4-argument initializer that STORED globalMessageRegistry.
    function initialize(
        address _masterRegistry,
        address _featuredQueueManager,
        address _globalMessageRegistry,
        address _owner
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (_masterRegistry == address(0)) revert InvalidAddress();
        if (_featuredQueueManager == address(0)) revert InvalidAddress();
        if (_globalMessageRegistry == address(0)) revert InvalidAddress();
        if (_owner == address(0)) revert InvalidAddress();

        _initialized = true;
        _setOwner(_owner);

        masterRegistry = _masterRegistry;
        featuredQueueManager = _featuredQueueManager;
        globalMessageRegistry = _globalMessageRegistry;
    }
}
