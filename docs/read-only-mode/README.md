# Read-Only Mode Implementation

**Branch:** `feature/read-only-mode`  
**Status:** ✅ Phase 1 Complete (A-Tier)

## Overview

The Read-Only Mode provides parallel access to blockchain data without requiring wallet connection. It uses public RPC endpoints (with optional Helios light client) to fetch and log block information to the console.

## Quick Start

### For Users

1. Open the site in your browser
2. Open browser console (F12 or Cmd+Option+I)
3. Look for `[ReadOnly]` prefixed logs showing block numbers, gas prices, and chain info
4. Logs update every 30 seconds automatically

### For Developers

**Files Modified:**
- `index.html` - Added read-only mode dependencies (viem loaded dynamically)
- `src/index.js` - Integrated read-only mode initialization
- `src/services/ReadOnlyService.js` - New service implementation

**Files Created:**
- `docs/read-only-mode/00_investigation.md` - System architecture investigation
- `docs/read-only-mode/01_subprompts.md` - Follow-up questions and decisions
- `docs/read-only-mode/02_plan.md` - Architecture and bootstrap plan
- `docs/read-only-mode/04_testing.md` - Testing procedures
- `docs/read-only-mode/10_s_tier_feasibility.md` - S-Tier P2P feasibility
- `docs/read-only-mode/11_ops.md` - Operations and maintenance guide

## Features

### Phase 1 (Current)

- ✅ **Public RPC Fallback:** Uses Cloudflare, PublicNode, Ankr endpoints
- ✅ **Health-Check Rotation:** Automatically rotates between endpoints
- ✅ **Console Logging:** Logs block info every 30 seconds
- ✅ **Error Handling:** Exponential backoff on failures
- ✅ **Caching:** Caches last successful block and RPC endpoint
- ✅ **Non-Blocking:** Doesn't interfere with wallet connection flow
- ✅ **Mobile Compatible:** Works on iOS Safari and Android Chrome

### Future Enhancements

- [ ] Helios light client integration (if CDN available)
- [ ] UI indicator for read-only mode
- [ ] Contract read functionality
- [ ] S-Tier P2P transport (Portal Network)

## Architecture

```
Page Load
    ↓
Initialize ReadOnlyService (parallel to WalletService)
    ↓
Try Helios (2s timeout) → Fallback to RPC
    ↓
Health-Check RPC Endpoints → Select Working Endpoint
    ↓
Start Polling (30s intervals)
    ↓
Log Block Info to Console
```

## Configuration

### Enable/Disable

```javascript
// Disable read-only mode
localStorage.setItem('ms2fun_readOnlyEnabled', 'false');
location.reload();

// Enable read-only mode
localStorage.setItem('ms2fun_readOnlyEnabled', 'true');
location.reload();
```

### Adjust Polling Interval

Edit `src/services/ReadOnlyService.js`:
```javascript
this.config = {
    pollInterval: 30000, // Change to desired interval (ms)
    // ...
};
```

### Add RPC Endpoints

Edit `src/services/ReadOnlyService.js`:
```javascript
this.config = {
    rpcEndpoints: [
        'https://cloudflare-eth.com',
        'https://ethereum.publicnode.com',
        'https://rpc.ankr.com/eth',
        'https://your-new-endpoint.com' // Add here
    ],
    // ...
};
```

## Testing

See `docs/read-only-mode/04_testing.md` for complete testing procedures.

**Quick Test:**
1. Open site without wallet
2. Check console for `[ReadOnly]` logs
3. Verify logs appear every 30 seconds

## Troubleshooting

### Read-Only Mode Not Working

1. Check console for errors
2. Verify `localStorage.getItem('ms2fun_readOnlyEnabled')` is not `'false'`
3. Check Network tab for failed CDN requests
4. See `docs/read-only-mode/11_ops.md` for detailed troubleshooting

### Common Issues

- **CORS Errors:** RPC endpoint doesn't allow cross-origin → Automatic rotation
- **Rate Limits:** Too many requests → Automatic rotation + backoff
- **Network Timeout:** Slow connection → Exponential backoff

## Documentation

- **Investigation:** `00_investigation.md` - System analysis
- **Architecture:** `02_plan.md` - Implementation plan
- **Testing:** `04_testing.md` - Test procedures
- **Operations:** `11_ops.md` - Maintenance guide
- **S-Tier:** `10_s_tier_feasibility.md` - P2P feasibility

## Acceptance Criteria

✅ **No wallet installed:** Console shows verified or RPC block reads  
✅ **Wallet installed but not connected:** Identical behavior  
✅ **Wallet connected:** Legacy flow unaffected  
✅ **Helios logs appear first; RPC fallback logged if Helios > 2s init**  
✅ **All libraries loaded via CDN, pinned, and documented**  
✅ **New branch `feature/read-only-mode` created; all docs follow structure**

## Next Steps

1. **Test on Desktop:** Chrome, Firefox, Safari, Edge
2. **Test on Mobile:** iOS Safari, Android Chrome
3. **Monitor Performance:** Init time, bundle size, polling performance
4. **Gather Feedback:** User experience, error rates
5. **Plan Phase 2:** UI integration, contract reads, Helios CDN

## Support

For issues or questions:
1. Check `docs/read-only-mode/11_ops.md` for troubleshooting
2. Review console logs (look for `[ReadOnly]` prefix)
3. Check Network tab for failed requests
4. File issue with console logs and error messages

## License

Same as main project.

