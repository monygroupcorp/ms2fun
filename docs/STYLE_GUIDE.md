# Style Guide: Temple of Capital Design System

**Version 2.0** | **Status: Production** | **Last Updated: 2024**

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [File Structure](#file-structure)
3. [Color System](#color-system)
4. [Typography System](#typography-system)
5. [Spacing System](#spacing-system)
6. [Elevation & Shadow System](#elevation--shadow-system)
7. [Component Library](#component-library)
8. [Theme System](#theme-system)
9. [Accessibility](#accessibility)
10. [CULT EXEC Protection](#cult-exec-protection)
11. [Usage Examples](#usage-examples)
12. [Best Practices](#best-practices)

---

## Design Philosophy

**"Temple of Capital"** - A design system that evokes the majesty of classical architecture (temples, Roman master architecture, Greek revivalism, massive columns, marble) combined with the sleek professionalism of Art Deco and killer capitalism.

### Core Aesthetic Principles

1. **Classical Grandeur**: Grand scale, symmetry, classical proportions, marble textures
2. **Art Deco Luxury**: Geometric patterns, metallic accents, bold lines, sophisticated elegance
3. **Modern Professionalism**: Clean execution, premium feel, killer capitalism aesthetic
4. **Sacred Spaces**: The Pantheon, the Duomo - places of worship and power

---

## File Structure

### Core Stylesheets (Load Order Matters)

```
index.html
├── src/core/global.css          # Design tokens, base styles
├── src/core/theme.css           # Theme toggle button
├── src/core/elevation.css       # Elevation utility classes
├── src/core/components.css     # Standardized components
├── style.css                    # Launchpad-specific styles
└── [Route-specific CSS]         # Loaded dynamically
```

### Key Files

- **`src/core/global.css`**: All design tokens (colors, typography, spacing, shadows, elevation)
- **`src/core/components.css`**: Standardized button, card, form, modal components
- **`src/core/elevation.css`**: Elevation utility classes and depth hierarchy
- **`src/core/theme.css`**: Theme toggle button styles
- **`src/core/theme.js`**: Theme management system
- **`src/routes/cultexecs.css`**: CULT EXEC styles (FROZEN - never modify)

---

## Color System

### Primary Palette: Marble & Stone

```css
/* Marble Whites & Creams */
--marble-white: #faf9f7;        /* Pure marble white */
--marble-cream: #f5f3f0;        /* Warm cream marble */
--marble-ivory: #f0ede8;        /* Ivory marble */
--marble-vein: #e8e5e0;         /* Subtle marble veining */

/* Classical Stone */
--stone-warm: #d4c5b9;          /* Warm beige stone */
--stone-terracotta: #c9a882;    /* Terracotta */
--stone-ochre: #b89d7a;         /* Golden ochre */
--stone-sand: #e6ddd4;          /* Sandstone */
--stone-deep: #8b7a6b;          /* Deep stone */
--stone-shadow: #6b5d4f;        /* Stone shadow */
--stone-charcoal: #4a4038;      /* Charcoal stone */
```

### Art Deco & Luxury Metals

```css
/* Metallic Accents */
--gold-primary: #d4af37;         /* Classic gold */
--gold-burnished: #b8941f;      /* Burnished gold */
--gold-light: #e8d5a3;          /* Light gold */
--bronze: #cd7f32;               /* Bronze */
--bronze-dark: #a66d28;          /* Dark bronze */
--copper: #b87333;               /* Copper accent */
```

### Semantic Colors

```css
/* Success - Emerald Green */
--success-500: #4caf50;
--success-600: #43a047;
--success-700: #388e3c;

/* Warning - Amber Gold */
--warning-500: #ffc107;
--warning-600: #ffb300;
--warning-700: #ffa000;

/* Error - Terracotta Red */
--error-500: #f44336;
--error-600: #e53935;
--error-700: #d32f2f;

/* Info - Deep Blue (Lapis Lazuli) */
--info-500: #2196f3;
--info-600: #1e88e5;
--info-700: #1976d2;
```

### Theme-Aware Colors

**Light Theme (Default):**
```css
--text-primary: #2d2d2d;         /* Deep charcoal */
--text-secondary: #4a4a4a;      /* Medium gray */
--text-muted: #9e9e9e;          /* Very light gray */
--text-inverse: #faf9f7;        /* Marble white */

--bg-primary: #faf9f7;          /* Marble white */
--bg-secondary: #f5f3f0;        /* Marble cream */
--bg-elevated: #ffffff;          /* Pure white for cards */
```

**Dark Theme:**
```css
--text-primary: #faf9f7;        /* Marble white */
--text-secondary: #e8e5e0;      /* Light marble */
--text-muted: #9e9e9e;         /* Neutral gray */
--text-inverse: #2d2d2d;       /* Dark for light elements */

--bg-primary: #1a1a1a;         /* Deep black */
--bg-secondary: #2d2d2d;        /* Charcoal */
--bg-elevated: #2d2d2d;         /* Elevated dark surface */
```

---

## Typography System

### Font Families

```css
/* Primary Font - RedHatTextVar (Used for everything) */
--font-heading: 'RedHatTextVar', sans-serif;
--font-body: 'RedHatTextVar', sans-serif;
--font-accent: 'Bebas Neue', 'Oswald', sans-serif;  /* Art Deco accent */
--font-mono: 'Courier New', 'Monaco', monospace;
```

### Type Scale

```css
--font-size-display-1: 4.5rem;   /* 72px - Grand scale */
--font-size-display-2: 3.75rem;  /* 60px */
--font-size-display-3: 3rem;    /* 48px */
--font-size-h1: 3.5rem;         /* 56px - Temple scale */
--font-size-h2: 2.75rem;         /* 44px */
--font-size-h3: 2.25rem;         /* 36px */
--font-size-h4: 1.75rem;         /* 28px */
--font-size-h5: 1.5rem;          /* 24px */
--font-size-body: 1rem;          /* 16px */
--font-size-body-lg: 1.125rem;   /* 18px */
--font-size-body-sm: 0.875rem;   /* 14px */
--font-size-small: 0.75rem;      /* 12px */
```

### Font Weights

```css
--font-weight-light: 300;
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
```

### Line Heights

```css
--line-height-tight: 1.2;       /* Headings */
--line-height-normal: 1.5;      /* Body text */
--line-height-relaxed: 1.6;     /* Comfortable reading */
```

---

## Spacing System

### Base Unit: 4px (Classical Grid)

All spacing uses multiples of 4px for consistency and alignment.

```css
--spacing-0: 0;
--spacing-1: 0.25rem;    /* 4px */
--spacing-2: 0.5rem;     /* 8px */
--spacing-3: 0.75rem;    /* 12px */
--spacing-4: 1rem;       /* 16px */
--spacing-5: 1.25rem;    /* 20px */
--spacing-6: 1.5rem;     /* 24px */
--spacing-8: 2rem;       /* 32px */
--spacing-10: 2.5rem;    /* 40px */
--spacing-12: 3rem;      /* 48px */
--spacing-16: 4rem;      /* 64px */
--spacing-20: 5rem;      /* 80px */
--spacing-24: 6rem;      /* 96px */
--spacing-32: 8rem;      /* 128px */
```

### Section Spacing (Classical Proportions)

```css
--section-spacing-sm: var(--spacing-16);   /* 64px */
--section-spacing-md: var(--spacing-24);  /* 96px */
--section-spacing-lg: var(--spacing-32);   /* 128px */
--section-spacing-xl: var(--spacing-40);   /* 160px */
```

---

## Elevation & Shadow System

### Elevation Levels (Like Carved Stone Reliefs)

The elevation system creates depth hierarchy, like carved stone reliefs. Each level represents depth from the surface.

```css
/* Elevation 0 - Flat (No shadow, on surface) */
--elevation-0: none;

/* Elevation 1 - Subtle (Like marble surface texture) */
--elevation-1: 0 1px 2px 0 rgba(26, 26, 26, 0.05),
               0 1px 3px 0 rgba(26, 26, 26, 0.08);

/* Elevation 2 - Base (Like raised stone, cards, buttons) */
--elevation-2: 0 2px 4px 0 rgba(26, 26, 26, 0.08),
               0 1px 2px 0 rgba(26, 26, 26, 0.1);

/* Elevation 3 - Medium (Like carved relief, hover states) */
--elevation-3: 0 4px 8px -1px rgba(26, 26, 26, 0.1),
               0 2px 4px -1px rgba(26, 26, 26, 0.06),
               0 1px 2px 0 rgba(26, 26, 26, 0.08);

/* Elevation 4 - High (Like deep carving, modals, dropdowns) */
--elevation-4: 0 10px 20px -2px rgba(26, 26, 26, 0.12),
               0 4px 8px -2px rgba(26, 26, 26, 0.08),
               0 2px 4px -1px rgba(26, 26, 26, 0.06);

/* Elevation 5 - Maximum (Like temple columns, major modals) */
--elevation-5: 0 20px 40px -4px rgba(26, 26, 26, 0.15),
               0 10px 20px -4px rgba(26, 26, 26, 0.1),
               0 4px 8px -2px rgba(26, 26, 26, 0.08);
```

### Special Shadows

```css
/* Gold Glow - For accent elements, buttons, highlights */
--shadow-gold: 0 4px 14px 0 rgba(212, 175, 55, 0.15),
               0 0 0 1px rgba(212, 175, 55, 0.1),
               0 2px 4px 0 rgba(212, 175, 55, 0.08);

/* Marble Texture - Subtle depth with highlight */
--shadow-marble: 0 2px 8px rgba(26, 26, 26, 0.08),
                 0 1px 3px rgba(26, 26, 26, 0.12),
                 inset 0 1px 0 rgba(255, 255, 255, 0.1);

/* Column Shadow - Deep, architectural depth */
--shadow-column: 0 8px 32px rgba(26, 26, 26, 0.12),
                 0 2px 8px rgba(26, 26, 26, 0.08),
                 0 1px 2px rgba(26, 26, 26, 0.06);
```

### Elevation Usage Guidelines

| Component | Base Elevation | Hover Elevation | Active Elevation |
|-----------|---------------|-----------------|------------------|
| Buttons | 2 | 3 (or gold glow) | 1 |
| Cards | 2 | 3 | - |
| Modals | 5 | - | - |
| Dropdowns | 4 | - | - |
| Tooltips | 3 | - | - |
| Toasts | 4 | - | - |

### Utility Classes

```css
/* Direct elevation application */
.elevation-0 { box-shadow: var(--elevation-0); }
.elevation-1 { box-shadow: var(--elevation-1); }
.elevation-2 { box-shadow: var(--elevation-2); }
.elevation-3 { box-shadow: var(--elevation-3); }
.elevation-4 { box-shadow: var(--elevation-4); }
.elevation-5 { box-shadow: var(--elevation-5); }

/* Hover elevation changes */
.elevation-hover-3:hover { box-shadow: var(--elevation-3); }

/* Focus elevation changes */
.elevation-focus-2:focus-visible { box-shadow: var(--elevation-2); }
```

---

## Component Library

### Buttons

#### Base Button Class

```html
<button class="btn btn-primary">Primary Button</button>
<button class="btn btn-secondary">Secondary Button</button>
<button class="btn btn-outline">Outline Button</button>
<button class="btn btn-ghost">Ghost Button</button>
```

#### Button Sizes

```html
<button class="btn btn-primary btn-sm">Small</button>
<button class="btn btn-primary btn-md">Medium</button>
<button class="btn btn-primary btn-lg">Large</button>
```

#### Button States

- **Base**: Elevation 2
- **Hover**: Elevation 3 (or gold glow for primary)
- **Active**: Elevation 1
- **Focus**: Gold outline (2px solid, 2px offset)
- **Disabled**: 60% opacity, no pointer events

### Cards

#### Base Card

```html
<div class="card">
    <div class="card-header">
        <h3 class="card-title">Card Title</h3>
    </div>
    <div class="card-body">
        <p class="card-description">Card content...</p>
    </div>
    <div class="card-footer">
        <button class="btn btn-primary">Action</button>
    </div>
</div>
```

#### Card Elevation

- **Base**: Elevation 2
- **Hover**: Elevation 3
- **Clickable Cards**: Add `role="button"` or `tabindex` for focus states

### Forms

#### Form Inputs

```html
<div class="form-group">
    <label class="form-label required">Email</label>
    <input type="email" class="form-input" placeholder="Enter email">
    <span class="form-help">We'll never share your email</span>
</div>
```

#### Form States

- **Base**: Border with `--border-base` color
- **Focus**: Gold border + gold shadow
- **Error**: Red border (`--error-500`)
- **Disabled**: Gray background, muted text

### Modals

#### Modal Structure

```html
<div class="modal-backdrop">
    <div class="modal">
        <div class="modal-header">
            <h2 class="modal-title">Modal Title</h2>
            <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
            <!-- Content -->
        </div>
        <div class="modal-footer">
            <!-- Actions -->
        </div>
    </div>
</div>
```

#### Modal Elevation

- **Modal**: Elevation 5 (maximum depth)
- **Backdrop**: Dark overlay with blur

---

## Theme System

### Light/Dark Mode

The theme system allows users to switch between light and dark modes on launchpad pages only. CULT EXEC pages are completely isolated.

### Theme Toggle

The theme toggle button appears in the top-right corner on all launchpad pages. It's automatically hidden on CULT EXEC pages.

### Using Themes

```javascript
// Get current theme
const currentTheme = window.themeManager?.getTheme(); // 'light' or 'dark'

// Set theme programmatically
window.themeManager?.setTheme('dark');

// Toggle theme
window.themeManager?.toggle();

// Listen for theme changes
window.addEventListener('themechange', (e) => {
    console.log('Theme changed to:', e.detail.theme);
});
```

### Theme-Aware Styling

All design tokens automatically adjust based on the current theme. Use CSS variables instead of hardcoded colors:

```css
/* ✅ Good - Theme-aware */
.my-element {
    background: var(--bg-elevated);
    color: var(--text-primary);
}

/* ❌ Bad - Hardcoded colors */
.my-element {
    background: #ffffff;
    color: #000000;
}
```

---

## Accessibility

### Focus States

All interactive elements have visible focus states using the gold accent color:

```css
/* Standard focus style */
:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
}
```

### Keyboard Navigation

- **Tab Order**: Logical tab order for all interactive elements
- **Skip Links**: `.skip-link` class available for main content navigation
- **Focus Trapping**: Modals trap focus within their boundaries

### Color Contrast

All color combinations meet WCAG AA standards:
- Text on light backgrounds: Minimum 4.5:1 contrast
- Text on dark backgrounds: Minimum 4.5:1 contrast
- Large text (18px+): Minimum 3:1 contrast

### Screen Reader Support

- Semantic HTML elements
- ARIA labels where needed
- Proper heading hierarchy

---

## CULT EXEC Protection

### Frozen Styles

The CULT EXEC page (`/cultexecs`) has **cryogenically frozen** styles that must never be modified:

- **File**: `src/routes/cultexecs.css`
- **Scope**: All styles scoped to `body.cultexecs-active`
- **Font**: Always `Courier New, monospace`
- **Theme**: Always dark, never affected by theme switching
- **Isolation**: Complete isolation from global styles

### Protection Mechanisms

1. **CSS Scoping**: All CULT EXEC styles use `body.cultexecs-active` selector
2. **Theme Isolation**: Theme system never applies to CULT EXEC pages
3. **Toggle Hiding**: Theme toggle automatically removed on CULT EXEC pages
4. **Variable Isolation**: CULT EXEC has its own CSS variables

### Testing Checklist

Before deploying, verify:
- [ ] CULT EXEC page renders identically
- [ ] Terminal theme remains unchanged
- [ ] Dark background preserved
- [ ] Yellow accent (#fdb523) preserved
- [ ] Monospace font preserved
- [ ] Theme toggle not visible
- [ ] No style leakage from global styles

---

## Usage Examples

### Creating a Button

```html
<!-- Primary button with gold accent -->
<button class="btn btn-primary">
    Connect Wallet
</button>

<!-- Secondary button -->
<button class="btn btn-secondary">
    Cancel
</button>

<!-- Outline button -->
<button class="btn btn-outline">
    Learn More
</button>
```

### Creating a Card

```html
<div class="card">
    <div class="card-header">
        <h3 class="card-title">Project Name</h3>
        <span class="card-badge featured">Featured</span>
    </div>
    <div class="card-body">
        <p class="card-description">Project description...</p>
    </div>
    <div class="card-footer">
        <button class="btn btn-primary">View Project</button>
    </div>
</div>
```

### Creating a Form

```html
<form>
    <div class="form-group">
        <label class="form-label required">Project Name</label>
        <input type="text" class="form-input" placeholder="Enter project name">
        <span class="form-help">Choose a unique name for your project</span>
    </div>
    
    <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" rows="4" placeholder="Describe your project"></textarea>
    </div>
    
    <button type="submit" class="btn btn-primary">Create Project</button>
</form>
```

### Applying Elevation

```html
<!-- Direct elevation class -->
<div class="elevation-3">Content with elevation 3</div>

<!-- Elevation on hover -->
<div class="elevation-2 elevation-hover-4">Hover to raise</div>

<!-- Using CSS variable -->
<div style="box-shadow: var(--elevation-4);">Custom elevation</div>
```

---

## Best Practices

### 1. Always Use Design Tokens

```css
/* ✅ Good */
.my-component {
    padding: var(--spacing-4);
    color: var(--text-primary);
    box-shadow: var(--elevation-2);
}

/* ❌ Bad */
.my-component {
    padding: 16px;
    color: #2d2d2d;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
```

### 2. Use Component Classes

```html
<!-- ✅ Good - Uses standardized components -->
<button class="btn btn-primary">Click Me</button>

<!-- ❌ Bad - Custom button styles -->
<button style="background: gold; padding: 10px;">Click Me</button>
```

### 3. Respect Elevation Hierarchy

- **Buttons**: Elevation 2 → 3 on hover
- **Cards**: Elevation 2 → 3 on hover
- **Modals**: Elevation 5 (always highest)
- **Dropdowns**: Elevation 4

### 4. Theme-Aware Colors

Always use theme-aware color variables:

```css
/* ✅ Good - Theme-aware */
.element {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-color: var(--border-base);
}

/* ❌ Bad - Hardcoded */
.element {
    background: #ffffff;
    color: #000000;
    border-color: #e0e0e0;
}
```

### 5. Consistent Spacing

Use the spacing scale consistently:

```css
/* ✅ Good - Uses spacing scale */
.container {
    padding: var(--spacing-6);
    gap: var(--spacing-4);
}

/* ❌ Bad - Arbitrary values */
.container {
    padding: 23px;
    gap: 17px;
}
```

### 6. Focus States

Always include focus states for accessibility:

```css
.interactive-element:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
}
```

### 7. Responsive Design

Use breakpoints and responsive spacing:

```css
@media (max-width: 768px) {
    .component {
        padding: var(--spacing-4);
    }
}
```

---

## Component Reference

### Button Variants

| Class | Use Case | Elevation |
|------|----------|-----------|
| `.btn-primary` | Primary actions, CTAs | 2 → Gold glow on hover |
| `.btn-secondary` | Secondary actions | 2 → 3 on hover |
| `.btn-outline` | Tertiary actions | 2 → Gold glow on hover |
| `.btn-ghost` | Subtle actions | 0 → 2 on hover |

### Card Types

| Class | Use Case | Elevation |
|------|----------|-----------|
| `.card` | Standard content card | 2 → 3 on hover |
| `.card-uniform` | Grid cards (uniform height) | 2 → 3 on hover |
| `.card-marble` | Premium cards with marble texture | 2 → 3 on hover |

### Form Elements

| Element | Class | States |
|---------|-------|--------|
| Input | `.form-input` | Base, Focus (gold), Error, Disabled |
| Textarea | `.form-textarea` | Base, Focus (gold), Error, Disabled |
| Select | `.form-select` | Base, Focus (gold), Error, Disabled |
| Label | `.form-label` | Standard, `.required` for required fields |

---

## Migration Guide

### From Old Styles to New System

1. **Replace hardcoded colors** with design tokens
2. **Replace hardcoded spacing** with spacing scale
3. **Replace custom shadows** with elevation system
4. **Use component classes** instead of custom styles
5. **Add focus states** to all interactive elements

### Example Migration

```css
/* Old Style */
.old-button {
    background: #d4af37;
    padding: 12px 24px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* New Style */
.new-button {
    /* Use component class */
    /* <button class="btn btn-primary">Button</button> */
    
    /* Or extend with tokens */
    background: var(--accent-primary);
    padding: var(--button-padding-y-md) var(--button-padding-x-lg);
    box-shadow: var(--elevation-2);
}
```

---

## Troubleshooting

### Theme Not Working

- Check that `theme.js` is loaded before other scripts
- Verify `data-theme` attribute is set on `<html>` element
- Ensure you're not on CULT EXEC page (theme disabled there)

### Elevation Not Visible

- Check if element has `background-color` set (shadows need background)
- Verify elevation variable is being used correctly
- Check dark theme - shadows are darker/more visible

### Styles Not Applying

- Verify CSS load order in `index.html`
- Check for CSS specificity conflicts
- Ensure you're using `:not(.cultexecs-active)` for launchpad-only styles

### CULT EXEC Styles Leaking

- Verify all global styles use `body:not(.cultexecs-active)` selector
- Check that CULT EXEC styles use `body.cultexecs-active` selector
- Test CULT EXEC page after any global style changes

---

## Resources

- **Design System**: `DESIGN_SYSTEM.md`
- **Styling Inventory**: `STYLING_INVENTORY.md`
- **Protection Plan**: `STYLING_PROTECTION_PLAN.md`
- **Technical Docs**: `TECHNICAL_DOCUMENTATION.md`

---

**Design System: Temple of Capital**  
**Version 2.0** | **Status: Production**  
*Built with classical grandeur and modern professionalism*

