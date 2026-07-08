// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Tier enforcement mode for PasswordTierGating.
enum TierType {
    VOLUME_CAP,
    TIME_BASED
}

/// @notice Per-instance tier configuration.
/// @dev File-level declaration so factories can thread it through `createInstance`
///      and pass the exact same type to `configureFor` at deploy time.
struct TierConfig {
    TierType tierType;
    bytes32[] passwordHashes;
    uint256[] volumeCaps; // For VOLUME_CAP mode
    uint256[] tierUnlockTimes; // For TIME_BASED mode (relative to bondingOpenTime)
}

/// @notice Configuration surface of PasswordTierGatingModule.
/// @dev Split out so factories can call `configureFor` at create time without
///      importing the concrete module. Initial config may be authored by a
///      registered factory (at deploy) OR by the instance owner (post-create);
///      subsequent updates are owner-only.
interface IPasswordTierGatingModule {
    function configureFor(address instance, TierConfig calldata config) external;
}
