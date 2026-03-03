/**
 * ERC721AuctionFactory Adapter
 *
 * Wraps ERC721AuctionFactory contract functionality.
 * Handles auction instance creation and factory configuration.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,    // 1 hour
    DYNAMIC: 5 * 60 * 1000,    // 5 minutes
};

class ERC721AuctionFactoryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC721AuctionFactory', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        try {
            if (this.provider && this.provider.isMock === true) {
                this.initialized = true;
                this.isMock = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }

            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            const abi = await loadABI('ERC721AuctionFactory');
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
            throw this.wrapError(error, 'ERC721AuctionFactoryAdapter initialization failed');
        }
    }

    // ============ Instance Creation ============

    /**
     * Create ERC721 auction instance
     * @param {Object} params - Instance parameters
     * @param {string} params.name - Collection name
     * @param {string} params.symbol - Token symbol
     * @param {string} params.metadataURI - Metadata URI
     * @param {string} params.creator - Creator address
     * @param {string} params.vault - Vault address
     * @param {number} params.lines - Number of parallel auction lines (1-3)
     * @param {number} params.baseDuration - Base auction duration in seconds
     * @param {number} params.timeBuffer - Anti-snipe time buffer in seconds
     * @param {string} params.bidIncrement - Minimum bid increment in wei
     * @param {string} [params.fee] - Creation fee in wei (defaults to instanceCreationFee)
     */
    async createInstance(params) {
        try {
            const {
                name,
                metadataURI,
                creator,
                vault,
                symbol,
                lines = 1,
                baseDuration = 86400,       // 24 hours
                timeBuffer = 300,           // 5 minutes
                bidIncrement = ethers.utils.parseEther('0.01').toString(),
                fee,
            } = params;

            eventBus.emit('transaction:pending', {
                type: 'createInstance',
                contractAddress: this.contractAddress,
                factoryType: 'ERC721Auction'
            });

            const txOptions = {};
            if (fee) {
                txOptions.value = fee;
            } else {
                const creationFee = await this.getInstanceCreationFee();
                txOptions.value = creationFee;
            }

            const receipt = await this.executeContractCall(
                'createInstance',
                [name, metadataURI, creator, vault, symbol, lines, baseDuration, timeBuffer, bidIncrement],
                { requiresSigner: true, txOptions }
            );

            eventBus.emit('transaction:success', {
                type: 'createInstance',
                receipt,
                contractAddress: this.contractAddress,
                factoryType: 'ERC721Auction'
            });

            contractCache.invalidateByPattern('instance', 'factory');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'createInstance',
                error: this.wrapError(error, 'Instance creation failed')
            });
            throw error;
        }
    }

    // ============ Read Methods ============

    async getInstanceCreationFee() {
        return await this.getCachedOrFetch('instanceCreationFee', [], async () => {
            return await this.executeContractCall('instanceCreationFee');
        }, CACHE_TTL.STATIC);
    }

    async getProtocolTreasury() {
        return await this.getCachedOrFetch('protocolTreasury', [], async () => {
            return await this.executeContractCall('protocolTreasury');
        }, CACHE_TTL.STATIC);
    }

    async getCreator() {
        return await this.getCachedOrFetch('creator', [], async () => {
            return await this.executeContractCall('creator');
        }, CACHE_TTL.STATIC);
    }

    async getCreatorFeeBps() {
        return await this.getCachedOrFetch('creatorFeeBps', [], async () => {
            const bps = await this.executeContractCall('creatorFeeBps');
            return parseInt(bps.toString());
        }, CACHE_TTL.STATIC);
    }

    async getAccumulatedCreatorFees() {
        return await this.getCachedOrFetch('accumulatedCreatorFees', [], async () => {
            return await this.executeContractCall('accumulatedCreatorFees');
        }, CACHE_TTL.DYNAMIC);
    }

    async getAccumulatedProtocolFees() {
        return await this.getCachedOrFetch('accumulatedProtocolFees', [], async () => {
            return await this.executeContractCall('accumulatedProtocolFees');
        }, CACHE_TTL.DYNAMIC);
    }

    // ============ Event Indexing ============

    /**
     * Index InstanceCreated events to get all deployed instances
     * @param {number} [fromBlock=0] - Block to start indexing from
     * @returns {Promise<Array>} Array of { instance, creator, name, vault }
     */
    async indexInstanceCreatedEvents(fromBlock = 0) {
        const filter = this.contract.filters.InstanceCreated();
        const events = await this.contract.queryFilter(filter, fromBlock);
        return events.map(e => ({
            instance: e.args.instance,
            creator: e.args.creator,
            name: e.args.name,
            vault: e.args.vault,
            blockNumber: e.blockNumber,
            transactionHash: e.transactionHash,
        }));
    }

    // ============ Metadata ============

    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            factoryType: 'ERC721Auction',
        };
    }

    async getBalance() { return '0'; }
    async getPrice() { return 0; }
}

export default ERC721AuctionFactoryAdapter;
