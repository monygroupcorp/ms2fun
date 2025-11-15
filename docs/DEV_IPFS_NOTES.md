# IPFS Image Resolver - Investigation Notes

## 1. Image Loading Pipeline

### Components Rendering Images

1. **PortfolioModal.js** (`src/components/PortfolioModal/PortfolioModal.js`)
   - Renders NFT images using `nft.imageUrl`
   - Fetches metadata from `nft.metadata` URL via `fetchMetadataContent()`
   - Extracts `image` field from JSON metadata
   - Line 160: `<img src="${nft.imageUrl}" alt="..." class="nft-image">`
   - Lines 269-292: Metadata fetching logic

2. **EditionCard.js** (`src/components/ERC1155/EditionCard.js`)
   - Renders edition images using `edition.metadata?.image || edition.metadata?.image_url`
   - Line 101-103: Image URL extraction
   - Line 117: `<img src="${this.escapeHtml(imageUrl)}" alt="..." loading="lazy" />`

3. **EditionDetail.js** (`src/components/ERC1155/EditionDetail.js`)
   - Same pattern as EditionCard
   - Line 80-82: Image URL extraction
   - Line 107: `<img src="${this.escapeHtml(imageUrl)}" alt="..." class="edition-main-image" />`

4. **ProjectCard.js** (`src/components/ProjectDiscovery/ProjectCard.js`)
   - Uses `project.imageURI || project.image` for project images
   - Line 75-76: Image extraction
   - Line 77: Background image style

5. **ProjectDiscovery.js** (`src/components/ProjectDiscovery/ProjectDiscovery.js`)
   - Same pattern as ProjectCard
   - Line 552-553: Image extraction
   - Line 554: Background image style

### Image URL Sources

- **Direct image URLs**: `imageUrl`, `image`, `imageURI`, `image_url`
- **Metadata URLs**: `metadata`, `metadataURI`, `metadata_url`
- **Metadata extraction**: PortfolioModal fetches JSON and extracts `image` field

### Current Loading/Error Handling

- No explicit loading states for images (browser default)
- No error handling for failed image loads
- No IPFS gateway rotation
- Metadata fetching has basic error handling (catch block, console.error)

## 2. Mock System

### Mock Data Structure

- **Location**: `src/services/mock/mockData.js`
- **Storage**: localStorage with key `mockLaunchpadData`
- **Example Data**: `src/services/mock/exampleData.js`

### Current Mock Image URLs

- Example data uses HTTP URLs (Unsplash images)
- Some metadata URIs are `ipfs://` placeholders (e.g., `ipfs://QmExample1`)
- No actual IPFS resolution happening

### Where to Add IPFS Test Data

- `src/services/mock/exampleData.js` - Add IPFS URIs to:
  - `metadataURI` fields (already has `ipfs://` placeholders)
  - `image` fields in pieces (currently HTTP URLs)
  - Project `imageURI` fields

## 3. Shared Utilities

### Existing Utilities

- **Component.js**: Base component class with state management
- **utils/**: Various utility functions
- **services/**: Service layer (BlockchainService, ContractService, etc.)

### Where to Add IPFS Service

- **Recommended**: `src/services/IpfsService.js` or `src/utils/ipfsResolver.js`
- Should be a pure utility/service (no component dependencies)
- Can be used by components and other services

### Existing HTTP/Fetch Patterns

- Standard `fetch()` API used throughout
- No centralized HTTP client wrapper
- Error handling is per-component

## 4. Integration Points Summary

### Entry Points for IPFS Support

1. **Direct Image Rendering**:
   - Replace `<img src="...">` with `<IpfsImage src="...">` in:
     - PortfolioModal.js (line 160)
     - EditionCard.js (line 117)
     - EditionDetail.js (line 107)

2. **Metadata Fetching**:
   - Update `PortfolioModal.fetchMetadataContent()` (line 269)
   - Use IPFS-aware fetch helper for `nft.metadata` URLs

3. **Project Images**:
   - Update ProjectCard.js and ProjectDiscovery.js
   - Handle `project.imageURI` that might be IPFS

4. **Mock Data**:
   - Add IPFS URIs to exampleData.js
   - Test both direct IPFS images and IPFS metadata → IPFS image flows

## 5. Component Architecture

### Component Base Class

- `src/core/Component.js` - Base class with:
  - State management (`setState()`)
  - Lifecycle hooks
  - Event handling
  - DOM updates

### Creating IpfsImage Component

- Should extend `Component` class
- Use `useState`-like pattern via `setState()`
- Handle loading/error states
- Gateway rotation logic

## 6. Loading States & UX

### Existing Loading Patterns

- No dedicated loading components found
- Browser default image loading behavior
- No skeleton/spinner components for images

### Recommendations

- Create simple loading placeholder (spinner or skeleton)
- Maintain stable layout (fixed dimensions or aspect ratio)
- Graceful error UI (placeholder icon + message)

