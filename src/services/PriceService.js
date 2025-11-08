import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';

class PriceService {
    constructor() {
        this._cache = new Map();
        this._contractUpdateInterval = null;
        this._updateIntervalTime = 60000; // 1 minute
        this._cacheExpirationTime = 5 * 60 * 1000; // 5 minutes
        this._blockchainService = null; // Rename to blockchainService
        
        // Add debounce controls
        this._updateDebounceTimeout = null;
        this._updateDebounceDelay = 2000; // 2 seconds
        this._lastEmittedData = null;
        
        // Bind methods
        this.getCurrentPrice = this.getCurrentPrice.bind(this);
        this.startContractUpdates = this.startContractUpdates.bind(this);
        this.stopContractUpdates = this.stopContractUpdates.bind(this);
        this.debouncedUpdateContractData = this.debouncedUpdateContractData.bind(this);
        
        // Don't auto-start price updates - wait for initialization
    }

    // Initialize with blockchain service
    initialize(blockchainService, address = null) {
        if (!blockchainService) {
            throw new Error('BlockchainService is required');
        }
        this._blockchainService = blockchainService;
        
        // Fetch initial contract data immediately without debouncing
        // Use provided address or try to get from store
        const addressToUse = address || tradingStore.selectConnectedAddress();
        console.log('PriceService: Fetching initial data immediately', addressToUse ? `for address: ${addressToUse}` : '(no address yet)');
        this.updateContractData(addressToUse).catch(error => {
            console.error('Failed to fetch initial contract data:', error);
        });
        
        // Start regular updates with debouncing after the initial fetch
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

    async updateContractData(address = null) {
        // Use provided address or get from store
        const addressToUse = address || tradingStore.selectConnectedAddress();
        
        // If no address is connected, skip address-specific calls
        if (!addressToUse) {
            console.warn('[PriceService] No address connected, skipping address-specific data fetch');
            try {
                // Fetch only non-address-specific data
                const [
                    currentPrice,
                    totalBondingSupply,
                    totalMessages,
                    totalNFTs,
                    freeSupply,
                    contractEthBalance,
                    currentTier,
                    liquidityPool,
                ] = await Promise.all([
                    this._blockchainService.getCurrentPrice(),
                    this._blockchainService.getTotalBondingSupply(),
                    this._blockchainService.getTotalMessages(),
                    this._blockchainService.getNFTSupply(),
                    this._blockchainService.getFreeSupply(),
                    this._blockchainService.getContractEthBalance(),
                    this._blockchainService.getCurrentTier(),
                    this._blockchainService.getLiquidityPool(),
                ]);
                
                // Update store with available data (without address-specific fields)
                tradingStore.updateContractData({
                    totalBondingSupply,
                    currentPrice,
                    totalMessages,
                    totalNFTs,
                    freeSupply,
                    contractEthBalance,
                    currentTier,
                    liquidityPool,
                    lastUpdated: Date.now()
                });
                
                return;
            } catch (error) {
                console.error('[PriceService] Error updating contract data (no address):', error);
                throw error;
            }
        }
        
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
                currentTier,
                liquidityPool,
            ] = await Promise.all([
                this._blockchainService.getCurrentPrice(),
                this._blockchainService.getTotalBondingSupply(),
                this._blockchainService.getTotalMessages(),
                this._blockchainService.getEthBalance(addressToUse),
                this._blockchainService.getTokenBalance(addressToUse),
                this._blockchainService.getNFTBalance(addressToUse),
                this._blockchainService.getNFTSupply(),
                this._blockchainService.getFreeSupply(),
                this._blockchainService.getFreeMint(addressToUse),
                this._blockchainService.getContractEthBalance(),
                this._blockchainService.getCurrentTier(),
                this._blockchainService.getLiquidityPool(),
            ]);

            // Fetch recent messages if there are any
            let recentMessages = [];
            if (totalMessages > 0) {
                const startIndex = Math.max(0, totalMessages - 5);
                recentMessages = await this._blockchainService.getMessagesBatch(startIndex, totalMessages - 1);
            }

            // Create contract data object for comparison
            const contractData = {
                totalBondingSupply,
                currentPrice,
                totalMessages,
                recentMessages,
                totalNFTs,
                freeSupply,
                freeMint,
                contractEthBalance,
                currentTier,
                liquidityPool,
            };
            
            // Create balances object for comparison
            const balances = {
                eth: ethBalance,
                exec: tokenBalance,
                nfts: nftBalance,
            };
            
            // Check if contract data has actually changed by comparing important fields
            const contractDataChanged = !this._lastEmittedData || 
                this._lastEmittedData.totalBondingSupply !== totalBondingSupply ||
                this._lastEmittedData.currentPrice !== currentPrice ||
                this._lastEmittedData.totalMessages !== totalMessages ||
                this._lastEmittedData.totalNFTs !== totalNFTs ||
                this._lastEmittedData.freeSupply !== freeSupply ||
                this._lastEmittedData.freeMint !== freeMint ||
                this._lastEmittedData.currentTier !== currentTier ||
                this._lastEmittedData.liquidityPool !== liquidityPool;
                
            // Check if balances have changed
            const previousBalances = tradingStore.selectBalances();
            const balancesChanged = 
                !previousBalances ||
                previousBalances.eth !== ethBalance ||
                previousBalances.exec !== tokenBalance ||
                previousBalances.nfts !== nftBalance;

            // Update store with new contract data regardless of whether it has changed
            // This ensures the store always has the latest data
            tradingStore.updateContractData(contractData);
            tradingStore.updatePrice(currentPrice);
            tradingStore.updateBalances(balances);

            // Check if liquidity pool is valid and fetch pool data
            if (liquidityPool !== '0x0000000000000000000000000000000000000000') {
                const [reserve0, reserve1] = await this._blockchainService.executeContractCall(
                    'getReserves',
                    [],
                    { useContract: 'v2pool' }
                );

                // Store pool data in the trading store
                tradingStore.updatePoolData({
                    liquidityPool,
                    reserve0,
                    reserve1,
                });

                const isToken0 = await this._blockchainService.isToken0(liquidityPool, address);
                const price = isToken0 ? 1 / await this._blockchainService.getToken0PriceInToken1(liquidityPool) : await this._blockchainService.getToken0PriceInToken1(liquidityPool);
                console.log('Price:', price);
                // Update price in the store
                tradingStore.updatePrice(price * 1000000);

                console.log('Pool data updated:', { liquidityPool, reserve0, reserve1 });
            } else {
                console.warn('Liquidity pool address is zero, skipping pool data fetch.');
            }

            // Only emit events if the data has changed or if this is the first update
            if (contractDataChanged) {
                console.log('Contract data changed, emitting events');
                eventBus.emit('contractData:updated', contractData);
                // Store last emitted data for future comparison
                this._lastEmittedData = {...contractData};
            } else {
                console.log('Contract data unchanged, skipping event emission');
            }
            
            // Only emit price updated if price changed
            if (!this._lastEmittedData || this._lastEmittedData.currentPrice !== currentPrice) {
                eventBus.emit('price:updated', { price: currentPrice });
            }
            
            // Only emit balances updated if balances changed
            if (balancesChanged) {
                eventBus.emit('balances:updated', balances);
            }

        } catch (error) {
            console.error('Error updating contract data:', error);
            throw error;
        }
    }

    startContractUpdates() {
        this.stopContractUpdates(); // Clear any existing interval

        // Initial contract data fetch
        this.debouncedUpdateContractData();
        
        // Set up interval for contract updates
        this._contractUpdateInterval = setInterval(() => {
            this.debouncedUpdateContractData();
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

    // Add a debounce wrapper for updateContractData
    debouncedUpdateContractData(address = null) {
        // Clear any existing timeout
        if (this._updateDebounceTimeout) {
            clearTimeout(this._updateDebounceTimeout);
        }
        
        // Set a new timeout
        this._updateDebounceTimeout = setTimeout(() => {
            // Use provided address or get from store
            const addressToUse = address || tradingStore.selectConnectedAddress();
            this.updateContractData(addressToUse)
                .catch(error => {
                    console.error('Failed to update contract data:', error);
                });
        }, this._updateDebounceDelay);
    }
}

// Export singleton instance
export const priceService = new PriceService();
export default priceService; 