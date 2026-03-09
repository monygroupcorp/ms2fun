# ERC1155 Project Page Wiring

**Date:** 2026-03-03
**Status:** Approved

## Goal

Wire the existing disconnected ERC1155 components so navigating to an ERC1155 project actually renders the edition gallery with real data. Swap v1 class names to v2 demo class names. No new features (stats bar, vault alignment, tabs, mint) — just plumbing and class name alignment.

## Architecture

**Data flow:**
```
Route handler (ProjectDetail.js)
  → ProjectDetail (loads project from registry)
    → ContractTypeRouter (loads adapter via ProjectService)
      → ERC1155ProjectPage (loads custom project style, renders header)
        → EditionGallery (loads editions from adapter)
          → EditionCard (renders each edition)
```

Follows the same pattern as ERC404: ContractTypeRouter dispatches to a type-specific page component.

## Files to Modify

### 1. ProjectDetail.microact.js
- Import ContractTypeRouter
- Replace placeholder div with `h(ContractTypeRouter, { projectId, contractType })`

### 2. ContractTypeRouter.microact.js
- Import ERC1155ProjectPage
- In ERC1155 branch: mount `h(ERC1155ProjectPage, { projectId, adapter, project })`

### 3. EditionGallery.microact.js
- Remove project style loading logic (moved to ERC1155ProjectPage)
- Swap to v2 demo class names: `.gallery-grid`, `.edition-gallery`
- Remove `marble-bg` classes

### 4. EditionCard.microact.js
- Swap to v2 demo class names: `.edition-card`, `.edition-image`, `.edition-info`, `.edition-header`, `.edition-name`, `.edition-id`, `.edition-stats`, `.edition-stat-item`, `.edition-mint`
- Remove `marble-bg` classes

## Files to Create

### 1. src/components/ERC1155/ERC1155ProjectPage.microact.js
- Page-level component mirroring ERC404ProjectPage pattern
- `didMount()`: loads custom project style via `adapter.getStyle()`
- `render()`: project header (`.project-header`, `.project-type-badge`, `.project-title`, `.project-description`, `.project-meta`) + EditionGallery child
- Cleanup: removes custom stylesheet on unmount

## Custom Project Style Loading

Relocated from EditionGallery to ERC1155ProjectPage:
- `adapter.getStyle()` → returns stylesheet URI
- Apply as `<link>` tag with `data-stylesheet-id`
- Cache in `localStorage` for fast reload
- Clean up classes and link on unmount

## Not In Scope

- Stats bar (editions count, total minted, volume, collectors)
- Vault alignment section
- Tabs (Gallery / About / Activity)
- Mint button functionality
- Creator dashboard / admin mode
- ERC404 page wiring (separate task)
