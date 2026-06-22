/**
 * ReadOnlyService - Provides read-only blockchain access without wallet
 * 
 * This service initializes a light client (Helios) or falls back to public RPC
 * to allow users to read blockchain data without connecting a wallet.
 * 
 * Phase 1: Logs block info to console only (no UI changes)
 */

class ReadOnlyService {
    constructor() {
        this.mode = null; // 'helios' | 'rpc' | 'disabled'
        this.provider = null;
        this.helios = null;
        this.pollTimer = null;
        this.lastBlock = null;
        this.lastBlockTime = null;
        this.retryCount = 0;
        this.currentRpcIndex = 0;
        this.pollInterval = 30000; // 30 seconds
        this.backoffMultiplier = 1;
        
        // Configuration
        this.config = {
            heliosTimeout: 2000, // 2 seconds
            pollInterval: 30000, // 30 seconds
            maxRetries: 3,
            rpcEndpoints: [
                'https://cloudflare-eth.com',
                'https://ethereum.publicnode.com',
                'https://rpc.ankr.com/eth'
            ],
            chainId: 1 // mainnet
        };
        
        // Check if read-only mode is enabled (default: true)
        const enabled = localStorage.getItem('ms2fun_readOnlyEnabled');
        this.enabled = enabled === null ? true : enabled === 'true';
    }
    
    /**
     * Initialize read-only service
     * Tries Helios first, falls back to RPC if timeout or failure
     * This is called lazily when user clicks "Continue" button
     */
    async initialize() {
        if (!this.enabled) {
            console.log('[ReadOnly] Read-only mode is disabled');
            return;
        }
        
        // If already initialized, don't reinitialize
        if (this.mode && this.mode !== 'disabled') {
            console.log('[ReadOnly] Already initialized, skipping');
            // Ensure polling is active if already initialized
            if (!this.pollTimer && (this.provider || this.helios)) {
                this.startPolling();
            }
            return;
        }
        
        console.log('[ReadOnly] Initializing read-only mode (lazy-loaded)...');
        
        try {
            // Try Helios first (with timeout)
            const heliosSuccess = await this.tryHelios();
            
            if (!heliosSuccess) {
                // Fallback to RPC
                await this.tryRpc();
            }
            
            // Start polling if we have a provider (only once)
            if (this.provider || this.helios) {
                if (!this.pollTimer) {
                    this.startPolling();
                }
            }
        } catch (error) {
            console.error('[ReadOnly] Initialization failed:', error);
            this.mode = 'disabled';
            throw error; // Re-throw so caller knows it failed
        }
    }
    
    /**
     * Try to initialize Helios light client
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async tryHelios() {
        // Check if Helios is available
        if (typeof window.Helios === 'undefined') {
            console.log('[ReadOnly] Helios not available, skipping light client');
            return false;
        }
        
        console.log('[ReadOnly] Attempting to initialize Helios light client...');
        
        try {
            // Create a promise that will timeout after 2 seconds
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Helios initialization timeout')), this.config.heliosTimeout);
            });
            
            // Race between Helios init and timeout
            const heliosPromise = window.Helios.init({ network: 'mainnet' });
            
            this.helios = await Promise.race([heliosPromise, timeoutPromise]);
            
            // Get verified header
            const header = await this.helios.getHeader();
            
            this.mode = 'helios';
            this.provider = this.helios; // Use helios as provider
            
            console.log('[ReadOnly] ✓ Helios initialized successfully');
            console.log('[ReadOnly] Verified header:', {
                number: header.number,
                hash: header.hash,
                timestamp: header.timestamp
            });
            
            // Log initial block info
            await this.logBlockInfo({
                number: header.number,
                hash: header.hash,
                timestamp: header.timestamp
            });
            
            return true;
        } catch (error) {
            console.warn('[ReadOnly] Helios initialization failed, falling back to public RPC:', error.message);
            return false;
        }
    }
    
    /**
     * Try to initialize public RPC provider
     * Uses health-check rotation to find working endpoint
     */
    async tryRpc() {
        console.log('[ReadOnly] Initializing public RPC fallback...');
        
        // Try to use cached RPC endpoint first
        const cachedEndpoint = localStorage.getItem('ms2fun_readOnly_rpcEndpoint');
        if (cachedEndpoint && this.config.rpcEndpoints.includes(cachedEndpoint)) {
            const index = this.config.rpcEndpoints.indexOf(cachedEndpoint);
            if (index !== -1) {
                this.currentRpcIndex = index;
            }
        }
        
        // Try each RPC endpoint until one works
        for (let attempt = 0; attempt < this.config.rpcEndpoints.length; attempt++) {
            const endpoint = this.config.rpcEndpoints[this.currentRpcIndex];
            
            console.log(`[ReadOnly] Trying RPC endpoint: ${endpoint}`);
            
            const isHealthy = await this.healthCheck(endpoint);
            
            if (isHealthy) {
                try {
                    // Try to load viem dynamically if available
                    let viemLoaded = false;
                    try {
                        const viemModule = await import('https://cdn.jsdelivr.net/npm/viem@latest/dist/esm/index.js');
                        if (viemModule.createPublicClient && viemModule.http && viemModule.mainnet) {
                            this.provider = viemModule.createPublicClient({
                                transport: viemModule.http(endpoint),
                                chain: viemModule.mainnet
                            });
                            this.mode = 'rpc';
                            viemLoaded = true;
                            
                            // Cache successful endpoint
                            localStorage.setItem('ms2fun_readOnly_rpcEndpoint', endpoint);
                            
                            console.log('[ReadOnly] ✓ RPC provider initialized with viem:', endpoint);
                            
                            // Test connection
                            const blockNumber = await this.provider.getBlockNumber();
                            console.log('[ReadOnly] RPC connection test successful, block:', blockNumber.toString());
                            
                            return true;
                        }
                    } catch (viemError) {
                        // viem not available or failed to load, use fetch fallback
                        console.log('[ReadOnly] viem not available, using fetch-based RPC:', viemError.message);
                    }
                    
                    // Fallback to fetch-based RPC calls
                    if (!viemLoaded) {
                        this.provider = { type: 'fetch', url: endpoint };
                        this.mode = 'rpc';
                        localStorage.setItem('ms2fun_readOnly_rpcEndpoint', endpoint);
                        
                        // Test connection
                        const blockNumber = await this.fetchBlockNumber(endpoint);
                        console.log('[ReadOnly] ✓ Fetch RPC connection test successful, block:', blockNumber);
                        
                        return true;
                    }
                } catch (error) {
                    console.warn(`[ReadOnly] Failed to initialize RPC provider for ${endpoint}:`, error.message);
                    // Try next endpoint
                    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.config.rpcEndpoints.length;
                }
            } else {
                console.warn(`[ReadOnly] Health check failed for ${endpoint}`);
                this.currentRpcIndex = (this.currentRpcIndex + 1) % this.config.rpcEndpoints.length;
            }
        }
        
        console.error('[ReadOnly] All RPC endpoints failed');
        this.mode = 'disabled';
        return false;
    }
    
    /**
     * Health check for RPC endpoint
     * @param {string} url - RPC endpoint URL
     * @returns {Promise<boolean>} True if healthy, false otherwise
     */
    async healthCheck(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                return false;
            }
            
            const data = await response.json();
            return data && data.result;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Fetch block number using fetch API (fallback when viem not available)
     * @param {string} url - RPC endpoint URL
     * @returns {Promise<number>} Block number
     */
    async fetchBlockNumber(url) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            })
        });
        
        if (!response.ok) {
            throw new Error(`RPC request failed: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message || 'RPC error');
        }
        
        return parseInt(data.result, 16);
    }
    
    /**
     * Fetch block info using fetch API (fallback when viem not available)
     * @param {string} url - RPC endpoint URL
     * @param {number} blockNumber - Block number (or 'latest')
     * @returns {Promise<Object>} Block info
     */
    async fetchBlockInfo(url, blockNumber = 'latest') {
        const blockNumberHex = typeof blockNumber === 'number' 
            ? '0x' + blockNumber.toString(16) 
            : blockNumber;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getBlockByNumber',
                params: [blockNumberHex, false], // false = return transaction hashes only
                id: 1
            })
        });
        
        if (!response.ok) {
            throw new Error(`RPC request failed: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message || 'RPC error');
        }
        
        return data.result;
    }
    
    /**
     * Start polling for block updates
     */
    startPolling() {
        // Prevent multiple polling timers
        if (this.pollTimer) {
            console.log('[ReadOnly] Polling already active, skipping start');
            return;
        }
        
        // Poll immediately
        this.pollBlockInfo();
        
        // Then poll at intervals
        const interval = this.pollInterval * this.backoffMultiplier;
        this.pollTimer = setInterval(() => {
            this.pollBlockInfo();
        }, interval);
        
        console.log(`[ReadOnly] Started polling every ${interval}ms`);
    }
    
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    
    /**
     * Poll for latest block info
     */
    async pollBlockInfo() {
        try {
            let blockInfo = null;
            
            if (this.mode === 'helios' && this.helios) {
                // Get header from Helios
                const header = await this.helios.getHeader();
                blockInfo = {
                    number: header.number,
                    hash: header.hash,
                    timestamp: header.timestamp,
                    gasPrice: null // Helios header might not have gas price
                };
            } else if (this.mode === 'rpc' && this.provider) {
                // Get block from RPC
                if (this.provider.getBlockNumber && typeof this.provider.getBlockNumber === 'function') {
                    // viem provider
                    try {
                        const blockNumber = await this.provider.getBlockNumber();
                        const block = await this.provider.getBlock({ blockNumber });
                        
                        blockInfo = {
                            number: Number(blockNumber),
                            hash: block.hash,
                            timestamp: Number(block.timestamp),
                            gasPrice: block.baseFeePerGas ? Number(block.baseFeePerGas) : null
                        };
                    } catch (viemError) {
                        // If viem fails, fallback to fetch
                        console.warn('[ReadOnly] viem provider failed, falling back to fetch:', viemError.message);
                        const blockNumber = await this.fetchBlockNumber(this.provider.url || this.config.rpcEndpoints[this.currentRpcIndex]);
                        const block = await this.fetchBlockInfo(this.provider.url || this.config.rpcEndpoints[this.currentRpcIndex], blockNumber);
                        
                        blockInfo = {
                            number: parseInt(block.number, 16),
                            hash: block.hash,
                            timestamp: parseInt(block.timestamp, 16),
                            gasPrice: block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : null
                        };
                    }
                } else if (this.provider.type === 'fetch' || this.provider.url) {
                    // Fetch-based provider
                    const url = this.provider.url || this.config.rpcEndpoints[this.currentRpcIndex];
                    const blockNumber = await this.fetchBlockNumber(url);
                    const block = await this.fetchBlockInfo(url, blockNumber);
                    
                    blockInfo = {
                        number: parseInt(block.number, 16),
                        hash: block.hash,
                        timestamp: parseInt(block.timestamp, 16),
                        gasPrice: block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : null
                    };
                }
            }
            
            if (blockInfo) {
                await this.logBlockInfo(blockInfo);
                this.lastBlock = blockInfo;
                this.lastBlockTime = Date.now();
                
                // Reset backoff on success
                this.backoffMultiplier = 1;
                this.retryCount = 0;
                
                // Update polling interval if it was backed off
                if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.startPolling();
                }
            }
        } catch (error) {
            console.error('[ReadOnly] Error polling block info:', error);
            
            // Exponential backoff on error
            this.retryCount++;
            if (this.retryCount >= 3) {
                this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 10); // Max 10x
                console.warn(`[ReadOnly] Backing off polling to ${this.pollInterval * this.backoffMultiplier}ms`);
                
                // Restart polling with new interval
                if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.startPolling();
                }
            }
            
            // Try to recover by reinitializing RPC if in RPC mode
            if (this.mode === 'rpc' && this.retryCount >= 5) {
                console.log('[ReadOnly] Attempting to recover RPC connection...');
                await this.tryRpc();
            }
        }
    }
    
    /**
     * Log block info to console
     * @param {Object} blockInfo - Block information
     */
    async logBlockInfo(blockInfo) {
        const gasPriceGwei = blockInfo.gasPrice 
            ? (Number(blockInfo.gasPrice) / 1e9).toFixed(2) 
            : 'N/A';
        
        const timestamp = new Date(blockInfo.timestamp * 1000).toISOString();
        
        console.log(
            `[ReadOnly] Block #${blockInfo.number} | ` +
            `Gas: ${gasPriceGwei} gwei | ` +
            `Chain: ${this.config.chainId} | ` +
            `Mode: ${this.mode.toUpperCase()} | ` +
            `Time: ${timestamp}`
        );
        
        // Cache last block
        localStorage.setItem('ms2fun_readOnly_lastBlock', JSON.stringify({
            ...blockInfo,
            cachedAt: Date.now()
        }));
    }
    
    /**
     * Get current block info (cached or fresh)
     * @returns {Promise<Object|null>} Block info or null
     */
    async getCurrentBlockInfo() {
        // Return cached if available and fresh (< 30s old)
        const cached = localStorage.getItem('ms2fun_readOnly_lastBlock');
        if (cached) {
            try {
                const cachedData = JSON.parse(cached);
                const age = Date.now() - cachedData.cachedAt;
                if (age < 30000) { // 30 seconds
                    return cachedData;
                }
            } catch (e) {
                // Invalid cache, ignore
            }
        }
        
        // Return last polled block if available
        if (this.lastBlock) {
            return this.lastBlock;
        }
        
        // Otherwise trigger a fresh poll
        await this.pollBlockInfo();
        return this.lastBlock;
    }
    
    /**
     * Enable/disable read-only mode
     * @param {boolean} enabled - Whether to enable
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        localStorage.setItem('ms2fun_readOnlyEnabled', enabled.toString());
        
        if (enabled) {
            this.initialize();
        } else {
            this.stopPolling();
            this.mode = 'disabled';
            console.log('[ReadOnly] Read-only mode disabled');
        }
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopPolling();
        this.provider = null;
        this.helios = null;
        this.mode = 'disabled';
    }
}

// Create singleton instance
const readOnlyService = new ReadOnlyService();

export default readOnlyService;

