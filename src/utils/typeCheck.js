/**
 * Type Checking Utilities
 * 
 * Type checking functions for runtime validation.
 * Useful for catching type mismatches early.
 * 
 * @module typeCheck
 */

/**
 * Check if value is a valid Ethereum address
 * 
 * @param {any} address - Value to check
 * @returns {boolean} - Whether value is a valid Ethereum address
 */
export function isAddress(address) {
    if (typeof address !== 'string') {
        return false;
    }
    
    // Ethereum address format: 0x followed by 40 hex characters
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if value is a valid amount (positive number)
 * 
 * @param {any} amount - Value to check
 * @returns {boolean} - Whether value is a valid amount
 */
export function isAmount(amount) {
    if (amount === null || amount === undefined || amount === '') {
        return false;
    }
    
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
}

/**
 * Check if value is a positive number
 * 
 * @param {any} n - Value to check
 * @returns {boolean} - Whether value is a positive number
 */
export function isPositiveNumber(n) {
    if (n === null || n === undefined) {
        return false;
    }
    
    const num = parseFloat(n);
    return !isNaN(num) && num > 0;
}

/**
 * Check if value is a valid number (including zero and negative)
 * 
 * @param {any} n - Value to check
 * @returns {boolean} - Whether value is a valid number
 */
export function isNumber(n) {
    if (n === null || n === undefined) {
        return false;
    }
    
    return !isNaN(parseFloat(n)) && isFinite(n);
}

/**
 * Check if value is a valid integer
 * 
 * @param {any} n - Value to check
 * @returns {boolean} - Whether value is a valid integer
 */
export function isInteger(n) {
    if (n === null || n === undefined) {
        return false;
    }
    
    const num = parseFloat(n);
    return !isNaN(num) && Number.isInteger(num);
}

/**
 * Check if value is a valid percentage (0-100)
 * 
 * @param {any} n - Value to check
 * @returns {boolean} - Whether value is a valid percentage
 */
export function isPercentage(n) {
    if (n === null || n === undefined) {
        return false;
    }
    
    const num = parseFloat(n);
    return !isNaN(num) && num >= 0 && num <= 100;
}

