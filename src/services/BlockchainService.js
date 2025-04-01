import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';
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
        this.isInternalNetworkChange = false;
    }

    // Initialize the service with contract details
    async initialize() {
        try {
            // Define fallback config
            const fallbackConfig = {
                address: '0x0000000000000000000000000000000000000000',
                networkId: 11155111,
                rpcUrl: window.ethereum ? window.ethereum.url : 'https://ethereum.publicnode.com',
            };

            try {
                // Attempt to load network configuration
                const response = await this.retryOperation(
                    () => fetch('/EXEC404/switch.json'),
                    'Failed to load network configuration'
                );
                this.networkConfig = await response.json();
            } catch (error) {
                console.warn('Using fallback configuration:', error);
                this.networkConfig = fallbackConfig;
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
            if (window.ethereum) {
                console.log('NETWORK DEBUG: Starting provider initialization');
                console.log('NETWORK DEBUG: Initial ethereum chainId:', await window.ethereum.request({ method: 'eth_chainId' }));
                
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
                this.provider = web3Provider;
                this.signer = web3Provider.getSigner();

                const network = await this.provider.getNetwork();
                const targetNetwork = parseInt(this.networkConfig?.network || '1');
                
                console.log('NETWORK DEBUG: Current network:', network.chainId);
                console.log('NETWORK DEBUG: Target network:', targetNetwork);
                console.log('NETWORK DEBUG: Network config:', this.networkConfig);

                if (network.chainId !== targetNetwork) {
                    console.log('NETWORK DEBUG: Network mismatch detected, requesting switch...');
                    // Emit event before attempting switch
                    eventBus.emit('network:switching', {
                        from: network.chainId,
                        to: targetNetwork,
                        automatic: true
                    });

                    try {
                        this.isInternalNetworkChange = true;
                        await window.ethereum.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: `0x${targetNetwork.toString(16)}` }],
                        });
                        
                        console.log('NETWORK DEBUG: Network switch completed');
                        // Refresh provider after switch
                        this.provider = new ethers.providers.Web3Provider(window.ethereum);
                        this.signer = this.provider.getSigner();
                        
                        // Emit success event
                        eventBus.emit('network:switched', {
                            from: network.chainId,
                            to: targetNetwork,
                            success: true
                        });

                    } catch (switchError) {
                        this.isInternalNetworkChange = false;
                        console.log('NETWORK DEBUG: Switch error:', switchError);
                        
                        // Emit failure event
                        eventBus.emit('network:switched', {
                            from: network.chainId,
                            to: targetNetwork,
                            success: false,
                            error: switchError.message
                        });

                        if (switchError.code === 4902) {
                            console.log('NETWORK DEBUG: Network not found, attempting to add...');
                            await window.ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [{
                                    chainId: `0x${targetNetwork.toString(16)}`,
                                    rpcUrls: [this.networkConfig.rpcUrl || 'https://eth-sepolia.g.alchemy.com/v2/demo'],
                                    chainName: 'Sepolia Test Network',
                                    nativeCurrency: {
                                        name: 'ETH',
                                        symbol: 'ETH',
                                        decimals: 18
                                    }
                                }]
                            });
                            // Refresh provider after adding network
                            this.provider = new ethers.providers.Web3Provider(window.ethereum);
                            this.signer = this.provider.getSigner();
                        } else {
                            throw switchError;
                        }
                    }
                    this.isInternalNetworkChange = false;
                } else {
                    console.log('NETWORK DEBUG: Already on correct network');
                }
            } else {
                console.log('NETWORK DEBUG: No injected provider, using fallback');
                const rpcUrl = this.networkConfig?.rpcUrl || 'https://ethereum.publicnode.com';
                this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            }
            
            // Final test of provider connection
            const finalNetwork = await this.provider.getNetwork();
            console.log('NETWORK DEBUG: Final network state:', finalNetwork.chainId);
            
        } catch (error) {
            this.isInternalNetworkChange = false;
            console.error('NETWORK DEBUG: Provider initialization failed:', error);
            throw this.wrapError(error, 'Provider initialization failed');
        }
    }

    async initializeContract(contractAddress) {
        try {
            console.log('INITIALIZING CONTRACT', contractAddress);
            console.log('PROVIDER', this.provider);
            console.log('NETWORK CONFIG', this.networkConfig);
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

            tradingStore.setContracts(contractAddress, mirrorAddress);

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
            console.log('NFT BALANCE', balance.toString());
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
            if (this.isInternalNetworkChange) {
                console.log('NETWORK DEBUG: Ignoring internal network change');
                return;
            }
            console.log('NETWORK DEBUG: External network change detected');
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

    async getFreeSupply() {
        try {
            const freeExec = await this.executeContractCall('freeSupply');
            return this.formatExec(freeExec);
        } catch (error) {
            throw this.wrapError(error, 'Failed to get free supply');
        }
    }

    async getFreeMint(address) {
        try {
            const freeMint = await this.executeContractCall('freeMint', [address]);
            console.log('FREE MINT', freeMint);
            return freeMint;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get free mint');
        }
    }

    async getFreeSituation(address) {
        try {
            const freeMint = await this.getFreeMint(address);
            const freeSupply = await this.getFreeSupply();
            const freeSituation = {
                freeMint,
                freeSupply
            };
            return freeSituation;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get free situation');
        }
    }

    async getUserNFTIds(address) {
        try {
            const nftIds = await this.executeContractCall('getOwnerTokens', [address]);
            return nftIds;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get user NFT IDs');
        }
    }

    async getTokenUri(tokenId) {
        try {
            const uri = await this.executeContractCall('tokenURI', [tokenId]);
            return uri;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get token URI');
        }
    }
    
    async getContractEthBalance() {
        try {
            const balance = await this.provider.getBalance(this.contract.address);
            const formattedBalance = this.formatEther(balance);
            console.log('CONTRACT ETH BALANCE', formattedBalance);
            return formattedBalance;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get contract ETH balance');
        }
    }

    async getUserNFTs(address) {
        try {
            const nftIds = await this.executeContractCall('getOwnerTokens', [address]);
            return nftIds;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get user NFT IDs');
        }
    }

    async getNFTMetadata(tokenId) {
        try {
            const metadata = await this.executeContractCall('tokenURI', [tokenId]);
            console.log('NFT METADATA', metadata);
            return metadata;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get NFT metadata');
        }
    }

    async getNFTMetadataBatch(tokenIds) {
        try {
            const metadataPromises = tokenIds.map(id => 
                this.executeContractCall('tokenURI', [id])
            );
            
            const metadata = await Promise.all(metadataPromises);
            console.log('Batch NFT Metadata:', metadata);
            return metadata;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get NFT metadata batch');
        }
    }

    async getUserNFTsWithMetadata(address, limit = 5) {
        try {
            // Get all NFT IDs for the user
            const nftIds = await this.getUserNFTs(address);
            
            // Take only the first 'limit' number of NFTs
            const selectedIds = nftIds.slice(0, limit);
            
            // Fetch metadata for selected NFTs
            const metadata = await this.getNFTMetadataBatch(selectedIds);
            
            // Combine IDs with their metadata
            const nftsWithMetadata = selectedIds.map((id, index) => ({
                tokenId: id,
                metadata: metadata[index]
            }));

            console.log('NFTs with metadata:', nftsWithMetadata);
            return nftsWithMetadata;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get user NFTs with metadata');
        }
    }

    async balanceMint(amount) {
        try {
            // Emit pending event
            eventBus.emit('transaction:pending', { type: 'mint' });
            
            const receipt = await this.executeContractCall(
                'balanceMint', 
                [amount], 
                { requiresSigner: true }
            );

            // Emit success event
            eventBus.emit('transaction:success', {
                type: 'mint',
                receipt,
                amount: amount
            });

            return receipt;
        } catch (error) {
            // Emit error event
            eventBus.emit('transaction:error', {
                type: 'mint',
                error: this.wrapError(error, 'Failed to mint NFTs')
            });
            throw error;
        }
    }

    async transferNFT(address, recipient, tokenId) {
        try {
            // Emit pending event
            eventBus.emit('transaction:pending', { type: 'send' });
            const receipt = await this.executeContractCall('transferFrom', [address, recipient, tokenId], { requiresSigner: true, useContract: 'mirror' });
            // Emit success event
            eventBus.emit('transaction:success', {
                type: 'send',
                receipt,
                tokenId: tokenId,
                recipient: recipient
            });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'send',
                error: this.wrapError(error, 'Failed to send NFT')
            });
            throw error;
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
