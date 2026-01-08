# Frontend Architecture & Implementation Plan
**Date:** 2026-01-08
**Status:** Design Phase
**Purpose:** Complete sitemap, component specs, and implementation roadmap for 200+ contract method coverage

**Based On:**
- `FRONTEND_COVERAGE_CHECKLIST.md` - Contract methods by user role
- `FRONTEND_CURRENT_STATE_AUDIT.md` - Existing implementation
- `DESIGN_CHANGES.md` - Pending UX changes

---

## Table of Contents

1. [User Pathways](#user-pathways)
2. [Sitemap](#sitemap)
3. [Global Components](#global-components)
4. [Page Specifications](#page-specifications)
5. [Component Library](#component-library)
6. [Implementation Roadmap](#implementation-roadmap)

---

## User Pathways

The frontend serves **three distinct user types** with different needs and entry points:

### 1. Regular User Pathway 🎮
**Who:** Collectors, traders, participants
**Goals:** Discover projects, mint, trade, participate
**Entry Points:** Home page, project pages
**Navigation:** Main UI (clean, focused)

**Journey:**
```
Home → Browse Projects → View Project → Mint/Trade
     → Browse Vaults   → View Vault
     → View Activity   → Click Message → Go to Project
```

**Features They Need:**
- ✅ Browse projects
- ✅ Mint editions
- ✅ Buy/sell on bonding curves
- ✅ See activity feed
- ✅ Create instances (from existing factories)
- ✅ Basic portfolio view

**What They DON'T Need in Main UI:**
- ❌ Factory submission forms
- ❌ Vault registration
- ❌ Governance voting (unless they navigate there)
- ❌ Technical/developer docs

---

### 2. Developer/Partner Pathway 🔧
**Who:** Developers wanting to add new factories or vaults
**Goals:** Submit factory for approval, register vault
**Entry Points:** Documentation → Developer section
**Navigation:** Documentation-gated (not cluttering main UI)

**Journey:**
```
Documentation → Developer Guide → Factory Submission
                              → Vault Registration
                              → Governance Process
```

**Features They Need:**
- ✅ Factory submission form (`/factories/apply`)
- ✅ Vault registration guide
- ✅ Technical documentation
- ✅ Governance timeline explanation
- ✅ Contract interfaces/ABIs

**Where These Live:**
- `/docs` page has "Developer & Partners" section
- Links to:
  - `/factories/apply` - Factory submission
  - `/vaults/register` - Vault registration (NEW)
  - Governance info
  - Technical docs

**Key Point:** These advanced features are **accessible but not prominent** in main navigation. Documentation serves as the gateway.

---

### 3. Power User/Investor Pathway 💎
**Who:** Heavily invested users, EXEC holders, vault benefactors
**Goals:** Manage positions, vote on governance, claim rewards
**Entry Points:** Wallet badge dropdown menu
**Navigation:** Wallet menu → Personal dashboards

**Journey:**
```
Wallet Badge Dropdown → Portfolio Dashboard
                     → Governance Dashboard
                     → Staking Positions
                     → Vault Positions
```

**Features They Need:**
- ✅ Complete portfolio view (all holdings)
- ✅ Governance voting dashboard
- ✅ Staking management
- ✅ Vault benefactor positions
- ✅ Claim all rewards
- ✅ Transaction history

**Where These Live:**
- Wallet badge dropdown menu (accessible from anywhere)
- Menu items:
  - 📊 **Portfolio** → `/portfolio` (all holdings)
  - 🗳️ **Governance** → `/governance` (voting dashboard)
  - 🎯 **Staking** → Direct to staking section (or `/staking` page)
  - 💰 **Vault Positions** → Filter portfolio to vaults
  - ⚙️ **Settings** → Wallet settings

**Key Point:** Advanced features are **always accessible** but tucked away in wallet menu, not cluttering main UI.

---

## Sitemap

### Main Navigation Pages (Prominent)
**Regular User Pathway** - Always visible, main UI
```
/                                   # Home (Project Discovery) - REDESIGNED
/cultexecs                          # CULT EXECS dedicated page
/project/:id                        # Project Detail (address-based)
/:chainId/:factoryTitle/:instanceName            # Project Detail (title-based)
/:chainId/:factoryTitle/:instanceName/:pieceTitle # Edition Detail
/:chainId/:factoryTitle/create      # Project Creation (from existing factories)
/vaults                             # Vault Leaderboard & Explorer
/vaults/:address                    # Vault Detail Page
/messages                           # Global Activity Feed (full page)
/about or /docs                     # Documentation
```

### Wallet Menu Pages (Power User)
**Accessible from wallet badge dropdown**
```
/portfolio                          # User Portfolio Dashboard ← WALLET MENU
/governance                         # Governance Dashboard ← WALLET MENU
/governance/factories               # Factory Governance
/governance/vaults                  # Vault Governance
/staking                            # Staking Dashboard (optional dedicated page)
/voting                             # EXEC Voting (alias for /governance)
```

### Developer/Partner Pages (Documentation-Gated)
**Linked from documentation, not prominent in main nav**
```
/factories                          # Factory Exploration (still accessible)
/factories/apply                    # Factory Application ← FROM DOCS
/factories/application/:address     # Application Status
/vaults/register                    # Vault Registration ← FROM DOCS (NEW)
/factory/:id                        # Factory Detail
```

### Total: 21 Pages

**Information Architecture:**
- **10 pages** in main navigation (regular users)
- **6 pages** in wallet menu (power users)
- **5 pages** gated through documentation (developers)

---

## Global Components

These components appear on ALL or MOST pages.

### 1. FloatingWalletButton (NEW - replaces WalletSplash)
**File:** `src/components/FloatingWalletButton/FloatingWalletButton.js`

**Location:** Bottom-right corner (floating action button)

**Purpose:** Persistent wallet connection + power user menu access

**States:**
- **Not connected:** Shows "Connect" button
- **Connected:** Shows abbreviated address (0x1234...5678)
- **Hover:** Shows full address + balance
- **Clicked (connected):** Opens dropdown menu

**Behavior:**
- Not connected + Click → Opens `WalletConnector` modal (existing)
- Connected + Click → Opens dropdown menu (NEW)
- Always accessible, never blocks page content
- Z-index above all content

**Dropdown Menu Structure:**
```
┌─────────────────────────────┐
│ 0x1234...5678              │ ← Wallet address
│ Balance: 2.5 ETH           │
├─────────────────────────────┤
│ 📊 Portfolio               │ → /portfolio
│ 🗳️ Governance              │ → /governance
│ 🎯 Staking                 │ → /staking (or scroll to section)
│ 💰 Vault Positions         │ → /portfolio?filter=vaults
├─────────────────────────────┤
│ ⚙️ Settings                 │
│ 🔌 Disconnect              │
└─────────────────────────────┘
```

**Menu Items:**

1. **Portfolio** (`/portfolio`)
   - User's complete holdings dashboard
   - All tokens, NFTs, vault positions, staking
   - Available to all connected users

2. **Governance** (`/governance`)
   - Factory & vault voting dashboard
   - Only shown if user holds EXEC tokens
   - Or always shown but disabled if no EXEC

3. **Staking** (`/staking` or section link)
   - View all staking positions across projects
   - Claim rewards, stake/unstake
   - Available to all connected users

4. **Vault Positions** (`/portfolio?filter=vaults`)
   - Quick link to vault section of portfolio
   - Shows only vault benefactor positions
   - Available if user is benefactor of any vault

5. **Settings**
   - Wallet preferences
   - Notification settings (future)
   - Display preferences

6. **Disconnect**
   - Disconnect wallet
   - Clear connection state

**Conditional Visibility:**
- **Governance** menu item:
  - Always shown if user holds EXEC > 0
  - Hidden or disabled if user holds no EXEC
  - Check via: `ERC404.balanceOf(user, EXEC_TOKEN_ADDRESS)`

- **Vault Positions** menu item:
  - Only shown if user is benefactor of at least one vault
  - Check via: Iterate vaults, call `getBenefactorShares(user)` > 0

**Contract Methods:**
- `WalletService.getAddress()` - Current wallet
- `WalletService.getBalance()` - ETH balance
- `ERC404.balanceOf(user, EXEC_ADDRESS)` - Check EXEC holdings (for governance visibility)
- Various vault methods to check benefactor status (for vault menu visibility)

**UI Mockup:**
```
┌─────────────────────────────────┐
│                                 │
│   Page Content                  │
│                                 │
│                                 │
│                          ┌────┐ │
│                          │ 🦊 │ │  ← Floating button
│                          │0x..│ │     (bottom-right)
│                          └────┘ │
│                             ↑    │
│                    ┌──────────┐ │  ← Dropdown menu
│                    │ Portfolio│ │     (on click)
│                    │Governance│ │
│                    │  Staking │ │
│                    │ Vaults   │ │
│                    │ Settings │ │
│                    │Disconnect│ │
│                    └──────────┘ │
└─────────────────────────────────┘
```

**CSS Classes:**
- `.floating-wallet-button` - Main button
- `.floating-wallet-button.connected` - Connected state
- `.floating-wallet-button.disconnected` - Disconnected state
- `.wallet-dropdown-menu` - Dropdown menu
- `.wallet-dropdown-menu-item` - Each menu item
- `.wallet-dropdown-menu-item.disabled` - Disabled menu item

**Implementation Notes:**
- Menu closes on click outside
- Menu closes after navigation
- Menu items highlighted on hover
- Smooth animation on open/close

---

## Page Specifications

---

## Page 0: Documentation (`/docs` or `/about`) - ENHANCED

### Purpose
User guide + gateway to developer/partner features

### User Journey
1. Regular users: Find help, learn how to use protocol
2. Developers: Navigate to "For Developers" section → find submission links

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton                    │
├─────────────────────────────────────────┤
│   DOCUMENTATION                         │
│   ┌───────────────────────────────┐    │
│   │ [User Guide] [For Developers] │    │ ← Tabs
│   └───────────────────────────────┘    │
├─────────────────────────────────────────┤
│   USER GUIDE TAB (Default)              │
│   • Getting Started                     │
│   • How to Mint                         │
│   • How to Trade                        │
│   • FAQ                                 │
│                                         │
├─────────────────────────────────────────┤
│   FOR DEVELOPERS TAB                    │
│   ┌─────────────────────────────────┐  │
│   │ Want to add a new factory?      │  │
│   │ [Submit Factory Application →]  │  │
│   └─────────────────────────────────┘  │
│   ┌─────────────────────────────────┐  │
│   │ Want to register a vault?       │  │
│   │ [Register Vault →]              │  │
│   └─────────────────────────────────┘  │
│   • Governance Process Overview        │
│   • Technical Documentation            │
│   • Contract ABIs                      │
│   • Integration Guide                  │
└─────────────────────────────────────────┘
```

### Components

#### 0.1 Documentation Component (UPDATE EXISTING)
**File:** `src/components/Documentation/Documentation.js`

**Enhancements:**
- Add tabbed interface (User Guide / For Developers)
- Add prominent call-to-action cards in "For Developers" tab:
  - **"Submit Factory Application"** → `/factories/apply`
  - **"Register Vault"** → `/vaults/register`
- Add governance process explanation
- Add technical docs section

**Purpose:**
- Regular users get help
- Developers find submission forms
- Keep developer features out of main UI

**Contract Methods:** None (informational)

**Key Point:** Documentation serves as the **gateway** to developer features, keeping main UI clean for regular users.

---

## Page 1: Home (`/`) - REDESIGNED

### Purpose
Protocol landing page with discovery, activity, and vaults

### User Journey
1. Land on page (no splash blocking)
2. See hero (golden plaque)
3. Scroll to see vault leaderboard
4. Scroll to see recent activity
5. Browse project gallery with search

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton (bottom-right)     │
├─────────────────────────────────────────┤
│                                         │
│   GOLDEN PLAQUE (Hero Section)         │
│   - Protocol title/tagline              │
│   - [Documentation] button              │
│   - [Create ▼] dropdown:                │
│     • Create Project                    │
│     • Create Vault                      │
│                                         │
├─────────────────────────────────────────┤
│   TOP VAULTS SECTION (NEW)              │
│   ┌───────────────────────────────┐   │
│   │ [TVL] [Popularity] ← toggle    │   │
│   ├───────────────────────────────┤   │
│   │ 1. Vault Name     $1.2M TVL   │   │
│   │ 2. Vault Name     $850K TVL   │   │
│   │ 3. Vault Name     $620K TVL   │   │
│   ├───────────────────────────────┤   │
│   │ [View All Vaults →]            │   │
│   └───────────────────────────────┘   │
├─────────────────────────────────────────┤
│   RECENT ACTIVITY SECTION (NEW)         │
│   ┌───────────────────────────────┐   │
│   │ Recent Activity               │   │
│   ├───────────────────────────────┤   │
│   │ • User minted Edition #3 → Project X │
│   │ • User bought 100 tokens → Project Y │
│   │ • User sold 50 tokens → Project Z    │
│   │ • User minted Edition #1 → Project A │
│   │ • User staked 500 tokens → Project B │
│   ├───────────────────────────────┤   │
│   │ [View All Activity →]          │   │
│   └───────────────────────────────┘   │
├─────────────────────────────────────────┤
│   PROJECT GALLERY                       │
│   [🔍] ← collapsed search          │
│   ┌───────┐ ┌───────┐ ┌───────┐  │
│   │Project│ │Project│ │Project│  │
│   │ Card  │ │ Card  │ │ Card  │  │
│   └───────┘ └───────┘ └───────┘  │
│   ┌───────┐ ┌───────┐ ┌───────┐  │
│   │Project│ │Project│ │Project│  │
│   │ Card  │ │ Card  │ │ Card  │  │
│   └───────┘ └───────┘ └───────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### Components

#### 1.1 HeroSection (Update existing Golden Plaque)
**File:** `src/components/HeroSection/HeroSection.js`

**Contract Methods:** None (static content)

**UI Elements:**
- Title/tagline
- Documentation button (existing)
- Create dropdown button (NEW)
  - "Create Project" option
  - "Create Vault" option

**Implementation Notes:**
- Update existing golden plaque component
- Add dropdown menu functionality
- Dropdown opens on click/hover

---

#### 1.2 TopVaultsWidget (NEW)
**File:** `src/components/TopVaultsWidget/TopVaultsWidget.js`

**Purpose:** Show top 3 vaults by TVL or popularity

**Contract Methods:**
- `MasterRegistry.getVaultsByTVL(3)` - Top 3 by TVL
- `MasterRegistry.getVaultsByPopularity(3)` - Top 3 by popularity
- `UltraAlignmentVault.vaultType()` - Vault type
- `UltraAlignmentVault.accumulatedFees()` - TVL amount
- `UltraAlignmentVault.description()` - Vault description

**State:**
```javascript
{
  mode: 'tvl' | 'popularity',  // Toggle state
  vaults: [
    {
      address: string,
      name: string,
      type: string,
      tvl: string,          // For TVL mode
      popularity: number    // For popularity mode
    }
  ],
  loading: boolean
}
```

**UI Elements:**
- Mode toggle (TVL / Popularity)
- 3 vault rows:
  - Rank number
  - Vault name (clickable → `/vaults/:address`)
  - Metric (TVL $ or popularity score)
- "View All Vaults →" link

**Behavior:**
- Toggle switches between `getVaultsByTVL()` and `getVaultsByPopularity()`
- Click vault → navigate to vault detail page
- Click "View All" → navigate to `/vaults`

---

#### 1.3 RecentActivityWidget (NEW)
**File:** `src/components/RecentActivityWidget/RecentActivityWidget.js`

**Purpose:** Show last 5 protocol-wide messages

**Contract Methods:**
- `GlobalMessageRegistry.getRecentMessages(5)` - Last 5 messages
- `GlobalMessageRegistry.getMessageCount()` - Total message count (for display)

**State:**
```javascript
{
  messages: [
    {
      id: number,
      instance: address,
      instanceName: string,  // From project registry
      user: address,
      messageType: string,   // 'mint', 'buy', 'sell', etc.
      message: string,
      timestamp: number
    }
  ],
  loading: boolean
}
```

**UI Elements:**
- "Recent Activity" header
- 5 message rows:
  - Icon (based on type: mint/buy/sell)
  - Formatted message: "User minted Edition #3"
  - Arrow + Project name (clickable)
  - Timestamp (relative: "2m ago")
- "View All Activity →" link

**Behavior:**
- Click project name → navigate to project detail
- Click "View All" → navigate to `/messages`
- Refresh on mount (not real-time)

**Message Formatting:**
```javascript
// Example messages:
"0x1234 minted Edition #3 → Cool Art Project"
"0x5678 bought 100 tokens → Bonding Curve Project"
"0x9abc sold 50 tokens → Another Project"
"0xdef0 staked 500 tokens → Staking Project"
```

---

#### 1.4 ProjectGallery (Update existing)
**File:** `src/components/ProjectGallery/ProjectGallery.js`

**Purpose:** Simplified project grid with integrated search

**Contract Methods:**
- Same as current `ProjectDiscovery`
- `ProjectRegistry.getAllProjects()`

**Changes from Current:**
- Remove separate `ProjectDiscovery` component
- Integrate collapsed search bar into gallery header
- Remove prominent filter section

**UI Elements:**
- Collapsed search bar (magnifying glass icon)
- Expanded search input (on click)
- Project cards grid (existing `ProjectCard` components)

**Behavior:**
- Search bar collapsed by default
- Click icon → expand search input
- Type → filter projects (existing logic)

---

### Page 1 Summary

**Components to Create:**
- ✅ `FloatingWalletButton` (global, but first used here)
- ✅ `TopVaultsWidget`
- ✅ `RecentActivityWidget`
- ✅ `ProjectGallery` (simplified from existing)

**Components to Update:**
- 🔄 `HeroSection` (add Create dropdown)
- 🔄 `ProjectCard` (no changes, just reused)

**Components to Remove:**
- ❌ `WalletSplash`
- ❌ `ProjectDiscovery` (replaced by simplified `ProjectGallery`)

**Adapter Methods Used (New):**
- 8 new methods from MasterRegistry (vaults)
- 2 new methods from GlobalMessageRegistry (messages)
- 4 new methods from UltraAlignmentVault (vault details)
- **Total: 14 new methods on home page**

---

## Page 2: Vault Explorer (`/vaults`) - NEW PAGE

### Purpose
Browse all vaults with full details and rankings

### User Journey
1. Navigate from home "View All Vaults" link
2. See full vault leaderboard (paginated)
3. Toggle between TVL / Popularity rankings
4. Filter vaults by type (if multiple types exist)
5. Click vault → go to vault detail page

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton                    │
├─────────────────────────────────────────┤
│   ← Back to Home                        │
├─────────────────────────────────────────┤
│   VAULT EXPLORER                        │
│   ┌─────────────────────────────────┐  │
│   │ [TVL] [Popularity] ← toggle     │  │
│   │ Total Vaults: 12                │  │
│   └─────────────────────────────────┘  │
├─────────────────────────────────────────┤
│   VAULT LEADERBOARD                     │
│   ┌─────────────────────────────────┐  │
│   │ # │ Name      │ Type │ TVL/Pop │  │
│   ├─────────────────────────────────┤  │
│   │ 1 │ Vault A   │ UA   │ $1.2M   │  │
│   │ 2 │ Vault B   │ UA   │ $850K   │  │
│   │ 3 │ Vault C   │ UA   │ $620K   │  │
│   │ 4 │ Vault D   │ UA   │ $450K   │  │
│   │ ... (paginated)                  │  │
│   └─────────────────────────────────┘  │
│   [Load More] or pagination controls    │
└─────────────────────────────────────────┘
```

### Components

#### 2.1 VaultExplorer (NEW)
**File:** `src/components/VaultExplorer/VaultExplorer.js`

**Contract Methods:**
- `MasterRegistry.getTotalVaults()` - Total count
- `MasterRegistry.getVaults(startIndex, endIndex)` - Paginated list
- `MasterRegistry.getVaultsByTVL(limit)` - TVL rankings
- `MasterRegistry.getVaultsByPopularity(limit)` - Popularity rankings
- `MasterRegistry.getVaultInfo(address)` - Vault details
- `MasterRegistry.getInstancesByVault(address)` - Projects using vault
- `UltraAlignmentVault.vaultType()` - Vault type
- `UltraAlignmentVault.accumulatedFees()` - TVL
- `UltraAlignmentVault.totalShares()` - Total shares
- `UltraAlignmentVault.description()` - Description

**State:**
```javascript
{
  mode: 'tvl' | 'popularity',
  vaults: [
    {
      address: string,
      name: string,
      type: string,
      tvl: string,
      popularity: number,
      benefactorCount: number,
      instanceCount: number
    }
  ],
  totalVaults: number,
  currentPage: number,
  pageSize: number,
  loading: boolean
}
```

**UI Elements:**
- Mode toggle (TVL / Popularity)
- Total vault count
- Leaderboard table:
  - Rank
  - Vault name (clickable)
  - Vault type
  - TVL or Popularity score
  - # of projects using it
- Pagination controls

**Behavior:**
- Toggle switches ranking method
- Pagination loads more vaults
- Click vault row → navigate to `/vaults/:address`

---

## Page 3: Vault Detail (`/vaults/:address`) - NEW PAGE

### Purpose
View individual vault details, benefactors, and claim fees

### User Journey
1. Navigate from vault explorer or home widget
2. See vault details (type, TVL, description)
3. View benefactor list (if user is benefactor, highlighted)
4. See projects using this vault
5. Claim fees (if user is benefactor)

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton                    │
├─────────────────────────────────────────┤
│   ← Back to Vaults                      │
├─────────────────────────────────────────┤
│   VAULT DETAIL: Vault Name              │
│   Address: 0x1234...5678                │
│   Type: Ultra Alignment                 │
│   Description: ...                      │
├─────────────────────────────────────────┤
│   VAULT STATS                           │
│   Total TVL: $1.2M                      │
│   Total Shares: 10,000                  │
│   Benefactors: 15                       │
│   Projects Using: 8                     │
├─────────────────────────────────────────┤
│   BENEFACTORS (Top 10)                  │
│   ┌─────────────────────────────────┐  │
│   │ Address     │ Shares │ % of TVL │  │
│   ├─────────────────────────────────┤  │
│   │ 0x1234... * │ 2,500  │ 25%      │  │ * = You
│   │ 0x5678...   │ 1,500  │ 15%      │  │
│   │ 0x9abc...   │ 1,000  │ 10%      │  │
│   └─────────────────────────────────┘  │
├─────────────────────────────────────────┤
│   YOUR POSITION (if benefactor)         │
│   Your Contribution: $300K              │
│   Your Shares: 2,500 (25%)              │
│   Claimable Fees: $5,420                │
│   [Claim Fees] button                   │
├─────────────────────────────────────────┤
│   PROJECTS USING THIS VAULT             │
│   ┌───────┐ ┌───────┐ ┌───────┐       │
│   │Project│ │Project│ │Project│       │
│   │ Card  │ │ Card  │ │ Card  │       │
│   └───────┘ └───────┘ └───────┘       │
└─────────────────────────────────────────┘
```

### Components

#### 3.1 VaultDetail (NEW)
**File:** `src/components/VaultDetail/VaultDetail.js`

**Contract Methods:**
- `MasterRegistry.getVaultInfo(address)` - Vault metadata
- `MasterRegistry.getInstancesByVault(address)` - Projects using vault
- `UltraAlignmentVault.vaultType()` - Vault type
- `UltraAlignmentVault.description()` - Description
- `UltraAlignmentVault.accumulatedFees()` - Total TVL
- `UltraAlignmentVault.totalShares()` - Total shares
- `UltraAlignmentVault.getBenefactorContribution(address)` - User contribution
- `UltraAlignmentVault.getBenefactorShares(address)` - User shares
- `UltraAlignmentVault.calculateClaimableAmount(address)` - User claimable fees
- `UltraAlignmentVault.claimFees()` - Claim transaction

**State:**
```javascript
{
  vaultAddress: address,
  vaultInfo: {
    name: string,
    type: string,
    description: string,
    tvl: string,
    totalShares: string,
    benefactorCount: number
  },
  userPosition: {
    isBenefactor: boolean,
    contribution: string,
    shares: string,
    sharePercent: number,
    claimableAmount: string
  },
  benefactors: [
    { address, shares, percent }
  ],
  projectsUsingVault: [
    { projectData }
  ],
  loading: boolean
}
```

**UI Elements:**
- Vault header (name, address, type, description)
- Stats cards (TVL, shares, benefactor count, project count)
- Benefactors table (top 10 or all)
- User position card (if user is benefactor)
  - Your contribution
  - Your shares
  - Claimable fees
  - [Claim Fees] button
- Projects grid (using existing `ProjectCard`)

**Behavior:**
- Highlight user in benefactor list (if applicable)
- Show "Your Position" section only if user is benefactor
- "Claim Fees" button:
  - Prompts wallet connection if not connected
  - Calls `claimFees()` transaction
  - Updates UI after success

---

## Page 4: Global Activity Feed (`/messages`) - NEW PAGE

### Purpose
Full-page view of protocol-wide messages with pagination and filtering

### User Journey
1. Navigate from home "View All Activity" link
2. See all recent messages (paginated)
3. Filter by message type (mint/buy/sell/etc.)
4. Filter by specific project
5. Click message → navigate to project

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton                    │
├─────────────────────────────────────────┤
│   ← Back to Home                        │
├─────────────────────────────────────────┤
│   GLOBAL ACTIVITY FEED                  │
│   Total Messages: 1,234                 │
│   ┌─────────────────────────────────┐  │
│   │ Filter: [All] [Mint] [Buy/Sell] │  │
│   │ Project: [All Projects ▼]        │  │
│   └─────────────────────────────────┘  │
├─────────────────────────────────────────┤
│   MESSAGES (Chronological)              │
│   ┌─────────────────────────────────┐  │
│   │ 🎨 User minted Edition #3       │  │
│   │    → Cool Art Project            │  │
│   │    2 minutes ago                 │  │
│   ├─────────────────────────────────┤  │
│   │ 📈 User bought 100 tokens        │  │
│   │    → Bonding Project             │  │
│   │    5 minutes ago                 │  │
│   ├─────────────────────────────────┤  │
│   │ 📉 User sold 50 tokens           │  │
│   │    → Another Project             │  │
│   │    8 minutes ago                 │  │
│   └─────────────────────────────────┘  │
│   [Load More] or [Prev] [Next]         │
└─────────────────────────────────────────┘
```

### Components

#### 4.1 GlobalActivityFeed (NEW)
**File:** `src/components/GlobalActivityFeed/GlobalActivityFeed.js`

**Contract Methods:**
- `GlobalMessageRegistry.getMessageCount()` - Total messages
- `GlobalMessageRegistry.getRecentMessages(count)` - Recent messages
- `GlobalMessageRegistry.getRecentMessagesPaginated(offset, limit)` - Paginated
- `GlobalMessageRegistry.getInstanceMessages(instance, count)` - Filter by project
- `GlobalMessageRegistry.getInstanceMessagesPaginated(instance, offset, limit)` - Paginated by project
- `GlobalMessageRegistry.getMessagesBatch(ids[])` - Batch query (optimization)

**State:**
```javascript
{
  messages: [
    {
      id: number,
      instance: address,
      instanceName: string,
      user: address,
      messageType: string,
      message: string,
      timestamp: number
    }
  ],
  totalMessages: number,
  filters: {
    type: 'all' | 'mint' | 'buy' | 'sell' | 'stake',
    instance: address | null
  },
  pagination: {
    offset: number,
    limit: number,
    hasMore: boolean
  },
  loading: boolean
}
```

**UI Elements:**
- Total message count
- Filter dropdowns:
  - Type filter (All / Mint / Buy/Sell / Stake)
  - Project filter (All / specific project)
- Message list:
  - Icon (based on type)
  - Formatted message
  - Project name (clickable)
  - Timestamp (relative)
- Pagination controls (Load More / Prev/Next)

**Behavior:**
- Filters trigger re-fetch with filtered adapter method
- Pagination loads more messages
- Click project → navigate to project detail
- Real-time updates optional (future enhancement)

---

## Page 5: User Portfolio (`/portfolio`) - NEW PAGE

### Purpose
User's personal dashboard showing all holdings, claimable rewards, and activity

### User Journey
1. Navigate from wallet menu or direct link
2. See all token holdings across projects
3. See all NFT holdings (ERC404 + ERC1155)
4. View claimable vault fees
5. View staking positions
6. See personal transaction history

### Layout Structure

```
┌─────────────────────────────────────────┐
│ FloatingWalletButton                    │
├─────────────────────────────────────────┤
│   ← Back to Home                        │
├─────────────────────────────────────────┤
│   YOUR PORTFOLIO                        │
│   Wallet: 0x1234...5678                 │
├─────────────────────────────────────────┤
│   OVERVIEW                              │
│   Total Value: $12,450                  │
│   Claimable Rewards: $245               │
│   [Claim All Rewards] button            │
├─────────────────────────────────────────┤
│   ERC404 HOLDINGS                       │
│   ┌─────────────────────────────────┐  │
│   │ Project A: 500 tokens + 5 NFTs  │  │
│   │ Project B: 1,000 tokens + 10 NFTs│  │
│   └─────────────────────────────────┘  │
├─────────────────────────────────────────┤
│   ERC1155 HOLDINGS                      │
│   ┌───────┐ ┌───────┐ ┌───────┐       │
│   │Edition│ │Edition│ │Edition│       │
│   │  #3   │ │  #7   │ │  #12  │       │
│   │ (x5)  │ │ (x2)  │ │ (x1)  │       │
│   └───────┘ └───────┘ └───────┘       │
├─────────────────────────────────────────┤
│   VAULT POSITIONS                       │
│   ┌─────────────────────────────────┐  │
│   │ Vault A: $5K contribution       │  │
│   │ Claimable: $120                  │  │
│   │ [Claim] button                   │  │
│   └─────────────────────────────────┘  │
├─────────────────────────────────────────┤
│   STAKING POSITIONS                     │
│   ┌─────────────────────────────────┐  │
│   │ Project X: 500 staked            │  │
│   │ Pending Rewards: $25             │  │
│   │ [Claim] [Unstake] buttons        │  │
│   └─────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Components

#### 5.1 UserPortfolio (NEW)
**File:** `src/components/UserPortfolio/UserPortfolio.js`

**Contract Methods:**
- **For each ERC404 project:**
  - `ERC404.balanceOf(user)` - Token balance
  - `ERC404.getNFTBalance(user)` - NFT count
  - `ERC404.getStakingInfo(user)` - Staking position
  - `ERC404.calculatePendingRewards(user)` - Staking rewards
- **For each ERC1155 project:**
  - `ERC1155.balanceOf(user, editionId)` - Edition balances
  - `ERC1155.balanceOfBatch(user, ids[])` - Batch query
- **For each vault user participates in:**
  - `UltraAlignmentVault.getBenefactorContribution(user)` - Contribution
  - `UltraAlignmentVault.getBenefactorShares(user)` - Shares
  - `UltraAlignmentVault.calculateClaimableAmount(user)` - Claimable fees
- **Transactions:**
  - `claimVaultFees()` - Claim from vault
  - `claimStakerRewards()` - Claim staking rewards

**State:**
```javascript
{
  userAddress: address,
  erc404Holdings: [
    {
      project: projectData,
      tokenBalance: string,
      nftBalance: number,
      stakingPosition: {
        stakedAmount: string,
        pendingRewards: string
      }
    }
  ],
  erc1155Holdings: [
    {
      project: projectData,
      editions: [
        { editionId, balance, metadata }
      ]
    }
  ],
  vaultPositions: [
    {
      vaultAddress: address,
      vaultName: string,
      contribution: string,
      shares: string,
      claimableAmount: string
    }
  ],
  totalValue: string,
  totalClaimable: string,
  loading: boolean
}
```

**UI Elements:**
- Wallet address display
- Overview stats:
  - Total portfolio value (estimated)
  - Total claimable rewards
  - [Claim All Rewards] button (batch claim)
- ERC404 Holdings section
- ERC1155 Holdings section (gallery of owned editions)
- Vault Positions section
- Staking Positions section

**Behavior:**
- On mount, query all project registries for user holdings
- Batch queries where possible for performance
- Individual claim buttons per position
- "Claim All" button executes multiple transactions

**Performance Notes:**
- This page may be slow if user has many holdings
- Use loading states per section
- Consider lazy loading sections

---

## Page 6: Project Detail - ERC1155 Enhancements

### Purpose
Update existing ERC1155 project detail page with new adapter methods

### Current State
- Shows edition gallery
- Can mint editions
- Shows user balance

### Enhancements Needed

#### 6.1 Enhanced EditionCard (Update existing)
**File:** `src/components/ERC1155/EditionCard.js`

**Current Methods:**
- ✅ `getEditionInfo()`
- ✅ `getBalanceForEdition()`

**New Methods to Add:**
- ✅ `getMintStats(editionId)` - Show "X/Y minted" badge
- ✅ `getPricingInfo(editionId)` - Show dynamic pricing indicator
- ✅ `getCurrentPrice(editionId)` - Show current price (not just base price)
- ✅ `calculateMintCost(editionId, amount)` - Show total cost before minting

**New UI Elements:**
- Mint stats badge: "50/100 minted" or "Unlimited"
- Price indicator:
  - Fixed price: "0.01 ETH"
  - Dynamic: "0.01 ETH → 0.02 ETH" (with arrow)
- Supply status:
  - "Nearly Sold Out" (if >90% minted)
  - "Limited Edition" (if has max supply)
  - "Open Edition" (if unlimited)

---

#### 6.2 Enhanced EditionMintInterface (Update existing)
**File:** `src/components/ERC1155/EditionMintInterface.js`

**Current Methods:**
- ✅ `mintEdition()`

**New Methods to Add:**
- ✅ `mintWithMessage(editionId, amount, message)` - Add message option
- ✅ `calculateMintCost(editionId, amount)` - Live cost calculator

**New UI Elements:**
- Amount selector (existing)
- Live cost display: "Total: 0.05 ETH" (updates as amount changes)
- Optional message input:
  - Checkbox: "Add message (appears in activity feed)"
  - Text input: "Your message (optional)"
- Mint button (existing)

**Behavior:**
- As user changes amount, `calculateMintCost()` updates total
- If message checkbox enabled, use `mintWithMessage()` instead of `mintEdition()`

---

#### 6.3 Creator Dashboard Section (NEW on project detail)
**File:** `src/components/ERC1155/CreatorDashboard.js` (exists but minimal)

**Purpose:** Show owner-only controls on ERC1155 project pages

**Visibility:** Only shown if connected wallet is project owner

**Contract Methods:**
- `getProjectName()` - Project name
- `getTotalProceeds()` - Total revenue
- `getCreatorBalance()` - Withdrawable balance (after 20% tithe)
- `withdraw(amount)` - Withdraw proceeds
- `claimVaultFees()` - Claim vault share
- `updateEditionMetadata(editionId, uri)` - Update metadata
- `setStyle(uri)` - Set project style
- `setEditionStyle(editionId, uri)` - Set edition style
- `addEdition(params)` - Add new edition

**UI Elements:**
- "Creator Dashboard" section (only visible to owner)
- Revenue stats:
  - Total proceeds collected
  - Your withdrawable balance (80%)
  - Vault's share (20%)
- [Withdraw] button
- [Claim Vault Fees] button (if owner is vault benefactor)
- [Add New Edition] button
- Per-edition controls:
  - [Update Metadata] button
  - [Set Style] button

---

## Page 7: Project Detail - ERC404 Enhancements

### Purpose
Update existing ERC404 project detail page with new adapter methods

### Current State
- Shows trading interface (buy/sell)
- Shows bonding curve chart
- Shows user balances

### Enhancements Needed

#### 7.1 Bonding Status Display (NEW)
**File:** `src/components/ERC404/BondingStatusPanel.js`

**Contract Methods:**
- `getBondingStatus()` - Current phase (open, active, matured)
- `getLiquidityInfo()` - Liquidity deployment status
- `getSupplyInfo()` - Total supply, max supply
- `getTierConfigSummary()` - Tier information
- `getUserTierInfo(user)` - User's accessible tiers

**UI Elements:**
- Status badge: "Active Bonding" / "Matured" / "Liquidity Deployed"
- Progress bar: "65% to max supply"
- Current tier display
- Next tier unlock info (if applicable)

---

#### 7.2 Staking Interface (NEW)
**File:** `src/components/ERC404/StakingInterface.js`

**Purpose:** Allow token holders to stake and earn rewards

**Contract Methods:**
- `getStakingInfo(user)` - User's staking position
- `getStakingStats()` - Protocol staking stats
- `calculatePendingRewards(user)` - Claimable rewards
- `stake(amount)` - Stake tokens
- `unstake(amount)` - Unstake tokens
- `claimStakerRewards()` - Claim rewards

**UI Elements:**
- Staking stats:
  - Your staked amount
  - Your pending rewards
  - Total protocol staked
- [Stake] button (with amount input)
- [Unstake] button (with amount input)
- [Claim Rewards] button

**Behavior:**
- Only shown if staking is enabled (`isStakingEnabled()`)
- Live updates of pending rewards

---

#### 7.3 NFT Management Section (NEW)
**File:** `src/components/ERC404/NFTManagement.js`

**Contract Methods:**
- `getSkipNFT(user)` - Current skip NFT status
- `setSkipNFT(bool)` - Toggle skip NFT
- `balanceMint(amount)` - Mint NFTs from token balance
- `getRerollEscrow(user)` - Reroll escrow amount
- `rerollSelectedNFTs(tokenAmount, exemptedIds[])` - Reroll NFTs

**UI Elements:**
- Skip NFT toggle:
  - Checkbox: "Skip automatic NFT minting"
  - Explanation text
- Balance Mint section:
  - "You have X tokens that can become Y NFTs"
  - [Mint NFTs from Balance] button
- Reroll section:
  - "Reroll your NFTs for new traits"
  - [Reroll] button → Opens `ReRollModal` (already exists)

---

#### 7.4 Owner Controls (NEW)
**File:** `src/components/ERC404/OwnerDashboard.js`

**Purpose:** Show owner-only controls on ERC404 project pages

**Visibility:** Only shown if connected wallet is project owner

**Contract Methods:**
- `setBondingOpenTime(timestamp)` - Set open time
- `setBondingMaturityTime(timestamp)` - Set maturity
- `setBondingActive(bool)` - Toggle active state
- `deployLiquidity(params)` - Deploy to Uniswap V4
- `canDeployPermissionless()` - Check if others can deploy
- `enableStaking()` - Enable staking
- `setStyle(uri)` - Set project style
- `setV4Hook(address)` - Set Uniswap hook
- `setVault(address)` - Change vault

**UI Elements:**
- "Owner Dashboard" section
- Bonding controls:
  - Open time picker
  - Maturity time picker
  - [Update Times] button
  - [Toggle Active] button
- Liquidity deployment:
  - Status display
  - [Deploy Liquidity] button (with params)
- Staking control:
  - [Enable Staking] button (if not enabled)
- Advanced settings:
  - Hook address input + update button
  - Vault address input + update button
  - Style URI input + update button

---

## Implementation Roadmap

### Phase 1: Remove Friction & Home Page Redesign (Week 1-2)
**Goal:** Ship improved UX and home page with vaults + messaging

**Priority:** Critical

**Tasks:**
1. Create `FloatingWalletButton` component
2. Remove `WalletSplash` blocking behavior
3. Update all routes to remove splash dependency
4. Create `TopVaultsWidget` component
5. Create `RecentActivityWidget` component
6. Simplify `ProjectGallery` (collapsed search)
7. Update `HeroSection` with Create dropdown
8. Wire up new components to home page
9. Test deep linking (direct to project pages)

**Deliverables:**
- ✅ No wallet splash blocking
- ✅ Floating wallet button on all pages
- ✅ Home page shows vaults widget
- ✅ Home page shows activity widget
- ✅ Simplified project gallery with search

**Contract Methods Used:**
- 14 new methods (vaults + messaging)

**Estimated Effort:** Medium (2 weeks)

---

### Phase 2: Edition Card Enhancements (Week 3)
**Goal:** Show mint stats and pricing info on edition cards

**Priority:** High (high value, low effort)

**Tasks:**
1. Update `EditionCard` to call `getMintStats()`
2. Display "X/Y minted" or "Unlimited" badge
3. Update `EditionCard` to call `getPricingInfo()`
4. Show dynamic pricing indicators
5. Update `EditionMintInterface` to use `calculateMintCost()`
6. Add optional message input to mint interface
7. Wire up `mintWithMessage()` method

**Deliverables:**
- ✅ Edition cards show supply remaining
- ✅ Edition cards show pricing model
- ✅ Mint interface shows live cost calculation
- ✅ Users can mint with messages

**Contract Methods Used:**
- 4 new methods (ERC1155 enhancements)

**Estimated Effort:** Small (1 week)

---

### Phase 3: Vault Pages (Week 4-5)
**Goal:** Full vault discovery and detail pages

**Priority:** High

**Tasks:**
1. Create `/vaults` route
2. Create `VaultExplorer` component
3. Create `/vaults/:address` route
4. Create `VaultDetail` component
5. Wire up all vault adapter methods
6. Implement claim fees functionality
7. Show benefactor positions
8. Link projects to vaults

**Deliverables:**
- ✅ Vault explorer page
- ✅ Vault detail pages
- ✅ Claim fees interface
- ✅ View benefactors and projects

**Contract Methods Used:**
- 10 new methods (vault management)

**Estimated Effort:** Medium (2 weeks)

---

### Phase 4: Activity Feed Page (Week 6)
**Goal:** Full global activity feed with pagination

**Priority:** Medium

**Tasks:**
1. Create `/messages` route
2. Create `GlobalActivityFeed` component
3. Implement pagination
4. Add filter controls (type, project)
5. Format messages nicely
6. Make messages clickable → projects

**Deliverables:**
- ✅ Full activity feed page
- ✅ Paginated messages
- ✅ Filterable by type and project

**Contract Methods Used:**
- 6 new methods (message pagination + filtering)

**Estimated Effort:** Small (1 week)

---

### Phase 5: User Portfolio Page (Week 7-8)
**Goal:** Personal dashboard for users

**Priority:** Medium

**Tasks:**
1. Create `/portfolio` route
2. Create `UserPortfolio` component
3. Query all user holdings (ERC404 + ERC1155)
4. Show vault positions
5. Show staking positions
6. Implement batch claim functionality

**Deliverables:**
- ✅ User portfolio page
- ✅ View all holdings
- ✅ Claim rewards interface

**Contract Methods Used:**
- 20+ methods (queries across all contracts)

**Estimated Effort:** Medium (2 weeks)

---

### Phase 6: ERC404 Enhancements (Week 9-10)
**Goal:** Complete ERC404 feature set

**Priority:** Medium

**Tasks:**
1. Create `BondingStatusPanel` component
2. Create `StakingInterface` component
3. Create `NFTManagement` component
4. Create `OwnerDashboard` component (ERC404)
5. Wire up all new ERC404 methods
6. Add staking UI
7. Add NFT balance minting UI
8. Add owner controls

**Deliverables:**
- ✅ Bonding status display
- ✅ Staking interface
- ✅ NFT management tools
- ✅ Owner dashboard

**Contract Methods Used:**
- 25+ new methods (ERC404 advanced features)

**Estimated Effort:** Medium (2 weeks)

---

### Phase 7: ERC1155 Creator Dashboard (Week 11)
**Goal:** Complete ERC1155 owner tools

**Priority:** Low

**Tasks:**
1. Enhance `CreatorDashboard` component
2. Add withdraw interface
3. Add metadata update tools
4. Add style customization tools
5. Add edition management (add/update)

**Deliverables:**
- ✅ Creator dashboard on project pages
- ✅ Withdraw proceeds
- ✅ Update metadata
- ✅ Style customization

**Contract Methods Used:**
- 7 new methods (ERC1155 owner functions)

**Estimated Effort:** Small (1 week)

---

### Phase 8: Governance Pages (Week 12-14)
**Goal:** Full governance voting interface

**Priority:** Low

**Tasks:**
1. Expand `/voting` page
2. Create factory governance interface
3. Create vault governance interface
4. Add voting functionality
5. Add challenge submission
6. Add deposit management
7. Show governance constants and status

**Deliverables:**
- ✅ Full governance UI
- ✅ Vote on factory/vault applications
- ✅ Submit challenges
- ✅ Manage deposits

**Contract Methods Used:**
- 24 new methods (governance)

**Estimated Effort:** Large (3 weeks)

---

### Phase 9: Advanced Features (Week 15-16)
**Goal:** Featured position rental, factory management

**Priority:** Low

**Tasks:**
1. Add featured position rental UI
2. Add factory instance creation UI
3. Add transfer interfaces (send tokens/editions)
4. Add approval management UI
5. Polish and optimize

**Deliverables:**
- ✅ Rent featured positions
- ✅ Create instances from factories
- ✅ Transfer UI
- ✅ Complete feature parity

**Contract Methods Used:**
- Remaining ~30 methods

**Estimated Effort:** Medium (2 weeks)

---

## Total Implementation Timeline

**Total Phases:** 9
**Total Time:** 16 weeks (~4 months)
**Total New Methods Wired:** ~218 (from 20 to 238)

### Milestones

- **Week 2:** Home page redesign complete
- **Week 5:** Vault system complete
- **Week 8:** User portfolio complete
- **Week 10:** ERC404 feature complete
- **Week 14:** Governance complete
- **Week 16:** Full feature parity achieved

---

## Component Reusability

### Patterns to Standardize

#### 1. Card Components
- `ProjectCard` (existing)
- `VaultCard` (new)
- `EditionCard` (existing, enhanced)
- Pattern: Consistent layout, hover effects, click behavior

#### 2. List/Table Components
- `VaultLeaderboard`
- `BenefactorTable`
- `MessageList`
- Pattern: Sortable, paginated, filterable

#### 3. Dashboard Components
- `CreatorDashboard` (ERC1155 owners)
- `OwnerDashboard` (ERC404 owners)
- Pattern: Owner-only, conditional rendering, action buttons

#### 4. Modal Components (existing patterns)
- `MintModal` (existing)
- `ReRollModal` (existing)
- `ApprovalModal` (existing)
- Pattern: Overlay, form inputs, transaction handling

---

## Success Metrics

### By Phase 1 (Week 2):
- ✅ Zero complaints about wallet splash blocking
- ✅ Users can deep link to any page
- ✅ Home page shows live vault and message data

### By Phase 3 (Week 5):
- ✅ Users can discover all vaults
- ✅ Benefactors can claim fees
- ✅ Vault TVL rankings visible

### By Phase 5 (Week 8):
- ✅ Users can see complete portfolio
- ✅ One-click claim all rewards works
- ✅ All holdings visible across protocols

### By Phase 9 (Week 16):
- ✅ 238/238 adapter methods used (100%)
- ✅ All checklist features accessible
- ✅ Complete feature parity achieved

---

## Next Steps

1. ✅ Review this architecture document
2. ✅ Approve or request changes
3. ⏭️ Begin Phase 1 implementation
4. ⏭️ Iterate based on feedback
5. ⏭️ Deploy progressively (phase by phase)

**Ready to start building?**

---

## Architecture Summary: Three-Pathway Design

### Clean Information Architecture

The frontend is organized around **three distinct user pathways**, preventing feature clutter while maintaining full accessibility:

#### 1. Main UI (Regular Users) 🎮
**Always Visible, Prominently Accessible**
- Home page → Projects, Vaults, Activity
- Project detail pages
- Vault explorer
- Clean, focused navigation
- ✅ Can create instances from existing factories
- ❌ Does NOT show factory submission forms
- ❌ Does NOT show governance unless navigating there

**Philosophy:** "Learn, Do, Play" - everything regular users need, nothing they don't.

---

#### 2. Wallet Menu (Power Users) 💎
**Accessible Anywhere, Tucked Away**
- Portfolio dashboard → All holdings
- Governance dashboard → Vote on proposals
- Staking management → Manage positions
- Vault positions → Benefactor claims
- Conditional visibility (shown if relevant to user)

**Philosophy:** Advanced features available without cluttering main UI. Click wallet → access power tools.

---

#### 3. Documentation Gateway (Developers) 🔧
**Accessible but Not Prominent**
- Documentation "For Developers" tab
- Links to factory submission
- Links to vault registration
- Governance process explanation
- Technical docs, ABIs, integration guides

**Philosophy:** Developers can extend the protocol without adding complexity to the main user experience.

---

### Why This Works

**For Regular Users:**
- Clean UI focused on core actions
- No confusing "advanced" options
- Discover → Mint → Trade flow is obvious

**For Power Users:**
- Everything they need in wallet menu
- Portfolio and governance always accessible
- Contextual visibility (governance only shown to EXEC holders)

**For Developers:**
- Clear path to submission forms via docs
- Not cluttering main navigation
- Technical depth available where appropriate

**Result:** One frontend serves three user types without compromising any experience.

---

## Implementation Notes

### Phase 1 Priority
1. Create `FloatingWalletButton` with dropdown menu
2. Update Documentation with "For Developers" tab
3. Keep main navigation clean (no factory/governance links)
4. Hide advanced features behind wallet menu

### Testing Each Pathway
**Regular User Flow:**
```
Home → Browse projects → Click project → Mint/Trade
     → Browse vaults → Click vault → View details
     → View activity → Click message → Go to project
```

**Power User Flow:**
```
Click Wallet → Portfolio → See all holdings
            → Governance → Vote on proposals
            → Staking → Manage positions
```

**Developer Flow:**
```
Documentation → For Developers Tab → Submit Factory
                                   → Register Vault
                                   → View Governance Process
```

All three should be tested to ensure proper separation and accessibility.

