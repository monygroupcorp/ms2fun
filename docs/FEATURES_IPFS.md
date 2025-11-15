# IPFS Image Resolver Feature

## Overview

The IPFS Image Resolver feature provides robust client-side IPFS support for images and metadata in the MS2 application. It handles both direct IPFS image URLs and metadata-first flows where metadata is fetched from IPFS and then contains IPFS image URLs.

**Key Features:**
- Automatic detection of `ipfs://` URIs
- Gateway rotation with fallback on failure
- Support for both direct image URLs and metadata URLs
- Graceful error handling with user-friendly placeholders
- No backend or secrets required - pure client-side implementation
- Works with static hosting (GitHub Pages)

## Architecture

### Core Components

1. **IpfsService** (`src/services/IpfsService.js`)
   - Core IPFS resolution logic
   - Gateway list management
   - IPFS URI detection and normalization
   - HTTP URL construction
   - JSON fetching with gateway rotation

2. **IpfsImage Component** (`src/components/IpfsImage/IpfsImage.js`)
   - React-style component for IPFS-aware image rendering
   - Gateway rotation on image load failure
   - Loading and error states

3. **ipfsImageHelper** (`src/utils/ipfsImageHelper.js`)
   - Helper functions for string-based HTML rendering
   - Works with Component system's render methods
   - Post-render enhancement for gateway rotation

### Integration Points

The IPFS resolver is integrated into:

- **EditionCard** - Edition images in gallery view
- **EditionDetail** - Full-size edition images
- **PortfolioModal** - NFT portfolio images
- **Metadata fetching** - PortfolioModal uses IPFS-aware JSON fetching

## How IPFS URLs Are Handled

### Direct Image URLs

When an image URL starts with `ipfs://`, the system:

1. **Detects** the IPFS URI using `isIpfsUri()`
2. **Normalizes** the path by removing the `ipfs://` prefix
3. **Resolves** to HTTP using the first available gateway
4. **Rotates** to next gateway if image fails to load
5. **Shows error** placeholder if all gateways fail

Example:
```javascript
// Input: ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
// Resolved to: https://w3s.link/ipfs/QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o
```

### Metadata-First Flows

When metadata is fetched from IPFS:

1. **Detects** IPFS URI in `metadataUrl` field
2. **Fetches JSON** using `fetchJsonWithIpfsSupport()` with gateway rotation
3. **Extracts** `image` field from JSON
4. **Preserves** IPFS URIs in image field (doesn't convert to HTTP)
5. **Renders** image using IPFS resolver

Example flow:
```javascript
// 1. Metadata URL: ipfs://QmExample1
// 2. Fetch JSON from gateway
// 3. JSON contains: { "image": "ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o" }
// 4. Image URL preserved as IPFS URI
// 5. Image rendered with gateway rotation
```

### Gateway Rotation

The system tries gateways in this order:

1. Custom gateway (from localStorage, if set)
2. w3s.link
3. cloudflare-ipfs.com
4. ipfs.io
5. gateway.pinata.cloud
6. dweb.link

If a gateway fails (timeout, HTTP error, or image load error), the system automatically tries the next gateway. Only after all gateways fail does it show an error state.

## Adding New Gateways

To add a new IPFS gateway:

1. **Edit** `src/services/IpfsService.js`
2. **Add** gateway URL to `IPFS_GATEWAYS` array:

```javascript
const IPFS_GATEWAYS = [
    'https://w3s.link/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/',
    'https://your-new-gateway.com/ipfs/'  // Add here
];
```

3. **Test** the gateway to ensure it works correctly
4. **Document** any special requirements or limitations

### Custom Gateway (User Preference)

Users can set a custom gateway via localStorage:

```javascript
import { setCustomGateway } from './services/IpfsService.js';

// Set custom gateway
setCustomGateway('https://my-gateway.com/ipfs/');

// Remove custom gateway
setCustomGateway(null);
```

The custom gateway is always tried first before the public gateway list.

## Mock Data for Testing

### Adding IPFS URIs to Mock Data

Mock data is located in `src/services/mock/exampleData.js`. To add IPFS test data:

#### Direct IPFS Image URLs

```javascript
{
    displayTitle: 'My Edition',
    editionId: 1,
    image: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'  // Direct IPFS image
}
```

#### IPFS Metadata URI

```javascript
{
    name: 'My Project',
    metadataURI: 'ipfs://QmExample1',  // IPFS metadata URL
    imageURI: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'  // Direct IPFS image
}
```

#### Mixed Testing (IPFS + HTTP)

For comprehensive testing, mix IPFS and HTTP URLs:

```javascript
const pieces = [
    {
        image: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'  // IPFS
    },
    {
        image: 'https://images.unsplash.com/photo-...'  // HTTP
    }
];
```

### Test Scenarios

1. **Direct IPFS Image**
   - Set `image` or `imageURI` to `ipfs://...`
   - Verify image loads through gateway rotation
   - Verify error handling if CID is invalid

2. **IPFS Metadata → IPFS Image**
   - Set `metadataURI` to `ipfs://...`
   - Ensure metadata JSON contains `image: "ipfs://..."`
   - Verify metadata fetch works with gateway rotation
   - Verify image loads after metadata is fetched

3. **Mixed Content**
   - Mix IPFS and HTTP URLs in same collection
   - Verify backward compatibility with HTTP URLs
   - Verify IPFS URLs still work correctly

4. **Gateway Failure**
   - Use invalid CID or unreachable gateway
   - Verify graceful fallback to next gateway
   - Verify error placeholder shows after all gateways fail

## Usage Examples

### Using renderIpfsImage Helper

```javascript
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';

// In component render method
render() {
    const imageUrl = this.edition.metadata?.image || '/placeholder.png';
    const name = this.edition.metadata?.name || 'Edition';
    
    return `
        <div class="edition-card">
            ${renderIpfsImage(imageUrl, name, 'edition-image', { loading: 'lazy' })}
        </div>
    `;
}
```

### Using fetchJsonWithIpfsSupport

```javascript
import { fetchJsonWithIpfsSupport } from '../../services/IpfsService.js';

async function loadMetadata(metadataUrl) {
    try {
        const json = await fetchJsonWithIpfsSupport(metadataUrl);
        // json.image might be ipfs://... or https://...
        return json;
    } catch (error) {
        console.error('Failed to fetch metadata:', error);
        return null;
    }
}
```

### Using IpfsImage Component

```javascript
import { IpfsImage } from '../../components/IpfsImage/IpfsImage.js';

const ipfsImage = new IpfsImage({
    src: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
    alt: 'My IPFS Image',
    className: 'my-image',
    onLoad: () => console.log('Image loaded!'),
    onError: () => console.log('Image failed!')
});

const container = document.createElement('div');
ipfsImage.mount(container);
```

## Error Handling

### Image Load Failures

- **Single gateway failure**: Automatically tries next gateway
- **All gateways fail**: Shows error placeholder with message "IPFS image unavailable"
- **Invalid CID**: Tries all gateways, then shows error
- **Network timeout**: Default 5 seconds per gateway, then tries next

### Metadata Fetch Failures

- **Single gateway failure**: Automatically tries next gateway
- **All gateways fail**: Throws error with list of attempted gateways
- **Invalid JSON**: Throws parsing error
- **Network timeout**: Default 10 seconds per gateway

### User Experience

- Errors are logged to console for debugging
- UI shows graceful placeholder instead of broken image
- No alerts or popups - errors are handled silently
- Layout remains stable (no layout shift on error)

## Performance Considerations

### Gateway Selection

- First gateway (w3s.link) is typically fastest
- Custom gateway (if set) is tried first
- Gateways are tried sequentially (not in parallel) to avoid unnecessary requests

### Caching

- Browser caching applies to resolved HTTP URLs
- Same IPFS CID resolves to same HTTP URL per gateway
- No custom caching layer - relies on browser cache

### Timeouts

- Image load timeout: 5 seconds per gateway
- Metadata fetch timeout: 10 seconds per gateway
- Configurable via function parameters

## Limitations

1. **No IPFS Node**: This is a "light client" - it only uses HTTP gateways, not a full IPFS node
2. **Gateway Dependency**: Requires at least one public gateway to be available
3. **CID Validation**: Does not validate CID format (relies on gateway to reject invalid CIDs)
4. **Background Images**: Currently only supports `<img>` tags, not CSS `background-image` (can be added if needed)

## Future Enhancements

Potential improvements:

1. **Parallel Gateway Testing**: Test multiple gateways in parallel for faster resolution
2. **Gateway Health Monitoring**: Track gateway success rates and prioritize healthy gateways
3. **CID Validation**: Validate CID format before attempting resolution
4. **Background Image Support**: Add support for CSS background-image with IPFS
5. **IPFS Node Integration**: Optional integration with browser IPFS node (js-ipfs) for true peer-to-peer

## Troubleshooting

### Images Not Loading

1. Check browser console for error messages
2. Verify IPFS URI format: `ipfs://Qm...` (not `ipfs:///Qm...`)
3. Test gateway manually: `https://w3s.link/ipfs/Qm...`
4. Check if CID is valid and content exists on IPFS

### Gateway Rotation Not Working

1. Verify `enhanceAllIpfsImages()` is called after render
2. Check that images have `data-ipfs-uri` attribute
3. Verify IPFS service is imported correctly

### Metadata Fetch Failing

1. Verify metadata URL is correct IPFS URI
2. Check that metadata JSON is valid
3. Verify gateway is accessible (test manually)
4. Check timeout settings (may need to increase)

## Related Files

- `src/services/IpfsService.js` - Core IPFS service
- `src/components/IpfsImage/IpfsImage.js` - IPFS image component
- `src/utils/ipfsImageHelper.js` - Helper functions for HTML rendering
- `src/components/ERC1155/EditionCard.js` - Example integration
- `src/components/ERC1155/EditionDetail.js` - Example integration
- `src/components/PortfolioModal/PortfolioModal.js` - Example metadata fetching
- `src/services/mock/exampleData.js` - Mock data with IPFS URIs
- `docs/DEV_IPFS_NOTES.md` - Development investigation notes

