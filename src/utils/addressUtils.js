/**
 * Address Validation Utilities
 *
 * Utilities for Ethereum address validation and formatting.
 * Uses ethers.js for robust address handling.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * Check if a string is a valid Ethereum address
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid address
 */
export function isValidAddress(address) {
    if (!address || typeof address !== 'string') {
        return false;
    }

    try {
        return ethers.utils.isAddress(address);
    } catch (error) {
        return false;
    }
}

/**
 * Normalize address to checksum format
 * @param {string} address - Address to normalize
 * @returns {string} Checksummed address
 * @throws {Error} If address is invalid
 */
export function normalizeAddress(address) {
    if (!isValidAddress(address)) {
        throw new Error(`Invalid Ethereum address: ${address}`);
    }

    return ethers.utils.getAddress(address);
}

/**
 * Compare two addresses (case-insensitive)
 * @param {string} addr1 - First address
 * @param {string} addr2 - Second address
 * @returns {boolean} True if addresses are the same
 */
export function isSameAddress(addr1, addr2) {
    if (!isValidAddress(addr1) || !isValidAddress(addr2)) {
        return false;
    }

    try {
        return normalizeAddress(addr1) === normalizeAddress(addr2);
    } catch (error) {
        return false;
    }
}

/**
 * Check if address is the zero address
 * @param {string} address - Address to check
 * @returns {boolean} True if zero address
 */
export function isZeroAddress(address) {
    return isSameAddress(address, ethers.constants.AddressZero);
}

/**
 * Shorten address for display (0x1234...5678)
 * @param {string} address - Address to shorten
 * @param {number} prefixLength - Length of prefix (default: 6)
 * @param {number} suffixLength - Length of suffix (default: 4)
 * @returns {string} Shortened address
 */
export function shortenAddress(address, prefixLength = 6, suffixLength = 4) {
    if (!isValidAddress(address)) {
        return address;
    }

    const normalized = normalizeAddress(address);

    if (normalized.length <= prefixLength + suffixLength) {
        return normalized;
    }

    return `${normalized.slice(0, prefixLength)}...${normalized.slice(-suffixLength)}`;
}

/**
 * Validate array of addresses
 * @param {string[]} addresses - Addresses to validate
 * @returns {Object} Validation result with valid/invalid arrays
 */
export function validateAddresses(addresses) {
    const result = {
        valid: [],
        invalid: [],
        allValid: false
    };

    if (!Array.isArray(addresses)) {
        return result;
    }

    for (const address of addresses) {
        if (isValidAddress(address)) {
            result.valid.push(normalizeAddress(address));
        } else {
            result.invalid.push(address);
        }
    }

    result.allValid = result.invalid.length === 0;

    return result;
}

/**
 * Get address from ENS name (if available)
 * Note: Requires provider with ENS support
 * @param {string} ensName - ENS name
 * @param {Object} provider - Ethers provider
 * @returns {Promise<string|null>} Resolved address or null
 */
export async function resolveENS(ensName, provider) {
    if (!ensName || !provider) {
        return null;
    }

    try {
        const address = await provider.resolveName(ensName);
        return address;
    } catch (error) {
        console.warn(`[addressUtils] Failed to resolve ENS name ${ensName}:`, error);
        return null;
    }
}

/**
 * Get ENS name from address (reverse lookup)
 * Note: Requires provider with ENS support
 * @param {string} address - Ethereum address
 * @param {Object} provider - Ethers provider
 * @returns {Promise<string|null>} ENS name or null
 */
export async function lookupENS(address, provider) {
    if (!isValidAddress(address) || !provider) {
        return null;
    }

    try {
        const ensName = await provider.lookupAddress(address);
        return ensName;
    } catch (error) {
        console.warn(`[addressUtils] Failed to lookup ENS for ${address}:`, error);
        return null;
    }
}

export default {
    isValidAddress,
    normalizeAddress,
    isSameAddress,
    isZeroAddress,
    shortenAddress,
    validateAddresses,
    resolveENS,
    lookupENS
};
