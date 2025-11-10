/**
 * Contract Adapter Base Class
 * 
 * Provides a unified interface for all contract types.
 * Subclasses implement contract-specific operations.
 */

import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

class ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        if (!contractAddress) {
            throw new Error('Contract address is required');
        }
        if (!contractType) {
            throw new Error('Contract type is required');
        }
        if (!ethersProvider) {
            throw new Error('Ethers provider is required');
        }

        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.provider = ethersProvider;
        this.signer = signer;
        this.contract = null; // Will be set by subclass
        this.initialized = false;
    }

    /**
     * Initialize the adapter (load contract, ABI, etc.)
     * Must be implemented by subclasses
     * @throws {Error} If not implemented
     */
    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Get user balance
     * Must be implemented by subclasses
     * @param {string} address - User address
     * @returns {Promise<string>} Balance
     * @throws {Error} If not implemented
     */
    async getBalance(address) {
        throw new Error('getBalance() must be implemented by subclass');
    }

    /**
     * Get current price
     * Must be implemented by subclasses
     * @returns {Promise<number>} Current price
     * @throws {Error} If not implemented
     */
    async getPrice() {
        throw new Error('getPrice() must be implemented by subclass');
    }

    /**
     * Get contract metadata
     * Must be implemented by subclasses
     * @returns {Promise<Object>} Contract metadata
     * @throws {Error} If not implemented
     */
    async getMetadata() {
        throw new Error('getMetadata() must be implemented by subclass');
    }

    /**
     * Execute a contract call with error handling
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {Object} options - Options (requiresSigner, txOptions, etc.)
     * @returns {Promise<any>} Method result
     */
    async executeContractCall(method, args = [], options = {}) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Select contract instance (with or without signer)
            let contractInstance = this.contract;
            if (options.requiresSigner) {
                if (!this.signer) {
                    throw new Error('No wallet connected');
                }
                contractInstance = contractInstance.connect(this.signer);
            }

            // Check if method exists
            if (typeof contractInstance[method] !== 'function') {
                throw new Error(`Method ${method} not found on contract`);
            }

            // Execute the contract call
            const result = await contractInstance[method](
                ...(args || []), 
                options.txOptions || {}
            );

            // If this is a transaction, wait for confirmation
            if (result && typeof result.wait === 'function') {
                const receipt = await result.wait();
                eventBus.emit('transaction:confirmed', {
                    hash: receipt.transactionHash,
                    method,
                    args,
                    contractAddress: this.contractAddress
                });
                return receipt;
            }

            return result;
        } catch (error) {
            throw this.handleContractError(error, method);
        }
    }

    /**
     * Handle contract errors with context
     * @param {Error} error - Original error
     * @param {string} method - Method name that failed
     * @returns {Error} Wrapped error with context
     */
    handleContractError(error, method) {
        let message = error.message;

        // Handle common contract errors
        if (error.code === 'INSUFFICIENT_FUNDS') {
            return new Error('Insufficient funds to complete transaction');
        }
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            const revertMatch = error.message.match(/execution reverted: (.*?)(?:\"|$)/);
            message = revertMatch 
                ? `Tx Reverted: ${revertMatch[1]}` 
                : 'Transaction would fail - check your inputs';
            return new Error(message);
        }
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            return new Error('Transaction rejected by user');
        }

        // Extract revert reason from other error types
        if (error.message.includes('execution reverted')) {
            const revertMatch = error.message.match(/execution reverted: (.*?)(?:\"|$)/);
            message = revertMatch ? `Tx Reverted: ${revertMatch[1]}` : error.message;
        }

        // Log unexpected errors
        console.error(`[ContractAdapter] Contract error in ${method} (${this.contractType}):`, error);
        
        const wrappedError = new Error(`${this.contractType} ${method} failed: ${message}`);
        wrappedError.originalError = error;
        wrappedError.code = error.code;
        wrappedError.contractAddress = this.contractAddress;
        wrappedError.method = method;
        
        return wrappedError;
    }

    /**
     * Wrap error with context
     * @param {Error} error - Original error
     * @param {string} context - Error context
     * @returns {Error} Wrapped error
     */
    wrapError(error, context) {
        const wrappedError = new Error(`${context}: ${error.message}`);
        wrappedError.originalError = error;
        wrappedError.code = error.code;
        wrappedError.contractAddress = this.contractAddress;
        return wrappedError;
    }

    /**
     * Get contract address
     * @returns {string} Contract address
     */
    getContractAddress() {
        return this.contractAddress;
    }

    /**
     * Get contract type
     * @returns {string} Contract type
     */
    getContractType() {
        return this.contractType;
    }

    /**
     * Get ethers contract instance
     * @returns {Object|null} Ethers contract instance or null if not initialized
     */
    getContract() {
        return this.contract;
    }

    /**
     * Check if adapter is initialized
     * @returns {boolean} True if initialized
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * Get cached value or execute and cache
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {Function} fetchFn - Function to fetch value if not cached
     * @param {number} ttl - Cache TTL in milliseconds (optional)
     * @returns {Promise<any>} Cached or fetched value
     */
    async getCachedOrFetch(method, args, fetchFn, ttl = null) {
        // Check cache first
        const cached = contractCache.get(method, args);
        if (cached !== null) {
            return cached;
        }

        // Fetch value
        const value = await fetchFn();

        // Cache the result
        contractCache.set(method, args, value, ttl);

        return value;
    }
}

export default ContractAdapter;

