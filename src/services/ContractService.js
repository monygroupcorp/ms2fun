import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../core/EventBus.js';
import walletService from './WalletService.js';

/**
 * ContractService - Handles contract interactions
 */
class ContractService {
    constructor() {
        this.contract = null;
        this.mirrorContract = null;
        this.contractData = null;
        this.contractAddress = null;
        this.networkConfig = null;
        this.isCollectionView = window.location.pathname.includes('collection.html');
        this.swapRouter = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
        
        // Configure retry settings
        this.retryConfig = {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 5000
        };
    }
    
    /**
     * Initialize the contract service
     */
    async initialize() {
        try {
            console.log('Initializing contract service...');
            
            // Get contract data
            await this.loadContractData();
            
            // Initialize with read-only provider first
            await this.initializeReadOnlyContract();
            
            // Initialize listener for wallet connections
            this.setupWalletListeners();
            
            return true;
        } catch (error) {
            console.error('Contract service initialization error:', error);
            eventBus.emit('contract:error', { message: error.message });
            return false;
        }
    }
    
    /**
     * Load contract data from configuration
     */
    async loadContractData() {
        try {
            // Define fallback config
            const fallbackConfig = {
                address: '0x0000000000000000000000000000000000000000',
                networkId: 11155111,
                rpcUrl: 'https://ethereum.publicnode.com',
            };
            
            if (this.isCollectionView) {
                console.log('Collection view detected');
                // Get contract address from URL
                const urlParams = new URLSearchParams(window.location.search);
                const contractAddress = urlParams.get('contract');
                
                if (!contractAddress) {
                    throw new Error('No contract address provided');
                }
                
                // Validate contract address
                if (!ethers.utils.isAddress(contractAddress)) {
                    throw new Error('Invalid contract address');
                }
                
                this.contractAddress = contractAddress;
                this.networkConfig = fallbackConfig;
                this.networkConfig.address = contractAddress;
            } else {
                // Load configuration from switch.json
                try {
                    const response = await this.retryOperation(
                        () => fetch('/EXEC404/switch.json'),
                        'Failed to load network configuration'
                    );
                    this.networkConfig = await response.json();
                    this.contractAddress = this.networkConfig.address;
                } catch (error) {
                    console.warn('Using fallback configuration:', error);
                    this.networkConfig = fallbackConfig;
                    this.contractAddress = fallbackConfig.address;
                }
            }
            
            // Emit event with contract address
            eventBus.emit('contract:loaded', {
                address: this.contractAddress,
                network: this.networkConfig.network || 1
            });
            
            return true;
        } catch (error) {
            console.error('Error loading contract data:', error);
            eventBus.emit('contract:error', { message: error.message });
            throw error;
        }
    }
    
    /**
     * Setup wallet connection listeners
     */
    setupWalletListeners() {
        eventBus.on('wallet:connected', async (data) => {
            try {
                console.log('Wallet connected, initializing contract...');
                
                // Initialize the contract with the connected wallet
                await this.initializeContract(data.ethersProvider, data.signer);
                
                // Emit contract ready event
                eventBus.emit('contract:ready', {
                    address: this.contractAddress,
                    walletAddress: data.address
                });
                
                console.log('Contract ready with signer');
            } catch (error) {
                console.error('Error initializing contract after wallet connection:', error);
                eventBus.emit('contract:error', { message: error.message });
            }
        });
        
        // Handle wallet disconnection
        eventBus.on('wallet:disconnected', () => {
            // Reinitialize with read-only provider
            this.initializeReadOnlyContract();
        });
    }
    
    /**
     * Initialize contract with ethers provider and signer
     * @param {Object} provider - The ethers provider
     * @param {Object} signer - The ethers signer
     */
    async initializeContract(provider, signer) {
        try {
            // Load contract ABI
            const abiResponse = await this.retryOperation(
                () => fetch('/EXEC404/abi.json'),
                'Failed to load contract ABI'
            );
            const contractABI = await abiResponse.json();
            
            // Initialize contract with signer for write operations
            this.contract = new ethers.Contract(
                this.contractAddress,
                contractABI,
                signer
            );
            
            // Initialize mirror contract if available
            try {
                const mirrorAddress = await this.retryOperation(
                    () => this.contract.mirrorERC721(),
                    'Failed to get mirror contract address'
                );
                
                const mirrorAbiResponse = await this.retryOperation(
                    () => fetch('/EXEC404/mirrorabi.json'),
                    'Failed to load mirror contract ABI'
                );
                const mirrorABI = await mirrorAbiResponse.json();
                
                this.mirrorContract = new ethers.Contract(
                    mirrorAddress,
                    mirrorABI,
                    signer
                );
            } catch (error) {
                console.warn('Mirror contract initialization failed:', error);
                // Continue without mirror contract
            }
            
            return true;
        } catch (error) {
            console.error('Contract initialization error:', error);
            eventBus.emit('contract:error', { message: error.message });
            throw error;
        }
    }
    
    /**
     * Initialize contract in read-only mode (no signer)
     */
    async initializeReadOnlyContract() {
        try {
            console.log('Initializing read-only contract...');
            
            // Create a read-only provider
            const provider = new ethers.providers.JsonRpcProvider(
                this.networkConfig.rpcUrl || 'https://ethereum.publicnode.com'
            );
            
            // Load contract ABI
            const abiResponse = await this.retryOperation(
                () => fetch('/EXEC404/abi.json'),
                'Failed to load contract ABI'
            );
            const contractABI = await abiResponse.json();
            
            // Initialize contract with provider for read-only operations
            this.contract = new ethers.Contract(
                this.contractAddress,
                contractABI,
                provider
            );
            
            // Emit contract ready event in read-only mode
            eventBus.emit('contract:readOnly', {
                address: this.contractAddress
            });
            
            return true;
        } catch (error) {
            console.error('Read-only contract initialization error:', error);
            eventBus.emit('contract:error', { message: error.message });
            return false;
        }
    }
    
    /**
     * Execute a contract method safely with retries
     * @param {string} method - Contract method to call
     * @param {Array} args - Arguments for the method
     * @param {Object} options - Transaction options (value, gasLimit, etc.)
     * @returns {Promise} - Result of the contract call
     */
    async executeContractCall(method, args = [], options = {}) {
        if (!this.contract) {
            throw new Error('Contract not initialized');
        }
        
        try {
            const operation = async () => {
                // Get the contract method
                const contractMethod = this.contract.functions[method];
                
                if (!contractMethod) {
                    throw new Error(`Method '${method}' not found on contract`);
                }
                
                // Call the method with arguments and options
                const result = await contractMethod(...args, options);
                return result;
            };
            
            // Execute with retries
            return await this.retryOperation(
                operation,
                `Contract call to '${method}' failed`
            );
        } catch (error) {
            console.error(`Error calling contract method '${method}':`, error);
            throw this.wrapError(error, `Contract method '${method}' failed`);
        }
    }
    
    /**
     * Retry an operation with exponential backoff
     * @param {Function} operation - The operation to retry
     * @param {string} errorMessage - Error message if all retries fail
     * @param {Object} customConfig - Custom retry configuration
     * @returns {Promise} - Result of the operation
     */
    async retryOperation(operation, errorMessage, customConfig = {}) {
        const config = { ...this.retryConfig, ...customConfig };
        let lastError;
        
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Check if we should continue retrying
                if (this.isNonRetryableError(error) || attempt === config.maxAttempts) {
                    break;
                }
                
                // Calculate delay with exponential backoff
                const delay = Math.min(
                    config.baseDelay * Math.pow(2, attempt - 1),
                    config.maxDelay
                );
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw this.wrapError(lastError, errorMessage);
    }
    
    /**
     * Check if an error is non-retryable
     * @param {Error} error - The error to check
     * @returns {boolean} - Whether the error is non-retryable
     */
    isNonRetryableError(error) {
        // User rejected transaction
        if (error.code === 4001) return true;
        
        // Invalid argument errors
        if (error.reason && error.reason.includes('invalid')) return true;
        
        return false;
    }
    
    /**
     * Wrap an error with context
     * @param {Error} error - The original error
     * @param {string} context - Context to add to the error
     * @returns {Error} - The wrapped error
     */
    wrapError(error, context) {
        const wrappedError = new Error(`${context}: ${error.message}`);
        wrappedError.originalError = error;
        wrappedError.code = error.code;
        return wrappedError;
    }
    
    /**
     * Get the current token price
     * @returns {Promise<string>} - The token price in ETH
     */
    async getTokenPrice() {
        try {
            const price = await this.executeContractCall('getCurrentPrice');
            return ethers.utils.formatEther(price);
        } catch (error) {
            console.error('Error getting token price:', error);
            throw error;
        }
    }
    
    /**
     * Get the token balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<string>} - The token balance
     */
    async getTokenBalance(address) {
        try {
            const balance = await this.executeContractCall('balanceOf', [address]);
            return ethers.utils.formatEther(balance);
        } catch (error) {
            console.error('Error getting token balance:', error);
            throw error;
        }
    }
    
    /**
     * Get the NFT balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<number>} - The NFT balance
     */
    async getNFTBalance(address) {
        try {
            const balance = await this.executeContractCall('getNFTBalance', [address]);
            return balance.toNumber();
        } catch (error) {
            console.error('Error getting NFT balance:', error);
            throw error;
        }
    }
    
    /**
     * Buy tokens with ETH
     * @param {Object} params - Buy parameters
     * @param {string} ethValue - ETH value to send
     * @returns {Promise<Object>} - Transaction result
     */
    async buyTokens(params, ethValue) {
        if (!walletService.isConnected()) {
            throw new Error('No wallet connected');
        }
        
        try {
            // Convert ETH value to wei
            const value = ethers.utils.parseEther(ethValue);
            
            // Send the transaction
            const tx = await this.executeContractCall('buyBonding', [params], {
                value,
                gasLimit: 500000 // Adjust as needed
            });
            
            // Emit transaction sent event
            eventBus.emit('transaction:sent', {
                hash: tx.hash,
                type: 'buy',
                value: ethValue
            });
            
            // Wait for transaction to be mined
            const receipt = await tx.wait();
            
            // Emit transaction confirmed event
            eventBus.emit('transaction:confirmed', {
                hash: tx.hash,
                receipt: receipt,
                type: 'buy',
                value: ethValue
            });
            
            return receipt;
        } catch (error) {
            console.error('Error buying tokens:', error);
            eventBus.emit('transaction:failed', {
                type: 'buy',
                error: error.message
            });
            throw error;
        }
    }
    
    /**
     * Sell tokens for ETH
     * @param {Object} params - Sell parameters
     * @returns {Promise<Object>} - Transaction result
     */
    async sellTokens(params) {
        if (!walletService.isConnected()) {
            throw new Error('No wallet connected');
        }
        
        try {
            // Send the transaction
            const tx = await this.executeContractCall('sellBonding', [params], {
                gasLimit: 500000 // Adjust as needed
            });
            
            // Emit transaction sent event
            eventBus.emit('transaction:sent', {
                hash: tx.hash,
                type: 'sell',
                amount: params.execAmount
            });
            
            // Wait for transaction to be mined
            const receipt = await tx.wait();
            
            // Emit transaction confirmed event
            eventBus.emit('transaction:confirmed', {
                hash: tx.hash,
                receipt: receipt,
                type: 'sell',
                amount: params.execAmount
            });
            
            return receipt;
        } catch (error) {
            console.error('Error selling tokens:', error);
            eventBus.emit('transaction:failed', {
                type: 'sell',
                error: error.message
            });
            throw error;
        }
    }
}

// Create a singleton instance
const contractService = new ContractService();
export default contractService; 