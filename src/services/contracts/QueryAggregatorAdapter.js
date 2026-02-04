/**
 * QueryAggregator Adapter
 *
 * Wraps QueryAggregator contract functionality.
 * Provides batched queries for home page, portfolio, and vault data.
 * Reduces RPC calls from 80+ to 1-3 per page.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';

// Cache TTL configuration
const CACHE_TTL = {
    HOME_PAGE: 10 * 1000,        // 10 seconds - changes frequently
    PROJECT_CARD: 30 * 1000,     // 30 seconds - semi-static
    PORTFOLIO: 5 * 1000,         // 5 seconds - user-specific
    VAULT_LEADERBOARD: 60 * 1000 // 60 seconds - slow changing
};

class QueryAggregatorAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'QueryAggregator', ethersProvider, signer);
        this.ethers = ethers;
    }

    /**
     * Initialize the adapter - load contract ABI and create contract instance
     */
    async initialize() {
        try {
            // Check if we have a mock provider
            const isMockProvider = this.provider && this.provider.isMock === true;

            if (isMockProvider) {
                this.initialized = true;
                this.isMock = true;
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

            // Load contract ABI
            const abi = await loadABI('QueryAggregator');

            // Initialize main contract
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
            throw this.wrapError(error, 'QueryAggregatorAdapter initialization failed');
        }
    }

    // =========================
    // Main Query Methods
    // =========================

    /**
     * Get all data needed for home page in one call
     * @param {number} offset - Starting index in featured queue
     * @param {number} limit - Number of projects to return (max 50)
     * @returns {Promise<Object>} Home page data
     */
    async getHomePageData(offset = 0, limit = 20) {
        return await this.getCachedOrFetch('getHomePageData', [offset, limit], async () => {
            const [projects, totalFeatured, topVaults, recentActivity] =
                await this.executeContractCall('getHomePageData', [offset, limit]);

            return {
                projects: projects.map(p => this._parseProjectCard(p)),
                totalFeatured: this._toNumber(totalFeatured),
                topVaults: topVaults.map(v => this._parseVaultSummary(v)),
                recentActivity: recentActivity.map(m => this._parseGlobalMessage(m))
            };
        }, CACHE_TTL.HOME_PAGE);
    }

    /**
     * Get ProjectCard data for multiple instances
     * @param {Array<string>} instances - Array of instance addresses
     * @returns {Promise<Array>} Array of ProjectCard objects
     */
    async getProjectCardsBatch(instances) {
        if (!Array.isArray(instances) || instances.length === 0) {
            return [];
        }

        return await this.getCachedOrFetch('getProjectCardsBatch', [instances.join(',')], async () => {
            const cards = await this.executeContractCall('getProjectCardsBatch', [instances]);
            return cards.map(c => this._parseProjectCard(c));
        }, CACHE_TTL.PROJECT_CARD);
    }

    /**
     * Get single ProjectCard for an instance
     * @param {string} instance - Instance address
     * @returns {Promise<Object>} ProjectCard object
     */
    async getProjectCard(instance) {
        const cards = await this.getProjectCardsBatch([instance]);
        return cards[0] || null;
    }

    /**
     * Get portfolio data for a user
     * @param {string} userAddress - User address to query
     * @param {Array<string>} instances - Array of instance addresses to check holdings for
     * @returns {Promise<Object>} Portfolio data
     */
    async getPortfolioData(userAddress, instances) {
        if (!userAddress) {
            throw new Error('User address is required');
        }

        return await this.getCachedOrFetch('getPortfolioData', [userAddress, instances.join(',')], async () => {
            const [erc404Holdings, erc1155Holdings, vaultPositions, totalClaimable] =
                await this.executeContractCall('getPortfolioData', [userAddress, instances]);

            return {
                erc404Holdings: erc404Holdings.map(h => this._parseERC404Holding(h)),
                erc1155Holdings: erc1155Holdings.map(h => this._parseERC1155Holding(h)),
                vaultPositions: vaultPositions.map(p => this._parseVaultPosition(p)),
                totalClaimable: ethers.utils.formatEther(totalClaimable)
            };
        }, CACHE_TTL.PORTFOLIO);
    }

    /**
     * Get vault leaderboard
     * @param {number} sortBy - 0 = by TVL, 1 = by popularity (instance count)
     * @param {number} limit - Number of vaults to return (max 50)
     * @returns {Promise<Array>} Array of VaultSummary objects
     */
    async getVaultLeaderboard(sortBy = 0, limit = 10) {
        return await this.getCachedOrFetch('getVaultLeaderboard', [sortBy, limit], async () => {
            const vaults = await this.executeContractCall('getVaultLeaderboard', [sortBy, limit]);
            return vaults.map(v => this._parseVaultSummary(v));
        }, CACHE_TTL.VAULT_LEADERBOARD);
    }

    // =========================
    // Parse Methods
    // =========================

    /**
     * Parse ProjectCard from contract response
     * @private
     */
    _parseProjectCard(card) {
        return {
            // Instance core
            instance: card.instance || card[0],
            name: card.name || card[1],
            metadataURI: card.metadataURI || card[2],
            creator: card.creator || card[3],
            registeredAt: this._toNumber(card.registeredAt || card[4]),
            // Factory info
            factory: card.factory || card[5],
            contractType: card.contractType || card[6],
            factoryTitle: card.factoryTitle || card[7],
            // Vault info
            vault: card.vault || card[8],
            vaultName: card.vaultName || card[9],
            // Dynamic data
            currentPrice: ethers.utils.formatEther(card.currentPrice || card[10] || '0'),
            totalSupply: ethers.utils.formatEther(card.totalSupply || card[11] || '0'),
            maxSupply: this._parseMaxSupply(card.maxSupply || card[12]),
            isActive: card.isActive ?? card[13] ?? false,
            extraData: card.extraData || card[14] || '0x',
            // Featured status
            featuredPosition: this._toNumber(card.featuredPosition || card[15]),
            featuredExpires: this._toNumber(card.featuredExpires || card[16])
        };
    }

    /**
     * Parse VaultSummary from contract response
     * @private
     */
    _parseVaultSummary(vault) {
        return {
            vault: vault.vault || vault[0],
            name: vault.name || vault[1],
            tvl: ethers.utils.formatEther(vault.tvl || vault[2] || '0'),
            instanceCount: this._toNumber(vault.instanceCount || vault[3])
        };
    }

    /**
     * Parse ERC404Holding from contract response
     * @private
     */
    _parseERC404Holding(holding) {
        return {
            instance: holding.instance || holding[0],
            name: holding.name || holding[1],
            tokenBalance: ethers.utils.formatEther(holding.tokenBalance || holding[2] || '0'),
            nftBalance: this._toNumber(holding.nftBalance || holding[3]),
            stakedBalance: ethers.utils.formatEther(holding.stakedBalance || holding[4] || '0'),
            pendingRewards: ethers.utils.formatEther(holding.pendingRewards || holding[5] || '0')
        };
    }

    /**
     * Parse ERC1155Holding from contract response
     * @private
     */
    _parseERC1155Holding(holding) {
        const editionIds = (holding.editionIds || holding[2] || []).map(id => this._toNumber(id));
        const balances = (holding.balances || holding[3] || []).map(b => this._toNumber(b));

        return {
            instance: holding.instance || holding[0],
            name: holding.name || holding[1],
            editionIds,
            balances
        };
    }

    /**
     * Parse VaultPosition from contract response
     * @private
     */
    _parseVaultPosition(position) {
        return {
            vault: position.vault || position[0],
            name: position.name || position[1],
            contribution: ethers.utils.formatEther(position.contribution || position[2] || '0'),
            shares: ethers.utils.formatEther(position.shares || position[3] || '0'),
            claimable: ethers.utils.formatEther(position.claimable || position[4] || '0')
        };
    }

    /**
     * Parse GlobalMessage from contract response
     * @private
     */
    _parseGlobalMessage(msg) {
        return {
            instance: msg.instance || msg[0],
            sender: msg.sender || msg[1],
            packedData: (msg.packedData || msg[2] || '0').toString(),
            message: msg.message || msg[3] || ''
        };
    }

    // =========================
    // Helper Methods
    // =========================

    /**
     * Convert BigNumber to number safely
     * @private
     */
    _toNumber(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        if (typeof value === 'string') return parseInt(value, 10);
        if (value._isBigNumber) return value.toNumber();
        return parseInt(value.toString(), 10);
    }

    /**
     * Parse maxSupply (0 means unlimited, represented as null)
     * @private
     */
    _parseMaxSupply(value) {
        const bn = ethers.BigNumber.from(value || '0');
        if (bn.isZero()) {
            return null; // Unlimited
        }
        return ethers.utils.formatEther(bn);
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            maxQueryLimit: 50
        };
    }

    /**
     * Get balance (not applicable for query aggregator)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for query aggregator)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }

    // =========================
    // Read-only Admin Queries
    // =========================

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry address
     */
    async getMasterRegistry() {
        return await this.executeContractCall('masterRegistry');
    }

    /**
     * Get featured queue manager address
     * @returns {Promise<string>} Featured queue manager address
     */
    async getFeaturedQueueManager() {
        return await this.executeContractCall('featuredQueueManager');
    }

    /**
     * Get global message registry address
     * @returns {Promise<string>} Global message registry address
     */
    async getGlobalMessageRegistry() {
        return await this.executeContractCall('globalMessageRegistry');
    }
}

export default QueryAggregatorAdapter;
