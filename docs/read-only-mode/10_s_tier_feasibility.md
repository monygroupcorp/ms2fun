# S-Tier Feasibility: Portal Network / WebRTC P2P Transport

**Date:** 2024  
**Branch:** `feature/read-only-mode`  
**Status:** Feasibility Assessment

## Executive Summary

This document evaluates the feasibility of replacing RPC transport with Portal Network / WebRTC peer-to-peer connections for S-Tier read-only mode. **Verdict: Medium effort, Medium risk, High value if successful.**

## Current State (A-Tier)

- **Transport:** Public RPC endpoints (Cloudflare, PublicNode, Ankr)
- **Fallback:** Health-check rotation between endpoints
- **Bundle Size:** ~200-300 KB (viem) or ~0 KB (fetch-based)
- **Init Time:** < 1 second typically
- **Dependencies:** None (or viem via CDN)

## S-Tier Proposal: Portal Network / WebRTC P2P

### What is Portal Network?

Portal Network is a peer-to-peer network for Ethereum that allows clients to request and serve blockchain data without centralized RPC endpoints. It uses DHT (Distributed Hash Table) and content addressing to distribute data.

### Implementation Approach

1. **Portal Network Client:**
   - Use `@portalnetwork/client` or similar library
   - Connect to Portal Network bootstrap nodes
   - Request block headers via DHT lookup
   - Verify data cryptographically

2. **WebRTC Transport:**
   - Establish WebRTC connections to Portal Network peers
   - Exchange block data via peer connections
   - Fallback to RPC if P2P fails

### Bundle Size Impact

**Estimated Additional Size:**
- Portal Network client: ~400-600 KB
- WebRTC polyfills (if needed): ~50-100 KB
- DHT implementation: ~200-300 KB
- **Total:** ~650-1000 KB additional

**Combined with A-Tier:**
- A-Tier: ~200-300 KB
- S-Tier: ~650-1000 KB
- **Total:** ~850-1300 KB

**Assessment:** Acceptable for desktop, borderline for mobile. Could use code splitting to load P2P client only when needed.

### CPU Impact

**Portal Network Operations:**
- DHT lookups: Moderate CPU (network I/O bound)
- WebRTC connections: Low CPU (handled by browser)
- Cryptographic verification: Low CPU (similar to Helios)

**Estimated Impact:**
- Idle: < 1% CPU
- Active sync: 5-10% CPU (spikes during block updates)
- **Assessment:** Acceptable for background operation

### GitHub Pages Hosting Caveats

**Constraints:**
1. **Static Hosting Only:**
   - No server-side WebRTC signaling
   - Must use STUN/TURN servers for NAT traversal
   - Public STUN servers available (e.g., Google STUN)

2. **CORS/Content Security Policy:**
   - May need to whitelist WebRTC domains
   - Portal Network bootstrap nodes may need CSP exceptions
   - **Solution:** Add CSP meta tags or headers

3. **No WebSocket Server:**
   - Portal Network may require WebSocket for signaling
   - **Solution:** Use public WebSocket gateways or WebRTC data channels

4. **CDN Limitations:**
   - Large WASM/JS bundles may be slow to load
   - **Solution:** Lazy load P2P client only when RPC fails

**Assessment:** Feasible with public infrastructure, but requires careful configuration.

### Effort Level: Medium (M)

**Breakdown:**
- **Research & Setup:** 2-3 days
  - Portal Network client integration
  - WebRTC connection management
  - DHT lookup implementation

- **Implementation:** 3-5 days
  - P2P transport layer
  - Fallback logic (P2P → RPC)
  - Error handling and retry logic

- **Testing:** 2-3 days
  - Desktop testing (Chrome, Firefox, Safari)
  - Mobile testing (iOS Safari, Android Chrome)
  - Network condition testing (slow 3G, offline recovery)

- **Documentation:** 1 day
  - Update architecture docs
  - Add troubleshooting guide

**Total:** ~8-12 days (1.5-2.5 weeks)

### Risk Summary

**High Risk Areas:**
1. **Browser Compatibility:**
   - WebRTC support varies (Safari has limitations)
   - Portal Network client may not work in all browsers
   - **Mitigation:** Graceful fallback to RPC

2. **Network Reliability:**
   - P2P connections can be unstable
   - NAT traversal may fail in some networks
   - **Mitigation:** Aggressive fallback to RPC

3. **Performance:**
   - P2P lookups may be slower than RPC
   - Initial connection time may exceed 3s target
   - **Mitigation:** Parallel P2P + RPC, use whichever responds first

4. **Maintenance:**
   - Portal Network protocol may evolve
   - Bootstrap nodes may change
   - **Mitigation:** Version pinning, monitoring

**Medium Risk Areas:**
1. **Bundle Size:**
   - May exceed 1 MB target for mobile
   - **Mitigation:** Code splitting, lazy loading

2. **Privacy:**
   - P2P connections expose IP address
   - **Mitigation:** Use VPN/TOR (user's choice)

**Low Risk Areas:**
1. **Security:**
   - Portal Network uses cryptographic verification
   - Similar security model to Helios

### Value Assessment

**Benefits:**
- ✅ **True Decentralization:** No reliance on centralized RPCs
- ✅ **Censorship Resistance:** Can't be blocked by RPC providers
- ✅ **Privacy:** No single point of data collection
- ✅ **Resilience:** Network survives RPC outages

**Drawbacks:**
- ❌ **Complexity:** More moving parts, more failure modes
- ❌ **Performance:** May be slower than optimized RPCs
- ❌ **Bundle Size:** Larger download, slower initial load
- ❌ **Maintenance:** Requires ongoing protocol updates

### Recommendation

**Phase 1 (Current):** ✅ Implement A-Tier (RPC fallback)  
**Phase 2 (Future):** ⚠️ Consider S-Tier if:
- A-Tier proves insufficient (rate limiting, outages)
- Decentralization becomes a priority
- Bundle size constraints are relaxed
- Portal Network matures and stabilizes

**Alternative Approach:**
- Keep A-Tier as primary
- Add S-Tier as optional "Advanced Mode"
- Let users opt-in to P2P (feature flag)
- Monitor usage and performance

## Implementation Checklist (If Proceeding)

- [ ] Research Portal Network client libraries
- [ ] Set up WebRTC STUN/TURN servers
- [ ] Implement P2P transport layer
- [ ] Add fallback logic (P2P → RPC)
- [ ] Test on desktop browsers
- [ ] Test on mobile devices
- [ ] Performance benchmarking
- [ ] Update CSP headers
- [ ] Document P2P configuration
- [ ] Create troubleshooting guide

## Conclusion

S-Tier (Portal Network / WebRTC P2P) is **feasible but not essential** for Phase 1. A-Tier (RPC fallback) provides sufficient functionality with lower complexity and risk. S-Tier can be added later as an optional enhancement if decentralization becomes a priority.

**Effort:** Medium (M)  
**Risk:** Medium  
**Value:** High (if decentralization is a goal)  
**Priority:** Low (defer to Phase 2+)

