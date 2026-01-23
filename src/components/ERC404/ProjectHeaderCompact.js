/**
 * ProjectHeaderCompact Component
 * Displays project identity (name, ticker, icon, creator, date) and actions (share, copy, star)
 */

import { Component } from '../../core/Component.js';
import { ShareModal } from '../ShareModal/ShareModal.js';
import favoritesService from '../../services/FavoritesService.js';

export class ProjectHeaderCompact extends Component {
    constructor(projectData) {
        super();
        this.projectData = projectData;
        this.shareModal = null;
        this.state = {
            isFavorite: favoritesService.isFavorite(projectData.address),
            copied: false
        };
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

    handleOpenShare() {
        if (!this.shareModal) {
            this.shareModal = new ShareModal(this.projectData);
            const container = document.createElement('div');
            container.id = 'share-modal-container';
            document.body.appendChild(container);
            this.shareModal.mount(container);
        }
        this.shareModal.open();
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

    onMount() {
        this.setupEventDelegation();
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const target = e.target;

            if (target.closest('[data-action="share"]')) {
                this.handleOpenShare();
            } else if (target.closest('[data-action="copy"]')) {
                this.handleCopyAddress();
            } else if (target.closest('[data-action="favorite"]')) {
                this.handleToggleFavorite();
            }
        });
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

        return `
            <div class="project-header-compact">
                <div class="header-left">
                    <div class="project-icon">
                        ${image ? `<img src="${image}" alt="${this.escapeHtml(name)}">` : '<div class="icon-placeholder"></div>'}
                    </div>
                    <div class="project-identity">
                        <h1 class="project-name">${this.escapeHtml(name)} <span class="project-ticker">($${this.escapeHtml(symbol)})</span></h1>
                        <div class="project-meta">
                            <span class="creator">
                                Created by
                                <a href="https://etherscan.io/address/${creator}" target="_blank" rel="noopener">
                                    ${this.truncateAddress(creator)}
                                </a>
                            </span>
                            ${createdAt ? `<span class="date">${this.formatDate(createdAt)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="header-actions">
                    <button class="action-btn" data-action="share" title="Share">
                        ${this.getShareIcon()}
                    </button>
                    <button class="action-btn address-btn ${copied ? 'copied' : ''}" data-action="copy" title="Copy address">
                        <span class="address-text">${this.truncateAddress(address)}</span>
                        <span class="copy-icon">${copied ? this.getCheckIcon() : this.getCopyIcon()}</span>
                    </button>
                    <button class="action-btn favorite-btn ${isFavorite ? 'is-favorite' : ''}" data-action="favorite" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                        ${this.getStarIcon(isFavorite)}
                    </button>
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    unmount() {
        if (this.shareModal) {
            this.shareModal.close();
            this.shareModal.unmount();
            const container = document.getElementById('share-modal-container');
            if (container) container.remove();
            this.shareModal = null;
        }
        super.unmount();
    }
}
