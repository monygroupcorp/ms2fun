/**
 * NFTGalleryPreview - Microact Version
 *
 * Paginated NFT grid for the NFT tab with skeleton loading states.
 * Uses DN404 mirror contract to enumerate minted NFTs.
 */

import { Component, h } from '../../core/microact-setup.js';
import { NFTDetailModal } from './NFTDetailModal.microact.js';

const PAGE_SIZE = 24;

export class NFTGalleryPreview extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            nfts: [],
            totalCount: 0,
            page: 0,
            error: null,
            selectedTokenId: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadPage(0);
    }

    async loadPage(page) {
        try {
            this.setState({ loading: true, error: null, page });

            let totalSupply = 0;

            // Get total NFT count from mirror contract or adapter
            if (this.adapter?.mirrorContract) {
                try {
                    const supply = await this.adapter.mirrorContract.totalSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) { /* continue */ }
            }

            if (totalSupply === 0 && typeof this.adapter?.totalNFTSupply === 'function') {
                try {
                    const supply = await this.adapter.totalNFTSupply();
                    totalSupply = parseInt(supply?.toString() || '0');
                } catch (e) { /* continue */ }
            }

            const start = page * PAGE_SIZE;
            const end = Math.min(start + PAGE_SIZE, totalSupply);
            const nfts = [];

            // Fetch page of NFTs in parallel batches
            const tokenIds = [];
            for (let i = start; i < end; i++) {
                tokenIds.push(this.getTokenIdAtIndex(i, totalSupply));
            }
            const resolvedIds = await Promise.all(tokenIds);

            // Fetch metadata in parallel
            const metadataPromises = resolvedIds.map(async (tokenId) => {
                if (tokenId === null) return null;
                const metadata = await this.fetchTokenMetadata(tokenId);
                return {
                    tokenId: tokenId.toString(),
                    image: metadata?.image || null,
                    name: metadata?.name || `#${tokenId}`
                };
            });
            const results = await Promise.all(metadataPromises);
            results.forEach(r => { if (r) nfts.push(r); });

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

    async getTokenIdAtIndex(index, totalSupply) {
        if (this.adapter?.mirrorContract?.tokenByIndex) {
            try {
                return await this.adapter.mirrorContract.tokenByIndex(index);
            } catch (e) { /* continue */ }
        }
        if (typeof this.adapter?.tokenByIndex === 'function') {
            try {
                return await this.adapter.tokenByIndex(index);
            } catch (e) { /* continue */ }
        }
        // Fallback: assume sequential IDs
        return totalSupply > 0 ? index + 1 : null;
    }

    async fetchTokenMetadata(tokenId) {
        // Try adapter method first
        if (typeof this.adapter?.getTokenMetadata === 'function') {
            try {
                const metadata = await this.adapter.getTokenMetadata(tokenId);
                if (metadata) return metadata;
            } catch (e) { /* continue */ }
        }

        // Try tokenURI
        let tokenUri = null;
        if (typeof this.adapter?.tokenURI === 'function') {
            try { tokenUri = await this.adapter.tokenURI(tokenId); } catch (e) { /* continue */ }
        }
        if (!tokenUri && typeof this.adapter?.getTokenUri === 'function') {
            try { tokenUri = await this.adapter.getTokenUri(tokenId); } catch (e) { /* continue */ }
        }
        if (!tokenUri && this.adapter?.mirrorContract?.tokenURI) {
            try { tokenUri = await this.adapter.mirrorContract.tokenURI(tokenId); } catch (e) { /* continue */ }
        }

        if (tokenUri) {
            try {
                return await this.fetchMetadataFromUri(tokenUri);
            } catch (e) { /* continue */ }
        }

        return null;
    }

    async fetchMetadataFromUri(uri) {
        if (!uri) return null;

        if (uri.startsWith('data:application/json')) {
            try {
                const base64Data = uri.split(',')[1];
                return JSON.parse(atob(base64Data));
            } catch (e) { return null; }
        }

        let fetchUrl = uri;
        if (uri.startsWith('ipfs://')) {
            fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        try {
            const response = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } });
            if (!response.ok) return null;
            return await response.json();
        } catch (e) { return null; }
    }

    handlePageChange(newPage) {
        this.loadPage(newPage);
    }

    handleNFTClick(tokenId) {
        this.setState({ selectedTokenId: tokenId });
    }

    handleCloseModal() {
        this.setState({ selectedTokenId: null });
    }

    shouldUpdate(oldProps, newProps, oldState, newState) {
        if (oldState.loading !== newState.loading) return true;
        if (oldState.page !== newState.page) return true;
        if (oldState.nfts !== newState.nfts) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.selectedTokenId !== newState.selectedTokenId) return true;
        return false;
    }

    renderSkeleton() {
        const cards = [];
        for (let i = 0; i < PAGE_SIZE; i++) {
            cards.push(
                h('div', { key: `skel-${i}`, className: 'nft-card nft-card--skeleton' },
                    h('div', { className: 'nft-image' },
                        h('div', { className: 'skeleton skeleton-square' })
                    ),
                    h('div', { className: 'nft-name' },
                        h('div', { className: 'skeleton skeleton-text short' })
                    )
                )
            );
        }
        return h('div', { className: 'nft-grid' }, ...cards);
    }

    renderPagination() {
        const { page, totalCount } = this.state;
        const totalPages = Math.ceil(totalCount / PAGE_SIZE);
        if (totalPages <= 1) return null;

        return h('div', { className: 'nft-pagination' },
            h('button', {
                className: 'pagination-btn',
                disabled: page === 0,
                onClick: () => this.handlePageChange(page - 1)
            }, 'Prev'),
            h('span', { className: 'pagination-info' },
                `${page + 1} / ${totalPages}`
            ),
            h('button', {
                className: 'pagination-btn',
                disabled: page >= totalPages - 1,
                onClick: () => this.handlePageChange(page + 1)
            }, 'Next')
        );
    }

    render() {
        const { loading, nfts, totalCount, error, selectedTokenId } = this.state;

        if (loading) {
            return h('div', { className: 'nft-gallery-preview' },
                h('div', { className: 'nft-gallery-header' },
                    h('span', { className: 'nft-count' }, 'Loading...')
                ),
                this.renderSkeleton()
            );
        }

        if (error) {
            return h('div', { className: 'nft-gallery-preview error' },
                h('p', null, 'Failed to load NFTs'),
                h('p', { className: 'error-details' }, error)
            );
        }

        if (totalCount === 0) {
            return h('div', { className: 'nft-gallery-preview empty' },
                h('div', { className: 'empty-state' },
                    h('p', { className: 'empty-title' }, 'No NFTs minted yet'),
                    h('p', { className: 'empty-subtext' }, 'NFTs are minted when token holders convert their balance')
                )
            );
        }

        return h('div', { className: 'nft-gallery-preview' },
            h('div', { className: 'nft-gallery-header' },
                h('span', { className: 'nft-count' }, `${totalCount} NFTs minted`)
            ),
            h('div', { className: 'nft-grid' },
                ...nfts.map(nft =>
                    h('div', {
                        className: 'nft-card',
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
                                    className: 'nft-img',
                                    loading: 'lazy'
                                })
                                : h('div', { className: 'nft-placeholder' })
                        ),
                        h('div', { className: 'nft-name' }, nft.name)
                    )
                )
            ),
            this.renderPagination(),

            selectedTokenId && h(NFTDetailModal, {
                adapter: this.adapter,
                tokenId: selectedTokenId,
                onClose: () => this.handleCloseModal()
            })
        );
    }
}

export default NFTGalleryPreview;
