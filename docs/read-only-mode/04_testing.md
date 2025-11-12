# Read-Only Mode Testing Documentation

**Date:** 2024  
**Branch:** `feature/read-only-mode`  
**Status:** Testing Guide

## Overview

This document provides testing procedures and acceptance criteria for the Read-Only Mode feature.

## Test Scenarios

### Scenario 1: No Wallet Installed

**Setup:**
1. Open browser in incognito/private mode
2. Ensure no wallet extensions are installed
3. Navigate to site

**Expected Behavior:**
- Site loads normally (wallet splash may show, but read-only mode runs in background)
- Browser console shows `[ReadOnly]` logs:
  ```
  [ReadOnly] Initializing read-only mode...
  [ReadOnly] Initializing public RPC fallback...
  [ReadOnly] ✓ RPC provider initialized: https://cloudflare-eth.com
  [ReadOnly] RPC connection test successful, block: 18500000
  [ReadOnly] Started polling every 30000ms
  [ReadOnly] Block #18500000 | Gas: 20.00 gwei | Chain: 1 | Mode: RPC | Time: 2024-...
  ```
- Logs appear every 30 seconds with updated block numbers
- No errors in console

**Acceptance Criteria:**
- ✅ Console shows verified or RPC block reads
- ✅ Polling continues at 30-second intervals
- ✅ No wallet connection required

### Scenario 2: Wallet Installed but Not Connected

**Setup:**
1. Install MetaMask (or other wallet) extension
2. Do NOT connect wallet to site
3. Navigate to site

**Expected Behavior:**
- Identical to Scenario 1
- Wallet splash may show "Connect Wallet" button
- Read-only mode still runs in background
- Console shows same `[ReadOnly]` logs

**Acceptance Criteria:**
- ✅ Identical behavior to Scenario 1
- ✅ Wallet presence doesn't interfere with read-only mode
- ✅ Read-only mode works independently

### Scenario 3: Wallet Connected

**Setup:**
1. Install and connect wallet to site
2. Wallet is connected and site is functional
3. Navigate to site

**Expected Behavior:**
- Site functions normally with wallet connection
- Read-only mode still runs in background (optional)
- Console may show `[ReadOnly]` logs (if enabled)
- Wallet functionality is unaffected

**Acceptance Criteria:**
- ✅ Legacy wallet flow unaffected
- ✅ Read-only mode doesn't interfere with wallet operations
- ✅ Both can coexist (read-only logs may appear)

### Scenario 4: Helios Initialization (If Available)

**Setup:**
1. Helios library is loaded (if CDN available)
2. Navigate to site
3. Monitor console

**Expected Behavior:**
- Console shows:
  ```
  [ReadOnly] Attempting to initialize Helios light client...
  [ReadOnly] ✓ Helios initialized successfully
  [ReadOnly] Verified header: { number: 18500000, ... }
  ```
- OR if timeout:
  ```
  [ReadOnly] Helios initialization failed, falling back to public RPC: Helios initialization timeout
  [ReadOnly] Initializing public RPC fallback...
  ```

**Acceptance Criteria:**
- ✅ Helios logs appear first (if available)
- ✅ RPC fallback logged if Helios > 2s init
- ✅ Graceful fallback on Helios failure

### Scenario 5: RPC Endpoint Rotation

**Setup:**
1. Simulate first RPC endpoint failure (block in network tab)
2. Navigate to site
3. Monitor console

**Expected Behavior:**
- Console shows:
  ```
  [ReadOnly] Trying RPC endpoint: https://cloudflare-eth.com
  [ReadOnly] Health check failed for https://cloudflare-eth.com
  [ReadOnly] Trying RPC endpoint: https://ethereum.publicnode.com
  [ReadOnly] ✓ RPC provider initialized: https://ethereum.publicnode.com
  ```

**Acceptance Criteria:**
- ✅ Automatic rotation to next endpoint
- ✅ Successful connection after rotation
- ✅ Cached endpoint updated

### Scenario 6: Mobile Testing (iOS Safari)

**Setup:**
1. Open iOS Safari
2. Navigate to site
3. Open Safari Developer Tools (if available) or use Mac Safari remote debugging

**Expected Behavior:**
- Site loads
- Console shows `[ReadOnly]` logs (if accessible)
- No JavaScript errors
- Polling continues in background

**Acceptance Criteria:**
- ✅ Mobile compatibility confirmed
- ✅ No WASM/CORS errors
- ✅ RPC fallback works on mobile

### Scenario 7: Mobile Testing (Android Chrome)

**Setup:**
1. Open Android Chrome
2. Navigate to site
3. Use Chrome remote debugging

**Expected Behavior:**
- Identical to iOS Safari
- Console shows `[ReadOnly]` logs
- No errors

**Acceptance Criteria:**
- ✅ Android compatibility confirmed
- ✅ Performance acceptable (< 3s init)

## Performance Testing

### Init Time

**Target:** < 3 seconds

**Measurement:**
```javascript
// In browser console
performance.mark('readOnlyStart');
// Wait for init logs
performance.mark('readOnlyEnd');
performance.measure('readOnlyInit', 'readOnlyStart', 'readOnlyEnd');
console.log('Init time:', performance.getEntriesByName('readOnlyInit')[0].duration, 'ms');
```

**Acceptance:**
- ✅ RPC init: < 1s
- ✅ Helios init: < 3s (or fallback to RPC)

### Bundle Size

**Target:** < 1 MB additional

**Measurement:**
- Check Network tab for CDN requests
- Sum: viem.js + ReadOnlyService.js
- Should be < 1 MB total

**Acceptance:**
- ✅ Total added JS < 1 MB
- ✅ Light client init < 3s (if used)

### Polling Performance

**Target:** < 500ms per poll

**Measurement:**
- Monitor console logs for poll timing
- Check Network tab for RPC request duration

**Acceptance:**
- ✅ Poll completes in < 500ms
- ✅ No performance degradation over time

## Error Handling Testing

### Network Failure

**Test:**
1. Disable network after read-only mode initializes
2. Wait for polling interval
3. Re-enable network

**Expected:**
- Exponential backoff on errors
- Automatic recovery when network restored
- Console shows error logs with backoff

**Acceptance:**
- ✅ Graceful error handling
- ✅ Automatic recovery

### RPC Rate Limiting

**Test:**
1. Rapidly trigger multiple polls (if possible)
2. Monitor for 429 errors
3. Check endpoint rotation

**Expected:**
- Automatic rotation to next endpoint
- Backoff on repeated failures

**Acceptance:**
- ✅ Handles rate limits gracefully
- ✅ Rotates endpoints automatically

## Browser Compatibility

### Desktop Browsers

**Test:**
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Acceptance:**
- ✅ All major browsers supported
- ✅ No browser-specific errors

### Mobile Browsers

**Test:**
- iOS Safari (latest)
- Android Chrome (latest)

**Acceptance:**
- ✅ Mobile browsers supported
- ✅ Performance acceptable

## CDN & SRI Testing

### CDN Availability

**Test:**
1. Check Network tab for CDN requests
2. Verify viem loads from jsdelivr
3. Check for 200 status codes

**Acceptance:**
- ✅ CDN requests succeed
- ✅ Libraries load correctly

### SRI Hashes (Future)

**Test:**
1. Verify SRI hashes in script tags
2. Test with modified CDN content (should fail)
3. Verify fallback behavior

**Acceptance:**
- ✅ SRI hashes prevent MITM attacks
- ✅ Failed SRI triggers fallback

## Acceptance Checklist

### Functional Requirements

- ✅ **No wallet installed:** Site loads; console shows verified or RPC block reads
- ✅ **Wallet installed but not connected:** Identical behavior
- ✅ **Wallet connected:** Legacy flow unaffected
- ✅ **Helios logs appear first; RPC fallback logged if Helios > 2s init**
- ✅ **All libraries loaded via CDN, pinned, and documented with SRI**

### Technical Requirements

- ✅ **Bundle size:** < 1 MB additional
- ✅ **Init time:** < 3 seconds
- ✅ **Polling:** 30-second intervals (configurable)
- ✅ **Error handling:** Graceful fallback and recovery
- ✅ **Browser compatibility:** All major browsers

### Documentation Requirements

- ✅ **New branch `feature/read-only-mode` created**
- ✅ **All docs follow structure:**
  - `00_investigation.md`
  - `01_subprompts.md`
  - `02_plan.md`
  - `04_testing.md` (this file)
  - `10_s_tier_feasibility.md`
  - `11_ops.md`

## Test Results Template

```
Test Date: YYYY-MM-DD
Tester: [Name]
Browser: [Browser + Version]
OS: [OS + Version]

Scenario 1: No Wallet Installed
- [ ] Pass / [ ] Fail
- Notes: ...

Scenario 2: Wallet Installed but Not Connected
- [ ] Pass / [ ] Fail
- Notes: ...

Scenario 3: Wallet Connected
- [ ] Pass / [ ] Fail
- Notes: ...

Performance:
- Init Time: ___ ms
- Bundle Size: ___ KB
- Polling Time: ___ ms

Issues Found:
1. ...
2. ...
```

## Known Issues & Limitations

### Phase 1 Limitations

- **No UI Integration:** Read-only mode only logs to console
- **No Contract Reads:** Only block info, no contract calls yet
- **Helios Optional:** May not be available via CDN, relies on RPC fallback

### Future Enhancements

- Add UI indicator for read-only mode
- Implement contract read functionality
- Add Helios CDN integration (if available)
- Implement S-Tier P2P transport (optional)

## Reporting Issues

**Include:**
1. Browser and OS version
2. Console logs (especially `[ReadOnly]` prefixed)
3. Network tab screenshot (if relevant)
4. Steps to reproduce
5. Expected vs actual behavior

**File Location:**
- GitHub Issues (if repo is public)
- Internal bug tracker (if private)

