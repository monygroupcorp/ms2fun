/**
 * ERC404 Adapter
 * 
 * Wraps ERC404 contract functionality for use with ProjectService.
 * Works with any ERC404 contract, not just CULT EXEC.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

class ERC404Adapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC404', ethersProvider, signer);
        this.mirrorContract = null;
        this.operatorNFTContract = null; // For cultexecs operator NFT
        this.ethers = ethers;
    }

    /**
     * Initialize the adapter - load contract ABI and create contract instances
     */
    async initialize() {
        try {
            // Check if we have a mock provider (no real wallet connection)
            const isMockProvider = this.provider && this.provider.isMock === true;
            
            if (isMockProvider) {
                // For mock providers, mark as initialized but don't create real contracts
                // The adapter will work in mock mode
                this.initialized = true;
                this.isMock = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }
            
            // Validate we have a real provider or signer
            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }
            
            // Load contract ABI
            const abiResponse = await fetch('/EXEC404/abi.json');
            if (!abiResponse.ok) {
                throw new Error('Failed to load contract ABI');
            }
            const contractABI = await abiResponse.json();

            // Initialize main contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                contractABI,
                this.signer || this.provider
            );

            // Initialize mirror contract if available
            try {
                const mirrorAddress = await this.contract.mirrorERC721();
                
                const mirrorAbiResponse = await fetch('/EXEC404/mirrorabi.json');
                if (mirrorAbiResponse.ok) {
                    const mirrorABI = await mirrorAbiResponse.json();
                    this.mirrorContract = new ethers.Contract(
                        mirrorAddress,
                        mirrorABI,
                        this.signer || this.provider
                    );
                }
            } catch (error) {
                console.warn('[ERC404Adapter] Mirror contract not available:', error);
            }

            // Initialize operator NFT contract for cultexecs
            const cultexecsAddress = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            const isCultExecs = this.contractAddress && 
                               (this.contractAddress.toLowerCase() === cultexecsAddress.toLowerCase());
            
            if (isCultExecs) {
                try {
                    const operatorNFTAddress = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0';
                    // Standard ERC721 ABI for ownerOf function
                    const erc721ABI = [
                        {
                            "constant": true,
                            "inputs": [{"name": "_tokenId", "type": "uint256"}],
                            "name": "ownerOf",
                            "outputs": [{"name": "", "type": "address"}],
                            "type": "function"
                        }
                    ];
                    
                    // For view functions like ownerOf, we only need a provider, not a signer
                    // Use provider directly, or get it from walletService if available
                    let provider = this.provider;
                    if (!provider && typeof window !== 'undefined' && window.ethereum) {
                        // Fallback: create provider from window.ethereum
                        provider = new ethers.providers.Web3Provider(window.ethereum);
                    }
                    
                    if (provider) {
                        this.operatorNFTContract = new ethers.Contract(
                            operatorNFTAddress,
                            erc721ABI,
                            provider
                        );
                        console.log('[ERC404Adapter] Initialized operator NFT contract for cultexecs');
                    } else {
                        console.warn('[ERC404Adapter] No provider available for operator NFT contract');
                    }
                } catch (error) {
                    console.warn('[ERC404Adapter] Could not initialize operator NFT contract:', error);
                }
            }

            // Initialize merkle handler if needed
            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, 'ERC404Adapter initialization failed');
        }
    }


    /**
     * Get user token balance
     * @param {string} address - User address
     * @returns {Promise<string>} Balance in wei
     */
    async getBalance(address) {
        return await this.getTokenBalance(address);
    }

    /**
     * Get token balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<string>} Balance in wei
     */
    async getTokenBalance(address) {
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address provided to getTokenBalance');
        }

        // Handle mock mode
        if (this.isMock) {
            return '0';
        }

        return await this.getCachedOrFetch(
            'getTokenBalance',
            [address],
            async () => {
                const result = await this.executeContractCall('balanceOf', [address]);
                return result.toString();
            }
        );
    }

    /**
     * Get NFT balance for an address using mirror contract
     * @param {string} address - The address to check
     * @returns {Promise<number>} Number of NFTs owned
     */
    async getNFTBalance(address) {
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address provided to getNFTBalance');
        }

        // Handle mock mode
        if (this.isMock || !this.mirrorContract) {
            return 0;
        }

        return await this.getCachedOrFetch(
            'getNFTBalance',
            [address],
            async () => {
                const balance = await this.mirrorContract.balanceOf(address);
                return parseInt(balance.toString());
            }
        );
    }

    /**
     * Get ETH balance for an address
     * @param {string} address - The address to check
     * @returns {Promise<string>} Balance in wei
     */
    async getEthBalance(address) {
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address provided to getEthBalance');
        }

        // Handle mock mode
        if (this.isMock || !this.provider || this.provider.isMock) {
            return '0';
        }

        return await this.getCachedOrFetch(
            'getEthBalance',
            [address],
            async () => {
                const balance = await this.provider.getBalance(address);
                return balance.toString();
            }
        );
    }

    /**
     * Get current price
     * @returns {Promise<number>} Current price in ETH
     */
    async getPrice() {
        return await this.getCurrentPrice();
    }

    /**
     * Get current price (1M tokens)
     * @returns {Promise<number>} Current price in ETH
     */
    async getCurrentPrice() {
        // Handle mock mode
        if (this.isMock) {
            // Return a mock price (0.1 ETH for 1M tokens)
            return 0.1;
        }

        return await this.getCachedOrFetch(
            'getCurrentPrice',
            [],
            async () => {
                // Format amount with 18 decimals (like ETH)
                const amount = ethers.utils.parseEther('1000000');
                
                // Get price using calculateCost
                const price = await this.executeContractCall('calculateCost', [amount]);
                
                if (!price || !ethers.BigNumber.isBigNumber(price)) {
                    throw new Error('Invalid price format from contract');
                }

                // Convert BigNumber to number and format
                const priceInEth = parseFloat(ethers.utils.formatEther(price));
                return priceInEth;
            }
        );
    }

    /**
     * Get total supply
     * @returns {Promise<number>} Total supply
     */
    async getTotalSupply() {
        return await this.getCachedOrFetch(
            'getTotalSupply',
            [],
            async () => {
                const supply = await this.executeContractCall('totalBondingSupply');
                return parseFloat(ethers.utils.formatUnits(supply, 0));
            }
        );
    }

    /**
     * Get free supply
     * @returns {Promise<number>} Free supply
     */
    async getFreeSupply() {
        return await this.getCachedOrFetch(
            'getFreeSupply',
            [],
            async () => {
                const freeExec = await this.executeContractCall('freeSupply');
                return parseFloat(ethers.utils.formatUnits(freeExec, 18));
            }
        );
    }

    /**
     * Get current tier
     * @returns {Promise<number>} Current tier
     */
    async getCurrentTier() {
        return await this.getCachedOrFetch(
            'getCurrentTier',
            [],
            async () => {
                const tier = await this.executeContractCall('getCurrentTier');
                return parseInt(tier.toString());
            }
        );
    }

    /**
     * Get merkle proof for an address
     * @param {string} address - User address
     * @param {number|null} tier - Tier number (null to use current tier)
     * @returns {Promise<Array|null>} Always returns null - merkle proofs no longer supported
     */
    async getMerkleProof(address, tier = null) {
        // Merkle proof functionality removed - whitelisting no longer uses Merkle trees
        // Users can use alternative whitelisting methods (e.g., passwords)
        return null;
    }

    /**
     * Buy bonding curve tokens
     * @param {string} amount - Amount of tokens to buy
     * @param {string} maxCost - Maximum ETH cost in wei
     * @param {Array|null} proof - Merkle proof (optional)
     * @param {string} message - Transaction message (optional)
     * @returns {Promise<Object>} Transaction receipt
     */
    async buyBonding(amount, maxCost, proof = null, message = '') {
        try {
            eventBus.emit('transaction:pending', { type: 'buy', contractAddress: this.contractAddress });
            
            const receipt = await this.executeContractCall(
                'buyBonding',
                [amount, maxCost, false, proof || [], message],
                { 
                    requiresSigner: true,
                    txOptions: { value: maxCost }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'buy',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance', 'price', 'supply');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'buy',
                error: this.wrapError(error, 'Buy bonding failed'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Sell bonding curve tokens
     * @param {string} amount - Amount of tokens to sell
     * @param {string} minReturn - Minimum ETH return in wei
     * @param {Array|null} proof - Merkle proof (optional)
     * @param {string} message - Transaction message (optional)
     * @returns {Promise<Object>} Transaction receipt
     */
    async sellBonding(amount, minReturn, proof = null, message = '') {
        try {
            eventBus.emit('transaction:pending', { type: 'sell', contractAddress: this.contractAddress });

            const receipt = await this.executeContractCall(
                'sellBonding',
                [amount, minReturn, proof || [], message],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'sell',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance', 'price', 'supply');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'sell',
                error: this.wrapError(error, 'Sell bonding failed'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Mint NFT from balance
     * @param {number} amount - Amount of NFTs to mint
     * @returns {Promise<Object>} Transaction receipt
     */
    async mintNFT(amount = 1) {
        try {
            eventBus.emit('transaction:pending', { type: 'mint', contractAddress: this.contractAddress });
            
            const receipt = await this.executeContractCall(
                'balanceMint',
                [amount],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'mint',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'mint',
                error: this.wrapError(error, 'Failed to mint NFTs'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Check if contract is in phase 2
     * @returns {Promise<boolean>} True if in phase 2
     */
    async isPhase2() {
        try {
            const liquidityPool = await this.getLiquidityPool();
            return liquidityPool !== '0x0000000000000000000000000000000000000000';
        } catch (error) {
            return false;
        }
    }

    /**
     * Get phase number
     * @returns {Promise<number>} Phase number (0, 1, or 2)
     */
    async getPhase() {
        try {
            const liquidityPool = await this.getLiquidityPool();
            if (liquidityPool !== '0x0000000000000000000000000000000000000000') {
                return 2;
            }
            
            // Check if switch.json exists (phase 1)
            try {
                const switchResponse = await fetch('/EXEC404/switch.json');
                if (switchResponse.ok) {
                    return 1;
                }
            } catch (error) {
                // Ignore
            }
            
            return 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get liquidity pool address
     * @returns {Promise<string>} Liquidity pool address
     */
    async getLiquidityPool() {
        return await this.getCachedOrFetch(
            'getLiquidityPool',
            [],
            async () => {
                const liquidityPool = await this.executeContractCall('liquidityPair');
                return liquidityPool.toString();
            }
        );
    }

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            hasMirrorContract: this.mirrorContract !== null,
            phase: await this.getPhase()
        };
    }

    /**
     * Calculate cost for buying tokens
     * @param {string} execAmount - Amount of tokens in wei
     * @returns {Promise<string>} Cost in wei
     */
    async calculateCost(execAmount) {
        const response = await this.executeContractCall('calculateCost', [execAmount]);
        return response.toString();
    }

    /**
     * Get EXEC amount for ETH amount
     * @param {string} ethAmount - ETH amount in ether
     * @returns {Promise<string>} EXEC amount
     */
    async getExecForEth(ethAmount) {
        const weiAmount = ethers.utils.parseEther(ethAmount.toString());
        const execAmount = await this.executeContractCall('getExecForEth', [weiAmount]);
        return ethers.utils.formatUnits(execAmount, 18);
    }

    /**
     * Get ETH amount for EXEC amount
     * @param {string} execAmount - EXEC amount
     * @returns {Promise<string>} ETH amount in ether
     */
    async getEthForExec(execAmount) {
        const execWei = ethers.utils.parseUnits(execAmount.toString(), 18);
        const ethAmount = await this.executeContractCall('getEthForExec', [execWei]);
        return ethers.utils.formatEther(ethAmount);
    }

    /**
     * Get free mint status for address
     * @param {string} address - User address
     * @returns {Promise<boolean>} True if eligible for free mint
     */
    async getFreeMint(address) {
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address provided to getFreeMint');
        }

        return await this.getCachedOrFetch(
            'getFreeMint',
            [address],
            async () => {
                return await this.executeContractCall('freeMint', [address]);
            }
        );
    }

    /**
     * Get free situation (free mint + free supply)
     * @param {string} address - User address
     * @returns {Promise<Object>} Free situation object
     */
    async getFreeSituation(address) {
        const [freeMint, freeSupply] = await Promise.all([
            this.getFreeMint(address),
            this.getFreeSupply()
        ]);
        
        return {
            freeMint,
            freeSupply
        };
    }

    /**
     * Get user NFT IDs
     * @param {string} address - User address
     * @returns {Promise<Array>} Array of NFT token IDs
     */
    async getUserNFTIds(address) {
        if (!this.mirrorContract) {
            return [];
        }

        try {
            const nftIds = await this.mirrorContract.getOwnerTokens(address);
            return nftIds.map(id => id.toString());
        } catch (error) {
            console.error('Error getting user NFT IDs:', error);
            return [];
        }
    }

    /**
     * Get token URI for NFT
     * @param {number} tokenId - NFT token ID
     * @returns {Promise<string>} Token URI
     */
    async getTokenUri(tokenId) {
        if (!this.mirrorContract) {
            throw new Error('Mirror contract not available');
        }

        return await this.mirrorContract.tokenURI(tokenId);
    }

    /**
     * Send message (if contract supports chat)
     * @param {string} message - Message to send
     * @returns {Promise<Object>} Transaction receipt
     */
    async sendMessage(message) {
        // Check if contract supports sendMessage
        if (!this.contract || typeof this.contract.sendMessage !== 'function') {
            throw new Error('Contract does not support messaging');
        }

        try {
            eventBus.emit('transaction:pending', { type: 'message', contractAddress: this.contractAddress });
            
            const receipt = await this.executeContractCall(
                'sendMessage',
                [message],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'message',
                receipt,
                contractAddress: this.contractAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'message',
                error: this.wrapError(error, 'Failed to send message'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Get messages (if contract supports chat)
     * @param {number} limit - Maximum number of messages to retrieve
     * @returns {Promise<Array>} Array of messages
     */
    async getMessages(limit = 10) {
        // Check if contract supports getMessagesBatch
        if (!this.contract || typeof this.contract.getMessagesBatch !== 'function') {
            return [];
        }

        try {
            const totalMessages = await this.executeContractCall('totalMessages');
            const total = parseInt(totalMessages.toString());
            
            if (total === 0) {
                return [];
            }

            const startIndex = Math.max(0, total - limit);
            const endIndex = total;
            
            const messages = await this.executeContractCall('getMessagesBatch', [startIndex, endIndex]);
            return messages.map(msg => msg.toString());
        } catch (error) {
            console.error('Error getting messages:', error);
            return [];
        }
    }

    /**
     * Override checkOwnership to handle NFT ownership (for cultexecs edge case)
     * @param {string} userAddress - User address to check
     * @returns {Promise<boolean>} True if user is owner
     */
    async checkOwnership(userAddress) {
        if (!userAddress) {
            return false;
        }

        try {
            // First try standard owner() check
            const isStandardOwner = await super.checkOwnership(userAddress);
            if (isStandardOwner) {
                return true;
            }

            // Special handling for cultexecs - ownership is determined by OPERATOR_NFT token 598
            const cultexecsAddress = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2';
            const isCultExecs = this.contractAddress && 
                               (this.contractAddress.toLowerCase() === cultexecsAddress.toLowerCase());

            if (isCultExecs) {
                // For cultexecs, check if user owns token ID 598 from OPERATOR_NFT contract
                // This is the actual ownership check used in the contract: 
                // require(_erc721OwnerOf(OPERATOR_NFT, 598) == msg.sender, "Not oper");
                try {
                    const operatorNFTAddress = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0';
                    const operatorTokenId = 598;
                    
                    // Get provider - use existing one or create from window.ethereum
                    let provider = this.provider;
                    if (!provider && typeof window !== 'undefined' && window.ethereum) {
                        provider = new ethers.providers.Web3Provider(window.ethereum);
                    }
                    
                    if (!provider) {
                        console.warn('[ERC404Adapter] No provider available for operator NFT check');
                        return false;
                    }
                    
                    // Create contract instance with provider (not signer, since ownerOf is a view function)
                    const erc721ABI = [
                        {
                            "constant": true,
                            "inputs": [{"name": "_tokenId", "type": "uint256"}],
                            "name": "ownerOf",
                            "outputs": [{"name": "", "type": "address"}],
                            "type": "function"
                        }
                    ];
                    
                    const operatorNFTContract = new ethers.Contract(
                        operatorNFTAddress,
                        erc721ABI,
                        provider
                    );
                    
                    const owner = await operatorNFTContract.ownerOf(operatorTokenId);
                    if (owner && owner.toLowerCase() === userAddress.toLowerCase()) {
                        console.log(`[ERC404Adapter] User owns operator NFT token ${operatorTokenId} for cultexecs`);
                        return true;
                    } else {
                        console.log(`[ERC404Adapter] User does not own operator NFT token ${operatorTokenId}. Owner is:`, owner);
                    }
                } catch (error) {
                    console.warn('[ERC404Adapter] Error checking operator NFT ownership for cultexecs:', error);
                }
            } else if (this.mirrorContract) {
                // For other ERC404 contracts, check standard owner tokens
                for (const tokenId of [0, 1]) {
                    try {
                        const owner = await this.mirrorContract.ownerOf(tokenId);
                        if (owner && owner.toLowerCase() === userAddress.toLowerCase()) {
                            return true;
                        }
                    } catch (error) {
                        // Token may not exist, continue checking
                    }
                }
            }

            return false;
        } catch (error) {
            console.warn('[ERC404Adapter] Error checking ownership:', error);
            return false;
        }
    }
}

export default ERC404Adapter;

