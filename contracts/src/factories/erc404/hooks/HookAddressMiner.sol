// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Hooks } from "v4-core/libraries/Hooks.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/**
 * @title HookAddressMiner
 * @notice Utility library for computing CREATE2 salts that produce valid Uniswap v4 hook addresses
 * @dev Uniswap v4 encodes hook permissions in the hook contract address. This library helps
 *      find salts that produce addresses with the required permission bits set.
 *
 * CRITICAL: Uniswap v4's validateHookPermissions() requires an EXACT match:
 *   - Required flags MUST be set
 *   - All other flags MUST NOT be set
 *
 * Hook Permission Bits (from Hooks.sol):
 *   BEFORE_INITIALIZE_FLAG = 1 << 13
 *   AFTER_INITIALIZE_FLAG = 1 << 12
 *   BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11
 *   AFTER_ADD_LIQUIDITY_FLAG = 1 << 10
 *   BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 9
 *   AFTER_REMOVE_LIQUIDITY_FLAG = 1 << 8
 *   BEFORE_SWAP_FLAG = 1 << 7
 *   AFTER_SWAP_FLAG = 1 << 6
 *   BEFORE_DONATE_FLAG = 1 << 5
 *   AFTER_DONATE_FLAG = 1 << 4
 *   BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3
 *   AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2
 *   AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 1
 *   AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 0
 *
 * For UniAlignmentV4Hook, we need:
 *   - BEFORE_SWAP_FLAG = 0x80 (1 << 7) — dynamic LP fee override + ETH-input fee take
 *   - AFTER_SWAP_FLAG = 0x40 (1 << 6)
 *   - BEFORE_SWAP_RETURNS_DELTA_FLAG = 0x08 (1 << 3) — ETH-input fee settles on the specified currency
 *   - AFTER_SWAP_RETURNS_DELTA_FLAG = 0x04 (1 << 2)
 *   - Combined: 0xCC
 *   - All other flags must be 0
 */
library HookAddressMiner {
    /// @notice All possible hook permission flags combined (bits 0-13)
    uint160 constant ALL_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
            | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_DONATE_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG
    ); // = 0x3FFF (bits 0-13)

    /// @notice Hook flags for UniAlignmentV4Hook
    /// beforeSwap (bit 7) + afterSwap (bit 6) + beforeSwapReturnDelta (bit 3) + afterSwapReturnDelta (bit 2)
    uint160 constant ULTRA_ALIGNMENT_HOOK_FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    ); // = 0xCC

    /// @notice Flags that must NOT be set for UniAlignmentV4Hook
    uint160 constant ULTRA_ALIGNMENT_FORBIDDEN_FLAGS = ALL_HOOK_FLAGS ^ ULTRA_ALIGNMENT_HOOK_FLAGS;

    /// @notice Maximum iterations before giving up on finding a valid salt.
    /// @dev Sized against a LINEAR mine (see `mineSalt`). A 14-bit exact-flag constraint such as 0xCC is
    ///      hit with probability 2^-14 per iteration, so the chance of no valid salt within 250,000
    ///      iterations is (1 - 2^-14)^250000 ~= 2.3e-7. At the measured per-iteration cost the cap also
    ///      sits past what a 30M-gas block can execute, so on such chains the block, not this bound, is
    ///      what a pathological search runs into first; the bound's job is to stop a runaway loop with a
    ///      named revert on chains whose limit is higher. A cap sized against the earlier quadratic cost
    ///      is the wrong bound once the cost is linear.
    uint256 constant MAX_ITERATIONS = 250_000;

    /// @notice Error when no valid salt found within iteration limit
    error NoValidSaltFound(uint256 iterations, uint160 requiredFlags);

    /// @notice Error when computed address doesn't match expected
    error AddressMismatch(address expected, address actual);

    /**
     * @notice Find a CREATE2 salt that produces a hook address with EXACTLY the required permission bits
     * @dev The address must have requiredFlags set AND must NOT have any other hook flags set
     * @param deployer The factory contract that will deploy the hook (CREATE2 deployer)
     * @param initCodeHash The keccak256 hash of the hook's creation bytecode + constructor args
     * @param requiredFlags The permission bits that must be set in the resulting address
     * @param forbiddenFlags The permission bits that must NOT be set in the resulting address
     * @return salt A bytes32 salt value that produces a valid hook address
     * @return predictedAddress The address that will be deployed with this salt
     */
    function mineSalt(address deployer, bytes32 initCodeHash, uint160 requiredFlags, uint160 forbiddenFlags)
        internal
        pure
        returns (bytes32 salt, address predictedAddress)
    {
        uint256 required = requiredFlags;
        uint256 forbidden = forbiddenFlags;
        uint256 found;

        // The 85-byte CREATE2 preimage (0xff ++ deployer ++ salt ++ initCodeHash) is laid out ONCE in a
        // fixed memory window above the free-memory pointer, and each iteration rewrites only the salt
        // word before hashing in place. Nothing is allocated inside the loop and the free-memory pointer
        // never moves, so the memory high-water mark is constant and the per-iteration cost is constant:
        // the mine is O(n) in its iteration count. The search sequence, the salt values and the resulting
        // addresses are identical to the straightforward `computeAddress(deployer, bytes32(i), ...)` form,
        // which the tests assert directly.
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(ptr, deployer) // right-aligned; the 12 preceding bytes are overwritten/ignored below
            let start := add(ptr, 0x0b) // final garbage byte of the deployer word becomes the 0xff prefix
            mstore8(start, 0xff)
            let saltSlot := add(ptr, 0x20)
            for { let i := 0 } lt(i, MAX_ITERATIONS) { i := add(i, 1) } {
                mstore(saltSlot, i)
                let addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
                if and(eq(and(addr, required), required), iszero(and(addr, forbidden))) {
                    salt := i
                    predictedAddress := addr
                    found := 1
                    break
                }
            }
        }

        if (found == 0) revert NoValidSaltFound(MAX_ITERATIONS, requiredFlags);
    }

    /**
     * @notice Find a salt specifically for UniAlignmentV4Hook deployment
     * @dev Ensures address has ONLY beforeSwap, afterSwap, and afterSwapReturnDelta flags set
     * @param deployer The hook factory address
     * @param initCodeHash The keccak256 of hook creation code + constructor args
     * @return salt Valid salt for deployment
     * @return predictedAddress The hook address that will be created
     */
    function mineSaltForUniAlignmentHook(address deployer, bytes32 initCodeHash)
        internal
        pure
        returns (bytes32 salt, address predictedAddress)
    {
        return mineSalt(deployer, initCodeHash, ULTRA_ALIGNMENT_HOOK_FLAGS, ULTRA_ALIGNMENT_FORBIDDEN_FLAGS);
    }

    /**
     * @notice Compute the CREATE2 address for a given deployer, salt, and init code hash
     * @param deployer The contract deploying via CREATE2
     * @param salt The CREATE2 salt
     * @param initCodeHash The keccak256 of the init code (creation code + constructor args)
     * @return The predicted deployment address
     */
    /// @dev Derives the address in FIXED scratch memory: the 85-byte CREATE2 preimage
    ///      (0xff ++ deployer ++ salt ++ initCodeHash) is written above the free-memory pointer and hashed
    ///      in place, and the free-memory pointer is left untouched — so the allocation high-water mark
    ///      does not move. This is what keeps `mineSalt` linear in its iteration count: `abi.encodePacked`
    ///      allocates a fresh 85-byte buffer per call, and because EVM memory is never reclaimed, the
    ///      expansion cost of a loop of such calls grows with the square of the iteration count.
    ///      The derivation is byte-for-byte the same preimage and is asserted so by a differential test
    ///      (`HookAddressMinerGas.t.sol`) against the `abi.encodePacked` form across a large sample of
    ///      `(deployer, salt, initCodeHash)` triples, including zero and max values.
    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address addr) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer) // right-aligned; the 12 preceding bytes are overwritten/ignored below
            let start := add(ptr, 0x0b) // final garbage byte of the deployer word becomes the 0xff prefix
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    /**
     * @notice Check if an address has EXACTLY the required flags (and no forbidden flags)
     * @param addr The address to check
     * @param requiredFlags Flags that MUST be set
     * @param forbiddenFlags Flags that must NOT be set
     * @return True if address has exactly the required flags
     */
    function hasExactFlags(address addr, uint160 requiredFlags, uint160 forbiddenFlags) internal pure returns (bool) {
        uint160 addrFlags = uint160(addr);
        // Required flags must all be set
        bool hasRequired = (addrFlags & requiredFlags) == requiredFlags;
        // Forbidden flags must all be unset
        bool noForbidden = (addrFlags & forbiddenFlags) == 0;
        return hasRequired && noForbidden;
    }

    /**
     * @notice Check if an address has the required permission flags set
     * @dev WARNING: This only checks if flags ARE set, not if other flags are unset
     * @param addr The address to check
     * @param flags The required permission bits
     * @return True if all required flags are set in the address
     */
    function hasRequiredFlags(address addr, uint160 flags) internal pure returns (bool) {
        return uint160(addr) & flags == flags;
    }

    /**
     * @notice Check if an address is valid for UniAlignmentV4Hook
     * @dev Checks that ONLY beforeSwap, afterSwap, and afterSwapReturnDelta flags are set
     * @param addr The address to validate
     * @return True if the address has exactly the right flags for UniAlignmentV4Hook
     */
    function isValidUniAlignmentHookAddress(address addr) internal pure returns (bool) {
        return hasExactFlags(addr, ULTRA_ALIGNMENT_HOOK_FLAGS, ULTRA_ALIGNMENT_FORBIDDEN_FLAGS);
    }

    /**
     * @notice Compute the init code hash for UniAlignmentV4Hook
     * @param creationCode The type(UniAlignmentV4Hook).creationCode
     * @param poolManager The IPoolManager address
     * @param vault The UniAlignmentVault address
     * @param weth The WETH address
     * @param owner The hook owner address
     * @param benefactor The fixed project instance the hook credits (7th ctor arg, added in #115)
     * @param hookFeeBips The hook fee in basis points
     * @param initialLpFeeRate The initial LP fee rate
     * @return The keccak256 hash of the full init code
     */
    function computeInitCodeHash(
        bytes memory creationCode,
        address poolManager,
        address vault,
        address weth,
        address owner,
        address benefactor,
        uint256 hookFeeBips,
        uint24 initialLpFeeRate
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                creationCode, abi.encode(poolManager, vault, weth, owner, benefactor, hookFeeBips, initialLpFeeRate)
            )
        );
    }

    /**
     * @notice Verify a salt produces the expected address (sanity check)
     * @param deployer The CREATE2 deployer
     * @param salt The salt to verify
     * @param initCodeHash The init code hash
     * @param expectedAddress The address we expect
     */
    function verifySalt(address deployer, bytes32 salt, bytes32 initCodeHash, address expectedAddress) internal pure {
        address computed = computeAddress(deployer, salt, initCodeHash);
        if (computed != expectedAddress) {
            revert AddressMismatch(expectedAddress, computed);
        }
    }

    /**
     * @notice Get human-readable description of flags in an address
     * @param addr The hook address to analyze
     * @return A struct with boolean flags for each permission
     */
    function decodeFlags(address addr) internal pure returns (Hooks.Permissions memory) {
        uint160 flags = uint160(addr);
        return Hooks.Permissions({
            beforeInitialize: flags & Hooks.BEFORE_INITIALIZE_FLAG != 0,
            afterInitialize: flags & Hooks.AFTER_INITIALIZE_FLAG != 0,
            beforeAddLiquidity: flags & Hooks.BEFORE_ADD_LIQUIDITY_FLAG != 0,
            afterAddLiquidity: flags & Hooks.AFTER_ADD_LIQUIDITY_FLAG != 0,
            beforeRemoveLiquidity: flags & Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG != 0,
            afterRemoveLiquidity: flags & Hooks.AFTER_REMOVE_LIQUIDITY_FLAG != 0,
            beforeSwap: flags & Hooks.BEFORE_SWAP_FLAG != 0,
            afterSwap: flags & Hooks.AFTER_SWAP_FLAG != 0,
            beforeDonate: flags & Hooks.BEFORE_DONATE_FLAG != 0,
            afterDonate: flags & Hooks.AFTER_DONATE_FLAG != 0,
            beforeSwapReturnDelta: flags & Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG != 0,
            afterSwapReturnDelta: flags & Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG != 0,
            afterAddLiquidityReturnDelta: flags & Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG != 0,
            afterRemoveLiquidityReturnDelta: flags & Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG != 0
        });
    }
}
