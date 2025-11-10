/**
 * Factory Metadata Utility
 * 
 * Provides descriptions, features, and metadata for different factory types.
 * Used to enrich factory data for display in the FactoryExploration component.
 */

export const FACTORY_METADATA = {
    ERC404: {
        name: 'ERC404 Factory',
        description: 'Create ERC404 tokens that combine fungible tokens with NFTs. Perfect for token launches with built-in liquidity and NFT minting capabilities.',
        features: [
            'Bonding curve pricing mechanism',
            'Automatic NFT minting from token balance',
            'Merkle tree whitelist support',
            'Phase transitions (presale → live)',
            'On-chain messaging/chat',
            'Liquidity pool integration'
        ],
        useCases: [
            'Token launches with bonding curve',
            'Community tokens with NFT rewards',
            'NFT collections with built-in liquidity',
            'Gamified token projects'
        ],
        icon: '💎',
        color: '#6366f1',
        allegiance: {
            type: 'liquidity_pool',
            description: 'Pools resources to shared liquidity pool',
            benefactor: 'Shared ERC404 Liquidity Pool',
            icon: '💧'
        }
    },
    ERC1155: {
        name: 'ERC1155 Factory',
        description: 'Create multi-edition NFT collections where each edition can have its own price and supply. Perfect for artists and creators to monetize their work.',
        features: [
            'Multiple editions in one contract',
            'Per-edition pricing',
            'Creator royalties',
            'Open mint functionality',
            'Batch operations',
            'Metadata URI support (IPFS)'
        ],
        useCases: [
            'Art collections',
            'Digital collectibles',
            'Limited edition releases',
            'Creator monetization'
        ],
        icon: '🎨',
        color: '#ec4899',
        allegiance: {
            type: 'nft_collection',
            description: 'Pools resources to creator NFT collection',
            benefactor: 'Creator NFT Treasury',
            icon: '🖼️'
        }
    }
};

/**
 * Enrich factory data with metadata
 * @param {Object} factory - Factory object with address and type
 * @param {number} instanceCount - Number of instances created by this factory
 * @param {Array} exampleProjects - Example projects created by this factory (optional)
 * @returns {Object} Enriched factory data
 */
export function enrichFactoryData(factory, instanceCount, exampleProjects = []) {
    const metadata = FACTORY_METADATA[factory.type] || {
        name: `${factory.type} Factory`,
        description: `Create ${factory.type} contracts with customizable parameters.`,
        features: [],
        useCases: [],
        icon: '📦',
        color: '#6b7280'
    };
    
    return {
        ...factory,
        ...metadata,
        instanceCount,
        examples: exampleProjects.slice(0, 3) // Show up to 3 examples
    };
}

