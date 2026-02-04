# ERC404 Project Page Redesign

## Overview

Redesign the ERC404 project page to match pump.fun's clean, focused layout. Replace the current stacked panel approach with a two-column layout: trading sidebar on the right, project content on the left with tabs for Token and NFT views.

## Layout Structure

```
┌─────────────────────────────────────┬──────────────────────┐
│           MAIN CONTENT              │      SIDEBAR         │
│                                     │                      │
│  [Icon] Name ($TICKER)              │  ┌────────────────┐  │
│  Creator: 0x123...abc               │  │ Buy ○  Sell ○  │  │
│  Created: Jan 20, 2026              │  │                │  │
│                                     │  │ [Amount Input] │  │
│  [Share] [0x...copy] [★]            │  │ .1  .5  1  max │  │
│                                     │  │                │  │
│  ┌─────────────────────────────┐    │  │ [Connect/Buy]  │  │
│  │ [Token]  [NFT]              │    │  └────────────────┘  │
│  ├─────────────────────────────┤    │                      │
│  │                             │    │  ┌────────────────┐  │
│  │  Tab content                │    │  │ Token Info     │  │
│  │  (bonding OR gallery)       │    │  │ Your Balance   │  │
│  │                             │    │  │ [My Portfolio] │  │
│  ├─────────────────────────────┤    │  ├────────────────┤  │
│  │  Comments                   │    │  │ Creator Vault  │  │
│  │                             │    │  └────────────────┘  │
│  └─────────────────────────────┘    │                      │
└─────────────────────────────────────┴──────────────────────┘
```

**Mobile:** Sidebar stacks on top (trading first), then main content below.

## Sidebar

### Trading Interface

1. **Buy/Sell Toggle** - Radio buttons or segmented control. Buy selected by default.

2. **Amount Input**
   - Single input field
   - Currency indicator on right (ETH when buying, token symbol when selling)
   - Clear X button when filled

3. **Quick Pick Buttons**
   - Buying: `.1` `.5` `1` `max` (ETH amounts)
   - Selling: `25%` `50%` `75%` `max` (percentages)

4. **CTA Button**
   - Not connected: "Connect Wallet"
   - Connected, buying: "Buy $TICKER"
   - Connected, selling: "Sell $TICKER"
   - During tx: spinner + "Confirming..."

### Token Info Section

- Current price (ETH)
- Your balance (if connected)
- Your NFT count (if connected)
- **[My Portfolio]** button - opens portfolio modal (only when connected)

### Creator/Vault Section

- Creator address (linked to etherscan)
- Vault address (if set)
- Fee destination indicator: "Fees go to stakers" or "Fees claimable by owner"

## Main Content

### Header Area

**Left side:**
- Project image/icon (from style URI or default)
- Project name (large text)
- Ticker in parentheses: `($EARLY)`
- Creator wallet: `Created by 0x123...abc` (truncated, clickable)
- Creation date: `Jan 20, 2026`

**Right side:**
- **Share button** - Opens ShareModal
- **Contract address** - Truncated with copy icon, shows "Copied!" toast
- **Star/Save button** - Outline when not saved, filled when saved. Uses localStorage.

### Tab Bar

Two tabs: `Token` | `NFT`

### Token Tab

**Bonding/Chart Section:**
- During bonding: Bonding curve visualization + progress bar + stats
- After liquidity: Dextools iframe embed

**Bonding Stats:**
- Progress bar showing % filled
- Stats row: `42.5% filled` | `4.25 ETH raised` | `425,000 / 1,000,000 tokens`
- Phase badge: "Bonding Active" / "Opens in 2h" / "Matured" / "Liquidity Deployed"

**Staking Section:**
- Header with enabled/disabled badge
- If not enabled: "Staking not yet enabled"
- If enabled: Your staked balance, claimable rewards, stake/unstake inputs, claim button
- If not connected: Show stats, inputs replaced with "Connect wallet to stake"

### NFT Tab

**Gallery Preview:**
- Grid of NFTs (limited display, 12-20 items)
- "View Full Gallery →" link to separate page
- If no NFTs: "No NFTs minted yet"

### Comments Section (Both Tabs)

- Appears at bottom of both tabs
- Reuses existing ProjectCommentFeed component
- Read-only for now (posting/hearts are future)

## Modals

### ShareModal

- Preview card showing how share will look
- "Copy Link" button
- "Share on X" button (twitter intent with pre-filled text)
- Minimal card: project image + name + ticker + current status

### ERC404PortfolioModal

- User's token balance
- User's NFTs (grid display)
- Mint NFTs from balance
- Reroll NFT controls

## Routes

- `/project/{id}` - ERC404ProjectPage (Token tab default)
- `/project/{id}/gallery` - NFTGalleryPage (full gallery)

## Components

| Component | Status | Description |
|-----------|--------|-------------|
| `ERC404ProjectPage.js` | New | Main layout with sidebar + tabbed content |
| `ERC404TradingSidebar.js` | New | Trading interface + token info + portfolio button |
| `ERC404PortfolioModal.js` | New | User's tokens/NFTs, mint, reroll controls |
| `ProjectHeaderCompact.js` | New | Name, ticker, icon, creator, date, share, copy, star |
| `ShareModal.js` | New | Share preview, copy link, share on X |
| `BondingProgressSection.js` | New | Curve viz + progress bar + stats |
| `StakingSection.js` | Refactor | Simplified staking UI |
| `NFTGalleryPreview.js` | New | Limited grid for NFT tab |
| `NFTGalleryPage.js` | New | Full gallery separate page |
| `ProjectCommentFeed.js` | Reuse | Existing, shown on both tabs |
| `FavoritesService.js` | New | localStorage for starred projects |

## Removed from ERC404 Page

These move to admin modal or are deprecated:
- BondingStatusPanel (merged into BondingProgressSection)
- TierStatusPanel (admin modal)
- NFTManagement (admin modal)
- OwnerDashboard (replaced by admin modal)

## Phase 2 Enhancements (After micro-web3 migration)

- **Event-indexed price chart** - Query Buy/Sell events, render with lightweight-charts library
- **Comment posting** - Write comments directly to project
- **Comment hearts/likes** - Engagement on comments

## Technical Notes

- No server-side capabilities - all client-side
- Favorites stored in localStorage
- Share card is minimal (no dynamic OG image generation)
- Dextools iframe for post-liquidity chart
- Reuse existing ERC404 adapter methods
