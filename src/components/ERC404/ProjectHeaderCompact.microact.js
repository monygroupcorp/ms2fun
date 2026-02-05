/**
 * ProjectHeaderCompact - Microact Version
 *
 * Displays project identity (name, ticker, icon, creator, date) and actions (share, copy, star).
 * Uses FavoritesService for favorite state.
 */

import { Component, h } from '../../core/microact-setup.js';
import favoritesService from '../../services/FavoritesService.js';

export class ProjectHeaderCompact extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isFavorite: favoritesService.isFavorite(props.projectData?.address),
            copied: false
        };
        this.shareModalComponent = null;
    }

    get projectData() {
        return this.props.projectData || {};
    }

    async handleCopyAddress() {
        try {
            await navigator.clipboard.writeText(this.projectData.address);
            this.setState({ copied: true });
            this.setTimeout(() => this.setState({ copied: false }), 2000);
        } catch (e) {
            console.error('[ProjectHeaderCompact] Failed to copy:', e);
        }
    }

    handleToggleFavorite() {
        const isFavorite = favoritesService.toggleFavorite(this.projectData.address);
        this.setState({ isFavorite });
    }

    async handleOpenShare() {
        // Lazy load ShareModal
        if (!this.shareModalComponent) {
            const { ShareModal } = await import('../ShareModal/ShareModal.microact.js');
            this.shareModalComponent = new ShareModal({ projectData: this.projectData });

            const container = document.createElement('div');
            container.id = 'share-modal-container';
            document.body.appendChild(container);
            this.shareModalComponent.mount(container);

            this.registerCleanup(() => {
                if (this.shareModalComponent) {
                    this.shareModalComponent.close();
                    this.shareModalComponent.unmount();
                    const el = document.getElementById('share-modal-container');
                    if (el) el.remove();
                }
            });
        }
        this.shareModalComponent.open();
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatDate(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    getShareIcon() {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>`;
    }

    getCopyIcon() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
    }

    getCheckIcon() {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>`;
    }

    getStarIcon(filled) {
        if (filled) {
            return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>`;
        }
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>`;
    }

    render() {
        const { name, symbol, image, creator, createdAt, address } = this.projectData;
        const { isFavorite, copied } = this.state;

        return h('div', { className: 'project-header-compact' },
            // Left section: icon and identity
            h('div', { className: 'header-left' },
                h('div', { className: 'project-icon' },
                    image
                        ? h('img', { src: image, alt: name })
                        : h('div', { className: 'icon-placeholder' })
                ),
                h('div', { className: 'project-identity' },
                    h('h1', { className: 'project-name' },
                        name,
                        ' ',
                        h('span', { className: 'project-ticker' }, `($${symbol})`)
                    ),
                    h('div', { className: 'project-meta' },
                        h('span', { className: 'creator' },
                            'Created by ',
                            h('a', {
                                href: `https://etherscan.io/address/${creator}`,
                                target: '_blank',
                                rel: 'noopener'
                            }, this.truncateAddress(creator))
                        ),
                        createdAt && h('span', { className: 'date' }, this.formatDate(createdAt))
                    )
                )
            ),

            // Right section: action buttons
            h('div', { className: 'header-actions' },
                h('button', {
                    className: 'action-btn',
                    title: 'Share',
                    onClick: this.bind(this.handleOpenShare)
                }, h('span', { innerHTML: this.getShareIcon() })),

                h('button', {
                    className: `action-btn address-btn ${copied ? 'copied' : ''}`,
                    title: 'Copy address',
                    onClick: this.bind(this.handleCopyAddress)
                },
                    h('span', { className: 'address-text' }, this.truncateAddress(address)),
                    h('span', { className: 'copy-icon', innerHTML: copied ? this.getCheckIcon() : this.getCopyIcon() })
                ),

                h('button', {
                    className: `action-btn favorite-btn ${isFavorite ? 'is-favorite' : ''}`,
                    title: isFavorite ? 'Remove from favorites' : 'Add to favorites',
                    onClick: this.bind(this.handleToggleFavorite)
                }, h('span', { innerHTML: this.getStarIcon(isFavorite) }))
            )
        );
    }
}

export default ProjectHeaderCompact;
