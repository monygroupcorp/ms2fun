# Design System: Temple of Capital

## Design Philosophy

**"Temple of Capital"** - A design system that evokes the majesty of classical architecture (temples, Roman master architecture, Greek revivalism, massive columns, marble) combined with the sleek professionalism of Art Deco and killer capitalism.

### Core Aesthetic Principles

1. **Classical Grandeur**: Grand scale, symmetry, classical proportions, marble textures
2. **Art Deco Luxury**: Geometric patterns, metallic accents, bold lines, sophisticated elegance
3. **Modern Professionalism**: Clean execution, premium feel, killer capitalism aesthetic
4. **Sacred Spaces**: The Pantheon, the Duomo - places of worship and power

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

/* Deep Stone & Shadow */
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
--bronze: #cd7f32;               /* Bronze - DEPRECATED, use silver */
--bronze-dark: #a66d28;          /* Dark bronze - DEPRECATED */
--copper: #b87333;               /* Copper accent */

/* Art Deco Colors */
--deco-black: #1a1a1a;           /* Deep black */
--deco-charcoal: #2d2d2d;        /* Charcoal */
--deco-navy: #1e3a5f;            /* Deep navy */
--deco-emerald: #2d5016;         /* Deep emerald */
--deco-royal: #4a2c4a;           /* Royal purple */
```

### Engraved Plaque Metallic System (Marble Update)

**Status: ✅ IMPLEMENTED** - Comprehensive metallic visual language for all buttons that evokes **engraved gold plaques** — classical, elegant, and performant.

The system creates buttons that look like **engraved metallic plaques** with sharp corners, darker engraved text, and serif typography. All buttons across the site use this system with different metallic finishes (gold, bronze, silver, copper) based on their role and hierarchy.

#### Design Intent

The engraved plaque aesthetic is inspired by:
- **Classical Architecture**: Engraved plaques found in temples, monuments, and classical buildings
- **Gilded Ornaments**: Gold and silver plaques with carved inscriptions
- **Polished Coins**: Metallic surfaces with engraved text
- **Art Deco Luxury**: Refined metallic finishes with geometric precision

#### Core Design Principles

1. **Sharp Corners**: All metallic buttons use `var(--radius-sm)` (2px) for crisp, plaque-like edges
2. **Darker Text**: Text uses dark metallic colors (`--*-metallic-dark`) instead of sheen colors to simulate engraved depth
3. **Serif Typography**: All metallic buttons use `var(--font-engraved)` (Playfair Display, Times New Roman fallback) for classical inscription feel
4. **Enhanced Shadows**: Multi-layered text shadows create deep engraved effect
5. **Bold Weight**: Text uses `var(--font-weight-bold)` for plaque readability
6. **Metallic Gradients**: Sophisticated gradients simulate metal depth and light reflection

#### Metallic Palettes

**Gold Metallic - Primary Actions, CTAs:**
```css
/* Base metallic tones - evoking polished coins and gilded engravings */
--gold-metallic-base: #c9a442;          /* Rich gold base */
--gold-metallic-light: #f8e7b9;          /* Bright highlight */
--gold-metallic-dark: #7d6221;           /* Deep shadow (used for text) */
--gold-metallic-sheen: #fff8dc;          /* Specular highlight */

/* Metallic gradient stops for depth simulation */
--gold-metallic-gradient-light: #f5e6b8;  /* Top highlight */
--gold-metallic-gradient-mid: #d4af37;    /* Mid-tone */
--gold-metallic-gradient-dark: #8b6f2a;   /* Bottom shadow */
```

**Bronze Metallic - DEPRECATED:**

> **DEPRECATED (2026-01)**: Bronze has been removed from the active design system. Use **Gold** for primary actions and **Silver** for secondary actions. Bronze variables are preserved for backward compatibility but should not be used in new code.

```css
/* DEPRECATED - DO NOT USE IN NEW CODE */
--bronze-metallic-base: #cd7f32;         /* Classic bronze */
--bronze-metallic-light: #e8b882;        /* Light bronze highlight */
--bronze-metallic-dark: #8b5a2a;         /* Deep bronze shadow (used for text) */
--bronze-metallic-sheen: #f5d4a8;         /* Bronze specular */
--bronze-metallic-gradient-light: #e0a870; /* Top highlight */
--bronze-metallic-gradient-mid: #cd7f32;   /* Mid-tone */
--bronze-metallic-gradient-dark: #9d6a2a;  /* Bottom shadow */
```

**Silver/Neutral Metallic - Tertiary Actions, Subtle Buttons:**
```css
--silver-metallic-base: #9e9e9e;         /* Neutral gray base */
--silver-metallic-light: #e0e0e0;         /* Light silver highlight */
--silver-metallic-dark: #616161;          /* Deep gray shadow (used for text) */
--silver-metallic-sheen: #f5f5f5;         /* Silver specular */
--silver-metallic-gradient-light: #d4d4d4; /* Top highlight */
--silver-metallic-gradient-mid: #9e9e9e;    /* Mid-tone */
--silver-metallic-gradient-dark: #757575;   /* Bottom shadow */
```

**Copper Metallic - Accent Actions:**
```css
--copper-metallic-base: #b87333;         /* Classic copper */
--copper-metallic-light: #d4a574;         /* Light copper highlight */
--copper-metallic-dark: #8b5a2a;         /* Deep copper shadow (used for text) */
--copper-metallic-sheen: #e8c9a3;         /* Copper specular */
--copper-metallic-gradient-light: #c99d6a; /* Top highlight */
--copper-metallic-gradient-mid: #b87333;   /* Mid-tone */
--copper-metallic-gradient-dark: #9d6a2a;  /* Bottom shadow */
```

**Dark Theme Overrides:**

All metallic palettes have dark theme variants that shift cooler and reduce brightness for harmony with dark marble backgrounds:

```css
/* Gold Metallic (Dark Theme) */
--gold-metallic-base: #b48b2c;          /* Slightly cooler, less bright */
--gold-metallic-light: #e0ca88;          /* Softer highlight */
--gold-metallic-dark: #3a2b12;           /* Deeper shadow */
--gold-metallic-sheen: #fff8d1;          /* Subtle specular */
--gold-metallic-gradient-light: #d4b87a;  /* Muted highlight */
--gold-metallic-gradient-mid: #b48b2c;    /* Cooler mid-tone */
--gold-metallic-gradient-dark: #5a4218;   /* Deep shadow */

/* Bronze Metallic (Dark Theme) - DEPRECATED */
--bronze-metallic-base: #b87333;         /* Warmer bronze */
--bronze-metallic-light: #d4a574;       /* Softer highlight */
--bronze-metallic-dark: #5a3a1a;         /* Deeper shadow */
--bronze-metallic-sheen: #e8c9a3;        /* Subtle specular */
--bronze-metallic-gradient-light: #c99d6a; /* Muted highlight */
--bronze-metallic-gradient-mid: #b87333;  /* Mid-tone */
--bronze-metallic-gradient-dark: #6b4a1a; /* Deep shadow */

/* Silver/Neutral Metallic (Dark Theme) */
--silver-metallic-base: #b0b0b0;         /* Lighter gray */
--silver-metallic-light: #e8e8e8;        /* Brighter highlight */
--silver-metallic-dark: #4a4a4a;         /* Deeper shadow */
--silver-metallic-sheen: #f5f5f5;         /* Subtle specular */
--silver-metallic-gradient-light: #d4d4d4; /* Muted highlight */
--silver-metallic-gradient-mid: #b0b0b0;   /* Mid-tone */
--silver-metallic-gradient-dark: #6b6b6b;  /* Deep shadow */

/* Copper Metallic (Dark Theme) */
--copper-metallic-base: #c98a4a;         /* Warmer copper */
--copper-metallic-light: #e0b882;        /* Softer highlight */
--copper-metallic-dark: #5a3a1a;         /* Deeper shadow */
--copper-metallic-sheen: #f0d4a8;         /* Subtle specular */
--copper-metallic-gradient-light: #d4a870; /* Muted highlight */
--copper-metallic-gradient-mid: #c98a4a;   /* Mid-tone */
--copper-metallic-gradient-dark: #7a5a2a; /* Deep shadow */
```

#### Gradient & Relief Utilities

**Gold Metallic Gradients:**
```css
/* Raised metallic gradient - simulates coin-like depth */
--gradient-metallic-raised: linear-gradient(160deg,
    var(--gold-metallic-light) 0%,
    var(--gold-metallic-gradient-light) 15%,
    var(--gold-metallic-base) 40%,
    var(--gold-metallic-gradient-mid) 60%,
    var(--gold-metallic-gradient-dark) 85%,
    var(--gold-metallic-dark) 100%);

/* Engraved metallic gradient - for inlay effect */
--gradient-metallic-engraved: linear-gradient(160deg,
    var(--gold-metallic-dark) 0%,
    var(--gold-metallic-gradient-dark) 30%,
    var(--gold-metallic-base) 50%,
    var(--gold-metallic-gradient-mid) 70%,
    var(--gold-metallic-light) 100%);
```

**Bronze Metallic Gradients (DEPRECATED):**
```css
/* DEPRECATED - Use silver gradients instead */
--gradient-bronze-raised: linear-gradient(160deg,
    var(--bronze-metallic-light) 0%,
    var(--bronze-metallic-gradient-light) 15%,
    var(--bronze-metallic-base) 40%,
    var(--bronze-metallic-gradient-mid) 60%,
    var(--bronze-metallic-gradient-dark) 85%,
    var(--bronze-metallic-dark) 100%);
```

**Silver/Neutral Metallic Gradients:**
```css
--gradient-silver-raised: linear-gradient(160deg,
    var(--silver-metallic-light) 0%,
    var(--silver-metallic-gradient-light) 15%,
    var(--silver-metallic-base) 40%,
    var(--silver-metallic-gradient-mid) 60%,
    var(--silver-metallic-gradient-dark) 85%,
    var(--silver-metallic-dark) 100%);
```

**Copper Metallic Gradients:**
```css
--gradient-copper-raised: linear-gradient(160deg,
    var(--copper-metallic-light) 0%,
    var(--copper-metallic-gradient-light) 15%,
    var(--copper-metallic-base) 40%,
    var(--copper-metallic-gradient-mid) 60%,
    var(--copper-metallic-gradient-dark) 85%,
    var(--copper-metallic-dark) 100%);
```

**Metallic Relief Shadows:**
```css
/* Raised metallic shadow - for coin-like depth */
--shadow-metallic-raised: 
    inset 0 2px 3px rgba(255, 255, 255, 0.25),  /* Top highlight */
    inset 0 -2px 3px rgba(0, 0, 0, 0.3),        /* Bottom shadow */
    0 2px 4px rgba(0, 0, 0, 0.15),               /* Outer depth */
    0 1px 2px rgba(0, 0, 0, 0.1);                /* Subtle edge */

/* Engraved metallic shadow - for inlay effect */
--shadow-metallic-engraved:
    inset 0 2px 4px rgba(0, 0, 0, 0.4),          /* Deep inset */
    inset 0 -1px 2px rgba(255, 255, 255, 0.1),   /* Subtle highlight */
    0 1px 2px rgba(0, 0, 0, 0.1);                /* Edge definition */

/* Bronze-specific shadows - DEPRECATED */
--shadow-bronze-raised:
    inset 0 2px 3px rgba(255, 255, 255, 0.2),
    inset 0 -2px 3px rgba(0, 0, 0, 0.35),
    0 2px 4px rgba(0, 0, 0, 0.15),
    0 1px 2px rgba(0, 0, 0, 0.1);

/* Silver-specific shadows */
--shadow-silver-raised: 
    inset 0 2px 3px rgba(255, 255, 255, 0.3),
    inset 0 -2px 3px rgba(0, 0, 0, 0.25),
    0 2px 4px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.08);
```

#### Engraved Typography System

**Engraved Font Variable:**
```css
/* Engraved/Classical Font - For metallic buttons and plaques */
--font-engraved: 'Playfair Display', 'Times New Roman', 'Georgia', 'Bodoni', 'Didot', serif;
```

The engraved font system uses classical serif fonts to evoke the look of inscriptions on plaques:
- **Primary**: Playfair Display (Google Fonts) - elegant, classical serif
- **Fallbacks**: Times New Roman, Georgia, Bodoni, Didot - web-safe serif alternatives
- **Purpose**: Creates the appearance of engraved text on metallic surfaces

#### Text Shadow System for Engraved Effect

The engraved text effect uses multi-layered shadows to create depth:

```css
/* Base engraved text shadow */
text-shadow: 
    0 1px 2px rgba(255, 255, 255, 0.3),   /* Subtle highlight on top */
    0 2px 4px rgba(0, 0, 0, 0.5),         /* Deep shadow for depth */
    0 0 1px rgba(0, 0, 0, 0.8);           /* Sharp edge definition */

/* Hover state - enhanced shadow */
text-shadow: 
    0 1px 2px rgba(255, 255, 255, 0.4),   /* Brighter highlight */
    0 2px 4px rgba(0, 0, 0, 0.6),         /* Deeper shadow */
    0 0 1px rgba(0, 0, 0, 0.9);           /* Sharper edge */
```

#### Button Hierarchy & Metallic Assignment

> **Updated (2026-01)**: The design system now uses only **Gold** and **Silver** metallic finishes. Bronze has been deprecated.

| Button Type | Metallic Finish | Use Case |
|------------|----------------|----------|
| `.btn-primary` | Gold | Primary CTAs, main actions |
| `.btn-secondary` | Silver | Secondary actions, alternative choices |
| `.btn-outline` | Gold (engraved style) | Tertiary actions, subtle CTAs |
| `.btn-ghost` | Silver (subtle) | Minimal actions, background buttons |
| `.cta-button` | Gold | Hero CTAs, major call-to-actions |
| `.cta-button.secondary` | Silver | Secondary CTAs |
| `.connect-button` | Gold | Wallet connection actions |
| `.submit-button` | Gold | Form submissions |
| `.cancel-button` | Silver | Cancel actions |
| `.back-button` | Silver | Navigation back |
| `.retry-button` | Silver | Retry actions |
| `.view-project-button` | Gold | View project actions |
| `.btn-danger` | Silver + red text | Destructive actions |

#### Technical Implementation

**Key CSS Properties:**
- `border-radius: var(--radius-sm)` - Sharp corners (2px) for plaque look
- `color: var(--*-metallic-dark)` - Dark text for engraved appearance
- `font-family: var(--font-engraved)` - Serif font for classical feel
- `font-weight: var(--font-weight-bold)` - Bold weight for readability
- `background: var(--gradient-*-raised)` - Metallic gradient
- `box-shadow: var(--shadow-*-raised)` - Relief shadows
- `text-shadow: [multi-layer]` - Engraved text depth

**Hover States:**
- Enhanced gradient with brighter highlights
- Increased shadow depth
- Subtle transform (`translateY(-1px)`)
- Enhanced text shadow for deeper engraving effect

**Active States:**
- Pressed gradient (darker, more compressed)
- Inset shadows for pressed effect
- Reduced elevation
- Maintained dark text color

**Focus States:**
- Metallic-colored outline (matches button finish)
- Glow ring using metallic color with opacity
- Maintains all base metallic properties

#### Performance Considerations

- **Pure CSS**: All effects use CSS gradients and shadows (no images)
- **Hardware Acceleration**: Transitions use GPU-accelerated properties
- **Minimal Repaints**: Shadow and gradient changes are optimized
- **Theme-Aware**: Automatic color adaptation via CSS variables (no JS needed)

**See `STYLE_GUIDE.md` for complete engraved plaque button documentation, usage examples, and best practices.**

**Cross-Reference:** The engraved plaque system is designed to complement the **Marble Background System**. When used together, metallic buttons create a harmonious visual language that evokes classical architecture with gilded ornaments atop marble surfaces. See marble texture utilities in `src/core/marble.css` for background application.

#### Areas for Future Enhancement

The engraved plaque system is designed to be extensible and refinable. Potential areas for improvement:

**Visual Refinements:**
- **Text Shadow Depth**: Adjust shadow opacity and blur values for deeper or more subtle engraving
- **Gradient Angles**: Experiment with different gradient angles (currently 160deg) for varied light sources
- **Corner Sharpness**: Consider even sharper corners (1px or 0px) for more geometric plaque appearance
- **Border Thickness**: Adjust border width for more or less defined plaque edges
- **Metallic Sheen**: Enhance or reduce specular highlights for different polish levels

**Typography Enhancements:**
- **Letter Spacing**: Adjust letter-spacing for more classical inscription feel
- **Font Weight Variations**: Experiment with different weights for different button sizes
- **Text Transform**: Consider uppercase for more formal plaque appearance
- **Font Alternatives**: Test other serif fonts (EB Garamond, Crimson Text, etc.)

**Color Refinements:**
- **Metallic Palette Tuning**: Fine-tune color values for more realistic metal appearance
- **Contrast Optimization**: Adjust dark text colors for better readability
- **Theme Transitions**: Smooth color transitions when switching themes
- **Metallic Combinations**: Refine color pairings (gold/silver, bronze/copper, etc.)

**Shadow & Depth:**
- **Shadow Intensity**: Adjust shadow opacity for more or less depth
- **Shadow Layers**: Add or remove shadow layers for different relief effects
- **Inset Shadow Balance**: Fine-tune inset highlight vs. shadow ratio
- **Glow Effects**: Enhance or reduce glow on hover/focus states

**Animation & Interaction:**
- **Transition Timing**: Adjust transition durations for smoother interactions
- **Hover Effects**: Refine transform and shadow changes on hover
- **Active Feedback**: Enhance pressed-state visual feedback
- **Shimmer Animation**: Optional shimmer effect for premium actions

**Technical Optimizations:**
- **CSS Variable Organization**: Group related variables for easier maintenance
- **Performance**: Optimize gradient and shadow calculations
- **Browser Compatibility**: Ensure consistent rendering across browsers
- **Accessibility**: Enhance contrast ratios and focus indicators

**Documentation:**
- **Visual Examples**: Add screenshots or visual references
- **Code Snippets**: Provide more complete implementation examples
- **Design Rationale**: Document design decisions and trade-offs
- **Migration Guide**: Help transition existing buttons to new system

### Professional Neutrals

```css
/* Professional Grays */
--neutral-100: #fafafa;          /* Lightest */
--neutral-200: #f5f5f5;
--neutral-300: #e8e8e8;
--neutral-400: #d4d4d4;
--neutral-500: #9e9e9e;
--neutral-600: #6b6b6b;
--neutral-700: #4a4a4a;
--neutral-800: #2d2d2d;
--neutral-900: #1a1a1a;          /* Darkest */
```

### Semantic Colors

```css
/* Success - Emerald Green (like ancient coins) */
--success-50: #e8f5e9;
--success-100: #c8e6c9;
--success-500: #4caf50;
--success-600: #43a047;
--success-700: #388e3c;

/* Warning - Amber Gold */
--warning-50: #fff8e1;
--warning-100: #ffecb3;
--warning-500: #ffc107;
--warning-600: #ffb300;
--warning-700: #ffa000;

/* Error - Terracotta Red */
--error-50: #ffebee;
--error-100: #ffcdd2;
--error-500: #f44336;
--error-600: #e53935;
--error-700: #d32f2f;

/* Info - Deep Blue (like lapis lazuli) */
--info-50: #e3f2fd;
--info-100: #bbdefb;
--info-500: #2196f3;
--info-600: #1e88e5;
--info-700: #1976d2;
```

### Text Colors

```css
/* Text on Light Backgrounds */
--text-primary: #2d2d2d;          /* Deep charcoal */
--text-secondary: #4a4a4a;       /* Medium gray */
--text-tertiary: #6b6b6b;         /* Light gray */
--text-muted: #9e9e9e;            /* Very light gray */
--text-inverse: #faf9f7;         /* Marble white for dark backgrounds */

/* Text on Dark Backgrounds */
--text-dark-primary: #faf9f7;    /* Marble white */
--text-dark-secondary: #e8e5e0;  /* Light marble */
--text-dark-tertiary: #d4c5b9;    /* Warm stone */
```

### Background Colors

```css
/* Light Theme Backgrounds */
--bg-primary: #faf9f7;           /* Marble white */
--bg-secondary: #f5f3f0;         /* Marble cream */
--bg-tertiary: #f0ede8;          /* Ivory marble */
--bg-elevated: #ffffff;           /* Pure white for cards */
--bg-overlay: rgba(26, 26, 26, 0.6); /* Dark overlay */

/* Dark Theme Backgrounds (for future) */
--bg-dark-primary: #1a1a1a;      /* Deep black */
--bg-dark-secondary: #2d2d2d;    /* Charcoal */
--bg-dark-tertiary: #4a4038;    /* Stone charcoal */
--bg-dark-elevated: #2d2d2d;     /* Elevated dark */
```

### Accent Colors

```css
/* Primary Accent - Gold */
--accent-primary: #d4af37;        /* Classic gold */
--accent-primary-hover: #b8941f; /* Burnished gold */
--accent-primary-light: #e8d5a3;  /* Light gold */

/* Secondary Accent - Silver (previously Bronze, now deprecated) */
--accent-secondary: #9e9e9e;      /* Silver - use instead of bronze */
--accent-secondary-hover: #757575; /* Dark silver */

/* Tertiary Accent - Copper */
--accent-tertiary: #b87333;       /* Copper */
```

---

## Typography System

### Font Families

```css
/* Primary Font - RedHatTextVar (Used for headings and body) */
--font-heading: 'RedHatTextVar', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
                'Inter', 'Roboto', 'Helvetica Neue', sans-serif;

/* Secondary Font - Modern Sans (for body, professional) */
--font-body: 'RedHatTextVar', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
             'Inter', 'Roboto', 'Helvetica Neue', sans-serif;

/* Accent Font - Art Deco / Geometric (for special elements) */
--font-accent: 'Bebas Neue', 'Oswald', 'Montserrat', sans-serif;

/* Engraved Font - Classical Serif (for metallic buttons and plaques) */
--font-engraved: 'Playfair Display', 'Times New Roman', 'Georgia', 'Bodoni', 'Didot', serif;

/* Monospace - For code/data (preserved for CULT EXEC compatibility) */
--font-mono: 'Courier New', 'Monaco', 'Consolas', monospace;
```

**Font Usage:**
- **`--font-heading`** / **`--font-body`**: RedHatTextVar for all standard text and headings
- **`--font-engraved`**: Playfair Display (with Times New Roman fallback) for all metallic buttons to create classical inscription appearance
- **`--font-accent`**: Bebas Neue for Art Deco styled elements
- **`--font-mono`**: Courier New for code and CULT EXEC compatibility

### Type Scale (Classical Proportions - Golden Ratio ~1.618)

```css
/* Display Sizes - Grand, temple-like scale */
--font-size-display-1: 4.5rem;    /* 72px - Massive headings */
--font-size-display-2: 3.75rem;   /* 60px - Large headings */
--font-size-display-3: 3rem;       /* 48px - Section headings */

/* Heading Sizes */
--font-size-h1: 2.5rem;           /* 40px */
--font-size-h2: 2rem;              /* 32px */
--font-size-h3: 1.75rem;           /* 28px */
--font-size-h4: 1.5rem;            /* 24px */
--font-size-h5: 1.25rem;           /* 20px */
--font-size-h6: 1.125rem;          /* 18px */

/* Body Sizes */
--font-size-body-lg: 1.125rem;      /* 18px */
--font-size-body: 1rem;             /* 16px */
--font-size-body-sm: 0.875rem;     /* 14px */
--font-size-body-xs: 0.75rem;       /* 12px */

/* Special Sizes */
--font-size-caption: 0.875rem;      /* 14px */
--font-size-label: 0.75rem;         /* 12px */
--font-size-small: 0.625rem;        /* 10px */
```

### Font Weights

```css
--font-weight-light: 300;
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
--font-weight-extrabold: 800;
--font-weight-black: 900;
```

### Line Heights (Classical Proportions)

```css
--line-height-tight: 1.2;          /* Headings */
--line-height-normal: 1.5;         /* Body text */
--line-height-relaxed: 1.75;        /* Comfortable reading */
--line-height-loose: 2;             /* Spacious, luxurious */
```

### Letter Spacing

```css
--letter-spacing-tighter: -0.05em;
--letter-spacing-tight: -0.025em;
--letter-spacing-normal: 0;
--letter-spacing-wide: 0.025em;
--letter-spacing-wider: 0.05em;
--letter-spacing-widest: 0.1em;     /* For Art Deco headings */
```

### Text Styles

```css
/* Classical Inscription Style */
.text-inscription {
  font-family: var(--font-heading);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
}

/* Art Deco Style */
.text-artdeco {
  font-family: var(--font-accent);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-widest);
  text-transform: uppercase;
}
```

---

## Spacing System

### Base Unit: 4px (Classical Grid)

All spacing uses multiples of 4px for consistency and alignment.

```css
/* Spacing Scale */
--spacing-0: 0;
--spacing-1: 0.25rem;    /* 4px */
--spacing-2: 0.5rem;     /* 8px */
--spacing-3: 0.75rem;     /* 12px */
--spacing-4: 1rem;        /* 16px */
--spacing-5: 1.25rem;     /* 20px */
--spacing-6: 1.5rem;      /* 24px */
--spacing-8: 2rem;        /* 32px */
--spacing-10: 2.5rem;     /* 40px */
--spacing-12: 3rem;       /* 48px */
--spacing-16: 4rem;       /* 64px */
--spacing-20: 5rem;       /* 80px */
--spacing-24: 6rem;       /* 96px */
--spacing-32: 8rem;       /* 128px - Grand scale */
--spacing-40: 10rem;      /* 160px - Temple scale */
--spacing-48: 12rem;      /* 192px - Massive scale */
```

### Section Spacing (Classical Proportions)

```css
--section-spacing-sm: var(--spacing-16);   /* 64px */
--section-spacing-md: var(--spacing-24);  /* 96px */
--section-spacing-lg: var(--spacing-32);   /* 128px */
--section-spacing-xl: var(--spacing-40);   /* 160px */
```

---

## Border System

### Border Radius (Classical & Art Deco)

```css
/* Classical - Subtle, refined */
--radius-none: 0;
--radius-sm: 0.125rem;     /* 2px - Very subtle */
--radius-md: 0.25rem;      /* 4px - Subtle */
--radius-lg: 0.5rem;       /* 8px - Gentle */
--radius-xl: 0.75rem;      /* 12px - Rounded */
--radius-2xl: 1rem;        /* 16px - Very rounded */
--radius-full: 9999px;     /* Full circle */

/* Art Deco - Geometric, sharp */
--radius-deco-sm: 0.25rem; /* 4px - Sharp corners */
--radius-deco-md: 0.5rem;  /* 8px - Geometric */
```

### Border Width

```css
--border-width-none: 0;
--border-width-thin: 1px;
--border-width-base: 2px;
--border-width-thick: 3px;
--border-width-bold: 4px;
```

### Border Colors

```css
--border-light: var(--marble-vein);        /* Subtle marble veining */
--border-base: var(--neutral-300);        /* Standard border */
--border-dark: var(--neutral-400);        /* Darker border */
--border-accent: var(--gold-primary);      /* Gold accent border */
--border-error: var(--error-500);
--border-success: var(--success-500);
--border-warning: var(--warning-500);
```

---

## Shadow System (Depth & Elevation)

### Elevation Levels (Like Carved Stone Reliefs)

**Status: ✅ IMPLEMENTED** - Full 6-level elevation system with theme support.

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

**See `STYLE_GUIDE.md` for complete elevation documentation and usage examples.**

---

## Animation & Transitions

### Timing Functions (Classical Easing)

```css
/* Classical - Smooth, elegant */
--ease-classic: cubic-bezier(0.4, 0.0, 0.2, 1);
--ease-in-classic: cubic-bezier(0.4, 0.0, 1, 1);
--ease-out-classic: cubic-bezier(0.0, 0.0, 0.2, 1);

/* Art Deco - Sharp, precise */
--ease-deco: cubic-bezier(0.25, 0.46, 0.45, 0.94);
--ease-in-deco: cubic-bezier(0.55, 0.055, 0.675, 0.19);
--ease-out-deco: cubic-bezier(0.215, 0.61, 0.355, 1);

/* Luxury - Smooth, premium */
--ease-luxury: cubic-bezier(0.25, 0.1, 0.25, 1);
```

### Durations

```css
--duration-instant: 0ms;
--duration-fast: 150ms;
--duration-base: 250ms;
--duration-slow: 350ms;
--duration-slower: 500ms;
--duration-slowest: 750ms;
```

### Transitions

```css
/* Standard Transitions */
--transition-base: all var(--duration-base) var(--ease-classic);
--transition-fast: all var(--duration-fast) var(--ease-classic);
--transition-slow: all var(--duration-slow) var(--ease-classic);

/* Specific Transitions */
--transition-color: color var(--duration-base) var(--ease-classic);
--transition-bg: background-color var(--duration-base) var(--ease-classic);
--transition-transform: transform var(--duration-base) var(--ease-classic);
--transition-shadow: box-shadow var(--duration-base) var(--ease-classic);
--transition-opacity: opacity var(--duration-base) var(--ease-classic);
```

---

## Layout System

### Container Widths

```css
--container-xs: 20rem;      /* 320px */
--container-sm: 24rem;      /* 384px */
--container-md: 28rem;      /* 448px */
--container-lg: 32rem;      /* 512px */
--container-xl: 36rem;      /* 576px */
--container-2xl: 42rem;     /* 672px */
--container-3xl: 48rem;     /* 768px */
--container-4xl: 56rem;     /* 896px */
--container-5xl: 64rem;     /* 1024px */
--container-6xl: 72rem;     /* 1152px */
--container-7xl: 80rem;     /* 1280px - Max content width */
--container-full: 100%;
```

### Breakpoints (Classical Proportions)

```css
--breakpoint-xs: 0;
--breakpoint-sm: 640px;     /* Small tablets */
--breakpoint-md: 768px;      /* Tablets */
--breakpoint-lg: 1024px;     /* Laptops */
--breakpoint-xl: 1280px;     /* Desktops */
--breakpoint-2xl: 1536px;    /* Large desktops */
```

### Grid System

```css
--grid-columns: 12;
--grid-gap-sm: var(--spacing-4);
--grid-gap-md: var(--spacing-6);
--grid-gap-lg: var(--spacing-8);
```

---

## Component Tokens

### Buttons

```css
/* Button Heights */
--button-height-sm: 2rem;      /* 32px */
--button-height-md: 2.75rem;    /* 44px */
--button-height-lg: 3.5rem;      /* 56px */

/* Button Padding */
--button-padding-x-sm: var(--spacing-4);
--button-padding-x-md: var(--spacing-6);
--button-padding-x-lg: var(--spacing-8);
--button-padding-y-sm: var(--spacing-2);
--button-padding-y-md: var(--spacing-3);
--button-padding-y-lg: var(--spacing-4);
```

### Cards

```css
--card-padding: var(--spacing-6);
--card-padding-lg: var(--spacing-8);
--card-border-radius: var(--radius-lg);
--card-shadow: var(--shadow-md);
--card-shadow-hover: var(--shadow-lg);
```

### Forms

```css
--input-height: 2.75rem;        /* 44px */
--input-padding-x: var(--spacing-4);
--input-padding-y: var(--spacing-3);
--input-border-radius: var(--radius-md);
--input-border-width: var(--border-width-thin);
```

### Modals

```css
--modal-max-width: var(--container-2xl);
--modal-padding: var(--spacing-8);
--modal-border-radius: var(--radius-xl);
--modal-backdrop: rgba(26, 26, 26, 0.75);
```

---

## Z-Index Scale

```css
--z-base: 0;
--z-dropdown: 1000;
--z-sticky: 1020;
--z-fixed: 1030;
--z-modal-backdrop: 1040;
--z-modal: 1050;
--z-popover: 1060;
--z-tooltip: 1070;
--z-toast: 1080;
```

---

## Special Effects

### Marble Texture (Optional - for premium elements)

```css
/* Marble texture can be applied via background-image */
--marble-texture-light: url('data:image/svg+xml,...'); /* Subtle veining */
--marble-texture-dark: url('data:image/svg+xml,...');  /* Darker veining */
```

### Art Deco Patterns

```css
/* Geometric patterns for backgrounds */
--pattern-deco-grid: repeating-linear-gradient(...);
--pattern-deco-diamond: repeating-linear-gradient(...);
```

---

## Implementation Status

### ✅ Completed Features

1. **Design Tokens**: Complete color, typography, spacing, and shadow system
2. **Component Library**: Standardized buttons, cards, forms, modals
3. **Elevation System**: 6-level depth hierarchy with utility classes
4. **Theme System**: Light/dark mode with automatic system preference detection
5. **Focus States**: Comprehensive accessibility with gold accent outlines
6. **Route Stylesheets**: All route styles updated to use design system
7. **CULT EXEC Protection**: Complete isolation with frozen styles
8. **Documentation**: Comprehensive style guide and documentation
9. **Engraved Plaque Metallic System**: Complete metallic button system with gold, bronze, silver, and copper finishes
   - Sharp corners (2px) for plaque-like appearance
   - Darker engraved text with multi-layered shadows
   - Serif typography (Playfair Display) for classical inscription feel
   - All buttons across the site use metallic finishes
   - Theme-aware with dark mode overrides
   - Comprehensive gradient and shadow systems

### 📋 File Structure

```
src/core/
├── global.css          ✅ Design tokens & base styles
├── theme.css           ✅ Theme toggle button
├── theme.js            ✅ Theme management system
├── elevation.css       ✅ Elevation utilities
└── components.css      ✅ Standardized components

src/routes/
├── home.css            ✅ Updated to design system
├── project-detail.css  ✅ Updated to design system
├── factory-exploration.css ✅ Updated to design system
└── cultexecs.css      🧊 FROZEN - Never modify

Documentation/
├── DESIGN_SYSTEM.md   ✅ Design philosophy & tokens
├── STYLE_GUIDE.md     ✅ Complete usage guide
├── STYLING_INVENTORY.md ✅ Initial state documentation
└── STYLING_PROTECTION_PLAN.md ✅ CULT EXEC protection strategy
```

---

## Usage Guidelines

### Color Usage
- **Primary Accent (Gold)**: Use for CTAs, important actions, highlights, focus states
- **Marble Backgrounds**: Use for main content areas, cards, elevated surfaces
- **Stone Colors**: Use for subtle backgrounds, borders, secondary elements
- **Art Deco Colors**: Use sparingly for premium elements, special badges

### Typography Usage
- **RedHatTextVar**: Used for both headings and body (unified font system)
- **Font Weights**: Use weight scale (300-700) for hierarchy
- **Type Scale**: Use display/h1-h5 scale for consistent sizing

### Spacing Usage
- **Generous Spacing**: Use larger spacing (section-spacing-*) for grand, temple-like feel
- **Section Spacing**: Use section-spacing variables for major sections
- **Component Spacing**: Use base spacing scale (spacing-1 through spacing-32) for components

### Elevation Usage
- **Buttons**: Elevation 2 → 3 on hover → 1 on active
- **Cards**: Elevation 2 → 3 on hover
- **Modals**: Elevation 5 (maximum depth)
- **Dropdowns**: Elevation 4
- **Tooltips**: Elevation 3

### Theme Usage
- **Always use theme-aware variables**: `var(--bg-elevated)`, `var(--text-primary)`, etc.
- **Never hardcode colors**: Colors should adapt to light/dark theme automatically
- **Test in both themes**: Ensure components work in light and dark modes

---

## Quick Reference

### Most Common Tokens

```css
/* Colors */
--accent-primary: #d4af37;        /* Gold - primary accent */
--text-primary: #2d2d2d;          /* Main text (theme-aware) */
--bg-elevated: #ffffff;           /* Card backgrounds (theme-aware) */
--border-base: #e8e5e0;           /* Standard borders (theme-aware) */

/* Spacing */
--spacing-4: 1rem;                /* 16px - most common */
--spacing-6: 1.5rem;              /* 24px - comfortable gaps */
--spacing-8: 2rem;                /* 32px - section spacing */

/* Elevation */
--elevation-2: ...;                /* Cards, buttons */
--elevation-3: ...;                /* Hover states */
--elevation-5: ...;                /* Modals */

/* Typography */
--font-heading: 'RedHatTextVar', sans-serif;
--font-size-h3: 2.25rem;          /* 36px - card titles */
--font-size-body: 1rem;            /* 16px - body text */
```

---

## Implementation Notes

1. **CULT EXEC Isolation**: ✅ All CULT EXEC styles remain frozen. This design system applies only to launchpad pages.

2. **Theme System**: ✅ Light/dark mode fully implemented with automatic system preference detection.

3. **Accessibility**: ✅ Comprehensive focus states, keyboard navigation, WCAG AA contrast ratios.

4. **Performance**: ✅ CSS variables for theming, reduced elevation on mobile, optimized transitions.

5. **Documentation**: ✅ Complete style guide with examples, best practices, and troubleshooting.

---

## Related Documentation

- **`STYLE_GUIDE.md`**: Complete usage guide with examples and best practices
- **`STYLING_INVENTORY.md`**: Initial state documentation (historical reference)
- **`STYLING_PROTECTION_PLAN.md`**: CULT EXEC protection strategy
- **`TECHNICAL_DOCUMENTATION.md`**: Technical implementation details

---

*Design System: Temple of Capital*  
*Version: 2.0*  
*Status: Production*  
*Last Updated: 2024*

