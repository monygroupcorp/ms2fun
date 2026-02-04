# ERC404 Admin Modal Design

## Overview

Create an admin modal for ERC404 projects matching the pattern established by ERC1155AdminModal. The modal provides project owners with a clean interface for managing their bonding curve projects.

## Structure

**3 Tabs: Overview / Configuration / Advanced**

- **Modal approach** - Triggered by AdminButton, keeps project page clean
- **Progressive disclosure** in Configuration - uncompleted items prominent, completed items dimmed
- **Status-heavy Overview** - Bonding lifecycle is the focus during Phase 1

## Tab Details

### Overview Tab

Displays current project status with actionable items for ongoing management.

**Sections:**

1. **Bonding Status** (prominent)
   - Phase badge: Pre-open / Bonding / Full / Matured / Deployed
   - Progress bar showing supply filled percentage
   - Reserve amount (ETH collected)
   - Supply stats (current / max bonding supply)
   - Timeline: Open time, Maturity time

2. **Staking Status**
   - Enabled/Disabled badge
   - If enabled: Total staked, "Fees distributed to stakers" message
   - If disabled: Claimable vault fees (if any)

3. **Featured Position**
   - Same implementation as ERC1155AdminModal
   - Rent/Renew/Bump controls
   - Auto-renewal deposit management

### Configuration Tab

Progressive disclosure pattern for setup and customization.

**Visual States:**
- **Needs Action** - Expanded with form fields and CTAs
- **Completed/Locked** - Single line with checkmark, dimmed
- **Always Editable** - Normal form field

**Setup Items:**

| Item | Needs Setup When | Locked When |
|------|------------------|-------------|
| V4 Hook | `address(0)` | Once set (immutable) |
| Vault | `address(0)` | Once set (immutable) |
| Bonding Open Time | `0` | Once bonding active |
| Bonding Maturity Time | `0` | Once set |
| Bonding Active | `false` | After liquidity deployed |
| Enable Staking | `false` | Once enabled (irreversible) |

**Always Editable:**
- Style URI - Can change anytime, even post-liquidity

**Post-Liquidity Behavior:**
Most items become read-only. Only Style URI remains editable.

### Advanced Tab

Dangerous operations with confirmation requirements. Matches ERC1155 pattern exactly.

**Sections:**

1. **Transfer Ownership**
   - New owner address input
   - Single confirmation checkbox
   - Disabled until valid address + checkbox

2. **Renounce Ownership**
   - Warning list of consequences
   - Two confirmation checkboxes required
   - "Renounce Ownership Forever" button

## Implementation

### File Structure

```
src/components/AdminDashboard/
├── ERC1155AdminModal.js  (existing)
├── erc1155-admin.css     (existing)
├── ERC404AdminModal.js   (new)
└── erc404-admin.css      (new)
```

### State Shape

```javascript
state = {
  isOpen: false,
  activeTab: 'overview',
  loading: true,

  // Bonding status
  bondingPhase: 'pre-open', // 'pre-open' | 'bonding' | 'full' | 'matured' | 'deployed'
  bondingProgress: 0,
  reserve: '0',
  totalBondingSupply: '0',
  maxBondingSupply: '0',
  bondingOpenTime: 0,
  bondingMaturityTime: 0,
  bondingActive: false,
  liquidityDeployed: false,

  // Staking
  stakingEnabled: false,
  totalStaked: '0',

  // Setup status (for progressive disclosure)
  hookAddress: null,
  vaultAddress: null,
  styleUri: '',

  // Featured rental (same as ERC1155)
  isFeatured: false,
  featuredPosition: 0,
  featuredExpiry: 0,
  rentalPrice: '0',
  renewalDeposit: '0',
  queueLength: 0,
  queueMaxSize: 100,

  // Form states
  showSetupSection: true,

  // Advanced tab checkboxes
  transferConfirmed: false,
  renounceConfirmed1: false,
  renounceConfirmed2: false,

  // Transaction states
  txPending: false,
  txError: null,
  txSuccess: null
}
```

### Adapter Methods

**Read Operations:**
- `getBondingStatus()` - isConfigured, isActive, isEnded, openTime, currentSupply, maxBondingSupply, availableSupply, currentReserve
- `getSupplyInfo()` - maxSupply, liquidityReserve, maxBondingSupply, currentBondingSupply, availableBondingSupply
- `getStakingStats()` - enabled, globalTotalStaked, totalFeesFromVault, contractBalance
- `v4Hook()` - hook address
- `vault()` - vault address
- `getStyle()` - style URI
- `liquidityPool()` - check if deployed

**Write Operations:**
- `setBondingOpenTime(timestamp)`
- `setBondingMaturityTime(timestamp)`
- `setBondingActive(bool)`
- `setV4Hook(address)` - one-time
- `setVault(address)` - one-time
- `enableStaking()` - irreversible
- `setStyle(uri)`
- `transferOwnership(address)`
- `renounceOwnership()`

### Phase Detection Logic

```javascript
function getBondingPhase(status) {
  if (status.liquidityPool !== '0x0...') return 'deployed';
  if (status.totalBondingSupply >= status.maxBondingSupply) return 'full';
  if (status.bondingMaturityTime && Date.now()/1000 >= status.bondingMaturityTime) return 'matured';
  if (status.bondingActive && status.bondingOpenTime && Date.now()/1000 >= status.bondingOpenTime) return 'bonding';
  return 'pre-open';
}
```

### Progressive Disclosure Logic

```javascript
function getSetupItems(state) {
  const items = [];

  // Needs setup
  if (!state.hookAddress) {
    items.push({ id: 'hook', status: 'needs-setup', label: 'V4 Hook' });
  }
  if (!state.vaultAddress) {
    items.push({ id: 'vault', status: 'needs-setup', label: 'Vault' });
  }
  if (!state.bondingOpenTime) {
    items.push({ id: 'openTime', status: 'needs-setup', label: 'Bonding Open Time' });
  }
  if (!state.stakingEnabled && !state.liquidityDeployed) {
    items.push({ id: 'staking', status: 'needs-setup', label: 'Enable Staking' });
  }

  // Completed
  if (state.hookAddress) {
    items.push({ id: 'hook', status: 'completed', label: 'V4 Hook', value: state.hookAddress });
  }
  // ... etc

  return items;
}
```

### Shared Code with ERC1155

The following can be extracted or copied from ERC1155AdminModal:
- Featured rental section (renderFeaturedSection, all featured handlers)
- Advanced tab (renderAdvancedTab, ownership handlers)
- Message display (renderMessages)
- Form value storage pattern (_formValues outside state)
- Event delegation setup (setupEventDelegation)
- Escape key handler
- formatEth, formatTimeRemaining helpers

## CSS Approach

Create `erc404-admin.css` based on `erc1155-admin.css` with additions for:
- Phase badge colors (pre-open: gray, bonding: gold, full: green, matured: purple, deployed: blue)
- Progress bar styling
- Progressive disclosure states (.needs-setup, .completed, .always-editable)
- Setup item expand/collapse animations

## Integration

1. Import ERC404AdminModal in AdminButton.js
2. Detect contract type and instantiate appropriate modal
3. Pass adapter and project data to modal constructor

## Testing Checklist

- [ ] Modal opens/closes correctly
- [ ] Tab switching works
- [ ] Bonding phase displays correctly for each state
- [ ] Progressive disclosure shows correct items
- [ ] All setup actions work (hook, vault, times, staking, style)
- [ ] Featured rental works (rent, renew, bump, deposit, withdraw)
- [ ] Transfer ownership works with confirmation
- [ ] Renounce ownership works with double confirmation
- [ ] Transaction pending/success/error states display
- [ ] Post-liquidity state locks appropriate fields
