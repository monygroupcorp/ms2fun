# MOBILE RENDERING AUDIT & FIX - COMPREHENSIVE PROMPT

## 🚨 CRITICAL ISSUES TO INVESTIGATE

### Primary Problems:
1. **Horizontal Scrolling on Mobile**: Page extends beyond viewport width, causing horizontal scroll
2. **Theme Toggle Off-Screen**: Theme toggle button is positioned outside the visible viewport
3. **HTML Extends Beyond Content**: Document width exceeds actual content width
4. **Sidebar Rendering Issues**: Mobile sidebar may be contributing to overflow

### Success Criteria:
- ✅ No horizontal scrolling on any mobile device/viewport size
- ✅ Theme toggle visible and accessible within viewport bounds
- ✅ Document width exactly matches viewport width (no overflow)
- ✅ All fixed/absolute positioned elements stay within viewport
- ✅ Sidebar slides in/out without causing layout shifts or overflow

---

## 📋 CODEBASE CONTEXT

### Architecture:
- **Framework**: Vanilla JavaScript with custom Component class
- **Routing**: Custom router system
- **Styling**: CSS with CSS variables (design tokens)
- **Theme System**: Light/dark mode with persistent toggle button

### Key Files to Audit:

#### CSS Files:
- `src/core/global.css` - Global styles, overflow prevention rules
- `src/core/theme.css` - Theme toggle positioning and styling
- `src/components/Documentation/Documentation.css` - Mobile sidebar and overlay
- `src/core/marble.css` - Marble background system (may affect layout)

#### JavaScript Files:
- `src/core/theme.js` - Theme toggle initialization and persistence
- `src/components/Documentation/Documentation.js` - Mobile menu/sidebar logic
- `src/index.js` - Main app initialization

#### Diagnostic Tools:
- `diagnose-horizontal-scroll.js` - Console script to identify overflow sources

---

## 🔍 INVESTIGATION CHECKLIST

### 1. Theme Toggle Button Issues

**Current Implementation:**
- Located in: `src/core/theme.css`
- Position: `position: fixed`
- Z-index: `10001` (var(--z-theme-toggle))
- Mobile positioning: `right: 0.75rem !important` at `@media (max-width: 968px)`
- Size: `40px × 40px` on mobile

**Questions to Answer:**
- [ ] Is the theme toggle being positioned relative to viewport or document?
- [ ] Are there conflicting CSS rules affecting its position?
- [ ] Is the `right: 0.75rem` calculation causing it to extend beyond viewport?
- [ ] Are there parent containers with transforms/positioning affecting it?
- [ ] Is the z-index causing it to be rendered in a different stacking context?

**Investigation Steps:**
1. Run diagnostic script in browser console
2. Inspect computed styles of `.theme-toggle-wrapper` on mobile
3. Check `getBoundingClientRect()` values vs viewport width
4. Verify no parent containers have `overflow: visible` or transforms
5. Check if theme toggle is inside any container that could affect positioning

**Known Attempts (That Failed):**
- Setting `max-width: calc(100vw - var(--spacing-5))` - caused overflow
- Using `right: 0.75rem !important` - still off-screen
- Adding `width: auto` and `flex-shrink: 0` - didn't fix positioning
- Setting `z-index: 1004` when sidebar active - didn't fix overflow

### 2. Document/HTML Width Overflow

**Current Implementation:**
- `html` and `body` have `overflow-x: hidden !important`
- `width: 100% !important` and `max-width: 100% !important`
- Multiple containers have overflow prevention rules

**Questions to Answer:**
- [ ] What element is actually causing the document to be wider than viewport?
- [ ] Is it a fixed/absolute positioned element?
- [ ] Is it the sidebar with `left: 0` and `transform: translateX(-100%)`?
- [ ] Are there elements with `width: 100vw` that include scrollbar width?
- [ ] Is there padding/margin on body/html causing overflow?
- [ ] Are there any elements with `min-width` larger than viewport?

**Investigation Steps:**
1. Run `diagnose-horizontal-scroll.js` in console
2. Check `document.documentElement.scrollWidth` vs `window.innerWidth`
3. Inspect all fixed/absolute positioned elements
4. Check for elements with `width: 100vw` (should be `100%` instead)
5. Look for elements with explicit pixel widths > viewport width
6. Check if sidebar's `left: 0` + `width: 280px` is causing calculation issues

**Known Attempts (That Failed):**
- Adding `overflow-x: hidden` to html/body - didn't prevent overflow
- Setting `max-width: 100vw` on fixed elements - didn't work
- Using `transform: translateX(-100%)` on sidebar - may have helped but issue persists
- Adding `contain: layout style` to sidebar - didn't fix it

### 3. Sidebar Rendering

**Current Implementation:**
- `position: fixed`
- `left: 0` with `transform: translateX(-100%)` when closed
- `transform: translateX(0)` when active
- `width: 280px`, `max-width: 280px`, `min-width: 280px`
- Inside `.doc-container` which is inside `.documentation`

**Questions to Answer:**
- [ ] Is the sidebar's fixed positioning causing layout calculations?
- [ ] Is `left: 0` + `width: 280px` making browser calculate a `right` edge?
- [ ] Should sidebar be moved outside `.doc-container` in DOM?
- [ ] Is the `transform` approach correct, or should we use different method?
- [ ] Are there CSS containment issues?

**Investigation Steps:**
1. Check if sidebar should be direct child of `body` instead of `.doc-container`
2. Verify `transform` doesn't cause layout shifts
3. Test if removing `left: 0` and using only `transform` works
4. Check computed `right` value of sidebar (should be `auto`)

### 4. Theme Toggle Persistence System

**Current Implementation:**
- Theme toggle is created in `src/core/theme.js`
- Uses `position: fixed` to persist across routes
- Multiple CSS rules with `!important` to prevent hiding

**Questions to Answer:**
- [ ] Are the persistence tricks (multiple selectors, `!important`) causing conflicts?
- [ ] Is the toggle being rendered in a stacking context that affects positioning?
- [ ] Are there JavaScript manipulations affecting its position?
- [ ] Should the toggle be in a different DOM location?

**Investigation Steps:**
1. Check where theme toggle is inserted in DOM
2. Verify no JavaScript is dynamically changing its position
3. Check for CSS specificity conflicts
4. Test if simpler positioning rules work better

---

## 🛠️ DIAGNOSTIC TOOLS

### Browser Console Script:
```javascript
// Run this in mobile viewport to diagnose issues
(function() {
    console.log('=== MOBILE RENDERING DIAGNOSTIC ===');
    console.log('Viewport:', window.innerWidth, '×', window.innerHeight);
    console.log('Document:', document.documentElement.scrollWidth, '×', document.documentElement.scrollHeight);
    console.log('Overflow:', document.documentElement.scrollWidth - window.innerWidth, 'px');
    
    // Check theme toggle
    const toggle = document.querySelector('.theme-toggle-wrapper');
    if (toggle) {
        const rect = toggle.getBoundingClientRect();
        const styles = window.getComputedStyle(toggle);
        console.log('\n=== THEME TOGGLE ===');
        console.log('Position:', styles.position);
        console.log('Right:', styles.right);
        console.log('Left:', styles.left);
        console.log('Width:', styles.width);
        console.log('Bounding Rect:', rect);
        console.log('Right Edge:', rect.right, 'px');
        console.log('Viewport Width:', window.innerWidth, 'px');
        console.log('Exceeds Viewport:', rect.right > window.innerWidth);
    }
    
    // Check all fixed elements
    const fixed = document.querySelectorAll('[style*="position: fixed"], .position-fixed');
    console.log('\n=== FIXED ELEMENTS ===');
    fixed.forEach(el => {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        if (rect.right > window.innerWidth || rect.left < 0) {
            console.log('PROBLEM:', el.className || el.id, {
                right: styles.right,
                left: styles.left,
                width: styles.width,
                rightEdge: rect.right,
                exceeds: rect.right > window.innerWidth
            });
        }
    });
    
    // Check sidebar
    const sidebar = document.querySelector('.doc-sidebar');
    if (sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const styles = window.getComputedStyle(sidebar);
        console.log('\n=== SIDEBAR ===');
        console.log('Position:', styles.position);
        console.log('Left:', styles.left);
        console.log('Transform:', styles.transform);
        console.log('Width:', styles.width);
        console.log('Bounding Rect:', rect);
    }
})();
```

### CSS Audit Checklist:
- [ ] No elements with `width: 100vw` (use `100%` instead)
- [ ] All fixed elements have explicit `right` or `left` that keeps them in viewport
- [ ] No elements with `min-width` > viewport width
- [ ] Body/html have `overflow-x: hidden` and `width: 100%`
- [ ] No padding/margin on body that could cause overflow
- [ ] Theme toggle `right` value accounts for its own width
- [ ] Sidebar doesn't cause document width calculation issues

---

## 🎯 RECOMMENDED FIX APPROACH

### Phase 1: Identify Root Cause
1. Use diagnostic script to find exact element causing overflow
2. Check computed styles vs expected values
3. Identify which CSS rule or JavaScript is causing the issue

### Phase 2: Fix Theme Toggle
**Options to Try:**
- Option A: Use `right: max(0.75rem, calc(100vw - 40px - 0.75rem))` to ensure it stays in viewport
- Option B: Move toggle to different DOM location (outside any containers)
- Option C: Use `position: absolute` on a positioned parent instead of `fixed`
- Option D: Simplify CSS rules, remove conflicting `!important` declarations

### Phase 3: Fix Document Width
**Options to Try:**
- Option A: Ensure sidebar uses `transform` only, no `left` positioning
- Option B: Move sidebar outside `.doc-container` in DOM structure
- Option C: Use `contain: strict` on sidebar to isolate layout
- Option D: Remove any elements with `width: 100vw` or explicit widths > viewport

### Phase 4: Verify & Test
1. Test on multiple mobile viewport sizes (320px, 375px, 425px, 768px)
2. Test with sidebar open and closed
3. Test theme toggle visibility and clickability
4. Verify no horizontal scrolling in any scenario

---

## 📝 KNOWN PROBLEMATIC PATTERNS

### CSS Patterns That Cause Issues:
```css
/* BAD - Can cause overflow if scrollbar exists */
width: 100vw;

/* BAD - Fixed element without viewport constraint */
position: fixed;
right: 20px; /* Might extend beyond if parent has width */

/* BAD - Transform + positioning can cause calculation issues */
position: fixed;
left: 0;
transform: translateX(-100%); /* Browser might still calculate right edge */
```

### JavaScript Patterns That Cause Issues:
```javascript
// BAD - Setting inline styles that override CSS
element.style.right = 'auto'; // Might conflict with CSS

// BAD - Multiple conflicting positioning attempts
element.style.left = '0px';
element.style.transform = 'translateX(-100%)'; // Redundant
```

---

## 🔧 FILES TO MODIFY (Priority Order)

1. **HIGH PRIORITY**: `src/core/theme.css` - Theme toggle positioning
2. **HIGH PRIORITY**: `src/core/global.css` - Global overflow prevention
3. **MEDIUM PRIORITY**: `src/components/Documentation/Documentation.css` - Sidebar styles
4. **MEDIUM PRIORITY**: `src/components/Documentation/Documentation.js` - Sidebar logic
5. **LOW PRIORITY**: `src/core/theme.js` - Theme toggle initialization (if DOM structure needs change)

---

## ✅ ACCEPTANCE CRITERIA

The fix is complete when:
1. ✅ No horizontal scrolling on mobile devices (test 320px - 768px widths)
2. ✅ Theme toggle is always visible and clickable within viewport
3. ✅ `document.documentElement.scrollWidth === window.innerWidth` (no overflow)
4. ✅ Sidebar slides in/out smoothly without causing layout issues
5. ✅ All fixed/absolute elements stay within viewport bounds
6. ✅ No console errors or warnings related to layout
7. ✅ Works in both light and dark themes
8. ✅ Works with sidebar open and closed

---

## 🚫 WHAT NOT TO DO

- ❌ Don't add more `!important` rules without understanding why
- ❌ Don't add more JavaScript workarounds - fix the root CSS issue
- ❌ Don't use `overflow-x: hidden` as the only solution - fix the cause
- ❌ Don't add more diagnostic code - use existing tools
- ❌ Don't change desktop behavior - only fix mobile issues
- ❌ Don't break theme toggle functionality - it must still work

---

## 📚 ADDITIONAL CONTEXT

### Design System:
- Uses CSS custom properties (variables) for spacing, colors, etc.
- Breakpoint: `@media (max-width: 968px)` for mobile
- Spacing system: `--spacing-3` = `0.75rem` = `12px`

### Theme Toggle Requirements:
- Must persist across route changes
- Must be visible on all pages (except CULT EXEC pages)
- Must be accessible (keyboard, screen reader)
- Must work in both light and dark themes

### Sidebar Requirements:
- Slides in from left on mobile
- Overlay darkens content (not navbar)
- Hamburger button toggles it
- Closes when clicking outside or on nav link
- Must not cause horizontal scrolling

---

## 🎓 EXPECTED EXPERTISE

This task requires:
- Deep understanding of CSS positioning (`fixed`, `absolute`, `relative`)
- Understanding of CSS transforms and their impact on layout
- Knowledge of viewport units (`vw`, `vh`) vs percentage units
- Understanding of stacking contexts and z-index
- Ability to debug complex CSS cascade issues
- Experience with mobile-first responsive design
- Understanding of browser layout calculation quirks

---

**Good luck! This is a challenging CSS debugging task that requires systematic investigation and careful fixes.**

