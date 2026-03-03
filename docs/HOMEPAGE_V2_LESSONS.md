# HomePage V2 Lessons Learned - Microact + Gallery Brutalism

**Date:** 2026-02-18
**Context:** Rebuilt HomePage from scratch using Microact framework + Gallery Brutalism design system

---

## Critical Discoveries

### 1. Microact Children Pattern (BLOCKING BUG)

**Problem:** Layout component received `children: undefined` - content wasn't rendering.

**Root Cause:** Microact's `h()` function creates vnodes with structure `{ type, props, children, key }` where **children are separate from props**, unlike React's `props.children`.

**Wrong:**
```javascript
// Children as h() argument - DOESN'T WORK
return h(Layout, { currentPath: '/' },
    h('div', { className: 'home-page' }, ...)
);
```

**Correct:**
```javascript
// Children as explicit prop - WORKS
return h(Layout, {
    currentPath: '/',
    children: h('div', { className: 'home-page' }, ...)
});
```

**Impact:** This is a FUNDAMENTAL pattern difference from React. Any parent component accepting children must receive them as an explicit prop.

**Action Item:** Document this in Microact library and add to MICROACT_IMPROVEMENTS.md.

---

### 2. Nested Component Anti-Pattern (LAYOUT BUG)

**Problem:** Double-nested `<div class="home-top-bar">` causing broken layout/spacing.

**Root Cause:** Layout.js wrapped TopBar in a `home-top-bar` div, but TopBar.js ALSO created a `home-top-bar` div.

**Wrong Structure:**
```html
<!-- From Layout.js -->
<div class="home-top-bar">
    <!-- From TopBar.js -->
    <div class="home-top-bar">
        <!-- actual content -->
    </div>
</div>
```

**Solution:** TopBar component should render its own container. Layout should NOT wrap it.

**Correct:**
```javascript
// Layout.js
return h('div', { className: 'app-layout' },
    h(TopBar, { ...props }),  // TopBar creates its own home-top-bar
    h('main', { className: 'app-main' }, children),
    h(Footer)
);
```

**Lesson:** Components should own their container elements. Parent components should render children directly, not wrap them in extra divs unless explicitly needed for layout purposes.

---

### 3. Demo-Driven Development Works

**Problem:** Built components from memory/assumptions → didn't match design.

**What Happened:**
- Added desktop nav links (Discover, Activity, Portfolio, Governance) that weren't in design
- Wrong logo styling (missing uppercase, letter-spacing)
- Wrong padding values
- Missing "View All Projects" button

**Solution:** Created **Rule #4 in CLAUDE.md: Demo-Driven Development**

**Workflow:**
1. Open `docs/examples/[page]-demo.html` in browser
2. Copy exact HTML structure
3. Check inline styles in demo `<style>` tag
4. Convert to Microact h() syntax line-by-line
5. Verify side-by-side with demo

**Result:** After following this workflow strictly, components matched demo perfectly.

**Lesson:** Design specs in code (HTML demos) > design specs in memory. Always reference the source of truth.

---

### 4. CSS Cascade Conflicts (SCORCHED EARTH)

**Problem:** Old Temple of Capital CSS files overriding new Gallery Brutalism v2 styles.

**Attempted Fixes:**
- Adding `!important` → didn't work
- Removing marble-bg classes in JS → didn't work
- Higher specificity → didn't work

**Solution:** Complete removal of old CSS files from `index.html`:
- Removed: `global.css`, `theme.css`, `marble.css`, `components.css`, `style.css`
- Removed: All route-specific CSS files
- Kept ONLY: `global-v2.css` and `components-v2.css`

**Lesson:** When migrating design systems, CSS cascade conflicts are inevitable. Half-measures don't work. Scorched earth approach (remove ALL old styles) is cleaner than trying to override.

---

### 5. SVG Rendering in Microact (RESOLVED in 0.2.4)

**Problem:** Footer icons weren't rendering using nested `h('svg', ...)` syntax.

**Root Cause Chain (3 separate issues, fixed across 2 releases):**
1. **0.2.2**: `document.createElement('svg')` — no SVG namespace. SVG elements must use `document.createElementNS('http://www.w3.org/2000/svg', tagName)`
2. **0.2.3**: Fixed `createElementNS` but lowercased all attribute names. `viewBox` → `viewbox` which SVG doesn't recognize (SVG attributes are case-sensitive)
3. **0.2.4**: Preserved attribute casing for SVG elements. Everything works.

**Failed workarounds (before library fix):**
- `innerHTML` attribute in h() props — microact doesn't pass innerHTML to DOM
- `didMount()` + `document.querySelectorAll` + innerHTML injection — parent re-renders wipe injected content
- `shouldUpdate() { return false }` to prevent wipes — still didn't work
- Static HTML footer in index.html — worked but ugly, removed after 0.2.4

**Working solution (0.2.4+):**
```javascript
h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24' },
    h('path', { d: 'M12 2C6.477...' })
)
// → SVG renders correctly with proper namespace and attribute casing
```

**Lesson:** When hitting framework limitations, document the issue precisely (root cause + acceptance criteria), ship it to the library team, and iterate on releases. We went through 3 releases in one session. The spec we wrote in MICROACT_IMPROVEMENTS.md made each fix targeted.

**Meta-lesson:** Filing good bug reports with reproduction steps, failed approaches, and implementation hints accelerates library fixes dramatically.

---

### 6. Flexbox Sticky Footer Pattern

**Problem:** Footer had extra scrollable space below it - body extended past footer.

**Root Cause:** Multiple issues:
- `.home-page` had `min-height: 100vh` conflicting with layout
- No height chain from `html → body → container`
- No flexbox on app-layout

**Solution:** Complete height chain + flexbox:
```css
html { height: 100%; }
body { height: 100% !important; }
#app-container { height: 100%; }
.app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    height: 100%;
}
.app-main { flex: 1; }  /* Pushes footer down */
```

**Lesson:** Sticky footer requires complete height chain from root + flexbox container. ANY break in the chain causes issues.

---

### 7. Container Overflow with CSS Grid

**Problem:** Projects grid spilling outside container bounds.

**Root Cause:** Grid items don't automatically constrain to parent width without explicit `width: 100%` and `box-sizing: border-box`.

**Solution:** Add constraints to entire chain:
```css
.home-content { width: 100%; box-sizing: border-box; }
.projects-section { width: 100%; box-sizing: border-box; }
.projects-grid { width: 100%; box-sizing: border-box; }
.project-card { width: 100%; box-sizing: border-box; overflow: hidden; }
```

**Lesson:** Grid layouts need explicit width constraints on parent AND children to prevent overflow. Don't assume grid will auto-constrain.

---

### 8. Status Indicator Pattern (Wallet Button)

**Challenge:** Create brutalist wallet button with visual connection status.

**Requirements:**
- 3 states: Disconnected, Connected (collapsed), Connected (expanded)
- Status indicator: Red dot (disconnected), Cyan dot (connected)
- Different from other buttons
- Dropdown with balance, portfolio link, disconnect

**Solution:**
```javascript
// Component structure
h('div', { className: 'brutalist-wallet-container' },
    h('button', { className: `brutalist-wallet-button ${statusClass}` },
        h('span', { className: 'wallet-status-indicator' }),  // 8px dot
        h('span', { className: 'wallet-text' }, text)
    ),
    expanded ? h('div', { className: 'wallet-dropdown' }, ...) : null
)
```

**Design Choices:**
- Square/rectangular (not circular like other buttons)
- Inverted colors: white bg, black border (vs black bg buttons)
- Monospace font for tech aesthetic
- Status dot: simple 8px circle with background color
- Dropdown appears ABOVE button (not below)

**Lesson:** Status indicators don't need complex UI. Simple colored dot + brutalist styling is clear and effective.

---

### 9. Production Loading Flow (Progressive + Fallback)

**Problem:** Homepage needed to work across 4 environments with real blockchain data when available.

**Solution:** Three-phase progressive loading:
1. **Phase 1: Provider detection** (~42ms) — ProviderManager checks wallet, switches network if wrong chain, falls back to public RPC
2. **Phase 2: Critical data** (~50ms) — FeaturedQueueManager query + project list. Skeleton UI during load.
3. **Phase 3: Activity** (~369ms) — Lazy-loaded after critical data renders. ActivityIndexer scans recent events.

**Key patterns:**
```javascript
// Skeletons are functions, not classes — call directly
loadingFeatured ? FeaturedBannerSkeleton() : h('div', ...)

// Check queue length before querying to avoid "index out of bounds"
const queueLen = await queueAdapter.queueLength();
if (queueLen > 0) {
    const { instances } = await queueAdapter.getFeaturedInstances(0, 1);
}

// Always have a hardcoded fallback for featured
if (!featured) featured = CULT_EXECS_FEATURED;
```

**Lesson:** Progressive loading with skeletons feels faster than waiting for everything. Query cheap data first (queue length), expensive data conditionally.

---

### 10. Network Switching (Wallet UX)

**Problem:** Wallet on wrong network → ProviderManager silently fell back to read-only public RPC. User had no idea.

**Solution:** Attempt `wallet_switchEthereumChain` before falling back:
```javascript
await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainIdHex }]
});
```
- If chain unknown (error 4902): `wallet_addEthereumChain` for local networks
- If user rejects (error 4001): Fall back to public RPC gracefully
- Different wallets behave differently — some prompt, some switch silently

**Lesson:** Always try to bring the wallet to the right network before falling back. Silent fallbacks confuse users.

---

### 11. Debug Timing System

**Problem:** Needed performance visibility during development but clean console in production.

**Solution:** Central debug utility with single toggle:
```javascript
// src/utils/debug.js
const DEBUG_MODE = false;
export const debug = {
    log: (...args) => { if (DEBUG_MODE) console.log(...args); },
    warn: (...args) => { if (DEBUG_MODE) console.warn(...args); },
    error: (...args) => { console.error(...args); }, // Always show errors
};
```

**Lesson:** One flag, one file, errors always visible. Add `performance.now()` timing around each loading phase for easy profiling.

---

### 12. Footer: Mobile Hidden, Desktop Static

**Problem:** Footer icons clutter mobile (hamburger menu has all links). Desktop needs them.

**Solution:**
```css
@media (max-width: 768px) {
    .site-footer { display: none !important; }
}
```

**Lesson:** Mobile and desktop can have fundamentally different navigation patterns. Don't force the same footer on both. Mobile hamburger menu is the discovery mechanism.

---

### 13. Library Friction → Spec → Release Cycle

**Problem:** microact couldn't render SVGs. We tried 6 workarounds over hours.

**What worked:** Stop hacking, write a precise spec:
1. Document root cause (createElement vs createElementNS)
2. List all failed approaches
3. Write acceptance criteria with checkboxes
4. Include implementation hints with code
5. Ship to library team
6. Got fix in minutes, not hours

**Release cycle in one session:**
- 0.2.2 → filed SVG namespace spec → 0.2.3 (namespace fixed, casing broken)
- 0.2.3 → filed attribute casing bug with diagnostic prompt → 0.2.4 (fully fixed)

**Lesson:** When you're fighting the framework, stop and upgrade the framework. A good spec with failed approaches and acceptance criteria gets fixes shipped fast.

---

## Microact-Specific Patterns

### Component Lifecycle
```javascript
constructor(props) { super(props); this.state = { ... }; }
didMount() { /* runs once after mount */ }
willUnmount() { /* cleanup */ }
setState(newState) { /* triggers re-render */ }
```

### Event Handlers
```javascript
// Arrow function for auto-binding
handleClick = () => { this.setState({ ... }); }

// In render:
h('button', { onclick: this.handleClick })
```

### Conditional Rendering
```javascript
// Use ternary or logical AND
condition ? h('div', ...) : null
condition && h('div', ...)
```

### Lists/Mapping
```javascript
// Use spread operator
h('div', {},
    ...items.map(item => h('div', { key: item.id }, ...))
)
```

---

## Gallery Brutalism Design Patterns

### Typography Hierarchy
- **Display**: 72px, bold, uppercase, wide letter-spacing
- **H1**: 48px, bold, tight letter-spacing
- **H3**: 24px (logo size), bold, uppercase, wide spacing
- **Body**: 16px, regular, Helvetica Neue
- **Mono**: IBM Plex Mono for addresses/numbers

### Spacing (8px Grid)
- Container padding: `var(--space-10)` (80px)
- Section margins: `var(--space-8)` (64px)
- Card padding: `var(--space-3)` (24px)
- Element gaps: `var(--space-2)` (16px)

### Border System
- Standard: 1px solid black
- Emphasis: 2px solid black
- NO rounded corners (or 2px max)

### Color Accents
- **Primary**: Pure black/white only
- **Exception 1**: Cyan for `.logo-tld` (only accent color allowed)
- **Exception 2**: Status indicators (cyan = connected, red = disconnected)

### Button Hierarchy
- **Primary**: Black bg, white text, 2px border
- **Secondary**: White bg, black text, 1px border
- **Ghost**: Transparent, black text, no border
- **Wallet**: Inverted, monospace, status dot

---

## Architecture Decisions

### 1. Single CSS Files (No Route-Specific CSS)
- `global-v2.css` - Design tokens, resets, base styles
- `components-v2.css` - ALL component styles

**Why:** Route-specific CSS files cause:
- Load order conflicts
- Duplicate styles
- Hard to debug cascade issues

**Rule:** Shared component styles → `components-v2.css`. NO separate files.

### 2. Component-Owned Containers
- Components render their own wrapper divs
- Parents should NOT wrap children unnecessarily
- Example: TopBar renders `home-top-bar`, Layout renders it directly

### 3. Explicit Children Props
- Always pass children as explicit prop in Microact
- Never rely on h() arguments for children

---

## What Worked Well

✅ **Minimal test approach** - Yellow banner test isolated rendering issues
✅ **Console logging** - `[ComponentName] description` pattern for debugging
✅ **Demo-driven development** - Copying exact HTML structure
✅ **Scorched earth CSS** - Complete removal vs incremental fixes
✅ **Flexbox sticky footer** - Clean, reliable pattern
✅ **Status indicators** - Simple dots are effective
✅ **Progressive loading with skeletons** - Perceived performance boost, clean UX
✅ **Debug utility with single toggle** - Easy to flip on/off without touching call sites
✅ **Filing specs instead of hacking workarounds** - Got 2 microact releases in one session
✅ **Network switching before fallback** - Better UX than silent degradation
✅ **ProviderManager singleton** - Clean provider lifecycle, rotation for reliability

---

## What Didn't Work

❌ **Assuming React patterns** - Microact is different, must learn its patterns
❌ **Building from memory** - Always reference the demo
❌ **Incremental CSS fixes** - CSS cascade issues need complete removal
❌ **Implicit height chains** - Must be explicit html → body → container
❌ **Hacking around framework limitations** - 6 SVG workarounds failed; filing a spec got it fixed
❌ **Calling skeleton functions as components** - `h(Skeleton)` fails if it's a function, not a class; use `Skeleton()` directly
❌ **Querying empty on-chain queues** - Always check length before index-based queries

---

## Completed Milestones

- [x] EnvironmentDetector — 4 modes, auto-detection
- [x] DataAdapter — data based on mode, FeaturedQueueManager integration
- [x] ProviderManager — wallet detection, network switching, public RPC fallback
- [x] Progressive loading — skeletons → critical data → lazy activity
- [x] ActivityIndexer — real event indexing from deployed contracts
- [x] Debug timing system — single toggle in debug.js
- [x] Footer SVGs — native microact rendering (0.2.4+)
- [x] Mobile footer hidden — hamburger menu is primary mobile nav
- [x] Deployment scripts — local chain working, contracts.local.json populated
- [x] Network switching — wallet prompted to switch to correct chain

## Next Steps

1. **Build remaining pages** — Discovery, Activity, Portfolio, ProjectDetail, Governance
2. **Follow Demo-Driven Development** — `docs/examples/*.html` is source of truth
3. **Wire up real-time updates** — micro-web3 event subscriptions for live activity
4. **Production deployment** — contracts.mainnet.json, PRODUCTION_DEPLOYED mode

---

## Reference Files

- **Demo source**: `docs/examples/homepage-v2-demo.html`
- **Component**: `src/routes/HomePage.js`
- **Layout**: `src/components/Layout/Layout.js`
- **Footer**: `src/components/Layout/Footer.js`
- **Provider**: `src/services/ProviderManager.js`
- **Data**: `src/services/DataAdapter.js`
- **Activity**: `src/services/ActivityIndexer.js`
- **Environment**: `src/services/EnvironmentDetector.js`
- **Debug**: `src/utils/debug.js`
- **Styles**: `src/core/global-v2.css`, `src/core/components-v2.css`
- **Design system**: `docs/DESIGN_SYSTEM_V2.md`
- **Mock reference**: `docs/MOCK_SYSTEM_REFERENCE.md`
- **Library friction**: `docs/plans/MICROACT_IMPROVEMENTS.md`

---

*Captured wisdom from HomePage v2 rebuild — sessions 1-3*
*Use this to avoid repeating mistakes*
*Compound this knowledge forward*
