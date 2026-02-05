/**
 * NFTGalleryPreview - Microact Version
 *
 * Shows limited NFT grid for NFT tab with link to full gallery.
 * Uses adapter pattern for multiple methods of getting NFT data.
 *
 * CANDIDATE FOR EventIndexer migration - see docs/plans/2026-02-04-contract-event-migration.md
 * Current pattern uses multiple fallback getters (totalNFTSupply, tokenByIndex, etc.)
 * Could be replaced by indexing Transfer events.
 */

import { Component, h } from '../../core/microact-setup.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

const PREVIEW_LIMIT = 12;

export class NFTGalleryPreview extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            nfts: [],
            totalCount: 0,
            error: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadNFTs();
    }

    async loadNFTs() {
        try {
            this.setState({ loading: true, error: null });

            let totalSupply = 0;

            // Try multiple methods to get total NFT count
            // NOTE: This is a candidate for EventIndexer - could index Transfer events instead
            if (typeof this.adapter?.totalNFTSupply === 'function') {
                try {
                    const supply = await this.adapter.totalNFTSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    // Continue to fallbacks
                }
            }

            if (totalSupply === 0 && typeof this.adapter?.getTotalNFTsMinted === 'function') {
                try {
                    const supply = await this.adapter.getTotalNFTsMinted();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    // Continue to fallbacks
                }
            }

            if (totalSupply === 0 && this.adapter?.mirrorContract) {
                try {
                    const supply = await this.adapter.mirrorContract.totalSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) {
                    // No fallbacks left
                }
            }

            const nfts = [];
            const limit = Math.min(PREVIEW_LIMIT, totalSupply);

            for (let i = 0; i < limit; i++) {
                try {
                    let tokenId = null;

                    // Try multiple methods to get tokenId by index
                    // NOTE: Could be replaced by EventIndexer query
                    if (typeof this.adapter?.tokenByIndex === 'function') {
                        try {
                            tokenId = await this.adapter.tokenByIndex(i);
                        } catch (e) { /* continue */ }
                    }

                    if (!tokenId && typeof this.adapter?.nftTokenByIndex === 'function') {
                        try {
                            tokenId = await this.adapter.nftTokenByIndex(i);
                        } catch (e) { /* continue */ }
                    }

                    if (!tokenId && this.adapter?.mirrorContract?.tokenByIndex) {
                        try {
                            tokenId = await this.adapter.mirrorContract.tokenByIndex(i);
                        } catch (e) { /* continue */ }
                    }

                    if (!tokenId && totalSupply > 0) {
                        tokenId = i + 1;
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

    async fetchTokenMetadata(tokenId) {
        let metadata = null;

        if (typeof this.adapter?.getTokenMetadata === 'function') {
            try {
                metadata = await this.adapter.getTokenMetadata(tokenId);
                if (metadata) return metadata;
            } catch (e) { /* continue */ }
        }

        let tokenUri = null;

        if (typeof this.adapter?.tokenURI === 'function') {
            try {
                tokenUri = await this.adapter.tokenURI(tokenId);
            } catch (e) { /* continue */ }
        }

        if (!tokenUri && typeof this.adapter?.getTokenUri === 'function') {
            try {
                tokenUri = await this.adapter.getTokenUri(tokenId);
            } catch (e) { /* continue */ }
        }

        if (!tokenUri && this.adapter?.mirrorContract?.tokenURI) {
            try {
                tokenUri = await this.adapter.mirrorContract.tokenURI(tokenId);
            } catch (e) { /* continue */ }
        }

        if (tokenUri) {
            try {
                metadata = await this.fetchMetadataFromUri(tokenUri);
            } catch (e) {
                console.warn('[NFTGalleryPreview] Failed to fetch metadata from URI:', tokenUri, e);
            }
        }

        if (!metadata && typeof this.adapter?.getStyle === 'function') {
            try {
                const styleUri = await this.adapter.getStyle();
                if (styleUri) {
                    metadata = { image: styleUri, name: `#${tokenId}` };
                }
            } catch (e) { /* no style */ }
        }

        return metadata;
    }

    async fetchMetadataFromUri(uri) {
        if (!uri) return null;

        if (uri.startsWith('data:application/json')) {
            try {
                const base64Data = uri.split(',')[1];
                const jsonStr = atob(base64Data);
                return JSON.parse(jsonStr);
            } catch (e) {
                return null;
            }
        }

        let fetchUrl = uri;
        if (uri.startsWith('ipfs://')) {
            fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        try {
            const response = await fetch(fetchUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    handleNFTClick(tokenId) {
        // Could emit event or navigate to NFT detail
        console.log('[NFTGalleryPreview] NFT clicked:', tokenId);
    }

    handleViewGallery() {
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate(`/project/${this.projectId}/gallery`);
        } else {
            window.location.href = `/project/${this.projectId}/gallery`;
        }
    }

    render() {
        const { loading, nfts, totalCount, error } = this.state;

        if (loading) {
            return h('div', { className: 'nft-gallery-preview loading' },
                h('div', { className: 'spinner' }),
                h('p', null, 'Loading NFTs...')
            );
        }

        if (error) {
            return h('div', { className: 'nft-gallery-preview error' },
                h('p', null, 'Failed to load NFTs'),
                h('p', { className: 'error-details' }, error)
            );
        }

        if (nfts.length === 0) {
            return h('div', { className: 'nft-gallery-preview empty' },
                h('div', { className: 'empty-state' },
                    h('p', { className: 'empty-title' }, 'No NFTs minted yet'),
                    h('p', { className: 'empty-subtext' }, 'NFTs are minted when token holders convert their balance')
                )
            );
        }

        return h('div', { className: 'nft-gallery-preview' },
            h('div', { className: 'nft-grid' },
                ...nfts.map(nft =>
                    h('div', {
                        className: 'nft-card',
                        'data-token-id': nft.tokenId,
                        key: nft.tokenId,
                        onClick: () => this.handleNFTClick(nft.tokenId)
                    },
                        h('div', { className: 'nft-image' },
                            nft.image
                                ? h('img', {
                                    src: nft.image.startsWith('ipfs://')
                                        ? nft.image.replace('ipfs://', 'https://ipfs.io/ipfs/')
                                        : nft.image,
                                    alt: nft.name,
                                    className: 'nft-img'
                                })
                                : h('div', { className: 'nft-placeholder' })
                        ),
                        h('div', { className: 'nft-name' }, nft.name)
                    )
                )
            ),

            totalCount > PREVIEW_LIMIT && h('div', { className: 'gallery-link' },
                h('a', {
                    href: `/project/${this.projectId}/gallery`,
                    onClick: (e) => {
                        e.preventDefault();
                        this.handleViewGallery();
                    }
                }, `View Full Gallery (${totalCount} NFTs) →`)
            )
        );
    }
}

export default NFTGalleryPreview;
