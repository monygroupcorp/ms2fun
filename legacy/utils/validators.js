import { isAddress, isAmount, isPositiveNumber, isNumber, isInteger, isPercentage } from './typeCheck.js';

/**
 * Validators Utility
 * 
 * Validation helpers for function inputs in hooks and services.
 * Provides clear error messages for invalid inputs.
 * 
 * @module validators
 */

/**
 * Validate function parameters
 * 
 * @param {Object} params - Parameters to validate
 * @param {Object} schema - Validation schema
 * @returns {{valid: boolean, errors?: Array<string>}} - Validation result
 * 
 * @example
 * validateParams(
 *   { address: '0x123...', amount: '100' },
 *   { address: isAddress, amount: isAmount }
 * )
 */
export function validateParams(params, schema) {
    const errors = [];
    
    for (const [key, validator] of Object.entries(schema)) {
        if (!(key in params)) {
            errors.push(`Missing required parameter: ${key}`);
            continue;
        }
        
        if (typeof validator === 'function') {
            if (!validator(params[key])) {
                errors.push(`Invalid value for parameter: ${key}`);
            }
        } else if (typeof validator === 'object' && validator.validator) {
            // Support for validator objects with custom messages
            if (!validator.validator(params[key])) {
                errors.push(validator.message || `Invalid value for parameter: ${key}`);
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
    };
}

/**
 * Create a validator with custom error message
 * 
 * @param {Function} validator - Validator function
 * @param {string} message - Custom error message
 * @returns {Object} - Validator object
 */
export function createValidator(validator, message) {
    return {
        validator,
        message
    };
}

/**
 * Common validators
 */
export const validators = {
    address: isAddress,
    amount: isAmount,
    positiveNumber: isPositiveNumber,
    number: isNumber,
    integer: isInteger,
    percentage: isPercentage,
    
    // Custom validators with messages
    requiredAddress: createValidator(isAddress, 'Address is required and must be a valid Ethereum address'),
    requiredAmount: createValidator(isAmount, 'Amount is required and must be a positive number'),
    requiredPositiveNumber: createValidator(isPositiveNumber, 'Value is required and must be a positive number')
};

/**
 * Validate swap direction
 * 
 * @param {string} direction - Direction to validate
 * @returns {boolean} - Whether direction is valid
 */
export function isValidSwapDirection(direction) {
    return direction === 'buy' || direction === 'sell';
}

/**
 * Validate transaction options
 * 
 * @param {Object} options - Options to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateTransactionOptions(options) {
    if (!options || typeof options !== 'object') {
        return { valid: false, error: 'Options must be an object' };
    }
    
    if ('message' in options && typeof options.message !== 'string') {
        return { valid: false, error: 'Message must be a string' };
    }
    
    if ('nftMintingEnabled' in options && typeof options.nftMintingEnabled !== 'boolean') {
        return { valid: false, error: 'nftMintingEnabled must be a boolean' };
    }
    
    return { valid: true };
}

