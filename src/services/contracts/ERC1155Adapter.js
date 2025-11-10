/**
 * ERC1155 Adapter
 * 
 * Wraps ERC1155 contract functionality for use with ProjectService.
 * Supports multi-edition publishing with fixed pricing per edition.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';
import { loadMockData } from '../mock/mockData.js';

// Standard ERC1155 ABI (minimal required functions)
const ERC1155_STANDARD_ABI = [
    {
        "constant": true,
        "inputs": [
            { "name": "account", "type": "address" },
            { "name": "id", "type": "uint256" }
        ],
        "name": "balanceOf",
        "outputs": [{ "name": "", "type": "uint256" }],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [
            { "name": "accounts", "type": "address[]" },
            { "name": "ids", "type": "uint256[]" }
        ],
        "name": "balanceOfBatch",
        "outputs": [{ "name": "", "type": "uint256[]" }],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            { "name": "from", "type": "address" },
            { "name": "to", "type": "address" },
            { "name": "id", "type": "uint256" },
            { "name": "amount", "type": "uint256" },
            { "name": "data", "type": "bytes" }
        ],
        "name": "safeTransferFrom",
        "outputs": [],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [{ "name": "id", "type": "uint256" }],
        "name": "uri",
        "outputs": [{ "name": "", "type": "string" }],
        "type": "function"
    }
];

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
                    contractType: this.contractType
                });
                return true;
            }

            // Try to load contract-specific ABI
            let contractABI = null;
            try {
                const abiResponse = await fetch(`/contracts/ERC1155.json`);
                if (abiResponse.ok) {
                    contractABI = await abiResponse.json();
                }
            } catch (error) {
                console.warn('[ERC1155Adapter] Could not load custom ABI, using standard ERC1155 ABI');
            }

            // Use custom ABI if available, otherwise use standard
            const abi = contractABI || ERC1155_STANDARD_ABI;

            // Initialize contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                abi,
                this.signer || this.provider
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

            // Try contract method
            try {
                const count = await this.executeContractCall('editionCount', []);
                return parseInt(count.toString());
            } catch (error) {
                // Method might not exist, try to infer from events or other methods
                // For now, return 0 if method doesn't exist
                console.warn('[ERC1155Adapter] editionCount method not found');
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
                        return {
                            id: editionId, // Keep 0-based ID for consistency with getEditions loop
                            price: priceWei.toString(),
                            maxSupply: (piece.supply || 0).toString(),
                            currentSupply: (piece.minted || 0).toString(),
                            active: true,
                            creator: instance.creator || null,
                            royaltyPercent: '0',
                            uri: null,
                            metadata: {
                                name: piece.displayTitle || piece.name || `Edition #${displayEditionId}`,
                                description: piece.description || '',
                                image: piece.image || piece.imageUrl || '/placeholder-edition.png'
                            }
                        };
                    }
                }
                throw new Error(`Edition ${editionId} not found`);
            }

            // For real contracts, fetch from contract
            const [price, maxSupply, currentSupply, active, creator, royaltyPercent] = await Promise.all([
                this._safeContractCall('getEditionPrice', [editionId]) || 
                this._safeContractCall('price', [editionId]) || 
                Promise.resolve('0'),
                this._safeContractCall('getEditionMaxSupply', [editionId]) || 
                this._safeContractCall('maxSupply', [editionId]) || 
                Promise.resolve('0'),
                this._safeContractCall('getEditionSupply', [editionId]) || 
                this._safeContractCall('totalSupply', [editionId]) || 
                Promise.resolve('0'),
                this._safeContractCall('isEditionActive', [editionId]) ?? Promise.resolve(true),
                this._safeContractCall('getEditionCreator', [editionId]) || 
                this._safeContractCall('creator', [editionId]) || 
                Promise.resolve(null),
                this._safeContractCall('getEditionRoyalty', [editionId]) || 
                this._safeContractCall('royaltyPercent', [editionId]) || 
                Promise.resolve('0')
            ]);

            const uri = await this._safeContractCall('uri', [editionId]) || null;
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
                id: editionId,
                price: price.toString(),
                maxSupply: maxSupply?.toString() || '0',
                currentSupply: currentSupply?.toString() || '0',
                active: active ?? true,
                creator: creator || null,
                royaltyPercent: royaltyPercent?.toString() || '0',
                uri: uri || null,
                metadata: metadata
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

            for (let i = 0; i < count; i++) {
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
            if (!this.signer) {
                throw new Error('No wallet connected');
            }

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
            let tx;
            try {
                // Try mint method first
                tx = await this.executeContractCall(
                    'mint',
                    [editionId, quantity],
                    {
                        requiresSigner: true,
                        txOptions: { value: totalCost.toString() }
                    }
                );
            } catch (error) {
                // Fallback to safeTransferFrom from zero address (if contract supports it)
                const userAddress = await this.signer.getAddress();
                tx = await this.executeContractCall(
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

            const receipt = await tx.wait();

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
            if (!this.signer) {
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
                    instance.pieces.push({
                        editionId,
                        displayTitle: metadata.name,
                        name: metadata.name,
                        description: metadata.description,
                        image: metadata.image,
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
}

export default ERC1155Adapter;

