import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';

/**
 * PriceService - Handles fetching and caching price and contract data
 * 
 * Event Flow Architecture:
 * 1. BlockchainService emits 'contract:updated' on network changes, initialization, etc.
 * 2. PriceService listens for these events and aggregates data into a single update
 * 3. PriceService updates the store with all contract data
 * 4. PriceService emits 'contractData:updated' after store updates (batched)
 * 5. UI components subscribe to store and/or listen for 'contractData:updated'
 * 
 * Key Guidelines:
 * - Components should avoid remounting on every update
 * - Prefer calling .update() on child components over remounting
 * - Events should be batched to reduce UI thrashing
 * - Components should clean up listeners in onUnmount()
 */
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
        
        if (this._updateInProgress) {
            console.log('Contract data update already in progress, skipping');
            return;
        }
        
        this._updateInProgress = true;
        
        try {
            // Phase 1: Get minimal data to determine phase
            const [liquidityPool, currentTier] = await Promise.all([
                this._blockchainService.getLiquidityPool(),
                this._blockchainService.getCurrentTier()
            ]);

            // Immediately update store with phase-determining data
            tradingStore.updateContractData({ liquidityPool, currentTier });
            
            // Determine phase early
            const isPhase2 = liquidityPool !== '0x0000000000000000000000000000000000000000';
            
            // Phase 2: Load Uniswap pool data first
            if (isPhase2) {
                const [reserve0, reserve1] = await this._blockchainService.executeContractCall(
                    'getReserves',
                    [],
                    { useContract: 'v2pool' }
                );

                tradingStore.updatePoolData({ liquidityPool, reserve0, reserve1 });
                
                // Get price from pool directly
                const isToken0 = await this._blockchainService.isToken0(liquidityPool, address);
                const price = isToken0 ? 
                    1 / await this._blockchainService.getToken0PriceInToken1(liquidityPool) : 
                    await this._blockchainService.getToken0PriceInToken1(liquidityPool);
                
                tradingStore.updatePrice(price * 1000000);
            }
            // Phase 1: Load bonding curve data
            else {
                const [currentPrice, totalBondingSupply] = await Promise.all([
                    this._blockchainService.getCurrentPrice(),
                    this._blockchainService.getTotalBondingSupply()
                ]);
                
                tradingStore.updatePrice(currentPrice);
                tradingStore.updateContractData({ totalBondingSupply });
            }

            // Load common data needed for both phases
            const [ethBalance, tokenBalance, nftBalance] = await Promise.all([
                this._blockchainService.getEthBalance(address),
                this._blockchainService.getTokenBalance(address),
                this._blockchainService.getNFTBalance(address)
            ]);

            tradingStore.updateBalances({
                eth: ethBalance,
                exec: tokenBalance,
                nfts: nftBalance,
            });

            // Load secondary phase-specific data in background
            if (isPhase2) {
                // Phase 2 secondary data
                this._loadSecondaryData([
                    this._blockchainService.getNFTSupply(),
                    this._blockchainService.getContractEthBalance()
                ]);
            } else {
                // Phase 1 secondary data
                this._loadSecondaryData([
                    this._blockchainService.getTotalMessages(),
                    this._blockchainService.getFreeSupply(),
                    this._blockchainService.getFreeMint(address)
                ]);
            }

        } catch (error) {
            console.error('Error updating contract data:', error);
        } finally {
            this._updateInProgress = false;
        }
    }

    // Helper to load non-critical path data after initial render
    async _loadSecondaryData(promises) {
        try {
            const results = await Promise.all(promises);
            // Update store with secondary data
            tradingStore.updateContractData(results);
        } catch (error) {
            console.error('Error loading secondary data:', error);
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