// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { FeatureUtils } from "../../src/master/libraries/FeatureUtils.sol";

/**
 * @title FeatureUtilsTest
 * @notice Test suite for the FeatureUtils library (hasFeature)
 */
contract FeatureUtilsTest is Test {
    // Feature IDs used to exercise hasFeature
    bytes32 constant BONDING_CURVE = keccak256("BONDING_CURVE");
    bytes32 constant LIQUIDITY_POOL = keccak256("LIQUIDITY_POOL");
    bytes32 constant CHAT = keccak256("CHAT");
    bytes32 constant BALANCE_MINT = keccak256("BALANCE_MINT");

    function setUp() public {
        // No setup needed for pure library functions
    }

    // ============================================
    // hasFeature() Tests (5 tests)
    // ============================================

    function test_hasFeature_WithEmptyArray() public {
        bytes32[] memory features = new bytes32[](0);

        bool result = FeatureUtils.hasFeature(features, BONDING_CURVE);

        assertFalse(result);
    }

    function test_hasFeature_WithSingleMatchingFeature() public {
        bytes32[] memory features = new bytes32[](1);
        features[0] = BONDING_CURVE;

        bool result = FeatureUtils.hasFeature(features, BONDING_CURVE);

        assertTrue(result);
    }

    function test_hasFeature_WithSingleNonMatchingFeature() public {
        bytes32[] memory features = new bytes32[](1);
        features[0] = LIQUIDITY_POOL;

        bool result = FeatureUtils.hasFeature(features, BONDING_CURVE);

        assertFalse(result);
    }

    function test_hasFeature_WithMultipleFeaturesMatch() public {
        bytes32[] memory features = new bytes32[](3);
        features[0] = BONDING_CURVE;
        features[1] = LIQUIDITY_POOL;
        features[2] = CHAT;

        // Test each feature
        assertTrue(FeatureUtils.hasFeature(features, BONDING_CURVE));
        assertTrue(FeatureUtils.hasFeature(features, LIQUIDITY_POOL));
        assertTrue(FeatureUtils.hasFeature(features, CHAT));
    }

    function test_hasFeature_WithMultipleFeaturesNoMatch() public {
        bytes32[] memory features = new bytes32[](3);
        features[0] = BONDING_CURVE;
        features[1] = LIQUIDITY_POOL;
        features[2] = CHAT;

        bool result = FeatureUtils.hasFeature(features, BALANCE_MINT);

        assertFalse(result);
    }
}
