# Design System V2: Gallery Brutalism

**Philosophy:** Museum precision meets digital honesty

**Mission:** Reform crypto aesthetics. Maximum trust through maximum clarity.

**Audience:** Artists, collectors, Ethereum priest class

---

## Core Principles

1. **Honesty**: No decoration. No tricks. True materials only.
2. **Clarity**: Information hierarchy through typography, not color.
3. **Restraint**: Pure black and white. No accent colors.
4. **Discipline**: 8px grid. Everything aligns.
5. **Authority**: Museum-grade presentation. Not a casino.

**Forbidden:**
- ❌ Gradients
- ❌ Shadows (except minimal separation)
- ❌ Rounded corners (2px max)
- ❌ Color accents (except chromatic aberration)
- ❌ Blur/glassmorphism
- ❌ Textures
- ❌ Glows
- ❌ Decoration of any kind

### The Exception: Chromatic Aberration

**"Light peaking through the brutal system"**

Strategic use of RGB split effect adds prismatic sophistication without breaking monochrome discipline.

**The Rule:**
- **Large text (headings, display)**: Apply to TEXT — creates trippy, bold statement
- **Small text (buttons, UI)**: Apply to SHAPE/BACKGROUND — keeps text crisp, edges prismatic
- **Never apply to body copy** — visual chaos

**Why this works:**
Chromatic aberration on small text = disorienting (used in games to convey discomfort). Solution: apply prismatic effect to button shapes, stat boxes, containers. Text stays sharp and readable.

**Applications:**
- ✅ Primary CTA buttons — chromatic box-shadow on button (auto-applied)
- ✅ Hero titles — chromatic text-shadow (extreme strength)
- ✅ Display stats — chromatic text-shadow (strong)
- ❌ Body text, small UI text — never

**Strength Levels:**
```css
.text-chromatic-medium   /* 2px — Subtle bold text */
.text-chromatic-strong   /* 3px — Trippy headings */
.text-chromatic-extreme  /* 4px — Maximum impact */
.text-chromatic-ultra    /* 6px — Full prism */
```

**Button Implementation:**
```css
/* Chromatic on button SHAPE, not text */
box-shadow:
  -3px 0 0 rgba(255, 0, 128, 0.7),  /* Pink left */
  3px 0 0 rgba(0, 255, 255, 0.7);   /* Cyan right */
```

**Philosophy:** The only "color" we allow is the color spectrum itself—refracted light breaking through the monochrome. It's not decoration; it's physics. And it's applied strategically: big = trippy text, small = sharp text with prismatic edges.

---

## Color System

### Pure Monochrome

**Light Mode (Primary):**
```css
/* Backgrounds */
--bg-primary: #ffffff;           /* Pure white - gallery walls */
--bg-secondary: #fafafa;         /* Subtle gray - elevated surfaces */
--bg-tertiary: #f5f5f5;          /* Light gray - subtle distinction */

/* Text */
--text-primary: #000000;         /* Pure black - maximum contrast */
--text-secondary: #666666;       /* Medium gray - secondary information */
--text-tertiary: #999999;        /* Light gray - tertiary information */
--text-disabled: #cccccc;        /* Disabled state */

/* Borders */
--border-primary: #000000;       /* Black - strong definition */
--border-secondary: #e0e0e0;     /* Light gray - subtle separation */
--border-tertiary: #f0f0f0;      /* Very light gray - minimal separation */

/* Semantic (NO color - use text/borders only) */
--semantic-error: #000000;       /* Black text for errors */
--semantic-success: #000000;     /* Black text for success */
--semantic-warning: #000000;     /* Black text for warnings */
```

**Dark Mode:**
```css
/* Backgrounds */
--bg-primary: #000000;           /* Pure black */
--bg-secondary: #0a0a0a;         /* Subtle lift */
--bg-tertiary: #141414;          /* Light lift */

/* Text */
--text-primary: #ffffff;         /* Pure white */
--text-secondary: #999999;       /* Medium gray */
--text-tertiary: #666666;        /* Dark gray */
--text-disabled: #333333;        /* Disabled state */

/* Borders */
--border-primary: #ffffff;       /* White - strong definition */
--border-secondary: #1a1a1a;     /* Dark gray - subtle separation */
--border-tertiary: #0f0f0f;      /* Very dark gray - minimal separation */

/* Semantic (NO color - use text/borders only) */
--semantic-error: #ffffff;       /* White text for errors */
--semantic-success: #ffffff;     /* White text for success */
--semantic-warning: #ffffff;     /* White text for warnings */
```

**States:**
```css
/* Interactive States (Light Mode) */
--state-hover-bg: #f5f5f5;       /* Subtle gray on hover */
--state-active-bg: #e0e0e0;      /* Medium gray on active */
--state-focus-outline: #000000;  /* Black focus ring */

/* Interactive States (Dark Mode) */
--state-hover-bg: #1a1a1a;       /* Subtle lift on hover */
--state-active-bg: #2a2a2a;      /* Medium lift on active */
--state-focus-outline: #ffffff;  /* White focus ring */
```

---

## Typography System

### Font Families

```css
/* Primary - Geometric Sans */
--font-primary: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;

/* Monospace - Data/Addresses */
--font-mono: 'IBM Plex Mono', 'Courier New', 'Courier', monospace;

/* System Fallback */
--font-system: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Usage:**
- **Helvetica**: All headings, body text, UI elements
- **IBM Plex Mono**: Addresses, hashes, numbers (tabular data)
- **NO decorative fonts**
- **NO script fonts**
- **NO serif fonts** (except for specific editorial content if needed)

### Type Scale (Strict Modular Scale - 1.333 ratio)

```css
/* Display (Rare - Hero sections only) */
--font-size-display: 4.5rem;     /* 72px */

/* Headings */
--font-size-h1: 3rem;            /* 48px */
--font-size-h2: 2.25rem;         /* 36px */
--font-size-h3: 1.5rem;          /* 24px */
--font-size-h4: 1.125rem;        /* 18px */

/* Body */
--font-size-body-lg: 1.125rem;   /* 18px - Comfortable reading */
--font-size-body: 1rem;          /* 16px - Standard body */
--font-size-body-sm: 0.875rem;   /* 14px - Small text */
--font-size-caption: 0.75rem;    /* 12px - Captions, labels */
```

### Font Weights

```css
--font-weight-light: 300;
--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-bold: 700;
```

**Usage Rules:**
- Display/H1: Bold (700)
- H2/H3: Medium (500) or Bold (700)
- Body: Regular (400)
- Captions: Regular (400) or Light (300)
- **NO decorative weights**
- **Hierarchy through size and weight ONLY**

### Line Heights

```css
--line-height-tight: 1.2;        /* Headings */
--line-height-normal: 1.5;       /* Body text */
--line-height-relaxed: 1.75;     /* Comfortable reading */
```

### Letter Spacing

```css
--letter-spacing-tight: -0.02em; /* Large headings */
--letter-spacing-normal: 0;      /* Body text */
--letter-spacing-wide: 0.05em;   /* All caps text */
```

**Usage:**
- Large headings (H1, Display): Tight (-0.02em)
- Body text: Normal (0)
- ALL CAPS labels: Wide (0.05em)

---

## Spacing System

### 8px Grid System

**Everything aligns to 8px grid. No exceptions.**

```css
/* Base Unit: 8px */
--space-0: 0;
--space-1: 0.5rem;    /* 8px */
--space-2: 1rem;      /* 16px */
--space-3: 1.5rem;    /* 24px */
--space-4: 2rem;      /* 32px */
--space-5: 2.5rem;    /* 40px */
--space-6: 3rem;      /* 48px */
--space-8: 4rem;      /* 64px */
--space-10: 5rem;     /* 80px */
--space-12: 6rem;     /* 96px */
--space-16: 8rem;     /* 128px */
--space-20: 10rem;    /* 160px */
--space-24: 12rem;    /* 192px */
```

### Component Spacing

```css
/* Padding (Internal spacing) */
--padding-sm: var(--space-2);    /* 16px */
--padding-md: var(--space-3);    /* 24px */
--padding-lg: var(--space-4);    /* 32px */
--padding-xl: var(--space-6);    /* 48px */

/* Gap (Space between elements) */
--gap-sm: var(--space-1);        /* 8px */
--gap-md: var(--space-2);        /* 16px */
--gap-lg: var(--space-3);        /* 24px */
--gap-xl: var(--space-4);        /* 32px */

/* Section Spacing (Vertical rhythm) */
--section-spacing-sm: var(--space-8);   /* 64px */
--section-spacing-md: var(--space-12);  /* 96px */
--section-spacing-lg: var(--space-16);  /* 128px */
--section-spacing-xl: var(--space-20);  /* 160px */
```

---

## Layout System

### Container Widths

```css
--container-sm: 40rem;      /* 640px - Narrow content */
--container-md: 48rem;      /* 768px - Standard content */
--container-lg: 64rem;      /* 1024px - Wide content */
--container-xl: 75rem;      /* 1200px - Maximum content width */
--container-full: 100%;
```

**Usage:**
- Articles/reading: `--container-md` (768px)
- Data tables: `--container-lg` (1024px)
- Gallery grids: `--container-xl` (1200px)
- **Generous side margins**: 80px minimum (--space-10)

### Grid System

```css
--grid-columns: 12;
--grid-gap: var(--space-3);  /* 24px */
```

**Layout Rules:**
- 12-column grid
- 24px gutters
- Everything snaps to grid
- Generous whitespace = luxury

### Breakpoints

```css
--breakpoint-sm: 640px;
--breakpoint-md: 768px;
--breakpoint-lg: 1024px;
--breakpoint-xl: 1280px;
```

---

## Border System

### Border Widths

```css
--border-width-thin: 1px;    /* Standard borders */
--border-width-thick: 2px;   /* Emphasis */
--border-width-bold: 4px;    /* Strong emphasis (rare) */
```

### Border Radius

```css
--radius-none: 0;            /* Preferred - sharp corners */
--radius-sm: 2px;            /* Minimal - barely visible */
```

**Usage:**
- **Default: 0 (sharp corners)** - Most brutalist
- **Rare exceptions: 2px** - Only for buttons/inputs if needed for usability
- **NEVER use**: Rounded, pill shapes, circles (unless avatars)

---

## Shadow System

### Elevation (Minimal)

**Shadows are nearly invisible. Used only for subtle separation.**

```css
/* Light Mode */
--shadow-none: none;
--shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
--shadow-md: 0 2px 4px rgba(0, 0, 0, 0.08);

/* Dark Mode */
--shadow-none: none;
--shadow-subtle: 0 1px 2px rgba(255, 255, 255, 0.02);
--shadow-sm: 0 1px 3px rgba(255, 255, 255, 0.04);
--shadow-md: 0 2px 4px rgba(255, 255, 255, 0.06);
```

**Usage:**
- **Prefer borders over shadows** for separation
- Shadows only when absolutely necessary
- Keep opacity very low (barely visible)
- Maximum: `--shadow-md` (never heavier)

---

## Animation & Transitions

### Timing Functions

```css
--ease-standard: cubic-bezier(0.4, 0.0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0.0, 1, 1);
--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
```

### Durations

```css
--duration-instant: 0ms;
--duration-fast: 100ms;
--duration-base: 200ms;
--duration-slow: 300ms;
```

### Transitions

```css
--transition-base: all var(--duration-base) var(--ease-standard);
--transition-fast: all var(--duration-fast) var(--ease-standard);
--transition-color: color var(--duration-base) var(--ease-standard);
--transition-opacity: opacity var(--duration-base) var(--ease-standard);
```

**Allowed Animations:**
- Opacity changes (fade in/out)
- Position shifts (1-2px translateY for active states)
- Color transitions (text/background)

**Forbidden:**
- ❌ Scale transforms
- ❌ Rotation
- ❌ Complex keyframe animations
- ❌ Bounces, eases, or "fun" effects

---

## Component Patterns

### Buttons

**Hierarchy:**
- **Primary**: Black background, white text (light mode) / White background, black text (dark mode)
- **Secondary**: White background, black border, black text (light mode) / Black background, white border, white text (dark mode)
- **Ghost**: Transparent, black text, no border (light mode) / Transparent, white text, no border (dark mode)

**Specs:**
```css
/* Sizing */
--button-height-sm: 2rem;      /* 32px */
--button-height-md: 2.5rem;    /* 40px */
--button-height-lg: 3rem;      /* 48px */

/* Padding */
--button-padding-x: var(--space-3);  /* 24px */
--button-padding-y: var(--space-2);  /* 16px */

/* Typography */
font-family: var(--font-primary);
font-size: var(--font-size-body);
font-weight: var(--font-weight-medium);
text-transform: uppercase;
letter-spacing: var(--letter-spacing-wide);

/* Shape */
border-radius: var(--radius-none);  /* Sharp corners */
border-width: var(--border-width-thin);

/* States */
hover: opacity 0.7;
active: translateY(1px);
focus: 2px solid outline;
```

### Cards

**Specs:**
```css
/* Background */
background: var(--bg-secondary);  /* Subtle gray elevation */

/* Border */
border: 1px solid var(--border-secondary);
border-radius: var(--radius-none);  /* Sharp corners */

/* Padding */
padding: var(--padding-lg);  /* 32px */

/* Shadow */
box-shadow: var(--shadow-subtle);  /* Barely visible */

/* Hover (if interactive) */
hover: background var(--state-hover-bg);
```

### Forms

**Input Fields:**
```css
/* Sizing */
height: 3rem;  /* 48px - comfortable */
padding: var(--space-2);  /* 16px */

/* Typography */
font-family: var(--font-primary);
font-size: var(--font-size-body);

/* Border */
border: 1px solid var(--border-secondary);
border-radius: var(--radius-sm);  /* 2px - minimal */

/* Focus */
outline: 2px solid var(--border-primary);
```

**Labels:**
```css
font-size: var(--font-size-body-sm);
font-weight: var(--font-weight-medium);
text-transform: uppercase;
letter-spacing: var(--letter-spacing-wide);
color: var(--text-secondary);
```

### Data Display

**Tables:**
- Monospace for numbers (`--font-mono`)
- Right-align numeric columns
- 1px borders between rows
- Zebra striping (subtle gray: `--bg-tertiary`)
- Generous padding (16px)

**Stats/Metrics:**
- Large numbers (H2 or H1 size)
- Monospace font
- Labels in uppercase (caption size)
- Clear hierarchy

---

## Z-Index Scale

```css
--z-base: 0;
--z-dropdown: 100;
--z-sticky: 200;
--z-modal-backdrop: 300;
--z-modal: 400;
--z-tooltip: 500;
```

---

## Accessibility

### Focus States

**All interactive elements MUST have visible focus:**
```css
outline: 2px solid var(--state-focus-outline);
outline-offset: 2px;
```

### Contrast Ratios

**All text meets WCAG AAA:**
- Black on white: 21:1 (maximum contrast)
- Dark gray on white: 7:1 minimum
- Light gray on black: 7:1 minimum

### Text Size

**Minimum readable sizes:**
- Body text: 16px minimum
- Captions: 12px minimum (use sparingly)
- Interactive elements: 44px touch target minimum

---

## Implementation Status

### ✅ Phase 1: Foundation
- [ ] Create new global.css with tokens
- [ ] Create component base styles
- [ ] Test light/dark mode switching
- [ ] Accessibility audit

### 📋 Phase 2: Components
- [ ] Buttons (primary, secondary, ghost)
- [ ] Cards
- [ ] Forms (inputs, labels, validation)
- [ ] Data tables
- [ ] Navigation
- [ ] Modals

### 📋 Phase 3: Migration
- [ ] Update existing components
- [ ] Remove old design system files
- [ ] Update documentation
- [ ] Visual regression testing

---

## Usage Guidelines

### Do's

✅ Use pure black and white
✅ Align everything to 8px grid
✅ Create hierarchy through typography (size, weight)
✅ Use generous whitespace
✅ Keep borders sharp (0px or 2px radius max)
✅ Use monospace for data
✅ Maintain maximum contrast

### Don'ts

❌ Add gradients
❌ Add shadows (except minimal)
❌ Round corners heavily
❌ Use color accents
❌ Add decoration
❌ Use effects (blur, glow, etc.)
❌ Break the grid
❌ Reduce contrast

---

## Philosophy in Practice

**This is not minimalism for aesthetics.**
**This is honesty for trust.**

Every removed element is a removed opportunity for deception.
Every sharp edge is a refusal to soften hard truths.
Every grid alignment is a commitment to order.
Every monochrome choice is a rejection of manipulation.

**We don't make things pretty.**
**We make things clear.**

---

## References

**Visual Inspiration:**
- Dia Art Foundation website
- Swiss Federal Design standards
- MoMA collection pages
- Brutalist architecture photography
- Financial terminal interfaces
- Legal documents (clarity, authority)

**NOT Inspiration:**
- Any crypto launchpad
- Any gradient-heavy modern UI
- Any "friendly" rounded design
- Any decorative design system

---

*Design System V2: Gallery Brutalism*
*Version: 1.0*
*Status: In Development*
*Last Updated: 2026-02-18*
