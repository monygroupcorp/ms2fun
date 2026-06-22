/**
 * Trading Calculations Utility
 * 
 * Pure functions for trading calculations (ETH to EXEC, EXEC to ETH, fees, etc.)
 * These functions have no side effects and are easy to test.
 * 
 * @module tradingCalculations
 */

/**
 * Calculate EXEC amount from ETH amount (Phase 1 - Bonding Curve)
 * Note: This is a simplified calculation. The actual calculation should be done
 * via blockchain service for accuracy.
 * 
 * @param {number|string} ethAmount - ETH amount
 * @param {number} currentPrice - Current price per EXEC in ETH
 * @param {boolean} hasFreeMint - Whether user has free mint available
 * @returns {number} - EXEC amount (in base units, e.g., 1000000 = 1M EXEC)
 */
export function calculateExecFromEth(ethAmount, currentPrice, hasFreeMint = false) {
    const eth = parseFloat(ethAmount);
    if (isNaN(eth) || eth <= 0) return 0;
    
    // Basic calculation: ETH / price per EXEC
    const execAmount = (eth / currentPrice) * 1000000;
    
    // Add free mint bonus if available
    const freeMintBonus = hasFreeMint ? 1000000 : 0;
    
    return Math.floor(execAmount + freeMintBonus);
}

/**
 * Calculate ETH amount from EXEC amount (Phase 1 - Bonding Curve)
 * Note: This is a simplified calculation. The actual calculation should be done
 * via blockchain service for accuracy.
 * 
 * @param {number|string} execAmount - EXEC amount (in base units)
 * @param {number} currentPrice - Current price per EXEC in ETH
 * @returns {number} - ETH amount
 */
export function calculateEthFromExec(execAmount, exec, currentPrice) {
    const execNum = parseFloat(execAmount);
    if (isNaN(execNum) || execNum <= 0) return 0;
    
    // Basic calculation: EXEC * price per EXEC
    return (execNum / 1000000) * currentPrice;
}

/**
 * Calculate EXEC amount from ETH amount (Phase 2 - Uniswap-style)
 * Applies slippage and tax adjustments
 * 
 * @param {number|string} ethAmount - ETH amount
 * @param {number} price - Current price per EXEC in ETH
 * @param {number} slippagePercent - Slippage percentage (default: 5%)
 * @returns {number} - EXEC amount (in base units)
 */
export function calculateExecFromEthPhase2(ethAmount, price, slippagePercent = 5) {
    const eth = parseFloat(ethAmount);
    if (isNaN(eth) || eth <= 0) return 0;
    
    // Calculate base amount
    const baseAmount = (eth / price) * 1000000;
    
    // Apply slippage reduction (accounting for 4% tax + slippage)
    const reductionFactor = 1 - (slippagePercent / 100);
    
    return Math.floor(baseAmount * reductionFactor);
}

/**
 * Calculate ETH amount from EXEC amount (Phase 2 - Uniswap-style)
 * Applies slippage and tax adjustments
 * 
 * @param {number|string} execAmount - EXEC amount (in base units)
 * @param {number} price - Current price per EXEC in ETH
 * @param {number} slippagePercent - Slippage percentage (default: 5.5%)
 * @returns {number} - ETH amount
 */
export function calculateEthFromExecPhase2(execAmount, price, slippagePercent = 5.5) {
    const exec = parseFloat(execAmount);
    if (isNaN(exec) || exec <= 0) return 0;
    
    // Calculate base amount
    const baseAmount = (exec / 1000000) * price;
    
    // Apply slippage buffer (accounting for 4% tax + slippage + price impact)
    const bufferFactor = 1 + (slippagePercent / 100);
    
    return parseFloat((baseAmount * bufferFactor).toFixed(6));
}

/**
 * Calculate fee amount
 * 
 * @param {number|string} amount - Base amount
 * @param {number} feePercent - Fee percentage (e.g., 4 for 4%)
 * @returns {number} - Fee amount
 */
export function calculateFee(amount, feePercent) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return 0;
    
    return (amt * feePercent) / 100;
}

/**
 * Calculate amount after fee
 * 
 * @param {number|string} amount - Base amount
 * @param {number} feePercent - Fee percentage (e.g., 4 for 4%)
 * @returns {number} - Amount after fee
 */
export function calculateAmountAfterFee(amount, feePercent) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return 0;
    
    return amt - calculateFee(amount, feePercent);
}

