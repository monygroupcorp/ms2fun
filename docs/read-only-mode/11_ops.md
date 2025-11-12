# Read-Only Mode Operations & Maintenance

**Date:** 2024  
**Branch:** `feature/read-only-mode`  
**Status:** Operations Guide

## Overview

This document provides operational guidance for maintaining and troubleshooting the Read-Only Mode feature.

## RPC Management

### Adding New RPC Endpoints

**Location:** `src/services/ReadOnlyService.js`

**Configuration:**
```javascript
this.config = {
    rpcEndpoints: [
        'https://cloudflare-eth.com',
        'https://ethereum.publicnode.com',
        'https://rpc.ankr.com/eth',
        // Add new endpoints here
        'https://your-new-rpc-endpoint.com'
    ]
};
```

**Steps:**
1. Add endpoint URL to `rpcEndpoints` array
2. Test endpoint health: `curl -X POST https://your-new-rpc-endpoint.com -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
3. Deploy and monitor for rate limits or errors

### Rotating RPC Endpoints

**When to Rotate:**
- Endpoint returns 429 (rate limit) consistently
- Endpoint times out frequently
- Endpoint returns incorrect data
- Endpoint is deprecated or shut down

**How to Rotate:**
1. Remove problematic endpoint from `rpcEndpoints` array
2. Add replacement endpoint
3. Clear cached endpoint: `localStorage.removeItem('ms2fun_readOnly_rpcEndpoint')`
4. Deploy update

**Automatic Rotation:**
- Service automatically rotates on health check failure
- Cached endpoint is cleared after 5 minutes of failures
- Manual rotation not required for temporary issues

## Polling Interval Adjustment

### Changing Default Polling Interval

**Location:** `src/services/ReadOnlyService.js`

**Configuration:**
```javascript
this.config = {
    pollInterval: 30000, // 30 seconds (default)
    // ...
};
```

**Recommended Intervals:**
- **Fast (10s):** For real-time applications, higher RPC load
- **Normal (30s):** Default, balanced performance
- **Slow (60s):** For low-traffic sites, reduce RPC load
- **Very Slow (300s):** For background monitoring only

**Runtime Adjustment:**
```javascript
// In browser console
const readOnlyService = await import('./src/services/ReadOnlyService.js');
readOnlyService.default.config.pollInterval = 60000; // 60 seconds
readOnlyService.default.stopPolling();
readOnlyService.default.startPolling();
```

### Exponential Backoff

**Behavior:**
- On error: Interval doubles (30s → 60s → 120s → 300s max)
- On success: Resets to configured interval
- Prevents spam during outages

**Adjusting Backoff:**
```javascript
// In ReadOnlyService.js
this.backoffMultiplier = 1; // Reset on each poll
// Max backoff is 10x (300s for 30s base)
```

## Feature Flags

### Enabling/Disabling Read-Only Mode

**Via localStorage:**
```javascript
// Disable
localStorage.setItem('ms2fun_readOnlyEnabled', 'false');
location.reload();

// Enable
localStorage.setItem('ms2fun_readOnlyEnabled', 'true');
location.reload();
```

**Via Code:**
```javascript
// In browser console
const readOnlyService = await import('./src/services/ReadOnlyService.js');
readOnlyService.default.setEnabled(false); // Disable
readOnlyService.default.setEnabled(true);  // Enable
```

### Disabling Helios by Default

**Location:** `src/services/ReadOnlyService.js`

**Modification:**
```javascript
async tryHelios() {
    // Skip Helios initialization
    return false;
    
    // Or add feature flag
    const heliosEnabled = localStorage.getItem('ms2fun_heliosEnabled') !== 'false';
    if (!heliosEnabled) {
        return false;
    }
    // ... rest of method
}
```

## Caching Strategy

### Last Successful Header Cache

**Storage:** `localStorage.getItem('ms2fun_readOnly_lastBlock')`

**Format:**
```json
{
    "number": 18500000,
    "hash": "0x...",
    "timestamp": 1234567890,
    "gasPrice": 20000000000,
    "cachedAt": 1234567890123
}
```

**TTL:** 30 seconds (hardcoded in `getCurrentBlockInfo()`)

**Clearing Cache:**
```javascript
localStorage.removeItem('ms2fun_readOnly_lastBlock');
```

### Successful RPC Endpoint Cache

**Storage:** `localStorage.getItem('ms2fun_readOnly_rpcEndpoint')`

**Format:** String URL (e.g., `"https://cloudflare-eth.com"`)

**TTL:** 5 minutes (implicit, cleared on failure)

**Clearing Cache:**
```javascript
localStorage.removeItem('ms2fun_readOnly_rpcEndpoint');
```

## Common Failure Signatures

### WASM Load Failure

**Symptoms:**
```
[ReadOnly] Helios not available, skipping light client
```

**Causes:**
- Helios library not loaded
- WASM file blocked by CSP
- Browser doesn't support WASM

**Resolution:**
- Check browser console for CSP errors
- Verify Helios CDN is accessible
- Fallback to RPC (automatic)

**Prevention:**
- Helios is optional, RPC fallback always available
- No action needed if RPC works

### CORS Error

**Symptoms:**
```
[ReadOnly] Health check failed for https://...
CORS policy blocked
```

**Causes:**
- RPC endpoint doesn't allow cross-origin requests
- Browser blocks CORS requests

**Resolution:**
- Rotate to different RPC endpoint
- Service automatically tries next endpoint

**Prevention:**
- Use public RPCs that support CORS
- Test endpoints before adding to config

### Rate Limit (429)

**Symptoms:**
```
[ReadOnly] Failed to initialize RPC provider for https://...
429 Too Many Requests
```

**Causes:**
- Too many requests to same endpoint
- Public RPC rate limiting

**Resolution:**
- Service automatically rotates to next endpoint
- Increase polling interval to reduce load
- Clear cached endpoint to force rotation

**Prevention:**
- Use multiple RPC endpoints (already configured)
- Respect rate limits (30s polling is reasonable)
- Monitor for excessive requests

### Network Timeout

**Symptoms:**
```
[ReadOnly] Error polling block info: Request timeout
```

**Causes:**
- Slow network connection
- RPC endpoint is down
- Firewall blocking requests

**Resolution:**
- Service automatically retries with backoff
- Rotates to next endpoint after 3 failures
- Check network connectivity

**Prevention:**
- Use reliable RPC endpoints
- Implement health checks (already done)
- Monitor endpoint availability

### Helios Init Timeout

**Symptoms:**
```
[ReadOnly] Helios initialization failed, falling back to public RPC: Helios initialization timeout
```

**Causes:**
- Helios sync takes > 2 seconds
- Network is slow
- Helios WASM is large

**Resolution:**
- Automatic fallback to RPC (expected behavior)
- No action needed

**Prevention:**
- 2s timeout is reasonable
- RPC is faster for read-only use case

## Monitoring

### Console Logs

**All logs prefixed with `[ReadOnly]`:**

- `[ReadOnly] Initializing read-only mode...`
- `[ReadOnly] ✓ RPC provider initialized: ...`
- `[ReadOnly] Block #18500000 | Gas: 20.00 gwei | Chain: 1 | Mode: RPC`

**Monitoring:**
- Check browser console for errors
- Look for consistent failures
- Monitor polling frequency

### Performance Metrics

**Key Metrics:**
- Init time: Should be < 1s for RPC, < 3s for Helios
- Polling interval: Should match configured value
- Error rate: Should be < 1% for healthy endpoints

**Measuring:**
```javascript
// In browser console
performance.mark('readOnlyStart');
// ... wait for init
performance.mark('readOnlyEnd');
performance.measure('readOnlyInit', 'readOnlyStart', 'readOnlyEnd');
console.log(performance.getEntriesByName('readOnlyInit')[0].duration);
```

## Troubleshooting

### Read-Only Mode Not Initializing

**Check:**
1. Browser console for errors
2. `localStorage.getItem('ms2fun_readOnlyEnabled')` (should be `'true'` or `null`)
3. Network tab for failed CDN requests
4. CSP headers for blocked scripts

**Fix:**
- Clear localStorage and reload
- Check CDN availability
- Verify CSP allows CDN scripts

### Block Info Not Updating

**Check:**
1. Polling timer is running: `readOnlyService.pollTimer !== null`
2. Provider is initialized: `readOnlyService.mode !== null`
3. Console for error messages

**Fix:**
- Restart polling: `readOnlyService.stopPolling(); readOnlyService.startPolling();`
- Reinitialize: `readOnlyService.initialize()`

### All RPC Endpoints Failing

**Check:**
1. Network connectivity
2. Firewall/proxy blocking RPC requests
3. RPC endpoints are accessible: `curl -X POST https://cloudflare-eth.com ...`

**Fix:**
- Add new RPC endpoints to config
- Check network/firewall settings
- Verify RPC endpoints are operational

## Maintenance Schedule

### Weekly
- Check RPC endpoint health
- Review error logs
- Monitor polling performance

### Monthly
- Rotate RPC endpoints if needed
- Update CDN library versions (if pinned)
- Review and update documentation

### As Needed
- Add new RPC endpoints
- Adjust polling intervals
- Fix critical bugs

## Support

**For Issues:**
1. Check browser console for `[ReadOnly]` logs
2. Review this operations guide
3. Check `docs/read-only-mode/04_testing.md` for test procedures
4. File issue with console logs and error messages

**For Questions:**
- Review architecture docs: `docs/read-only-mode/02_plan.md`
- Check investigation report: `docs/read-only-mode/00_investigation.md`

