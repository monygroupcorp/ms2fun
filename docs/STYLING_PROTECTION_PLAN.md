# CULT EXEC Style Protection Plan

## 🧊 Frozen Files - DO NOT MODIFY

These files contain CULT EXEC styling that must remain **cryogenically frozen** and isolated from the global styling overhaul.

### Protected Files

1. **`src/routes/cultexecs.css`** ⚠️ **FROZEN**
   - Contains all CULT EXEC terminal theme styles
   - Scoped to `body.cultexecs-active`
   - Must remain untouched

2. **`style.css`** ⚠️ **PARTIALLY FROZEN**
   - Contains legacy CULT EXEC styles (lines 1-3 comment indicates styles moved to cultexecs.css)
   - Some CULT EXEC terminal styles may still exist
   - **Action**: Review and identify CULT EXEC-specific styles, mark them as protected
   - Only modify launchpad/global styles, not CULT EXEC styles

### Protection Strategy

#### 1. Scope Isolation
- CULT EXEC styles are scoped to `body.cultexecs-active`
- All CULT EXEC styles should use this selector
- Global styles should NOT affect CULT EXEC pages

#### 2. File Isolation
- Never modify `cultexecs.css` during overhaul
- When modifying `style.css`, ensure CULT EXEC styles remain untouched
- Use CSS specificity to ensure isolation

#### 3. Variable Isolation
- CULT EXEC has its own CSS variables (scoped to `body.cultexecs-active`)
- Global variables should NOT override CULT EXEC variables
- CULT EXEC variables are defined in `cultexecs.css` lines 5-24

#### 4. Testing Checklist
Before merging, verify:
- [ ] CULT EXEC page (`/cultexecs`) renders identically
- [ ] Terminal theme remains unchanged
- [ ] Dark background (#000000, #111111) preserved
- [ ] Yellow accent (#fdb523) preserved
- [ ] Monospace font (Courier New) preserved
- [ ] Terminal navigation unchanged
- [ ] Price runner/ticker unchanged
- [ ] Trading interface unchanged

---

## 🎨 Global Overhaul Scope

### Files Safe to Modify

1. **`src/core/global.css`** ✅ **SAFE TO MODIFY**
   - Global design tokens
   - Base styles (not CULT EXEC specific)
   - CSS variables (global, not CULT EXEC)

2. **`src/routes/home.css`** ✅ **SAFE TO MODIFY**
   - Launchpad home page styles
   - Project discovery styles
   - No CULT EXEC dependencies

3. **`src/routes/project-detail.css`** ✅ **SAFE TO MODIFY**
   - Project detail page
   - Launchpad-specific

4. **`src/routes/factory-exploration.css`** ✅ **SAFE TO MODIFY**
   - Factory exploration page
   - Launchpad-specific

5. **Component Styles** ✅ **SAFE TO MODIFY** (with caution)
   - Most component styles are launchpad-specific
   - **Exception**: Components used by CULT EXEC must be checked
   - **CONFIRMED Shared Components** (used by CULT EXEC):
     - `WalletConnector` - ✅ Confirmed used by CULT EXEC
     - `MessagePopup` - ✅ Confirmed used by CULT EXEC
   - **Potentially Shared Components** (verify before modifying):
     - `SwapInterface` - May be used by CULT EXEC trading
     - `PriceDisplay` - May be used by CULT EXEC
     - `BalanceDisplay` - May be used by CULT EXEC

### Shared Component Strategy

For components used by both CULT EXEC and launchpad:

1. **Check component usage** - Verify if CULT EXEC uses the component
2. **Use scoping** - Ensure CULT EXEC-specific styles are scoped
3. **Test both contexts** - Verify component works in both themes
4. **Consider wrapper classes** - Use `.cultexecs-active .component` for CULT EXEC overrides

#### Confirmed Shared Components

**WalletConnector** (`src/components/WalletConnector/`)
- Used by: CULT EXEC page (line 7 of CultExecsPage.js)
- Strategy: 
  - Keep existing styles that work for CULT EXEC
  - Add launchpad-specific overrides using `.launchpad-page` or `:not(.cultexecs-active)`
  - Test in both contexts

**MessagePopup** (`src/components/MessagePopup/`)
- Used by: CULT EXEC page (line 8 of CultExecsPage.js)
- Strategy:
  - Keep existing styles that work for CULT EXEC
  - Add launchpad-specific overrides
  - Test in both contexts

---

## 🔒 Isolation Rules

### Rule 1: Never Target CULT EXEC Selectors
```css
/* ❌ DON'T DO THIS */
body.cultexecs-active { ... }
.cultexecs-page { ... }

/* ✅ DO THIS INSTEAD */
body:not(.cultexecs-active) { ... }
.launchpad-page { ... }
```

### Rule 2: Use Specificity Wisely
```css
/* ✅ Global styles should be specific enough to not affect CULT EXEC */
.launchpad-container .project-card { ... }

/* ❌ Avoid global selectors that might affect CULT EXEC */
.project-card { ... } /* Too broad if CULT EXEC uses this class */
```

### Rule 3: Variable Isolation
```css
/* ✅ Global variables */
:root {
  --color-accent: #667eea; /* Launchpad accent */
}

/* ✅ CULT EXEC variables (already in cultexecs.css) */
body.cultexecs-active {
  --text-yellow: #fdb523; /* CULT EXEC accent */
}
```

---

## 📋 Pre-Merge Checklist

Before merging `styling-overhaul` into `main`:

### CULT EXEC Protection
- [ ] `cultexecs.css` unchanged (git diff shows no changes)
- [ ] CULT EXEC page renders identically
- [ ] All CULT EXEC terminal features work
- [ ] Dark theme preserved
- [ ] Monospace font preserved
- [ ] Terminal navigation unchanged

### Global Overhaul
- [ ] New design system implemented
- [ ] Global styles updated
- [ ] Component styles standardized
- [ ] Route styles modernized
- [ ] Responsive design improved
- [ ] Accessibility improved

### Testing
- [ ] Launchpad pages render correctly
- [ ] CULT EXEC page renders correctly
- [ ] No style conflicts between themes
- [ ] Mobile responsive
- [ ] Cross-browser tested

---

## 🚨 Emergency Rollback

If CULT EXEC styles are accidentally modified:

1. **Identify the change**: `git diff src/routes/cultexecs.css`
2. **Revert immediately**: `git checkout main -- src/routes/cultexecs.css`
3. **Review other files**: Check if `style.css` has CULT EXEC changes
4. **Test CULT EXEC page**: Verify restoration
5. **Document the issue**: Note what went wrong

---

## 📝 Notes

- CULT EXEC is a special project with its own terminal aesthetic
- The terminal theme is intentionally different from the launchpad
- Isolation is critical to preserve the CULT EXEC experience
- When in doubt, test the CULT EXEC page before committing

---

*Last Updated: Styling Overhaul Branch Creation*
*Status: Active Protection Plan*

