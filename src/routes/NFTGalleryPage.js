/**
 * NFTGalleryPage - Full gallery view for ERC404 project NFTs
 * Route: /project/:id/gallery
 */

import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../utils/ipfsImageHelper.js';

/**
 * Escape HTML to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Fetch metadata JSON from URI
 * @param {string} uri
 * @returns {Promise<Object|null>}
 */
async function fetchMetadataFromUri(uri) {
    if (!uri) return null;

    // Handle data URIs (base64 encoded JSON)
    if (uri.startsWith('data:application/json')) {
        try {
            const base64Data = uri.split(',')[1];
            const jsonStr = atob(base64Data);
            return JSON.parse(jsonStr);
        } catch (e) {
            console.warn('[NFTGalleryPage] Failed to parse data URI:', e);
            return null;
        }
    }

    // Handle IPFS URIs
    let fetchUrl = uri;
    if (uri.startsWith('ipfs://')) {
        fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (e) {
        console.warn('[NFTGalleryPage] Failed to fetch metadata from', fetchUrl, e);
        return null;
    }
}

/**
 * Fetch metadata for a token - tries multiple methods
 * @param {Object} adapter - Contract adapter
 * @param {number|string} tokenId
 * @returns {Promise<Object|null>}
 */
async function fetchTokenMetadata(adapter, tokenId) {
    let metadata = null;

    // Try getTokenMetadata if available
    if (typeof adapter.getTokenMetadata === 'function') {
        try {
            metadata = await adapter.getTokenMetadata(tokenId);
            if (metadata) return metadata;
        } catch (e) {
            // Continue to fallbacks
        }
    }

    // Try tokenURI and fetch JSON
    let tokenUri = null;

    // Try adapter tokenURI
    if (typeof adapter.tokenURI === 'function') {
        try {
            tokenUri = await adapter.tokenURI(tokenId);
        } catch (e) {
            // Continue to fallbacks
        }
    }

    // Try adapter getTokenUri
    if (!tokenUri && typeof adapter.getTokenUri === 'function') {
        try {
            tokenUri = await adapter.getTokenUri(tokenId);
        } catch (e) {
            // Continue to fallbacks
        }
    }

    // Try mirror contract tokenURI
    if (!tokenUri && adapter.mirrorContract && typeof adapter.mirrorContract.tokenURI === 'function') {
        try {
            tokenUri = await adapter.mirrorContract.tokenURI(tokenId);
        } catch (e) {
            // Continue to fallbacks
        }
    }

    // If we have a tokenURI, try to fetch it
    if (tokenUri) {
        try {
            metadata = await fetchMetadataFromUri(tokenUri);
        } catch (e) {
            console.warn('[NFTGalleryPage] Failed to fetch metadata from URI:', tokenUri, e);
        }
    }

    // Try getStyle as a fallback for image
    if (!metadata && typeof adapter.getStyle === 'function') {
        try {
            const styleUri = await adapter.getStyle();
            if (styleUri) {
                metadata = { image: styleUri, name: `#${tokenId}` };
            }
        } catch (e) {
            // No style available
        }
    }

    return metadata;
}

/**
 * Load all NFTs for a project
 * @param {Object} adapter - Contract adapter
 * @returns {Promise<{nfts: Array, totalCount: number}>}
 */
async function loadAllNFTs(adapter) {
    // Get total NFT count - try multiple methods
    let totalSupply = 0;

    // Try totalNFTSupply first
    if (typeof adapter.totalNFTSupply === 'function') {
        try {
            const supply = await adapter.totalNFTSupply();
            totalSupply = parseInt(supply?.toString() || '0');
        } catch (e) {
            console.warn('[NFTGalleryPage] totalNFTSupply not available:', e);
        }
    }

    // Fallback: try getTotalNFTsMinted
    if (totalSupply === 0 && typeof adapter.getTotalNFTsMinted === 'function') {
        try {
            const supply = await adapter.getTotalNFTsMinted();
            totalSupply = parseInt(supply?.toString() || '0');
        } catch (e) {
            console.warn('[NFTGalleryPage] getTotalNFTsMinted not available:', e);
        }
    }

    // Fallback: try mirror contract totalSupply
    if (totalSupply === 0 && adapter.mirrorContract) {
        try {
            const supply = await adapter.mirrorContract.totalSupply();
            totalSupply = parseInt(supply?.toString() || '0');
        } catch (e) {
            console.warn('[NFTGalleryPage] mirror totalSupply not available:', e);
        }
    }

    // Load all NFTs
    const nfts = [];

    for (let i = 0; i < totalSupply; i++) {
        try {
            // Get tokenId by index - try multiple methods
            let tokenId = null;

            // Try tokenByIndex (ERC721Enumerable standard)
            if (typeof adapter.tokenByIndex === 'function') {
                try {
                    tokenId = await adapter.tokenByIndex(i);
                } catch (e) {
                    // Method exists but call failed
                }
            }

            // Fallback: try nftTokenByIndex
            if (!tokenId && typeof adapter.nftTokenByIndex === 'function') {
                try {
                    tokenId = await adapter.nftTokenByIndex(i);
                } catch (e) {
                    // Method exists but call failed
                }
            }

            // Fallback: try mirror contract tokenByIndex
            if (!tokenId && adapter.mirrorContract && typeof adapter.mirrorContract.tokenByIndex === 'function') {
                try {
                    tokenId = await adapter.mirrorContract.tokenByIndex(i);
                } catch (e) {
                    // Method exists but call failed
                }
            }

            // If still no tokenId, try using index directly (some contracts use sequential IDs)
            if (!tokenId && totalSupply > 0) {
                tokenId = i + 1; // Try 1-indexed
            }

            if (tokenId !== null) {
                const metadata = await fetchTokenMetadata(adapter, tokenId);
                nfts.push({
                    tokenId: tokenId.toString(),
                    image: metadata?.image || null,
                    name: metadata?.name || `#${tokenId}`
                });
            }
        } catch (e) {
            console.warn('[NFTGalleryPage] Error loading NFT at index', i, ':', e);
        }
    }

    return { nfts, totalCount: totalSupply };
}

/**
 * Render NFT Gallery Page
 * @param {Object} params - Route parameters
 * @param {string} params.id - Project ID (instance address)
 */
export async function renderNFTGalleryPage(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('[NFTGalleryPage] App containers not found');
        return;
    }

    // Clear containers
    appTopContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Get project ID from params
    const projectId = params?.id;
    if (!projectId) {
        appContainer.innerHTML = `
            <div class="nft-gallery-page">
                <div class="gallery-error">
                    <h2>Invalid Request</h2>
                    <p>No project ID provided.</p>
                    <a href="/" class="back-link">Go Home</a>
                </div>
            </div>
        `;
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/nft-gallery.css', 'nft-gallery-styles');

    // Show loading state
    appContainer.innerHTML = `
        <div class="nft-gallery-page">
            <div class="gallery-loading">
                <div class="spinner"></div>
                <p>Loading NFT gallery...</p>
            </div>
        </div>
    `;

    try {
        // Get project from registry
        const projectRegistry = serviceFactory.getProjectRegistry();
        let project = await projectRegistry.getProject(projectId);

        // Load project via projectService if not loaded
        if (!project) {
            const projectService = serviceFactory.getProjectService();
            project = await projectService.loadProject(projectId);
        }

        if (!project) {
            appContainer.innerHTML = `
                <div class="nft-gallery-page">
                    <div class="gallery-error">
                        <h2>Project Not Found</h2>
                        <p>The project "${escapeHtml(projectId)}" does not exist.</p>
                        <a href="/" class="back-link">Go Home</a>
                    </div>
                </div>
            `;
            return { cleanup: () => stylesheetLoader.unload('nft-gallery-styles') };
        }

        // Get adapter from projectService
        const projectService = serviceFactory.getProjectService();
        const adapter = await projectService.getAdapter(projectId);

        if (!adapter) {
            appContainer.innerHTML = `
                <div class="nft-gallery-page">
                    <div class="gallery-header">
                        <a href="/project/${escapeHtml(projectId)}" class="back-link">&larr; Back to Project</a>
                        <h1>${escapeHtml(project.name || 'Unknown Project')}</h1>
                    </div>
                    <div class="gallery-error">
                        <p>Could not load contract adapter.</p>
                    </div>
                </div>
            `;
            return { cleanup: () => stylesheetLoader.unload('nft-gallery-styles') };
        }

        // Load all NFTs
        const { nfts, totalCount } = await loadAllNFTs(adapter);

        // Render full gallery
        if (nfts.length === 0) {
            appContainer.innerHTML = `
                <div class="nft-gallery-page">
                    <div class="gallery-header">
                        <a href="/project/${escapeHtml(projectId)}" class="back-link">&larr; Back to Project</a>
                        <h1>${escapeHtml(project.name || 'Unknown Project')}</h1>
                        <p class="nft-count">0 NFTs</p>
                    </div>
                    <div class="gallery-empty">
                        <div class="empty-state">
                            <p class="empty-title">No NFTs minted yet</p>
                            <p class="empty-subtext">NFTs are minted when token holders convert their balance</p>
                        </div>
                    </div>
                </div>
            `;
        } else {
            appContainer.innerHTML = `
                <div class="nft-gallery-page">
                    <div class="gallery-header">
                        <a href="/project/${escapeHtml(projectId)}" class="back-link">&larr; Back to Project</a>
                        <h1>${escapeHtml(project.name || 'Unknown Project')}</h1>
                        <p class="nft-count">${totalCount} NFT${totalCount !== 1 ? 's' : ''}</p>
                    </div>

                    <div class="gallery-grid">
                        ${nfts.map(nft => `
                            <div class="nft-card" data-token-id="${escapeHtml(nft.tokenId)}">
                                <div class="nft-image">
                                    ${nft.image ? renderIpfsImage(nft.image, nft.name, 'nft-img') : '<div class="nft-placeholder"></div>'}
                                </div>
                                <div class="nft-name">${escapeHtml(nft.name)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Enhance IPFS images after render
            enhanceAllIpfsImages(appContainer);
        }

    } catch (error) {
        console.error('[NFTGalleryPage] Error:', error);
        appContainer.innerHTML = `
            <div class="nft-gallery-page">
                <div class="gallery-header">
                    <a href="/project/${escapeHtml(projectId)}" class="back-link">&larr; Back to Project</a>
                    <h1>NFT Gallery</h1>
                </div>
                <div class="gallery-error">
                    <h2>Error Loading Gallery</h2>
                    <p>${escapeHtml(error.message || 'An unexpected error occurred')}</p>
                </div>
            </div>
        `;
    }

    // Return cleanup function
    return {
        cleanup: () => {
            stylesheetLoader.unload('nft-gallery-styles');
        }
    };
}
