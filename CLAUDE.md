# Claude Code Rules for ms2fun

Project-specific rules and conventions for AI-assisted development.

---

## Mandatory Rules

### 0. No Co-Authored-By in Commits

Do NOT add "Co-Authored-By" lines to git commit messages.

---

### 1. Log Library Friction to Improvements Doc

When encountering friction with the component system (microact) or web3 utilities (micro-web3):

1. **Apply a workaround** to keep the task moving
2. **Update `docs/plans/MICROACT_IMPROVEMENTS.md`** with:
   - Problem encountered
   - Workaround applied
   - Desired behavior
   - Acceptance criteria
3. **Add entry to Issues Log table** at bottom of that doc

This ensures real-world pain points feed directly into library improvements.

**Triggers:**
- `shouldUpdate()` override needed to prevent child destruction
- Manual DOM manipulation to avoid re-render
- Timing hacks with `setTimeout` for component mounting
- Contract adapter method missing or awkward
- Wallet connection edge cases
- Transaction state management issues

---

### 2. Follow Naming Conventions

See `docs/NAMING_CONVENTIONS.md` for component, route, and service naming patterns.

**Quick reference:**
- `*Page` / `*Route` - Route-level components
- `*View` - Major view sections
- `*Panel` - Self-contained UI sections
- `*Card` - Compact display units for lists
- `*Form` - User input collection
- `*Interface` - Complex interactive UI

---

### 3. Modular CSS Architecture (V2)

**Structure:**
- `global-v2.css` - Design tokens, resets, base styles (loaded globally in index.html)
- `core-components-v2.css` - Shared components: buttons, badges, nav, footer, skeletons (loaded globally in index.html)
- `route-*-v2.css` - Route-specific styles (loaded dynamically by each route component)

**Adding route-specific styles:**
1. Create `src/core/route-[name]-v2.css` for your route
2. In your route component's `didMount()`:
   ```javascript
   import stylesheetLoader from '../utils/stylesheetLoader.js';

   async didMount() {
       await stylesheetLoader.load('/src/core/route-[name]-v2.css');
       // ... rest of initialization
   }
   ```
3. The stylesheet loader handles caching and prevents duplicate loads

**Don't:**
- Add route-specific CSS to `core-components-v2.css`
- Create separate CSS files for individual components (use route-level CSS instead)
- Load stylesheets via `<link>` tags in index.html (except global and core-components)

---

### 4. Demo-Driven Development (Gallery Brutalism v2)

**CRITICAL:** Before implementing ANY v2 component or page, reference the corresponding demo file in `docs/examples/`.

**The demos are the source of truth.** Don't rely on assumptions, conventions, or general design patterns.

**Required workflow:**

1. **Find the demo file** for the component/page you're building
   - HomePage → `docs/examples/homepage-v2-demo.html`
   - ProjectDiscovery → `docs/examples/project-discovery-demo.html`
   - Portfolio → `docs/examples/portfolio-demo.html`
   - Etc. (see `docs/MOCK_SYSTEM_REFERENCE.md` for full inventory)

2. **Open the demo in browser** to see the visual design
   - Test responsive behavior (resize to 640px)
   - Check mobile nav (click hamburger)
   - Note spacing, typography, borders

3. **Copy exact HTML structure** from demo file
   - Desktop nav links (or lack thereof)
   - Mobile nav panel links
   - Card layouts, grids, forms
   - Class names and structure

4. **Convert HTML to Microact h() syntax** line-by-line
   - Preserve class names exactly
   - Match element hierarchy
   - Keep inline styles if present in demo

5. **Reference demo CSS** for any component-specific styles
   - Check inline `<style>` blocks in demo
   - Copy to `src/core/components-v2.css` if needed
   - Don't invent new styles not in demo

6. **Verify side-by-side** before considering done
   - Open demo in one browser tab
   - Open production in another tab
   - Compare visually at multiple breakpoints
   - Fix discrepancies immediately

**Why this matters:**

The Gallery Brutalism design is **intentionally minimal and opinionated**. Standard web conventions don't apply:
- Desktop nav has ONLY "Create" button (not all links)
- Discovery happens via homepage (not nav bar)
- Portfolio accessed via wallet button (not nav bar)
- Brutalist aesthetic rejects decoration, shadows, rounded corners

Without referencing demos, you WILL introduce conventional patterns that violate the design philosophy.

**Anti-patterns (DO NOT DO):**
- ❌ Implementing components from memory or general knowledge
- ❌ Adding "helpful" features not in the demo (extra nav links, dropdowns, etc.)
- ❌ Assuming standard web conventions apply
- ❌ Inventing new CSS classes or styles
- ❌ Skipping side-by-side verification

**Exceptions:**
- Dynamic data binding (demos use static HTML)
- Router integration (demos use static links)
- State management (demos are stateless)

But even with dynamic features, the **visual structure and styling must match the demo exactly**.

---

### 5. Web3 Initialization in Layout (All Routes Get It)

**Pattern:** Layout handles provider + environment initialization once. All child routes receive props automatically.

**What Layout provides to routes:**
```javascript
{
    mode,           // 'LOCAL_BLOCKCHAIN' | 'PLACEHOLDER_MOCK' | 'PRODUCTION_DEPLOYED' | 'COMING_SOON'
    config,         // Parsed contracts config (from contracts.local.json or contracts.mainnet.json)
    provider,       // ethers.js provider (wallet or public RPC)
    providerType,   // 'wallet' | 'public'
    web3Ready,      // boolean - true when initialization complete
    web3InitError   // string | null - error message if initialization failed
}
```

**In your route component:**
```javascript
async didMount() {
    await stylesheetLoader.load('/src/core/route-[name]-v2.css');

    // Wait for Layout's web3 initialization
    if (!this.props.web3Ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Use props from Layout
    const { mode, config, provider, web3InitError } = this.props;

    if (web3InitError) {
        this.setState({ error: `Web3 failed: ${web3InitError}` });
        return;
    }

    // Load your data using mode, config, provider
    const adapter = new DataAdapter(mode, config, provider);
    const data = await adapter.getCriticalData();
    // ...
}
```

**Don't:**
- Import EnvironmentDetector or providerManager in route components
- Call `EnvironmentDetector.detect()` or `providerManager.initialize()` in routes
- Duplicate web3 initialization logic across routes

**Why:**
- Single source of truth for web3 state
- Faster route loads (initialization already done)
- Consistent provider/environment across all routes
- Easy to add new routes without repeating plumbing

---

## Guidelines

### Component Architecture Workarounds

Until microact VDOM is implemented, use these patterns:

**Preventing child destruction:**
```javascript
shouldUpdate(oldState, newState) {
    // Only re-render for structural changes
    if (oldState.loading !== newState.loading) return true;
    if (oldState.data !== newState.data) return true;

    // Update DOM directly for minor state changes
    if (oldState.balance !== newState.balance) {
        this.updateBalanceDisplay(newState.balance);
        return false;
    }
    return false;
}
```

**Always log these workarounds to MICROACT_IMPROVEMENTS.md**

---

### Debug Logging

When debugging component issues, add temporary logs with component name prefix:
```javascript
console.log('[ComponentName] description:', data);
```

Remove debug logs before committing unless they provide ongoing value.

---

## Reference Docs

- `docs/NAMING_CONVENTIONS.md` - Component and file naming
- `docs/DESIGN_SYSTEM_V2.md` - Gallery Brutalism design system (v2)
- `docs/MOCK_SYSTEM_REFERENCE.md` - Demo file inventory and usage guide
- `docs/examples/*.html` - HTML demo files (source of truth for v2 design)
- `docs/DESIGN_SYSTEM.md` - Temple of Capital UI patterns (v1, deprecated)
- `docs/FRONTEND_ARCHITECTURE.md` - System architecture
- `docs/plans/MICROACT_IMPROVEMENTS.md` - Library improvement tracker
