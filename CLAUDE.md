# Claude Code Rules for ms2fun

Project-specific rules and conventions for AI-assisted development.

---

## Mandatory Rules

### 0. No Co-Authored-By in Commits

Do NOT add "Co-Authored-By" lines to git commit messages.

---

### 1. Log Library Friction to Improvements Doc

When encountering friction with the component system (microact) or web3 utilities (micro-web3):

1. **Apply a workaround** to keep the task moving
2. **Update `docs/plans/MICROACT_IMPROVEMENTS.md`** with:
   - Problem encountered
   - Workaround applied
   - Desired behavior
   - Acceptance criteria
3. **Add entry to Issues Log table** at bottom of that doc

This ensures real-world pain points feed directly into library improvements.

**Triggers:**
- `shouldUpdate()` override needed to prevent child destruction
- Manual DOM manipulation to avoid re-render
- Timing hacks with `setTimeout` for component mounting
- Contract adapter method missing or awkward
- Wallet connection edge cases
- Transaction state management issues

---

### 2. Follow Naming Conventions

See `docs/NAMING_CONVENTIONS.md` for component, route, and service naming patterns.

**Quick reference:**
- `*Page` / `*Route` - Route-level components
- `*View` - Major view sections
- `*Panel` - Self-contained UI sections
- `*Card` - Compact display units for lists
- `*Form` - User input collection
- `*Interface` - Complex interactive UI

---

### 3. CSS in components.css for Shared Styles

Component-specific styles that need to work across the app go in `src/core/components.css`, not in separate CSS files via `<link>` tags.

---

## Guidelines

### Component Architecture Workarounds

Until microact VDOM is implemented, use these patterns:

**Preventing child destruction:**
```javascript
shouldUpdate(oldState, newState) {
    // Only re-render for structural changes
    if (oldState.loading !== newState.loading) return true;
    if (oldState.data !== newState.data) return true;

    // Update DOM directly for minor state changes
    if (oldState.balance !== newState.balance) {
        this.updateBalanceDisplay(newState.balance);
        return false;
    }
    return false;
}
```

**Always log these workarounds to MICROACT_IMPROVEMENTS.md**

---

### Debug Logging

When debugging component issues, add temporary logs with component name prefix:
```javascript
console.log('[ComponentName] description:', data);
```

Remove debug logs before committing unless they provide ongoing value.

---

## Reference Docs

- `docs/NAMING_CONVENTIONS.md` - Component and file naming
- `docs/DESIGN_SYSTEM.md` - Temple of Capital UI patterns
- `docs/FRONTEND_ARCHITECTURE.md` - System architecture
- `docs/plans/MICROACT_IMPROVEMENTS.md` - Library improvement tracker
