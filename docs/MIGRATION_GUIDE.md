# Migration Guide: Temple of Capital → Gallery Brutalism

**From:** Design System V1 (Temple of Capital)
**To:** Design System V2 (Gallery Brutalism)

---

## Overview

This is a **complete design overhaul**, not an incremental update. The aesthetic philosophy has changed fundamentally:

| Old (Temple of Capital) | New (Gallery Brutalism) |
|------------------------|-------------------------|
| Warm marble textures | Pure monochrome |
| Gold/bronze metallics | Black and white only |
| Engraved plaques | Sharp geometric forms |
| Classical serif fonts | Geometric sans-serif |
| Multiple accent colors | Zero accent colors |
| Decorative shadows | Minimal shadows |
| Rounded corners | Sharp corners (0-2px) |
| Gradients | NO gradients |

---

## Phase 1: Foundation Setup

### Step 1: Add New CSS Files

**Add to your HTML `<head>` BEFORE any component-specific CSS:**

```html
<!-- New Design System V2 -->
<link rel="stylesheet" href="/src/core/global-v2.css">
<link rel="stylesheet" href="/src/core/components-v2.css">
```

**Do NOT remove old CSS yet** - we'll do this incrementally.

### Step 2: Test Theme Switching

The new system uses `data-theme` attribute on `<html>`:

```javascript
// Light mode (default)
document.documentElement.setAttribute('data-theme', 'light');

// Dark mode
document.documentElement.setAttribute('data-theme', 'dark');
```

**Verify:**
- Light mode shows white backgrounds, black text
- Dark mode shows black backgrounds, white text
- All components adapt to theme changes

---

## Phase 2: Color Migration

### Old → New Variable Mapping

**Backgrounds:**
```css
/* OLD */
--bg-elevated: #ffffff;
--marble-white: #faf9f7;
--marble-cream: #f5f3f0;

/* NEW */
--bg-primary: #ffffff;      /* Pure white */
--bg-secondary: #fafafa;    /* Subtle gray */
--bg-tertiary: #f5f5f5;     /* Light gray */
```

**Text:**
```css
/* OLD */
--text-primary: #2d2d2d;
--gold-primary: #d4af37;

/* NEW */
--text-primary: #000000;    /* Pure black */
--text-secondary: #666666;  /* Medium gray */
--text-tertiary: #999999;   /* Light gray */
```

**Borders:**
```css
/* OLD */
--border-base: #e8e5e0;

/* NEW */
--border-primary: #000000;     /* Black */
--border-secondary: #e0e0e0;   /* Light gray */
--border-tertiary: #f0f0f0;    /* Very light gray */
```

### Remove ALL Color Accents

**Delete these:**
```css
/* DELETE - No accent colors in new system */
--accent-primary: #d4af37;       /* Gold - REMOVED */
--gold-metallic-base: #c9a442;   /* REMOVED */
--bronze-metallic-base: #cd7f32; /* REMOVED */
--copper-metallic-base: #b87333; /* REMOVED */
```

**Replace with monochrome:**
```css
/* Use text hierarchy instead */
color: var(--text-primary);   /* Black - most important */
color: var(--text-secondary); /* Gray - secondary */
color: var(--text-tertiary);  /* Light gray - tertiary */
```

---

## Phase 3: Typography Migration

### Font Family Changes

**OLD:**
```css
--font-heading: 'RedHatTextVar', sans-serif;
--font-engraved: 'Playfair Display', serif;
```

**NEW:**
```css
--font-primary: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;
--font-mono: 'IBM Plex Mono', 'Courier New', monospace;
```

### Update Font Usage

**Headings (remove decorative fonts):**
```css
/* OLD */
h1 {
  font-family: var(--font-heading);
  font-weight: var(--font-weight-bold);
}

/* NEW */
h1 {
  font-family: var(--font-primary); /* Helvetica */
  font-weight: var(--font-weight-bold);
}
```

**Data/Numbers (add monospace):**
```css
/* NEW - Use for addresses, hashes, numbers */
.text-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

### Remove Engraved Typography

**DELETE:**
```css
/* DELETE - No engraved/serif fonts */
--font-engraved: 'Playfair Display', serif;
text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3), ...;
```

---

## Phase 4: Component Migration

### Buttons

**OLD (Metallic Engraved):**
```css
.btn-primary {
  background: var(--gradient-metallic-raised);
  color: var(--gold-metallic-dark);
  font-family: var(--font-engraved);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-metallic-raised);
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3), ...;
}
```

**NEW (Pure Monochrome):**
```css
.btn-primary {
  background-color: var(--text-primary);  /* Black */
  color: var(--bg-primary);               /* White */
  font-family: var(--font-primary);       /* Helvetica */
  border-radius: var(--radius-none);      /* Sharp corners */
  box-shadow: none;                       /* No shadow */
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.btn-primary:hover {
  opacity: 0.7;  /* Simple opacity change */
}
```

### Cards

**OLD (Marble Elevated):**
```css
.card {
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-2);
}
```

**NEW (Sharp Minimal):**
```css
.card {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-none);  /* Sharp corners */
  box-shadow: var(--shadow-subtle);   /* Barely visible */
  padding: var(--card-padding);
}
```

### Forms

**OLD:**
```css
.form-input {
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
}
```

**NEW:**
```css
.form-input {
  background-color: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-sm);  /* 2px - minimal */
  font-family: var(--font-primary);
}

.form-input:focus {
  outline: 2px solid var(--state-focus-outline);
  border-color: var(--border-primary);
}
```

---

## Phase 5: Remove Forbidden Elements

### Delete Gradients

**FIND and DELETE:**
```css
/* DELETE ALL */
background: linear-gradient(...);
background: var(--gradient-*);
```

**REPLACE with:**
```css
background-color: var(--bg-secondary);  /* Solid colors only */
```

### Delete Heavy Shadows

**FIND:**
```css
/* DELETE */
--elevation-5: 0 20px 40px -4px rgba(26, 26, 26, 0.15), ...;
box-shadow: var(--shadow-lg);
```

**REPLACE with:**
```css
/* Use minimal shadows or borders */
box-shadow: var(--shadow-subtle);  /* Barely visible */
/* OR */
border: 1px solid var(--border-secondary);  /* Prefer borders */
```

### Delete Rounded Corners

**FIND:**
```css
/* DELETE OR MINIMIZE */
border-radius: var(--radius-lg);   /* 8px */
border-radius: var(--radius-2xl);  /* 16px */
```

**REPLACE with:**
```css
border-radius: var(--radius-none);  /* 0px - preferred */
/* OR */
border-radius: var(--radius-sm);    /* 2px - minimal */
```

### Delete Metallic Effects

**DELETE ALL:**
```css
/* DELETE - No metallic effects */
--gold-metallic-*
--bronze-metallic-*
--silver-metallic-*
--copper-metallic-*
--gradient-metallic-*
--shadow-metallic-*
text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3), ...;
```

---

## Phase 6: Layout Updates

### Spacing (8px Grid)

**OLD (varied):**
```css
padding: 24px;
margin: 20px;
gap: 18px;
```

**NEW (strict 8px grid):**
```css
padding: var(--space-3);  /* 24px - aligns to grid */
margin: var(--space-4);   /* 32px - aligns to grid */
gap: var(--space-2);      /* 16px - aligns to grid */
```

**All spacing MUST be multiples of 8px:**
- 8px (`--space-1`)
- 16px (`--space-2`)
- 24px (`--space-3`)
- 32px (`--space-4`)
- 48px (`--space-6`)
- 64px (`--space-8`)

### Container Widths

**OLD:**
```css
max-width: 1280px;
```

**NEW:**
```css
max-width: var(--container-xl);  /* 1200px - 75rem */
padding-left: var(--space-10);   /* 80px generous margins */
padding-right: var(--space-10);
```

---

## Phase 7: Accessibility

### Focus States

**ALL interactive elements MUST have visible focus:**

```css
/* NEW - Required for all buttons, links, inputs */
.btn:focus-visible {
  outline: 2px solid var(--state-focus-outline);
  outline-offset: 2px;
}

a:focus-visible {
  outline: 2px solid var(--state-focus-outline);
  outline-offset: 2px;
}

.form-input:focus {
  outline: 2px solid var(--state-focus-outline);
}
```

### Contrast Ratios

**New system guarantees maximum contrast:**
- Light mode: Black (#000000) on white (#ffffff) = 21:1
- Dark mode: White (#ffffff) on black (#000000) = 21:1

**No color adjustments needed - automatically WCAG AAA compliant.**

---

## Phase 8: Testing Checklist

### Visual Testing

- [ ] All pages render in light mode
- [ ] All pages render in dark mode
- [ ] No gradients visible
- [ ] No color accents visible
- [ ] All corners sharp or minimal (≤2px)
- [ ] All shadows minimal or invisible
- [ ] All buttons use monochrome styling
- [ ] All text uses Helvetica (not RedHat, not Playfair)
- [ ] Data/numbers use monospace font

### Functional Testing

- [ ] Theme toggle works (light ↔ dark)
- [ ] All buttons clickable and provide feedback
- [ ] Forms functional with clear validation
- [ ] Focus states visible on all interactive elements
- [ ] Keyboard navigation works
- [ ] Mobile responsive (test at 375px, 768px, 1024px)

### Accessibility Testing

- [ ] All text meets WCAG AAA contrast (21:1 or 7:1)
- [ ] Focus indicators visible
- [ ] Touch targets ≥44px
- [ ] Forms have clear labels
- [ ] Error messages readable

---

## Phase 9: Cleanup

### Remove Old Files

**Once migration complete, DELETE:**

```
src/core/global.css          → DELETE (replaced by global-v2.css)
src/core/components.css      → DELETE (replaced by components-v2.css)
src/core/marble.css          → DELETE (no textures)
src/core/elevation.css       → DELETE (minimal shadows only)
docs/DESIGN_SYSTEM.md        → ARCHIVE (replaced by DESIGN_SYSTEM_V2.md)
```

### Rename V2 Files

**Final structure:**

```
src/core/global.css          (was global-v2.css)
src/core/components.css      (was components-v2.css)
docs/DESIGN_SYSTEM.md        (was DESIGN_SYSTEM_V2.md)
```

---

## Common Pitfalls

### ❌ Don't Do This

```css
/* DON'T - Adding color accents */
color: #8b5cf6;  /* Purple - NO */

/* DON'T - Using gradients */
background: linear-gradient(...);  /* NO */

/* DON'T - Heavy shadows */
box-shadow: 0 10px 40px rgba(0,0,0,0.3);  /* NO */

/* DON'T - Rounded corners */
border-radius: 16px;  /* NO */

/* DON'T - Decorative fonts */
font-family: 'Playfair Display', serif;  /* NO */
```

### ✅ Do This Instead

```css
/* DO - Pure monochrome */
color: var(--text-primary);  /* Black */

/* DO - Solid colors */
background-color: var(--bg-secondary);

/* DO - Minimal shadows */
box-shadow: var(--shadow-subtle);

/* DO - Sharp corners */
border-radius: var(--radius-none);

/* DO - Geometric sans */
font-family: var(--font-primary);  /* Helvetica */
```

---

## Migration Timeline

### Week 1: Foundation
- [ ] Add new CSS files
- [ ] Test theme switching
- [ ] Audit color usage

### Week 2: Components
- [ ] Migrate buttons
- [ ] Migrate cards
- [ ] Migrate forms
- [ ] Migrate navigation

### Week 3: Pages
- [ ] Update Home page
- [ ] Update Project pages
- [ ] Update Creation flows
- [ ] Update Admin pages

### Week 4: Polish
- [ ] Accessibility audit
- [ ] Cross-browser testing
- [ ] Mobile responsive testing
- [ ] Performance optimization
- [ ] Remove old CSS files

---

## Support

**Questions?**
- Refer to `DESIGN_SYSTEM_V2.md` for complete token reference
- Check `docs/examples/brutalist-demo.html` for live examples
- Review `components-v2.css` for implementation patterns

**Philosophy Alignment:**
- Every removed element = removed opportunity for deception
- Sharp edges = refusal to soften hard truths
- Grid alignment = commitment to order
- Monochrome = rejection of manipulation

**We don't make things pretty. We make things clear.**

---

*Migration Guide V1*
*Last Updated: 2026-02-18*
