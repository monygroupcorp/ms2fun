// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProfileRegistry
 * @notice Account-level profile pointer registry. Each address owns exactly one
 *         profile URI pointing at off-chain (IPFS / Arweave / data:) JSON. See ADR-0004.
 */
interface IProfileRegistry {
    /// @notice Set/replace the caller's own profile pointer. URI must be a valid metadata URI.
    function setProfile(string calldata uri) external;

    /// @notice Clear the caller's profile pointer.
    function clearProfile() external;

    /// @notice The profile pointer for `account` (empty string if unset).
    function profileURI(address account) external view returns (string memory);
}
