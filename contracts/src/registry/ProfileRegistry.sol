// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MetadataUtils} from "../shared/libraries/MetadataUtils.sol";
import {IProfileRegistry} from "./interfaces/IProfileRegistry.sol";

/**
 * @title ProfileRegistry
 * @notice Minimal, ownerless, non-upgradeable account profile registry (ADR-0004).
 * @dev The lean identity primitive: every address self-edits ONE `profileURI` pointing at
 *      decentralized JSON (IPFS / Arweave / inline data:). There is no admin surface — no owner,
 *      no upgrade path, no curation — because every write only ever touches `msg.sender`'s own
 *      entry. The feature-rich profile (name, avatar, links, socials) lives in the off-chain
 *      content behind the URI; the chain stores only the pointer. Reads are event-indexable via
 *      `ProfileUpdated`.
 */
contract ProfileRegistry is IProfileRegistry {

    // ┌─────────────────────────┐
    // │      Custom Errors      │
    // └─────────────────────────┘

    error InvalidURI();

    // ┌─────────────────────────┐
    // │      State Variables    │
    // └─────────────────────────┘

    mapping(address => string) private _profileURI;

    // `ProfileUpdated(address indexed account, string uri)` is declared in IProfileRegistry.

    // ┌─────────────────────────┐
    // │     Write Functions     │
    // └─────────────────────────┘

    /// @inheritdoc IProfileRegistry
    function setProfile(string calldata uri) external {
        if (!MetadataUtils.isValidURI(uri)) revert InvalidURI();
        _profileURI[msg.sender] = uri;
        emit ProfileUpdated(msg.sender, uri);
    }

    /// @inheritdoc IProfileRegistry
    function clearProfile() external {
        delete _profileURI[msg.sender];
        emit ProfileUpdated(msg.sender, "");
    }

    // ┌─────────────────────────┐
    // │      Read Functions     │
    // └─────────────────────────┘

    /// @inheritdoc IProfileRegistry
    function profileURI(address account) external view returns (string memory) {
        return _profileURI[account];
    }
}
