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
        
        // Check if this is a mock contract (can work without real provider)
        // First check common patterns
        let isMockContract = contractAddress.startsWith('0xMOCK') || 
                             contractAddress.includes('mock') ||
                             contractAddress.startsWith('0xFACTORY');
        
        // Also check if it exists in mock data (for dynamically generated addresses)
        // Use synchronous check via localStorage
        if (!isMockContract) {
            try {
                const saved = localStorage.getItem('mockLaunchpadData');
                if (saved) {
                    const mockData = JSON.parse(saved);
                    if (mockData && mockData.instances && mockData.instances[contractAddress]) {
                        isMockContract = true;
                    }
                }
            } catch (error) {
                // If we can't check, assume it's not a mock contract
            }
        }
        
        if (!ethersProvider && !isMockContract) {
            throw new Error('Ethers provider is required');
        }

        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.provider = ethersProvider; // Can be mock object for mock contracts
        this.signer = signer;
        this.contract = null; // Will be set by subclass
        this.initialized = false;
        this.isMock = isMockContract || (ethersProvider && ethersProvider.isMock === true);
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
            // Handle mock mode - return default values instead of calling contract
            if (this.isMock || !this.contract) {
                // Return mock/default values based on method
                return await this.getMockValue(method, args);
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
            // Only pass txOptions for transactions, not for view functions
            let result;
            if (options.txOptions) {
                result = await contractInstance[method](...(args || []), options.txOptions);
            } else {
                result = await contractInstance[method](...(args || []));
            }

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
     * Get mock value for a contract method (used when contract is not initialized or in mock mode)
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @returns {Promise<any>} Mock value (returns a Promise to allow async ethers import if needed)
     */
    async getMockValue(method, args = []) {
        // Dynamically import ethers if not available
        let ethers;
        if (typeof window !== 'undefined' && window.ethers) {
            ethers = window.ethers;
        } else {
            ethers = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js').then(m => m.ethers || m.default);
        }
        
        // Return appropriate mock values based on method
        switch (method) {
            case 'balanceOf':
                // Return zero balance
                return ethers.BigNumber.from('0');
            
            case 'calculateCost':
                // Return a mock price calculation (e.g., 0.1 ETH for 1M tokens)
                return ethers.utils.parseEther('0.1');
            
            case 'totalSupply':
                return ethers.BigNumber.from('0');
            
            case 'name':
                return 'Mock Token';
            
            case 'symbol':
                return 'MOCK';
            
            case 'decimals':
                return 18;
            
            default:
                // For unknown methods, return zero or empty value
                return ethers.BigNumber.from('0');
        }
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

    /**
     * Get contract owner
     * @returns {Promise<string|null>} Owner address or null
     */
    async getOwner() {
        try {
            if (this.isMock) {
                // For mock contracts, use OwnershipService
                const ownershipService = (await import('../OwnershipService.js')).default;
                return await ownershipService.getOwner(this.contractAddress, this.contractType);
            }

            if (!this.contract) {
                return null;
            }

            // Try to call owner() function
            if (typeof this.contract.owner === 'function') {
                const owner = await this.contract.owner();
                return owner;
            }

            return null;
        } catch (error) {
            console.warn('[ContractAdapter] Error getting owner:', error);
            return null;
        }
    }

    /**
     * Check if user is owner
     * @param {string} userAddress - User address to check
     * @returns {Promise<boolean>} True if user is owner
     */
    async checkOwnership(userAddress) {
        if (!userAddress) {
            return false;
        }

        try {
            if (this.isMock) {
                // For mock contracts, use OwnershipService
                const ownershipService = (await import('../OwnershipService.js')).default;
                return await ownershipService.checkOwnership(
                    this.contractAddress,
                    userAddress,
                    this.contractType
                );
            }

            const owner = await this.getOwner();
            if (!owner) {
                return false;
            }

            return owner.toLowerCase() === userAddress.toLowerCase();
        } catch (error) {
            console.warn('[ContractAdapter] Error checking ownership:', error);
            return false;
        }
    }

    /**
     * Get admin functions from contract ABI
     * @returns {Promise<Array>} Array of admin function definitions
     */
    async getAdminFunctions() {
        try {
            const adminFunctionDiscovery = (await import('../AdminFunctionDiscovery.js')).default;
            
            // For mock contracts, return mock admin functions directly
            if (this.isMock) {
                return adminFunctionDiscovery.getMockAdminFunctions(
                    this.contractAddress,
                    this.contractType
                );
            }
            
            // Try to get ABI from adapter
            const abi = await adminFunctionDiscovery.getABIFromAdapter(this);
            if (!abi) {
                return [];
            }

            return await adminFunctionDiscovery.discoverAdminFunctions(
                this.contractAddress,
                this.contractType,
                abi
            );
        } catch (error) {
            console.warn('[ContractAdapter] Error getting admin functions:', error);
            // Return mock functions as fallback for mock contracts
            if (this.isMock) {
                const adminFunctionDiscovery = (await import('../AdminFunctionDiscovery.js')).default;
                return adminFunctionDiscovery.getMockAdminFunctions(
                    this.contractAddress,
                    this.contractType
                );
            }
            return [];
        }
    }
}

export default ContractAdapter;

