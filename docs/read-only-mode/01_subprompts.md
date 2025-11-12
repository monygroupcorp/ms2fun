# Read-Only Mode Sub-Prompts

**Date:** 2024  
**Branch:** `feature/read-only-mode`

## Questions for Human/Other Agents

### UI/UX Questions

1. **UI Mount Points:**
   - Where should the "Read-Only Mode" badge/indicator appear? (top-right corner, status bar, etc.)
   - Should read-only mode have a dedicated UI panel or just console logs for Phase 1?
   - **Answer for Phase 1:** Console logs only, no UI changes.

2. **Content Security Policy (CSP):**
   - Are there any CSP headers that need updating to allow Helios WASM execution?
   - Do we need to whitelist additional CDN domains?
   - **Action Required:** Check `index.html` for CSP meta tags or server headers.

3. **Mobile Testing:**
   - What specific mobile devices/browsers should be tested? (iOS Safari, Android Chrome, etc.)
   - Are there any known mobile-specific constraints for WASM or CDN loading?
   - **Default:** Test on iOS Safari and Android Chrome.

### Technical Questions

4. **Helios Version Pinning:**
   - Should we pin to a specific version of `@a16z/helios` or use `@latest`?
   - **Recommendation:** Pin to latest stable version, document in implementation.

5. **Feature Flags:**
   - Should read-only mode be enabled/disabled via a feature flag?
   - **Recommendation:** Add `localStorage` flag `ms2fun_readOnlyEnabled` (default: true).

6. **Error Handling:**
   - How should we handle rate limiting from public RPCs? (exponential backoff, rotation, etc.)
   - **Recommendation:** Implement health-check rotation with 3 retries max.

### Integration Questions

7. **Event Bus Integration:**
   - Should read-only mode emit events that other components can listen to?
   - **Recommendation:** Emit `readonly:initialized`, `readonly:block-update`, `readonly:error` events.

8. **Contract Reads (Future):**
   - Which contracts should be readable in read-only mode? (All public view functions?)
   - **Answer for Phase 1:** No contract reads yet, just block info.

9. **Network Selection:**
   - Should read-only mode respect the network config from `/EXEC404/switch.json`?
   - **Recommendation:** Default to mainnet, allow override via config.

### Operational Questions

10. **Monitoring:**
    - Should read-only mode log metrics for monitoring? (init time, RPC response times, etc.)
    - **Recommendation:** Log to console with `[ReadOnly]` prefix for Phase 1.

11. **Caching:**
    - Should we cache the last successful block header to avoid repeated fetches?
    - **Recommendation:** Cache for 30 seconds, refresh on polling interval.

12. **Polling Interval:**
    - What should the polling interval be for block updates? (30s default, configurable?)
    - **Recommendation:** 30 seconds default, adjustable via config.

## Decisions Made

- ✅ Phase 1: Console logs only, no UI changes
- ✅ Use public RPCs (no API keys)
- ✅ Helios with 2s timeout, fallback to viem
- ✅ Health-check rotation for RPC endpoints
- ✅ Default polling: 30 seconds
- ✅ Default network: mainnet (chainId: 1)

## Open Questions

- [ ] CSP policy requirements (needs verification)
- [ ] Specific Helios version to pin (check latest stable)
- [ ] Mobile WASM compatibility testing (needs real device testing)

## Follow-Up Actions

1. Verify CSP headers in `index.html` or server config
2. Test Helios WASM loading on mobile devices
3. Document SRI hashes after testing CDN scripts
4. Create feature flag system for enabling/disabling read-only mode

