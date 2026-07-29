// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IContractURI (ERC-7572)
/// @notice Minimal read interface for the collection-level metadata URI.
///         Kept standalone — deliberately NOT added to IInstance/IFactoryInstance/
///         IInstanceLifecycle so concrete instances can expose contractURI() without
///         forcing a mock-implementer cascade across the shared instance interfaces.
interface IContractURI {
    function contractURI() external view returns (string memory);
}
