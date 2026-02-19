# GitHub Pages Routing Strategy

**Date:** 2026-02-18
**Purpose:** Document the 404.html hack for client-side routing on GitHub Pages

---

## The Problem

GitHub Pages is a **static file server** - it doesn't support server-side routing for SPAs.

**Example:**
- User visits `ms2.fun/project/0x123456`
- GitHub Pages looks for file at `/project/0x123456.html`
- File doesn't exist → GitHub Pages serves `404.html`

**Without the hack:**
- User gets a 404 error page ❌

**With the hack:**
- 404.html IS the full SPA ✅
- Client-side router reads `window.location.pathname` and handles routing

---

## Current Implementation

### File Structure

```
/
├── index.html        # Served for root path (/)
├── 404.html          # Served for all non-existent paths
└── src/
    └── index.js      # Router reads window.location.pathname
```

**Both files are essentially identical** - they're both the full SPA entry point.

### How It Works

1. **User visits `ms2.fun/portfolio`**
2. **GitHub Pages:** File `/portfolio.html` doesn't exist → Serves `404.html`
3. **404.html loads:** Full SPA with router
4. **Router reads:** `window.location.pathname` === `/portfolio`
5. **Router handles:** Loads `PortfolioRoute` component

---

## Current Router (Hash-based)

**Location:** `src/core/Router.js`

**Pattern:**
```javascript
// Current router uses hash routing for compatibility
router.on('/portfolio', renderPortfolio);
router.on('/project/:id', renderProjectDetail);

// Reads window.location.pathname (not hash!)
await router.handleRoute(window.location.pathname);
```

**URLs:**
- ✅ `/portfolio` (handled by 404.html)
- ✅ `/project/0x123` (handled by 404.html)
- ❌ `/#/portfolio` (hash routing not needed on GitHub Pages!)

---

## Microact Router Compatibility

**Good news:** Microact's built-in Router uses **path-based routing** by default!

```javascript
import { Router } from 'microact';

const router = new Router();

router.on('/', () => { /* home */ });
router.on('/portfolio', () => { /* portfolio */ });
router.on('/project/:id', (params) => { /* project detail */ });

router.start();
```

**How it works:**
1. `router.start()` calls `handleRoute(window.location.pathname)`
2. Matches path against registered routes
3. On `popstate` event (browser back/forward), re-handles route
4. `router.navigate(path)` uses `pushState` to change URL without reload

**GitHub Pages compatibility:**
- ✅ Initial load: 404.html → Router reads pathname → Matches route
- ✅ Navigation: `router.navigate('/portfolio')` → pushState → No reload
- ✅ Back/forward: `popstate` event → Router handles new pathname
- ✅ Direct URL: User visits `ms2.fun/portfolio` → 404.html → Router handles

---

## v2 Migration Plan

### Keep 404.html as SPA Entry Point

**404.html** (and index.html) should load:
- v2 CSS (`global-v2.css`, `components-v2.css`)
- Microact from CDN or bundled
- Main app entry (`src/index.js`)

### Update src/index.js

```javascript
import { Router, h, render } from 'microact';
import serviceFactory from './services/ServiceFactory.js';

async function initializeApp() {
  // Initialize services
  await serviceFactory.initialize();

  // Create Microact router (path-based)
  const router = new Router();

  // Register routes (async-loaded)
  router.on('/', async () => {
    const { HomePage } = await import('./routes/HomePage.js');
    const container = document.getElementById('app');
    render(h(HomePage), container);
  });

  router.on('/portfolio', async () => {
    const { PortfolioRoute } = await import('./routes/Portfolio.js');
    const container = document.getElementById('app');
    render(h(PortfolioRoute), container);
  });

  router.on('/project/:id', async (params) => {
    const { ProjectDetailRoute } = await import('./routes/ProjectDetail.js');
    const container = document.getElementById('app');
    render(h(ProjectDetailRoute, { projectId: params.id }), container);
  });

  // 404 handler
  router.notFound((path) => {
    const container = document.getElementById('app');
    container.innerHTML = `<h1>404 - Not Found</h1><p>Path: ${path}</p>`;
  });

  // Start router (reads window.location.pathname)
  await router.start();
}

// Wait for DOM, then init
document.addEventListener('DOMContentLoaded', initializeApp);
```

### No Changes Needed to 404.html Logic!

GitHub Pages routing **just works** with Microact's path-based router:
- ✅ 404.html serves the SPA
- ✅ Microact Router reads `window.location.pathname`
- ✅ `router.navigate()` uses `pushState` (no page reload)
- ✅ Browser back/forward triggers `popstate` event

---

## Build Process

### Vite Build Output

**vite.config.js** should output to `/dist`:
```javascript
export default {
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        404: '404.html'
      }
    }
  }
}
```

**Deployed files:**
```
/dist/
├── index.html        # Root entry
├── 404.html          # SPA fallback
├── assets/
│   ├── index.[hash].js
│   ├── index.[hash].css
│   └── ...
└── src/              # Or bundled into assets/
```

---

## Key Takeaways

1. **404.html IS the app** - Not a redirect, the full SPA
2. **Path-based routing works** - No hash needed on GitHub Pages
3. **Microact Router is perfect** - Built for path-based routing
4. **No special logic needed** - Just use `router.navigate()` for navigation
5. **Keep 404.html identical to index.html** - Both serve the same SPA

---

## Testing Locally

To test GitHub Pages routing locally:

### Option 1: Python HTTP Server
```bash
python -m http.server 8000
# Visit: http://localhost:8000
# Try: http://localhost:8000/portfolio (gets 404.html)
```

### Option 2: Vite Preview (Fallback to index.html)
```bash
npm run build
npm run preview
# Vite automatically falls back to index.html for SPAs
```

### Option 3: Serve with SPA Fallback
```bash
npx serve dist -s  # -s flag = single-page app mode
```

---

**Ready for Phase 5 with GitHub Pages routing understood!**
