// import { ethers } from './node_modules/ethers/dist/ethers.esm.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../core/EventBus.js';
import MerkleHandler from '../merkleHandler.js';

class BlockchainService {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.mirrorContract = null;
        this.connectionState = 'disconnected';
        this.networkConfig = null;
        this.ethers = ethers;
        // Configure retry settings
        this.retryConfig = {
            maxAttempts: 3,
            baseDelay: 1000, // 1 second
            maxDelay: 5000   // 5 seconds
        };

        // Subscribe to network changes
        if (window.ethereum) {
            window.ethereum.on('chainChanged', () => this.handleNetworkChange());
            window.ethereum.on('accountsChanged', () => this.handleAccountChange());
        }

        // Add merkleHandler initialization
        this.merkleHandler = new MerkleHandler();
    }

    // Initialize the service with contract details
    async initialize() {
        try {
            // Load network configuration
            const response = await this.retryOperation(
                () => fetch('/EXEC404/switch.json'),
                'Failed to load network configuration'
            );
            this.networkConfig = await response.json();

            if (!this.networkConfig.address) {
                throw new Error('Contract address not found in network configuration');
            }

            // Initialize provider
            await this.initializeProvider();

            // Load contract ABI and initialize contract with address from config
            await this.initializeContract(this.networkConfig.address);

            // Initialize merkle handler
            this.initializeMerkleHandler();

            this.connectionState = 'connected';
            eventBus.emit('blockchain:initialized');
            
            return true;
        } catch (error) {
            this.connectionState = 'error';
            eventBus.emit('blockchain:error', error);
            throw this.wrapError(error, 'Blockchain initialization failed');
        }
    }

    async initializeProvider() {
        try {
            // Create read-only provider for data queries
            this.provider = new ethers.providers.JsonRpcProvider(this.networkConfig.rpcUrl);
            
            // Test provider connection
            await this.provider.getNetwork();
            
            // Initialize Web3 provider if available
            if (window.ethereum) {
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
                this.signer = web3Provider.getSigner();
            }
        } catch (error) {
            throw this.wrapError(error, 'Provider initialization failed');
        }
    }

    async initializeContract(contractAddress) {
        try {
            // Load contract ABI
            const abiResponse = await this.retryOperation(
                () => fetch('/EXEC404/abi.json'),
                'Failed to load contract ABI'
            );
            const contractABI = await abiResponse.json();

            // Initialize main contract
            this.contract = new ethers.Contract(
                contractAddress,
                contractABI,
                this.provider
            );

            // Initialize mirror contract
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
                this.provider
            );
        } catch (error) {
            throw this.wrapError(error, 'Contract initialization failed');
        }
    }

    // Add merkle handler initialization method
    async initializeMerkleHandler() {
        try {
            await this.merkleHandler.initializeTrees();
        } catch (error) {
            console.error('Error initializing merkle handler:', error);
            throw this.wrapError(error, 'Merkle handler initialization failed');
        }
    }

    async getMerkleProof(address) {
        const tier = this.merkleHandler.findAddressTier(address);
        if (!tier) {
            return null; // Address not found in any tier
        }
        const proof = this.merkleHandler.getProof(tier, address);
        return proof;
    }

    async getTotalBondingSupply() {
        try {
            const supply = await this.executeContractCall('totalBondingSupply');
            // Convert from BigNumber to number and format
            return parseFloat(this.ethers.utils.formatUnits(supply, 0));
        } catch (error) {
            throw this.wrapError(error, 'Failed to get total bonding supply');
        }
    }

    async getTotalMessages() {
        try {
            const messages = await this.executeContractCall('totalMessages');
            return parseFloat(this.ethers.utils.formatUnits(messages, 0));;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get total messages');
        }
    }

    async getMessagesBatch(startIndex, endIndex) {
        const messages = await this.executeContractCall('getMessagesBatch', [startIndex, endIndex]);
        return messages.map(message => message.toString());
    }

    /**
     * Gets token balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<string>} Balance in wei
     */
    async getTokenBalance(address) {
        return this.executeContractCall('balanceOf', [address]);
    }

    /**
     * Gets NFT balance for an address using mirror contract
     * @param {string} address - The address to check
     * @returns {Promise<number>} Number of NFTs owned
     */
    async getNFTBalance(address) {
        try {
            const balance = await this.executeContractCall(
                'balanceOf',
                [address],
                { useContract: 'mirror' }
            );
            return parseInt(balance.toString());
        } catch (error) {
            throw this.wrapError(error, 'Failed to get NFT balance');
        }
    }

    async getNFTSupply() {
        try {
            return this.executeContractCall('totalSupply', [], { useContract: 'mirror' });
        } catch (error) {
            throw this.wrapError(error, 'Failed to get NFT supply');
        }
    }

    /**
     * Gets ETH balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<string>} Balance in wei
     */
    async getEthBalance(address) {
        try {
            const balance = await this.provider.getBalance(address);
            return balance.toString();
        } catch (error) {
            throw this.wrapError(error, 'Failed to get ETH balance');
        }
    }

    /**
     * Execute buy bonding transaction
     * @param {Object} params - Transaction parameters
     * @param {string} params.amount - Amount of EXEC to buy
     * @param {string} params.maxCost - Maximum ETH cost in wei
     * @param {boolean} params.mintNFT - Whether to mint NFT
     * @param {Array} params.proof - Merkle proof
     * @param {string} params.message - Transaction message
     * @param {string} ethValue - ETH value in ether
     * @returns {Promise<Object>} Transaction receipt
     */
    async buyBonding(params, ethValue) {
        try {
            eventBus.emit('transaction:pending', { type: 'buy' });
            console.log('Buy bonding called with params:', params);
            
            const receipt = await this.executeContractCall(
                'buyBonding',
                [params.amount, params.maxCost, params.mintNFT, params.proof, params.message],
                { 
                    requiresSigner: true,
                    txOptions: { value: ethValue }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'buy',
                receipt,
                amount: params.amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'buy',
                error: this.wrapError(error, 'Buy bonding failed')
            });
            throw error;
        }
    }

    /**
     * Execute sell bonding transaction
     * @param {Object} params - Transaction parameters
     * @param {string} params.amount - Amount of EXEC to sell
     * @param {string} params.minReturn - Minimum ETH return in wei
     * @param {Array} params.proof - Merkle proof
     * @param {string} params.message - Transaction message
     * @returns {Promise<Object>} Transaction receipt
     */
    async sellBonding(params) {
        try {
            eventBus.emit('transaction:pending', { type: 'sell' });

            const receipt = await this.executeContractCall(
                'sellBonding',
                [params.amount, params.minReturn, params.proof, params.message],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'sell',
                receipt,
                amount: params.amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'sell',
                error: this.wrapError(error, 'Sell bonding failed')
            });
            throw error;
        }
    }

    /**
     * Enhanced executeContractCall with contract selection
     */
    async executeContractCall(method, args = [], options = {}) {
        const operation = async () => {
            try {
                if (!this.contract) {
                    throw new Error('Contract not initialized');
                }

                // Select contract instance
                let contractInstance = options.useContract === 'mirror' ? 
                    this.mirrorContract : 
                    this.contract;

                // Add signer if needed
                if (options.requiresSigner) {
                    if (!this.signer) {
                        throw new Error('No wallet connected');
                    }
                    contractInstance = contractInstance.connect(this.signer);
                }

                // Check if method exists on contract
                if (typeof contractInstance[method] !== 'function') {
                    throw new Error(`Method ${method} not found on contract`);
                }

                // Execute the contract call
                const result = await contractInstance[method](...(args || []), options.txOptions || {});

                // If this is a transaction, wait for confirmation
                if (result.wait) {
                    const receipt = await result.wait();
                    eventBus.emit('transaction:confirmed', { 
                        hash: receipt.transactionHash,
                        method,
                        args 
                    });
                    return receipt;
                }

                return result;
            } catch (error) {
                throw this.handleContractError(error, method);
            }
        };

        return this.retryOperation(
            operation,
            `Contract call ${method} failed`
        );
    }

    // Helper method to implement exponential backoff retry logic
    async retryOperation(operation, errorMessage, customConfig = {}) {
        const config = { ...this.retryConfig, ...customConfig };
        let lastError;
        
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Don't retry if it's a user rejection or invalid input
                if (this.isNonRetryableError(error)) {
                    throw this.wrapError(error, errorMessage);
                }
                
                // Don't wait on the last attempt
                if (attempt < config.maxAttempts) {
                    const delay = Math.min(
                        config.baseDelay * Math.pow(2, attempt - 1),
                        config.maxDelay
                    );
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw this.wrapError(lastError, `${errorMessage} after ${config.maxAttempts} attempts`);
    }

    // Error handling methods
    handleContractError(error, method) {
        // Handle common contract errors
        if (error.code === 'INSUFFICIENT_FUNDS') {
            return new Error('Insufficient funds to complete transaction');
        }
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            return new Error('Transaction would fail - check your inputs');
        }
        if (error.code === 4001) {
            return new Error('Transaction rejected by user');
        }
        
        // Log unexpected errors
        console.error(`Contract error in ${method}:`, error);
        return error;
    }

    isNonRetryableError(error) {
        return (
            error.code === 4001 || // User rejected
            error.code === 'INSUFFICIENT_FUNDS' ||
            error.code === 'INVALID_ARGUMENT'
        );
    }

    wrapError(error, context) {
        const wrappedError = new Error(`${context}: ${error.message}`);
        wrappedError.originalError = error;
        wrappedError.code = error.code;
        return wrappedError;
    }

    // Network and account change handlers
    async handleNetworkChange() {
        try {
            await this.initializeProvider();
            eventBus.emit('network:changed');
        } catch (error) {
            eventBus.emit('blockchain:error', error);
        }
    }

    async handleAccountChange() {
        try {
            if (window.ethereum) {
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
                this.signer = web3Provider.getSigner();
                eventBus.emit('account:changed');
            }
        } catch (error) {
            eventBus.emit('blockchain:error', error);
        }
    }

    // Getters for connection state
    getConnectionState() {
        return this.connectionState;
    }

    isConnected() {
        return this.connectionState === 'connected';
    }


    async getTokenPrice() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Format amount with 18 decimals (like ETH)
            const amount = ethers.utils.parseEther('1000000');
            
            // Get price using calculateCost
            const price = await this.executeContractCall('calculateCost', [amount]);
            
            // Ensure price is properly formatted
            if (!price || !ethers.BigNumber.isBigNumber(price)) {
                throw new Error('Invalid price format from contract');
            }

            // Convert BigNumber to number and format
            const priceInEth = parseFloat(this.ethers.utils.formatEther(price));

            return priceInEth;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get token price');
        }
    }

    async getCurrentPrice() {
        try {
            return await this.getTokenPrice();
        } catch (error) {
            throw this.wrapError(error, 'Failed to get current price');
        }
    }

    async calculateCost(execAmount) {
        try {
            const response = await this.executeContractCall('calculateCost', [execAmount]);
            return response;

        } catch (error) {
            throw this.wrapError(error, 'Failed to calculate cost');
        }
    }

    async getExecForEth(ethAmount) {
        try {
            const weiAmount = ethers.utils.parseEther(ethAmount.toString());
            const execAmount = await this.executeContractCall('getExecForEth', [weiAmount]);
            return this.formatExec(execAmount);
        } catch (error) {
            throw this.wrapError(error, 'Failed to calculate EXEC for ETH amount');
        }
    }

    async getEthForExec(execAmount) {
        try {
            const execWei = ethers.utils.parseUnits(execAmount.toString(), 18);
            const ethAmount = await this.executeContractCall('getEthForExec', [execWei]);
            return this.formatEther(ethAmount);
        } catch (error) {
            throw this.wrapError(error, 'Failed to calculate ETH for EXEC amount');
        }
    }

    /**
     * Convert ETH amount to Wei
     * @param {string} ethAmount 
     * @returns {string} Amount in Wei
     */
    parseEther(ethAmount) {
        return ethers.utils.parseEther(ethAmount).toString();
    }

    formatEther(weiAmount) {
        return parseFloat(ethers.utils.formatEther(weiAmount));
    }

    /**
     * Convert EXEC amount to BigNumber string with 18 decimals
     * @param {string} execAmount 
     * @returns {string} BigNumber string with proper decimals
     */
    parseExec(execAmount) {
        return ethers.utils.parseUnits(execAmount, 18).toString();
    }

    formatExec(weiAmount) {
        return parseFloat(ethers.utils.formatUnits(weiAmount, 18));
    }
}

export default BlockchainService; 
