// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { HookAddressMiner } from "../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { Hooks } from "v4-core/libraries/Hooks.sol";

/**
 * @title HookAddressMinerTest
 * @notice Unit tests for the HookAddressMiner library
 * @dev These tests verify salt mining logic WITHOUT requiring a fork
 */
contract HookAddressMinerTest is Test {
    // Mock deployer address (factory)
    address constant MOCK_DEPLOYER = address(0x1234567890123456789012345678901234567890);

    // Mock init code hash (doesn't matter for logic testing)
    bytes32 constant MOCK_INIT_CODE_HASH = keccak256("mock init code");

    // Required flags for UniAlignmentV4Hook
    // beforeSwap + afterSwap + beforeSwapReturnDelta + afterSwapReturnDelta (the ETH-input fee added in
    // noesis-116 needs beforeSwapReturnDelta so the tithe settles on every swap shape).
    uint160 constant REQUIRED_FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    ); // = 0xCC

    // All hook flags
    uint160 constant ALL_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
            | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_DONATE_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG
    ); // = 0x3FFF

    uint160 constant FORBIDDEN_FLAGS = ALL_HOOK_FLAGS ^ REQUIRED_FLAGS; // = 0x3F3B

    // ========== Flag Constant Tests ==========

    function test_flagConstants_areCorrect() public pure {
        // Verify our understanding of the flag values
        assertEq(uint160(Hooks.BEFORE_SWAP_FLAG), 1 << 7, "BEFORE_SWAP_FLAG should be 1<<7");
        assertEq(uint160(Hooks.AFTER_SWAP_FLAG), 1 << 6, "AFTER_SWAP_FLAG should be 1<<6");
        assertEq(uint160(Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG), 1 << 2, "AFTER_SWAP_RETURNS_DELTA_FLAG should be 1<<2");
        assertEq(uint160(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG), 1 << 3, "BEFORE_SWAP_RETURNS_DELTA_FLAG should be 1<<3");

        // Combined required flags
        assertEq(REQUIRED_FLAGS, 0xCC, "Required flags should be 0xCC");

        // All flags should cover bits 0-13
        assertEq(ALL_HOOK_FLAGS, 0x3FFF, "All flags should be 0x3FFF");

        // Forbidden flags
        assertEq(FORBIDDEN_FLAGS, 0x3F33, "Forbidden flags should be 0x3F33");
    }

    // ========== Address Validation Tests ==========

    function test_hasExactFlags_validAddress() public pure {
        // An address ending in 0xCC has exactly the right flags
        address validAddr = address(uint160(0x12345678901234567890123456789012345600CC));

        assertTrue(
            HookAddressMiner.hasExactFlags(validAddr, REQUIRED_FLAGS, FORBIDDEN_FLAGS),
            "Address ending in 0xCC should be valid"
        );
    }

    function test_hasExactFlags_invalidAddress_extraFlags() public pure {
        // An address ending in 0xDEce has extra flags set
        // Using keccak to generate a deterministic address to avoid checksum issues
        address invalidAddr = address(uint160(uint256(keccak256("extraflags")) | 0xDEce));

        assertFalse(
            HookAddressMiner.hasExactFlags(invalidAddr, REQUIRED_FLAGS, FORBIDDEN_FLAGS),
            "Address with extra flags should be invalid"
        );
    }

    function test_hasExactFlags_invalidAddress_missingFlags() public pure {
        // An address ending in 0x44 only has afterSwap + afterSwapReturnDelta, missing beforeSwap
        address invalidAddr = address(uint160(0x1234567890123456789012345678901234560044));

        assertFalse(
            HookAddressMiner.hasExactFlags(invalidAddr, REQUIRED_FLAGS, FORBIDDEN_FLAGS),
            "Address missing required flags should be invalid"
        );
    }

    function test_hasExactFlags_invalidAddress_noFlags() public pure {
        // An address ending in 0x00 has no flags
        address invalidAddr = address(uint160(0x1234567890123456789012345678901234560000));

        assertFalse(
            HookAddressMiner.hasExactFlags(invalidAddr, REQUIRED_FLAGS, FORBIDDEN_FLAGS),
            "Address with no flags should be invalid"
        );
    }

    function test_isValidUniAlignmentHookAddress_valid() public pure {
        // Test addresses that end in exactly 0xCC (bits 0-13 = 0x00CC)
        // Generate addresses with various upper bits but last 14 bits exactly 0xCC
        address[] memory validAddrs = new address[](3);

        // Clear last 14 bits and set to exactly 0xCC
        validAddrs[0] = address(uint160(0xCC)); // Simple case
        validAddrs[1] = address(uint160((uint256(keccak256("test1")) & ~uint256(ALL_HOOK_FLAGS)) | REQUIRED_FLAGS));
        validAddrs[2] = address(uint160((uint256(keccak256("test2")) & ~uint256(ALL_HOOK_FLAGS)) | REQUIRED_FLAGS));

        for (uint256 i = 0; i < validAddrs.length; i++) {
            assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(validAddrs[i]), "Should be valid");
        }
    }

    function test_isValidUniAlignmentHookAddress_invalid() public pure {
        // Test various invalid addresses
        address[] memory invalidAddrs = new address[](5);
        invalidAddrs[0] = address(uint160(0x0000)); // No flags
        invalidAddrs[1] = address(uint160(0x0044)); // Only afterSwap + afterSwapReturnDelta (missing beforeSwap)
        invalidAddrs[2] = address(uint160(0x0004)); // Only afterSwapReturnDelta
        invalidAddrs[3] = address(uint160(0x01CC)); // Required flags (0xCC) + an extra forbidden flag
        invalidAddrs[4] = address(uint160(0x3FFF)); // All flags set

        for (uint256 i = 0; i < invalidAddrs.length; i++) {
            assertFalse(HookAddressMiner.isValidUniAlignmentHookAddress(invalidAddrs[i]), "Should be invalid");
        }
    }

    // ========== CREATE2 Address Computation Tests ==========

    function test_computeAddress_deterministic() public pure {
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        address addr1a = HookAddressMiner.computeAddress(MOCK_DEPLOYER, salt1, MOCK_INIT_CODE_HASH);
        address addr1b = HookAddressMiner.computeAddress(MOCK_DEPLOYER, salt1, MOCK_INIT_CODE_HASH);
        address addr2 = HookAddressMiner.computeAddress(MOCK_DEPLOYER, salt2, MOCK_INIT_CODE_HASH);

        // Same inputs should produce same output
        assertEq(addr1a, addr1b, "Same inputs should produce same address");

        // Different salt should produce different address
        assertTrue(addr1a != addr2, "Different salts should produce different addresses");
    }

    function test_computeAddress_matchesCREATE2Formula() public pure {
        address deployer = address(0xBEEF);
        bytes32 salt = bytes32(uint256(42));
        bytes32 initCodeHash = keccak256("test");

        // Manual CREATE2 computation
        address expected =
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));

        address actual = HookAddressMiner.computeAddress(deployer, salt, initCodeHash);

        assertEq(actual, expected, "Should match CREATE2 formula");
    }

    // ========== Salt Mining Tests ==========

    function test_mineSalt_findsValidSalt() public {
        // Use a simple init code hash
        bytes32 initCodeHash = keccak256("test init code for mining");

        // Mine a salt
        (bytes32 salt, address predictedAddr) =
            HookAddressMiner.mineSaltForUniAlignmentHook(MOCK_DEPLOYER, initCodeHash);

        emit log_named_bytes32("Found salt", salt);
        emit log_named_address("Predicted address", predictedAddr);
        emit log_named_uint("Last 14 bits (hex)", uint160(predictedAddr) & ALL_HOOK_FLAGS);

        // Verify the address has exactly the right flags
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(predictedAddr), "Mined address should be valid");

        // Verify required flags are set
        assertEq(uint160(predictedAddr) & REQUIRED_FLAGS, REQUIRED_FLAGS, "Required flags must be set");

        // Verify forbidden flags are NOT set
        assertEq(uint160(predictedAddr) & FORBIDDEN_FLAGS, 0, "Forbidden flags must not be set");

        // Verify the computed address matches
        address computed = HookAddressMiner.computeAddress(MOCK_DEPLOYER, salt, initCodeHash);
        assertEq(computed, predictedAddr, "Computed address should match predicted");
    }

    function test_mineSalt_differentInputsProduceDifferentSalts() public {
        bytes32 initCodeHash1 = keccak256("init code 1");
        bytes32 initCodeHash2 = keccak256("init code 2");

        (bytes32 salt1, address addr1) = HookAddressMiner.mineSaltForUniAlignmentHook(MOCK_DEPLOYER, initCodeHash1);

        (bytes32 salt2, address addr2) = HookAddressMiner.mineSaltForUniAlignmentHook(MOCK_DEPLOYER, initCodeHash2);

        emit log_named_bytes32("Salt 1", salt1);
        emit log_named_bytes32("Salt 2", salt2);
        emit log_named_address("Address 1", addr1);
        emit log_named_address("Address 2", addr2);

        // Both should be valid
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(addr1), "addr1 should be valid");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(addr2), "addr2 should be valid");

        // Addresses should be different (different init codes)
        assertTrue(addr1 != addr2, "Different init codes should produce different addresses");
    }

    // ========== Init Code Hash Tests ==========

    /// @notice computeInitCodeHash must hash the FULL 7-arg constructor tail (poolManager, vault, weth,
    ///         owner, benefactor, hookFeeBips, initialLpFeeRate) in that exact order — the `benefactor`
    ///         arg added in #115. The factory relies on this being byte-identical to what
    ///         `new UniAlignmentV4Hook{salt}(...)` assembles, so the mined address matches the deployed one.
    function test_computeInitCodeHash_matches7ArgConstructorTail() public pure {
        bytes memory creationCode = hex"60806040523480156100"; // arbitrary creation-code stand-in
        address poolManager = address(0xA1);
        address vault = address(0xA2);
        address weth = address(0xA3);
        address owner = address(0xA4);
        address benefactor = address(0xA5);
        uint256 hookFeeBips = 100;
        uint24 initialLpFeeRate = 3000;

        bytes32 expected = keccak256(
            abi.encodePacked(
                creationCode, abi.encode(poolManager, vault, weth, owner, benefactor, hookFeeBips, initialLpFeeRate)
            )
        );

        assertEq(
            HookAddressMiner.computeInitCodeHash(
                creationCode, poolManager, vault, weth, owner, benefactor, hookFeeBips, initialLpFeeRate
            ),
            expected,
            "init-code hash must cover the 7-arg ctor tail including benefactor"
        );
    }

    /// @notice A different benefactor must change the init-code hash (proves benefactor is actually hashed,
    ///         not silently dropped — the stale 6-arg helper would have collided here).
    function test_computeInitCodeHash_benefactorAffectsHash() public pure {
        bytes memory creationCode = hex"60806040523480156100";
        bytes32 hashA = HookAddressMiner.computeInitCodeHash(
            creationCode, address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5), 100, 3000
        );
        bytes32 hashB = HookAddressMiner.computeInitCodeHash(
            creationCode, address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xB5), 100, 3000
        );
        assertTrue(hashA != hashB, "changing benefactor must change the init-code hash");
    }

    // ========== Flag Decoding Tests ==========

    function test_decodeFlags_correctlyIdentifiesFlags() public pure {
        // Address with beforeSwap, afterSwap and afterSwapReturnDelta
        address validAddr = address(uint160(0xC4));
        Hooks.Permissions memory perms = HookAddressMiner.decodeFlags(validAddr);

        assertTrue(perms.beforeSwap, "beforeSwap should be true");
        assertTrue(perms.afterSwap, "afterSwap should be true");
        assertTrue(perms.afterSwapReturnDelta, "afterSwapReturnDelta should be true");
        assertFalse(perms.beforeInitialize, "beforeInitialize should be false");
        assertFalse(perms.afterInitialize, "afterInitialize should be false");
    }

    function test_decodeFlags_allFlagsSet() public pure {
        // Address with all flags
        address allFlagsAddr = address(uint160(0x3FFF));
        Hooks.Permissions memory perms = HookAddressMiner.decodeFlags(allFlagsAddr);

        assertTrue(perms.beforeInitialize, "beforeInitialize should be true");
        assertTrue(perms.afterInitialize, "afterInitialize should be true");
        assertTrue(perms.beforeAddLiquidity, "beforeAddLiquidity should be true");
        assertTrue(perms.afterAddLiquidity, "afterAddLiquidity should be true");
        assertTrue(perms.beforeRemoveLiquidity, "beforeRemoveLiquidity should be true");
        assertTrue(perms.afterRemoveLiquidity, "afterRemoveLiquidity should be true");
        assertTrue(perms.beforeSwap, "beforeSwap should be true");
        assertTrue(perms.afterSwap, "afterSwap should be true");
        assertTrue(perms.beforeDonate, "beforeDonate should be true");
        assertTrue(perms.afterDonate, "afterDonate should be true");
        assertTrue(perms.beforeSwapReturnDelta, "beforeSwapReturnDelta should be true");
        assertTrue(perms.afterSwapReturnDelta, "afterSwapReturnDelta should be true");
        assertTrue(perms.afterAddLiquidityReturnDelta, "afterAddLiquidityReturnDelta should be true");
        assertTrue(perms.afterRemoveLiquidityReturnDelta, "afterRemoveLiquidityReturnDelta should be true");
    }
}
