import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';
import MerkleHandler from '../merkleHandler.js';
import { contractCache } from './ContractCache.js';

class BlockchainService {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.mirrorContract = null;
        this.connectionState = 'disconnected';
        this.networkConfig = null;
        this.ethers = ethers;

        this.swapRouter = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

        // Add merkleHandler initialization
        this.merkleHandler = new MerkleHandler();
        this.isInternalNetworkChange = false;
        
        // Add transaction tracking
        this.transactionCounter = 0;
        this.activeTransactions = new Map();
        
        // Network change state machine
        this.networkChangeState = 'idle'; // 'idle' | 'switching' | 'switched' | 'error'
        this.networkChangeTimeout = null;
        this.networkChangeTimeoutDuration = 30000; // 30 seconds
        this.pendingNetworkChange = null;
        this.previousNetworkId = null;
        
        // Track initialization state to prevent race conditions
        this.isInitializing = false;
        
        // Store handlers for later setup (after initialization)
        // Don't set up listeners yet - wait until after initialization
        // This prevents race conditions when network switches during init
        this.chainChangedHandler = () => this.handleNetworkChange();
        this.accountsChangedHandler = () => this.handleAccountChange();
    }

    // Initialize the service with contract details
    async initialize() {
        // Mark as initializing to prevent race conditions
        this.isInitializing = true;
        
        try {
            // Define fallback config
            const fallbackConfig = {
                address: '0x0000000000000000000000000000000000000000',
                networkId: 11155111,
                rpcUrl: window.ethereum ? window.ethereum.url : 'https://ethereum.publicnode.com',
            };

            try {
                // Attempt to load network configuration
                const response = await fetch('/EXEC404/switch.json');
                if (!response.ok) {
                    throw new Error(`Failed to load network configuration: ${response.statusText}`);
                }
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
            
            // NOW set up network change listeners after initialization is complete
            // This prevents race conditions from chainChanged events during init
            this.setupNetworkListeners();
            
            eventBus.emit('blockchain:initialized');
            
            // Emit contract updated event after initialization
            eventBus.emit('contract:updated');
            
            // Mark initialization as complete
            this.isInitializing = false;
            
            return true;
        } catch (error) {
            this.connectionState = 'error';
            this.isInitializing = false;
            eventBus.emit('blockchain:error', error);
            throw this.wrapError(error, 'Blockchain initialization failed');
        }
    }
    
    /**
     * Set up network change listeners (called after initialization)
     * @private
     */
    setupNetworkListeners() {
        if (window.ethereum && this.chainChangedHandler && this.accountsChangedHandler) {
            // Remove any existing listeners first
            try {
                window.ethereum.removeListener('chainChanged', this.chainChangedHandler);
                window.ethereum.removeListener('accountsChanged', this.accountsChangedHandler);
            } catch (error) {
                // Ignore errors when removing non-existent listeners
            }
            
            // Set up listeners
            window.ethereum.on('chainChanged', this.chainChangedHandler);
            window.ethereum.on('accountsChanged', this.accountsChangedHandler);
            
            console.log('BlockchainService: Network change listeners set up');
        }
    }

    async initializeProvider() {
        try {
            if (window.ethereum) {
                // Wait for network to stabilize before creating provider
                // This prevents "underlying network changed" errors during initialization
                const targetNetwork = parseInt(this.networkConfig?.network || '1');
                await this.waitForCorrectNetwork(targetNetwork);
                
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
                this.provider = web3Provider;
                this.signer = web3Provider.getSigner();

                // Verify network one more time after creating provider
                const network = await this.provider.getNetwork();
                
                if (network.chainId !== targetNetwork) {
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
                        
                        // Emit failure event
                        eventBus.emit('network:switched', {
                            from: network.chainId,
                            to: targetNetwork,
                            success: false,
                            error: switchError.message
                        });

                        if (switchError.code === 4902) {
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
                }
            } else {
                const rpcUrl = this.networkConfig?.rpcUrl || 'https://ethereum.publicnode.com';
                this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            }
            
            
        } catch (error) {
            this.isInternalNetworkChange = false;
            throw this.wrapError(error, 'Provider initialization failed');
        }
    }

    async initializeContract(contractAddress) {
        try {
            // Load contract ABI
            const abiResponse = await fetch('/EXEC404/abi.json');
            if (!abiResponse.ok) throw new Error('Failed to load contract ABI');
            const contractABI = await abiResponse.json();

            // Initialize main contract
            this.contract = new ethers.Contract(
                contractAddress,
                contractABI,
                this.provider
            );

            // Initialize mirror contract
            const mirrorAddress = await this.contract.mirrorERC721();
            
            const mirrorAbiResponse = await fetch('/EXEC404/mirrorabi.json');
            if (!mirrorAbiResponse.ok) throw new Error('Failed to load mirror contract ABI');
            const mirrorABI = await mirrorAbiResponse.json();

            const routerAddress = this.swapRouter;
            const routerABI = [
                {
                    "inputs": [
                        {
                            "internalType": "uint256",
                            "name": "amountOutMin",
                            "type": "uint256"
                        },
                        {
                            "internalType": "address[]",
                            "name": "path",
                            "type": "address[]"
                        },
                        {
                            "internalType": "address",
                            "name": "to",
                            "type": "address"
                        },
                        {
                            "internalType": "uint256",
                            "name": "deadline",
                            "type": "uint256"
                        }
                    ],
                    "name": "swapExactETHForTokensSupportingFeeOnTransferTokens",
                    "outputs": [],
                    "stateMutability": "payable",
                    "type": "function"
                },
                {
                    "inputs": [
                        {
                            "internalType": "uint256",
                            "name": "amountIn",
                            "type": "uint256"
                        },
                        {
                            "internalType": "uint256",
                            "name": "amountOutMin",
                            "type": "uint256"
                        },
                        {
                            "internalType": "address[]",
                            "name": "path",
                            "type": "address[]"
                        },
                        {
                            "internalType": "address",
                            "name": "to",
                            "type": "address"
                        },
                        {
                            "internalType": "uint256",
                            "name": "deadline",
                            "type": "uint256"
                        }
                    ],
                    "name": "swapExactTokensForETHSupportingFeeOnTransferTokens",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                },
                {
                    "inputs": [
                        {
                            "internalType": "uint256",
                            "name": "amountIn",
                            "type": "uint256"
                        },
                        {
                            "internalType": "address[]",
                            "name": "path",
                            "type": "address[]"
                        }
                    ],
                    "name": "getAmountsOut",
                    "outputs": [
                        {
                            "internalType": "uint256[]",
                            "name": "amounts",
                            "type": "uint256[]"
                        }
                    ],
                    "stateMutability": "view",
                    "type": "function"
                }
            ]

            this.swapRouter = new ethers.Contract(
                routerAddress,
                routerABI,
                this.provider
            );

            tradingStore.setContracts(contractAddress, mirrorAddress, routerAddress);

            this.mirrorContract = new ethers.Contract(
                mirrorAddress,
                mirrorABI,
                this.provider
            );

            // Fetch the liquidity pool address
            const liquidityPoolAddress = await this.getLiquidityPool();
            if (liquidityPoolAddress !== '0x0000000000000000000000000000000000000000') {
                const poolABI = [
                    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
                    "function token0() external view returns (address)",
                    "function token1() external view returns (address)"
                ];

                this.v2PoolContract = new ethers.Contract(
                    liquidityPoolAddress,
                    poolABI,
                    this.provider
                );
            } else {
                console.warn('Liquidity pool address is zero, skipping pool contract initialization.');
            }

        } catch (error) {
            throw this.wrapError(error, 'Contract initialization failed');
        }
    }

    // Add merkle handler initialization method
    async initializeMerkleHandler() {
        try {
            // Check if we're in phase 0 or 1 (pre-launch or phase 1)
            // Phase 0: switch.json doesn't exist
            // Phase 1: switch.json exists
            // Phase 2+: switch.json exists but we don't need Merkle trees
            
            // Check if we're at least in phase 1
            let isPhase1OrBeyond = false;
            try {
                const switchResponse = await fetch('/EXEC404/switch.json');
                isPhase1OrBeyond = switchResponse.ok;
            } catch (error) {
                // If there's an error fetching, assume we're in phase 0
                console.log('Error fetching switch.json, assuming phase 0:', error);
                isPhase1OrBeyond = false;
            }
            
            if (!isPhase1OrBeyond) {
                // We're in phase 0 (pre-launch), initialize Merkle trees
                console.log('Phase 0 detected, initializing Merkle trees in BlockchainService');
                await this.merkleHandler.initializeTrees();
                console.log('Merkle handler initialized for phase 0 in BlockchainService');
            } else {
                // We're in phase 1 or beyond, check if we're in phase 1
                // For now, assume we're in phase 1 if switch.json exists and phase 2 otherwise
                // This is a simplification and might need to be adjusted based on actual logic
                
                // For demonstration, we'll check if a specific property exists in switch.json
                // that would indicate we're in phase 1
                const switchData = await (await fetch('/EXEC404/switch.json')).json();
                const isPhase1 = switchData.phase === 1 || switchData.requireMerkle === true;
                
                if (isPhase1) {
                    console.log('Phase 1 detected, initializing Merkle trees in BlockchainService');
                    await this.merkleHandler.initializeTrees();
                    console.log('Merkle handler initialized for phase 1 in BlockchainService');
                } else {
                    console.log('Phase 2 or beyond detected, skipping Merkle tree initialization in BlockchainService');
                    // Initialize an empty map to avoid potential errors when trying to access trees
                    this.merkleHandler.trees = new Map();
                }
            }
        } catch (error) {
            console.error('Error initializing merkle handler:', error);
            throw this.wrapError(error, 'Merkle handler initialization failed');
        }
    }

    async getMerkleProof(address, tier = null) {
        try {
            // If no tier specified, get current tier from contract and add 1
            if (tier === null) {
                const currentTier = await this.getCurrentTier();
                tier = currentTier;
            }
            // Find the proof for this address in the specified tier
            const proof = this.merkleHandler.getProof(tier+1, address);
            // If proof is null or proof.valid is false, the address is not whitelisted for this tier
            if (!proof || !proof.valid) {
                console.log(`Address ${address} not whitelisted for tier ${tier}`);
                return null;
            }

            return proof;
        } catch (error) {
            console.error('Error getting merkle proof:', error);
            return null;
        }
    }

    /**
     * Enhanced executeContractCall with contract selection
     */
    async executeContractCall(method, args = [], options = {}) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Select contract instance
            let contractInstance = options.useContract === 'mirror' ? 
                this.mirrorContract : 
                this.contract;

            if (options.useContract === 'router') {
                contractInstance = this.swapRouter;
            }

            if (options.useContract === 'v2pool') {
                contractInstance = this.v2PoolContract;
            }

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
    }

    // Error handling methods
    handleContractError(error, method) {
        // Extract the revert reason if it exists
        let message = error.message;
        
        // Handle common contract errors
        if (error.code === 'INSUFFICIENT_FUNDS') {
            return new Error('Insufficient funds to complete transaction');
        }
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            // Try to extract the revert reason from the error
            const revertMatch = error.message.match(/execution reverted: (.*?)(?:\"|$)/);
            message = revertMatch ? `Tx Reverted: ${revertMatch[1]}` : 'Transaction would fail - check your inputs';
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
        console.error(`Contract error in ${method}:`, error);
        return new Error(message);
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
            // Ignore network changes during initialization to prevent race conditions
            if (this.isInitializing) {
                console.log('BlockchainService: Ignoring network change during initialization');
                return;
            }
            
            if (this.isInternalNetworkChange) {
                return;
            }
            
            // Get current network directly from window.ethereum to avoid provider issues
            let currentNetworkId = null;
            try {
                // Use eth_chainId directly to avoid "underlying network changed" errors
                const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
                currentNetworkId = parseInt(chainIdHex, 16);
            } catch (error) {
                console.warn('Could not get current network from window.ethereum:', error);
                // Fallback to provider if direct call fails
                try {
                    if (this.provider) {
                        const network = await this.provider.getNetwork();
                        currentNetworkId = network.chainId;
                    }
                } catch (providerError) {
                    console.warn('Could not get current network from provider:', providerError);
                }
            }
            
            // Set previous network for fallback
            this.previousNetworkId = currentNetworkId;
            
            // Check if user switched to wrong network - if so, we need to switch back
            const targetNetwork = parseInt(this.networkConfig?.network || '1');
            if (currentNetworkId && currentNetworkId !== targetNetwork) {
                console.log(`User switched to network ${currentNetworkId}, but we need ${targetNetwork}. Switching back...`);
            }
            
            // Transition to switching state
            this.networkChangeState = 'switching';
            this.pendingNetworkChange = {
                from: currentNetworkId,
                to: null,
                startTime: Date.now()
            };
            
            // Emit switching event
            eventBus.emit('network:switching', {
                from: currentNetworkId,
                to: null,
                automatic: true
            });
            
            // Set timeout for network switch
            this.networkChangeTimeout = setTimeout(() => {
                if (this.networkChangeState === 'switching') {
                    this.handleNetworkChangeTimeout();
                }
            }, this.networkChangeTimeoutDuration);
            
            // Initialize provider (this will handle the actual network switch)
            await this.initializeProvider();
            
            // Get new network after switch (using direct call to avoid provider issues)
            let newNetworkId = null;
            try {
                // Use eth_chainId directly to avoid "underlying network changed" errors
                const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
                newNetworkId = parseInt(chainIdHex, 16);
            } catch (error) {
                console.warn('Could not get new network from window.ethereum:', error);
                // Fallback to provider if direct call fails
                try {
                    if (this.provider) {
                        const network = await this.provider.getNetwork();
                        newNetworkId = network.chainId;
                    }
                } catch (providerError) {
                    console.warn('Could not get new network from provider:', providerError);
                }
            }
            
            // Calculate duration before clearing pendingNetworkChange
            const duration = this.pendingNetworkChange ? 
                Date.now() - this.pendingNetworkChange.startTime : 0;
            
            // Clear timeout
            if (this.networkChangeTimeout) {
                clearTimeout(this.networkChangeTimeout);
                this.networkChangeTimeout = null;
            }
            
            // Transition to switched state
            this.networkChangeState = 'switched';
            const pendingChange = this.pendingNetworkChange;
            this.pendingNetworkChange = null;
            
            // Emit switched event
            eventBus.emit('network:switched', {
                from: currentNetworkId,
                to: newNetworkId,
                success: true,
                duration: duration
            });
            
            // Emit legacy event for backward compatibility (mark as automatic)
            eventBus.emit('network:changed', { automatic: true });
            
            // Also emit contract updated event for UI components that need to update
            eventBus.emit('contract:updated');
            
            // Reset state after a short delay
            setTimeout(() => {
                if (this.networkChangeState === 'switched') {
                    this.networkChangeState = 'idle';
                }
            }, 1000);
            
        } catch (error) {
            // Clear timeout
            if (this.networkChangeTimeout) {
                clearTimeout(this.networkChangeTimeout);
                this.networkChangeTimeout = null;
            }
            
            // Transition to error state
            this.networkChangeState = 'error';
            
            // Emit error event
            eventBus.emit('network:switch:error', {
                from: this.previousNetworkId,
                to: null,
                error: error.message || 'Network switch failed',
                originalError: error
            });
            
            // Emit legacy error event for backward compatibility
            eventBus.emit('blockchain:error', error);
            
            // Reset state after error handling
            setTimeout(() => {
                if (this.networkChangeState === 'error') {
                    this.networkChangeState = 'idle';
                    this.pendingNetworkChange = null;
                }
            }, 2000);
        }
    }
    
    /**
     * Handle network change timeout
     * @private
     */
    handleNetworkChangeTimeout() {
        console.warn('Network change timed out after', this.networkChangeTimeoutDuration, 'ms');
        
        // Transition to error state
        this.networkChangeState = 'error';
        
        // Emit timeout event
        eventBus.emit('network:switch:timeout', {
            from: this.previousNetworkId,
            to: null,
            timeout: this.networkChangeTimeoutDuration
        });
        
        // Clear timeout
        if (this.networkChangeTimeout) {
            clearTimeout(this.networkChangeTimeout);
            this.networkChangeTimeout = null;
        }
        
        // Reset state after timeout handling
        setTimeout(() => {
            if (this.networkChangeState === 'error') {
                this.networkChangeState = 'idle';
                this.pendingNetworkChange = null;
            }
        }, 2000);
    }
    
    /**
     * Cancel pending network change
     * @returns {boolean} Whether cancellation was successful
     */
    cancelNetworkChange() {
        if (this.networkChangeState === 'switching') {
            // Clear timeout
            if (this.networkChangeTimeout) {
                clearTimeout(this.networkChangeTimeout);
                this.networkChangeTimeout = null;
            }
            
            // Reset state
            this.networkChangeState = 'idle';
            this.pendingNetworkChange = null;
            
            // Emit cancellation event
            eventBus.emit('network:switch:cancelled', {
                from: this.previousNetworkId
            });
            
            return true;
        }
        return false;
    }
    
    /**
     * Get current network change state
     * @returns {string} Current state ('idle' | 'switching' | 'switched' | 'error')
     */
    getNetworkChangeState() {
        return this.networkChangeState;
    }
    
    /**
     * Wait for network to be on the correct network before proceeding
     * @param {number} targetNetworkId - The target network ID
     * @param {number} timeout - Maximum time to wait in milliseconds (default: 5000)
     * @returns {Promise<void>}
     * @private
     */
    async waitForCorrectNetwork(targetNetworkId, timeout = 5000) {
        const startTime = Date.now();
        const pollInterval = 100; // Check every 100ms
        
        while (Date.now() - startTime < timeout) {
            try {
                // Get chainId directly from window.ethereum to avoid provider issues
                const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
                const chainId = parseInt(chainIdHex, 16);
                
                if (chainId === targetNetworkId) {
                    // Network is correct, wait a bit for it to stabilize
                    await new Promise(resolve => setTimeout(resolve, 200));
                    return;
                }
            } catch (error) {
                // Provider might not be ready yet, continue polling
                // Don't log to avoid spam
            }
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        // If we get here, network didn't match within timeout
        // This is OK - we'll handle it in the main initialization flow
        console.warn(`Network check timeout: Expected ${targetNetworkId}, will verify in initializeProvider`);
    }

    async handleAccountChange() {
        try {
            if (window.ethereum) {
                const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
                this.signer = web3Provider.getSigner();
                eventBus.emit('account:changed');
                
                // Also emit contract updated event
                eventBus.emit('contract:updated');
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

    async getCurrentTier() {
        try {
            // Check cache first
            const cached = contractCache.get('getCurrentTier', []);
            if (cached !== null) {
                return cached;
            }

            const tier = await this.executeContractCall('getCurrentTier');
            const result = parseInt(tier.toString());
            
            // Cache the result
            contractCache.set('getCurrentTier', [], result);
            
            return result;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get current tier');
        }
    }

    async getCurrentRoot() {
        try {
            const root = await this.executeContractCall('getCurrentRoot');
            return root.toString();
        } catch (error) {
            throw this.wrapError(error, 'Failed to get current root');
        }
    }

    async getLiquidityPool() {
        try {
            // Check cache first
            const cached = contractCache.get('getLiquidityPool', []);
            if (cached !== null) {
                return cached;
            }

            const liquidityPool = await this.executeContractCall('liquidityPair');
            const result = liquidityPool.toString();
            
            // Cache the result
            contractCache.set('getLiquidityPool', [], result);
            
            return result;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get liquidity pool address');
        }
    }

    async getTotalBondingSupply() {
        try {
            // Check cache first
            const cached = contractCache.get('getTotalBondingSupply', []);
            if (cached !== null) {
                return cached;
            }

            const supply = await this.executeContractCall('totalBondingSupply');
            // Convert from BigNumber to number and format
            const result = parseFloat(this.ethers.utils.formatUnits(supply, 0));
            
            // Cache the result
            contractCache.set('getTotalBondingSupply', [], result);
            
            return result;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get total bonding supply');
        }
    }

    async getTotalMessages() {
        try {
            // Check cache first
            const cached = contractCache.get('getTotalMessages', []);
            if (cached !== null) {
                return cached;
            }

            const messages = await this.executeContractCall('totalMessages');
            const result = parseFloat(this.ethers.utils.formatUnits(messages, 0));
            
            // Cache the result
            contractCache.set('getTotalMessages', [], result);
            
            return result;
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
        // Validate address before proceeding
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address provided to getTokenBalance');
        }

        // Check cache first
        const cached = contractCache.get('getTokenBalance', [address]);
        if (cached !== null) {
            return cached;
        }

        const result = await this.executeContractCall('balanceOf', [address]);
        
        // Cache the result
        contractCache.set('getTokenBalance', [address], result);
        
        return result;
    }

    /**
     * Gets NFT balance for an address using mirror contract
     * @param {string} address - The address to check
     * @returns {Promise<number>} Number of NFTs owned
     */
    async getNFTBalance(address) {
        try {
            // Validate address before proceeding
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address provided to getNFTBalance');
            }

            // Check cache first
            const cached = contractCache.get('getNFTBalance', [address]);
            if (cached !== null) {
                return cached;
            }

            const balance = await this.executeContractCall(
                'balanceOf',
                [address],
                { useContract: 'mirror' }
            );
            const result = parseInt(balance.toString());
            
            // Cache the result
            contractCache.set('getNFTBalance', [address], result);
            
            return result;
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
            // Validate address before proceeding
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address provided to getEthBalance');
            }

            // Check cache first
            const cached = contractCache.get('getEthBalance', [address]);
            if (cached !== null) {
                return cached;
            }

            const balance = await this.provider.getBalance(address);
            const result = balance.toString();
            
            // Cache the result
            contractCache.set('getEthBalance', [address], result);
            
            return result;
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
            // Check cache first
            const cached = contractCache.get('getCurrentPrice', []);
            if (cached !== null) {
                return cached;
            }

            const result = await this.getTokenPrice();
            
            // Cache the result
            contractCache.set('getCurrentPrice', [], result);
            
            return result;
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
            // Check cache first
            const cached = contractCache.get('getFreeSupply', []);
            if (cached !== null) {
                return cached;
            }

            const freeExec = await this.executeContractCall('freeSupply');
            const result = this.formatExec(freeExec);
            
            // Cache the result
            contractCache.set('getFreeSupply', [], result);
            
            return result;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get free supply');
        }
    }

    async getFreeMint(address) {
        try {
            // Validate address before proceeding
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address provided to getFreeMint');
            }

            // Check cache first
            const cached = contractCache.get('getFreeMint', [address]);
            if (cached !== null) {
                return cached;
            }

            const freeMint = await this.executeContractCall('freeMint', [address]);
            console.log('FREE MINT', freeMint);
            
            // Cache the result
            contractCache.set('getFreeMint', [address], freeMint);
            
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
            // Check cache first
            const cached = contractCache.get('getContractEthBalance', []);
            if (cached !== null) {
                return cached;
            }

            const balance = await this.provider.getBalance(this.contract.address);
            const formattedBalance = this.formatEther(balance);
            console.log('CONTRACT ETH BALANCE', formattedBalance);
            
            // Cache the result
            contractCache.set('getContractEthBalance', [], formattedBalance);
            
            return formattedBalance;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get contract ETH balance');
        }
    }

    async getUserNFTs(address) {
        try {
            // Validate address before proceeding
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address provided to getUserNFTs');
            }

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
            // Validate address before proceeding
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address provided to getUserNFTsWithMetadata');
            }

            // Get all NFT IDs for the user
            const nftIds = await this.getUserNFTs(address);
            
            // If no NFTs, return empty array
            if (!nftIds || nftIds.length === 0) {
                return [];
            }
            
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
     * Get skipNFT status for an address
     * @param {string} address - The address to check
     * @returns {Promise<boolean>} True if skipNFT is set, false otherwise
     */
    async getSkipNFT(address) {
        try {
            const skipNFT = await this.executeContractCall('getSkipNFT', [address]);
            return skipNFT;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get skipNFT status');
        }
    }

    /**
     * Set skipNFT status for the connected wallet
     * @param {boolean} skipNFT - True to skip NFT minting, false to enable it
     * @returns {Promise<Object>} Transaction receipt
     */
    async setSkipNFT(skipNFT) {
        try {
            if (!this.signer) {
                throw new Error('No wallet connected');
            }

            // Emit pending event
            eventBus.emit('transaction:pending', { type: 'setSkipNFT', skipNFT });
            
            // Call setSkipNFT on the contract
            const receipt = await this.executeContractCall(
                'setSkipNFT',
                [skipNFT],
                { requiresSigner: true }
            );

            // Emit success event
            eventBus.emit('transaction:success', {
                type: 'setSkipNFT',
                receipt,
                skipNFT: skipNFT
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setSkipNFT',
                error: this.wrapError(error, 'Failed to set skipNFT')
            });
            throw error;
        }
    }

    /**
     * Transfer EXEC tokens to self (for re-rolling NFTs)
     * @param {string} amount - Amount of tokens to transfer (in wei/raw format)
     * @returns {Promise<Object>} Transaction receipt
     */
    async transferTokensToSelf(amount) {
        try {
            if (!this.signer) {
                throw new Error('No wallet connected');
            }

            const address = await this.signer.getAddress();
            
            // Emit pending event
            eventBus.emit('transaction:pending', { type: 'reroll' });
            
            // Transfer tokens to self
            const receipt = await this.executeContractCall(
                'transfer',
                [address, amount],
                { requiresSigner: true }
            );

            // Emit success event
            eventBus.emit('transaction:success', {
                type: 'reroll',
                receipt,
                amount: amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'reroll',
                error: this.wrapError(error, 'Failed to re-roll NFTs')
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

    /**
     * Fetches the reserves of token0 and token1 from the Uniswap V2 pair contract
     * and calculates the price of token0 in terms of token1.
     * @returns {Promise<number>} The price of token0 in terms of token1.
     */
    async getToken0PriceInToken1(pairAddress) {
        try {
            const pairContract = new this.ethers.Contract(
                pairAddress,
                [
                    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
                ],
                this.provider,
                { useContract: 'v2pool' }
            );

            const [reserve0, reserve1] = await pairContract.getReserves();
            const price = reserve1 / reserve0;

            return price;
        } catch (error) {
            throw this.wrapError(error, 'Failed to get token0 price in terms of token1');
        }
    }

    /**
     * Checks if a given token address is token0 in the Uniswap V2 pair.
     * @param {string} pairAddress - The address of the Uniswap V2 pair contract.
     * @param {string} tokenAddress - The known contract address of the token to check.
     * @returns {Promise<boolean>} True if the token is token0, false otherwise.
     */
    async isToken0(pairAddress, tokenAddress) {
        try {
            const pairContract = new this.ethers.Contract(
                pairAddress,
                [
                    "function token0() external view returns (address)",
                    "function token1() external view returns (address)"
                ],
                this.provider,
                { useContract: 'v2pool' }
            );

            const token0Address = await pairContract.token0();
            return token0Address.toLowerCase() === tokenAddress.toLowerCase();
        } catch (error) {
            throw this.wrapError(error, 'Failed to check if token is token0');
        }
    }

    async getApproval(address, target = null) {
        try {
            if (!address) {
                throw new Error("User address is required for approval check");
            }
            
            let targetAddress;
            
            if (target === null) {
                targetAddress = this.swapRouter.address || this.swapRouter;
            } else if (typeof target === 'string') {
                targetAddress = target;
            } else if (target && typeof target === 'object' && target.address) {
                // If target is a contract object, use its address
                targetAddress = target.address;
            } else {
                throw new Error("Invalid target for approval check");
            }
            
            console.log(`Checking allowance for ${address} to spend tokens at ${targetAddress}`);
            
            const response = await this.executeContractCall('allowance', [address, targetAddress]);
            // Convert BigNumber response to string
            return response.toString();
        } catch (error) {
            throw this.wrapError(error, 'Failed to get approval');
        }
    }

    async setApproval(target = null, amount) {
        try {
            let targetAddress;
            
            if (target === null) {
                targetAddress = this.swapRouter.address;
            } else if (typeof target === 'string') {
                targetAddress = target;
            } else if (target && typeof target === 'object' && target.address) {
                // If target is a contract object, use its address
                targetAddress = target.address;
            } else {
                throw new Error("Invalid target for approval");
            }
            
            console.log(`Setting approval for ${targetAddress} to spend ${amount} tokens`);
            
            // Create a unique transaction ID for tracking
            const txId = `tx_approve_${++this.transactionCounter}_${Date.now()}`;
            
            // Emit pending event with ID for UI feedback
            const pendingEvent = { 
                type: 'approve', 
                id: txId,
                pending: true
            };
            
            // Store active transaction
            this.activeTransactions.set(txId, pendingEvent);
            
            // Emit event
            console.log(`[BlockchainService] Emitting transaction:pending for approve ${txId}`);
            eventBus.emit('transaction:pending', pendingEvent);
            
            // Execute the approve call
            const response = await this.executeContractCall('approve', [targetAddress, amount], { requiresSigner: true });
            
            // Emit success event with same ID
            const successEvent = {
                type: 'approve',
                id: txId,
                receipt: response,
                amount: amount
            };
            
            // Update transaction status
            this.activeTransactions.set(txId, successEvent);
            
            console.log(`[BlockchainService] Emitting transaction:success for ${txId}`);
            eventBus.emit('transaction:success', successEvent);
            
            return response;
        } catch (error) {
            const errorEvent = {
                type: 'approve',
                id: `error_approve_${++this.transactionCounter}_${Date.now()}`,
                error: this.wrapError(error, 'Failed to set approval')
            };
            
            console.log(`[BlockchainService] Emitting transaction:error for approval error`);
            eventBus.emit('transaction:error', errorEvent);
            
            throw error;
        }
    }
    //now used within swapExactTokenForEthSupportingFeeOnTransferV2
    // async getAmountsOut(amountIn, path) {
    //     try {
    //         const amounts = await this.executeContractCall(
    //             'getAmountsOut',
    //             [amountIn, path],
    //             { useContract: 'router' }
    //         );
    //         return amounts;
    //     } catch (error) {
    //         throw this.wrapError(error, 'Failed to get amounts out');
    //     }
    // }

    async swapExactTokenForEthSupportingFeeOnTransferV2(address, params) {
        try {
            // Create a unique transaction ID for tracking
            const txId = `tx_${++this.transactionCounter}_${Date.now()}`;
            
            // Emit pending event with ID
            const pendingEvent = { 
                type: 'swap', 
                id: txId,
                pending: true
            };
            
            // Store active transaction
            this.activeTransactions.set(txId, pendingEvent);
            
            // Emit event
            console.log(`[BlockchainService] Emitting transaction:pending for ${txId}`);
            eventBus.emit('transaction:pending', pendingEvent);

            const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
            const TOKEN = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            const path = [TOKEN, WETH];
            
            // Get the connected address for the 'to' parameter
            const to = address;
            
            // Set deadline to 20 minutes from now
            const deadline = Math.floor(Date.now() / 1000) + 1200;

            // Calculate minimum amount out accounting for 4% tax + 2% slippage
            const amounts = await this.executeContractCall(
                'getAmountsOut',
                [params.amount, path],
                { useContract: 'router' }
            );
            const expectedAmountOut = amounts[1];

            // Apply 6% buffer for tax + slippage
            const amountOutMin = BigInt(expectedAmountOut) * BigInt(940) / BigInt(1000);
            
            console.log('Sell transaction parameters:', {
                amountIn: params.amount.toString(),
                amountOutMin: amountOutMin.toString(),
                path,
                txId
            });

            const receipt = await this.executeContractCall(
                'swapExactTokensForETHSupportingFeeOnTransferTokens',
                [
                    params.amount,  // amountIn
                    amountOutMin,   // amountOutMin with tax + slippage buffer
                    path,
                    to,
                    deadline
                ],
                { useContract: 'router', requiresSigner: true }
            );

            // Emit success event with same ID
            const successEvent = {
                type: 'swap',
                id: txId,
                receipt,
                amount: params.amount
            };
            
            // Update transaction status
            this.activeTransactions.set(txId, successEvent);
            
            console.log(`[BlockchainService] Emitting transaction:success for ${txId}`);
            eventBus.emit('transaction:success', successEvent);
            
            // Remove from active transactions after a delay
            setTimeout(() => {
                this.activeTransactions.delete(txId);
            }, 1000);

            return receipt;
        } catch (error) {
            const errorEvent = {
                type: 'swap',
                id: `error_${++this.transactionCounter}_${Date.now()}`,
                error: this.wrapError(error, 'Failed to swap tokens for ETH')
            };
            
            console.log(`[BlockchainService] Emitting transaction:error for error transaction`);
            eventBus.emit('transaction:error', errorEvent);
            throw error;
        }
    }

    async swapExactEthForTokenSupportingFeeOnTransfer(address, params, ethValue) {
        try {
            // Create a unique transaction ID for tracking
            const txId = `tx_${++this.transactionCounter}_${Date.now()}`;
            
            // Emit pending event with ID
            const pendingEvent = { 
                type: 'swap', 
                id: txId,
                pending: true
            };
            
            // Store active transaction
            this.activeTransactions.set(txId, pendingEvent);
            
            // Emit event
            console.log(`[BlockchainService] Emitting transaction:pending for ${txId}`);
            eventBus.emit('transaction:pending', pendingEvent);

            const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
            const TOKEN = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            const path = [WETH, TOKEN];
            
            // Get the connected address for the 'to' parameter
            const to = address;
            
            // Set deadline to 20 minutes from now
            const deadline = Math.floor(Date.now() / 1000) + 1200;

            // For 4% tax tokens, we need a much lower amountOutMin
            // Calculate minimum expected output with 6% buffer (4% tax + 2% slippage)
            const amountOutMin = BigInt(params.amount) * BigInt(940) / BigInt(1000);
            
            console.log('Buy transaction parameters:', {
                amountOutMin: amountOutMin.toString(),
                ethValue: ethValue.toString(),
                path,
                txId
            });

            const receipt = await this.executeContractCall(
                'swapExactETHForTokensSupportingFeeOnTransferTokens',
                [
                    amountOutMin,  // amountOutMin with 6% buffer for tax + slippage
                    path,
                    to,
                    deadline
                ],
                { useContract: 'router', requiresSigner: true, txOptions: { value: ethValue } }
            );

            // Emit success event with same ID
            const successEvent = {
                type: 'swap',
                id: txId,
                receipt,
                amount: params.amount
            };
            
            // Update transaction status
            this.activeTransactions.set(txId, successEvent);
            
            console.log(`[BlockchainService] Emitting transaction:success for ${txId}`);
            eventBus.emit('transaction:success', successEvent);
            
            // Remove from active transactions after a delay
            setTimeout(() => {
                this.activeTransactions.delete(txId);
            }, 1000);

            return receipt;
        } catch (error) {
            const errorEvent = {
                type: 'swap',
                id: `error_${++this.transactionCounter}_${Date.now()}`,
                error: this.wrapError(error, 'Failed to swap ETH for tokens')
            };
            
            console.log(`[BlockchainService] Emitting transaction:error for error transaction`);
            eventBus.emit('transaction:error', errorEvent);
            throw error;
        }
    }
    
    /**
     * Get the current block information
     * @returns {Promise<Object>} Block information
     */
    async getCurrentBlockInfo() {
        try {
            const blockNumber = await this.provider.getBlockNumber();
            const block = await this.provider.getBlock(blockNumber);
            
            return {
                number: blockNumber,
                timestamp: block.timestamp,
                hash: block.hash,
                date: new Date(block.timestamp * 1000) // Convert seconds to milliseconds
            };
        } catch (error) {
            throw this.wrapError(error, 'Failed to get current block info');
        }
    }
}

export default BlockchainService; 
