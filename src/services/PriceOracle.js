/**
 * PriceOracle - ETH/USD price oracle
 *
 * Queries on-chain price feeds for ETH/USD price:
 * - Mainnet/Sepolia: Chainlink ETH/USD price feed
 * - Local Anvil: Constant $2000
 *
 * @example
 * const oracle = new PriceOracle(mode, provider);
 * const ethPrice = await oracle.getETHPrice(); // Returns price in USD
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Chainlink ETH/USD Price Feed addresses
const CHAINLINK_ETH_USD = {
    mainnet: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    sepolia: '0x694AA1769357215DE4FAC081bf1f309aDC325306'
};

// Chainlink Price Feed ABI (just the methods we need)
const CHAINLINK_ABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() external view returns (uint8)'
];

export class PriceOracle {
    constructor(mode, provider) {
        this.mode = mode;
        this.provider = provider;
        this.cachedPrice = null;
        this.cacheTimestamp = 0;
        this.cacheDuration = 60000; // 1 minute cache
    }

    /**
     * Get current ETH/USD price
     * @returns {Promise<number>} Price in USD (e.g., 3000.50)
     */
    async getETHPrice() {
        // Check cache first (1 minute cache)
        const now = Date.now();
        if (this.cachedPrice && (now - this.cacheTimestamp) < this.cacheDuration) {
            return this.cachedPrice;
        }

        let price;

        // Local Anvil: constant $2000
        if (this.mode === 'LOCAL_BLOCKCHAIN') {
            price = 2000;
        }
        // Mainnet/Sepolia: Query Chainlink
        else if (this.mode === 'PRODUCTION_DEPLOYED') {
            try {
                price = await this.queryChainlink();
            } catch (error) {
                console.warn('[PriceOracle] Chainlink query failed, using fallback:', error.message);
                price = 3000; // Fallback if Chainlink fails
            }
        }
        // Placeholder mode: reasonable default
        else {
            price = 3000;
        }

        // Cache the result
        this.cachedPrice = price;
        this.cacheTimestamp = now;

        return price;
    }

    /**
     * Query Chainlink price feed
     * @returns {Promise<number>} Price in USD
     */
    async queryChainlink() {
        // Determine which network we're on
        const network = await this.provider.getNetwork();
        const chainId = network.chainId;

        let feedAddress;
        if (chainId === 1) {
            feedAddress = CHAINLINK_ETH_USD.mainnet;
        } else if (chainId === 11155111) {
            feedAddress = CHAINLINK_ETH_USD.sepolia;
        } else {
            throw new Error(`Chainlink price feed not available for chainId ${chainId}`);
        }

        // Create contract instance
        const priceFeed = new ethers.Contract(feedAddress, CHAINLINK_ABI, this.provider);

        // Get latest price data
        const [roundId, answer, startedAt, updatedAt, answeredInRound] = await priceFeed.latestRoundData();
        const decimals = await priceFeed.decimals();

        // Convert to USD (Chainlink returns price with 8 decimals)
        const price = parseFloat(answer.toString()) / Math.pow(10, decimals);

        console.log(`[PriceOracle] ETH/USD from Chainlink: $${price.toFixed(2)}`);
        return price;
    }

    /**
     * Format USD value with proper formatting
     * @param {number} usdAmount - Amount in USD
     * @returns {string} Formatted string (e.g., "$24,940" or "$1.2M")
     */
    formatUSD(usdAmount) {
        if (usdAmount < 1000) {
            return `$${usdAmount.toFixed(2)}`;
        } else if (usdAmount < 1000000) {
            return `$${usdAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
        } else {
            return `$${(usdAmount / 1000000).toFixed(2)}M`;
        }
    }

    /**
     * Convert ETH amount to USD
     * @param {string|number} ethAmount - Amount in ETH
     * @returns {Promise<string>} Formatted USD string
     */
    async convertETHtoUSD(ethAmount) {
        const eth = typeof ethAmount === 'string'
            ? parseFloat(ethers.utils.formatEther(ethAmount))
            : parseFloat(ethAmount);

        const ethPrice = await this.getETHPrice();
        const usdValue = eth * ethPrice;

        return this.formatUSD(usdValue);
    }
}

export default PriceOracle;
