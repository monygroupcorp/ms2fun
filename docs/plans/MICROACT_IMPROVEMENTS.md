# Microact & Micro-web3 Improvements

> **Living Document** - Add requirements here as we encounter friction in the ms2fun app.
> This feeds directly into library improvements for microact (component system) and micro-web3 (web3 utilities).

---

## How to Use This Document

When you encounter friction with the component system or web3 utilities:

1. **Apply a workaround** in ms2fun to keep moving
2. **Log the issue** in the appropriate section below
3. **Note the workaround** so it can be removed after library upgrade
4. **Define acceptance criteria** for the fix

---

## Microact: Component System

### Virtual DOM / Diffing

#### Requirement: Preserve Mounted Children on Parent Re-render

**Problem encountered:** `EditionDetail` mounts `EditionMintInterface` as a child. When `userBalance` state updates, the parent re-renders via `innerHTML` replacement and destroys the child's DOM.

**Workaround applied:** Override `shouldUpdate()` to skip re-render for non-structural state changes, update DOM directly for minor changes.

**Desired behavior:**
```javascript
// Parent re-renders, child DOM is preserved
class Parent extends Component {
    render() {
        return `
            <div class="parent">
                <h1>${this.state.title}</h1>
                <div data-child="mint-panel"></div>
            </div>
        `;
    }
}
// When title changes, h1 updates but mint-panel's contents are untouched
```

**Acceptance criteria:**
- [ ] Child component DOM nodes survive parent re-render
- [ ] Child component state is preserved
- [ ] Child event listeners remain attached
- [ ] Works for arbitrarily nested children

---

#### Requirement: Efficient DOM Diffing

**Problem:** Full `innerHTML` replacement is expensive and causes visual flicker, focus loss, and scroll position reset.

**Desired behavior:**
- Compare old vs new render output
- Only mutate DOM nodes that actually changed
- Preserve focus, scroll position, CSS transitions

**Acceptance criteria:**
- [ ] Text content changes update only the text node
- [ ] Attribute changes update only the attribute
- [ ] Input focus is preserved across updates
- [ ] Scroll position is preserved

---

#### Requirement: Keyed Lists

**Problem:** When rendering lists, items need identity for correct diffing.

**Desired behavior:**
```javascript
render() {
    return `
        <ul>
            ${this.state.items.map(item => `
                <li data-key="${item.id}">${item.name}</li>
            `).join('')}
        </ul>
    `;
}
```

**Acceptance criteria:**
- [ ] Items with same key are considered same node
- [ ] Reordering moves nodes instead of recreating
- [ ] Adding/removing updates correct positions

---

### Component Lifecycle

#### Requirement: Declarative Child Components

**Problem:** Current pattern mounts children imperatively in `setupChildComponents()`, which is error-prone and timing-dependent.

**Desired behavior:**
```javascript
static children = {
    mintPanel: MintPanel
};

render() {
    return `<Child name="mintPanel" edition={this.state.edition} />`;
}
```

**Acceptance criteria:**
- [ ] Children declared statically or in render
- [ ] Props passed to children
- [ ] Children mount/update/unmount automatically

---

#### Requirement: Additional Lifecycle Hooks

**Desired hooks:**
```javascript
willMount() {}      // Before first render
didMount() {}       // After first render
willUpdate() {}     // Before re-render
didUpdate() {}      // After re-render
willUnmount() {}    // Before removal
```

---

### Developer Experience

#### Requirement: Better Error Messages

**Problem:** (Add when encountered)

---

#### Requirement: DevTools Integration

**Problem:** (Add when encountered)

---

## Micro-web3: Web3 Utilities

### Contract Adapters

#### Requirement: (Template)

**Problem encountered:**

**Workaround applied:**

**Desired behavior:**

**Acceptance criteria:**
- [ ]

---

### Wallet Integration

#### Requirement: (Template)

**Problem encountered:**

**Workaround applied:**

**Desired behavior:**

**Acceptance criteria:**
- [ ]

---

### Transaction Handling

#### Requirement: (Template)

**Problem encountered:**

**Workaround applied:**

**Desired behavior:**

**Acceptance criteria:**
- [ ]

---

### Event Listening

#### Requirement: (Template)

**Problem encountered:**

**Workaround applied:**

**Desired behavior:**

**Acceptance criteria:**
- [ ]

---

## Issues Log

| Date | Category | Issue Summary | Component/File | Workaround | Requirement |
|------|----------|---------------|----------------|------------|-------------|
| 2026-01-21 | microact | Child destroyed on parent re-render | EditionDetail | `shouldUpdate()` override | Preserve Children |
| 2026-01-22 | microact | Visual flash on tab/dropdown state changes | ERC1155AdminModal | CSS fade animation on content | Efficient DOM Diffing |
| | | | | | |

---

## Components to Refactor Post-Migration

When migrating to an improved component library with proper virtual DOM/diffing, these components have significant workarounds that should be cleaned up:

### ERC1155AdminModal (`src/components/AdminDashboard/ERC1155AdminModal.js`)

**Current workarounds:**
- `shouldUpdate()` override to prevent re-renders on form input
- `_formValues` object storing form state outside component state (to avoid re-render on keystroke)
- CSS fade animations to mask innerHTML replacement flash
- Event delegation pattern instead of per-element binding

**Post-migration cleanup:**
- [ ] Remove `shouldUpdate()` - rely on proper diffing
- [ ] Move `_formValues` back into `this.state` - inputs won't lose focus with diffing
- [ ] Remove CSS animations on `.erc1155-admin-content` - no more flash to hide
- [ ] Consider splitting into `OverviewTab`, `EditionsTab`, `AdvancedTab` sub-components
- [ ] Use standard event binding instead of delegation

---

## Design Principles

### For Microact
- **No build step required** - Plain ES modules and template literals
- **Small footprint** - Target ~500 lines max
- **Incremental adoption** - Existing components work unchanged
- **Sync rendering** - No fiber/concurrent complexity

### For Micro-web3
- **Provider agnostic** - Work with ethers, viem, or raw providers
- **Offline-first** - Graceful degradation without wallet
- **Type-safe** - Full TypeScript support
- **Cache-aware** - Smart invalidation on chain state changes

---

## Migration Checklist

When libraries are upgraded:

### Microact
- [ ] Update microact dependency
- [ ] Replace Component import
- [ ] Test components with children
- [ ] Remove `shouldUpdate()` workarounds
- [ ] Remove manual `setupChildComponents()` patterns
- [ ] Convert to declarative child syntax

### Micro-web3
- [ ] Update micro-web3 dependency
- [ ] Test contract adapters
- [ ] Test wallet connection flows
- [ ] Remove workarounds noted above
