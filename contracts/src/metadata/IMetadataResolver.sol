// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IComponentModule} from "../interfaces/IComponentModule.sol";

/// @title IMetadataResolver
/// @notice Generic metadata-resolution seam for ERC404 instances (ADR-0006 / ADR-0007).
/// @dev A resolver returns an *augmented* tokenURI for `id`, served over the instance's
///      base metadata. An empty string means "decline" — the instance (or a router)
///      falls through to the next resolver / collection base. Resolvers are singletons
///      keyed by instance address; they hold no custody. The instance's `_tokenURI`
///      calls this inside a defensive try/catch, so a reverting resolver never bricks
///      tokenURI. Implementations MUST be view and MUST NOT revert on unminted ids
///      (holder may be address(0)).
interface IMetadataResolver is IComponentModule {
    /// @param instance The ERC404 instance whose token is being resolved.
    /// @param id       The token id.
    /// @param holder   The current NFT owner (address(0) if unminted).
    /// @return The augmented URI, or "" to decline (fall through).
    function resolve(address instance, uint256 id, address holder)
        external
        view
        returns (string memory);
}
