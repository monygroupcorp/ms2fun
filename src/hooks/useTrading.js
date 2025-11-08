import { tradingStore } from '../store/tradingStore.js';
import { eventBus } from '../core/EventBus.js';
import { validateSwapInputs, validateFreeMintRestriction } from '../utils/validation.js';

/**
 * useTrading Hook
 * 
 * Custom hook for trading operations (buy, sell, swap).
 * Extracts swap calculation logic, price calculation logic,
 * balance fetching logic, and transaction execution logic.
 * 
 * @param {Object} params - Hook parameters
 * @param {Object} params.blockchainService - BlockchainService instance
 * @param {string} params.address - Wallet address
 * @returns {Object} - Trading hook API
 */
export function useTrading({ blockchainService, address }) {
    if (!blockchainService) {
        throw new Error('BlockchainService is required for useTrading');
    }

    /**
     * Calculate swap amounts based on input
     * @param {string} amount - Input amount
     * @param {string} inputType - 'eth' or 'exec'
     * @param {boolean} isPhase2 - Whether in Phase 2
     * @returns {Promise<string>} - Calculated amount
     */
    async function calculateAmounts(amount, inputType, isPhase2) {
        if (!amount || isNaN(parseFloat(amount))) {
            return '';
        }

        try {
            if (isPhase2) {
                // Phase 2: Use Uniswap-style calculations
                const price = tradingStore.selectPrice().current;
                
                if (inputType === 'eth') {
                    const ethAmount = parseFloat(amount);
                    const execAmount = (ethAmount / price * 1000000) * 0.95;
                    return execAmount.toFixed(0);
                } else {
                    const execAmount = parseFloat(amount);
                    const ethAmount = (execAmount / 1000000) * price * 1.055;
                    return ethAmount.toFixed(6);
                }
            } else {
                // Phase 1: Use bonding curve logic
                if (inputType === 'eth') {
                    return await blockchainService.getExecForEth(amount);
                } else {
                    return await blockchainService.getEthForExec(amount);
                }
            }
        } catch (error) {
            console.error('Error calculating swap amount:', error);
            return '';
        }
    }

    /**
     * Get current balances
     * @returns {Object} - Current balances from store
     */
    function getBalances() {
        return tradingStore.selectBalances();
    }

    /**
     * Execute swap transaction
     * @param {Object} params - Swap parameters
     * @param {string} params.direction - 'buy' or 'sell'
     * @param {string} params.ethAmount - ETH amount
     * @param {string} params.execAmount - EXEC amount
     * @param {Object} params.options - Additional options (message, mintNFT, etc.)
     * @returns {Promise<Object>} - Transaction receipt
     */
    async function executeSwap({ direction, ethAmount, execAmount, options = {} }) {
        // Validate inputs
        const balances = getBalances();
        const validation = validateSwapInputs(
            { ethAmount, execAmount, direction },
            balances
        );

        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Validate free mint restriction for sells
        if (direction === 'sell') {
            const { freeMint } = tradingStore.selectFreeSituation();
            const freeMintValidation = validateFreeMintRestriction(execAmount, freeMint);
            if (!freeMintValidation.valid) {
                throw new Error(freeMintValidation.error);
            }
        }

        const isPhase2 = tradingStore.selectIsPhase2();
        const cleanExecAmount = execAmount.replace(/,/g, '');

        if (isPhase2) {
            // Phase 2: Use Uniswap router
            const ethValue = blockchainService.parseEther(ethAmount);
            const execValue = blockchainService.parseExec(cleanExecAmount);

            if (direction === 'buy') {
                return await blockchainService.swapExactEthForTokenSupportingFeeOnTransfer(
                    address,
                    { amount: execValue },
                    ethValue
                );
            } else {
                // Check approval first
                const routerAddress = blockchainService.swapRouter?.address || blockchainService.swapRouter;
                const routerAllowance = await blockchainService.getApproval(address, routerAddress);

                if (BigInt(routerAllowance) < BigInt(execValue)) {
                    throw new Error('APPROVAL_REQUIRED');
                }

                return await blockchainService.swapExactTokenForEthSupportingFeeOnTransferV2(
                    address,
                    { amount: execValue }
                );
            }
        } else {
            // Phase 1: Use bonding curve
            const currentTier = await blockchainService.getCurrentTier();
            const proof = await blockchainService.getMerkleProof(address, currentTier);

            if (!proof) {
                throw new Error(`You are not whitelisted for Tier ${currentTier + 1}`);
            }

            let adjustedExecAmount = cleanExecAmount;
            if (direction === 'buy') {
                const { freeSupply, freeMint } = tradingStore.selectFreeSituation();
                if (freeSupply > 0 && !freeMint) {
                    const numAmount = parseInt(cleanExecAmount);
                    adjustedExecAmount = Math.max(0, numAmount - 1000000).toString();
                }
            }

            const ethValue = blockchainService.parseEther(ethAmount);
            const execValue = blockchainService.parseExec(adjustedExecAmount);

            if (direction === 'buy') {
                return await blockchainService.buyBonding({
                    amount: execValue,
                    maxCost: ethValue,
                    mintNFT: options.nftMintingEnabled || false,
                    proof: proof.proof,
                    message: options.message || ''
                }, ethValue);
            } else {
                const minReturn = BigInt(ethValue) * BigInt(999) / BigInt(1000);
                return await blockchainService.sellBonding({
                    amount: execValue,
                    minReturn: minReturn,
                    proof: proof.proof,
                    message: options.message || ''
                });
            }
        }
    }

    return {
        calculateAmounts,
        getBalances,
        executeSwap
    };
}

export default useTrading;

