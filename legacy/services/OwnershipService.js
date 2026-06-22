/**
 * Ownership Service
 * 
 * Handles ownership detection for contracts through various methods:
 * - Standard owner() function
 * - NFT ownership (for edge cases like cultexecs)
 * - Mock ownership (for testing)
 */

import serviceFactory from './ServiceFactory.js';
import walletService from './WalletService.js';
import { loadMockData } from './mock/mockData.js';

class OwnershipService {
    constructor() {
        this.cache = new Map(); // Cache ownership checks
    }

    /**
     * Check if a user is the owner of a contract
     * @param {string} contractAddress - Contract address
     * @param {string} userAddress - User address to check
     * @param {string} contractType - Contract type (ERC404, ERC1155, etc.)
     * @returns {Promise<boolean>} True if user is owner
     */
    async checkOwnership(contractAddress, userAddress, contractType = null) {
        if (!contractAddress || !userAddress) {
            return false;
        }

        // Normalize addresses
        const normalizedContract = contractAddress.toLowerCase();
        const normalizedUser = userAddress.toLowerCase();

        // Check cache
        const cacheKey = `${normalizedContract}:${normalizedUser}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let isOwner = false;

        try {
            // Check if this is a mock contract
            const isMock = await this._isMockContract(contractAddress);
            
            if (isMock) {
                isOwner = await this._checkMockOwnership(contractAddress, userAddress);
            } else {
                // Check real contract ownership
                // First try standard owner() function
                isOwner = await this._checkStandardOwner(contractAddress, userAddress, contractType);
                
                // If standard check fails, try NFT ownership (for cultexecs edge case)
                if (!isOwner && contractType === 'ERC404') {
                    isOwner = await this._checkNFTOwner(contractAddress, userAddress);
                }
            }
        } catch (error) {
            console.warn('[OwnershipService] Error checking ownership:', error);
            isOwner = false;
        }

        // Cache result (with short TTL - ownership can change)
        this.cache.set(cacheKey, isOwner);
        setTimeout(() => this.cache.delete(cacheKey), 30000); // 30 second cache

        return isOwner;
    }

    /**
     * Get the owner address of a contract
     * @param {string} contractAddress - Contract address
     * @param {string} contractType - Contract type
     * @returns {Promise<string|null>} Owner address or null if not found
     */
    async getOwner(contractAddress, contractType = null) {
        if (!contractAddress) {
            return null;
        }

        try {
            // Check if this is a mock contract
            const isMock = await this._isMockContract(contractAddress);
            
            if (isMock) {
                return await this._getMockOwner(contractAddress);
            }

            // Get owner from real contract
            return await this._getStandardOwner(contractAddress, contractType);
        } catch (error) {
            console.warn('[OwnershipService] Error getting owner:', error);
            return null;
        }
    }

    /**
     * Check standard owner() function
     * @private
     */
    async _checkStandardOwner(contractAddress, userAddress, contractType) {
        try {
            const owner = await this._getStandardOwner(contractAddress, contractType);
            if (!owner) {
                return false;
            }
            return owner.toLowerCase() === userAddress.toLowerCase();
        } catch (error) {
            // If owner() function doesn't exist, return false
            return false;
        }
    }

    /**
     * Get owner from standard owner() function
     * @private
     */
    async _getStandardOwner(contractAddress, contractType) {
        try {
            // Get project service and adapter
            const projectService = serviceFactory.getProjectService();
            
            // Try to get adapter if project is loaded
            let adapter = null;
            const projectId = contractAddress; // Use address as projectId
            
            // Check if project is already loaded
            if (projectService.isProjectLoaded(projectId)) {
                adapter = projectService.getAdapter(projectId);
            } else {
                // Try to load project
                try {
                    await projectService.loadProject(projectId, contractAddress, contractType);
                    adapter = projectService.getAdapter(projectId);
                } catch (error) {
                    console.warn('[OwnershipService] Could not load project for owner check:', error);
                }
            }

            if (!adapter || !adapter.contract) {
                // Try direct contract call
                return await this._callOwnerFunction(contractAddress);
            }

            // Use adapter's contract
            if (typeof adapter.contract.owner === 'function') {
                const owner = await adapter.contract.owner();
                return owner;
            }

            // Fallback to direct call
            return await this._callOwnerFunction(contractAddress);
        } catch (error) {
            console.warn('[OwnershipService] Error getting standard owner:', error);
            return null;
        }
    }

    /**
     * Call owner() function directly on contract
     * @private
     */
    async _callOwnerFunction(contractAddress) {
        try {
            const { provider } = walletService.getProviderAndSigner();
            if (!provider) {
                return null;
            }

            // Try to call owner() function
            // This is a common function signature: owner() returns (address)
            const ownerABI = [
                {
                    "constant": true,
                    "inputs": [],
                    "name": "owner",
                    "outputs": [{"name": "", "type": "address"}],
                    "type": "function"
                }
            ];

            const ethers = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js').then(m => m.ethers || m.default);
            const contract = new ethers.Contract(contractAddress, ownerABI, provider);
            const owner = await contract.owner();
            return owner;
        } catch (error) {
            // owner() function may not exist
            return null;
        }
    }

    /**
     * Check NFT ownership (for cultexecs edge case)
     * @private
     */
    async _checkNFTOwner(contractAddress, userAddress) {
        try {
            // For cultexecs, ownership is determined by NFT ownership
            // We need to check if the user owns a specific NFT (usually tokenId 0 or 1)
            // This is contract-specific, so we'll try a few common patterns

            const projectService = serviceFactory.getProjectService();
            const projectId = contractAddress;
            
            // Try to get adapter
            let adapter = null;
            if (projectService.isProjectLoaded(projectId)) {
                adapter = projectService.getAdapter(projectId);
            } else {
                try {
                    await projectService.loadProject(projectId, contractAddress, 'ERC404');
                    adapter = projectService.getAdapter(projectId);
                } catch (error) {
                    return false;
                }
            }

            if (!adapter) {
                return false;
            }

            // For ERC404, check if there's a mirror contract
            if (adapter.mirrorContract) {
                // Check if user owns tokenId 0 or 1 (common owner tokens)
                for (const tokenId of [0, 1]) {
                    try {
                        const owner = await adapter.mirrorContract.ownerOf(tokenId);
                        if (owner && owner.toLowerCase() === userAddress.toLowerCase()) {
                            return true;
                        }
                    } catch (error) {
                        // Token may not exist, continue
                    }
                }
            }

            // Alternative: Check balanceOf on mirror contract
            if (adapter.mirrorContract) {
                try {
                    const balance = await adapter.mirrorContract.balanceOf(userAddress);
                    const balanceNum = parseInt(balance.toString());
                    // If user owns any NFTs, they might be the owner
                    // This is a heuristic - actual ownership logic may vary
                    if (balanceNum > 0) {
                        // For cultexecs specifically, check if they own the operator NFT
                        // This is contract-specific logic
                        return false; // Default to false, let standard owner() handle it
                    }
                } catch (error) {
                    // Can't check balance
                }
            }

            return false;
        } catch (error) {
            console.warn('[OwnershipService] Error checking NFT owner:', error);
            return false;
        }
    }

    /**
     * Check mock ownership
     * @private
     */
    async _checkMockOwnership(contractAddress, userAddress) {
        try {
            const mockData = loadMockData();
            if (!mockData) {
                return false;
            }

            // Check instance owner
            const instance = mockData.instances[contractAddress];
            if (instance && instance.owner) {
                return instance.owner.toLowerCase() === userAddress.toLowerCase();
            }

            // Check mock owner address (for testing)
            const mockOwner = mockData.mockOwnerAddress || '0xMOCKOWNER000000000000000000000000000000';
            return mockOwner.toLowerCase() === userAddress.toLowerCase();
        } catch (error) {
            console.warn('[OwnershipService] Error checking mock ownership:', error);
            return false;
        }
    }

    /**
     * Get mock owner
     * @private
     */
    async _getMockOwner(contractAddress) {
        try {
            const mockData = loadMockData();
            if (!mockData) {
                return mockData.mockOwnerAddress || '0xMOCKOWNER000000000000000000000000000000';
            }

            // Check instance owner
            const instance = mockData.instances[contractAddress];
            if (instance && instance.owner) {
                return instance.owner;
            }

            // Return default mock owner
            return mockData.mockOwnerAddress || '0xMOCKOWNER000000000000000000000000000000';
        } catch (error) {
            return '0xMOCKOWNER000000000000000000000000000000';
        }
    }

    /**
     * Check if contract is a mock contract
     * @private
     */
    async _isMockContract(contractAddress) {
        if (!contractAddress) {
            return false;
        }

        // Check common patterns
        if (contractAddress.startsWith('0xMOCK') || 
            contractAddress.includes('mock') ||
            contractAddress.startsWith('0xFACTORY')) {
            return true;
        }

        // Check mock data
        try {
            const mockData = loadMockData();
            if (mockData && mockData.instances && mockData.instances[contractAddress]) {
                return true;
            }
        } catch (error) {
            // If we can't check, assume it's not a mock contract
        }

        return false;
    }

    /**
     * Clear ownership cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Clear cache for specific contract
     */
    clearCacheForContract(contractAddress) {
        if (!contractAddress) {
            return;
        }
        const normalized = contractAddress.toLowerCase();
        for (const key of this.cache.keys()) {
            if (key.startsWith(normalized + ':')) {
                this.cache.delete(key);
            }
        }
    }
}

// Create singleton instance
const ownershipService = new OwnershipService();

export default ownershipService;

