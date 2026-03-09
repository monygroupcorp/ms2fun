# CultExecs Terminal Brutalism Redesign

**Date:** 2026-03-04
**Status:** Design approved

---

## Overview

Rewrite the CultExecs page (`/cultexecs`) as a Microact component using the factory adapter pattern, while preserving its identity as the standalone genesis project. The terminal aesthetic is elevated with Gallery Brutalism structure and the `frontend-design` skill.

## Goals

- Convert from vanilla JS innerHTML to Microact component
- Use adapter pattern via `projectService.loadCultExec()`
- Mount existing functional sub-components (no rebuilding what works)
- Live dashboard with real on-chain data in the price runner
- Terminal Brutalism styling: Bloomberg terminal meets v2 design tokens
- Keep standalone at `/cultexecs`, not part of factory system

## Architecture

### Component Tree

```
CultExecsPage (Microact Component)
├── Terminal chrome (rendered directly by page)
│   ├── TerminalNav — nav bar with title + icons
│   └── PriceRunner — live ticker with real adapter data
├── Main content (two-column, sticky sidebar)
│   ├── Left: BondingCurve (canvas chart / DEXTools iframe)
│   └── Right: ERC404TradingSidebar (buy/sell + token info)
├── Bottom section
│   ├── ColorBar — "CULT EXEC" yellow bar + info strip
│   ├── ProjectCommentFeed — always visible, on-chain messages
│   └── NewsTicker — ambient scrolling footer
└── ERC404PortfolioModal — triggered via button/eventBus
```

### Files

| File | Purpose |
|------|---------|
| `src/routes/CultExecsPage.microact.js` | New Microact page component |
| `src/routes/cultexecs-v2.css` | New terminal brutalism styles |
| `src/index.js` | Update route to use new component |
| `src/routes/CultExecsPage.js` | Old file, kept as reference |
| `src/routes/cultexecs.css` | Old file, kept as reference |

### Data Flow

```
projectService.loadCultExec()
  → returns { adapter } (ERC404 adapter for standalone contract)

Adapter data → PriceRunner (refreshed every 30s)
  ├── currentPrice     → "CULT $ 0.00042"
  ├── ethRaised        → "Val 4.25 ETH"
  ├── currentSupply    → "Supply 425,000"
  ├── maxSupply        → progress calculation
  ├── holders          → "Holders 127"
  └── phase            → "BONDING" | "GRADUATED"

Adapter → BondingCurve (own refresh cycle, canvas/iframe)
Adapter → ERC404TradingSidebar (own refresh cycle, buy/sell)
Adapter → ProjectCommentFeed (message registry queries)
ERC404PortfolioModal (opens via eventBus signal)
```

### Page Lifecycle

1. `didMount()`: Load stylesheets, call `projectService.loadCultExec()` to get adapter
2. Mount sub-components with adapter prop
3. Start 30s refresh interval for price runner data
4. Listen for wallet events to refresh admin button and portfolio
5. `registerCleanup()`: Stop intervals, unload stylesheets, remove body class

### shouldUpdate Strategy

- Tab switches and price runner updates use direct DOM manipulation
- Return `false` from `shouldUpdate` for non-structural state changes
- Prevents destruction of BondingCurve canvas and SwapInterface input focus

## Styling — Terminal Brutalism

### Concept

Bloomberg terminal that happens to be a crypto trading interface. Monospace everything, pure black background, gold accents, green for positive states. Uses v2 spacing tokens for consistency but rejects v2 colors in favor of terminal palette.

### Design Tokens

```css
/* Terminal palette — scoped to .cultexecs-page */
--ce-bg: #000000;
--ce-bg-panel: #0a0a0a;
--ce-border: #333333;
--ce-text: #ffffff;
--ce-gold: #fdb523;
--ce-green: #00ff00;
--ce-red: #ff3b30;
--ce-blue: #00bfff;
--ce-dim: #666666;
```

### Layout

```
┌─────────────────────────────────────────────────┐
│ TERMINAL NAV (gold title, mono icons)           │
├─────────────────────────────────────────────────┤
│ PRICE RUNNER (live ticker, scrolling)           │
├──────────────────────────┬──────────────────────┤
│                          │                      │
│  BONDING CURVE / CHART   │  TRADING SIDEBAR     │
│  (canvas or DEXTools)    │  (buy/sell, info)     │
│                          │  (sticky)             │
│                          │                      │
├──────────────────────────┴──────────────────────┤
│ COLOR BAR (CULT EXEC yellow + red info)         │
├─────────────────────────────────────────────────┤
│                                                 │
│  COMMENT FEED (on-chain messages, always shown) │
│                                                 │
├─────────────────────────────────────────────────┤
│ NEWS TICKER (ambient scroll)                    │
└─────────────────────────────────────────────────┘
```

### Key Style Rules

- `var(--font-mono)` for all text (terminal feel)
- `var(--space-*)` tokens for spacing (v2 consistency)
- 1px solid borders everywhere (terminal grid)
- No rounded corners, no shadows, no gradients
- Info cards: black bg with #333 borders
- Comment entries: mono timestamps, gold usernames
- Buttons: gold bg with black text, or outlined with gold border
- Responsive: single column at 1024px, sidebar moves above chart

## Sub-Components Used (No Changes Needed)

| Component | Source | Props |
|-----------|--------|-------|
| BondingCurve | `components/BondingCurve/BondingCurve.microact.js` | adapter |
| ERC404TradingSidebar | `components/ERC404/ERC404TradingSidebar.microact.js` | adapter, projectData |
| ProjectCommentFeed | `components/ProjectCommentFeed/ProjectCommentFeed.microact.js` | projectAddress, adapter |
| ERC404PortfolioModal | `components/ERC404/ERC404PortfolioModal.microact.js` | adapter, projectData |
| AdminButton | `components/AdminButton/AdminButton.js` | contractAddress, contractType, adapter |

## Known Issue: RPC Fallback & Wallet Extension Crashes

**Symptom:** Blank white page at all routes when local Anvil is down OR when MetaMask extension has crashed.

**Discovered:** MetaMask crash was the primary blocker — the crashed extension throws an unhandled rejection (`Failed to connect to MetaMask`) that disrupts the initialization chain in `index.js`. Once MetaMask was restarted, pages loaded.

**Secondary issue:** When Anvil (`127.0.0.1:8545`) is down, `ProviderManager` and `EnvironmentDetector` can also block page rendering. Partial fix applied (added mainnet public RPCs as fallback in ProviderManager), but `ensureWeb3Ready()` in `index.js` still needs try/catch wrapping so routes render even when web3 init fails.

**Key files for full fix:**
- `src/index.js` — `ensureWeb3Ready()` line 63, needs try/catch with degraded web3Context
- `src/services/ProviderManager.js` — fallback RPCs added (done)
- `src/services/EnvironmentDetector.js` — `detect()` needs graceful RPC failure handling
- `src/config/network.js` — `checkRpcAvailable()` works correctly already

## Migration

1. Build new `CultExecsPage.microact.js` + `cultexecs-v2.css`
2. Update `src/index.js` to import and mount the new Microact component
3. Keep old files as reference until verified
4. Special routing in HomePage and ProjectCard stays unchanged (still navigates to `/cultexecs`)
