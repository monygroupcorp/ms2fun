import { ethers } from './node_modules/ethers/dist/ethers.esm.js';
import MessagePopup from './src/components/MessagePopup/MessagePopup.js';
import MerkleHandler from './src/merkleHandler.js';
import BlockchainService from './src/services/BlockchainService.js';

console.log('ContractHandler: Ethers imported:', ethers);

class ContractHandler {
    constructor(provider, contractAddress) {
        console.log('ContractHandler: Initializing with provider:', provider);
        this.web3Provider = provider; // Injected provider (Rainbow, MetaMask etc)
        this.contractAddress = contractAddress;
        this.messagePopup = new MessagePopup();
        this.merkleHandler = new MerkleHandler();
        this.blockchainService = new BlockchainService();
        this.initialize(provider);
    }

    // Helper method to get contract instance
    get contract() {
        return this.blockchainService.contract;
    }

    // Helper method to get mirror contract instance
    get mirrorContract() {
        return this.blockchainService.mirrorContract;
    }

    // Helper method to get provider
    get provider() {
        return this.blockchainService.provider;
    }

    // Helper method to get signer
    get signer() {
        return this.blockchainService.signer;
    }

    async initialize(provider) {
        try {
            await this.blockchainService.initialize();
            await this.initializeMerkleHandler();
        } catch (error) {
            console.error('ContractHandler: Error initializing:', error);
            this.messagePopup.error(error.message);
            throw error;
        }
    }

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
                console.log('Phase 0 detected, initializing Merkle trees');
                await this.merkleHandler.initializeTrees();
                console.log('Merkle handler initialized for phase 0');
            } else {
                // We're in phase 1 or beyond, check if we're in phase 1
                // For now, assume we're in phase 1 if switch.json exists and phase 2 otherwise
                // This is a simplification and might need to be adjusted based on actual logic
                
                // For demonstration, we'll check if a specific property exists in switch.json
                // that would indicate we're in phase 1
                const switchData = await (await fetch('/EXEC404/switch.json')).json();
                const isPhase1 = switchData.phase === 1 || switchData.requireMerkle === true;
                
                if (isPhase1) {
                    console.log('Phase 1 detected, initializing Merkle trees');
                    await this.merkleHandler.initializeTrees();
                    console.log('Merkle handler initialized for phase 1');
                } else {
                    console.log('Phase 2 or beyond detected, skipping Merkle tree initialization');
                    // Initialize an empty map to avoid potential errors when trying to access trees
                    this.merkleHandler.trees = new Map();
                }
            }
        } catch (error) {
            console.error('Error initializing merkle handler:', error);
        }
    }

    /**
     * Gets the current block number to test RPC connection
     * @returns {Promise<number>} The current block number
     */
    async getBlock() {
        try {
            if (!this.provider) {
                throw new Error('Provider not initialized');
            }
            const blockNumber = await this.provider.getBlockNumber();
            return blockNumber;
        } catch (error) {
            console.error('Error getting block number:', error);
            throw error;
        }
    }

    /**
     * Gets the price for a given supply amount
     * @param {string|number} supply - The supply amount to calculate price for
     * @returns {Promise<Object>} Object containing both wei and ETH values
     */
    async getPrice(supply) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const price = await this.contract.getPrice(supply);
            const priceInWei = price.toString();
            const priceInEth = ethers.utils.formatEther(price);
            
            console.log('ContractHandler: Price for supply:', supply, 'is:', {
                wei: priceInWei,
                eth: priceInEth
            });
            
            // Return the raw wei string for contract interactions
            return priceInWei;
        } catch (error) {
            console.error('Error getting price:', error);
            throw error;
        }
    }

    /**
     * Gets the cost for a given amount of EXEC
     * @param {string|number} amount - The amount of EXEC to calculate cost for
     * @returns {Promise<Object>} Object containing both wei and ETH values
     */
    async calculateCost(amount) {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const cost = await this.contract.calculateCost(amount);
            const costInWei = cost.toString();
            const costInEth = ethers.utils.formatEther(cost);
        
            console.log('ContractHandler: cost for supply:', amount, 'is:', {
                wei: costInWei,
                eth: costInEth
            });

            // Return the raw wei string for contract interactions
            return costInWei;
        } catch (error) {
            console.error('Error getting cost:', error);
            throw error;
        }
    }

    /**
     * Gets the current total supply
     * @returns {Promise<string>} The current total supply in wei
     */
    async getTotalSupply() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            console.log('ContractHandler: Calling totalSupply on address:', this.contractAddress);
            const supply = await this.contract.totalSupply();
            console.log('ContractHandler: Total supply result:', supply.toString());
            return supply.toString();
        } catch (error) {
            console.error('Error getting total supply:', error);
            throw error;
        }
    }

    /**
     * Gets the current price based on current total supply
     * @returns {Promise<Object>} Object containing price in wei
     */
    async getCurrentPrice() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const price = await this.blockchainService.executeContractCall('getPrice', [1000000]);
            const priceInWei = price.toString();
            const priceInEth = ethers.utils.formatEther(price);
            
            console.log('ContractHandler: Current price:', {
                wei: priceInWei,
                eth: priceInEth
            });
            
            return { wei: priceInWei, eth: priceInEth };
        } catch (error) {
            console.error('Error getting current price:', error);
            throw error;
        }
    }

    /**
     * Gets the token balance for a given address
     * @param {string} address - The address to check balance for
     * @returns {Promise<string>} The balance in wei
     */
    async getTokenBalance(address) {
        return this.blockchainService.getTokenBalance(address);
    }

    /**
     * Gets the NFT balance for a given address using the mirror contract
     * @param {string} address - The address to check NFT balance for
     * @returns {Promise<number>} The number of NFTs owned
     */
    async getNFTBalance(address) {
        return this.blockchainService.getNFTBalance(address);
    }

    /**
     * Gets the mirror contract address from the main contract
     * @returns {Promise<string>} The mirror contract address
     */
    async getMirrorAddress() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const mirrorAddress = await this.contract.mirrorERC721();
            console.log('ContractHandler: Mirror address:', mirrorAddress);
            return mirrorAddress;
        } catch (error) {
            console.error('Error getting mirror address:', error);
            throw error;
        }
    }

    async buyBonding(params, ethValue) {
        return this.blockchainService.buyBonding(params, ethValue);
    }

    async getMerkleProof(address) {
        try {
            // Check if we need Merkle trees for the current phase
            const needMerkleTrees = await this.merkleHandler.shouldLoadMerkleTrees();
            if (!needMerkleTrees) {
                console.log('Merkle trees not needed for current phase, skipping proof generation');
                return [];
            }
            
            // Find which tier the address belongs to
            const tier = this.merkleHandler.findAddressTier(address);
            
            if (!tier) {
                console.log('Address not found in any tier');
                return [];
            }

            // Get proof for the address in its tier
            const proofData = this.merkleHandler.getProof(tier, address);
            
            if (!proofData || !proofData.valid) {
                console.log('Invalid or missing proof');
                return [];
            }

            console.log(`Got merkle proof for address ${address} in tier ${tier}`, proofData);
            return proofData.proof;

        } catch (error) {
            console.error('Error getting merkle proof:', error);
            return [];
        }
    }

    connectSigner(signer) {
        // Connect the contract to a signer for sending transactions
        this.contract = this.contract.connect(signer);
        this.mirrorContract = this.mirrorContract.connect(signer);
    }

    async sellBonding(params) {
        return this.blockchainService.sellBonding(params);
    }

    handleTransactionError(error) {
        if (error.code === 'INSUFFICIENT_FUNDS') {
            this.messagePopup.error(
                'You do not have enough funds to complete this transaction.',
                'Insufficient Funds'
            );
        } else if (error.code === 'USER_REJECTED') {
            this.messagePopup.warning(
                'Transaction was rejected in your wallet',
                'Transaction Cancelled'
            );
        } else {
            this.messagePopup.error(
                'There was an error processing your transaction. Please try again.',
                'Transaction Failed'
            );
        }
    }

    async loadBalances() {
        try {
            const [tokenBalance, nftBalance, ethBalance] = await Promise.all([
                this.blockchainService.getTokenBalance(this.contractAddress),
                this.blockchainService.getNFTBalance(this.contractAddress),
                this.blockchainService.getEthBalance(this.contractAddress)
            ]);
            
            tradingStore.setState({
                userBalance: {
                    eth: parseFloat(ethers.utils.formatEther(ethBalance)),
                    exec: parseInt(tokenBalance),
                    nfts: nftBalance
                }
            });
        } catch (error) {
            console.error('Error loading balances:', error);
            this.messagePopup.error('Failed to load balances');
        }
    }
}

export default ContractHandler; 