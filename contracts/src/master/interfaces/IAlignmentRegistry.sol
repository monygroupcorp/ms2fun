// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAlignmentRegistry
 * @notice Interface for the Alignment Registry — manages alignment targets and ambassadors
 */
interface IAlignmentRegistry {
    struct AlignmentTarget {
        uint256 id;
        string title;
        string description;
        string metadataURI;
        uint256 approvedAt;
        bool active;
    }

    struct AlignmentAsset {
        address token;
        string symbol;
        string info;
        string metadataURI;
    }

    /// @notice Venue that an alignment target's token trades on. `NONE` = no route configured.
    enum Venue {
        NONE,
        UNI_V4,
        ZAMM,
        ALGEBRA
    }

    /// @notice Compact, owner-curated acquisition route for a target's token.
    /// @dev Only the fields a given venue's typed swap leg consumes are populated; all others must be zero.
    ///      - UNI_V4  uses {fee, tickSpacing}
    ///      - ZAMM    uses {feeOrHook}
    ///      - ALGEBRA derives its pool from the token pair (dynamic fees) and carries no params
    struct AcquireRoute {
        Venue venue;
        uint24 fee; // UNI_V4
        int24 tickSpacing; // UNI_V4
        uint256 feeOrHook; // ZAMM
    }

    // Events
    event AlignmentTargetRegistered(uint256 indexed targetId, string title);
    event AlignmentTargetDeactivated(uint256 indexed targetId);
    event AlignmentTargetUpdated(uint256 indexed targetId);
    event AmbassadorAdded(uint256 indexed targetId, address indexed ambassador);
    event AmbassadorRemoved(uint256 indexed targetId, address indexed ambassador);
    event CommunityPayoutSet(uint256 indexed targetId, address indexed payout);
    event AcquireRouteSet(uint256 indexed targetId, address indexed token, Venue venue);

    // Alignment Target Functions
    function registerAlignmentTarget(
        string memory title,
        string memory description,
        string memory metadataURI,
        AlignmentAsset[] memory assets
    ) external returns (uint256);

    function getAlignmentTarget(uint256 targetId) external view returns (AlignmentTarget memory);

    function getAlignmentTargetAssets(uint256 targetId) external view returns (AlignmentAsset[] memory);

    function isAlignmentTargetActive(uint256 targetId) external view returns (bool);

    function deactivateAlignmentTarget(uint256 targetId) external;

    function updateAlignmentTarget(uint256 targetId, string memory description, string memory metadataURI) external;

    // Ambassador Functions
    function addAmbassador(uint256 targetId, address ambassador) external;
    function removeAmbassador(uint256 targetId, address ambassador) external;
    function getAmbassadors(uint256 targetId) external view returns (address[] memory);
    function isAmbassador(uint256 targetId, address account) external view returns (bool);

    // Token Lookup
    function isTokenInTarget(uint256 targetId, address token) external view returns (bool);

    // Community Payout
    function setCommunityPayout(uint256 targetId, address payout) external;
    function getCommunityPayout(uint256 targetId) external view returns (address);

    // Acquire Routing (owner-curated venue classification for a target's token)
    function setAcquireRoute(uint256 targetId, address token, AcquireRoute calldata route) external;
    function getAcquireRoute(uint256 targetId, address token) external view returns (AcquireRoute memory);
}
