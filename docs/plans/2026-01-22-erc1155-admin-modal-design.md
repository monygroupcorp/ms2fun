# ERC1155 Admin Modal & Project Page Design

**Date:** 2026-01-22
**Status:** Approved Design
**Purpose:** Overhaul ERC1155 admin experience with single modal entry point, remove CreatorDashboard, apply design system consistently

---

## Overview

### Goals
1. **Single admin entry point** - AdminButton opens modal, remove inline CreatorDashboard
2. **Tab-based organization** - Overview, Editions, Advanced
3. **Full adapter coverage** - Expose all ERC1155Instance owner functions
4. **Design system compliance** - Gold/silver metallic only (no bronze), proper tokens throughout

### Files to Create/Modify
- `src/components/AdminDashboard/ERC1155AdminModal.js` (NEW)
- `src/components/AdminDashboard/erc1155-admin.css` (NEW)
- `src/components/ERC1155/erc1155.css` (MODIFY - remove bronze, fix tokens)
- `src/services/contracts/ERC1155Adapter.js` (MODIFY - add Ownable methods)
- `src/components/ERC1155/CreatorDashboard.js` (DELETE)
- `src/components/ProjectDetail/ContractTypeRouter.js` (MODIFY - remove CreatorDashboard)

---

## Part 1: Admin Modal Design

### 1.1 Modal Structure

**Container:**
- Full-screen overlay with `--modal-backdrop`
- Modal: max-width `800px`, max-height `85vh`
- Background: `--bg-elevated`
- Border-radius: `--radius-xl`
- Shadow: `--elevation-5`

**Header:**
- Height: 64px fixed
- Background: `--gradient-metallic-raised` (gold)
- Border-bottom: 2px solid `--gold-metallic-dark`
- Title: "Admin Dashboard" in `--font-engraved`, `--font-size-h4`
- Close button: Silver metallic X icon
- Project name subtitle in `--text-secondary`

**Tab Navigation:**
- Sticky below header
- Background: `--bg-secondary`
- Three tabs: **Overview** | **Editions** | **Advanced**
- Active tab: Gold metallic background
- Inactive tabs: Silver, hover brightens

**Content Area:**
- Scrollable
- Padding: `--spacing-6`
- Background: `--bg-primary`

---

### 1.2 Overview Tab (Earnings + Promotion)

#### Stats Cards Row

**If contract balance > 0:**
Three cards in a row:

| Card | Label | Source |
|------|-------|--------|
| Total Proceeds | "Lifetime Earnings" | `getTotalProceeds()` |
| Contract Balance | "Available Balance" | `address(this).balance` |
| Withdrawable | "Your Share (80%)" | balance × 0.8 |

Card styling:
- Background: `--bg-elevated`
- Shadow: `--elevation-2`
- Border-left: 4px solid `--gold-metallic-base`
- Padding: `--spacing-4`

**If contract balance === 0 (empty state):**
- Full-width card with empty state message
- Headline: "No earnings yet"
- Subtext: "Create editions and start collecting mints"
- **Create Your First Edition** button (gold) → switches to Editions tab

**If has proceeds but balance is 0:**
- Show historical Total Proceeds (grayed)
- "All caught up!" message
- **Add New Edition** button (silver)

#### Withdraw Section
- Section header: "Withdraw Earnings"
- Amount input with gold focus ring
- **MAX** button (silver) - fills withdrawable amount
- **Withdraw** button (gold) - disabled if balance is 0
- Helper text: "20% tithe automatically sent to vault"

#### Vault Fees Section
- Section header: "Vault Fee Share"
- Claimable amount display
- **Claim Vault Fees** button (silver)

#### Featured Rental Section
- Section header: "Featured Position"

**If not featured:**
- Explanation text
- Rental price from `getPositionRentalPrice()`
- Duration selector (1/3/7 days)
- **Rent Featured Slot** button (gold)

**If currently featured:**
- "FEATURED" gold badge
- Time remaining display
- **Renew** (silver) and **Bump Position** (gold) buttons
- Auto-renewal deposit management

---

### 1.3 Editions Tab

#### Add New Edition Section

**Collapsed state (default when editions exist):**
- Silver metallic bar: "+ Add New Edition"
- Click to expand

**Expanded form:**
- Card with `--elevation-2`, gold left border

| Field | Type | Notes |
|-------|------|-------|
| Piece Title | Text | Required |
| Metadata URI | Text | IPFS/Arweave/HTTPS |
| Base Price | Number + ETH | Required |
| Supply | Number | 0 = unlimited |
| Pricing Model | Select | UNLIMITED/LIMITED_FIXED/LIMITED_DYNAMIC |
| Price Increase Rate | Number + % | Only for LIMITED_DYNAMIC |

- **Create Edition** button (gold)
- **Cancel** link (silver text)

#### Existing Editions List

Section header: "Your Editions (X)"

**Edition row:**
```
┌─────────────────────────────────────────────────────┐
│ [Thumb]  Edition #1: "Golden Hour"                  │
│  48×48   Price: 0.05 ETH (Fixed)                   │
│          Minted: 24/100 (24%)        [Manage ▼]    │
│          ████████░░░░░░ progress bar               │
└─────────────────────────────────────────────────────┘
```

**Manage dropdown (silver):**
- Update Metadata → modal with URI input
- Set Edition Style → modal with style URI input
- View on Page → link to edition detail

#### Project Style Section
- Current style URI display
- Style URI input
- **Update Project Style** button (silver)

---

### 1.4 Advanced Tab (Danger Zone)

#### Warning Banner
- Background: `--error-50`
- Border: 2px solid `--error-500`
- Text: "These actions are irreversible. Proceed with extreme caution."

#### Transfer Ownership Section
- Card with border: 1px solid `--error-200`
- Description explaining consequences
- New owner address input
- Checkbox: "I understand this action is irreversible"
- **Transfer Ownership** button (silver with red text)
- Confirmation modal requiring "TRANSFER" typed

#### Renounce Ownership Section
- Card with border: 2px solid `--error-500` (stronger warning)
- Bullet list of consequences:
  - No future editions can be added
  - No metadata can be updated
  - No styles can be changed
  - Remaining balance can still be withdrawn
- Two checkboxes required
- **Renounce Ownership Forever** button (silver with dark red text)
- Confirmation modal requiring "RENOUNCE FOREVER" typed

---

## Part 2: Button Hierarchy (Gold/Silver Only)

**Remove all bronze from the design system.**

| Action Type | Metallic Finish | Examples |
|-------------|-----------------|----------|
| **Primary CTA** | Gold | Create Edition, Withdraw, Rent Featured, Bump Position |
| **Secondary** | Silver | Cancel, MAX, Manage, Claim Vault Fees, Retry, Back |
| **Danger** | Silver + red text | Transfer Ownership, Renounce Ownership |

---

## Part 3: Adapter Gap - Ownable Methods

**ERC1155Adapter needs these methods added:**

```javascript
/**
 * Transfer ownership to new address (from Solady Ownable)
 */
async transferOwnership(newOwner) {
    return this.executeContractCall('transferOwnership', [newOwner], { requiresSigner: true });
}

/**
 * Renounce ownership permanently (from Solady Ownable)
 */
async renounceOwnership() {
    return this.executeContractCall('renounceOwnership', [], { requiresSigner: true });
}
```

---

## Part 4: Project Page Design System Fixes

### Remove Bronze from erc1155.css

**Find and replace:**

| Old | New |
|-----|-----|
| `--gradient-bronze-raised` | `--gradient-metallic-raised` (gold) or `--gradient-silver-raised` |
| `--bronze-metallic-dark` | `--gold-metallic-dark` or `--silver-metallic-dark` |
| `--bronze-metallic-base` | `--gold-metallic-base` or `--silver-metallic-base` |
| `--shadow-bronze-raised` | `--shadow-metallic-raised` or `--shadow-silver-raised` |

**Specific mappings:**
- `.retry-button` → silver
- `.create-button` → gold
- `.tab-btn.active` → silver
- `.action-btn` → gold
- `.cancel-button` → silver (already correct)

### Fix Hardcoded Colors

| Old | New |
|-----|-----|
| `#764ba2` | `--gold-metallic-base` (for accents/focus) |
| `#666` | `--text-secondary` or `--text-tertiary` |
| `#333` | `--text-primary` |
| `#f5f5f5`, `#f8f9fa` | `--bg-secondary` |
| `#eee`, `#e0e0e0` | `--border-base` |
| `#fee` (error bg) | `--error-50` |
| `#c33` (error text) | `--error-600` |
| `#efe` (success bg) | `--success-50` |

### Fix Loading Spinner

```css
/* OLD */
.loading-spinner { border-top: 4px solid #764ba2; }

/* NEW */
.loading-spinner { border-top: 4px solid var(--gold-metallic-base); }
```

### Fix Focus States

```css
/* OLD */
input:focus {
    border-color: #764ba2;
    box-shadow: 0 0 0 3px rgba(118, 75, 162, 0.1);
}

/* NEW */
input:focus {
    border-color: var(--gold-metallic-base);
    box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.15);
}
```

### Fix Price Highlight

```css
/* OLD */
.stat-card .stat-value.price { color: #764ba2; }

/* NEW */
.stat-card .stat-value.price { color: var(--gold-metallic-base); }
```

### Use Elevation System

```css
/* OLD */
.edition-card { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
.edition-card:hover { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); }

/* NEW */
.edition-card { box-shadow: var(--elevation-2); }
.edition-card:hover { box-shadow: var(--elevation-3); }
```

### Use Spacing Tokens

```css
/* OLD */
.edition-gallery { padding: 20px 0; }
.gallery-grid { gap: 30px; }
.edition-info { padding: 20px; }

/* NEW */
.edition-gallery { padding: var(--spacing-5) 0; }
.gallery-grid { gap: var(--spacing-6); }
.edition-info { padding: var(--spacing-5); }
```

### Use Border-Radius Tokens

```css
/* OLD */
.edition-card { border-radius: 8px; }
.edition-image-wrapper { border-radius: 12px; }

/* NEW */
.edition-card { border-radius: var(--radius-md); }
.edition-image-wrapper { border-radius: var(--radius-lg); }
```

---

## Part 5: Stat Card Refinement (Engraved Plaque Style)

```css
.stat-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-sm);
    padding: var(--spacing-4);
    border-left: 3px solid var(--gold-metallic-base);
    box-shadow: var(--elevation-1);
}

.stat-card .stat-label {
    font-size: var(--font-size-label);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--letter-spacing-wide);
    font-family: var(--font-body);
}

.stat-card .stat-value {
    font-family: var(--font-engraved);
    font-size: var(--font-size-h4);
    color: var(--text-primary);
    font-weight: var(--font-weight-bold);
}

.stat-card .stat-value.price {
    color: var(--gold-metallic-base);
}
```

---

## Part 6: Edition Card Refinement

```css
.edition-card {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--elevation-2);
    border: 1px solid var(--border-light);
    transition: var(--transition-base);
}

.edition-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--elevation-3);
    border-color: var(--gold-metallic-light);
}

.edition-name {
    font-family: var(--font-heading);
    font-size: var(--font-size-h5);
    color: var(--text-primary);
    font-weight: var(--font-weight-semibold);
    margin: 0 0 var(--spacing-2) 0;
}

.edition-description {
    color: var(--text-secondary);
    font-size: var(--font-size-body-sm);
    line-height: var(--line-height-normal);
}
```

---

## Implementation Checklist

### Phase 1: Admin Modal
- [ ] Create `ERC1155AdminModal.js` component
- [ ] Create `erc1155-admin.css` styles
- [ ] Implement Overview tab with stats, withdraw, vault fees, featured
- [ ] Implement Editions tab with add form and edition list
- [ ] Implement Advanced tab with transfer/renounce
- [ ] Add `transferOwnership()` and `renounceOwnership()` to ERC1155Adapter
- [ ] Wire AdminButton to open new modal for ERC1155 contracts

### Phase 2: Cleanup
- [ ] Remove `CreatorDashboard.js` component
- [ ] Update `ContractTypeRouter.js` to not render CreatorDashboard
- [ ] Remove CreatorDashboard-related CSS

### Phase 3: Design System Fixes
- [ ] Remove all bronze references from `erc1155.css`
- [ ] Replace hardcoded colors with design tokens
- [ ] Replace hardcoded shadows with elevation tokens
- [ ] Replace hardcoded spacing with spacing tokens
- [ ] Replace hardcoded border-radius with radius tokens
- [ ] Update loading spinner to gold
- [ ] Update focus states to gold
- [ ] Update price highlight to gold

### Phase 4: Design System Global
- [ ] Remove bronze from `DESIGN_SYSTEM.md` (or mark as deprecated)
- [ ] Audit other CSS files for bronze usage
- [ ] Update `global.css` if bronze variables should be removed

---

## Contract Method Coverage

### Overview Tab
| Method | Adapter | Source |
|--------|---------|--------|
| `getTotalProceeds()` | ERC1155Adapter | Contract |
| `address.balance` | Direct | Contract |
| `withdraw(amount)` | ERC1155Adapter | Contract |
| `claimVaultFees()` | ERC1155Adapter | Contract |
| `getRentalInfo()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `getPositionRentalPrice()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `rentFeaturedPosition()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `renewPosition()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `bumpPosition()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `depositForAutoRenewal()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |
| `withdrawRenewalDeposit()` | FeaturedQueueManagerAdapter | FeaturedQueueManager |

### Editions Tab
| Method | Adapter | Source |
|--------|---------|--------|
| `addEdition()` | ERC1155Adapter | Contract |
| `updateEditionMetadata()` | ERC1155Adapter | Contract |
| `setStyle()` | ERC1155Adapter | Contract |
| `setEditionStyle()` | ERC1155Adapter | Contract |
| `getStyle()` | ERC1155Adapter | Contract |
| `getEditionCount()` | ERC1155Adapter | Contract |
| `getEditionInfo()` | ERC1155Adapter | Contract |
| `getMintStats()` | ERC1155Adapter | Contract |

### Advanced Tab
| Method | Adapter | Source |
|--------|---------|--------|
| `transferOwnership()` | ERC1155Adapter | Ownable (needs adding) |
| `renounceOwnership()` | ERC1155Adapter | Ownable (needs adding) |

---

*Design approved: 2026-01-22*
