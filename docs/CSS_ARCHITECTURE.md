# CSS Architecture (V2)

**Date:** 2026-02-19
**Pattern:** Layered CSS with dynamic loading/unloading

---

## CSS Layer System

CSS is loaded in **layers** with different lifecycle rules:

| Layer | When Loaded | When Unloaded | Example |
|-------|-------------|---------------|---------|
| `global` | On app init | Never | Design tokens, resets |
| `core` | On app init | Never | Buttons, nav, footer |
| `project:name` | Viewing project | Leave project | Custom project branding |
| `edition:name` | Viewing edition | Leave edition | Edition-specific styles |
| `route:name` | Entering route | Leave route | Page-specific layouts |

**Load order:** global → core → project/edition → route

This ensures:
- Project/edition styles can override defaults
- Route styles add page-specific layouts
- Memory stays clean as users navigate

---

## File Structure

```
src/core/
├── global-v2.css              # Layer: global (13KB)
├── core-components-v2.css     # Layer: core (27KB)
├── route-home-v2.css          # Layer: route:home (6.8KB)
├── route-discovery-v2.css     # Layer: route:discovery (5.1KB)
└── route-[name]-v2.css        # Layer: route:[name]

Future project/edition CSS:
└── projects/
    ├── cultexecs.css          # Layer: project:cultexecs
    └── cultexecs-genesis.css  # Layer: edition:genesis
```

---

## What Goes Where

### `global-v2.css` (loaded globally)
- CSS variables (design tokens)
- CSS reset
- Base typography
- Theme definitions
- Color system
- Spacing system

**Never add component or route-specific styles here.**

### `core-components-v2.css` (loaded globally)
- Shared components used across routes:
  - Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, etc.)
  - Badges (`.badge`)
  - Navigation (`.home-top-bar`, `.mobile-nav-panel`)
  - Footer (`.site-footer`)
  - Skeletons (`.skeleton-*`)
  - Wallet button
  - Form inputs (shared)

**Only add styles that appear on 2+ routes.**

### `route-[name]-v2.css` (loaded dynamically)
- Styles specific to one route
- Page-specific layouts
- Route-specific components
- Responsive breakpoints for that route

**Examples:**
- `route-home-v2.css`: `.home-page`, `.featured-banner`, `.home-content`
- `route-discovery-v2.css`: `.discovery-page`, `.filter-panel`, `.search-bar`

---

## Usage Pattern

### In Route Components

```javascript
import stylesheetLoader from '../utils/stylesheetLoader.js';

export class YourRoute extends Component {
    async didMount() {
        // Load route-specific CSS with layer ID
        await stylesheetLoader.load('/src/core/route-yourroute-v2.css', 'route:yourroute');

        // Then initialize data, etc.
        await this.loadData();
    }
}
```

### In Router Cleanup

```javascript
router.on('/yourroute', async () => {
    // ... render component

    return {
        cleanup: () => {
            // Unload route CSS when navigating away
            stylesheetLoader.unload('route:yourroute');
            unmountRoot(appContainer);
        }
    };
});
```

### For Project/Edition CSS

```javascript
// When viewing a project
await stylesheetLoader.load('/projects/cultexecs.css', 'project:cultexecs');

// When viewing an edition (loads on top of project CSS)
await stylesheetLoader.load('/projects/cultexecs-genesis.css', 'edition:genesis');

// When leaving project
stylesheetLoader.unloadLayer('project'); // unloads all project:* CSS
stylesheetLoader.unloadLayer('edition'); // unloads all edition:* CSS
```

### In index.html

```html
<!-- Global styles only -->
<link rel="stylesheet" href="/src/core/global-v2.css">
<link rel="stylesheet" href="/src/core/core-components-v2.css">
<!-- Route styles loaded dynamically -->
```

---

## Adding New Routes

1. **Create CSS file:**
   ```bash
   touch src/core/route-[name]-v2.css
   ```

2. **Add route-specific styles** copied from demo HTML `<style>` blocks

3. **Load in component with layer ID:**
   ```javascript
   import stylesheetLoader from '../utils/stylesheetLoader.js';

   async didMount() {
       await stylesheetLoader.load('/src/core/route-[name]-v2.css', 'route:[name]');
       // ...
   }
   ```

4. **Unload in router cleanup:**
   ```javascript
   return {
       cleanup: () => {
           stylesheetLoader.unload('route:[name]');
           unmountRoot(appContainer);
       }
   };
   ```

5. **Verify no duplicates** - Check that styles aren't already in `core-components-v2.css`

---

## Benefits

✅ **Layered Override System** - Project/edition CSS can override defaults
✅ **Memory Management** - CSS unloads when leaving context (route/project/edition)
✅ **Performance** - Only load CSS needed for current page/project
✅ **Maintainability** - Each layer's styles are isolated
✅ **Clarity** - Easy to find styles (layered, not mega-file)
✅ **Scalability** - Projects/editions/routes don't interfere with each other
✅ **Custom Branding** - Each project can have totally custom styling

---

## Anti-Patterns

❌ **Don't** add route-specific CSS to `core-components-v2.css`
❌ **Don't** create per-component CSS files (use route-level instead)
❌ **Don't** inline styles in components (use CSS classes)
❌ **Don't** forget to load route CSS in `didMount()`
❌ **Don't** manually add `<link>` tags (use stylesheetLoader)

---

## Migration from Monolithic CSS

The old `components-v2.css` (39KB) was split into:
- `core-components-v2.css` (27KB) - Shared components
- `route-home-v2.css` (6.8KB) - HomePage-specific
- `route-discovery-v2.css` (5.1KB) - Discovery-specific

**Old file preserved** at `components-v2.css` but no longer loaded.

Future routes should follow this modular pattern from the start.

---

## StylesheetLoader API

### Load a stylesheet
```javascript
await stylesheetLoader.load(href, id);
```
- `href`: Path to CSS file (e.g., '/src/core/route-home-v2.css')
- `id`: Layer identifier (e.g., 'route:home', 'project:cultexecs', 'edition:genesis')
- Returns a Promise that resolves when CSS is loaded
- Automatically prevents duplicate loads
- Adds data attributes to `<link>` element for tracking

### Unload a specific stylesheet
```javascript
stylesheetLoader.unload('route:home');
```
- Removes the stylesheet from DOM
- Cleans up internal tracking

### Unload all stylesheets in a layer
```javascript
stylesheetLoader.unloadLayer('route');    // unloads all route:* CSS
stylesheetLoader.unloadLayer('project');  // unloads all project:* CSS
stylesheetLoader.unloadLayer('edition');  // unloads all edition:* CSS
```

### Unload everything (with protection)
```javascript
stylesheetLoader.unloadAll(true);  // unload route/project/edition, keep global/core
stylesheetLoader.unloadAll(false); // unload EVERYTHING
```

### Debug loaded sheets
```javascript
const sheets = stylesheetLoader.getLoadedSheets();
console.log(sheets);
// [
//   { id: 'route:home', layer: 'route', name: 'home', href: '...' },
//   { id: 'project:cultexecs', layer: 'project', name: 'cultexecs', href: '...' }
// ]
```

---

## Reference

- Demo files: `docs/examples/*.html` contain `<style>` blocks with route-specific CSS
- Demo-Driven Development (CLAUDE.md Rule #4): Copy exact CSS from demos
- stylesheetLoader: `src/utils/stylesheetLoader.js` handles layered loading/unloading
