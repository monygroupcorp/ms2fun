/**
 * GovernanceEventIndexer
 *
 * Indexes GrandCentral events and caches results in localStorage.
 * Provides fast access to proposals, votes, share changes, and treasury events
 * without requiring repeated RPC calls.
 *
 * Uses block number tracking for incremental indexing.
 */

import { eventBus } from '../core/EventBus.js';

const CACHE_KEY = 'ms2fun-governance-index';
const BATCH_SIZE = 5000; // Max blocks per queryFilter call

class GovernanceEventIndexer {
    constructor() {
        this.lastIndexedBlock = 0;
        this.proposals = new Map();      // id => proposal data from events
        this.votes = new Map();          // proposalId => [{ voter, approved, shares, blockNumber }]
        this.shareEvents = [];           // [{ type, addresses, amounts, blockNumber }]
        this.treasuryEvents = [];        // [{ type, amount, blockNumber, ... }]
        this.adapter = null;
        this.initialized = false;
    }

    /**
     * Initialize the indexer: load from cache, then index new events
     * @param {Object} adapter - GrandCentralAdapter instance
     */
    async initialize(adapter) {
        this.adapter = adapter;
        this._loadFromCache();

        try {
            await this.indexNewEvents();
            this.initialized = true;
            eventBus.emit('governance:indexer:ready');
        } catch (error) {
            console.error('[GovernanceEventIndexer] Initial indexing failed:', error);
            // Still mark as initialized — cached data may be available
            this.initialized = true;
        }
    }

    /**
     * Index events from last indexed block to current block
     */
    async indexNewEvents() {
        if (!this.adapter || !this.adapter.contract) {
            console.warn('[GovernanceEventIndexer] No adapter or contract available');
            return;
        }

        const provider = this.adapter.contract.provider;
        const currentBlock = await provider.getBlockNumber();

        if (currentBlock <= this.lastIndexedBlock) return;

        const fromBlock = this.lastIndexedBlock > 0 ? this.lastIndexedBlock + 1 : 0;
        await this._indexRange(fromBlock, currentBlock);

        this.lastIndexedBlock = currentBlock;
        this._saveToCache();
    }

    /**
     * Index a range of blocks, batching to avoid RPC limits
     * @private
     */
    async _indexRange(fromBlock, toBlock) {
        const contract = this.adapter.contract;

        for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
            const end = Math.min(start + BATCH_SIZE - 1, toBlock);

            // Query all event types in parallel for this batch
            const [
                submittedEvents,
                sponsoredEvents,
                voteCastEvents,
                processedEvents,
                cancelledEvents,
                sharesMintedEvents,
                sharesBurnedEvents,
                lootMintedEvents,
                lootBurnedEvents,
                ragequitPoolEvents,
                ragequitEvents,
                claimsPoolEvents,
                claimWithdrawnEvents,
            ] = await Promise.all([
                this._safeQuery(contract, 'ProposalSubmitted', start, end),
                this._safeQuery(contract, 'ProposalSponsored', start, end),
                this._safeQuery(contract, 'VoteCast', start, end),
                this._safeQuery(contract, 'ProposalProcessed', start, end),
                this._safeQuery(contract, 'ProposalCancelled', start, end),
                this._safeQuery(contract, 'SharesMinted', start, end),
                this._safeQuery(contract, 'SharesBurned', start, end),
                this._safeQuery(contract, 'LootMinted', start, end),
                this._safeQuery(contract, 'LootBurned', start, end),
                this._safeQuery(contract, 'RagequitPoolFunded', start, end),
                this._safeQuery(contract, 'Ragequit', start, end),
                this._safeQuery(contract, 'ClaimsPoolFunded', start, end),
                this._safeQuery(contract, 'ClaimWithdrawn', start, end),
            ]);

            // Process proposal events
            for (const e of submittedEvents) {
                const id = parseInt(e.args.proposalId.toString());
                this.proposals.set(id, {
                    id,
                    proposer: e.args.proposer,
                    details: e.args.details || '',
                    blockNumber: e.blockNumber,
                    transactionHash: e.transactionHash,
                    sponsored: false,
                    processed: false,
                    cancelled: false,
                });
            }

            for (const e of sponsoredEvents) {
                const id = parseInt(e.args.proposalId.toString());
                const proposal = this.proposals.get(id);
                if (proposal) {
                    proposal.sponsored = true;
                    proposal.sponsor = e.args.sponsor;
                    proposal.sponsorBlock = e.blockNumber;
                }
            }

            for (const e of processedEvents) {
                const id = parseInt(e.args.proposalId.toString());
                const proposal = this.proposals.get(id);
                if (proposal) {
                    proposal.processed = true;
                    proposal.didPass = e.args.didPass;
                    proposal.processedBlock = e.blockNumber;
                }
            }

            for (const e of cancelledEvents) {
                const id = parseInt(e.args.proposalId.toString());
                const proposal = this.proposals.get(id);
                if (proposal) {
                    proposal.cancelled = true;
                    proposal.cancelledBlock = e.blockNumber;
                }
            }

            // Process vote events
            for (const e of voteCastEvents) {
                const proposalId = parseInt(e.args.proposalId.toString());
                if (!this.votes.has(proposalId)) {
                    this.votes.set(proposalId, []);
                }
                this.votes.get(proposalId).push({
                    voter: e.args.voter,
                    approved: e.args.approved,
                    shares: e.args.shares?.toString() || '0',
                    blockNumber: e.blockNumber,
                });
            }

            // Process share events
            for (const e of sharesMintedEvents) {
                this.shareEvents.push({
                    type: 'SharesMinted',
                    addresses: e.args.to || [],
                    amounts: (e.args.amounts || []).map(a => a.toString()),
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of sharesBurnedEvents) {
                this.shareEvents.push({
                    type: 'SharesBurned',
                    addresses: e.args.from || [],
                    amounts: (e.args.amounts || []).map(a => a.toString()),
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of lootMintedEvents) {
                this.shareEvents.push({
                    type: 'LootMinted',
                    addresses: e.args.to || [],
                    amounts: (e.args.amounts || []).map(a => a.toString()),
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of lootBurnedEvents) {
                this.shareEvents.push({
                    type: 'LootBurned',
                    addresses: e.args.from || [],
                    amounts: (e.args.amounts || []).map(a => a.toString()),
                    blockNumber: e.blockNumber,
                });
            }

            // Process treasury events
            for (const e of ragequitPoolEvents) {
                this.treasuryEvents.push({
                    type: 'RagequitPoolFunded',
                    amount: e.args.amount?.toString() || '0',
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of ragequitEvents) {
                this.treasuryEvents.push({
                    type: 'Ragequit',
                    member: e.args.member,
                    sharesToBurn: e.args.sharesToBurn?.toString() || '0',
                    lootToBurn: e.args.lootToBurn?.toString() || '0',
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of claimsPoolEvents) {
                this.treasuryEvents.push({
                    type: 'ClaimsPoolFunded',
                    amount: e.args.amount?.toString() || '0',
                    blockNumber: e.blockNumber,
                });
            }

            for (const e of claimWithdrawnEvents) {
                this.treasuryEvents.push({
                    type: 'ClaimWithdrawn',
                    member: e.args.member,
                    amount: e.args.amount?.toString() || '0',
                    blockNumber: e.blockNumber,
                });
            }
        }
    }

    /**
     * Safely query events, returning empty array on failure
     * @private
     */
    async _safeQuery(contract, eventName, fromBlock, toBlock) {
        try {
            const filter = contract.filters[eventName]();
            return await contract.queryFilter(filter, fromBlock, toBlock);
        } catch (error) {
            console.warn(`[GovernanceEventIndexer] Failed to query ${eventName}:`, error.message);
            return [];
        }
    }

    // ============ Query Methods ============

    /**
     * Get proposals with optional filter
     * @param {Object} [filter] - Filter options
     * @param {string} [filter.status] - 'active', 'passed', 'defeated', 'cancelled', 'all'
     * @returns {Array} Sorted proposals (newest first)
     */
    getProposals(filter = {}) {
        let proposals = Array.from(this.proposals.values());

        if (filter.status && filter.status !== 'all') {
            proposals = proposals.filter(p => {
                switch (filter.status) {
                    case 'active': return !p.processed && !p.cancelled;
                    case 'passed': return p.processed && p.didPass;
                    case 'defeated': return p.processed && !p.didPass;
                    case 'cancelled': return p.cancelled;
                    default: return true;
                }
            });
        }

        return proposals.sort((a, b) => b.id - a.id);
    }

    /**
     * Get a single proposal with its votes
     * @param {number} id - Proposal ID
     * @returns {Object|null} Proposal with votes array
     */
    getProposal(id) {
        const proposal = this.proposals.get(id);
        if (!proposal) return null;

        return {
            ...proposal,
            votes: this.votes.get(id) || [],
        };
    }

    /**
     * Get votes for a proposal
     * @param {number} proposalId - Proposal ID
     * @returns {Array} Vote records
     */
    getVotes(proposalId) {
        return this.votes.get(proposalId) || [];
    }

    /**
     * Get member data from events
     * @param {string} address - Member address
     * @returns {Object} Member event data
     */
    getMemberData(address) {
        const addr = address.toLowerCase();

        // Collect votes by this member
        const memberVotes = [];
        for (const [proposalId, votes] of this.votes.entries()) {
            for (const vote of votes) {
                if (vote.voter.toLowerCase() === addr) {
                    memberVotes.push({ proposalId, ...vote });
                }
            }
        }

        // Collect share events involving this member
        const memberShareEvents = this.shareEvents.filter(e => {
            const addresses = (e.addresses || []).map(a => a.toLowerCase());
            return addresses.includes(addr);
        });

        // Collect treasury events for this member
        const memberTreasuryEvents = this.treasuryEvents.filter(e => {
            return e.member && e.member.toLowerCase() === addr;
        });

        return {
            votes: memberVotes,
            shareEvents: memberShareEvents,
            treasuryEvents: memberTreasuryEvents,
        };
    }

    /**
     * Get recent treasury events
     * @param {number} [limit=20] - Max events to return
     * @returns {Array} Treasury events sorted newest first
     */
    getTreasuryEvents(limit = 20) {
        return [...this.treasuryEvents]
            .sort((a, b) => b.blockNumber - a.blockNumber)
            .slice(0, limit);
    }

    /**
     * Get total proposal count from index
     * @returns {number}
     */
    getProposalCount() {
        return this.proposals.size;
    }

    // ============ Cache Management ============

    /** @private */
    _saveToCache() {
        try {
            const data = {
                lastIndexedBlock: this.lastIndexedBlock,
                proposals: Array.from(this.proposals.entries()),
                votes: Array.from(this.votes.entries()),
                shareEvents: this.shareEvents,
                treasuryEvents: this.treasuryEvents,
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (error) {
            console.warn('[GovernanceEventIndexer] Failed to save cache:', error.message);
        }
    }

    /** @private */
    _loadFromCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return;

            const data = JSON.parse(raw);
            this.lastIndexedBlock = data.lastIndexedBlock || 0;
            this.proposals = new Map(data.proposals || []);
            this.votes = new Map(data.votes || []);
            this.shareEvents = data.shareEvents || [];
            this.treasuryEvents = data.treasuryEvents || [];
        } catch (error) {
            console.warn('[GovernanceEventIndexer] Failed to load cache:', error.message);
            this.clear();
        }
    }

    /**
     * Clear all cached data and reset state
     */
    clear() {
        this.lastIndexedBlock = 0;
        this.proposals = new Map();
        this.votes = new Map();
        this.shareEvents = [];
        this.treasuryEvents = [];
        try {
            localStorage.removeItem(CACHE_KEY);
        } catch (e) { /* ignore */ }
    }
}

// Export singleton
const governanceEventIndexer = new GovernanceEventIndexer();
export default governanceEventIndexer;
