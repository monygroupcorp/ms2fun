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
/* Primary Font - RedHatTextVar (Used for headings and body) */
--font-heading: 'RedHatTextVar', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
                'Inter', 'Roboto', 'Helvetica Neue', sans-serif;
--font-body: 'RedHatTextVar', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
             'Inter', 'Roboto', 'Helvetica Neue', sans-serif;

/* Accent Font - Art Deco / Geometric */
--font-accent: 'Bebas Neue', 'Oswald', 'Montserrat', sans-serif;

/* Engraved Font - Classical Serif (for metallic buttons and plaques) */
--font-engraved: 'Playfair Display', 'Times New Roman', 'Georgia', 'Bodoni', 'Didot', serif;

/* Monospace - For code/data */
--font-mono: 'Courier New', 'Monaco', 'Consolas', monospace;
```

**Font Usage:**
- **`--font-heading`** / **`--font-body`**: RedHatTextVar for all standard text and headings
- **`--font-engraved`**: Playfair Display (with Times New Roman fallback) for all metallic buttons - creates classical inscription appearance
- **`--font-accent`**: Bebas Neue for Art Deco styled elements
- **`--font-mono`**: Courier New for code and CULT EXEC compatibility

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

#### Engraved Plaque Metallic Buttons (Marble Update)

**Status: ✅ IMPLEMENTED** - Comprehensive metallic visual language for all buttons that evokes **engraved gold plaques** — classical, elegant, and performant.

All buttons across the site now use the engraved plaque aesthetic with sharp corners, darker engraved text, serif typography, and sophisticated metallic finishes. The system provides different metallic finishes (gold, bronze, silver, copper) based on button hierarchy and role.

##### Design Philosophy

The engraved plaque system creates buttons that look like **engraved metallic plaques** found in classical architecture:
- **Sharp, crisp edges** (2px border-radius) like cut metal
- **Darker text** that appears carved into the surface
- **Serif typography** (Playfair Display) evoking classical inscriptions
- **Multi-layered shadows** creating deep engraved depth
- **Metallic gradients** simulating polished metal surfaces

##### Core Visual Characteristics

**1. Sharp Corners**
- All metallic buttons use `var(--radius-sm)` (2px) for crisp, plaque-like edges
- Creates geometric precision reminiscent of cut metal plaques
- No rounded corners that would soften the engraved effect

**2. Darker Engraved Text**
- Text uses dark metallic colors (`--*-metallic-dark`) instead of light sheen colors
- Simulates text carved into the metal surface
- Creates strong contrast and readability
- Examples:
  - Gold buttons: `var(--gold-metallic-dark)` (#7d6221)
  - Bronze buttons: `var(--bronze-metallic-dark)` (#8b5a2a)
  - Silver buttons: `var(--silver-metallic-dark)` (#616161)

**3. Serif Typography**
- All metallic buttons use `var(--font-engraved)`
- Font stack: `'Playfair Display', 'Times New Roman', 'Georgia', 'Bodoni', 'Didot', serif`
- Creates classical inscription appearance
- Bold weight (`var(--font-weight-bold)`) for plaque readability

**4. Enhanced Text Shadows**
- Multi-layered shadows create deep engraved effect:
  ```css
  text-shadow: 
      0 1px 2px rgba(255, 255, 255, 0.3),   /* Subtle highlight on top */
      0 2px 4px rgba(0, 0, 0, 0.5),         /* Deep shadow for depth */
      0 0 1px rgba(0, 0, 0, 0.8);           /* Sharp edge definition */
  ```
- Hover state enhances shadows for deeper engraving effect

**5. Metallic Gradients**
- Sophisticated gradients simulate metal depth and light reflection
- 160-degree angle creates natural light source from top-left
- Multiple gradient stops create smooth metallic transitions
- Each metallic type has its own gradient system

**6. Relief Shadows**
- Inset highlights and shadows create 3D depth
- Outer shadows add elevation
- Different shadow systems for each metallic type

##### Metallic Finishes & Button Hierarchy

**Gold Metallic** - Primary Actions, CTAs:
- Used for: `.btn-primary`, `.cta-button`, `.connect-button`, `.submit-button`, `.view-project-button`
- Gradient: `var(--gradient-metallic-raised)`
- Shadow: `var(--shadow-metallic-raised)`
- Text: `var(--gold-metallic-dark)`
- Best for: Main actions, hero CTAs, important buttons

**Bronze Metallic** - Secondary Actions:
- Used for: `.btn-secondary`, `.cancel-button`, `.back-button`, `.retry-button`
- Gradient: `var(--gradient-bronze-raised)`
- Shadow: `var(--shadow-bronze-raised)`
- Text: `var(--bronze-metallic-dark)`
- Best for: Alternative actions, navigation, cancel operations

**Silver Metallic** - Tertiary Actions, Subtle Buttons:
- Used for: `.btn-ghost`, `.cta-button.secondary`
- Gradient: `var(--gradient-silver-raised)`
- Shadow: `var(--shadow-silver-raised)`
- Text: `var(--silver-metallic-dark)`
- Best for: Subtle actions, secondary CTAs (when paired with gold for better contrast)

**Copper Metallic** - Accent Actions:
- Available for: Custom accent buttons
- Gradient: `var(--gradient-copper-raised)`
- Shadow: Similar to bronze
- Text: `var(--copper-metallic-dark)`
- Best for: Special accent actions, featured elements

##### Button Variants

**Primary Button (Gold):**
```html
<button class="btn btn-primary">Primary Action</button>
```

**Secondary Button (Bronze):**
```html
<button class="btn btn-secondary">Secondary Action</button>
```

**Outline Button (Gold, Engraved Style):**
```html
<button class="btn btn-outline">Tertiary Action</button>
```

**Ghost Button (Silver, Subtle):**
```html
<button class="btn btn-ghost">Subtle Action</button>
```

**CTA Buttons:**
```html
<!-- Primary CTA (Gold) -->
<a href="/" class="cta-button">Get Started</a>

<!-- Secondary CTA (Silver - better contrast with gold) -->
<a href="/factories" class="cta-button secondary">Explore Factories</a>
```

##### Button States

**Base State:**
- Metallic gradient background
- Dark engraved text with multi-layer shadows
- Sharp corners (2px)
- Serif font, bold weight
- Relief shadows for depth

**Hover State:**
- Enhanced gradient with brighter highlights
- Increased shadow depth
- Subtle transform (`translateY(-1px)`)
- Enhanced text shadow for deeper engraving
- Glow effect using metallic color

**Active State:**
- Pressed gradient (darker, more compressed)
- Inset shadows for pressed effect
- Reduced elevation
- Maintained dark text color
- Transform returns to `translateY(0)`

**Focus State:**
- Metallic-colored outline (matches button finish)
- Glow ring using metallic color with opacity
- Maintains all base metallic properties
- Accessible focus indicator

**Disabled State:**
- Silver metallic finish (neutral)
- 60% opacity
- No pointer events
- Maintains engraved appearance

##### Complete Button State Example

```css
/* Base State */
.btn-primary {
    background: var(--gradient-metallic-raised) !important;
    color: var(--gold-metallic-dark) !important;
    border: 1px solid var(--gold-metallic-dark) !important;
    border-radius: var(--radius-sm) !important;
    font-family: var(--font-engraved) !important;
    font-weight: var(--font-weight-bold) !important;
    box-shadow: var(--shadow-metallic-raised) !important;
    text-shadow: 
        0 1px 2px rgba(255, 255, 255, 0.3),
        0 2px 4px rgba(0, 0, 0, 0.5),
        0 0 1px rgba(0, 0, 0, 0.8) !important;
}

/* Hover State */
.btn-primary:hover:not(:disabled) {
    background: linear-gradient(160deg,
        var(--gold-metallic-sheen) 0%,
        var(--gold-metallic-light) 15%,
        var(--gold-metallic-base) 40%,
        var(--gold-metallic-gradient-mid) 60%,
        var(--gold-metallic-gradient-dark) 85%,
        var(--gold-metallic-dark) 100%) !important;
    box-shadow: 
        inset 0 2px 3px rgba(255, 255, 255, 0.3),
        inset 0 -2px 3px rgba(0, 0, 0, 0.25),
        0 4px 8px rgba(0, 0, 0, 0.2),
        0 2px 4px rgba(0, 0, 0, 0.15),
        0 0 12px rgba(212, 175, 55, 0.2) !important;
    transform: translateY(-1px);
    text-shadow: 
        0 1px 2px rgba(255, 255, 255, 0.4),
        0 2px 4px rgba(0, 0, 0, 0.6),
        0 0 1px rgba(0, 0, 0, 0.9) !important;
}

/* Active State */
.btn-primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 
        inset 0 2px 4px rgba(0, 0, 0, 0.3),
        inset 0 -1px 2px rgba(255, 255, 255, 0.15),
        0 1px 2px rgba(0, 0, 0, 0.15) !important;
    background: linear-gradient(160deg,
        var(--gold-metallic-base) 0%,
        var(--gold-metallic-gradient-mid) 50%,
        var(--gold-metallic-dark) 100%) !important;
}

/* Focus State */
.btn-primary:focus-visible {
    outline: 2px solid var(--gold-metallic-base);
    outline-offset: 2px;
    box-shadow: 
        var(--shadow-metallic-raised),
        0 0 0 4px rgba(212, 175, 55, 0.2) !important;
}
```

##### Theme Awareness

**Light Theme:**
- Warm, bright metallic tones
- Higher contrast for readability
- Brighter highlights and sheens

**Dark Theme:**
- Cooler, muted metallic tones
- Reduced brightness for harmony with dark backgrounds
- Softer highlights
- Automatic color adaptation via CSS variables

All metallic palettes have dark theme overrides that:
- Shift hue slightly cooler
- Reduce brightness
- Deepen shadows
- Maintain contrast ratios

##### Usage Guidelines

**When to Use Each Metallic Finish:**

1. **Gold** - Primary actions, hero CTAs, main buttons
   - "Connect Wallet", "Get Started", "Submit", "View Project"
   - Most important actions on the page

2. **Bronze** - Secondary actions, navigation, alternatives
   - "Cancel", "Back", "Retry", "Clear Filters"
   - Actions that are important but not primary

3. **Silver** - Tertiary actions, subtle buttons, secondary CTAs
   - Ghost buttons, secondary CTAs (when paired with gold)
   - Minimal, background actions

4. **Copper** - Accent actions (available for custom use)
   - Special featured actions
   - Custom accent elements

**Best Practices:**

- ✅ Use gold for primary CTAs and main actions
- ✅ Use bronze for secondary actions and navigation
- ✅ Use silver for subtle actions or when pairing with gold for better contrast
- ✅ Maintain consistent metallic hierarchy across the page
- ✅ Combine with marble backgrounds for maximum visual impact
- ✅ Ensure sufficient contrast for accessibility
- ❌ Don't mix too many metallic finishes on the same page
- ❌ Don't use light text colors (always use dark metallic colors for engraved effect)
- ❌ Don't use rounded corners (maintain sharp 2px radius)

##### Examples

**Hero Section with CTAs:**
```html
<div class="hero-cta">
    <a href="/" class="cta-button">Get Started</a>
    <a href="/factories" class="cta-button secondary">Explore Factories</a>
</div>
```
*Result: Gold primary CTA with silver secondary CTA for elegant contrast*

**Form Actions:**
```html
<div class="form-actions">
    <button type="submit" class="btn btn-primary">Submit</button>
    <button type="button" class="btn btn-secondary">Cancel</button>
</div>
```
*Result: Gold submit button with bronze cancel button*

**Navigation:**
```html
<button class="back-button">← Back</button>
```
*Result: Bronze metallic back button*

**Card Actions:**
```html
<div class="card-footer">
    <button class="view-project-button">View Project</button>
</div>
```
*Result: Gold metallic view button with engraved plaque styling*

##### Performance

- **Pure CSS**: All effects use CSS gradients and shadows (no images)
- **Hardware Acceleration**: Transitions use GPU-accelerated properties (`transform`, `opacity`)
- **Minimal Repaints**: Shadow and gradient changes are optimized
- **Theme-Aware**: Automatic color adaptation via CSS variables (no JavaScript needed)
- **Lightweight**: No external font loading required (uses web-safe fallbacks)

##### Accessibility

- **High Contrast**: Dark text on metallic backgrounds meets WCAG AA standards
- **Focus Indicators**: Clear metallic-colored outlines with glow rings
- **Keyboard Navigation**: All buttons fully keyboard accessible
- **Screen Readers**: Semantic HTML and proper ARIA labels
- **Color Independence**: Text shadows ensure readability even if color perception is limited

##### Troubleshooting

**Buttons don't look engraved:**
- Verify `font-family: var(--font-engraved)` is applied
- Check that `color` uses `--*-metallic-dark` (not `--*-metallic-sheen`)
- Ensure `border-radius: var(--radius-sm)` is set
- Verify text-shadow is applied with multiple layers

**Text not readable:**
- Ensure using dark metallic colors (`--*-metallic-dark`)
- Check text-shadow is creating sufficient contrast
- Verify font-weight is bold for better readability
- Test in both light and dark themes

**Metallic effect not visible:**
- Verify gradient variables are defined in `global.css`
- Check that `background` uses gradient (not solid color)
- Ensure `box-shadow` uses metallic shadow variables
- Verify theme overrides are applied in dark mode

**Buttons look different across pages:**
- Check that route-specific CSS isn't overriding base styles
- Verify all buttons use `!important` flags for critical properties
- Ensure CSS load order is correct (global.css before components.css)
- Check for conflicting styles in route-specific CSS files

##### Areas for Future Enhancement

The engraved plaque system is designed to be extensible and refinable. Here are potential areas for improvement:

**Visual Refinements:**
- **Text Shadow Depth**: Current shadows use `rgba(0, 0, 0, 0.5-0.6)` for depth. Could be adjusted:
  - Deeper engraving: Increase shadow opacity to `0.7-0.8`
  - Subtler engraving: Decrease to `0.3-0.4`
  - Experiment with blur radius values (currently `2px 4px`)

- **Gradient Refinement**: Current 160deg angle creates top-left light source. Could:
  - Adjust angle for different light directions (140deg, 180deg, etc.)
  - Add more gradient stops for smoother transitions
  - Experiment with radial gradients for different metallic effects

- **Corner Sharpness**: Currently `var(--radius-sm)` = 2px. Could:
  - Use `var(--radius-none)` = 0px for perfectly sharp corners
  - Or `1px` for slightly softer but still sharp edges

- **Border Enhancement**: Current `1px solid`. Could:
  - Increase to `2px` for more defined plaque edges
  - Use double borders for classical plaque appearance
  - Add subtle inner border for depth

**Typography Enhancements:**
- **Letter Spacing**: Could add `letter-spacing: 0.05em` for more formal inscription feel
- **Text Transform**: Consider `text-transform: uppercase` for classical plaque appearance
- **Font Weight**: Current bold (700) could be adjusted per button size
- **Font Alternatives**: Test other serif fonts:
  - EB Garamond (more elegant)
  - Crimson Text (more readable)
  - Libre Baskerville (more traditional)

**Color & Contrast:**
- **Text Color Tuning**: Current dark colors could be:
  - Darkened further for deeper engraving (`#5a3a1a` for gold)
  - Lightened slightly for better readability on some backgrounds
  - Adjusted per metallic type for optimal contrast

- **Metallic Palette Refinement**: Colors could be:
  - More saturated for richer metal appearance
  - Less saturated for subtlety
  - Adjusted for better harmony between gold/silver/bronze

**Shadow & Depth System:**
- **Shadow Layers**: Current 3-layer text shadow could:
  - Add 4th layer for even deeper engraving
  - Remove 3rd layer for subtler effect
  - Adjust blur values independently

- **Box Shadow Balance**: Current inset/outset ratio could:
  - Increase inset shadows for deeper relief
  - Decrease for flatter appearance
  - Adjust highlight vs. shadow intensity

- **Glow Effects**: Hover glow could be:
  - More intense for premium feel
  - More subtle for elegance
  - Color-matched to metallic finish

**Animation & Interaction:**
- **Transition Timing**: Current `var(--transition-base)` = 250ms could:
  - Faster (150ms) for snappier feel
  - Slower (350ms) for more luxurious feel

- **Transform Effects**: Current `translateY(-1px)` could:
  - Increase to `-2px` for more pronounced lift
  - Add scale transform for depth
  - Combine with rotation for dynamic effect

- **Shimmer Animation**: Optional shimmer could:
  - Be enabled by default for premium buttons
  - Have adjustable speed and intensity
  - Use different directions (left-to-right, top-to-bottom)

**Technical Improvements:**
- **CSS Variable Organization**: Group by:
  - Metallic type (all gold vars together)
  - Property type (all gradients, all shadows, etc.)
  - Usage context (button-specific, general, etc.)

- **Performance Optimization**:
  - Use `will-change` for hover states
  - Optimize gradient calculations
  - Reduce shadow complexity on mobile

- **Browser Testing**: Ensure consistency:
  - Safari (WebKit shadow rendering)
  - Firefox (different gradient rendering)
  - Chrome (baseline)
  - Edge (Chromium)

**Accessibility Enhancements:**
- **Contrast Ratios**: Verify all combinations meet WCAG AAA
- **Focus Indicators**: Enhance with animation
- **Reduced Motion**: Respect `prefers-reduced-motion`
- **High Contrast Mode**: Ensure compatibility

**Documentation Improvements:**
- **Visual Examples**: Screenshots of each metallic finish
- **Before/After Comparisons**: Show improvements over time
- **Design Decisions**: Document why specific values were chosen
- **Testing Checklist**: Comprehensive testing guide

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

| Class | Metallic Finish | Use Case | Visual Style |
|------|----------------|----------|--------------|
| `.btn-primary` | Gold | Primary actions, CTAs | Engraved plaque with gold metallic finish |
| `.btn-secondary` | Bronze | Secondary actions | Engraved plaque with bronze metallic finish |
| `.btn-outline` | Gold (engraved) | Tertiary actions | Engraved style with transparent background |
| `.btn-ghost` | Silver (subtle) | Subtle actions | Subtle silver metallic with minimal visibility |
| `.cta-button` | Gold | Hero CTAs, major call-to-actions | Engraved plaque with gold metallic finish |
| `.cta-button.secondary` | Silver | Secondary CTAs | Engraved plaque with silver metallic finish (better contrast with gold) |
| `.connect-button` | Gold | Wallet connection | Engraved plaque with gold metallic finish |
| `.submit-button` | Gold | Form submissions | Engraved plaque with gold metallic finish |
| `.cancel-button` | Bronze | Cancel actions | Engraved plaque with bronze metallic finish |
| `.back-button` | Bronze | Navigation back | Engraved plaque with bronze metallic finish |
| `.view-project-button` | Gold | View project actions | Engraved plaque with gold metallic finish |

**All buttons feature:**
- Sharp corners (`var(--radius-sm)` = 2px)
- Dark engraved text (`--*-metallic-dark` colors)
- Serif typography (`var(--font-engraved)`)
- Multi-layered text shadows for depth
- Metallic gradients and relief shadows

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

