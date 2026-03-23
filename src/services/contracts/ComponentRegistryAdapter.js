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
            this.contractAddress, abi, this.provider
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
     * @returns {Promise<Array<{address: string, name: string, tag: string, metadata: object|null}>>}
     */
    async getComponentsByTag(tagHash) {
        return this.getCachedOrFetch('getComponentsByTag', [tagHash], async () => {
            if (this.isMock) return this._getMockComponentsByTag(tagHash);

            const addresses = await this.executeContractCall(
                'getApprovedComponentsByTag', [tagHash]
            );

            const metadataAbi = ['function metadataURI() external view returns (string)'];

            const components = [];
            for (const addr of addresses) {
                const name = await this.executeContractCall('componentName', [addr]);

                let metadata = null;
                try {
                    const moduleContract = new this.ethers.Contract(addr, metadataAbi, this.provider);
                    const uri = await moduleContract.metadataURI();
                    if (uri) metadata = this._parseMetadataURI(uri);
                } catch (_) {
                    // module doesn't implement IComponentModule yet — graceful degradation
                }

                components.push({ address: addr, name, tag: tagHash, metadata });
            }
            return components;
        }, CACHE_TTL.COMPONENTS);
    }

    _parseMetadataURI(uri) {
        try {
            if (uri.startsWith('data:application/json,')) {
                return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
            }
            if (uri.startsWith('data:application/json;base64,')) {
                return JSON.parse(atob(uri.slice('data:application/json;base64,'.length)));
            }
        } catch (_) {}
        return null;
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
                {
                    address: '0xMOCK_GATING_001', name: 'Password Tier Gating', tag: tagHash,
                    metadata: { subtitle: 'Password · Tiered Access', description: 'Set one or more passwords, each unlocking a different tier of access or pricing. Share codes with your community however you like — Discord, email, or word of mouth.', configType: 'password-tier-gating' },
                },
                {
                    address: '0xMOCK_GATING_002', name: 'Merkle Allowlist Gating', tag: tagHash,
                    metadata: { subtitle: 'Allowlist · Merkle Tree', description: 'Upload a list of wallet addresses. Only wallets on the list can participate. Uses a Merkle tree so the full list never needs to go on-chain — just a single root hash.' },
                },
            ];
        }
        if (tagHash === TAGS.LIQUIDITY_DEPLOYER) {
            return [
                {
                    address: '0xMOCK_LIQ_UNI', name: 'Uniswap V4 Deployer', tag: tagHash,
                    metadata: { subtitle: 'Uniswap V4 · Concentrated Liquidity', description: 'Deploy liquidity to a Uniswap V4 pool. Swap fees compound directly into the pool, deepening liquidity over time.', configType: 'launch-profile' },
                },
                {
                    address: '0xMOCK_LIQ_ZAMM', name: 'ZAMM Deployer', tag: tagHash,
                    metadata: { subtitle: 'ZAMM · Constant Product', description: 'Deploy liquidity to ZAMM, a gas-efficient constant-product AMM. Simple and battle-tested.', configType: 'launch-profile' },
                },
                {
                    address: '0xMOCK_LIQ_CYPHER', name: 'Cypher Deployer', tag: tagHash,
                    metadata: { subtitle: 'Cypher · Concentrated Liquidity', description: 'Deploy liquidity to Cypher, a concentrated liquidity DEX. Capital-efficient ranges and deep liquidity with tighter spreads.', configType: 'launch-profile' },
                },
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
