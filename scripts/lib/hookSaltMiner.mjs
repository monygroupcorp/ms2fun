/**
 * @fileoverview Salt mining utility for Uniswap v4 hook addresses
 *
 * Uniswap v4 encodes hook permissions in the lower 14 bits of the hook contract address.
 * This utility finds CREATE2 salts that produce addresses with the exact required permission bits.
 *
 * For UltraAlignmentV4Hook, we need:
 *   - AFTER_SWAP_FLAG (bit 6) = 0x40
 *   - AFTER_SWAP_RETURNS_DELTA_FLAG (bit 2) = 0x04
 *   - Combined: 0x44
 *   - All other hook flags (bits 0-13 except 2,6) must be 0
 */

import { ethers } from "ethers";

// Hook permission flags from Uniswap v4 Hooks.sol
const HOOK_FLAGS = {
    BEFORE_INITIALIZE: 1n << 13n,           // 0x2000
    AFTER_INITIALIZE: 1n << 12n,            // 0x1000
    BEFORE_ADD_LIQUIDITY: 1n << 11n,        // 0x0800
    AFTER_ADD_LIQUIDITY: 1n << 10n,         // 0x0400
    BEFORE_REMOVE_LIQUIDITY: 1n << 9n,      // 0x0200
    AFTER_REMOVE_LIQUIDITY: 1n << 8n,       // 0x0100
    BEFORE_SWAP: 1n << 7n,                  // 0x0080
    AFTER_SWAP: 1n << 6n,                   // 0x0040
    BEFORE_DONATE: 1n << 5n,                // 0x0020
    AFTER_DONATE: 1n << 4n,                 // 0x0010
    BEFORE_SWAP_RETURNS_DELTA: 1n << 3n,    // 0x0008
    AFTER_SWAP_RETURNS_DELTA: 1n << 2n,     // 0x0004
    AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1n << 1n,    // 0x0002
    AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1n << 0n  // 0x0001
};

// All hook flags combined (bits 0-13)
const ALL_HOOK_FLAGS = 0x3FFFn;

// Flags required for UltraAlignmentV4Hook
const ULTRA_ALIGNMENT_REQUIRED_FLAGS = HOOK_FLAGS.AFTER_SWAP | HOOK_FLAGS.AFTER_SWAP_RETURNS_DELTA; // 0x44

// Flags that must NOT be set
const ULTRA_ALIGNMENT_FORBIDDEN_FLAGS = ALL_HOOK_FLAGS ^ ULTRA_ALIGNMENT_REQUIRED_FLAGS; // 0x3FBB

/**
 * Check if an address has exactly the required hook permission flags
 * @param {string} address - The address to check (hex string)
 * @param {bigint} requiredFlags - Flags that must be set
 * @param {bigint} forbiddenFlags - Flags that must NOT be set
 * @returns {boolean}
 */
function hasExactFlags(address, requiredFlags, forbiddenFlags) {
    const addrBigInt = BigInt(address);
    const hasRequired = (addrBigInt & requiredFlags) === requiredFlags;
    const noForbidden = (addrBigInt & forbiddenFlags) === 0n;
    return hasRequired && noForbidden;
}

/**
 * Check if an address is valid for UltraAlignmentV4Hook
 * @param {string} address - The address to check
 * @returns {boolean}
 */
export function isValidUltraAlignmentHookAddress(address) {
    return hasExactFlags(address, ULTRA_ALIGNMENT_REQUIRED_FLAGS, ULTRA_ALIGNMENT_FORBIDDEN_FLAGS);
}

/**
 * Compute CREATE2 address
 * @param {string} deployer - The factory contract address
 * @param {string} salt - The salt (bytes32 hex string)
 * @param {string} initCodeHash - The keccak256 hash of init code (bytes32 hex string)
 * @returns {string} The predicted address
 */
export function computeCreate2Address(deployer, salt, initCodeHash) {
    return ethers.utils.getCreate2Address(deployer, salt, initCodeHash);
}

/**
 * Compute the init code hash for UltraAlignmentV4Hook
 * @param {string} creationCode - The contract creation bytecode (hex string)
 * @param {string} poolManager - IPoolManager address
 * @param {string} vault - UltraAlignmentVault address
 * @param {string} weth - WETH address
 * @param {string} owner - Hook owner address
 * @returns {string} The keccak256 hash of the full init code
 */
export function computeInitCodeHash(creationCode, poolManager, vault, weth, owner) {
    // Encode constructor arguments (4 addresses)
    const constructorArgs = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "address"],
        [poolManager, vault, weth, owner]
    );

    // Concatenate creation code + constructor args
    const initCode = ethers.utils.hexConcat([creationCode, constructorArgs]);

    return ethers.utils.keccak256(initCode);
}

/**
 * Mine a salt that produces a valid UltraAlignmentV4Hook address
 * @param {Object} params - Mining parameters
 * @param {string} params.deployer - The hook factory address (CREATE2 deployer)
 * @param {string} params.initCodeHash - The keccak256 hash of init code
 * @param {number} [params.maxIterations=10000000] - Maximum iterations before giving up
 * @param {number} [params.startSalt=0] - Starting salt value
 * @param {function} [params.onProgress] - Progress callback (iterations, rate)
 * @returns {Promise<{salt: string, address: string, iterations: number}>}
 */
export async function mineSaltForUltraAlignmentHook({
    deployer,
    initCodeHash,
    maxIterations = 10_000_000,
    startSalt = 0,
    onProgress = null
}) {
    const startTime = Date.now();
    let lastProgressTime = startTime;
    const progressInterval = 5000; // Report every 5 seconds

    for (let i = startSalt; i < startSalt + maxIterations; i++) {
        // Convert iteration to bytes32 salt
        const salt = ethers.utils.hexZeroPad(ethers.utils.hexlify(i), 32);

        // Compute CREATE2 address
        const address = computeCreate2Address(deployer, salt, initCodeHash);

        // Check if valid
        if (isValidUltraAlignmentHookAddress(address)) {
            const elapsed = (Date.now() - startTime) / 1000;
            return {
                salt,
                address,
                iterations: i - startSalt + 1,
                timeSeconds: elapsed,
                rate: Math.round((i - startSalt + 1) / elapsed)
            };
        }

        // Progress reporting
        if (onProgress && Date.now() - lastProgressTime > progressInterval) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = Math.round((i - startSalt) / elapsed);
            onProgress(i - startSalt, rate);
            lastProgressTime = Date.now();
        }
    }

    throw new Error(`No valid salt found within ${maxIterations} iterations`);
}

/**
 * Mine salt with the full hook deployment parameters
 * Convenience function that computes init code hash internally
 * @param {Object} params - Mining parameters
 * @param {string} params.hookFactoryAddress - The UltraAlignmentHookFactory address
 * @param {string} params.hookCreationCode - The UltraAlignmentV4Hook creation bytecode
 * @param {string} params.poolManager - IPoolManager address
 * @param {string} params.vault - Vault address
 * @param {string} params.weth - WETH address
 * @param {string} params.creator - Hook creator/owner address
 * @param {function} [params.onProgress] - Progress callback
 * @returns {Promise<{salt: string, address: string, iterations: number}>}
 */
export async function mineHookSalt({
    hookFactoryAddress,
    hookCreationCode,
    poolManager,
    vault,
    weth,
    creator,
    onProgress = null
}) {
    // Compute init code hash
    const initCodeHash = computeInitCodeHash(
        hookCreationCode,
        poolManager,
        vault,
        weth,
        creator
    );

    // Mine salt
    return mineSaltForUltraAlignmentHook({
        deployer: hookFactoryAddress,
        initCodeHash,
        onProgress
    });
}

/**
 * Decode hook permission flags from an address
 * @param {string} address - The hook address
 * @returns {Object} Object with boolean flags for each permission
 */
export function decodeHookFlags(address) {
    const flags = BigInt(address) & ALL_HOOK_FLAGS;
    return {
        beforeInitialize: (flags & HOOK_FLAGS.BEFORE_INITIALIZE) !== 0n,
        afterInitialize: (flags & HOOK_FLAGS.AFTER_INITIALIZE) !== 0n,
        beforeAddLiquidity: (flags & HOOK_FLAGS.BEFORE_ADD_LIQUIDITY) !== 0n,
        afterAddLiquidity: (flags & HOOK_FLAGS.AFTER_ADD_LIQUIDITY) !== 0n,
        beforeRemoveLiquidity: (flags & HOOK_FLAGS.BEFORE_REMOVE_LIQUIDITY) !== 0n,
        afterRemoveLiquidity: (flags & HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY) !== 0n,
        beforeSwap: (flags & HOOK_FLAGS.BEFORE_SWAP) !== 0n,
        afterSwap: (flags & HOOK_FLAGS.AFTER_SWAP) !== 0n,
        beforeDonate: (flags & HOOK_FLAGS.BEFORE_DONATE) !== 0n,
        afterDonate: (flags & HOOK_FLAGS.AFTER_DONATE) !== 0n,
        beforeSwapReturnDelta: (flags & HOOK_FLAGS.BEFORE_SWAP_RETURNS_DELTA) !== 0n,
        afterSwapReturnDelta: (flags & HOOK_FLAGS.AFTER_SWAP_RETURNS_DELTA) !== 0n,
        afterAddLiquidityReturnDelta: (flags & HOOK_FLAGS.AFTER_ADD_LIQUIDITY_RETURNS_DELTA) !== 0n,
        afterRemoveLiquidityReturnDelta: (flags & HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA) !== 0n,
        rawFlags: "0x" + flags.toString(16).padStart(4, "0")
    };
}

// Export constants for testing
export const CONSTANTS = {
    HOOK_FLAGS,
    ALL_HOOK_FLAGS,
    ULTRA_ALIGNMENT_REQUIRED_FLAGS,
    ULTRA_ALIGNMENT_FORBIDDEN_FLAGS
};
