/**
 * ComponentRegistry Adapter
 *
 * Wraps ComponentRegistry contract for querying DAO-approved components.
 * Used by the creation wizard to discover available gating modules,
 * liquidity deployers, and future component types.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';

const CACHE_TTL = {
    COMPONENTS: 5 * 60 * 1000, // 5 minutes — component approval changes are rare
};

// Tag constants matching FeatureUtils.sol
const TAGS = {
    GATING: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating')),
    LIQUIDITY_DEPLOYER: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity')),
};

class ComponentRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ComponentRegistry', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
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

        const abi = await loadABI('ComponentRegistry');
        this.contract = new this.ethers.Contract(
            this.contractAddress, abi, this.signer || this.provider
        );
        this.initialized = true;
        eventBus.emit('contract:adapter:initialized', {
            contractAddress: this.contractAddress,
            contractType: this.contractType
        });
        return true;
    }

    /**
     * Get all approved components for a given tag hash.
     * @param {string} tagHash - bytes32 keccak256 tag (use TAGS constant)
     * @returns {Promise<Array<{address: string, name: string, tag: string}>>}
     */
    async getComponentsByTag(tagHash) {
        return this.getCachedOrFetch('getComponentsByTag', [tagHash], async () => {
            if (this.isMock) return this._getMockComponentsByTag(tagHash);

            const addresses = await this.executeContractCall(
                'getApprovedComponentsByTag', [tagHash]
            );

            const components = [];
            for (const addr of addresses) {
                const name = await this.executeContractCall('componentName', [addr]);
                components.push({ address: addr, name, tag: tagHash });
            }
            return components;
        }, CACHE_TTL.COMPONENTS);
    }

    /**
     * Check if a specific component is approved.
     * @param {string} address - Component contract address
     * @returns {Promise<boolean>}
     */
    async isApproved(address) {
        if (this.isMock) return true;
        return this.executeContractCall('isApprovedComponent', [address]);
    }

    /**
     * Get all approved components (all tags).
     * @returns {Promise<Array<{address: string, name: string, tag: string}>>}
     */
    async getAllComponents() {
        return this.getCachedOrFetch('getAllComponents', [], async () => {
            if (this.isMock) return this._getMockAllComponents();

            const addresses = await this.executeContractCall('getApprovedComponents', []);
            const components = [];
            for (const addr of addresses) {
                const name = await this.executeContractCall('componentName', [addr]);
                const tag = await this.executeContractCall('componentTag', [addr]);
                components.push({ address: addr, name, tag });
            }
            return components;
        }, CACHE_TTL.COMPONENTS);
    }

    // ── Mock data for PLACEHOLDER_MOCK mode ──

    _getMockComponentsByTag(tagHash) {
        if (tagHash === TAGS.GATING) {
            return [
                { address: '0xMOCK_GATING_001', name: 'Password Tier Gating', tag: tagHash },
                { address: '0xMOCK_GATING_002', name: 'Merkle Allowlist Gating', tag: tagHash },
            ];
        }
        if (tagHash === TAGS.LIQUIDITY_DEPLOYER) {
            return [
                { address: '0xMOCK_LIQ_UNI', name: 'Uniswap V4 Deployer', tag: tagHash },
                { address: '0xMOCK_LIQ_ZAMM', name: 'ZAMM Deployer', tag: tagHash },
                { address: '0xMOCK_LIQ_CYPHER', name: 'Algebra V2 Deployer', tag: tagHash },
            ];
        }
        return [];
    }

    _getMockAllComponents() {
        return [
            ...this._getMockComponentsByTag(TAGS.GATING),
            ...this._getMockComponentsByTag(TAGS.LIQUIDITY_DEPLOYER),
        ];
    }
}

export { TAGS };
export default ComponentRegistryAdapter;
