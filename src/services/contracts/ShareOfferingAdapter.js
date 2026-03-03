/**
 * ShareOffering Adapter
 *
 * Handles interactions with the ShareOffering conductor contract.
 * Manages tranche-based share offerings: commit, refund, view tranches.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,
    DYNAMIC: 30 * 1000,
};

const TrancheStatus = {
    0: 'Inactive',
    1: 'Active',
    2: 'Finalized',
    3: 'Cancelled'
};

class ShareOfferingAdapter extends ContractAdapter {
    constructor(contractAddress, ethersProvider, signer) {
        super(contractAddress, 'ShareOffering', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        try {
            if (this.provider && this.provider.isMock === true) {
                this.initialized = true;
                this.isMock = true;
                return true;
            }

            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available');
            }

            const abi = await loadABI('ShareOffering');
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
            throw this.wrapError(error, 'ShareOfferingAdapter initialization failed');
        }
    }

    // ============ Read Methods ============

    async getCurrentTrancheId() {
        return await this.getCachedOrFetch('currentTrancheId', [], async () => {
            const id = await this.executeContractCall('currentTrancheId');
            return parseInt(id.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    async getTranche(trancheId) {
        return await this.getCachedOrFetch('getTranche', [trancheId], async () => {
            const t = await this.executeContractCall('getTranche', [trancheId]);
            return this._parseTranche(t);
        }, CACHE_TTL.DYNAMIC);
    }

    async getTrancheStatus(trancheId) {
        return await this.getCachedOrFetch('status', [trancheId], async () => {
            const s = await this.executeContractCall('status', [trancheId]);
            return TrancheStatus[s] || 'Unknown';
        }, CACHE_TTL.DYNAMIC);
    }

    async getCommitment(trancheId, buyer) {
        return await this.getCachedOrFetch('getCommitment', [trancheId, buyer], async () => {
            const result = await this.executeContractCall('getCommitment', [trancheId, buyer]);
            return {
                shares: ethers.utils.formatEther(result.shares || result[0]),
                ethValue: ethers.utils.formatEther(result.ethValue || result[1])
            };
        }, CACHE_TTL.DYNAMIC);
    }

    async getCurrentOffering() {
        const trancheId = await this.getCurrentTrancheId();
        if (trancheId === 0) return null;

        const tranche = await this.getTranche(trancheId);
        const status = await this.getTrancheStatus(trancheId);
        return { ...tranche, trancheId, statusLabel: status };
    }

    // ============ Write Methods ============

    async commit(trancheId, sharesToBuy, proof = []) {
        try {
            const tranche = await this.getTranche(trancheId);
            const priceWei = ethers.utils.parseEther(tranche.pricePerShare);
            const sharesWei = ethers.utils.parseEther(sharesToBuy.toString());
            // cost = sharesToBuy * pricePerShare (in raw units)
            const sharesRaw = ethers.BigNumber.from(sharesToBuy.toString());
            const cost = sharesRaw.mul(priceWei);

            eventBus.emit('transaction:pending', { type: 'commit', trancheId });
            const receipt = await this.executeContractCall('commit',
                [trancheId, sharesRaw, proof],
                { requiresSigner: true, txOptions: { value: cost } }
            );
            eventBus.emit('transaction:success', { type: 'commit', receipt, trancheId });
            contractCache.invalidateByPattern('getTranche', 'getCommitment', 'status');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'commit', error: this.wrapError(error, 'Commitment failed') });
            throw error;
        }
    }

    async refund(trancheId) {
        try {
            eventBus.emit('transaction:pending', { type: 'refund', trancheId });
            const receipt = await this.executeContractCall('refund', [trancheId], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'refund', receipt, trancheId });
            contractCache.invalidateByPattern('getTranche', 'getCommitment');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'refund', error: this.wrapError(error, 'Refund failed') });
            throw error;
        }
    }

    // ============ Helpers ============

    _parseTranche(t) {
        return {
            pricePerShare: ethers.utils.formatEther(t.pricePerShare || t[0]),
            totalShares: ethers.utils.formatEther(t.totalShares || t[1]),
            committedShares: ethers.utils.formatEther(t.committedShares || t[2]),
            totalETHCommitted: ethers.utils.formatEther(t.totalETHCommitted || t[3]),
            startTime: parseInt((t.startTime || t[4]).toString()),
            endTime: parseInt((t.endTime || t[5]).toString()),
            finalizeDeadline: parseInt((t.finalizeDeadline || t[6]).toString()),
            minShares: ethers.utils.formatEther(t.minShares || t[7]),
            maxSharesPerAddress: ethers.utils.formatEther(t.maxSharesPerAddress || t[8]),
            status: parseInt((t.status || t[9]).toString()),
            whitelistRoot: t.whitelistRoot || t[10]
        };
    }

    async getMetadata() {
        return { contractAddress: this.contractAddress, contractType: this.contractType };
    }

    async getBalance() { return '0'; }
    async getPrice() { return 0; }
}

export { TrancheStatus };
export default ShareOfferingAdapter;
