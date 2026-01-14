/**
 * Asset Metadata Registry
 * Maps asset identifiers (addresses, symbols, names) to their display metadata
 * including icons, colors, and descriptions
 */

/**
 * Asset metadata structure:
 * {
 *   symbol: string,        // Asset symbol (e.g., 'ETH', 'WETH', 'USDC')
 *   name: string,          // Full name
 *   icon: string,          // Emoji or URL to icon
 *   iconType: 'emoji' | 'image' | 'svg',
 *   color: string,         // Primary color for gradients/themes
 *   addresses: {           // Contract addresses per chain
 *     1: string,           // Ethereum mainnet
 *     137: string,         // Polygon
 *     // ... other chains
 *   },
 *   description: string    // Short description
 * }
 */

export const ASSET_METADATA = {
    // Ethereum
    'ETH': {
        symbol: 'ETH',
        name: 'Ethereum',
        icon: '⟠',
        iconType: 'emoji',
        color: '#627EEA',
        addresses: {
            1: '0x0000000000000000000000000000000000000000' // Native ETH
        },
        description: 'Native Ethereum token'
    },

    // Wrapped Ethereum
    'WETH': {
        symbol: 'WETH',
        name: 'Wrapped Ethereum',
        icon: '⟠',
        iconType: 'emoji',
        color: '#627EEA',
        addresses: {
            1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
        },
        description: 'ERC20 wrapped Ethereum'
    },

    // Stablecoins
    'USDC': {
        symbol: 'USDC',
        name: 'USD Coin',
        icon: '💵',
        iconType: 'emoji',
        color: '#2775CA',
        addresses: {
            1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        description: 'USD stablecoin by Circle'
    },

    'USDT': {
        symbol: 'USDT',
        name: 'Tether USD',
        icon: '💵',
        iconType: 'emoji',
        color: '#26A17B',
        addresses: {
            1: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
        },
        description: 'USD stablecoin by Tether'
    },

    'DAI': {
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        icon: '💵',
        iconType: 'emoji',
        color: '#F5AC37',
        addresses: {
            1: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
        },
        description: 'Decentralized USD stablecoin'
    },

    // Bitcoin
    'WBTC': {
        symbol: 'WBTC',
        name: 'Wrapped Bitcoin',
        icon: '₿',
        iconType: 'emoji',
        color: '#F7931A',
        addresses: {
            1: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
        },
        description: 'ERC20 wrapped Bitcoin'
    },

    // DeFi Tokens
    'UNI': {
        symbol: 'UNI',
        name: 'Uniswap',
        icon: '🦄',
        iconType: 'emoji',
        color: '#FF007A',
        addresses: {
            1: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
        },
        description: 'Uniswap governance token'
    },

    'LINK': {
        symbol: 'LINK',
        name: 'Chainlink',
        icon: '🔗',
        iconType: 'emoji',
        color: '#375BD2',
        addresses: {
            1: '0x514910771AF9Ca656af840dff83E8264EcF986CA'
        },
        description: 'Chainlink oracle token'
    },

    // Remilia Ecosystem
    'CULT': {
        symbol: 'CULT',
        name: 'Cult DAO',
        icon: '🎭',
        iconType: 'emoji',
        color: '#8B4513',
        addresses: {
            1: '0xf0f9D895aCa5c8678f706FB8216fa22957685A13'
        },
        description: 'Cult DAO governance token'
    },

    'EXEC': {
        symbol: 'EXEC',
        name: 'CULT Executives',
        icon: '👔',
        iconType: 'emoji',
        color: '#DAA520',
        addresses: {
            1: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2' // CULT EXECUTIVES contract
        },
        description: 'CULT EXECUTIVES ERC404'
    },

    // Fallback/Generic
    'GENERIC': {
        symbol: 'TOKEN',
        name: 'Generic Token',
        icon: '💰',
        iconType: 'emoji',
        color: '#888888',
        addresses: {},
        description: 'Unknown or generic token'
    }
};

/**
 * Get asset metadata by symbol
 * @param {string} symbol - Asset symbol (e.g., 'ETH', 'USDC')
 * @returns {Object} Asset metadata or fallback
 */
export function getAssetBySymbol(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return ASSET_METADATA[upperSymbol] || ASSET_METADATA.GENERIC;
}

/**
 * Get asset metadata by contract address
 * @param {string} address - Contract address
 * @param {number} chainId - Chain ID (default 1 for Ethereum mainnet)
 * @returns {Object} Asset metadata or fallback
 */
export function getAssetByAddress(address, chainId = 1) {
    const lowerAddress = address.toLowerCase();

    for (const [symbol, metadata] of Object.entries(ASSET_METADATA)) {
        if (metadata.addresses[chainId]) {
            if (metadata.addresses[chainId].toLowerCase() === lowerAddress) {
                return metadata;
            }
        }
    }

    return ASSET_METADATA.GENERIC;
}

/**
 * Get asset icon (emoji or image URL)
 * @param {string} symbolOrAddress - Asset symbol or contract address
 * @param {number} chainId - Chain ID for address lookup
 * @returns {string} Icon emoji or URL
 */
export function getAssetIcon(symbolOrAddress, chainId = 1) {
    let asset;

    // Check if it looks like an address (starts with 0x)
    if (symbolOrAddress.startsWith('0x')) {
        asset = getAssetByAddress(symbolOrAddress, chainId);
    } else {
        asset = getAssetBySymbol(symbolOrAddress);
    }

    return asset.icon;
}

/**
 * Get asset color for theming
 * @param {string} symbolOrAddress - Asset symbol or contract address
 * @param {number} chainId - Chain ID for address lookup
 * @returns {string} Hex color code
 */
export function getAssetColor(symbolOrAddress, chainId = 1) {
    let asset;

    if (symbolOrAddress.startsWith('0x')) {
        asset = getAssetByAddress(symbolOrAddress, chainId);
    } else {
        asset = getAssetBySymbol(symbolOrAddress);
    }

    return asset.color;
}

/**
 * Register a new asset or update existing asset metadata
 * @param {string} symbol - Asset symbol
 * @param {Object} metadata - Asset metadata object
 */
export function registerAsset(symbol, metadata) {
    ASSET_METADATA[symbol.toUpperCase()] = {
        ...ASSET_METADATA.GENERIC,
        ...metadata,
        symbol: symbol.toUpperCase()
    };
}
