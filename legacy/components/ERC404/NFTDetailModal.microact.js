/**
 * NFTDetailModal - Microact Version
 *
 * Modal overlay showing NFT image, metadata attributes, and owner.
 * Opened from NFTGalleryPreview when a card is clicked.
 */

import { Component, h } from '../../core/microact-setup.js';

export class NFTDetailModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            owner: null,
            metadata: null,
            error: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    get tokenId() {
        return this.props.tokenId;
    }

    async didMount() {
        // Close on Escape
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.handleClose();
        };
        document.addEventListener('keydown', this._onKeyDown);
        this.registerCleanup(() => document.removeEventListener('keydown', this._onKeyDown));

        await this.loadDetails();
    }

    async loadDetails() {
        try {
            this.setState({ loading: true, error: null });

            const mirror = this.adapter?.mirrorContract;
            if (!mirror) {
                this.setState({ loading: false, error: 'Mirror contract not available' });
                return;
            }

            const [ownerAddr, tokenUri] = await Promise.all([
                mirror.ownerOf(this.tokenId).catch(() => null),
                mirror.tokenURI(this.tokenId).catch(() => null)
            ]);

            let metadata = null;
            if (tokenUri) {
                metadata = await this.parseMetadata(tokenUri);
            }

            this.setState({
                loading: false,
                owner: ownerAddr,
                metadata
            });
        } catch (error) {
            console.error('[NFTDetailModal] Error:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    async parseMetadata(uri) {
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

    handleClose() {
        if (this.props.onClose) {
            this.props.onClose();
        }
    }

    handleBackdropClick(e) {
        if (e.target === e.currentTarget) {
            this.handleClose();
        }
    }

    truncateAddress(address) {
        if (!address || address.length < 10) return address || '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    renderAttributes(attributes) {
        if (!attributes || !Array.isArray(attributes) || attributes.length === 0) return null;

        return h('div', { className: 'nft-detail-attributes' },
            h('div', { className: 'nft-detail-section-title' }, 'Attributes'),
            h('div', { className: 'nft-attributes-grid' },
                ...attributes.map((attr, i) =>
                    h('div', { key: `attr-${i}`, className: 'nft-attribute' },
                        h('div', { className: 'nft-attribute-type' }, attr.trait_type || 'Property'),
                        h('div', { className: 'nft-attribute-value' }, String(attr.value ?? ''))
                    )
                )
            )
        );
    }

    renderSkeleton() {
        return h('div', { className: 'nft-detail-content' },
            h('div', { className: 'nft-detail-image' },
                h('div', { className: 'skeleton skeleton-square' })
            ),
            h('div', { className: 'nft-detail-info' },
                h('div', { className: 'skeleton skeleton-text title', style: 'width: 60%; margin-bottom: 12px;' }),
                h('div', { className: 'skeleton skeleton-text medium', style: 'width: 40%; margin-bottom: 8px;' }),
                h('div', { className: 'skeleton skeleton-text medium', style: 'width: 80%;' })
            )
        );
    }

    render() {
        const { loading, owner, metadata, error } = this.state;
        const image = metadata?.image;
        const name = metadata?.name || `#${this.tokenId}`;
        const description = metadata?.description;
        const attributes = metadata?.attributes;

        let imageSrc = null;
        if (image) {
            imageSrc = image.startsWith('ipfs://')
                ? image.replace('ipfs://', 'https://ipfs.io/ipfs/')
                : image;
        }

        return h('div', {
            className: 'nft-detail-modal-backdrop',
            onClick: this.bind(this.handleBackdropClick)
        },
            h('div', { className: 'nft-detail-modal' },
                h('button', {
                    className: 'nft-detail-close',
                    onClick: this.bind(this.handleClose)
                }, 'X'),

                loading ? this.renderSkeleton() :
                error ? h('div', { className: 'nft-detail-error' }, error) :

                h('div', { className: 'nft-detail-content' },
                    h('div', { className: 'nft-detail-image' },
                        imageSrc
                            ? h('img', { src: imageSrc, alt: name, className: 'nft-detail-img' })
                            : h('div', { className: 'nft-detail-placeholder' })
                    ),
                    h('div', { className: 'nft-detail-info' },
                        h('h2', { className: 'nft-detail-name' }, name),

                        h('div', { className: 'nft-detail-meta' },
                            h('div', { className: 'nft-detail-row' },
                                h('span', { className: 'nft-detail-label' }, 'Token ID'),
                                h('span', { className: 'nft-detail-value' }, `#${this.tokenId}`)
                            ),
                            owner && h('div', { className: 'nft-detail-row' },
                                h('span', { className: 'nft-detail-label' }, 'Owner'),
                                h('span', { className: 'nft-detail-value nft-detail-address' },
                                    this.truncateAddress(owner)
                                )
                            )
                        ),

                        description && h('div', { className: 'nft-detail-description' },
                            h('div', { className: 'nft-detail-section-title' }, 'Description'),
                            h('p', null, description)
                        ),

                        this.renderAttributes(attributes)
                    )
                )
            )
        );
    }
}

export default NFTDetailModal;
