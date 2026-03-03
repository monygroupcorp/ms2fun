/**
 * GrandCentral DAO Adapter
 *
 * Handles all interactions with the GrandCentral Moloch-pattern DAO contract.
 * Shares = voting power, loot = economic rights. Proposals execute via Gnosis Safe.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (governance params)
    DYNAMIC: 30 * 1000,           // 30 seconds (proposals, votes)
    SHARES: 2 * 60 * 1000,        // 2 minutes (share balances)
};

// ProposalState enum matching Solidity
const ProposalState = {
    0: 'Unborn',
    1: 'Submitted',
    2: 'Voting',
    3: 'Cancelled',
    4: 'Grace',
    5: 'Ready',
    6: 'Processed',
    7: 'Defeated'
};

class GrandCentralAdapter extends ContractAdapter {
    constructor(contractAddress, ethersProvider, signer) {
        super(contractAddress, 'GrandCentral', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        try {
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

            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            const abi = await loadABI('GrandCentral');

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
            throw this.wrapError(error, 'GrandCentralAdapter initialization failed');
        }
    }

    // ============ Shares & Loot (Read) ============

    async getShares(address) {
        return await this.getCachedOrFetch('shares', [address], async () => {
            const shares = await this.executeContractCall('shares', [address]);
            return ethers.utils.formatEther(shares);
        }, CACHE_TTL.SHARES);
    }

    async getTotalShares() {
        return await this.getCachedOrFetch('totalShares', [], async () => {
            const total = await this.executeContractCall('totalShares');
            return ethers.utils.formatEther(total);
        }, CACHE_TTL.SHARES);
    }

    async getLoot(address) {
        return await this.getCachedOrFetch('loot', [address], async () => {
            const loot = await this.executeContractCall('loot', [address]);
            return ethers.utils.formatEther(loot);
        }, CACHE_TTL.SHARES);
    }

    async getTotalLoot() {
        return await this.getCachedOrFetch('totalLoot', [], async () => {
            const total = await this.executeContractCall('totalLoot');
            return ethers.utils.formatEther(total);
        }, CACHE_TTL.SHARES);
    }

    async getSharesAt(address, timestamp) {
        return await this.getCachedOrFetch('getSharesAt', [address, timestamp], async () => {
            const shares = await this.executeContractCall('getSharesAt', [address, timestamp]);
            return ethers.utils.formatEther(shares);
        }, CACHE_TTL.SHARES);
    }

    async getMemberSummary(address) {
        const [shares, loot, pendingClaim, totalShares, totalLoot] = await Promise.all([
            this.getShares(address),
            this.getLoot(address),
            this.getPendingClaim(address),
            this.getTotalShares(),
            this.getTotalLoot()
        ]);

        const totalVotingPower = parseFloat(shares) + parseFloat(loot);
        const totalSupply = parseFloat(totalShares) + parseFloat(totalLoot);
        const percentage = totalSupply > 0 ? (totalVotingPower / totalSupply) * 100 : 0;

        return { shares, loot, pendingClaim, totalShares, totalLoot, totalVotingPower: totalVotingPower.toString(), percentage };
    }

    // ============ Proposals (Read) ============

    async getProposal(id) {
        return await this.getCachedOrFetch('proposals', [id], async () => {
            const raw = await this.executeContractCall('proposals', [id]);
            return this._parseProposal(raw);
        }, CACHE_TTL.DYNAMIC);
    }

    async getProposalState(id) {
        return await this.getCachedOrFetch('state', [id], async () => {
            const stateNum = await this.executeContractCall('state', [id]);
            return ProposalState[stateNum] || 'Unknown';
        }, CACHE_TTL.DYNAMIC);
    }

    async getProposalCount() {
        return await this.getCachedOrFetch('proposalCount', [], async () => {
            const count = await this.executeContractCall('proposalCount');
            return typeof count === 'number' ? count : parseInt(count.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    // ============ Treasury (Read) ============

    async getRagequitPool() {
        return await this.getCachedOrFetch('ragequitPool', [], async () => {
            const pool = await this.executeContractCall('ragequitPool');
            return ethers.utils.formatEther(pool);
        }, CACHE_TTL.DYNAMIC);
    }

    async getClaimsPoolBalance() {
        return await this.getCachedOrFetch('claimsPoolBalance', [], async () => {
            const balance = await this.executeContractCall('claimsPoolBalance');
            return ethers.utils.formatEther(balance);
        }, CACHE_TTL.DYNAMIC);
    }

    async getGeneralFunds() {
        return await this.getCachedOrFetch('generalFunds', [], async () => {
            const funds = await this.executeContractCall('generalFunds');
            return ethers.utils.formatEther(funds);
        }, CACHE_TTL.DYNAMIC);
    }

    async getPendingClaim(address) {
        return await this.getCachedOrFetch('pendingClaim', [address], async () => {
            const claim = await this.executeContractCall('pendingClaim', [address]);
            return ethers.utils.formatEther(claim);
        }, CACHE_TTL.DYNAMIC);
    }

    async getTreasurySummary() {
        const [ragequitPool, claimsPool, generalFunds] = await Promise.all([
            this.getRagequitPool(),
            this.getClaimsPoolBalance(),
            this.getGeneralFunds()
        ]);
        return { ragequitPool, claimsPool, generalFunds };
    }

    // ============ Governance Params (Read) ============

    async getGovernanceConfig() {
        return await this.getCachedOrFetch('getGovernanceConfig', [], async () => {
            const [votingPeriod, gracePeriod, quorumPercent, sponsorThreshold, minRetentionPercent] = await Promise.all([
                this.executeContractCall('votingPeriod'),
                this.executeContractCall('gracePeriod'),
                this.executeContractCall('quorumPercent'),
                this.executeContractCall('sponsorThreshold'),
                this.executeContractCall('minRetentionPercent')
            ]);
            return {
                votingPeriod: parseInt(votingPeriod.toString()),
                gracePeriod: parseInt(gracePeriod.toString()),
                quorumPercent: parseInt(quorumPercent.toString()),
                sponsorThreshold: parseInt(sponsorThreshold.toString()),
                minRetentionPercent: parseInt(minRetentionPercent.toString())
            };
        }, CACHE_TTL.STATIC);
    }

    // ============ Conductors (Read) ============

    async getConductorPermissions(address) {
        return await this.getCachedOrFetch('conductors', [address], async () => {
            const perm = await this.executeContractCall('conductors', [address]);
            return parseInt(perm.toString());
        }, CACHE_TTL.STATIC);
    }

    async isConductorAdmin(address) {
        return await this.getCachedOrFetch('isAdmin', [address], async () => {
            return await this.executeContractCall('isAdmin', [address]);
        }, CACHE_TTL.STATIC);
    }

    // ============ Safe (Read) ============

    async getSafe() {
        return await this.getCachedOrFetch('safe', [], async () => {
            return await this.executeContractCall('safe');
        }, CACHE_TTL.STATIC);
    }

    // ============ Write Methods ============

    async submitProposal(targets, values, calldatas, expiration, details) {
        try {
            eventBus.emit('transaction:pending', { type: 'submitProposal' });
            const receipt = await this.executeContractCall('submitProposal',
                [targets, values, calldatas, expiration, details],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'submitProposal', receipt });
            contractCache.invalidateByPattern('proposal', 'proposalCount');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'submitProposal', error: this.wrapError(error, 'Proposal submission failed') });
            throw error;
        }
    }

    async sponsorProposal(id) {
        try {
            eventBus.emit('transaction:pending', { type: 'sponsorProposal', proposalId: id });
            const receipt = await this.executeContractCall('sponsorProposal', [id], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'sponsorProposal', receipt, proposalId: id });
            contractCache.invalidateByPattern('proposal', 'state');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'sponsorProposal', error: this.wrapError(error, 'Sponsorship failed') });
            throw error;
        }
    }

    async submitVote(id, approved) {
        try {
            eventBus.emit('transaction:pending', { type: 'submitVote', proposalId: id });
            const receipt = await this.executeContractCall('submitVote', [id, approved], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'submitVote', receipt, proposalId: id });
            contractCache.invalidateByPattern('proposal', 'vote');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'submitVote', error: this.wrapError(error, 'Vote submission failed') });
            throw error;
        }
    }

    async processProposal(id, targets, values, calldatas) {
        try {
            eventBus.emit('transaction:pending', { type: 'processProposal', proposalId: id });
            const receipt = await this.executeContractCall('processProposal',
                [id, targets, values, calldatas],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'processProposal', receipt, proposalId: id });
            contractCache.invalidateByPattern('proposal', 'state', 'treasury');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'processProposal', error: this.wrapError(error, 'Proposal processing failed') });
            throw error;
        }
    }

    async cancelProposal(id) {
        try {
            eventBus.emit('transaction:pending', { type: 'cancelProposal', proposalId: id });
            const receipt = await this.executeContractCall('cancelProposal', [id], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'cancelProposal', receipt, proposalId: id });
            contractCache.invalidateByPattern('proposal', 'state');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'cancelProposal', error: this.wrapError(error, 'Proposal cancellation failed') });
            throw error;
        }
    }

    async ragequit(sharesToBurn, lootToBurn) {
        try {
            const sharesWei = ethers.utils.parseEther(sharesToBurn.toString());
            const lootWei = ethers.utils.parseEther(lootToBurn.toString());
            eventBus.emit('transaction:pending', { type: 'ragequit' });
            const receipt = await this.executeContractCall('ragequit', [sharesWei, lootWei], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'ragequit', receipt });
            contractCache.invalidateByPattern('shares', 'loot', 'ragequitPool', 'totalShares', 'totalLoot');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'ragequit', error: this.wrapError(error, 'Ragequit failed') });
            throw error;
        }
    }

    async claim() {
        try {
            eventBus.emit('transaction:pending', { type: 'claim' });
            const receipt = await this.executeContractCall('claim', [], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'claim', receipt });
            contractCache.invalidateByPattern('pendingClaim', 'claimsPool');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'claim', error: this.wrapError(error, 'Claim failed') });
            throw error;
        }
    }

    // ============ Event Indexing ============

    async indexProposalEvents(fromBlock = 0) {
        const filter = this.contract.filters.ProposalSubmitted();
        const events = await this.contract.queryFilter(filter, fromBlock, 'latest');
        return events.map(e => ({
            proposalId: e.args.proposalId.toNumber(),
            proposalDataHash: e.args.proposalDataHash,
            targets: e.args.targets,
            values: e.args.values.map(v => ethers.utils.formatEther(v)),
            calldatas: e.args.calldatas,
            expiration: e.args.expiration,
            selfSponsor: e.args.selfSponsor,
            details: e.args.details,
            blockNumber: e.blockNumber,
            transactionHash: e.transactionHash
        }));
    }

    async indexVoteCastEvents(fromBlock = 0) {
        const filter = this.contract.filters.VoteCast();
        const events = await this.contract.queryFilter(filter, fromBlock, 'latest');
        return events.map(e => ({
            voter: e.args.voter,
            balance: ethers.utils.formatEther(e.args.balance),
            proposalId: e.args.proposalId.toNumber(),
            approved: e.args.approved,
            blockNumber: e.blockNumber,
            transactionHash: e.transactionHash
        }));
    }

    async indexShareEvents(fromBlock = 0) {
        const [minted, burned] = await Promise.all([
            this.contract.queryFilter(this.contract.filters.SharesMinted(), fromBlock, 'latest'),
            this.contract.queryFilter(this.contract.filters.SharesBurned(), fromBlock, 'latest')
        ]);

        const mintEvents = minted.map(e => ({
            type: 'mint', to: e.args.to, amount: ethers.utils.formatEther(e.args.amount),
            blockNumber: e.blockNumber, transactionHash: e.transactionHash
        }));
        const burnEvents = burned.map(e => ({
            type: 'burn', from: e.args.from, amount: ethers.utils.formatEther(e.args.amount),
            blockNumber: e.blockNumber, transactionHash: e.transactionHash
        }));

        return [...mintEvents, ...burnEvents].sort((a, b) => a.blockNumber - b.blockNumber);
    }

    async indexTreasuryEvents(fromBlock = 0) {
        const [ragequitFunded, ragequits, claimsFunded, claimsWithdrawn] = await Promise.all([
            this.contract.queryFilter(this.contract.filters.RagequitPoolFunded(), fromBlock, 'latest'),
            this.contract.queryFilter(this.contract.filters.Ragequit(), fromBlock, 'latest'),
            this.contract.queryFilter(this.contract.filters.ClaimsPoolFunded(), fromBlock, 'latest'),
            this.contract.queryFilter(this.contract.filters.ClaimWithdrawn(), fromBlock, 'latest')
        ]);

        const events = [
            ...ragequitFunded.map(e => ({
                type: 'ragequitPoolFunded', amount: ethers.utils.formatEther(e.args.amount),
                newTotal: ethers.utils.formatEther(e.args.newTotal),
                blockNumber: e.blockNumber, transactionHash: e.transactionHash
            })),
            ...ragequits.map(e => ({
                type: 'ragequit', member: e.args.member,
                sharesBurned: ethers.utils.formatEther(e.args.sharesBurned),
                lootBurned: ethers.utils.formatEther(e.args.lootBurned),
                ethReceived: ethers.utils.formatEther(e.args.ethReceived),
                blockNumber: e.blockNumber, transactionHash: e.transactionHash
            })),
            ...claimsFunded.map(e => ({
                type: 'claimsPoolFunded', amount: ethers.utils.formatEther(e.args.amount),
                newRewardPerShare: ethers.utils.formatEther(e.args.newRewardPerShare),
                blockNumber: e.blockNumber, transactionHash: e.transactionHash
            })),
            ...claimsWithdrawn.map(e => ({
                type: 'claimWithdrawn', member: e.args.member,
                amount: ethers.utils.formatEther(e.args.amount),
                blockNumber: e.blockNumber, transactionHash: e.transactionHash
            }))
        ];

        return events.sort((a, b) => a.blockNumber - b.blockNumber);
    }

    // ============ Helpers ============

    _parseProposal(raw) {
        return {
            id: typeof raw.id === 'number' ? raw.id : parseInt((raw.id || raw[0]).toString()),
            prevProposalId: parseInt((raw.prevProposalId || raw[1]).toString()),
            votingStarts: parseInt((raw.votingStarts || raw[2]).toString()),
            votingEnds: parseInt((raw.votingEnds || raw[3]).toString()),
            graceEnds: parseInt((raw.graceEnds || raw[4]).toString()),
            expiration: parseInt((raw.expiration || raw[5]).toString()),
            yesVotes: ethers.utils.formatEther(raw.yesVotes || raw[6]),
            noVotes: ethers.utils.formatEther(raw.noVotes || raw[7]),
            maxTotalSharesAtYesVote: ethers.utils.formatEther(raw.maxTotalSharesAtYesVote || raw[8]),
            status: raw.status || raw[9],
            sponsor: raw.sponsor || raw[10],
            proposalDataHash: raw.proposalDataHash || raw[11],
            details: raw.details || raw[12]
        };
    }

    // ============ Contract Metadata (required by base) ============

    async getMetadata() {
        const config = await this.getGovernanceConfig();
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            ...config
        };
    }

    async getBalance(address) {
        return await this.getShares(address);
    }

    async getPrice() {
        return 0;
    }
}

export { ProposalState };
export default GrandCentralAdapter;
