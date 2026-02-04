# Project Comment Feed Design

**Date:** 2026-01-22
**Status:** Ready for implementation

## Overview

A comment-section style component that displays user-written messages for a specific ERC1155 project. Shows only messages where users actually wrote something (filters out action-only entries).

## Placement

Below the EditionGallery in ContractTypeRouter (ERC1155 section).

## Data Source

- `GlobalMessageRegistryAdapter.getInstanceMessages(projectAddress, count)`
- Client-side filter: only show entries with non-empty `message` field
- Pagination via `getInstanceMessagesPaginated(projectAddress, offset, limit)`

## Visual Layout

### Comment Row Structure

```
[svg-avatar]  0xAbc...123                        2h ago
              "Love this edition, had to collect"
              minted Edition #2
```

- **Avatar:** 32x32px minimalist SVG generated from address (geometric shapes/scribble)
- **Address:** Truncated (0xAbc...123), top-left
- **Timestamp:** Right-aligned, relative time (2h ago, 3d ago)
- **Message:** Primary text, full opacity, gold emphasis
- **Action context:** Secondary line, silver/muted - "minted Edition #2" or "minted 3x Edition #1"

### Section Header

```
Comments (12)
─────────────────────────
[comment rows...]

      [Load more]
```

### Empty State

```
         💬
  Be the first to leave a comment
  Add a message when you mint an edition
```

Centered, inviting tone.

## Component Behavior

### Initial Load
- Fetch 20 messages from contract
- Filter to messages with non-empty `message` field
- Display first 10

### Pagination
- "Load more" button fetches next batch (20 at a time)
- Filter and append to existing list
- Hide button when no more messages exist

### Live Updates
- Listen to `eventBus.on('erc1155:mint:success')`
- On mint success, refetch recent messages to catch new comments
- Use `shouldUpdate()` pattern to avoid destroying child components

## Avatar Generation

Minimalist SVG generated deterministically from wallet address:
- 32x32px viewBox
- 2-3 geometric shapes (circles, lines, arcs)
- Position and color derived from address bytes
- Visually distinct per address, recognizable for repeat commenters

## File Structure

```
src/components/ProjectCommentFeed/
  ProjectCommentFeed.js
  ProjectCommentFeed.css
```

CSS imported where needed, not inlined in components.css.

## Styling

Temple of Capital design system:
- **Gold:** Comment text, header, emphasis
- **Silver:** Meta text, borders, secondary elements
- **Marble:** Background treatments

No bronze.

## Integration

### ContractTypeRouter Changes

In render() for ERC1155:
```javascript
<div class="erc1155-gallery" ref="erc1155-container">
    <!-- EditionGallery mounted here -->
</div>
<div class="erc1155-comments" ref="erc1155-comments">
    <!-- ProjectCommentFeed mounted here -->
</div>
```

In setupERC1155Components():
```javascript
// Mount ProjectCommentFeed after EditionGallery
const commentsContainer = this.getRef('erc1155-comments', '.erc1155-comments');
if (commentsContainer && !this._children.has('comment-feed')) {
    const commentFeed = new ProjectCommentFeed(this.projectId, adapter);
    const feedElement = document.createElement('div');
    commentsContainer.appendChild(feedElement);
    commentFeed.mount(feedElement);
    this.createChild('comment-feed', commentFeed);
}
```

## Related: Mint Interface Styling

The comment input lives in EditionMintInterface as a checkbox + text field. Styling improvements (separate task):
- Make message input more prominent when checkbox is checked
- Consider character count indicator if limit exists

## Dependencies

- GlobalMessageRegistryAdapter (exists)
- EventBus for mint success events (exists)
- ServiceFactory.getMessageRegistryAdapter() (exists)

## Notes

- Messages without user-written text are hidden (action-only entries filtered out)
- Action data visible elsewhere in project params
- Future: standalone comment posting (contract addition) would work with this UI
