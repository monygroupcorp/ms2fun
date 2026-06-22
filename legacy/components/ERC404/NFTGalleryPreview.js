/**
 * NFTGalleryPreview Component
 * Shows limited NFT grid for NFT tab with link to full gallery
 */

import { Component } from '../../core/Component.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

const PREVIEW_LIMIT = 12;

export class NFTGalleryPreview extends Component {
    constructor(adapter, projectId) {
        super();
        this.adapter = adapter;
        this.projectId = projectId;
        this.state = {
            loading: true,
            nfts: [],
            totalCount: 0,
            error: null
        };
    }

    async onMount() {
        await this.loadNFTs();
    }

    /**
     * Load NFTs for preview
     * Tries multiple methods to get total count and NFT data
     */
    async loadNFTs() {
        try {
            this.setState({ loading: true, error: null });

            // Get total NFT count - try multiple methods
            let totalSupply = 0;

            // Try totalNFTSupply first (if adapter supports it)
            if (typeof this.adapter.totalNFTSupply === 'function') {
                try {
                    const supply = await this.adapter.totalNFTSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    console.warn('[NFTGalleryPreview] totalNFTSupply not available:', e);
                }
            }

            // Fallback: try getTotalNFTsMinted (some contracts use this)
            if (totalSupply === 0 && typeof this.adapter.getTotalNFTsMinted === 'function') {
                try {
                    const supply = await this.adapter.getTotalNFTsMinted();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    console.warn('[NFTGalleryPreview] getTotalNFTsMinted not available:', e);
                }
            }

            // Fallback: try mirror contract balanceOf with total supply calculation
            if (totalSupply === 0 && this.adapter.mirrorContract) {
                try {
                    // Some ERC404 contracts track total minted via mirror contract totalSupply
                    const supply = await this.adapter.mirrorContract.totalSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    console.warn('[NFTGalleryPreview] mirror totalSupply not available:', e);
                }
            }

            // Load NFTs up to preview limit
            const nfts = [];
            const limit = Math.min(PREVIEW_LIMIT, totalSupply);

            for (let i = 0; i < limit; i++) {
                try {
                    // Get tokenId by index - try multiple methods
                    let tokenId = null;

                    // Try tokenByIndex (ERC721Enumerable standard)
                    if (typeof this.adapter.tokenByIndex === 'function') {
                        try {
                            tokenId = await this.adapter.tokenByIndex(i);
                        } catch (e) {
                            // Method exists but call failed
                        }
                    }

                    // Fallback: try nftTokenByIndex
                    if (!tokenId && typeof this.adapter.nftTokenByIndex === 'function') {
                        try {
                            tokenId = await this.adapter.nftTokenByIndex(i);
                        } catch (e) {
                            // Method exists but call failed
                        }
                    }

                    // Fallback: try mirror contract tokenByIndex
                    if (!tokenId && this.adapter.mirrorContract && typeof this.adapter.mirrorContract.tokenByIndex === 'function') {
                        try {
                            tokenId = await this.adapter.mirrorContract.tokenByIndex(i);
                        } catch (e) {
                            // Method exists but call failed
                        }
                    }

                    // If still no tokenId, try using index directly (some contracts use sequential IDs)
                    if (!tokenId && totalSupply > 0) {
                        tokenId = i + 1; // Try 1-indexed
                    }

                    if (tokenId !== null) {
                        const metadata = await this.fetchTokenMetadata(tokenId);
                        nfts.push({
                            tokenId: tokenId.toString(),
                            image: metadata?.image || null,
                            name: metadata?.name || `#${tokenId}`
                        });
                    }
                } catch (e) {
                    console.warn('[NFTGalleryPreview] Error loading NFT at index', i, ':', e);
                }
            }

            this.setState({
                loading: false,
                nfts,
                totalCount: totalSupply
            });
        } catch (error) {
            console.error('[NFTGalleryPreview] Error:', error);
            this.setState({ loading: false, error: error.message || 'Failed to load NFTs' });
        }
    }

    /**
     * Fetch metadata for a token - tries multiple methods
     * @param {number|string} tokenId
     * @returns {Promise<Object|null>}
     */
    async fetchTokenMetadata(tokenId) {
        let metadata = null;

        // Try getTokenMetadata if available
        if (typeof this.adapter.getTokenMetadata === 'function') {
            try {
                metadata = await this.adapter.getTokenMetadata(tokenId);
                if (metadata) return metadata;
            } catch (e) {
                // Continue to fallbacks
            }
        }

        // Try tokenURI and fetch JSON
        let tokenUri = null;

        // Try adapter tokenURI
        if (typeof this.adapter.tokenURI === 'function') {
            try {
                tokenUri = await this.adapter.tokenURI(tokenId);
            } catch (e) {
                // Continue to fallbacks
            }
        }

        // Try adapter getTokenUri
        if (!tokenUri && typeof this.adapter.getTokenUri === 'function') {
            try {
                tokenUri = await this.adapter.getTokenUri(tokenId);
            } catch (e) {
                // Continue to fallbacks
            }
        }

        // Try mirror contract tokenURI
        if (!tokenUri && this.adapter.mirrorContract && typeof this.adapter.mirrorContract.tokenURI === 'function') {
            try {
                tokenUri = await this.adapter.mirrorContract.tokenURI(tokenId);
            } catch (e) {
                // Continue to fallbacks
            }
        }

        // If we have a tokenURI, try to fetch it
        if (tokenUri) {
            try {
                metadata = await this.fetchMetadataFromUri(tokenUri);
            } catch (e) {
                console.warn('[NFTGalleryPreview] Failed to fetch metadata from URI:', tokenUri, e);
            }
        }

        // Try getStyle as a fallback for image (some contracts store style/image URI separately)
        if (!metadata && typeof this.adapter.getStyle === 'function') {
            try {
                const styleUri = await this.adapter.getStyle();
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
     * Fetch metadata JSON from URI
     * @param {string} uri
     * @returns {Promise<Object|null>}
     */
    async fetchMetadataFromUri(uri) {
        if (!uri) return null;

        // Handle data URIs (base64 encoded JSON)
        if (uri.startsWith('data:application/json')) {
            try {
                const base64Data = uri.split(',')[1];
                const jsonStr = atob(base64Data);
                return JSON.parse(jsonStr);
            } catch (e) {
                console.warn('[NFTGalleryPreview] Failed to parse data URI:', e);
                return null;
            }
        }

        // Handle IPFS URIs
        let fetchUrl = uri;
        if (uri.startsWith('ipfs://')) {
            // Use a public gateway
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
            console.warn('[NFTGalleryPreview] Failed to fetch metadata from', fetchUrl, e);
            return null;
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="nft-gallery-preview loading">
                    <div class="spinner"></div>
                    <p>Loading NFTs...</p>
                </div>
            `;
        }

        const { nfts, totalCount, error } = this.state;

        if (error) {
            return `
                <div class="nft-gallery-preview error">
                    <p>Failed to load NFTs</p>
                    <p class="error-details">${this.escapeHtml(error)}</p>
                </div>
            `;
        }

        if (nfts.length === 0) {
            return `
                <div class="nft-gallery-preview empty">
                    <div class="empty-state">
                        <p class="empty-title">No NFTs minted yet</p>
                        <p class="empty-subtext">NFTs are minted when token holders convert their balance</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="nft-gallery-preview">
                <div class="nft-grid">
                    ${nfts.map(nft => `
                        <div class="nft-card" data-token-id="${this.escapeHtml(nft.tokenId)}">
                            <div class="nft-image">
                                ${nft.image ? renderIpfsImage(nft.image, nft.name, 'nft-img') : '<div class="nft-placeholder"></div>'}
                            </div>
                            <div class="nft-name">${this.escapeHtml(nft.name)}</div>
                        </div>
                    `).join('')}
                </div>

                ${totalCount > PREVIEW_LIMIT ? `
                    <div class="gallery-link">
                        <a href="/project/${this.escapeHtml(this.projectId)}/gallery">
                            View Full Gallery (${totalCount} NFTs) →
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    }

    afterRender() {
        // Enhance IPFS images with gateway rotation after render
        if (this._element) {
            enhanceAllIpfsImages(this._element);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
