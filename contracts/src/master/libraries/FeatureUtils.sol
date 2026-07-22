// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FeatureUtils
 * @notice Utility functions for feature matrix operations
 */
library FeatureUtils {
    // Pluggable component tag categories (matched by ComponentRegistry)
    bytes32 public constant GATING = keccak256("gating");
    bytes32 public constant LIQUIDITY_DEPLOYER = keccak256("liquidity");
    bytes32 public constant DYNAMIC_PRICING = keccak256("dynamic_pricing");
    bytes32 public constant STAKING = keccak256("staking");

    // Metadata-resolution component tags (ADR-0006 / ADR-0007)
    bytes32 public constant RESOLVER = keccak256("resolver");
    bytes32 public constant OVERLAY = keccak256("overlay");
    bytes32 public constant TIER = keccak256("tier");

    /**
     * @notice Check if a feature array contains a specific feature
     * @param features Array of feature IDs
     * @param featureId Feature ID to check
     * @return True if feature is present
     */
    function hasFeature(bytes32[] memory features, bytes32 featureId) internal pure returns (bool) {
        for (uint256 i = 0; i < features.length; i++) {
            if (features[i] == featureId) {
                return true;
            }
        }
        return false;
    }
}

