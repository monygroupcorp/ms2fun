# Mock System Reference — Gallery Brutalism Design System

**Date Created:** 2026-02-18
**Purpose:** Reference document for planning frontend overhaul to match the established mock system

---

## Overview

We have built a comprehensive mock/demo system demonstrating the "Gallery Brutalism" design language for MS2.FUN. This system consists of 23 fully-functional HTML demo pages that serve as the design reference for overhauling the production frontend.

**Location:** `/Users/lifehaver/make/ms2fun/docs/examples/`

---

## Design System Foundation

### CSS Architecture

**Core Files:**
- `src/core/global-v2.css` — Design tokens, typography, spacing, utilities
- `src/core/components-v2.css` — Component styles, navigation, buttons, forms, cards, footer

### Design Principles: Gallery Brutalism

1. **Monochrome Only** — Pure black/white, no color (except in specialized demos)
2. **Maximum Clarity** — High contrast, no decoration, no shadows
3. **Typography** — Helvetica Neue, uppercase labels, wide letter-spacing
4. **Borders** — 1px/2px solid black borders everywhere
5. **Spacing** — Strict 8px grid system
6. **No Gradients** — Flat fills only
7. **No Rounded Corners** — Sharp 0px or 2px radius max
8. **Accessible** — 44px touch targets on mobile, semantic HTML, ARIA labels

---

## Navigation System (Mobile-First)

### Desktop Navigation (>640px)
- **Top Bar:** Logo (left) + "Create" button (right)
- **Footer:** Three centered icons — Docs (book), GitHub, X.com
- Philosophy: Minimal main nav, discovery via home, portfolio via wallet button

### Mobile Navigation (≤640px)
- **Hamburger Menu:** 44×44px, 2px border, three 3px bars
- **Mobile Panel:** Overlays content (absolute position), black text on white background
  - Discover
  - Portfolio
  - Governance
  - Docs
  - Create (inverted: black bg, white text)
- **Footer:** Same as desktop

### Governance Sub-Navigation
- **Desktop:** Horizontal sub-nav with 6 links (Overview, Proposals, Apply, Member, Treasury, Shares)
- **Mobile:** Same hamburger pattern, but governance-specific links in mobile panel
- **Back Link:** "← ms2.fun" returns to homepage

---

## Page Inventory (23 Demo Pages)

### Group A: Standard Top-Bar Pages (11)
1. `portfolio-demo.html` — User portfolio with wallet info, owned items grid
2. `documentation-demo.html` — Docs landing page with sections grid
3. `loading-states-demo.html` — Loading skeleton UI patterns
4. `project-erc404-demo.html` — ERC-404 project detail page
5. `project-erc404-admin-demo.html` — ERC-404 admin controls
6. `project-erc1155-demo.html` — ERC-1155 project page
7. `project-erc1155-admin-demo.html` — ERC-1155 admin page
8. `project-erc721-demo.html` — ERC-721 project page
9. `project-erc721-drip-demo.html` — ERC-721 drip campaign page
10. `vault-explorer-demo.html` — Vault explorer/browser
11. `edition-ocean-currents-demo.html` — Edition detail page

### Group B: Custom Top-Bar Pages (3)
1. `homepage-v2-demo.html` — Homepage with featured banner + project grid
2. `project-discovery-demo.html` — Project discovery/browse with search + filters
3. `activity-feed-demo.html` — Global activity feed

### Group C: Governance Pages (9)
1. `governance-hub-demo.html` — DAO overview dashboard
2. `governance-proposals-demo.html` — Proposal list
3. `governance-proposal-detail-demo.html` — Single proposal view
4. `governance-member-demo.html` — Member profile/stats
5. `governance-treasury-demo.html` — Treasury overview
6. `governance-shares-demo.html` — Share distribution
7. `governance-apply-demo.html` — Apply landing (factory or vault)
8. `governance-apply-factory-demo.html` — Factory registration form
9. `governance-apply-vault-demo.html` — Vault registration form

### Excluded from Scope (6)
- `brutalist-demo.html` — Pure design exploration
- `chromatic-aberration-demo.html` — Visual effect demo
- `rainbow-prismatic-demo.html` — Color effect demo
- `stained-glass-demo.html` — Text effect demo
- `create-project-demo.html` — Old creation flow (deprecated)
- `create-project-v2-demo.html` — Creation flow (separate system, not yet integrated)

---

## Component Patterns Demonstrated

### Buttons
```html
<a href="#" class="btn btn-primary">Primary Action</a>
<button class="btn btn-secondary">Secondary Action</button>
<button class="btn btn-sm">Small Button</button>
```
- Heights: 40px default, 32px small, 44px on mobile (touch target)
- Borders: 2px solid black
- Hover: background change (no opacity fade)

### Cards
```html
<div class="card">
    <div class="card-header">Title</div>
    <div class="card-body">Content</div>
</div>
```
- 1px border, subtle shadow
- Padding: var(--space-4)
- Hover state on clickable cards

### Forms
```html
<input type="text" class="input" placeholder="Placeholder">
<textarea class="textarea"></textarea>
<select class="select">...</select>
```
- 48px height inputs
- 1px borders
- No rounded corners
- Focus: 2px black outline

### Tables
```html
<table class="table">
    <thead><tr><th>Header</th></tr></thead>
    <tbody><tr><td>Cell</td></tr></tbody>
</table>
```
- Full borders between cells
- Zebra striping optional
- Monospace numbers

### Stats/Metrics
```html
<div class="stat">
    <div class="stat-value">1,234</div>
    <div class="stat-label">Total Items</div>
</div>
```
- Large bold numbers
- Uppercase labels
- Used in dashboards

### Tabs
```html
<div class="tabs">
    <button class="tab tab-active">Tab 1</button>
    <button class="tab">Tab 2</button>
</div>
<div class="tab-content">...</div>
```
- Border bottom on active tab
- Uppercase text
- Clean toggle state

### Alerts
```html
<div class="alert alert-info">
    <div class="alert-title">Notice</div>
    <div class="alert-body">Message here</div>
</div>
```
- 2px border
- Monochrome (no color coding)
- Info/success/warning/error use same visual style

### Project Cards (Grid Items)
```html
<a href="#" class="project-card">
    <div class="project-card-image">P</div>
    <div class="project-card-info">
        <div class="project-card-title">Project Name</div>
        <div class="project-card-meta">ERC-404 · 1,234 items</div>
    </div>
</a>
```
- Single-letter placeholder for image
- Title + metadata row
- Hover state

### Loading States
- Skeleton screens with animated pulse
- Empty state messages
- Loading spinners (CSS-only, rotating border)

---

## Responsive Breakpoints

```css
--breakpoint-sm: 640px;  /* Mobile nav kicks in */
--breakpoint-md: 768px;  /* Tablet adjustments */
--breakpoint-lg: 1024px; /* Desktop adjustments */
--breakpoint-xl: 1280px; /* Wide desktop */
```

### Mobile Adaptations (≤640px)
- Top bar: 10px padding (vs 32px desktop)
- Font sizes scale down (h1: 48px → 24px)
- Grids: 4-col → 2-col → 1-col
- Container padding: 80px → 32px → 24px
- Touch targets: 44px minimum

---

## Dark Mode Support

All demos support dark mode via `data-theme="dark"` attribute:
```html
<html data-theme="dark">
```

**Token Overrides:**
- `--bg-primary: #000000`
- `--text-primary: #ffffff`
- Inverted borders and states
- Same brutalist aesthetic in dark

---

## Key Design Decisions

### 1. Why No Color?
Brutalism emphasizes content over decoration. Color is reserved for user-generated content (project images, vault graphics), not UI chrome.

### 2. Why Uppercase Labels?
Inspired by gallery wall labels and modernist architecture. Creates visual rhythm and clear hierarchy.

### 3. Why Visible Borders Everywhere?
Brutalism celebrates structure. Every element has clear boundaries. No floating cards or subtle shadows.

### 4. Why Mobile-First Navigation?
Modern web traffic is mobile-dominant. The hamburger menu is universally understood. Desktop gets a cleaner, minimal nav.

### 5. Why Just "Create" in Desktop Nav?
- **Discover** → accessible from homepage featured content
- **Portfolio** → accessed via wallet button (floating action)
- **Governance** → accessed via docs or direct link
- **Docs** → footer icon
- Reduces cognitive load, focuses on primary action

---

## Frontend Architecture (Production)

### Current State (To Be Overhauled)
- **Framework:** Microact (custom lightweight VDOM library)
- **Router:** Custom hash-based router (`src/routes/`)
- **Services:** Contract adapters, wallet connection (`src/services/`)
- **Components:** Mix of inline styles and `src/core/components.css` (v1)
- **Entry:** `src/index.js`

### Mock System Architecture
- **Pure HTML/CSS:** No JavaScript frameworks in demos (except toggle scripts)
- **Design Tokens:** CSS custom properties in `global-v2.css`
- **Component Classes:** Reusable utility classes in `components-v2.css`
- **Semantic HTML:** Proper `<nav>`, `<footer>`, `<button>`, `<a>` usage
- **Accessibility:** ARIA labels, focus states, keyboard navigation

---

## Production Integration Strategy (Planning Needed)

### Questions to Answer
1. **Gradual Migration vs. Big Bang?**
   - Migrate route-by-route to v2 design system?
   - Or overhaul entire app in one go?

2. **Microact Component Updates**
   - How to integrate v2 CSS with existing Microact components?
   - Refactor component render methods to use v2 class names?
   - Keep `components.css` (v1) or fully replace?

3. **Routing Changes**
   - Current: Hash routing (`#/portfolio`, `#/project/0x...`)
   - Mock demos: Static HTML files
   - Map demo pages to route components?

4. **State Management**
   - Demos are stateless HTML
   - Production needs wallet state, contract data, etc.
   - How to preserve brutalist aesthetic while loading?

5. **Dynamic Content**
   - Demos use placeholder content (letters for images, fake data)
   - Production fetches real data from contracts
   - Design loading states, empty states, error states

6. **Footer Placement**
   - Demos have footer at page bottom
   - Production has variable content height
   - Sticky footer? Absolute positioning?

7. **Governance Section**
   - Demos show complete governance UI
   - Production governance may not be fully built yet
   - Prioritize which governance pages to implement first?

8. **Navigation Consistency**
   - Desktop nav is minimal ("Create" only)
   - How to handle edge cases (deep links, breadcrumbs)?
   - Do all pages use same top-bar or different patterns?

9. **Asset Pipeline**
   - Demos inline SVG icons
   - Production needs icon system (sprite? component?)
   - Image placeholders → real IPFS images

10. **Testing Strategy**
    - Visual regression testing?
    - Responsive testing across breakpoints?
    - Browser compatibility (Safari, Firefox, Chrome)?

---

## Files Modified During Mock Development

**CSS Files:**
- `src/core/global-v2.css` — Design system tokens (NEW)
- `src/core/components-v2.css` — Component library (NEW)

**HTML Demo Files (23 total):**
- All files in `docs/examples/*-demo.html` (except excluded 6)

**Documentation:**
- `docs/DESIGN_SYSTEM_V2.md` — Design system documentation
- `docs/MIGRATION_GUIDE.md` — Notes on transitioning from v1 to v2
- `docs/MOCK_SYSTEM_REFERENCE.md` — This file

---

## Next Steps for Planning

### Recommended Planning Session Prompt

```
CONTEXT: We have built a comprehensive mock/demo system with 23 HTML pages
demonstrating the "Gallery Brutalism" design system for MS2.FUN. The mocks
are in `/Users/lifehaver/make/ms2fun/docs/examples/` and use CSS from
`src/core/global-v2.css` and `src/core/components-v2.css`.

REFERENCE: Read `/Users/lifehaver/make/ms2fun/docs/MOCK_SYSTEM_REFERENCE.md`
for full details on the mock system scope, component patterns, and design
decisions.

GOAL: Plan the overhaul of the production frontend (currently using Microact
framework in `src/routes/` and `src/services/`) to match the Gallery
Brutalism design system demonstrated in the mocks.

APPROACH:
1. Review current production architecture (Microact components, routing)
2. Identify mapping between demo pages and production routes
3. Determine migration strategy (gradual vs. big bang)
4. Design loading/empty/error states in brutalist style
5. Plan component refactoring (v1 → v2 CSS classes)
6. Address dynamic content, state management, and wallet integration
7. Create phased implementation plan with priorities
8. Identify risks, dependencies, and blockers

DELIVERABLE: A detailed implementation plan with:
- Route-by-route migration map
- Component refactoring checklist
- CSS migration strategy
- Testing approach
- Timeline/phases
- Success criteria
```

---

## Visual Reference Summary

**To See the System:**
1. Open any file in `docs/examples/` in a browser
2. Resize browser to test responsive behavior (640px breakpoint)
3. Toggle dark mode: Add `data-theme="dark"` to `<html>` tag
4. Click hamburger to test mobile menu

**Key Pages to Review:**
- `homepage-v2-demo.html` — Homepage pattern
- `project-discovery-demo.html` — Browse/search pattern
- `portfolio-demo.html` — User profile pattern
- `project-erc404-demo.html` — Project detail pattern
- `governance-hub-demo.html` — Governance dashboard pattern
- `documentation-demo.html` — Docs pattern

---

**End of Reference Document**
