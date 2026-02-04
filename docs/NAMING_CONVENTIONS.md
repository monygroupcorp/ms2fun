# Naming Conventions

This document formalizes naming conventions for the ms2fun codebase to reduce ambiguity and improve maintainability.

## Component Naming

### Hierarchy Levels

| Suffix | Purpose | Example |
|--------|---------|---------|
| `*Page` | Route-level component, full page | `EditionPage`, `ProjectPage`, `PortfolioPage` |
| `*View` | Major view section within a page | `EditionView`, `ProjectView` |
| `*Panel` | Self-contained UI section | `MintPanel`, `BondingStatusPanel`, `TierStatusPanel` |
| `*Card` | Compact display unit for lists/grids | `EditionCard`, `ProjectCard`, `VaultCard` |
| `*Form` | User input collection | `MintForm`, `CreateEditionForm` |
| `*Interface` | Complex interactive UI (trading, swapping) | `TradingInterface`, `SwapInterface` |
| `*Display` | Read-only data presentation | `PriceDisplay`, `BalanceDisplay` |
| `*Stats` | Aggregated metrics display | `SupplyStats`, `VolumeStats` |
| `*List` | Collection of items | `EditionList`, `TransactionList` |
| `*Modal` | Overlay dialog | `ConfirmModal`, `WalletModal` |
| `*Button` | Standalone button with logic | `AdminButton`, `ConnectButton` |
| `*Badge` | Small status indicator | `StatusBadge`, `OwnerBadge` |

### Current Components → Proposed Names

| Current Name | Issue | Proposed Name |
|--------------|-------|---------------|
| `EditionDetail` | "Detail" is vague | `EditionView` or `EditionPage` |
| `EditionMintInterface` | Overly long | `MintPanel` |
| `ContractTypeRouter` | Technical, not descriptive | `ProjectContentRouter` |
| `FeaturedRental` | Action, not component type | `FeaturedRentalPanel` |
| `BondingStatusPanel` | Good | Keep |
| `TierStatusPanel` | Good | Keep |
| `OwnerDashboard` | "Dashboard" is overloaded | `OwnerPanel` |

## Route Naming

### URL Structure

```
/:chainId/:instanceName                    → Project page
/:chainId/:instanceName/:pieceTitle        → Edition page (ERC1155)
/:chainId/:instanceName/token/:tokenId     → Token page (ERC404)
/portfolio                                 → User portfolio
/create                                    → Project creation
/vaults                                    → Vault explorer
/vaults/:vaultAddress                      → Vault detail
```

### Route Handler Functions

```javascript
// Pattern: render{PageName}
renderProjectPage(params)
renderEditionPage(params)
renderPortfolioPage(params)
```

## Service & Adapter Naming

### Services

| Pattern | Purpose | Example |
|---------|---------|---------|
| `*Service` | Business logic layer | `ProjectService`, `WalletService` |
| `*Registry` | Data lookup/storage | `ProjectRegistry`, `ContractRegistry` |
| `*Index` | Indexed/cached data | `ProjectIndex`, `UserHoldingsIndex` |
| `*Adapter` | Contract interface wrapper | `ERC1155Adapter`, `MasterRegistryAdapter` |

### Adapter Methods

```javascript
// Read methods: get*, is*, has*, calculate*
getEditionInfo(editionId)
isOwner(address)
hasBalance(address)
calculateMintCost(editionId, quantity)

// Write methods: action verbs
mint(editionId, quantity)
transfer(to, tokenId)
approve(spender, amount)
withdraw(amount)
```

## Domain Terminology

### Consistent Terms

| Term | Definition | NOT |
|------|------------|-----|
| `Instance` | A deployed contract from a factory | "Project" (when referring to contract) |
| `Project` | User-facing concept, an instance with metadata | "Instance" (when user-facing) |
| `Edition` | ERC1155 token type with supply | "Piece", "Token" |
| `Piece` | Creative work, display name for edition | "Edition" (when displaying) |
| `Token` | ERC404 NFT or fungible unit | "NFT" (be specific) |
| `Vault` | Alignment vault contract | "Pool", "Treasury" |

### Context-Dependent Usage

```javascript
// In contracts/adapters: use "Instance"
const instanceAddress = await factory.createInstance(params);

// In UI/components: use "Project"
<h1>{project.name}</h1>

// In URLs: use human-readable slug
/31337/my-cool-project/sunset-dreams
```

## File Organization

### Component Files

```
src/components/
├── ERC1155/
│   ├── EditionCard.js           # Card for gallery grid
│   ├── EditionView.js           # Full edition page view
│   ├── EditionGallery.js        # Grid of EditionCards
│   └── MintPanel.js             # Mint interface panel
├── ERC404/
│   ├── BondingStatusPanel.js
│   ├── TierStatusPanel.js
│   └── TradingInterface.js
├── shared/
│   ├── PriceDisplay.js
│   ├── AddressBadge.js
│   └── LoadingSpinner.js
```

### CSS Files

```
# Component-specific styles in same directory
src/components/ERC1155/erc1155.css

# Shared styles in core
src/core/components.css      # Shared component styles
src/core/global.css          # Design tokens, reset
```

## Migration Strategy

When renaming existing components:

1. Create new file with correct name
2. Re-export from old file with deprecation comment
3. Update imports incrementally
4. Remove old file after all imports updated

```javascript
// Old file: EditionDetail.js
// @deprecated Use EditionView instead
export { EditionView as EditionDetail } from './EditionView.js';
```

## Checklist for New Components

- [ ] Name follows `*Suffix` pattern from hierarchy table
- [ ] File name matches component name (PascalCase)
- [ ] CSS class uses kebab-case version: `EditionCard` → `.edition-card`
- [ ] Exported name matches file name
- [ ] Placed in appropriate directory (ERC1155/, ERC404/, shared/)
