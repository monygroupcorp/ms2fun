# Pending Design Changes
**Date:** 2026-01-08
**Status:** Not Yet Implemented
**Purpose:** Document planned design/UX changes before designing new features

---

## 1. Wallet Connection UX Overhaul
**Scope:** ALL PAGES (Global Change)

### Current State (Problems)
- Full-screen `WalletSplash` blocks access to site
- Forces binary choice: "Connect Wallet" OR "Use Lightnode"
- Adds unnecessary friction
- Breaks deep-linking (users landing on `/project/:id` or `/edition/:id` hit splash first)
- Lightnode option is confusing

### New Design
- **Remove:** Full-screen wallet splash blocking access
- **Add:** Persistent wallet connection UI (badge/navbar)
  - Standard web3 pattern (like Uniswap, OpenSea, etc.)
  - Likely top-right corner
  - Shows wallet address when connected
  - Shows "Connect Wallet" button when not connected
  - Always accessible, never blocks content
- Users can browse site without wallet
- Wallet prompt only appears when user tries to interact (mint, buy, vote, etc.)

### Affected Components
- ❌ **Remove:** `WalletSplash.js` component
- ❌ **Remove:** Splash logic in `HomePage.js`
- ✅ **Create:** Persistent wallet badge component (top nav or floating)
- ✅ **Update:** All pages to remove splash dependency

### Implementation Notes
- Site should be fully browsable without wallet
- Only prompt for wallet on transaction attempts
- Deep links work immediately (no splash blocking)
- Better SEO (no client-side splash blocking crawlers)

---

## 2. Home Page Layout Reorganization
**Scope:** Home Page (`/`)

### Current Layout (Problems)

**Current Flow:**
1. Wallet Splash (being removed ✓)
2. Golden Plaque + 2 CTA buttons
   - Button 1: Documentation
   - Button 2: Create Project
   - **Problem:** These CTAs are "meh" - not compelling
3. `ProjectDiscovery` component (search bar + filters)
4. Project Gallery (grid of `ProjectCard` components)

**What's Missing:**
- No vault display/leaderboard
- No global messaging/activity feed
- Project discovery is too prominent (full component)

### New Layout (Goals)

**New Flow:**
1. Golden Plaque (hero section)
   - **Decision Needed:** Keep existing CTAs? Replace them? Remove them?
   - This is the "above the fold" hero

2. **NEW: Vault Display Section**
   - Showcase vaults (leaderboard/featured vaults)
   - Comes BEFORE project gallery
   - This is "first scroll" content

3. **NEW: Global Messaging System Display**
   - Activity feed (recent mints, buys, messages)
   - Comes AFTER vaults, BEFORE project gallery
   - This is "first scroll" content

4. **SIMPLIFIED: Project Discovery**
   - **Current:** Full `ProjectDiscovery` component with filters card
   - **New:** Reduced to just an expandable search bar
   - Search bar lives within/above the project gallery
   - Not its own section - integrated into gallery

5. Project Gallery (grid of project cards)
   - This stays but comes AFTER vaults + messaging
   - Search bar integrated here (not separate component above)

### Visual Structure

```
┌─────────────────────────────────────┐
│ Persistent Wallet Badge (top-right)│ ← NEW (global)
├─────────────────────────────────────┤
│                                     │
│   GOLDEN PLAQUE (Hero Section)     │
│   - Title/tagline                   │
│   - CTA buttons? (TBD)             │
│                                     │
├─────────────────────────────────────┤ ← "FIRST SCROLL"
│                                     │
│   VAULT DISPLAY SECTION             │ ← NEW
│   - Featured vaults                 │
│   - Leaderboard widget?             │
│   - TVL rankings?                   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   GLOBAL MESSAGING SECTION          │ ← NEW
│   - Recent activity feed            │
│   - Live messages (buys/mints)      │
│   - Protocol-wide activity          │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   [🔍 Expandable Search Bar]        │ ← SIMPLIFIED
│                                     │
│   PROJECT GALLERY                   │
│   ┌─────┐ ┌─────┐ ┌─────┐         │
│   │Card │ │Card │ │Card │         │
│   └─────┘ └─────┘ └─────┘         │
│   ┌─────┐ ┌─────┐ ┌─────┐         │
│   │Card │ │Card │ │Card │         │
│   └─────┘ └─────┘ └─────┘         │
│                                     │
└─────────────────────────────────────┘
```

### Affected Components

**Remove/Replace:**
- ❌ `WalletSplash` component (replaced by persistent badge)
- 🔄 `ProjectDiscovery` component (reduce to search bar only)
- 🔄 `ProjectSearch` component (keep, but make expandable)
- ❌? `ProjectFilters` component (remove or integrate into search?)

**Create New:**
- ✅ Persistent wallet badge/nav component
- ✅ Vault display section component
- ✅ Global messaging section component
- ✅ Expandable search bar component

**Keep Unchanged:**
- ✅ Golden Plaque (hero)
- ✅ `ProjectCard` components (gallery)

### Design Questions to Resolve

1. **Golden Plaque CTAs:**
   - Keep both buttons?
   - Replace with different CTAs?
   - Remove entirely?
   - What actions do we want users to take?

2. **Vault Display Section:**
   - Just featured vaults?
   - TVL leaderboard?
   - How many vaults shown?
   - "View All Vaults" link?

3. **Global Messaging Section:**
   - How many messages?
   - Real-time updates?
   - Filter options?
   - "View All Activity" link?

4. **Search Bar:**
   - Always visible or collapsed by default?
   - Filters accessible from search?
   - Where exactly does it live? (sticky? inline?)

---

## 3. Project Discovery Component Simplification
**Scope:** Home Page (`/`)

### Current State
- `ProjectDiscovery` is a large component with:
  - `ProjectSearch` (search bar)
  - `ProjectFilters` (type, factory, sort dropdowns)
  - Featured projects section
  - Project gallery grid

### New Design
- **Reduce to:** Just an expandable search bar
- **Remove:** Full component structure
- **Integrate:** Search bar lives within/above project gallery
- **Simplify:** Filters either removed or accessible from search

### Questions
- Do we still need factory/type filters?
- Or is search enough?
- Keep featured projects section or let vault/messaging sections handle discovery?

---

## Implementation Priority

### Phase 1: Remove Friction (Critical)
1. Remove `WalletSplash` blocking behavior
2. Add persistent wallet badge
3. Allow site browsing without wallet

### Phase 2: Home Page Reorg (High Priority)
1. Add vault display section
2. Add global messaging section
3. Simplify project discovery to search bar
4. Reorder sections (vaults → messaging → gallery)

### Phase 3: Polish (Medium Priority)
1. Improve/replace golden plaque CTAs (if needed)
2. Mobile responsive for new sections
3. Loading states for new sections

---

## Design Decisions ✅

### Wallet UI:
1. **Location:** ✅ **Option C - Floating button (bottom-right corner)**
   - Unique positioning (not standard top-right)
   - Always accessible without blocking content
   - Modern floating action button pattern

2. **Display:**
   - When connected: Show abbreviated address + balance
   - When not connected: "Connect Wallet" button
   - Click opens wallet modal (existing `WalletConnector`)

### Home Page:
3. **Golden Plaque CTAs:** ✅ **Option B - Improved CTAs**
   - **Button 1:** Documentation (keep)
   - **Button 2:** Multi-button dropdown menu
     - Option: "Create Project"
     - Option: "Create Vault"
   - This gives users clear action paths

4. **Vault Display:** ✅ **Compact toggleable leaderboard**
   - Show **top 3 vaults only** (truncated, compact)
   - Toggle between two modes:
     - Mode 1: Top by TVL (`getVaultsByTVL()`)
     - Mode 2: Top by Popularity (`getVaultsByPopularity()`)
   - Mode switcher (button/toggle)
   - "View All Vaults" link to full vault explorer page

5. **Global Messaging:** ✅ **Last 5 messages widget**
   - Show **last 5 messages** (compact)
   - Each message is **clickable** → navigates to that project
   - Purpose: Show activity, drive discovery
   - "View All Activity" link → full Messages page (NEW PAGE)
   - Static on load (not real-time)

6. **Search Bar:** ✅ **Collapsed, integrated**
   - **Collapsed by default** (magnifying glass icon)
   - **Integrated into gallery header** (part of project gallery component)
   - Click to expand search input
   - Filters accessible from expanded state

---

## Related Architecture Work

Once these design changes are implemented, we can build on top:

1. **Vault Display Component** will use:
   - `getVaults()`
   - `getVaultsByTVL()`
   - `getVaultsByPopularity()`
   - `getVaultInfo()`

2. **Global Messaging Component** will use:
   - `getRecentMessages()`
   - `getRecentMessagesPaginated()`
   - `getMessageCount()`

3. **Persistent Wallet Badge** will use:
   - Existing `WalletService` methods
   - Existing `WalletConnector` modal (when clicked)

---

## Next Steps

1. ✅ Current State Audit complete
2. ✅ Design Changes documented
3. ⏭️ **User answers open questions** (wallet placement, CTAs, etc.)
4. ⏭️ Design missing features (with these changes in mind)
5. ⏭️ Create implementation roadmap
6. ⏭️ Write FRONTEND_ARCHITECTURE.md
