import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { ethers } from '../../vendor/ethers.esm.js';
import eventBus from '../EventBus.js';
import { contractCache } from './contractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,
    DYNAMIC: 5 * 60 * 1000,
    REALTIME: 30 * 1000,
};

class AlignmentRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, ethersProvider, signer) {
        super(contractAddress, 'AlignmentRegistryV1', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        const isMockProvider = this.provider && this.provider.isMock === true;
        if (isMockProvider) {
            this.initialized = true;
            this.isMock = true;
            eventBus.emit('contract:adapter:initialized', { type: 'AlignmentRegistryV1', address: this.contractAddress });
            return true;
        }

        if (!this.signer && !this.provider) {
            throw new Error('No provider or signer available for AlignmentRegistryV1');
        }

        const abi = await loadABI('AlignmentRegistryV1');
        this.contract = new ethers.Contract(this.contractAddress, abi, this.provider);
        this.initialized = true;
        eventBus.emit('contract:adapter:initialized', { type: 'AlignmentRegistryV1', address: this.contractAddress });
        return true;
    }

    // ─── Reads ───────────────────────────────────────────────────────────────

    async getTotalTargets() {
        return await this.getCachedOrFetch('getTotalTargets', [], async () => {
            const result = await this.executeContractCall('nextAlignmentTargetId');
            return parseInt(result.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    async getAlignmentTarget(targetId) {
        return await this.getCachedOrFetch('getAlignmentTarget', [targetId], async () => {
            const t = await this.executeContractCall('getAlignmentTarget', [targetId]);
            return {
                id: parseInt(t.id.toString()),
                title: t.title,
                description: t.description,
                metadataURI: t.metadataURI,
                active: t.active,
                approvedAt: parseInt(t.approvedAt.toString()),
            };
        }, CACHE_TTL.DYNAMIC);
    }

    async getAlignmentTargetAssets(targetId) {
        return await this.getCachedOrFetch('getAlignmentTargetAssets', [targetId], async () => {
            const assets = await this.executeContractCall('getAlignmentTargetAssets', [targetId]);
            return assets.map(a => ({
                token: a.token,
                symbol: a.symbol,
                info: a.info,
                metadataURI: a.metadataURI,
            }));
        }, CACHE_TTL.STATIC);
    }

    async getAmbassadors(targetId) {
        return await this.getCachedOrFetch('getAmbassadors', [targetId], async () => {
            return await this.executeContractCall('getAmbassadors', [targetId]);
        }, CACHE_TTL.DYNAMIC);
    }

    // Fetch all targets from 1..totalTargets
    async getAllTargets() {
        const total = await this.getTotalTargets();
        if (total === 0) return [];
        const targets = [];
        for (let i = 1; i <= total; i++) {
            try {
                const t = await this.getAlignmentTarget(i);
                const assets = await this.getAlignmentTargetAssets(i);
                targets.push({ ...t, assets });
            } catch {
                // target may have been skipped — ignore
            }
        }
        return targets;
    }

    // ─── Writes ──────────────────────────────────────────────────────────────

    async registerAlignmentTarget(title, description, metadataURI, assets) {
        // assets: Array<{ token, symbol, info, metadataURI }>
        try {
            eventBus.emit('transaction:pending', { type: 'registerAlignmentTarget', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'registerAlignmentTarget',
                [title, description, metadataURI, assets],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'registerAlignmentTarget', receipt });
            contractCache.invalidateByPattern('getTotalTargets', 'getAlignmentTarget', 'getAllTargets');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'registerAlignmentTarget', error: this.wrapError(error, 'Failed to register alignment target') });
            throw error;
        }
    }

    async updateAlignmentTarget(targetId, description, metadataURI) {
        try {
            eventBus.emit('transaction:pending', { type: 'updateAlignmentTarget', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'updateAlignmentTarget',
                [targetId, description, metadataURI],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'updateAlignmentTarget', receipt });
            contractCache.invalidateByPattern('getAlignmentTarget');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'updateAlignmentTarget', error: this.wrapError(error, 'Failed to update alignment target') });
            throw error;
        }
    }

    async deactivateAlignmentTarget(targetId) {
        try {
            eventBus.emit('transaction:pending', { type: 'deactivateAlignmentTarget', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'deactivateAlignmentTarget',
                [targetId],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'deactivateAlignmentTarget', receipt });
            contractCache.invalidateByPattern('getAlignmentTarget');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'deactivateAlignmentTarget', error: this.wrapError(error, 'Failed to deactivate alignment target') });
            throw error;
        }
    }

    async addAmbassador(targetId, ambassadorAddress) {
        try {
            eventBus.emit('transaction:pending', { type: 'addAmbassador', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'addAmbassador',
                [targetId, ambassadorAddress],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'addAmbassador', receipt });
            contractCache.invalidateByPattern('getAmbassadors');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'addAmbassador', error: this.wrapError(error, 'Failed to add ambassador') });
            throw error;
        }
    }

    async removeAmbassador(targetId, ambassadorAddress) {
        try {
            eventBus.emit('transaction:pending', { type: 'removeAmbassador', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'removeAmbassador',
                [targetId, ambassadorAddress],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'removeAmbassador', receipt });
            contractCache.invalidateByPattern('getAmbassadors');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'removeAmbassador', error: this.wrapError(error, 'Failed to remove ambassador') });
            throw error;
        }
    }
}

export default AlignmentRegistryAdapter;
