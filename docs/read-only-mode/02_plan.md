# Read-Only Mode Architecture & Bootstrap Plan

**Date:** 2024  
**Branch:** `feature/read-only-mode`  
**Status:** Implementation Plan

## Architecture Overview

The Read-Only Mode provides a parallel access path to blockchain data without requiring wallet connection. It uses a light client (Helios) for verified reads with automatic fallback to public RPC endpoints.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Page Load (index.html)                 │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Load CDN Scripts: Helios + viem (with SRI hashes)     │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Initialize ReadOnlyService (parallel to WalletService) │
└──────────────────────┬────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌──────────────────┐        ┌──────────────────┐
│  Try Helios      │        │  Fallback: viem   │
│  (2s timeout)    │        │  Public RPC       │
└────────┬─────────┘        └────────┬──────────┘
         │                            │
         │ Success                    │ Success
         │                            │
         └────────────┬───────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Poll Block Info       │
         │  (every 30s)            │
         │  Log to Console        │
         └────────────────────────┘
```

## Light-Client Flow (Helios)

### Initialization

1. **Load Helios WASM:**
   ```javascript
   const helios = await Helios.init({ network: "mainnet" });
   ```

2. **Verify Consensus Headers:**
   - Helios syncs with Ethereum network
   - Verifies block headers cryptographically
   - Establishes trustless connection

3. **Get Verified Header:**
   ```javascript
   const header = await helios.getHeader();
   console.log("[ReadOnly] Verified header:", header);
   ```

### Timeout & Fallback

- **Timeout:** 2000ms (2 seconds)
- **If timeout or error:** Immediately fallback to RPC
- **Log:** `[ReadOnly] Helios failed, falling back to public RPC`

## RPC Fallback Flow (viem)

### Health-Check Rotation

1. **RPC Endpoints (in order):**
   - `https://cloudflare-eth.com`
   - `https://ethereum.publicnode.com`
   - `https://rpc.ankr.com/eth`

2. **Health Check:**
   ```javascript
   async function healthCheck(url) {
     try {
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
       return response.ok;
     } catch (e) {
       return false;
     }
   }
   ```

3. **Rotation Logic:**
   - Try first endpoint
   - If fails, try next (max 3 attempts)
   - Cache successful endpoint for 5 minutes
   - Rotate on rate limit (429) or timeout

### Public Client Setup

```javascript
const provider = viem.createPublicClient({
  transport: viem.http(selectedRpcUrl)
});

const blockNumber = await provider.getBlockNumber();
console.log("[ReadOnly] RPC fallback block:", blockNumber);
```

## UI Toggle (Future - Phase 1: Hidden)

For Phase 1, read-only mode runs silently in background. Future phases will add:

- **Badge:** Small indicator showing "Read-Only Mode" active
- **Status:** Block number, gas price, chain ID display
- **Toggle:** User can enable/disable read-only mode

## Debug Focus

### Console Logging

All read-only mode logs prefixed with `[ReadOnly]`:

```
[ReadOnly] Initializing Helios...
[ReadOnly] Verified header: { number: 18500000, hash: "0x...", ... }
[ReadOnly] Block #18500000 | Gas: 20 gwei | Chain: 1
```

### Logged Information

- **Block Number:** Current verified/RPC block
- **Gas Price:** Current gas price (if available)
- **Chain ID:** Network chain ID (1 for mainnet)
- **Mode:** "helios" or "rpc" (which provider is active)
- **Timestamp:** When data was fetched

### Polling Interval

- **Default:** 30 seconds
- **Configurable:** Via `ReadOnlyService.config.pollInterval`
- **On Error:** Exponential backoff (30s → 60s → 120s, max 5min)

## Timeout & Retry Strategy

### Helios Initialization

- **Timeout:** 2000ms
- **Retries:** 0 (immediate fallback to RPC)
- **Reason:** Light client init can be slow; RPC is faster for read-only

### RPC Requests

- **Timeout:** 5000ms per request
- **Retries:** 3 attempts per endpoint
- **Rotation:** On failure, try next endpoint
- **Backoff:** None (immediate rotation)

### Polling

- **Interval:** 30 seconds (configurable)
- **On Error:** Exponential backoff
  - First error: 30s → 60s
  - Second error: 60s → 120s
  - Third error: 120s → 300s (5min max)
  - On success: Reset to 30s

## Implementation Structure

### File: `src/services/ReadOnlyService.js`

```javascript
class ReadOnlyService {
  constructor() {
    this.mode = null; // 'helios' | 'rpc' | 'disabled'
    this.provider = null;
    this.config = {
      heliosTimeout: 2000,
      pollInterval: 30000,
      rpcEndpoints: [...],
      maxRetries: 3
    };
    this.pollTimer = null;
    this.lastBlock = null;
  }

  async initialize() { ... }
  async tryHelios() { ... }
  async tryRpc() { ... }
  async healthCheck(url) { ... }
  async pollBlockInfo() { ... }
  logBlockInfo(block) { ... }
}
```

### Integration: `src/index.js`

```javascript
// Initialize read-only mode in parallel (non-blocking)
ReadOnlyService.initialize().catch(err => {
  console.warn('[ReadOnly] Failed to initialize:', err);
  // Don't block app initialization
});
```

## Error Handling

### Common Failure Signatures

1. **WASM Load Failure:**
   - Error: `Failed to load WASM module`
   - Action: Fallback to RPC immediately

2. **CORS Error:**
   - Error: `CORS policy blocked`
   - Action: Try next RPC endpoint

3. **Rate Limit:**
   - Error: `429 Too Many Requests`
   - Action: Rotate to next endpoint, cache for 1 minute

4. **Network Timeout:**
   - Error: `Request timeout`
   - Action: Retry with next endpoint

5. **Helios Init Timeout:**
   - Error: `Helios init > 2000ms`
   - Action: Cancel, fallback to RPC

## Caching Strategy

### Last Successful Header

- **Cache:** `localStorage.getItem('ms2fun_readOnly_lastBlock')`
- **TTL:** 30 seconds
- **Usage:** Display cached value while fetching new data
- **Invalidation:** On successful poll or network change

### Successful RPC Endpoint

- **Cache:** `localStorage.getItem('ms2fun_readOnly_rpcEndpoint')`
- **TTL:** 5 minutes
- **Usage:** Prefer cached endpoint on next init
- **Invalidation:** On failure or rate limit

## Mobile Considerations

### Bundle Size

- **Helios:** ~500-800 KB (WASM + JS)
- **viem:** ~200-300 KB
- **Total:** ~700-1100 KB
- **Impact:** Acceptable for Phase 1 (one-time load)

### Performance

- **Helios Init:** < 3s target (2s timeout)
- **RPC Fallback:** < 1s typically
- **Polling:** Background, doesn't block UI

### Compatibility

- **iOS Safari:** WASM supported (iOS 11+)
- **Android Chrome:** WASM supported (Chrome 57+)
- **Fallback:** RPC works everywhere

## Success Criteria

✅ **No wallet installed:** Console shows verified or RPC block reads  
✅ **Wallet installed but not connected:** Identical behavior  
✅ **Wallet connected:** Legacy flow unaffected, read-only still logs  
✅ **Helios logs appear first; RPC fallback logged if Helios > 2s init**  
✅ **All libraries loaded via CDN, pinned, and documented with SRI**  
✅ **New branch `feature/read-only-mode` created; all docs follow structure**

## Next Steps

1. Implement `ReadOnlyService.js`
2. Add CDN script tags to `index.html`
3. Integrate into `src/index.js`
4. Test all scenarios
5. Document SRI hashes

