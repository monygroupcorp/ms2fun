// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Per-edition merkle-allowlist configuration for one edition of one instance.
/// @dev Split out so factories/owners can call `configureFor` without importing the concrete module.
///      One `MerkleConfig` describes ALL tiers of a single edition. Configure each edition with its
///      own call. ERC404 instances (single curve, no editions) use editionId = 0.
struct MerkleConfig {
    /// @notice Authoritative edition id these roots gate. Must match the id the instance forwards to
    ///         canMint. ERC404 = 0.
    uint256 editionId;
    /// @notice One merkle root per tier (tier index = position). A single-gate allowlist is length 1.
    ///         Each root is built off-chain over leaves `keccak256(bytes.concat(keccak256(abi.encode(
    ///         address user, uint256 maxQty))))` with Solady commutative sorted-pair internal nodes —
    ///         byte-identical to app/src/lib/merkle.ts (extended from address-only to (address, maxQty)).
    bytes32[] roots;
    /// @notice Absolute unix open timestamp per tier (parallel to `roots`). A tier is claimable once
    ///         block.timestamp >= tierOpenTimes[tier]. Use 0 for "open immediately". Absolute (not
    ///         relative to the edition openTime) so a creator schedules phases explicitly.
    uint256[] tierOpenTimes;
}

/// @notice Configuration surface of MerkleGatingModule.
/// @dev Initial config may be authored by the instance's registering factory OR the instance owner
///      (post-create). Subsequent updates are owner-only. Called once per edition.
interface IMerkleGatingModule {
    function configureFor(address instance, MerkleConfig calldata config) external;
}
