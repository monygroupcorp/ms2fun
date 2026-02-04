/**
 * ERC1155 Adapter
 * 
 * Wraps ERC1155 contract functionality for use with ProjectService.
 * Supports multi-edition publishing with fixed pricing per edition.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';
import { loadMockData } from '../mock/mockData.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (edition metadata, instance info)
    DYNAMIC: 5 * 60 * 1000,       // 5 minutes (pricing, supply)
    REALTIME: 30 * 1000,          // 30 seconds (mint stats)
};

class ERC1155Adapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC1155', ethersProvider, signer);
        this.ethers = ethers;
        this._editionCache = new Map();
    }

    /**
     * Initialize the adapter - load contract ABI and create contract instance
     */
    async initialize() {
        try {
            // Check if this is a mock contract
            if (this._isMockContract()) {
                this.initialized = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }

            // Validate provider
            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            // Load ERC1155Instance ABI from centralized location
            const abi = await loadABI('ERC1155Instance');

            // Debug: Log provider info
            const providerToUse = this.signer || this.provider;
            console.log('[ERC1155Adapter] Initializing contract:', {
                address: this.contractAddress,
                providerType: providerToUse.constructor.name,
                network: providerToUse._network,
                hasOwner: abi.some(item => item.name === 'owner'),
                hasGetEditionCount: abi.some(item => item.name === 'getEditionCount')
            });

            // Initialize contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                abi,
                providerToUse
            );

            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, 'ERC1155Adapter initialization failed');
        }
    }

    /**
     * Check if this is a mock contract
     * @private
     */
    _isMockContract() {
        // Check common mock patterns
        if (this.contractAddress.startsWith('0xMOCK') || 
            this.contractAddress.includes('mock') ||
            this.contractAddress.startsWith('0xFACTORY')) {
            return true;
        }
        
        // Check if address exists in mock data instances
        try {
            const mockData = loadMockData();
            if (mockData && mockData.instances && mockData.instances[this.contractAddress]) {
                return true;
            }
        } catch (error) {
            // If we can't load mock data, assume it's not a mock contract
        }
        
        return false;
    }

    /**
     * Get user balance (total across all editions or first edition)
     * @param {string} address - User address
     * @returns {Promise<string>} Balance in wei
     */
    async getBalance(address) {
        try {
            if (this._isMockContract()) {
                // For mock contracts, return total balance across all editions
                const editions = await this.getEditions();
                if (editions.length === 0) {
                    return '0';
                }
                
                let totalBalance = BigInt(0);
                for (const edition of editions) {
                    const balance = await this.getBalanceForEdition(address, edition.id);
                    totalBalance += BigInt(balance || '0');
                }
                return totalBalance.toString();
            }

            // For real contracts, get balance of first edition (or edition 0)
            const editions = await this.getEditions();
            if (editions.length === 0) {
                return '0';
            }

            const balance = await this.executeContractCall('balanceOf', [
                address,
                editions[0].id
            ]);
            return balance.toString();
        } catch (error) {
            throw this.handleContractError(error, 'getBalance');
        }
    }

    /**
     * Get current price (average or first active edition price)
     * @returns {Promise<number>} Current price in ETH
     */
    async getPrice() {
        try {
            const editions = await this.getEditions();
            const activeEditions = editions.filter(e => e.active);

            if (activeEditions.length === 0) {
                return 0;
            }

            // Return price of first active edition
            const priceWei = BigInt(activeEditions[0].price || '0');
            return parseFloat(ethers.utils.formatEther(priceWei.toString()));
        } catch (error) {
            throw this.handleContractError(error, 'getPrice');
        }
    }

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        try {
            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance) {
                    return {
                        name: instance.name || 'ERC1155 Collection',
                        description: instance.description || 'Multi-edition collection',
                        contractAddress: this.contractAddress,
                        contractType: this.contractType
                    };
                }
            }

            // Try to get contract-level metadata URI
            try {
                const uri = await this.executeContractCall('uri', [0]);
                if (uri && uri !== '') {
                    const response = await fetch(uri);
                    if (response.ok) {
                        return await response.json();
                    }
                }
            } catch (error) {
                // URI method might not exist or return empty
            }

            // Fallback to basic metadata
            return {
                name: 'ERC1155 Collection',
                description: 'Multi-edition collection',
                contractAddress: this.contractAddress,
                contractType: this.contractType
            };
        } catch (error) {
            throw this.handleContractError(error, 'getMetadata');
        }
    }

    /**
     * Get edition count
     * @returns {Promise<number>} Number of editions
     */
    async getEditionCount() {
        try {
            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance && instance.pieces) {
                    return instance.pieces.length;
                }
                return 0;
            }

            // Try contract method - note: method is called getEditionCount in the contract
            try {
                const count = await this.executeContractCall('getEditionCount', []);
                return parseInt(count.toString());
            } catch (error) {
                // Method might not exist, try to infer from events or other methods
                // For now, return 0 if method doesn't exist
                console.warn('[ERC1155Adapter] getEditionCount method not found');
                return 0;
            }
        } catch (error) {
            throw this.handleContractError(error, 'getEditionCount');
        }
    }

    /**
     * Get edition info
     * @param {number} editionId - Edition ID
     * @returns {Promise<Object>} Edition information
     */
    async getEditionInfo(editionId) {
        try {
            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance && instance.pieces && instance.pieces.length > 0) {
                    // Use array index directly (0-based) since getEditions() loops from 0 to count-1
                    if (editionId >= 0 && editionId < instance.pieces.length) {
                        const piece = instance.pieces[editionId];
                        const priceWei = ethers.utils.parseEther(
                            piece.price?.replace(' ETH', '') || '0'
                        );
                        // Use the piece's editionId if available, otherwise use index + 1
                        const displayEditionId = piece.editionId !== undefined ? piece.editionId : (editionId + 1);
                        
                        // Simulate IPFS metadata fetch if metadataURI is provided
                        let metadata = {
                            name: piece.displayTitle || piece.name || `Edition #${displayEditionId}`,
                            description: piece.description || '',
                            image: piece.image || piece.imageUrl || '/placeholder-edition.png'
                        };
                        
                        // If piece has metadataURI (IPFS), simulate fetching it
                        const metadataURI = piece.metadataURI || instance.metadataURI;
                        if (metadataURI && (metadataURI.startsWith('ipfs://') || metadataURI.startsWith('http'))) {
                            try {
                                // Import IPFS service for mock metadata fetching
                                const { fetchJsonWithIpfsSupport } = await import('../../services/IpfsService.js');
                                const fetchedMetadata = await fetchJsonWithIpfsSupport(metadataURI);
                                
                                // Merge fetched metadata with piece data (fetched takes precedence)
                                metadata = {
                                    ...metadata,
                                    ...fetchedMetadata,
                                    // Ensure name and description from piece are preserved if not in fetched metadata
                                    name: fetchedMetadata.name || metadata.name,
                                    description: fetchedMetadata.description || metadata.description,
                                    // Image from fetched metadata (could be IPFS or HTTP)
                                    image: fetchedMetadata.image || fetchedMetadata.image_url || metadata.image
                                };
                            } catch (error) {
                                console.warn(`[ERC1155Adapter] Failed to fetch mock metadata from ${metadataURI}:`, error);
                                // Fall back to piece.image if metadata fetch fails
                                if (piece.image && piece.image.startsWith('ipfs://')) {
                                    metadata.image = piece.image;
                                }
                            }
                        } else if (piece.image && piece.image.startsWith('ipfs://')) {
                            // If piece.image is IPFS but no metadataURI, use it directly
                            metadata.image = piece.image;
                        }
                        
                        return {
                            id: editionId, // Keep 0-based ID for consistency with getEditions loop
                            price: priceWei.toString(),
                            maxSupply: (piece.supply || 0).toString(),
                            currentSupply: (piece.minted || 0).toString(),
                            active: true,
                            creator: instance.creator || null,
                            royaltyPercent: '0',
                            uri: metadataURI || null,
                            metadata: metadata
                        };
                    }
                }
                throw new Error(`Edition ${editionId} not found`);
            }

            // For real contracts, fetch edition data using getEdition() method
            const edition = await this.executeContractCall('getEdition', [editionId]);

            if (!edition || !edition.id) {
                throw new Error(`Edition ${editionId} not found`);
            }

            // Fetch metadata from URI if available
            const uri = edition.metadataURI || null;
            let metadata = null;
            if (uri) {
                try {
                    const response = await fetch(uri);
                    if (response.ok) {
                        metadata = await response.json();
                    }
                } catch (e) {
                    console.warn(`Failed to fetch metadata for edition ${editionId}:`, e);
                }
            }

            return {
                id: edition.id.toString(),
                price: edition.basePrice.toString(),
                maxSupply: edition.supply.toString(),
                currentSupply: edition.minted.toString(),
                active: true, // ERC1155Instance doesn't have active flag
                creator: await this._safeContractCall('creator') || null,
                royaltyPercent: '0', // Not stored in Edition struct
                uri: uri,
                metadata: metadata,
                pieceTitle: edition.pieceTitle || null,
                pricingModel: edition.pricingModel?.toString() || '0',
                priceIncreaseRate: edition.priceIncreaseRate?.toString() || '0'
            };
        } catch (error) {
            throw this.handleContractError(error, 'getEditionInfo');
        }
    }

    /**
     * Safe contract call that returns null if method doesn't exist
     * @private
     */
    async _safeContractCall(method, args) {
        try {
            if (!this.contract || typeof this.contract[method] !== 'function') {
                return null;
            }
            return await this.executeContractCall(method, args);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all editions
     * @returns {Promise<Array>} Array of edition info objects
     */
    async getEditions() {
        try {
            const count = await this.getEditionCount();
            const editions = [];

            // ERC1155Instance uses 1-indexed edition IDs
            for (let i = 1; i <= count; i++) {
                try {
                    const editionInfo = await this.getEditionInfo(i);
                    editions.push(editionInfo);
                } catch (error) {
                    console.warn(`Failed to get info for edition ${i}:`, error);
                    // Continue with other editions
                }
            }

            return editions;
        } catch (error) {
            throw this.handleContractError(error, 'getEditions');
        }
    }

    /**
     * Get price for a specific edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Price in wei
     */
    async getEditionPrice(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.price;
    }

    /**
     * Get metadata for a specific edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<Object>} Edition metadata
     */
    async getEditionMetadata(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.metadata || {};
    }

    /**
     * Get supply for a specific edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Current supply
     */
    async getEditionSupply(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.currentSupply;
    }

    /**
     * Get max supply for a specific edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Max supply (0 for unlimited)
     */
    async getEditionMaxSupply(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.maxSupply;
    }

    /**
     * Get balance for a specific edition
     * @param {string} address - User address
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Balance
     */
    async getBalanceForEdition(address, editionId) {
        try {
            if (this._isMockContract()) {
                // Mock contracts don't track balances per edition
                return '0';
            }

            const balance = await this.executeContractCall('balanceOf', [address, editionId]);
            return balance.toString();
        } catch (error) {
            throw this.handleContractError(error, 'getBalanceForEdition');
        }
    }

    /**
     * Mint an edition
     * @param {number} editionId - Edition ID
     * @param {number} quantity - Quantity to mint
     * @param {string} payment - Payment amount in wei
     * @returns {Promise<Object>} Transaction receipt
     */
    async mintEdition(editionId, quantity, payment) {
        try {
            // Get current signer from WalletService (may have changed since initialization)
            const walletService = (await import('../WalletService.js')).default;
            const { signer } = walletService.getProviderAndSigner();

            if (!signer) {
                throw new Error('No wallet connected');
            }

            // Ensure wallet is on the correct network
            await walletService.ensureCorrectNetwork();

            // Update adapter's signer so executeContractCall can use it
            this.signer = signer;

            const editionInfo = await this.getEditionInfo(editionId);
            const priceWei = BigInt(editionInfo.price);
            const totalCost = priceWei * BigInt(quantity);

            if (BigInt(payment) < totalCost) {
                throw new Error('Insufficient payment');
            }

            if (this._isMockContract()) {
                // For mock contracts, update mock data
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance && instance.pieces) {
                    const piece = instance.pieces.find(p => 
                        p.editionId === editionId || 
                        (p.editionId === undefined && instance.pieces.indexOf(p) === editionId)
                    );
                    if (piece) {
                        piece.minted = (piece.minted || 0) + quantity;
                        // Save mock data
                        const { saveMockData } = await import('../mock/mockData.js');
                        saveMockData(mockData);
                    }
                }

                // Emit success event
                eventBus.emit('erc1155:edition:minted', {
                    editionId,
                    quantity,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });

                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            // For real contracts, call mint function
            // Note: executeContractCall already waits for the transaction and returns the receipt
            let receipt;
            try {
                // Try mint method first (pass empty string for message)
                receipt = await this.executeContractCall(
                    'mint',
                    [editionId, quantity, ""],  // Empty message saves gas
                    {
                        requiresSigner: true,
                        txOptions: { value: totalCost.toString() }
                    }
                );
            } catch (error) {
                // Fallback to safeTransferFrom from zero address (if contract supports it)
                const userAddress = await signer.getAddress();
                receipt = await this.executeContractCall(
                    'safeTransferFrom',
                    [
                        ethers.constants.AddressZero, // From zero address (mint)
                        userAddress, // To user
                        editionId,
                        quantity,
                        '0x' // No data
                    ],
                    {
                        requiresSigner: true,
                        txOptions: { value: totalCost.toString() }
                    }
                );
            }

            eventBus.emit('erc1155:edition:minted', {
                editionId,
                quantity,
                contractAddress: this.contractAddress,
                txHash: receipt.transactionHash
            });

            // Invalidate cache
            contractCache.invalidateByPattern('edition', 'balance');

            return receipt;
        } catch (error) {
            throw this.handleContractError(error, 'mintEdition');
        }
    }

    /**
     * Get creator balance for an edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Creator balance in wei
     */
    async getCreatorBalance(editionId) {
        try {
            if (this._isMockContract()) {
                // Mock contracts don't track creator balances
                return '0';
            }

            // Try to get creator balance from contract
            const balance = await this._safeContractCall('getCreatorBalance', [editionId]);
            return balance ? balance.toString() : '0';
        } catch (error) {
            throw this.handleContractError(error, 'getCreatorBalance');
        }
    }

    /**
     * Get creator address for an edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Creator address
     */
    async getCreatorAddress(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.creator;
    }

    /**
     * Check if edition is active
     * @param {number} editionId - Edition ID
     * @returns {Promise<boolean>} True if active
     */
    async isEditionActive(editionId) {
        const editionInfo = await this.getEditionInfo(editionId);
        return editionInfo.active;
    }

    /**
     * Create a new edition (only for contract owner/creator)
     * @param {Object} metadata - Edition metadata (name, description, image)
     * @param {string} price - Price in wei
     * @param {string} maxSupply - Max supply (0 for unlimited)
     * @param {string} royaltyPercent - Royalty percentage (0-100)
     * @returns {Promise<Object>} Transaction receipt
     */
    async createEdition(metadata, price, maxSupply, royaltyPercent = '0') {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                // For mock contracts, add to pieces array
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance) {
                    if (!instance.pieces) {
                        instance.pieces = [];
                    }
                    const editionId = instance.pieces.length;
                    
                    // Generate title slug for URL navigation (CONTRACT_REQUIREMENTS.md #6)
                    const titleSlug = this._slugify(metadata.name || `edition-${editionId}`);
                    
                    instance.pieces.push({
                        editionId,
                        title: titleSlug,  // URL-safe title (slug) for navigation
                        displayTitle: metadata.name,  // Display title
                        name: metadata.name,  // Keep for backward compatibility
                        description: metadata.description || '',
                        image: metadata.image || '',
                        price: ethers.utils.formatEther(price) + ' ETH',
                        supply: parseInt(maxSupply) || 0,
                        minted: 0
                    });
                    // Save mock data
                    const { saveMockData } = await import('../mock/mockData.js');
                    saveMockData(mockData);

                    // Emit success event
                    eventBus.emit('erc1155:edition:created', {
                        editionId,
                        contractAddress: this.contractAddress,
                        txHash: '0xMOCK' + Date.now().toString(16)
                    });

                    return { transactionHash: '0xMOCK' + Date.now().toString(16) };
                }
                throw new Error('Mock instance not found');
            }

            // For real contracts, call createEdition method
            const tx = await this.executeContractCall(
                'createEdition',
                [metadata, price, maxSupply, royaltyPercent],
                { requiresSigner: true }
            );

            const receipt = await tx.wait();

            eventBus.emit('erc1155:edition:created', {
                editionId: null, // Will be determined from events
                contractAddress: this.contractAddress,
                txHash: receipt.transactionHash
            });

            // Invalidate cache
            contractCache.invalidateByPattern('edition');

            return receipt;
        } catch (error) {
            throw this.handleContractError(error, 'createEdition');
        }
    }

    // =========================
    // Additional Minting Methods
    // =========================

    /**
     * Mint an edition (alias for mintEdition)
     * @param {number} editionId - Edition ID
     * @param {number} amount - Amount to mint
     * @returns {Promise<Object>} Transaction receipt
     */
    async mint(editionId, amount) {
        const editionInfo = await this.getEditionInfo(editionId);
        const totalCost = BigInt(editionInfo.price) * BigInt(amount);
        return await this.mintEdition(editionId, amount, totalCost.toString());
    }

    /**
     * Mint edition with message
     * @param {number} editionId - Edition ID
     * @param {number} amount - Amount to mint
     * @param {string} message - Message to attach
     * @returns {Promise<Object>} Transaction receipt
     */
    async mintWithMessage(editionId, amount, message) {
        try {
            // Get current signer from WalletService (may have changed since initialization)
            const walletService = (await import('../WalletService.js')).default;
            const { signer } = walletService.getProviderAndSigner();

            if (!signer) {
                throw new Error('No wallet connected');
            }

            // Ensure wallet is on the correct network
            await walletService.ensureCorrectNetwork();

            // Update adapter's signer so executeContractCall can use it
            this.signer = signer;

            // Use calculateMintCost to get accurate cost (handles bonding curves)
            const totalCost = await this.calculateMintCost(editionId, amount);

            if (this._isMockContract()) {
                // Mock implementation - use regular mint
                const receipt = await this.mintEdition(editionId, amount, totalCost.toString());

                eventBus.emit('erc1155:mint:message', {
                    editionId,
                    amount,
                    message,
                    contractAddress: this.contractAddress,
                    txHash: receipt.transactionHash
                });

                return receipt;
            }

            eventBus.emit('transaction:pending', {
                type: 'mintWithMessage',
                contractAddress: this.contractAddress,
                editionId
            });

            const receipt = await this.executeContractCall(
                'mint',  // Unified mint function now accepts message parameter
                [editionId, amount, message],
                {
                    requiresSigner: true,
                    txOptions: { value: totalCost }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'mintWithMessage',
                receipt,
                contractAddress: this.contractAddress,
                editionId
            });

            // Invalidate cache
            contractCache.invalidateByPattern('edition', 'mint');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'mintWithMessage',
                error: this.wrapError(error, 'Mint with message failed')
            });
            throw error;
        }
    }

    /**
     * Calculate cost to mint edition
     * @param {number} editionId - Edition ID
     * @param {number} amount - Amount to mint
     * @returns {Promise<string>} Total cost in wei
     */
    async calculateMintCost(editionId, amount) {
        return await this.getCachedOrFetch('calculateMintCost', [editionId, amount], async () => {
            if (this._isMockContract()) {
                const editionInfo = await this.getEditionInfo(editionId);
                const totalCost = BigInt(editionInfo.price) * BigInt(amount);
                return totalCost.toString();
            }

            // Try contract method first
            try {
                const cost = await this.executeContractCall('calculateMintCost', [editionId, amount]);
                return cost.toString();
            } catch (error) {
                // Fallback: calculate from edition price
                const editionInfo = await this.getEditionInfo(editionId);
                const totalCost = BigInt(editionInfo.price) * BigInt(amount);
                return totalCost.toString();
            }
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get current price for edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Current price in wei
     */
    async getCurrentPrice(editionId) {
        return await this.getCachedOrFetch('getCurrentPrice', [editionId], async () => {
            if (this._isMockContract()) {
                const editionInfo = await this.getEditionInfo(editionId);
                return editionInfo.price;
            }

            // Try contract method
            try {
                const price = await this.executeContractCall('getCurrentPrice', [editionId]);
                return price.toString();
            } catch (error) {
                // Fallback: use getEditionPrice
                return await this.getEditionPrice(editionId);
            }
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Additional Edition Query Methods
    // =========================

    /**
     * Get all edition IDs
     * @returns {Promise<Array<number>>} Array of edition IDs
     */
    async getAllEditionIds() {
        return await this.getCachedOrFetch('getAllEditionIds', [], async () => {
            const count = await this.getEditionCount();
            const ids = [];
            for (let i = 0; i < count; i++) {
                ids.push(i);
            }
            return ids;
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get editions in batch
     * @param {number} startId - Start edition ID
     * @param {number} endId - End edition ID (exclusive)
     * @returns {Promise<Array<Object>>} Array of edition info objects
     */
    async getEditionsBatch(startId, endId) {
        const editions = [];
        for (let i = startId; i < endId; i++) {
            try {
                const editionInfo = await this.getEditionInfo(i);
                editions.push(editionInfo);
            } catch (error) {
                console.warn(`Failed to get edition ${i}:`, error);
                // Continue with other editions
            }
        }
        return editions;
    }

    /**
     * Get pricing info for edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<Object>} Pricing information
     */
    async getPricingInfo(editionId) {
        return await this.getCachedOrFetch('getPricingInfo', [editionId], async () => {
            if (this._isMockContract()) {
                const editionInfo = await this.getEditionInfo(editionId);
                return {
                    currentPrice: editionInfo.price,
                    pricingModel: 0, // Fixed pricing
                    basePrice: editionInfo.price,
                    priceIncreaseRate: '0'
                };
            }

            try {
                const info = await this.executeContractCall('getPricingInfo', [editionId]);
                return {
                    currentPrice: info.currentPrice?.toString() || info[0]?.toString(),
                    pricingModel: info.pricingModel?.toString() || info[1]?.toString() || '0',
                    basePrice: info.basePrice?.toString() || info[2]?.toString(),
                    priceIncreaseRate: info.priceIncreaseRate?.toString() || info[3]?.toString() || '0'
                };
            } catch (error) {
                // Fallback to basic pricing
                const editionInfo = await this.getEditionInfo(editionId);
                return {
                    currentPrice: editionInfo.price,
                    pricingModel: 0,
                    basePrice: editionInfo.price,
                    priceIncreaseRate: '0'
                };
            }
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get mint stats for edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<Object>} Mint statistics
     */
    async getMintStats(editionId) {
        return await this.getCachedOrFetch('getMintStats', [editionId], async () => {
            if (this._isMockContract()) {
                const editionInfo = await this.getEditionInfo(editionId);
                return {
                    totalMinted: editionInfo.currentSupply,
                    maxSupply: editionInfo.maxSupply,
                    remainingSupply: BigInt(editionInfo.maxSupply) === BigInt(0)
                        ? 'unlimited'
                        : (BigInt(editionInfo.maxSupply) - BigInt(editionInfo.currentSupply)).toString()
                };
            }

            try {
                const stats = await this.executeContractCall('getMintStats', [editionId]);
                return {
                    totalMinted: stats.totalMinted?.toString() || stats[0]?.toString(),
                    maxSupply: stats.maxSupply?.toString() || stats[1]?.toString(),
                    remainingSupply: stats.remainingSupply?.toString() || stats[2]?.toString()
                };
            } catch (error) {
                // Fallback to edition info
                const editionInfo = await this.getEditionInfo(editionId);
                return {
                    totalMinted: editionInfo.currentSupply,
                    maxSupply: editionInfo.maxSupply,
                    remainingSupply: BigInt(editionInfo.maxSupply) === BigInt(0)
                        ? 'unlimited'
                        : (BigInt(editionInfo.maxSupply) - BigInt(editionInfo.currentSupply)).toString()
                };
            }
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Check if edition exists
     * @param {number} editionId - Edition ID
     * @returns {Promise<boolean>} True if edition exists
     */
    async editionExists(editionId) {
        try {
            if (this._isMockContract()) {
                const count = await this.getEditionCount();
                return editionId >= 0 && editionId < count;
            }

            const exists = await this.executeContractCall('editionExists', [editionId]);
            return !!exists;
        } catch (error) {
            // Fallback: try to get edition info
            try {
                await this.getEditionInfo(editionId);
                return true;
            } catch (e) {
                return false;
            }
        }
    }

    /**
     * Get piece title for edition
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Piece title
     */
    async getPieceTitle(editionId) {
        return await this.getCachedOrFetch('getPieceTitle', [editionId], async () => {
            if (this._isMockContract()) {
                const editionInfo = await this.getEditionInfo(editionId);
                return editionInfo.metadata?.name || `Edition #${editionId}`;
            }

            try {
                return await this.executeContractCall('getPieceTitle', [editionId]);
            } catch (error) {
                // Fallback to metadata
                const editionInfo = await this.getEditionInfo(editionId);
                return editionInfo.metadata?.name || `Edition #${editionId}`;
            }
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get edition (alias for getEditionInfo)
     * @param {number} editionId - Edition ID
     * @returns {Promise<Object>} Edition information
     */
    async getEdition(editionId) {
        return await this.getEditionInfo(editionId);
    }

    // =========================
    // Instance Query Methods
    // =========================

    /**
     * Get instance metadata (alias for getMetadata)
     * @returns {Promise<Object>} Instance metadata
     */
    async getInstanceMetadata() {
        return await this.getMetadata();
    }

    /**
     * Get project name
     * @returns {Promise<string>} Project name
     */
    async getProjectName() {
        return await this.getCachedOrFetch('getProjectName', [], async () => {
            if (this._isMockContract()) {
                const metadata = await this.getMetadata();
                return metadata.name || 'ERC1155 Collection';
            }

            try {
                return await this.executeContractCall('projectName');
            } catch (error) {
                // Fallback to metadata
                const metadata = await this.getMetadata();
                return metadata.name || 'ERC1155 Collection';
            }
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get total proceeds collected
     * @returns {Promise<string>} Total proceeds in wei
     */
    async getTotalProceeds() {
        return await this.getCachedOrFetch('getTotalProceeds', [], async () => {
            if (this._isMockContract()) {
                return '0'; // Mock contracts don't track proceeds
            }

            try {
                const proceeds = await this.executeContractCall('totalProceeds');
                return proceeds.toString();
            } catch (error) {
                console.warn('[ERC1155Adapter] totalProceeds method not available');
                return '0';
            }
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // ERC1155 Standard Methods
    // =========================

    /**
     * Get balance of account (alias for getBalanceForEdition)
     * @param {string} account - Account address
     * @param {number} editionId - Edition ID
     * @returns {Promise<string>} Balance
     */
    async balanceOf(account, editionId) {
        return await this.getBalanceForEdition(account, editionId);
    }

    /**
     * Get balances of multiple accounts and editions
     * @param {Array<string>} accounts - Array of account addresses
     * @param {Array<number>} ids - Array of edition IDs
     * @returns {Promise<Array<string>>} Array of balances
     */
    async balanceOfBatch(accounts, ids) {
        try {
            if (this._isMockContract()) {
                // For mock contracts, get balances individually
                const balances = [];
                for (let i = 0; i < accounts.length; i++) {
                    const balance = await this.getBalanceForEdition(accounts[i], ids[i]);
                    balances.push(balance);
                }
                return balances;
            }

            const balances = await this.executeContractCall('balanceOfBatch', [accounts, ids]);
            return balances.map(b => b.toString());
        } catch (error) {
            throw this.handleContractError(error, 'balanceOfBatch');
        }
    }

    /**
     * Transfer edition from one address to another
     * @param {string} from - From address
     * @param {string} to - To address
     * @param {number} id - Edition ID
     * @param {number} amount - Amount to transfer
     * @param {string} data - Additional data (hex string)
     * @returns {Promise<Object>} Transaction receipt
     */
    async safeTransferFrom(from, to, id, amount, data = '0x') {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                // Mock implementation
                eventBus.emit('erc1155:transfer', {
                    from,
                    to,
                    id,
                    amount,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'safeTransferFrom',
                contractAddress: this.contractAddress,
                from,
                to
            });

            const receipt = await this.executeContractCall(
                'safeTransferFrom',
                [from, to, id, amount, data],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'safeTransferFrom',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'safeTransferFrom',
                error: this.wrapError(error, 'Transfer failed')
            });
            throw error;
        }
    }

    /**
     * Batch transfer multiple editions
     * @param {string} from - From address
     * @param {string} to - To address
     * @param {Array<number>} ids - Array of edition IDs
     * @param {Array<number>} amounts - Array of amounts
     * @param {string} data - Additional data (hex string)
     * @returns {Promise<Object>} Transaction receipt
     */
    async safeBatchTransferFrom(from, to, ids, amounts, data = '0x') {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                // Mock implementation
                eventBus.emit('erc1155:batch-transfer', {
                    from,
                    to,
                    ids,
                    amounts,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'safeBatchTransferFrom',
                contractAddress: this.contractAddress,
                from,
                to
            });

            const receipt = await this.executeContractCall(
                'safeBatchTransferFrom',
                [from, to, ids, amounts, data],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'safeBatchTransferFrom',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'safeBatchTransferFrom',
                error: this.wrapError(error, 'Batch transfer failed')
            });
            throw error;
        }
    }

    /**
     * Set approval for all editions
     * @param {string} operator - Operator address
     * @param {boolean} approved - Approval status
     * @returns {Promise<Object>} Transaction receipt
     */
    async setApprovalForAll(operator, approved) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                // Mock implementation
                eventBus.emit('erc1155:approval', {
                    operator,
                    approved,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'setApprovalForAll',
                contractAddress: this.contractAddress,
                operator
            });

            const receipt = await this.executeContractCall(
                'setApprovalForAll',
                [operator, approved],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setApprovalForAll',
                receipt,
                contractAddress: this.contractAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setApprovalForAll',
                error: this.wrapError(error, 'Approval failed')
            });
            throw error;
        }
    }

    /**
     * Check if operator is approved for all editions
     * @param {string} account - Account address
     * @param {string} operator - Operator address
     * @returns {Promise<boolean>} True if approved
     */
    async isApprovedForAll(account, operator) {
        try {
            if (this._isMockContract()) {
                return false; // Mock contracts don't track approvals
            }

            const approved = await this.executeContractCall('isApprovedForAll', [account, operator]);
            return !!approved;
        } catch (error) {
            throw this.handleContractError(error, 'isApprovedForAll');
        }
    }

    // =========================
    // Owner Functions
    // =========================

    /**
     * Add edition (alias for createEdition)
     * @param {Object} params - Edition parameters
     * @returns {Promise<Object>} Transaction receipt
     */
    async addEdition(params) {
        const { metadata, price, maxSupply, royaltyPercent } = params;
        return await this.createEdition(metadata, price, maxSupply, royaltyPercent);
    }

    /**
     * Update edition metadata
     * @param {number} editionId - Edition ID
     * @param {string} metadataURI - New metadata URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async updateEditionMetadata(editionId, metadataURI) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                // Mock implementation
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance && instance.pieces && instance.pieces[editionId]) {
                    instance.pieces[editionId].metadataURI = metadataURI;
                    const { saveMockData } = await import('../mock/mockData.js');
                    saveMockData(mockData);
                }

                eventBus.emit('erc1155:metadata-updated', {
                    editionId,
                    metadataURI,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });

                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'updateEditionMetadata',
                contractAddress: this.contractAddress,
                editionId
            });

            const receipt = await this.executeContractCall(
                'updateEditionMetadata',
                [editionId, metadataURI],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'updateEditionMetadata',
                receipt,
                contractAddress: this.contractAddress,
                editionId
            });

            // Invalidate cache
            contractCache.invalidateByPattern('edition', 'metadata');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'updateEditionMetadata',
                error: this.wrapError(error, 'Metadata update failed')
            });
            throw error;
        }
    }

    /**
     * Withdraw proceeds
     * @param {string} amount - Amount to withdraw in wei
     * @returns {Promise<Object>} Transaction receipt
     */
    async withdraw(amount) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                eventBus.emit('erc1155:withdraw', {
                    amount,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'withdraw',
                contractAddress: this.contractAddress,
                amount
            });

            const receipt = await this.executeContractCall(
                'withdraw',
                [amount],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'withdraw',
                receipt,
                contractAddress: this.contractAddress,
                amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'withdraw',
                error: this.wrapError(error, 'Withdraw failed')
            });
            throw error;
        }
    }

    /**
     * Claim vault fees
     * @returns {Promise<Object>} Transaction receipt
     */
    async claimVaultFees() {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                eventBus.emit('erc1155:claim-fees', {
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'claimVaultFees',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'claimVaultFees',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'claimVaultFees',
                receipt,
                contractAddress: this.contractAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'claimVaultFees',
                error: this.wrapError(error, 'Claim vault fees failed')
            });
            throw error;
        }
    }

    /**
     * Set style URI for instance
     * @param {string} uri - Style URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async setStyle(uri) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                eventBus.emit('erc1155:style-updated', {
                    uri,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'setStyle',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setStyle',
                [uri],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setStyle',
                receipt,
                contractAddress: this.contractAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setStyle',
                error: this.wrapError(error, 'Set style failed')
            });
            throw error;
        }
    }

    /**
     * Set style URI for specific edition
     * @param {number} editionId - Edition ID
     * @param {string} uri - Style URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async setEditionStyle(editionId, uri) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                eventBus.emit('erc1155:edition-style-updated', {
                    editionId,
                    uri,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });
                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'setEditionStyle',
                contractAddress: this.contractAddress,
                editionId
            });

            const receipt = await this.executeContractCall(
                'setEditionStyle',
                [editionId, uri],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setEditionStyle',
                receipt,
                contractAddress: this.contractAddress,
                editionId
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setEditionStyle',
                error: this.wrapError(error, 'Set edition style failed')
            });
            throw error;
        }
    }

    /**
     * Transfer ownership to new address (from Solady Ownable)
     * WARNING: This action is irreversible
     * @param {string} newOwner - New owner address
     * @returns {Promise<Object>} Transaction receipt
     */
    async transferOwnership(newOwner) {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            // Validate new owner address
            if (!newOwner || !ethers.utils.isAddress(newOwner)) {
                throw new Error('Invalid new owner address');
            }

            // Prevent transferring to zero address (use renounceOwnership for that)
            if (newOwner === ethers.constants.AddressZero) {
                throw new Error('Use renounceOwnership to remove ownership');
            }

            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance) {
                    instance.owner = newOwner;
                    instance.creator = newOwner;
                    const { saveMockData } = await import('../mock/mockData.js');
                    saveMockData(mockData);
                }

                eventBus.emit('erc1155:ownership-transferred', {
                    previousOwner: await this.owner(),
                    newOwner,
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });

                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'transferOwnership',
                contractAddress: this.contractAddress,
                newOwner
            });

            const receipt = await this.executeContractCall(
                'transferOwnership',
                [newOwner],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'transferOwnership',
                receipt,
                contractAddress: this.contractAddress,
                newOwner
            });

            // Invalidate owner cache
            contractCache.invalidateByPattern('owner');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'transferOwnership',
                error: this.wrapError(error, 'Transfer ownership failed')
            });
            throw error;
        }
    }

    /**
     * Renounce ownership permanently (from Solady Ownable)
     * WARNING: This action is irreversible - the contract will have no owner
     * @returns {Promise<Object>} Transaction receipt
     */
    async renounceOwnership() {
        try {
            if (!this.ensureSigner()) {
                throw new Error('No wallet connected');
            }

            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                if (instance) {
                    instance.owner = ethers.constants.AddressZero;
                    const { saveMockData } = await import('../mock/mockData.js');
                    saveMockData(mockData);
                }

                eventBus.emit('erc1155:ownership-renounced', {
                    previousOwner: await this.owner(),
                    contractAddress: this.contractAddress,
                    txHash: '0xMOCK' + Date.now().toString(16)
                });

                return { transactionHash: '0xMOCK' + Date.now().toString(16) };
            }

            eventBus.emit('transaction:pending', {
                type: 'renounceOwnership',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'renounceOwnership',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'renounceOwnership',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate owner cache
            contractCache.invalidateByPattern('owner');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'renounceOwnership',
                error: this.wrapError(error, 'Renounce ownership failed')
            });
            throw error;
        }
    }

    /**
     * Get style URI
     * @param {number|null} editionId - Edition ID (null for instance style)
     * @returns {Promise<string>} Style URI
     */
    async getStyle(editionId = null) {
        return await this.getCachedOrFetch('getStyle', [editionId], async () => {
            if (this._isMockContract()) {
                return ''; // Mock contracts don't have styles
            }

            try {
                if (editionId !== null) {
                    // Get style for specific edition (returns edition style or falls back to project style)
                    return await this.executeContractCall('getStyle', [editionId]);
                } else {
                    // Get project-level style from the public styleUri variable
                    return await this.executeContractCall('styleUri', []);
                }
            } catch (error) {
                console.warn('[ERC1155Adapter] getStyle error:', error.message);
                return '';
            }
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Public State Variables
    // =========================

    /**
     * Get factory address
     * @returns {Promise<string>} Factory contract address
     */
    async factory() {
        return await this.getCachedOrFetch('factory', [], async () => {
            return await this.executeContractCall('factory');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async masterRegistry() {
        return await this.getCachedOrFetch('masterRegistry', [], async () => {
            return await this.executeContractCall('masterRegistry');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault address
     * @returns {Promise<string>} Vault contract address
     */
    async vault() {
        return await this.getCachedOrFetch('vault', [], async () => {
            return await this.executeContractCall('vault');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get creator address
     * @returns {Promise<string>} Creator address
     */
    async creator() {
        return await this.getCachedOrFetch('creator', [], async () => {
            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                return instance?.creator || null;
            }

            try {
                const creatorAddr = await this.executeContractCall('creator', []);
                return creatorAddr;
            } catch (error) {
                console.error('[ERC1155Adapter] Failed to get creator:', error);
                return null;
            }
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get owner address (from Ownable)
     * @returns {Promise<string>} Owner address
     */
    async owner() {
        return await this.getCachedOrFetch('owner', [], async () => {
            if (this._isMockContract()) {
                const mockData = loadMockData();
                const instance = mockData?.instances?.[this.contractAddress];
                return instance?.creator || instance?.owner || null;
            }

            try {
                const ownerAddr = await this.executeContractCall('owner', []);
                return ownerAddr;
            } catch (error) {
                console.error('[ERC1155Adapter] Failed to get owner:', error);
                return null;
            }
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get token URI for token ID
     * @param {number} tokenId - Token ID
     * @returns {Promise<string>} Token URI
     */
    async uri(tokenId) {
        return await this.getCachedOrFetch('uri', [tokenId], async () => {
            return await this.executeContractCall('uri', [tokenId]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get token name
     * @returns {Promise<string>} Token name
     */
    async name() {
        return await this.getCachedOrFetch('name', [], async () => {
            return await this.executeContractCall('name');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get global message registry address
     * @returns {Promise<string>} Global message registry contract address
     */
    async getGlobalMessageRegistry() {
        return await this.getCachedOrFetch('getGlobalMessageRegistry', [], async () => {
            return await this.executeContractCall('getGlobalMessageRegistry');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get instance stats including volume and total minted
     * Volume is calculated as sum of (minted * basePrice) for each edition
     * Note: For dynamic pricing, this is an approximation
     * @returns {Promise<Object>} Stats object with volume, totalMinted, editionCount
     */
    async getInstanceStats() {
        return await this.getCachedOrFetch('getInstanceStats', [], async () => {
            try {
                const editions = await this.getEditions();

                let totalVolumeWei = ethers.BigNumber.from(0);
                let totalMinted = 0;

                for (const edition of editions) {
                    const minted = parseInt(edition.currentSupply || '0');
                    const priceWei = ethers.BigNumber.from(edition.price || '0');

                    // Approximate volume as minted * basePrice
                    totalVolumeWei = totalVolumeWei.add(priceWei.mul(minted));
                    totalMinted += minted;
                }

                return {
                    volume: totalVolumeWei.toString(),
                    volumeEth: ethers.utils.formatEther(totalVolumeWei),
                    totalMinted,
                    editionCount: editions.length
                };
            } catch (error) {
                console.warn('[ERC1155Adapter] Error calculating instance stats:', error);
                return {
                    volume: '0',
                    volumeEth: '0',
                    totalMinted: 0,
                    editionCount: 0
                };
            }
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Convert text to URL-safe slug
     * @param {string} text - Text to slugify
     * @returns {string} URL-safe slug
     * @private
     */
    _slugify(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}

export default ERC1155Adapter;

