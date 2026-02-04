/**
 * MasterRegistry Adapter
 *
 * Wraps MasterRegistryV1 contract functionality.
 * Handles factory discovery, vault rankings, featured instances, and rental operations.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (factory list, contract info)
    DYNAMIC: 5 * 60 * 1000,       // 5 minutes (vault rankings, instance stats)
    REALTIME: 30 * 1000,          // 30 seconds (featured instances)
};

class MasterRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'MasterRegistry', ethersProvider, signer);
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
            const abi = await loadABI('MasterRegistryV1');

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
            throw this.wrapError(error, 'MasterRegistryAdapter initialization failed');
        }
    }

    // =========================
    // Factory Discovery Methods
    // =========================

    /**
     * Get total number of registered factories
     * @returns {Promise<number>} Total factory count
     */
    async getTotalFactories() {
        return await this.getCachedOrFetch('getTotalFactories', [], async () => {
            const result = await this.executeContractCall('getTotalFactories');
            return parseInt(result.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get factory information by ID
     * @param {number} factoryId - Factory ID
     * @returns {Promise<Object>} Factory information
     */
    async getFactoryInfo(factoryId) {
        return await this.getCachedOrFetch('getFactoryInfo', [factoryId], async () => {
            const info = await this.executeContractCall('getFactoryInfo', [factoryId]);
            return this._parseFactoryInfo(info);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get factory information by address
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<Object>} Factory information
     */
    async getFactoryInfoByAddress(factoryAddress) {
        return await this.getCachedOrFetch('getFactoryInfoByAddress', [factoryAddress], async () => {
            const info = await this.executeContractCall('getFactoryInfoByAddress', [factoryAddress]);
            return this._parseFactoryInfo(info);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get all factories (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of factory information
     */
    async getFactories(startIndex, endIndex) {
        const total = await this.getTotalFactories();
        const actualEnd = Math.min(endIndex, total);

        // Parallelize factory fetches
        const factoryPromises = [];
        for (let i = startIndex; i < actualEnd; i++) {
            factoryPromises.push(this.getFactoryInfo(i));
        }

        return Promise.all(factoryPromises);
    }

    /**
     * Get factory application details
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<Object>} Application details
     */
    async getFactoryApplication(factoryAddress) {
        return await this.getCachedOrFetch('getFactoryApplication', [factoryAddress], async () => {
            const app = await this.executeContractCall('getFactoryApplication', [factoryAddress]);
            return this._parseApplicationInfo(app);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Parse factory info from contract response
     * @private
     */
    _parseFactoryInfo(info) {
        return {
            factoryAddress: info.factoryAddress || info[0],
            contractType: info.contractType || info[1],
            title: info.title || info[2],
            displayTitle: info.displayTitle || info[3],
            metadataURI: info.metadataURI || info[4],
            features: info.features || info[5] || [],
            isActive: info.isActive !== undefined ? info.isActive : info[6],
            registeredAt: info.registeredAt ? parseInt(info.registeredAt.toString()) : parseInt((info[7] || 0).toString())
        };
    }

    /**
     * Parse application info from contract response
     * @private
     */
    _parseApplicationInfo(app) {
        return {
            applicant: app.applicant || app[0],
            contractAddress: app.contractAddress || app[1],
            contractType: app.contractType || app[2],
            title: app.title || app[3],
            displayTitle: app.displayTitle || app[4],
            metadataURI: app.metadataURI || app[5],
            features: app.features || app[6] || [],
            status: app.status !== undefined ? app.status : app[7],
            submittedAt: app.submittedAt ? parseInt(app.submittedAt.toString()) : parseInt((app[8] || 0).toString()),
            approvalVotes: app.approvalVotes ? parseInt(app.approvalVotes.toString()) : parseInt((app[9] || 0).toString()),
            rejectionVotes: app.rejectionVotes ? parseInt(app.rejectionVotes.toString()) : parseInt((app[10] || 0).toString())
        };
    }

    // =========================
    // Public Constants & State Variables
    // =========================

    /**
     * Get application fee for factory/vault registration
     * @returns {Promise<string>} Application fee in ETH
     */
    async APPLICATION_FEE() {
        return await this.getCachedOrFetch('APPLICATION_FEE', [], async () => {
            const fee = await this.executeContractCall('APPLICATION_FEE');
            return ethers.utils.formatEther(fee);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get cleanup base gas constant
     * @returns {Promise<number>} Base gas for cleanup operations
     */
    async CLEANUP_BASE_GAS() {
        return await this.getCachedOrFetch('CLEANUP_BASE_GAS', [], async () => {
            const gas = await this.executeContractCall('CLEANUP_BASE_GAS');
            return parseInt(gas.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get gas per action constant
     * @returns {Promise<number>} Gas per action
     */
    async GAS_PER_ACTION() {
        return await this.getCachedOrFetch('GAS_PER_ACTION', [], async () => {
            const gas = await this.executeContractCall('GAS_PER_ACTION');
            return parseInt(gas.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get base rental price
     * @returns {Promise<string>} Base rental price in ETH
     */
    async baseRentalPrice() {
        return await this.getCachedOrFetch('baseRentalPrice', [], async () => {
            const price = await this.executeContractCall('baseRentalPrice');
            return ethers.utils.formatEther(price);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get demand multiplier
     * @returns {Promise<number>} Demand multiplier (basis points)
     */
    async demandMultiplier() {
        return await this.getCachedOrFetch('demandMultiplier', [], async () => {
            const multiplier = await this.executeContractCall('demandMultiplier');
            return parseInt(multiplier.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get exec token address
     * @returns {Promise<string>} Exec token contract address
     */
    async execToken() {
        return await this.getCachedOrFetch('execToken', [], async () => {
            return await this.executeContractCall('execToken');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get dictator address
     * @returns {Promise<string>} Dictator address
     */
    async dictator() {
        return await this.getCachedOrFetch('dictator', [], async () => {
            return await this.executeContractCall('dictator');
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get abdication initiated timestamp
     * @returns {Promise<number>} Timestamp when abdication was initiated (0 if not initiated)
     */
    async abdicationInitiatedAt() {
        return await this.getCachedOrFetch('abdicationInitiatedAt', [], async () => {
            const timestamp = await this.executeContractCall('abdicationInitiatedAt');
            return parseInt(timestamp.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get abdication timelock constant
     * @returns {Promise<number>} Abdication timelock in seconds (48 hours)
     */
    async ABDICATION_TIMELOCK() {
        return await this.getCachedOrFetch('ABDICATION_TIMELOCK', [], async () => {
            const timelock = await this.executeContractCall('ABDICATION_TIMELOCK');
            return parseInt(timelock.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get featured queue manager address
     * @returns {Promise<string>} FeaturedQueueManager contract address
     */
    async featuredQueueManager() {
        return await this.getCachedOrFetch('featuredQueueManager', [], async () => {
            return await this.executeContractCall('featuredQueueManager');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get governance module address
     * @returns {Promise<string>} Governance module contract address
     */
    async governanceModule() {
        return await this.getCachedOrFetch('governanceModule', [], async () => {
            return await this.executeContractCall('governanceModule');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault governance module address
     * @returns {Promise<string>} Vault governance module contract address
     */
    async vaultGovernanceModule() {
        return await this.getCachedOrFetch('vaultGovernanceModule', [], async () => {
            return await this.executeContractCall('vaultGovernanceModule');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get max queue size
     * @returns {Promise<number>} Maximum featured queue size
     */
    async maxQueueSize() {
        return await this.getCachedOrFetch('maxQueueSize', [], async () => {
            const size = await this.executeContractCall('maxQueueSize');
            return parseInt(size.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get max rental duration
     * @returns {Promise<number>} Maximum rental duration in seconds
     */
    async maxRentalDuration() {
        return await this.getCachedOrFetch('maxRentalDuration', [], async () => {
            const duration = await this.executeContractCall('maxRentalDuration');
            return parseInt(duration.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get min rental duration
     * @returns {Promise<number>} Minimum rental duration in seconds
     */
    async minRentalDuration() {
        return await this.getCachedOrFetch('minRentalDuration', [], async () => {
            const duration = await this.executeContractCall('minRentalDuration');
            return parseInt(duration.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get renewal discount
     * @returns {Promise<number>} Renewal discount (basis points)
     */
    async renewalDiscount() {
        return await this.getCachedOrFetch('renewalDiscount', [], async () => {
            const discount = await this.executeContractCall('renewalDiscount');
            return parseInt(discount.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get standard cleanup reward
     * @returns {Promise<string>} Standard cleanup reward in ETH
     */
    async standardCleanupReward() {
        return await this.getCachedOrFetch('standardCleanupReward', [], async () => {
            const reward = await this.executeContractCall('standardCleanupReward');
            return ethers.utils.formatEther(reward);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault registration fee
     * @returns {Promise<string>} Vault registration fee in ETH
     */
    async vaultRegistrationFee() {
        return await this.getCachedOrFetch('vaultRegistrationFee', [], async () => {
            const fee = await this.executeContractCall('vaultRegistrationFee');
            return ethers.utils.formatEther(fee);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get visible threshold
     * @returns {Promise<number>} Minimum visibility threshold
     */
    async visibleThreshold() {
        return await this.getCachedOrFetch('visibleThreshold', [], async () => {
            const threshold = await this.executeContractCall('visibleThreshold');
            return parseInt(threshold.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get next factory ID
     * @returns {Promise<number>} Next factory ID to be assigned
     */
    async nextFactoryId() {
        return await this.getCachedOrFetch('nextFactoryId', [], async () => {
            const id = await this.executeContractCall('nextFactoryId');
            return parseInt(id.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get global message registry address
     * @returns {Promise<string>} Global message registry contract address
     */
    async globalMessageRegistry() {
        return await this.getCachedOrFetch('globalMessageRegistry', [], async () => {
            return await this.executeContractCall('globalMessageRegistry');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault registry address
     * @returns {Promise<string>} Vault registry contract address (mapped to itself)
     */
    async vaultRegistry() {
        // This is typically the master registry itself
        return this.contractAddress;
    }

    // =========================
    // Public State Variable Accessors
    // =========================

    /**
     * Get instance by index
     * @param {number} index - Instance index
     * @returns {Promise<string>} Instance address
     */
    async allInstances(index) {
        return await this.getCachedOrFetch('allInstances', [index], async () => {
            return await this.executeContractCall('allInstances', [index]);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get factory address by ID
     * @param {number} factoryId - Factory ID
     * @returns {Promise<string>} Factory address
     */
    async factoryIdToAddress(factoryId) {
        return await this.getCachedOrFetch('factoryIdToAddress', [factoryId], async () => {
            return await this.executeContractCall('factoryIdToAddress', [factoryId]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get featured queue entry
     * @param {number} index - Queue index
     * @returns {Promise<string>} Instance address in featured queue
     */
    async featuredQueue(index) {
        return await this.getCachedOrFetch('featuredQueue', [index], async () => {
            return await this.executeContractCall('featuredQueue', [index]);
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get instance index
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<number>} Instance index
     */
    async instanceIndex(instanceAddress) {
        return await this.getCachedOrFetch('instanceIndex', [instanceAddress], async () => {
            const index = await this.executeContractCall('instanceIndex', [instanceAddress]);
            return parseInt(index.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instance position in featured queue
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<number>} Position in featured queue
     */
    async instancePosition(instanceAddress) {
        return await this.getCachedOrFetch('instancePosition', [instanceAddress], async () => {
            const position = await this.executeContractCall('instancePosition', [instanceAddress]);
            return parseInt(position.toString());
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get name hash registration status
     * @param {string} nameHash - keccak256 hash of name
     * @returns {Promise<boolean>} True if name is registered
     */
    async nameHashes(nameHash) {
        return await this.getCachedOrFetch('nameHashes', [nameHash], async () => {
            return await this.executeContractCall('nameHashes', [nameHash]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get position demand
     * @param {number} position - Position index
     * @returns {Promise<number>} Demand level for position
     */
    async positionDemand(position) {
        return await this.getCachedOrFetch('positionDemand', [position], async () => {
            const demand = await this.executeContractCall('positionDemand', [position]);
            return parseInt(demand.toString());
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get registered factory by index
     * @param {number} index - Factory index
     * @returns {Promise<string>} Factory address
     */
    async registeredFactories(index) {
        return await this.getCachedOrFetch('registeredFactories', [index], async () => {
            return await this.executeContractCall('registeredFactories', [index]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get registered vault by index
     * @param {number} index - Vault index
     * @returns {Promise<string>} Vault address
     */
    async registeredVaults(index) {
        return await this.getCachedOrFetch('registeredVaults', [index], async () => {
            return await this.executeContractCall('registeredVaults', [index]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get renewal deposit for instance
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<string>} Renewal deposit in ETH
     */
    async renewalDeposits(instanceAddress) {
        return await this.getCachedOrFetch('renewalDeposits', [instanceAddress], async () => {
            const deposit = await this.executeContractCall('renewalDeposits', [instanceAddress]);
            return ethers.utils.formatEther(deposit);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get vault instances list
     * @param {string} vaultAddress - Vault address
     * @param {number} index - Index in vault's instance list
     * @returns {Promise<string>} Instance address
     */
    async vaultInstances(vaultAddress, index) {
        return await this.getCachedOrFetch('vaultInstances', [vaultAddress, index], async () => {
            return await this.executeContractCall('vaultInstances', [vaultAddress, index]);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get vault list entry
     * @param {number} index - Vault list index
     * @returns {Promise<string>} Vault address
     */
    async vaultList(index) {
        return await this.getCachedOrFetch('vaultList', [index], async () => {
            return await this.executeContractCall('vaultList', [index]);
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Additional View Functions
    // =========================

    /**
     * Get total number of instances
     * @returns {Promise<number>} Total instance count
     */
    async getTotalInstances() {
        return await this.getCachedOrFetch('getTotalInstances', [], async () => {
            const total = await this.executeContractCall('getTotalInstances');
            return parseInt(total.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get vault list (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of vault addresses
     */
    async getVaultList(startIndex, endIndex) {
        return await this.getCachedOrFetch('getVaultList', [startIndex, endIndex], async () => {
            const vaults = await this.executeContractCall('getVaultList', [startIndex, endIndex]);
            return vaults.map(v => v.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Check if factory is registered
     * @param {string} factoryAddress - Factory address
     * @returns {Promise<boolean>} True if factory is registered
     */
    async isFactoryRegistered(factoryAddress) {
        return await this.getCachedOrFetch('isFactoryRegistered', [factoryAddress], async () => {
            return await this.executeContractCall('isFactoryRegistered', [factoryAddress]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get factory info struct (raw view function)
     * @param {number} factoryId - Factory ID
     * @returns {Promise<Object>} Raw factory info
     */
    async factoryInfo(factoryId) {
        return await this.getCachedOrFetch('factoryInfo', [factoryId], async () => {
            const info = await this.executeContractCall('factoryInfo', [factoryId]);
            return this._parseFactoryInfo(info);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get instance info struct (raw view function)
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<Object>} Raw instance info
     */
    async instanceInfo(instanceAddress) {
        return await this.getCachedOrFetch('instanceInfo', [instanceAddress], async () => {
            const info = await this.executeContractCall('instanceInfo', [instanceAddress]);
            return this._parseInstanceInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get vault info struct (raw view function)
     * @param {string} vaultAddress - Vault address
     * @returns {Promise<Object>} Raw vault info
     */
    async vaultInfo(vaultAddress) {
        return await this.getCachedOrFetch('vaultInfo', [vaultAddress], async () => {
            const info = await this.executeContractCall('vaultInfo', [vaultAddress]);
            return this._parseVaultInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Vault Discovery Methods
    // =========================

    /**
     * Get total number of registered vaults
     * @returns {Promise<number>} Total vault count
     */
    async getTotalVaults() {
        return await this.getCachedOrFetch('getTotalVaults', [], async () => {
            const result = await this.executeContractCall('getTotalVaults');
            return parseInt(result.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault information
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Object>} Vault information
     */
    async getVaultInfo(vaultAddress) {
        return await this.getCachedOrFetch('getVaultInfo', [vaultAddress], async () => {
            const info = await this.executeContractCall('getVaultInfo', [vaultAddress]);
            return this._parseVaultInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get all vaults (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of vault addresses
     */
    async getVaults(startIndex, endIndex) {
        const vaults = await this.executeContractCall('getVaults', [startIndex, endIndex]);
        return vaults.map(v => v.toString());
    }

    /**
     * Get top vaults by TVL
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<Array>} Array of vault info objects sorted by TVL
     */
    async getVaultsByTVL(limit) {
        return await this.getCachedOrFetch('getVaultsByTVL', [limit], async () => {
            // Contract returns: (address[] vaults, uint256[] tvls, string[] names)
            const result = await this.executeContractCall('getVaultsByTVL', [limit]);
            const [vaultAddresses, tvls, names] = result;

            // Combine into vault info objects
            return vaultAddresses.map((addr, index) => ({
                vaultAddress: addr.toString(),
                vaultType: 'ultra-alignment',
                name: names[index] || 'Unnamed Vault',
                tvl: ethers.utils.formatEther(tvls[index] || 0),
                instanceCount: 0, // Not returned by this method
                isActive: true
            }));
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get top vaults by popularity (instance count)
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<Array>} Array of vault info objects sorted by popularity
     */
    async getVaultsByPopularity(limit) {
        return await this.getCachedOrFetch('getVaultsByPopularity', [limit], async () => {
            // Contract returns: (address[] vaults, uint256[] instanceCounts, string[] names)
            const result = await this.executeContractCall('getVaultsByPopularity', [limit]);
            const [vaultAddresses, instanceCounts, names] = result;

            // Combine into vault info objects
            return vaultAddresses.map((addr, index) => ({
                vaultAddress: addr.toString(),
                vaultType: 'ultra-alignment',
                name: names[index] || 'Unnamed Vault',
                tvl: '0', // Not returned by this method
                instanceCount: parseInt((instanceCounts[index] || 0).toString()),
                isActive: true
            }));
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instances using a specific vault
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Array>} Array of instance addresses using this vault
     */
    async getInstancesByVault(vaultAddress) {
        return await this.getCachedOrFetch('getInstancesByVault', [vaultAddress], async () => {
            const instances = await this.executeContractCall('getInstancesByVault', [vaultAddress]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Check if vault is registered
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<boolean>} True if vault is registered
     */
    async isVaultRegistered(vaultAddress) {
        return await this.getCachedOrFetch('isVaultRegistered', [vaultAddress], async () => {
            return await this.executeContractCall('isVaultRegistered', [vaultAddress]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Parse vault info from contract response
     * @private
     */
    _parseVaultInfo(info) {
        return {
            vaultAddress: info.vaultAddress || info[0],
            vaultType: info.vaultType || info[1],
            name: info.name || info[2],
            metadataURI: info.metadataURI || info[3],
            isActive: info.isActive !== undefined ? info.isActive : info[4],
            registeredAt: info.registeredAt ? parseInt(info.registeredAt.toString()) : parseInt((info[5] || 0).toString()),
            instanceCount: info.instanceCount ? parseInt(info.instanceCount.toString()) : parseInt((info[6] || 0).toString()),
            tvl: info.tvl ? ethers.utils.formatEther(info.tvl) : '0'
        };
    }

    // =========================
    // Featured Instance Methods
    // =========================
    // NOTE: Queue-related methods have been moved to FeaturedQueueManager contract
    // These methods are kept for backward compatibility but delegate to FeaturedQueueManager

    /**
     * Get featured instances (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of featured instance addresses
     * @deprecated Use FeaturedQueueManagerAdapter instead (queue functions moved to separate contract)
     */
    async getFeaturedInstances(startIndex, endIndex) {
        return await this.getCachedOrFetch('getFeaturedInstances', [startIndex, endIndex], async () => {
            const instances = await this.executeContractCall('getFeaturedInstances', [startIndex, endIndex]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get instance information
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<Object>} Instance information
     */
    async getInstanceInfo(instanceAddress) {
        return await this.getCachedOrFetch('getInstanceInfo', [instanceAddress], async () => {
            const info = await this.executeContractCall('getInstanceInfo', [instanceAddress]);
            return this._parseInstanceInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instances created by a specific address
     * @param {string} creatorAddress - Creator address
     * @returns {Promise<Array>} Array of instance addresses
     */
    async getCreatorInstances(creatorAddress) {
        return await this.getCachedOrFetch('getCreatorInstances', [creatorAddress], async () => {
            const instances = await this.executeContractCall('getCreatorInstances', [creatorAddress]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Parse instance info from contract response
     * @private
     */
    _parseInstanceInfo(info) {
        return {
            instanceAddress: info.instanceAddress || info[0],
            factoryAddress: info.factoryAddress || info[1],
            creator: info.creator || info[2],
            vault: info.vault || info[3],
            createdAt: info.createdAt ? parseInt(info.createdAt.toString()) : parseInt((info[4] || 0).toString())
        };
    }

    // =========================
    // Featured Position Rental
    // =========================

    /**
     * Get rental price for a position
     * @param {number} position - Position in featured queue (0-based)
     * @returns {Promise<string>} Rental price in ETH
     */
    async getPositionRentalPrice(position) {
        return await this.getCachedOrFetch('getPositionRentalPrice', [position], async () => {
            const price = await this.executeContractCall('getPositionRentalPrice', [position]);
            return ethers.utils.formatEther(price);
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Calculate rental cost
     * @param {number} position - Position in featured queue
     * @param {number} duration - Rental duration in seconds
     * @returns {Promise<string>} Total rental cost in ETH
     */
    async calculateRentalCost(position, duration) {
        const cost = await this.executeContractCall('calculateRentalCost', [position, duration]);
        return ethers.utils.formatEther(cost);
    }

    /**
     * Get rental information for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<Object>} Rental information
     */
    async getRentalInfo(instanceAddress) {
        return await this.getCachedOrFetch('getRentalInfo', [instanceAddress], async () => {
            const info = await this.executeContractCall('getRentalInfo', [instanceAddress]);
            return this._parseRentalInfo(info);
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Rent a featured position
     * @param {string} instanceAddress - Instance to feature
     * @param {number} desiredPosition - Desired position (0-based)
     * @param {number} duration - Rental duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async rentFeaturedPosition(instanceAddress, desiredPosition, duration) {
        try {
            // Calculate required payment
            const cost = await this.calculateRentalCost(desiredPosition, duration);
            const costWei = ethers.utils.parseEther(cost);

            eventBus.emit('transaction:pending', {
                type: 'rentFeaturedPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'rentFeaturedPosition',
                [instanceAddress, desiredPosition, duration],
                {
                    requiresSigner: true,
                    txOptions: { value: costWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'rentFeaturedPosition',
                receipt,
                instanceAddress,
                position: desiredPosition
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'rentFeaturedPosition',
                error: this.wrapError(error, 'Failed to rent featured position')
            });
            throw error;
        }
    }

    /**
     * Renew existing position rental
     * @param {string} instanceAddress - Instance address
     * @param {number} additionalDuration - Additional duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async renewPosition(instanceAddress, additionalDuration) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'renewPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'renewPosition',
                [instanceAddress, additionalDuration],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'renewPosition',
                receipt,
                instanceAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'renewPosition',
                error: this.wrapError(error, 'Failed to renew position')
            });
            throw error;
        }
    }

    /**
     * Bump position (move to better position with additional payment)
     * @param {string} instanceAddress - Instance address
     * @param {number} targetPosition - Target position (0-based)
     * @param {number} additionalDuration - Additional duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async bumpPosition(instanceAddress, targetPosition, additionalDuration) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'bumpPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'bumpPosition',
                [instanceAddress, targetPosition, additionalDuration],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'bumpPosition',
                receipt,
                instanceAddress,
                targetPosition
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'bumpPosition',
                error: this.wrapError(error, 'Failed to bump position')
            });
            throw error;
        }
    }

    /**
     * Deposit ETH for auto-renewal
     * @param {string} instanceAddress - Instance address
     * @param {string} amount - Amount in ETH
     * @returns {Promise<Object>} Transaction receipt
     */
    async depositForAutoRenewal(instanceAddress, amount) {
        try {
            const amountWei = ethers.utils.parseEther(amount);

            eventBus.emit('transaction:pending', {
                type: 'depositForAutoRenewal',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'depositForAutoRenewal',
                [instanceAddress],
                {
                    requiresSigner: true,
                    txOptions: { value: amountWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'depositForAutoRenewal',
                receipt,
                instanceAddress,
                amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'depositForAutoRenewal',
                error: this.wrapError(error, 'Failed to deposit for auto-renewal')
            });
            throw error;
        }
    }

    /**
     * Withdraw auto-renewal deposit
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<Object>} Transaction receipt
     */
    async withdrawRenewalDeposit(instanceAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'withdrawRenewalDeposit',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'withdrawRenewalDeposit',
                [instanceAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'withdrawRenewalDeposit',
                receipt,
                instanceAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'withdrawRenewalDeposit',
                error: this.wrapError(error, 'Failed to withdraw renewal deposit')
            });
            throw error;
        }
    }

    /**
     * Parse rental info from contract response
     * @private
     */
    _parseRentalInfo(info) {
        return {
            position: info.position !== undefined ? parseInt(info.position.toString()) : parseInt((info[0] || 0).toString()),
            expiresAt: info.expiresAt ? parseInt(info.expiresAt.toString()) : parseInt((info[1] || 0).toString()),
            autoRenewalDeposit: info.autoRenewalDeposit ? ethers.utils.formatEther(info.autoRenewalDeposit) : '0',
            isActive: info.isActive !== undefined ? info.isActive : info[3]
        };
    }

    // =========================
    // Cleanup Operations
    // =========================

    /**
     * Cleanup expired rentals (permissionless, incentivized)
     * @param {number} maxCleanup - Maximum number of rentals to cleanup
     * @returns {Promise<Object>} Transaction receipt
     */
    async cleanupExpiredRentals(maxCleanup) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'cleanupExpiredRentals',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'cleanupExpiredRentals',
                [maxCleanup],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'cleanupExpiredRentals',
                receipt,
                maxCleanup
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'cleanupExpiredRentals',
                error: this.wrapError(error, 'Failed to cleanup expired rentals')
            });
            throw error;
        }
    }

    /**
     * Get queue utilization
     * @returns {Promise<Object>} Queue utilization metrics
     */
    async getQueueUtilization() {
        return await this.getCachedOrFetch('getQueueUtilization', [], async () => {
            const util = await this.executeContractCall('getQueueUtilization');
            return {
                totalSlots: parseInt(util.totalSlots?.toString() || util[0]?.toString() || '0'),
                occupiedSlots: parseInt(util.occupiedSlots?.toString() || util[1]?.toString() || '0'),
                utilizationPercent: parseFloat(util.utilizationPercent?.toString() || util[2]?.toString() || '0') / 100
            };
        }, CACHE_TTL.REALTIME);
    }

    // =========================
    // Registration & Admin Functions
    // =========================

    /**
     * Register a new factory (admin only)
     * @param {string} factoryAddress - Factory contract address
     * @param {string} contractType - Contract type string
     * @param {string} title - Factory title
     * @param {string} displayTitle - Display-friendly title
     * @param {string} metadataURI - Metadata URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerFactory(factoryAddress, contractType, title, displayTitle, metadataURI) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'registerFactory',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerFactory',
                [factoryAddress, contractType, title, displayTitle, metadataURI],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerFactory',
                receipt,
                factoryAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalFactories', 'getFactoryInfo', 'isFactoryRegistered');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerFactory',
                error: this.wrapError(error, 'Failed to register factory')
            });
            throw error;
        }
    }

    /**
     * Register a factory with features (admin only)
     * @param {string} factoryAddress - Factory contract address
     * @param {string} contractType - Contract type string
     * @param {string} title - Factory title
     * @param {string} displayTitle - Display-friendly title
     * @param {string} metadataURI - Metadata URI
     * @param {Array<string>} features - Feature identifiers
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerFactoryWithFeatures(factoryAddress, contractType, title, displayTitle, metadataURI, features) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'registerFactoryWithFeatures',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerFactoryWithFeatures',
                [factoryAddress, contractType, title, displayTitle, metadataURI, features],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerFactoryWithFeatures',
                receipt,
                factoryAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalFactories', 'getFactoryInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerFactoryWithFeatures',
                error: this.wrapError(error, 'Failed to register factory with features')
            });
            throw error;
        }
    }

    /**
     * Register a factory with features and explicit creator (admin only)
     * @param {string} factoryAddress - Factory contract address
     * @param {string} contractType - Contract type string
     * @param {string} title - Factory title
     * @param {string} displayTitle - Display-friendly title
     * @param {string} metadataURI - Metadata URI
     * @param {Array<string>} features - Feature identifiers
     * @param {string} creator - Creator address
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerFactoryWithFeaturesAndCreator(factoryAddress, contractType, title, displayTitle, metadataURI, features, creator) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'registerFactoryWithFeaturesAndCreator',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerFactoryWithFeaturesAndCreator',
                [factoryAddress, contractType, title, displayTitle, metadataURI, features, creator],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerFactoryWithFeaturesAndCreator',
                receipt,
                factoryAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalFactories', 'getFactoryInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerFactoryWithFeaturesAndCreator',
                error: this.wrapError(error, 'Failed to register factory with features and creator')
            });
            throw error;
        }
    }

    /**
     * Register a new instance (called by factories)
     * @param {string} instanceAddress - Instance contract address
     * @param {string} factoryAddress - Factory that created this instance
     * @param {string} creator - Creator address
     * @param {string} vault - Vault address
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerInstance(instanceAddress, factoryAddress, creator, vault) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'registerInstance',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerInstance',
                [instanceAddress, factoryAddress, creator, vault],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerInstance',
                receipt,
                instanceAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalInstances', 'getInstanceInfo', 'getCreatorInstances');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerInstance',
                error: this.wrapError(error, 'Failed to register instance')
            });
            throw error;
        }
    }

    /**
     * Register an approved vault (admin only)
     * @param {string} vaultAddress - Vault contract address
     * @param {string} vaultType - Vault type string
     * @param {string} name - Vault name
     * @param {string} metadataURI - Metadata URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerApprovedVault(vaultAddress, vaultType, name, metadataURI) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'registerApprovedVault',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerApprovedVault',
                [vaultAddress, vaultType, name, metadataURI],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'registerApprovedVault',
                receipt,
                vaultAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalVaults', 'getVaultInfo', 'isVaultRegistered');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerApprovedVault',
                error: this.wrapError(error, 'Failed to register approved vault')
            });
            throw error;
        }
    }

    /**
     * Deactivate a vault (admin only)
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async deactivateVault(vaultAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'deactivateVault',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'deactivateVault',
                [vaultAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'deactivateVault',
                receipt,
                vaultAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getVaultInfo', 'getVaults');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'deactivateVault',
                error: this.wrapError(error, 'Failed to deactivate vault')
            });
            throw error;
        }
    }

    /**
     * Set global message registry address (admin only)
     * @param {string} registryAddress - Global message registry contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setGlobalMessageRegistry(registryAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setGlobalMessageRegistry',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setGlobalMessageRegistry',
                [registryAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setGlobalMessageRegistry',
                receipt,
                registryAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('globalMessageRegistry');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setGlobalMessageRegistry',
                error: this.wrapError(error, 'Failed to set global message registry')
            });
            throw error;
        }
    }

    /**
     * Set standard cleanup reward (admin only)
     * @param {string} reward - Reward amount in ETH
     * @returns {Promise<Object>} Transaction receipt
     */
    async setStandardCleanupReward(reward) {
        try {
            const rewardWei = ethers.utils.parseEther(reward);

            eventBus.emit('transaction:pending', {
                type: 'setStandardCleanupReward',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setStandardCleanupReward',
                [rewardWei],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setStandardCleanupReward',
                receipt,
                reward
            });

            // Invalidate cache
            contractCache.invalidateByPattern('standardCleanupReward');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setStandardCleanupReward',
                error: this.wrapError(error, 'Failed to set standard cleanup reward')
            });
            throw error;
        }
    }

    /**
     * Set vault governance module (admin only)
     * @param {string} moduleAddress - Vault governance module contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setVaultGovernanceModule(moduleAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setVaultGovernanceModule',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setVaultGovernanceModule',
                [moduleAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setVaultGovernanceModule',
                receipt,
                moduleAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('vaultGovernanceModule');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setVaultGovernanceModule',
                error: this.wrapError(error, 'Failed to set vault governance module')
            });
            throw error;
        }
    }

    /**
     * Set featured queue manager address (admin only)
     * @param {string} managerAddress - FeaturedQueueManager contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setFeaturedQueueManager(managerAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setFeaturedQueueManager',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setFeaturedQueueManager',
                [managerAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setFeaturedQueueManager',
                receipt,
                managerAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('featuredQueueManager');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setFeaturedQueueManager',
                error: this.wrapError(error, 'Failed to set featured queue manager')
            });
            throw error;
        }
    }

    // =========================
    // Dictator Governance Functions
    // =========================

    /**
     * Initiate abdication process (dictator only, 48-hour timelock)
     * @returns {Promise<Object>} Transaction receipt
     */
    async initiateAbdication() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'initiateAbdication',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'initiateAbdication',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'initiateAbdication',
                receipt
            });

            // Invalidate cache
            contractCache.invalidateByPattern('abdicationInitiatedAt', 'dictator');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'initiateAbdication',
                error: this.wrapError(error, 'Failed to initiate abdication')
            });
            throw error;
        }
    }

    /**
     * Cancel abdication process (dictator only, during 48-hour timelock)
     * @returns {Promise<Object>} Transaction receipt
     */
    async cancelAbdication() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'cancelAbdication',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'cancelAbdication',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'cancelAbdication',
                receipt
            });

            // Invalidate cache
            contractCache.invalidateByPattern('abdicationInitiatedAt');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'cancelAbdication',
                error: this.wrapError(error, 'Failed to cancel abdication')
            });
            throw error;
        }
    }

    /**
     * Finalize abdication and transfer power to governance (dictator only, after 48-hour timelock)
     * @returns {Promise<Object>} Transaction receipt
     */
    async finalizeAbdication() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'finalizeAbdication',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'finalizeAbdication',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'finalizeAbdication',
                receipt
            });

            // Invalidate cache
            contractCache.invalidateByPattern('dictator', 'abdicationInitiatedAt');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'finalizeAbdication',
                error: this.wrapError(error, 'Failed to finalize abdication')
            });
            throw error;
        }
    }

    // =========================
    // Application Functions (Governance Flow)
    // =========================

    /**
     * Apply for factory registration (requires fee)
     * @param {string} factoryAddress - Factory contract address
     * @param {string} contractType - Contract type string
     * @param {string} title - Factory title
     * @param {string} displayTitle - Display-friendly title
     * @param {string} metadataURI - Metadata URI
     * @param {Array<string>} features - Feature identifiers
     * @returns {Promise<Object>} Transaction receipt
     */
    async applyForFactory(factoryAddress, contractType, title, displayTitle, metadataURI, features) {
        try {
            // Get application fee
            const fee = await this.APPLICATION_FEE();
            const feeWei = ethers.utils.parseEther(fee);

            eventBus.emit('transaction:pending', {
                type: 'applyForFactory',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'applyForFactory',
                [factoryAddress, contractType, title, displayTitle, metadataURI, features],
                {
                    requiresSigner: true,
                    txOptions: { value: feeWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'applyForFactory',
                receipt,
                factoryAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFactoryApplication');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'applyForFactory',
                error: this.wrapError(error, 'Failed to apply for factory')
            });
            throw error;
        }
    }

    /**
     * Apply for vault registration (requires fee)
     * @param {string} vaultAddress - Vault contract address
     * @param {string} vaultType - Vault type string
     * @param {string} name - Vault name
     * @param {string} metadataURI - Metadata URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async applyForVault(vaultAddress, vaultType, name, metadataURI) {
        try {
            // Get vault registration fee
            const fee = await this.vaultRegistrationFee();
            const feeWei = ethers.utils.parseEther(fee);

            eventBus.emit('transaction:pending', {
                type: 'applyForVault',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'applyForVault',
                [vaultAddress, vaultType, name, metadataURI],
                {
                    requiresSigner: true,
                    txOptions: { value: feeWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'applyForVault',
                receipt,
                vaultAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'applyForVault',
                error: this.wrapError(error, 'Failed to apply for vault')
            });
            throw error;
        }
    }

    /**
     * Register vault (permissionless, requires fee)
     * @param {string} vaultAddress - Vault contract address
     * @param {string} vaultType - Vault type string
     * @param {string} name - Vault name
     * @param {string} metadataURI - Metadata URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerVault(vaultAddress, vaultType, name, metadataURI) {
        try {
            // Get vault registration fee
            const fee = await this.vaultRegistrationFee();
            const feeWei = ethers.utils.parseEther(fee);

            eventBus.emit('transaction:pending', {
                type: 'registerVault',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'registerVault',
                [vaultAddress, vaultType, name, metadataURI],
                {
                    requiresSigner: true,
                    txOptions: { value: feeWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'registerVault',
                receipt,
                vaultAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getTotalVaults', 'getVaultInfo', 'isVaultRegistered');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'registerVault',
                error: this.wrapError(error, 'Failed to register vault')
            });
            throw error;
        }
    }

    /**
     * Get GlobalMessageRegistry address
     * @returns {Promise<string>} GlobalMessageRegistry contract address
     */
    async getGlobalMessageRegistry() {
        return await this.getCachedOrFetch('getGlobalMessageRegistry', [], async () => {
            return await this.executeContractCall('getGlobalMessageRegistry');
        }, CACHE_TTL.STATIC);
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
            totalFactories: await this.getTotalFactories(),
            totalVaults: await this.getTotalVaults()
        };
    }

    /**
     * Get balance (not applicable for registry)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for registry)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default MasterRegistryAdapter;
