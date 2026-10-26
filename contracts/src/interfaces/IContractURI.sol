// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IContractURI (ERC-7572)
/// @notice Minimal read interface for the collection-level metadata URI.
///         Standalone rather than part of IInstance/IFactoryInstance/IInstanceLifecycle, so
///         instances can expose contractURI() without every implementer of those interfaces
///         needing it.
interface IContractURI {
    function contractURI() external view returns (string memory);
}
