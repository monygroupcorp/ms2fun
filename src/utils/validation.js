/**
 * Validation Utility
 * 
 * Input validation functions for trading operations.
 * Provides clear error messages for invalid inputs.
 * 
 * @module validation
 */

/**
 * Validate Ethereum address
 * 
 * @param {string} address - Address to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateAddress(address) {
    if (!address || typeof address !== 'string') {
        return { valid: false, error: 'Address is required' };
    }
    
    // Basic Ethereum address format check
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return { valid: false, error: 'Invalid Ethereum address format' };
    }
    
    return { valid: true };
}

/**
 * Validate amount (must be positive number)
 * 
 * @param {string|number} amount - Amount to validate
 * @param {string} fieldName - Name of the field (for error messages)
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateAmount(amount, fieldName = 'Amount') {
    if (amount === null || amount === undefined || amount === '') {
        return { valid: false, error: `${fieldName} is required` };
    }
    
    const num = parseFloat(amount);
    
    if (isNaN(num)) {
        return { valid: false, error: `${fieldName} must be a valid number` };
    }
    
    if (num <= 0) {
        return { valid: false, error: `${fieldName} must be greater than zero` };
    }
    
    return { valid: true };
}

/**
 * Validate balance (check if user has enough balance)
 * 
 * @param {string|number} amount - Amount needed
 * @param {string|number} balance - Available balance
 * @param {string} tokenName - Token name (for error messages)
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateBalance(amount, balance, tokenName = 'Token') {
    const amountValidation = validateAmount(amount, 'Amount');
    if (!amountValidation.valid) {
        return amountValidation;
    }
    
    const balanceNum = parseFloat(balance);
    const amountNum = parseFloat(amount);
    
    if (isNaN(balanceNum)) {
        return { valid: false, error: `Invalid ${tokenName} balance` };
    }
    
    if (amountNum > balanceNum) {
        return { 
            valid: false, 
            error: `Insufficient ${tokenName} balance. Available: ${balanceNum}, Required: ${amountNum}` 
        };
    }
    
    return { valid: true };
}

/**
 * Validate transaction inputs for swap
 * 
 * @param {Object} inputs - Transaction inputs
 * @param {string|number} inputs.ethAmount - ETH amount
 * @param {string|number} inputs.execAmount - EXEC amount
 * @param {string} inputs.direction - Swap direction ('buy' or 'sell')
 * @param {Object} balances - User balances
 * @param {string|number} balances.eth - ETH balance
 * @param {string|number} balances.exec - EXEC balance
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateSwapInputs(inputs, balances) {
    const { ethAmount, execAmount, direction } = inputs;
    const { eth: ethBalance, exec: execBalance } = balances;
    
    // Validate amounts are provided
    if (!ethAmount || !execAmount) {
        return { valid: false, error: 'Please enter valid amounts' };
    }
    
    const ethValidation = validateAmount(ethAmount, 'ETH amount');
    if (!ethValidation.valid) {
        return ethValidation;
    }
    
    const execValidation = validateAmount(execAmount, 'EXEC amount');
    if (!execValidation.valid) {
        return execValidation;
    }
    
    // Validate balance based on direction
    if (direction === 'buy') {
        return validateBalance(ethAmount, ethBalance, 'ETH');
    } else {
        return validateBalance(execAmount, execBalance, 'EXEC');
    }
}

/**
 * Validate free mint restriction (cannot sell free mint tokens)
 * 
 * @param {string|number} execAmount - EXEC amount to sell
 * @param {boolean} hasFreeMint - Whether user has free mint
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateFreeMintRestriction(execAmount, hasFreeMint) {
    if (!hasFreeMint) {
        return { valid: true };
    }
    
    const execNum = parseInt(execAmount.toString().replace(/,/g, ''));
    
    // If selling 1M or less and has free mint, it's likely the free mint
    if (execNum <= 1000000) {
        return { 
            valid: false, 
            error: 'Free minted tokens cannot be sold directly. Please trade more tokens or use a different address.' 
        };
    }
    
    return { valid: true };
}

