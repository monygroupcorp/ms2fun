import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';

class PriceService {
    constructor() {
        this._cache = new Map();
        this._contractUpdateInterval = null;
        this._updateIntervalTime = 60000; // 1 minute
        this._cacheExpirationTime = 5 * 60 * 1000; // 5 minutes
        this._blockchainService = null; // Rename to blockchainService
        
        // Bind methods
        this.getCurrentPrice = this.getCurrentPrice.bind(this);
        this.startContractUpdates = this.startContractUpdates.bind(this);
        this.stopContractUpdates = this.stopContractUpdates.bind(this);
        
        // Don't auto-start price updates - wait for initialization
    }

    // Initialize with blockchain service
    initialize(blockchainService) {
        if (!blockchainService) {
            throw new Error('BlockchainService is required');
        }
        this._blockchainService = blockchainService;
        
        // Fetch initial contract data
        this.updateContractData();
        
        // Start regular updates
        this.startContractUpdates();
    }

    async getCurrentPrice() {
        try {
            if (!this._blockchainService) {
                throw new Error('PriceService not initialized');
            }

            const cachedPrice = this._getCacheValue('currentPrice');
            if (cachedPrice !== null) {
                return cachedPrice;
            }

            // Get price from blockchain service
            const price = await this._blockchainService.getTokenPrice();
            
            // Validate price
            if (typeof price !== 'number' || isNaN(price) || price <= 0) {
                console.error('Invalid price value:', price);
                throw new Error('Invalid price value received');
            }

            this._setCacheValue('currentPrice', price);
            eventBus.emit('price:updated', { price });
            
            return price;
        } catch (error) {
            console.error('Error fetching price:', error);
            throw error;
        }
    }

    async calculateCost(execAmount) {
        try {
            if (!this._blockchainService) {
                throw new Error('PriceService not initialized');
            }
            return await this._blockchainService.calculateCost(execAmount);
        } catch (error) {
            console.error('Error calculating cost:', error);
            throw error;
        }
    }

    async updateContractData() {
        const address = tradingStore.selectConnectedAddress();
        try {
            // Fetch all blockchain data in parallel
            const [
                currentPrice,
                totalBondingSupply,
                totalMessages,
                ethBalance,
                tokenBalance,
                nftBalance,
                totalNFTs,
                freeSupply,
                freeMint,
                contractEthBalance,
            ] = await Promise.all([
                this._blockchainService.getCurrentPrice(),
                this._blockchainService.getTotalBondingSupply(),
                this._blockchainService.getTotalMessages(),
                this._blockchainService.getEthBalance(address),
                this._blockchainService.getTokenBalance(address),
                this._blockchainService.getNFTBalance(address),
                this._blockchainService.getNFTSupply(),
                this._blockchainService.getFreeSupply(),
                this._blockchainService.getFreeMint(address),
                this._blockchainService.getContractEthBalance(),
            ]);

            // Fetch recent messages if there are any
            let recentMessages = [];
            if (totalMessages > 0) {
                const startIndex = Math.max(0, totalMessages - 5);
                recentMessages = await this._blockchainService.getMessagesBatch(startIndex, totalMessages-1);
            }

            // Update store with new contract data
            tradingStore.updateContractData({
                totalBondingSupply,
                currentPrice,
                totalMessages,
                recentMessages,
                totalNFTs,
                freeSupply,
                freeMint,
                contractEthBalance
            });

            // Update price in the store
            tradingStore.updatePrice(currentPrice);

            // Update balances in the store
            tradingStore.updateBalances({
                eth: ethBalance,
                exec: tokenBalance,
                nfts: nftBalance,
            });

            eventBus.emit('price:updated', { price: currentPrice });
            eventBus.emit('balances:updated', { eth: ethBalance, exec: tokenBalance, nfts: nftBalance });
            eventBus.emit('contractData:updated', {
                totalBondingSupply,
                totalMessages,
                recentMessages,
                totalNFTs,
                freeSupply,
                freeMint,
                contractEthBalance,
            });

        } catch (error) {
            console.error('Error updating contract data:', error);
            throw error;
        }
    }

    startContractUpdates() {
        this.stopContractUpdates(); // Clear any existing interval

        // Initial contract data fetch
        this.updateContractData().catch(error => {
            console.error('Failed to fetch initial contract data:', error);
        });
        
        // Set up interval for contract updates
        this._contractUpdateInterval = setInterval(() => {
            this.updateContractData().catch(error => {
                console.error('Failed to update contract data:', error);
                // Stop updates if we encounter persistent errors
                this.stopContractUpdates();
            });
        }, this._updateIntervalTime);
    }

    stopContractUpdates() {
        if (this._contractUpdateInterval) {
            clearInterval(this._contractUpdateInterval);
            this._contractUpdateInterval = null;
        }
    }

    _setCacheValue(key, value) {
        this._cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    _getCacheValue(key) {
        const cached = this._cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > this._cacheExpirationTime) {
            this._cache.delete(key);
            return null;
        }
        
        return cached.value;
    }
}

// Export singleton instance
export const priceService = new PriceService();
export default priceService; 