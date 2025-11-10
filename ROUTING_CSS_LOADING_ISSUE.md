================================================================================

AGENT PROMPT: Routing and CSS Loading Issue Investigation

================================================================================

CONTEXT:

We have a single-page application (SPA) using client-side routing. The app
uses a custom Component system and a stylesheetLoader utility for dynamic CSS
loading. We're experiencing issues where CSS files aren't loading when directly
accessing project detail pages, but they work when navigating from the home page.

================================================================================

CURRENT ISSUE:

1. **Direct Page Reload Problem:**
   - When directly accessing a project detail page (e.g., `/project/0x...`),
     the page loads but CSS stylesheets are not applied
   - Console shows errors: `Uncaught SyntaxError: Unexpected token '<'` for
     `app.js` and `index.js`
   - This suggests the server is returning HTML (probably index.html) instead
     of JavaScript files

2. **CSS Not Loading:**
   - ERC1155 component styles (`src/components/ERC1155/erc1155.css`) are not
     being loaded or applied
   - The stylesheetLoader utility is being called, but the CSS doesn't appear
     in the browser's Network tab
   - When navigating from home page → project detail, CSS sometimes works
   - When directly reloading project detail page, CSS never works

3. **Routing Behavior:**
   - The app uses client-side routing (Router.js)
   - Pages don't seem to "load" as much as they "appear" when switching routes
   - This suggests the routing system might be preventing proper initialization

================================================================================

RELEVANT FILES:

1. **Server Configuration:**
   - `server.js` - Express server with static file serving
   - Has catch-all route: `app.get('*', ...)` that returns index.html
   - This might be intercepting CSS/JS file requests

2. **Routing System:**
   - `src/core/Router.js` - Client-side router implementation
   - `src/routes/ProjectDetail.js` - Project detail route handler
   - `src/index.js` - App initialization

3. **CSS Loading:**
   - `src/utils/stylesheetLoader.js` - Dynamic stylesheet loader
   - `src/components/ERC1155/EditionGallery.js` - Component that loads CSS
   - `src/routes/ProjectDetail.js` - Route that should load CSS

4. **Component System:**
   - `src/core/Component.js` - Base component class
   - Components use lifecycle methods: `onMount()`, `onUnmount()`, etc.

================================================================================

OBSERVED BEHAVIOR:

**Working Flow (Home → Project Detail):**
1. User on home page
2. Clicks project card
3. Router navigates to project detail
4. ProjectDetail route handler runs
5. CSS loads (sometimes)
6. Component mounts
7. Styles apply (sometimes)

**Broken Flow (Direct Reload):**
1. User directly accesses `/project/0x...`
2. Server returns index.html (catch-all route)
3. App initializes
4. Router detects URL and loads project detail
5. CSS loading is called but doesn't work
6. Styles never apply
7. Console shows JS file errors

================================================================================

CURRENT IMPLEMENTATION:

**CSS Loading Attempts:**
1. Route level (`src/routes/ProjectDetail.js`):
   ```javascript
   // Gets project to determine contract type
   const project = await projectRegistry.getProject(projectId);
   if (project.contractType === 'ERC1155') {
       stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
   }
   ```

2. Component level (`src/components/ERC1155/EditionGallery.js`):
   ```javascript
   async onMount() {
       stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
       // ... also has manual fallback check
   }
   ```

**StylesheetLoader Implementation:**
- Creates `<link>` element with `rel="stylesheet"`
- Sets `href` to the CSS path
- Appends to `document.head`
- Has error/load handlers (recently added)

**Server Static File Serving:**
- Serves from root directory: `express.static(path.join(__dirname))`
- Has MIME type handling for `.css` files
- Catch-all route returns `index.html` for any unmatched route

================================================================================

QUESTIONS TO INVESTIGATE:

1. **Why are JS files returning HTML?**
   - Is the catch-all route intercepting JS file requests?
   - Should static file middleware come before the catch-all route?
   - Are there any route ordering issues?

2. **Why isn't CSS loading on direct page access?**
   - Is the stylesheetLoader being called at the right time?
   - Is the DOM ready when CSS is being loaded?
   - Are there any timing/race condition issues?
   - Is the CSS path correct for direct access vs navigation?

3. **Why does navigation work but direct reload doesn't?**
   - What's different about the initialization flow?
   - Are there any state/context differences?
   - Is the router handling direct access correctly?

4. **Should CSS be loaded differently?**
   - Should CSS be inlined for critical styles?
   - Should CSS be loaded synchronously vs asynchronously?
   - Should CSS be part of the initial HTML instead of dynamic loading?

================================================================================

SPECIFIC INVESTIGATION TASKS:

1. **Check Server Route Ordering:**
   - Verify static file middleware is before catch-all route
   - Test if JS/CSS files are accessible when requested directly
   - Check if catch-all route is intercepting static file requests

2. **Check Router Initialization:**
   - Verify router handles direct URL access correctly
   - Check if route handlers are called in the right order
   - Verify component mounting happens after CSS loading

3. **Check CSS Loading Timing:**
   - Add detailed logging to stylesheetLoader
   - Verify link element is created and added to DOM
   - Check Network tab to see if CSS request is made
   - Verify CSS file is actually being requested by browser

4. **Check Component Lifecycle:**
   - Verify `onMount()` is called at the right time
   - Check if CSS loading happens before or after DOM is ready
   - Verify component mounting doesn't interfere with CSS loading

5. **Test Different Scenarios:**
   - Direct page reload
   - Navigation from home page
   - Browser back/forward buttons
   - Different project types (ERC404 vs ERC1155)

================================================================================

EXPECTED BEHAVIOR:

1. **Direct Page Access:**
   - User navigates to `/project/0x...` directly
   - Server serves index.html
   - App initializes
   - Router detects URL and loads appropriate route
   - CSS files load correctly
   - Styles apply immediately
   - No console errors

2. **Navigation:**
   - User navigates from home to project detail
   - Router handles navigation
   - CSS files load correctly
   - Styles apply
   - Smooth transition

3. **CSS Loading:**
   - CSS should load when route handler runs
   - CSS should load when component mounts (as fallback)
   - CSS should persist across navigation
   - CSS should not be unloaded prematurely

================================================================================

FILES TO EXAMINE:

**Server & Routing:**
- `server.js` - Server configuration and route ordering
- `src/core/Router.js` - Client-side router
- `src/index.js` - App initialization

**CSS Loading:**
- `src/utils/stylesheetLoader.js` - Stylesheet loader utility
- `src/routes/ProjectDetail.js` - Route handler with CSS loading
- `src/components/ERC1155/EditionGallery.js` - Component with CSS loading

**Component System:**
- `src/core/Component.js` - Base component with lifecycle
- `src/components/ProjectDetail/ProjectDetail.js` - Project detail component
- `src/components/ProjectDetail/ContractTypeRouter.js` - Router component

**CSS File:**
- `src/components/ERC1155/erc1155.css` - The CSS file that's not loading

================================================================================

DEBUGGING SUGGESTIONS:

1. **Add comprehensive logging:**
   - Log when stylesheetLoader.load() is called
   - Log when link element is created
   - Log when link is added to DOM
   - Log link.onload and link.onerror events
   - Log Network tab requests

2. **Check browser DevTools:**
   - Network tab: Is CSS file requested? What status code?
   - Elements tab: Is link element in `<head>`? What's the href?
   - Console: Any errors related to CSS loading?
   - Sources: Can you see the CSS file content?

3. **Test server directly:**
   - `curl http://localhost:3000/src/components/ERC1155/erc1155.css`
   - Verify it returns CSS content, not HTML
   - Check Content-Type header

4. **Compare working vs broken:**
   - What's different between navigation and direct reload?
   - Are there timing differences?
   - Are there state differences?
   - Are there DOM readiness differences?

================================================================================

SUCCESS CRITERIA:

The issue is resolved when:

1. ✅ Direct page reload works correctly
2. ✅ CSS files load and apply styles
3. ✅ No console errors about JS/CSS files
4. ✅ Navigation from home page works
5. ✅ Browser back/forward buttons work
6. ✅ CSS persists across navigation
7. ✅ All project types (ERC404, ERC1155) work correctly

================================================================================

CURRENT WORKAROUNDS:

- CSS is loaded at both route level and component level
- Manual fallback check creates link element if missing
- CSS is not unloaded on component unmount
- Added extensive logging to stylesheetLoader

These workarounds help but don't solve the root cause.

================================================================================

YOUR MISSION:

Investigate the root cause of why CSS isn't loading on direct page access.
Focus on:

1. Server route ordering and static file serving
2. Router initialization and direct URL handling
3. CSS loading timing and DOM readiness
4. Differences between navigation and direct reload flows

Provide a fix that ensures CSS loads correctly in all scenarios.

================================================================================

