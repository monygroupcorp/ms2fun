/**
 * ShareModal Component
 * Shows share preview, copy link, and share on X buttons
 */

import { Component } from '../../core/Component.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ShareModal extends Component {
    constructor(projectData) {
        super();
        this.projectData = projectData;
        this.state = {
            isOpen: false,
            copied: false
        };
    }

    open() {
        this.setState({ isOpen: true, copied: false });
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.setState({ isOpen: false });
        document.body.style.overflow = '';
    }

    getShareUrl() {
        return `${window.location.origin}/project/${this.projectData.address}`;
    }

    getShareText() {
        const { name, symbol } = this.projectData;
        return `Check out ${name} ($${symbol}) on MS2`;
    }

    async handleCopyLink() {
        try {
            await navigator.clipboard.writeText(this.getShareUrl());
            this.setState({ copied: true });
            this.setTimeout(() => this.setState({ copied: false }), 2000);
        } catch (e) {
            console.error('[ShareModal] Failed to copy:', e);
        }
    }

    handleShareX() {
        const text = encodeURIComponent(this.getShareText());
        const url = encodeURIComponent(this.getShareUrl());
        window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
    }

    onMount() {
        stylesheetLoader.load('src/components/ShareModal/ShareModal.css', 'share-modal-styles');
        this.setupEventDelegation();
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const target = e.target;

            if (target.closest('[data-action="close"]') || target.classList.contains('share-modal-overlay')) {
                this.close();
            } else if (target.closest('[data-action="copy"]')) {
                this.handleCopyLink();
            } else if (target.closest('[data-action="share-x"]')) {
                this.handleShareX();
            }
        });

        // Handle Escape key to close modal
        this._escapeHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._escapeHandler);

        // Register cleanup for the escape handler
        this.registerCleanup(() => {
            document.removeEventListener('keydown', this._escapeHandler);
        });
    }

    render() {
        if (!this.state.isOpen) return '';

        const { name, symbol, image } = this.projectData;
        const shareUrl = this.getShareUrl();

        return `
            <div class="share-modal-overlay">
                <div class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
                    <div class="share-modal-header">
                        <h3 id="share-modal-title">Share Project</h3>
                        <button class="share-modal-close-btn" data-action="close" aria-label="Close modal">&times;</button>
                    </div>

                    <div class="share-preview-card">
                        <div class="share-preview-image">
                            ${image ? `<img src="${image}" alt="${name}">` : '<div class="share-placeholder-image"></div>'}
                        </div>
                        <div class="share-preview-info">
                            <div class="share-preview-name">${name}</div>
                            <div class="share-preview-symbol">$${symbol}</div>
                        </div>
                    </div>

                    <div class="share-actions">
                        <button class="btn btn-primary share-btn" data-action="copy">
                            <span class="share-btn-icon">${this.state.copied ? this.getCheckIcon() : this.getCopyIcon()}</span>
                            ${this.state.copied ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button class="btn btn-secondary share-btn" data-action="share-x">
                            <span class="share-btn-icon">${this.getXIcon()}</span>
                            Share on X
                        </button>
                    </div>

                    <div class="share-url">${shareUrl}</div>
                </div>
            </div>
        `;
    }

    getCopyIcon() {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
    }

    getCheckIcon() {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>`;
    }

    getXIcon() {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>`;
    }

    unmount() {
        stylesheetLoader.unload('share-modal-styles');
        document.body.style.overflow = '';
        super.unmount();
    }
}
