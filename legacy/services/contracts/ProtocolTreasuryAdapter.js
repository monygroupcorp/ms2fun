import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../../core/EventBus.js';

const REVENUE_SOURCES = [
    { key: 'BONDING_FEE', label: 'Bonding Fees', index: 0 },
    { key: 'CREATION_FEE', label: 'Creation Fees', index: 1 },
    { key: 'QUEUE_REVENUE', label: 'Queue Revenue', index: 2 },
    { key: 'OTHER', label: 'Other', index: 3 },
    { key: 'POL_FEES', label: 'POL Fees', index: 4 },
];

export { REVENUE_SOURCES };

class ProtocolTreasuryAdapter extends ContractAdapter {
    constructor(contractAddress, ethersProvider, signer) {
        super(contractAddress, 'ProtocolTreasuryV1', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        const isMockProvider = this.provider && this.provider.isMock === true;
        if (isMockProvider) {
            this.initialized = true;
            this.isMock = true;
            eventBus.emit('contract:adapter:initialized', { type: 'ProtocolTreasuryV1', address: this.contractAddress });
            return true;
        }

        if (!this.signer && !this.provider) {
            throw new Error('No provider or signer available for ProtocolTreasuryV1');
        }

        const abi = await loadABI('ProtocolTreasuryV1');
        this.contract = new ethers.Contract(this.contractAddress, abi, this.provider);
        this.initialized = true;
        eventBus.emit('contract:adapter:initialized', { type: 'ProtocolTreasuryV1', address: this.contractAddress });
        return true;
    }

    async getBalance() {
        const result = await this.executeContractCall('getBalance');
        return result.toString();
    }

    async getRevenueBySource(sourceIndex) {
        const [received, withdrawn] = await this.executeContractCall('getRevenueBySource', [sourceIndex]);
        return {
            received: received.toString(),
            withdrawn: withdrawn.toString(),
        };
    }

    async getAllRevenueSources() {
        const results = await Promise.all(
            REVENUE_SOURCES.map(async (src) => {
                const data = await this.getRevenueBySource(src.index);
                return { ...src, ...data };
            })
        );
        return results;
    }

    async polInstanceCount() {
        const result = await this.executeContractCall('polInstanceCount');
        return parseInt(result.toString());
    }

    async getPolInstances() {
        const count = await this.polInstanceCount();
        if (count === 0) return [];
        const instances = [];
        for (let i = 0; i < count; i++) {
            const addr = await this.executeContractCall('polInstances', [i]);
            const pos = await this.executeContractCall('getPolPosition', [addr]);
            instances.push({
                address: addr,
                tickLower: parseInt(pos.tickLower.toString()),
                tickUpper: parseInt(pos.tickUpper.toString()),
                liquidity: pos.liquidity.toString(),
            });
        }
        return instances;
    }

    async withdrawETH(toAddress, amountWei) {
        try {
            eventBus.emit('transaction:pending', { type: 'withdrawETH', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'withdrawETH',
                [toAddress, amountWei],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'withdrawETH', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'withdrawETH', error: this.wrapError(error, 'Failed to withdraw ETH') });
            throw error;
        }
    }

    async withdrawERC20(tokenAddress, toAddress, amount) {
        try {
            eventBus.emit('transaction:pending', { type: 'withdrawERC20', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'withdrawERC20',
                [tokenAddress, toAddress, amount],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'withdrawERC20', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'withdrawERC20', error: this.wrapError(error, 'Failed to withdraw ERC20') });
            throw error;
        }
    }

    async routeToDAO(safeAddress, amountWei) {
        try {
            eventBus.emit('transaction:pending', { type: 'routeToDAO', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall('routeToDAO', [safeAddress, amountWei], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'routeToDAO', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'routeToDAO', error: this.wrapError(error, 'Failed to route to DAO') });
            throw error;
        }
    }

    async setMasterRegistry(registryAddress) {
        try {
            eventBus.emit('transaction:pending', { type: 'setMasterRegistry', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall('setMasterRegistry', [registryAddress], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'setMasterRegistry', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'setMasterRegistry', error: this.wrapError(error, 'Failed to set master registry') });
            throw error;
        }
    }

    async setRevenueConductor(conductorAddress) {
        try {
            eventBus.emit('transaction:pending', { type: 'setRevenueConductor', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall('setRevenueConductor', [conductorAddress], { requiresSigner: true });
            eventBus.emit('transaction:success', { type: 'setRevenueConductor', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'setRevenueConductor', error: this.wrapError(error, 'Failed to set revenue conductor') });
            throw error;
        }
    }

    async claimPOLFees(instanceAddress) {
        try {
            eventBus.emit('transaction:pending', { type: 'claimPOLFees', contractAddress: this.contractAddress });
            const receipt = await this.executeContractCall(
                'claimPOLFees',
                [instanceAddress],
                { requiresSigner: true }
            );
            eventBus.emit('transaction:success', { type: 'claimPOLFees', receipt });
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', { type: 'claimPOLFees', error: this.wrapError(error, 'Failed to claim POL fees') });
            throw error;
        }
    }
}

export default ProtocolTreasuryAdapter;
