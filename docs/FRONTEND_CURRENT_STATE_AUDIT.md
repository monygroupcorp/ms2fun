# Frontend Current State Audit
**Date:** 2026-01-08
**Purpose:** Document existing pages, components, and adapter method usage to identify gaps

---

## Executive Summary

**Current State:**
- 14 routes/pages implemented
- ~30 components
- **Only 20 adapter methods used** (out of 238 available = 8.4% utilization)

**Key Finding:** We have a comprehensive data layer (adapters) but minimal UI layer wiring.

---

## Page-by-Page Breakdown

### 1. Home Page (`/`)
**Route:** `HomePage.js`
**Purpose:** Landing page with project discovery

**Components:**
- `WalletSplash` - Wallet connection overlay
- `ProjectDiscovery` - Main project browser
  - `ProjectSearch` - Search bar
  - `ProjectFilters` - Filter dropdown
  - `ProjectCard` (multiple) - Project cards in grid

**Adapter Methods Used:**
- `ProjectRegistry.getAllProjects()`
- `ProjectRegistry.indexFromMaster()`
- `MasterService.getAuthorizedFactories()`
- `MasterService.getFactoryType()`

**Missing Features:**
- ❌ No Global Activity Feed (`getRecentMessages()`)
- ❌ No Featured Projects Carousel (`getFeaturedInstances()`)
- ❌ No Vault Leaderboard widget
- ❌ No "Trending" section
- ❌ No stats dashboard (total projects, volume, etc.)

---

### 2. Project Detail Page (`/project/:id` or `/:chainId/:factoryTitle/:instanceName`)
**Route:** `ProjectDetail.js`
**Purpose:** View individual project details and interact

**Components:**
- `WalletDisplay` - Wallet info in header
- `ProjectHeader` - Project name, description, metadata
- `ContractTypeRouter` - Routes to type-specific interface
  - **For ERC404:** `ERC404TradingInterface`
  - **For ERC1155:** `EditionGallery`

#### 2a. ERC404 Trading Interface

**Components:**
- `ERC404TradingInterface` - Main trading UI
  - `SwapInterface` - Buy/sell bonding curve tokens
  - `BondingCurve` - Visual curve chart
  - `BalanceDisplay` - User balances

**Adapter Methods Used:**
- `getCurrentPrice()`
- `getTokenBalance()`
- `getEthBalance()`
- `getNFTBalance()`
- `getExecForEth()` - Calculate tokens for ETH
- `getEthForExec()` - Calculate ETH for tokens
- `getCurrentTier()`
- `getMerkleProof()`
- `buyBonding()`
- `sellBonding()`

**Missing Features:**
- ❌ No bonding status display (`getBondingStatus()`)
- ❌ No liquidity info (`getLiquidityInfo()`)
- ❌ No supply info (`getSupplyInfo()`)
- ❌ No tier configuration display (`getTierConfigSummary()`)
- ❌ No user tier info (`getUserTierInfo()`)
- ❌ No staking interface (`stake()`, `unstake()`, `claimStakerRewards()`)
- ❌ No reroll interface (only modal exists, not displayed)
- ❌ No NFT balance minting (`balanceMint()`)
- ❌ No skip NFT toggle (`setSkipNFT()`)
- ❌ No owner controls (set bonding times, deploy liquidity, etc.)
- ❌ No style customization

#### 2b. ERC1155 Edition Gallery

**Components:**
- `EditionGallery` - Grid of editions
  - `EditionCard` (multiple) - Individual edition cards
    - `EditionMintInterface` - Mint modal

**Adapter Methods Used:**
- `getEditions()`
- `getEditionInfo()`
- `getBalanceForEdition()`
- `mintEdition()`

**Missing Features:**
- ❌ No mint stats (`getMintStats()` - "X/Y minted")
- ❌ No pricing info display (`getPricingInfo()` - dynamic pricing)
- ❌ No cost calculator (`calculateMintCost()`)
- ❌ No mint with message (`mintWithMessage()`)
- ❌ No project name display (`getProjectName()`)
- ❌ No total proceeds (`getTotalProceeds()`)
- ❌ No batch queries (`getEditionsBatch()`)
- ❌ No transfer interface (`safeTransferFrom()`)
- ❌ No approval management (`setApprovalForAll()`)
- ❌ No creator dashboard (withdraw, update metadata, set styles)

---

### 3. Edition Detail Page (`/:chainId/:factoryTitle/:instanceName/:pieceTitle`)
**Route:** `EditionDetail.js`
**Purpose:** View single edition in detail

**Components:**
- `EditionDetail` - Detailed edition view with large image
- `EditionMintInterface` - Mint interface

**Adapter Methods Used:**
- `getEditionInfo()`
- `getBalanceForEdition()`
- `mintEdition()`

**Missing Features:**
- Same as Edition Gallery (no mint stats, pricing info, etc.)

---

### 4. Factory Exploration Page (`/factories`)
**Route:** `FactoryExploration.js`
**Purpose:** Browse all available factories

**Components:**
- `FactoryExploration` - Factory grid
  - `FactoryCard` (multiple) - Individual factory cards

**Adapter Methods Used:**
- `MasterService.getAuthorizedFactories()`
- `MasterService.getFactoryType()`
- `MasterService.getInstancesByFactory()`

**Missing Features:**
- ❌ No factory details (`getFactoryInfo()`)
- ❌ No total factory count (`getTotalFactories()`)
- ❌ No factory instances list (`getInstances()`)
- ❌ No factory hook info (`getHookForInstance()`)
- ❌ No factory vault info (`getVaultForInstance()`)
- ❌ No create instance UI (`createInstance()`)
- ❌ No factory settings (set default hook/vault)

---

### 5. Factory Detail Page (`/factory/:id`)
**Route:** `FactoryDetail.js`
**Purpose:** View individual factory details

**Components:**
- `FactoryDetail` - Factory information page

**Adapter Methods Used:**
- Likely similar to FactoryExploration

**Missing Features:**
- Same as Factory Exploration page

---

### 6. Project Creation Page (`/:chainId/:factoryTitle/create`)
**Route:** `ProjectCreation.js`
**Purpose:** Create new project instances

**Components:**
- (Need to verify actual implementation)

**Adapter Methods Used:**
- `createInstance()` (likely)

**Missing Features:**
- Full audit needed

---

### 7. Factory Application Page (`/factories/apply`)
**Route:** `FactoryApplicationPage.js`
**Purpose:** Submit factory for governance approval

**Components:**
- Factory application form

**Adapter Methods Used:**
- `submitApplication()` (likely)
- `applicationFee()` (likely)

**Missing Features:**
- Full audit needed

---

### 8. Factory Application Status Page (`/factories/application/:address`)
**Route:** `FactoryApplicationStatusPage.js`
**Purpose:** View factory application status

**Components:**
- Application status display

**Adapter Methods Used:**
- `getApplication()` (likely)

**Missing Features:**
- Full audit needed

---

### 9. Voting/Governance Dashboard (`/voting` or `/exec/voting`)
**Route:** `ExecVotingDashboard.js`
**Purpose:** EXEC token holder voting interface

**Components:**
- Governance dashboard

**Adapter Methods Used:**
- Unknown (need to verify)

**Missing Features:**
- Likely missing most governance methods:
  - ❌ `voteWithDeposit()`
  - ❌ `initiateChallenge()`
  - ❌ `finalizeRound()`
  - ❌ `withdrawDeposits()`
  - ❌ Vote deposit info display
  - ❌ Challenge status
  - ❌ Governance constants display

---

### 10. CULT EXECS Page (`/cultexecs`)
**Route:** `CultExecsPage.js`
**Purpose:** Flagship project (EXEC404) dedicated page

**Components:**
- Custom CULT EXEC interface

**Adapter Methods Used:**
- Unknown (need to verify - likely similar to ERC404TradingInterface)

---

### 11. Documentation Pages (`/about`, `/docs`)
**Route:** `Documentation.js`
**Purpose:** Help and documentation

**Components:**
- `Documentation` - Docs container
- `FAQ` - FAQ section

**Adapter Methods Used:**
- None (static content)

---

## Missing Pages (Not Implemented)

### ❌ Global Activity Feed Page
**Should show:**
- Recent messages across all projects (`getRecentMessages()`)
- Pagination (`getRecentMessagesPaginated()`)
- Filter by instance
- Message count (`getMessageCount()`)

### ❌ Vault Leaderboard/Explorer Page
**Should show:**
- All vaults (`getVaults()`)
- Vault TVL rankings (`getVaultsByTVL()`)
- Vault popularity (`getVaultsByPopularity()`)
- Vault details (`getVaultInfo()`)
- Which instances use each vault (`getInstancesByVault()`)

### ❌ User Portfolio/Dashboard Page
**Should show:**
- User's holdings across all projects
- Claimable vault fees (`calculateClaimableAmount()`)
- Staking rewards
- Transaction history
- NFT gallery

### ❌ Vault Detail Page
**Should show:**
- Vault type, description
- Accumulated fees
- Total shares
- Benefactor list
- Claim fees interface (`claimFees()`)
- Conversion controls (`convertAndAddLiquidity()`)

### ❌ Governance Detail Pages
**Should show:**
- Active proposals
- Vote status
- Challenge history
- Deposit management

### ❌ Creator Dashboard
**Should show:**
- For ERC1155 owners:
  - Total proceeds (`getTotalProceeds()`)
  - Withdraw interface (`withdraw()`)
  - Claim vault fees (`claimVaultFees()`)
  - Update edition metadata (`updateEditionMetadata()`)
  - Add new editions (`addEdition()`)
  - Style customization (`setStyle()`, `setEditionStyle()`)
- For ERC404 owners:
  - Bonding configuration
  - Deploy liquidity controls
  - Staking management
  - Hook/vault settings

---

## Adapter Method Usage Summary

### Currently Used (20 methods)

#### Master Registry (4 methods)
- ✅ `getAuthorizedFactories()`
- ✅ `getFactoryType()`
- ✅ `getInstancesByFactory()`
- ✅ (Project registry methods)

#### ERC404 Trading (10 methods)
- ✅ `getCurrentPrice()`
- ✅ `getTokenBalance()`
- ✅ `getEthBalance()`
- ✅ `getNFTBalance()`
- ✅ `getExecForEth()`
- ✅ `getEthForExec()`
- ✅ `getCurrentTier()`
- ✅ `getMerkleProof()`
- ✅ `buyBonding()`
- ✅ `sellBonding()`

#### ERC1155 (4 methods)
- ✅ `getEditions()`
- ✅ `getEditionInfo()`
- ✅ `getBalanceForEdition()`
- ✅ `mintEdition()`

#### Other (2 methods)
- ✅ `getCreatorBalance()` (ERC1155)
- ✅ `submitApplication()` (likely - in factory application page)

### Not Used (218 methods)

See `FRONTEND_COVERAGE_CHECKLIST.md` for complete list of available methods.

**Key Missing Categories:**
- **Global Messages** - 0/9 methods used
- **Vault Management** - 0/9 methods used
- **Governance** - 0/24 methods used
- **Factory Management** - 0/16 methods used
- **ERC404 Advanced** - 0/22 additional methods used
- **ERC1155 Advanced** - 0/24 additional methods used
- **Owner Functions** - 0/32 methods used
- **Featured Position Rental** - 0/8 methods used

---

## Component Inventory

### Existing Components (by category)

#### Core/Layout
- `Component` - Base component class
- `Router` - Client-side routing
- `WalletConnector` - Wallet connection modal
- `WalletDisplay` - Wallet info display
- `WalletSplash` - Landing wallet prompt
- `ErrorBoundary` - Error handling
- `StatusMessage` - Toast notifications
- `MessagePopup` - Modal popups

#### Project Discovery
- `ProjectDiscovery` - Main project browser
- `ProjectSearch` - Search bar
- `ProjectFilters` - Filter controls
- `ProjectCard` - Project card in grid

#### Project Detail
- `ProjectDetail` - Project detail container
- `ProjectHeader` - Project info header
- `ContractTypeRouter` - Routes to type-specific UI

#### ERC404 Components
- `ERC404TradingInterface` - Main trading interface
- `SwapInterface` - Buy/sell form
- `SwapInputs` - Input fields
- `SwapButton` - Action button
- `BondingCurve` - Chart visualization
- `BalanceDisplay` - Balance display
- `ReRollModal` - NFT reroll modal (exists but not displayed)
- `SendModal` - Transfer modal
- `PortfolioModal` - Portfolio view modal
- `MintModal` - NFT mint modal

#### ERC1155 Components
- `EditionGallery` - Edition grid
- `EditionCard` - Individual edition card
- `EditionDetail` - Detailed edition view
- `EditionMintInterface` - Mint modal
- `CreatorDashboard` - Creator tools (exists but minimal)
- `CreateEditionModal` - Add edition modal

#### Factory Components
- `FactoryExploration` - Factory browser
- `FactoryCard` - Factory card

#### Admin/Developer
- `AdminDashboard` - Admin controls
- `AdminButton` - Admin toggle button
- `PerformanceIndicator` - Performance monitoring
- `StatusPanel` - Debug info panel

#### Documentation
- `Documentation` - Docs container
- `FAQ` - FAQ list
- `FAQItem` - FAQ accordion item

#### UI/Visual
- `StarfieldBackground` - Animated background
- `LiquidStarfield` - Animated background
- `ConstellationBackground` - Animated background
- `IpfsImage` - IPFS image loader
- `PriceDisplay` - Formatted price display
- `ApprovalModal` - Approval confirmation
- `TransactionOptions` - Transaction settings
- `ChatPanel` - Chat interface

---

## Key Gaps to Address

### 1. **High Priority - User-Facing Features**
- Global Activity Feed page
- Mint stats on edition cards ("50/100 minted")
- Dynamic pricing indicators
- Vault leaderboard page
- User portfolio/dashboard
- Featured projects carousel on home

### 2. **Medium Priority - Enhanced Functionality**
- Bonding curve status indicators
- Staking interface for ERC404
- Transfer interfaces (send editions)
- Cost calculators before minting
- Batch operations UI

### 3. **Low Priority - Owner/Admin Features**
- Creator dashboard (withdraw, metadata updates)
- Bonding curve configuration UI
- Liquidity deployment controls
- Style customization interfaces
- Factory instance creation UI

### 4. **Missing Infrastructure**
- Governance voting interface
- Challenge submission UI
- Vault fee claiming interface
- Featured position rental UI
- Approval management UI

---

## Recommendations

### Immediate Next Steps

1. **Document Pending Design Changes** (Step 2 of plan)
   - User lists their planned design changes
   - We note which pages/components are affected
   - Prevents duplicate work

2. **Prioritize Quick Wins**
   - Add mint stats to EditionCard (high value, low effort)
   - Add pricing info indicators
   - Create simple activity feed widget

3. **Design Major New Pages**
   - Activity Feed page
   - Vault Explorer page
   - User Portfolio page

4. **Create Component Library Spec**
   - Document reusable patterns
   - Design system for new components
   - Ensure consistency

---

## Next Document: DESIGN_CHANGES.md

Before designing new features, we need to capture pending design changes to avoid conflicts.

**Questions for User:**
1. What frontend design changes are pending implementation?
2. Which pages/components do they affect?
3. Are there visual/UX changes planned?
4. Any new navigation/layout structure?
