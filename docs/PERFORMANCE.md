# Performance Monitoring Guide

This guide explains the automated performance monitoring system and how to understand and fix performance issues.

## Overview

The performance monitoring system automatically detects performance issues and provides specific recommendations. **You don't need to do anything** - just open the browser console to see the report.

## Enabling/Disabling Performance Monitoring

Performance monitoring is **disabled by default** to avoid impacting production performance. You can enable it in several ways:

### Method 1: Console Commands (Recommended)

Open the browser console (F12) and run:

```javascript
// Enable monitoring
enablePerformanceMonitoring()

// Disable monitoring
disablePerformanceMonitoring()

// Toggle on/off
togglePerformanceMonitoring()
```

### Method 2: URL Query Parameter

Add `?performance=true` to your URL:
```
http://localhost:3000/?performance=true
```

To disable, use `?performance=false` or remove the parameter.

### Method 3: Visual Indicator Toggle

If you're in dev mode (localhost), a small FPS indicator appears in the bottom-right corner. Click the **OFF/ON** button to toggle monitoring.

### Method 4: localStorage

The system remembers your preference in localStorage. Once enabled via any method above, it will stay enabled until you disable it.

**Note**: When you disable monitoring, all services stop running and no performance data is collected. This is useful when you're done optimizing and want zero overhead.

## How It Works

1. **Automatic Monitoring**: The system starts monitoring when the page loads
2. **Scroll Detection**: When you scroll, it analyzes scroll performance
3. **Console Reports**: Open the console (F12) to see automatic reports
4. **Recommendations**: Each issue comes with specific fixes

## Understanding the Console Report

When you open the console, you'll see a report like this:

```
🚀 PERFORMANCE REPORT
📊 SCROLL PERFORMANCE
  Frame Rate: 45 FPS (target: 60 FPS)
  Frame Drops: 12 in last 5 seconds

🎯 TOP RECOMMENDATIONS
1. 🔴 Optimize Marble Background Filters
   Why: CSS filters are expensive to render during scroll
   Fix: [specific code changes]
```

### Report Sections

- **📊 SCROLL PERFORMANCE**: Current frame rate and issues
- **🎯 TOP RECOMMENDATIONS**: Most important fixes (sorted by impact)
- **📋 ISSUE SUMMARY**: Count of issues by priority
- **🔍 DETAILED ANALYSIS**: Expandable section with all data

## Common Issues and Fixes

### 🔴 High Priority Issues

#### Low Scroll Frame Rate (< 50 FPS)

**What it means**: The page is dropping frames during scrolling, making it feel sluggish.

**Common causes**:
- CSS filters (blur, SVG filters)
- Heavy JavaScript during scroll
- Large DOM updates

**How to fix**:
- Reduce or remove CSS filters
- Optimize scroll event handlers
- Use `will-change` CSS property

#### Frame Drops

**What it means**: The browser is skipping frames to keep up.

**How to fix**: Same as low frame rate - optimize CSS and JavaScript.

#### Slow Scroll Handlers

**What it means**: JavaScript code running during scroll is taking too long.

**How to fix**:
- Use `requestAnimationFrame` (already done in theme.js)
- Avoid synchronous DOM reads/writes
- Defer non-critical work

### 🟡 Medium Priority Issues

#### Multiple CSS Filters

**What it means**: Too many filters (blur, invert, etc.) are being applied.

**How to fix**:
```css
/* Instead of multiple filters */
filter: blur(2px) invert(1) url('#filter');

/* Use fewer filters or transforms */
filter: blur(1px);
/* OR use transform instead */
transform: scale(1.05);
```

#### Large DOM

**What it means**: Too many elements on the page.

**How to fix**:
- Lazy load content
- Virtualize long lists
- Remove hidden elements

### 🔵 Low Priority Issues

#### Missing will-change

**What it means**: Elements that animate could benefit from a performance hint.

**How to fix**:
```css
.element {
    will-change: transform; /* For transform animations */
    /* OR */
    will-change: filter; /* For filter animations */
}
```

#### Missing contain Property

**What it means**: Elements could be isolated to prevent layout thrashing.

**How to fix**:
```css
.element {
    contain: layout style paint;
}
```

## Understanding Metrics

### Frame Rate (FPS)

- **Target**: 60 FPS
- **Good**: 55-60 FPS
- **Needs Improvement**: 45-54 FPS
- **Poor**: < 45 FPS

### Scroll Handler Time

- **Good**: < 5ms
- **Needs Improvement**: 5-10ms
- **Poor**: > 10ms

### Core Web Vitals

The system also tracks Core Web Vitals:

- **LCP (Largest Contentful Paint)**: How long until main content loads
  - Good: < 2.5s
  - Needs Improvement: 2.5-4s
  - Poor: > 4s

- **FID (First Input Delay)**: How responsive the page is
  - Good: < 100ms
  - Needs Improvement: 100-300ms
  - Poor: > 300ms

- **CLS (Cumulative Layout Shift)**: How much content shifts
  - Good: < 0.1
  - Needs Improvement: 0.1-0.25
  - Poor: > 0.25

## Applying Fixes

### Step 1: Read the Recommendation

Each recommendation includes:
- **What**: Description of the issue
- **Why**: Explanation in simple terms
- **Fix**: Specific code to add/change
- **File**: Which file to modify

### Step 2: Apply the Fix

1. Open the file mentioned in the recommendation
2. Find the CSS selector or code mentioned
3. Apply the suggested changes
4. Save and refresh the page

### Step 3: Verify the Fix

1. Scroll the page
2. Open the console
3. Check if the issue is gone from the report
4. Frame rate should improve

## Common Patterns

### Marble Background Optimization

The marble background is a common source of performance issues. Here's how to optimize it:

```css
/* In src/core/marble.css */

body.marble-bg::before {
    /* Add performance hints */
    will-change: transform;
    contain: layout style paint;
    
    /* Reduce filter complexity */
    /* Instead of: filter: blur(3px) invert(1) url('#filter') */
    /* Use: filter: blur(1px); or remove filters entirely */
    
    /* Force GPU acceleration */
    transform: translate3d(0, 0, 0) scale(...);
}
```

### Scroll Handler Optimization

Scroll handlers should be lightweight:

```javascript
// ✅ Good: Uses requestAnimationFrame
const handleScroll = () => {
    if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
    }
};

// ❌ Bad: Heavy work in scroll handler
const handleScroll = () => {
    // Don't do heavy calculations here
    // Don't read/write DOM synchronously
};
```

## Troubleshooting

### "No issues detected" but page feels slow

- Check if you're scrolling when the report generates
- Wait a few seconds and scroll again
- The report updates automatically after scrolling

### Recommendations seem too technical

- Focus on the "Why" section - it explains in simple terms
- Start with high-priority (🔴) issues first
- Apply one fix at a time and test

### Fix didn't help

- Make sure you saved the file and refreshed
- Check the console for errors
- Try the next recommendation
- Some issues require multiple fixes

## Best Practices

1. **Fix high-priority issues first** - They have the biggest impact
2. **Test after each fix** - See if performance improves
3. **Don't optimize prematurely** - Only fix issues that are actually detected
4. **Keep it simple** - The simplest fix is often the best

## Getting Help

If you're unsure about a recommendation:

1. Read the "Why" section - it explains the issue
2. Check the "Fix" section - it has specific code
3. Apply the fix to a test file first
4. The system will detect if the fix worked

## Advanced: Understanding the Technical Details

The performance monitoring system uses:

- **Performance API**: Browser's built-in performance measurement
- **requestAnimationFrame**: For frame rate monitoring
- **PerformanceObserver**: For Core Web Vitals
- **CSS Analysis**: Computed styles to detect expensive properties

All monitoring is lightweight and doesn't impact performance itself.

