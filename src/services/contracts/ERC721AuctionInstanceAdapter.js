/**
 * ERC721 Auction Instance Adapter
 *
 * Wraps ERC721AuctionInstance contract for use with ProjectService.
 * Handles auctions, bidding, settlement, and event indexing.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,    // 1 hour (config, name, symbol)
    DYNAMIC: 30 * 1000,        // 30 seconds (auction state, bids)
    REALTIME: 10 * 1000,       // 10 seconds (active auctions)
};

class ERC721AuctionInstanceAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC721Auction', ethersProvider, signer);
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

            const abi = await loadABI('ERC721AuctionInstance');
            const providerToUse = this.signer || this.provider;

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
            throw this.wrapError(error, 'ERC721AuctionInstanceAdapter initialization failed');
        }
    }

    // ============ Read Methods (Config) ============

    async getName() {
        return await this.getCachedOrFetch('name', [], async () => {
            return await this.executeContractCall('name');
        }, CACHE_TTL.STATIC);
    }

    async getSymbol() {
        return await this.getCachedOrFetch('symbol', [], async () => {
            return await this.executeContractCall('symbol');
        }, CACHE_TTL.STATIC);
    }

    async getLines() {
        return await this.getCachedOrFetch('lines', [], async () => {
            const lines = await this.executeContractCall('lines');
            return parseInt(lines.toString());
        }, CACHE_TTL.STATIC);
    }

    async getBaseDuration() {
        return await this.getCachedOrFetch('baseDuration', [], async () => {
            const duration = await this.executeContractCall('baseDuration');
            return parseInt(duration.toString());
        }, CACHE_TTL.STATIC);
    }

    async getTimeBuffer() {
        return await this.getCachedOrFetch('timeBuffer', [], async () => {
            const buffer = await this.executeContractCall('timeBuffer');
            return parseInt(buffer.toString());
        }, CACHE_TTL.STATIC);
    }

    async getBidIncrement() {
        return await this.getCachedOrFetch('bidIncrement', [], async () => {
            return await this.executeContractCall('bidIncrement');
        }, CACHE_TTL.STATIC);
    }

    async getNextTokenId() {
        return await this.getCachedOrFetch('nextTokenId', [], async () => {
            const id = await this.executeContractCall('nextTokenId');
            return parseInt(id.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    async getVault() {
        return await this.getCachedOrFetch('vault', [], async () => {
            return await this.executeContractCall('vault');
        }, CACHE_TTL.STATIC);
    }

    async getOwner() {
        return await this.getCachedOrFetch('owner', [], async () => {
            return await this.executeContractCall('owner');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get all immutable auction config in one call
     */
    async getConfig() {
        const [lines, baseDuration, timeBuffer, bidIncrement] = await Promise.all([
            this.getLines(),
            this.getBaseDuration(),
            this.getTimeBuffer(),
            this.getBidIncrement()
        ]);
        return { lines, baseDuration, timeBuffer, bidIncrement };
    }

    // ============ Auction State ============

    /**
     * Get auction details for a token
     * @param {number} tokenId
     * @returns {Promise<Object>} Auction struct
     */
    async getAuction(tokenId) {
        return await this.getCachedOrFetch('getAuction', [tokenId], async () => {
            const auction = await this.executeContractCall('getAuction', [tokenId]);
            return this._parseAuction(auction);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get active auction token ID for a given line
     * @param {number} line - Line index (0-based)
     * @returns {Promise<number>} Active token ID (0 if none)
     */
    async getActiveAuction(line) {
        return await this.getCachedOrFetch('getActiveAuction', [line], async () => {
            const tokenId = await this.executeContractCall('getActiveAuction', [line]);
            return parseInt(tokenId.toString());
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get queue length for a line
     * @param {number} line - Line index (0-based)
     * @returns {Promise<number>}
     */
    async getQueueLength(line) {
        return await this.getCachedOrFetch('getQueueLength', [line], async () => {
            const len = await this.executeContractCall('getQueueLength', [line]);
            return parseInt(len.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get all active auctions across all lines
     * @returns {Promise<Array<Object>>} Array of { line, tokenId, auction }
     */
    async getAllActiveAuctions() {
        const lines = await this.getLines();
        const results = [];

        for (let i = 0; i < lines; i++) {
            const tokenId = await this.getActiveAuction(i);
            if (tokenId > 0) {
                const auction = await this.getAuction(tokenId);
                results.push({ line: i, tokenId, auction });
            }
        }

        return results;
    }

    /**
     * Get all past auctions (settled or unsold)
     * @returns {Promise<Array<Object>>} Array of auction objects, newest first
     */
    async getPastAuctions() {
        const nextId = await this.getNextTokenId();
        const activeIds = new Set();

        // Get active auction IDs to exclude
        const lines = await this.getLines();
        for (let i = 0; i < lines; i++) {
            const activeId = await this.getActiveAuction(i);
            if (activeId > 0) activeIds.add(activeId);
        }

        const past = [];
        for (let id = nextId - 1; id >= 1; id--) {
            if (activeIds.has(id)) continue;
            try {
                const auction = await this.getAuction(id);
                if (auction.settled) {
                    past.push(auction);
                }
            } catch (e) {
                // Token may not exist
            }
        }

        return past;
    }

    // ============ Write Methods ============

    /**
     * Place a bid on an active auction
     * @param {number} tokenId
     * @param {string} bidAmountWei - Bid amount in wei
     * @param {Uint8Array|null} messageData - Optional packed message data
     */
    async createBid(tokenId, bidAmountWei, messageData = null) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'createBid',
                contractAddress: this.contractAddress,
                tokenId
            });

            const args = [tokenId, messageData || '0x'];
            const receipt = await this.executeContractCall('createBid', args, {
                requiresSigner: true,
                txOptions: { value: bidAmountWei }
            });

            eventBus.emit('transaction:success', {
                type: 'createBid',
                receipt,
                contractAddress: this.contractAddress,
                tokenId
            });

            // Invalidate auction cache
            contractCache.invalidateByPattern('getAuction', 'getActiveAuction');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'createBid',
                error: this.wrapError(error, 'Bid placement failed')
            });
            throw error;
        }
    }

    /**
     * Settle a completed auction (anyone can call)
     * @param {number} tokenId
     */
    async settleAuction(tokenId) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'settleAuction',
                contractAddress: this.contractAddress,
                tokenId
            });

            const receipt = await this.executeContractCall('settleAuction', [tokenId], {
                requiresSigner: true
            });

            eventBus.emit('transaction:success', {
                type: 'settleAuction',
                receipt,
                contractAddress: this.contractAddress,
                tokenId
            });

            contractCache.invalidateByPattern('getAuction', 'getActiveAuction', 'nextTokenId');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'settleAuction',
                error: this.wrapError(error, 'Auction settlement failed')
            });
            throw error;
        }
    }

    /**
     * Reclaim an unsold piece (owner only)
     * @param {number} tokenId
     */
    async reclaimUnsold(tokenId) {
        try {
            const receipt = await this.executeContractCall('reclaimUnsold', [tokenId], {
                requiresSigner: true
            });

            contractCache.invalidateByPattern('getAuction', 'getActiveAuction');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Reclaim unsold failed');
        }
    }

    // ============ Event Indexing ============

    /**
     * Index BidPlaced events for a specific auction
     * @param {number} tokenId
     * @returns {Promise<Array<Object>>} Array of { bidder, amount, blockNumber, timestamp }
     */
    async getBidHistory(tokenId) {
        if (!this.contract) return [];

        try {
            const filter = this.contract.filters.BidPlaced(tokenId);
            const events = await this.contract.queryFilter(filter);

            const bids = await Promise.all(events.map(async (e) => {
                let timestamp = null;
                try {
                    const block = await e.getBlock();
                    timestamp = block.timestamp;
                } catch (err) {
                    // Block timestamp unavailable
                }

                return {
                    bidder: e.args.bidder,
                    amount: e.args.amount,
                    blockNumber: e.blockNumber,
                    transactionHash: e.transactionHash,
                    timestamp
                };
            }));

            // Most recent first
            return bids.reverse();
        } catch (error) {
            console.error('[ERC721AuctionAdapter] Failed to index BidPlaced events:', error);
            return [];
        }
    }

    /**
     * Index AuctionSettled events
     * @returns {Promise<Array<Object>>}
     */
    async getSettlementHistory() {
        if (!this.contract) return [];

        try {
            const filter = this.contract.filters.AuctionSettled();
            const events = await this.contract.queryFilter(filter);

            return events.map(e => ({
                tokenId: parseInt(e.args.tokenId.toString()),
                winner: e.args.winner,
                amount: e.args.amount,
                blockNumber: e.blockNumber,
                transactionHash: e.transactionHash
            })).reverse();
        } catch (error) {
            console.error('[ERC721AuctionAdapter] Failed to index AuctionSettled events:', error);
            return [];
        }
    }

    // ============ Helpers ============

    _parseAuction(auction) {
        // Handle both tuple and struct return formats
        return {
            tokenId: parseInt((auction.tokenId || auction[0]).toString()),
            tokenURI: auction.tokenURI || auction[1],
            minBid: auction.minBid || auction[2],
            highBidder: auction.highBidder || auction[3],
            highBid: auction.highBid || auction[4],
            startTime: parseInt((auction.startTime || auction[5]).toString()),
            endTime: parseInt((auction.endTime || auction[6]).toString()),
            settled: auction.settled !== undefined ? auction.settled : auction[7]
        };
    }

    /**
     * Format duration seconds into human-readable string
     * @param {number} seconds
     * @returns {string}
     */
    formatDuration(seconds) {
        if (seconds >= 86400) {
            const days = seconds / 86400;
            return days === 1 ? '24h' : `${days}d`;
        }
        if (seconds >= 3600) {
            const hours = seconds / 3600;
            return `${hours}h`;
        }
        const minutes = seconds / 60;
        return `${minutes}m`;
    }

    // ============ Required Base Methods ============

    async getBalance(address) {
        if (!this.contract) return '0';
        try {
            const balance = await this.executeContractCall('balanceOf', [address]);
            return balance.toString();
        } catch {
            return '0';
        }
    }

    async getPrice() {
        return 0;
    }

    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            instanceType: 'ERC721Auction',
        };
    }
}

export default ERC721AuctionInstanceAdapter;
