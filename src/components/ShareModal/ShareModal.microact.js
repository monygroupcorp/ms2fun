/**
 * ShareModal - Microact Version
 *
 * Shows share preview, copy link, and share on X buttons.
 * Pure UI component - no contract interactions.
 */

import { Component, h } from '../../core/microact-setup.js';

export class ShareModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isOpen: false,
            copied: false
        };
        this._escapeHandler = null;
    }

    didMount() {
        // Handle Escape key to close modal
        this._escapeHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._escapeHandler);

        this.registerCleanup(() => {
            document.removeEventListener('keydown', this._escapeHandler);
            document.body.style.overflow = '';
        });
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
        const { projectData } = this.props;
        return `${window.location.origin}/project/${projectData?.address || ''}`;
    }

    getShareText() {
        const { projectData } = this.props;
        const name = projectData?.name || 'Project';
        const symbol = projectData?.symbol || '';
        return `Check out ${name}${symbol ? ` ($${symbol})` : ''} on MS2`;
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

    handleOverlayClick(e) {
        if (e.target === e.currentTarget) {
            this.close();
        }
    }

    render() {
        if (!this.state.isOpen) {
            return h('div', { className: 'share-modal-container' });
        }

        const { projectData } = this.props;
        const name = projectData?.name || 'Project';
        const symbol = projectData?.symbol || '';
        const image = projectData?.image;
        const shareUrl = this.getShareUrl();

        return h('div', {
            className: 'share-modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', {
                className: 'share-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'share-modal-title'
            },
                // Header
                h('div', { className: 'share-modal-header' },
                    h('h3', { id: 'share-modal-title' }, 'Share Project'),
                    h('button', {
                        className: 'share-modal-close-btn',
                        'aria-label': 'Close modal',
                        onClick: this.bind(this.close)
                    }, '×')
                ),

                // Preview Card
                h('div', { className: 'share-preview-card' },
                    h('div', { className: 'share-preview-image' },
                        image
                            ? h('img', { src: image, alt: name })
                            : h('div', { className: 'share-placeholder-image' })
                    ),
                    h('div', { className: 'share-preview-info' },
                        h('div', { className: 'share-preview-name' }, name),
                        symbol && h('div', { className: 'share-preview-symbol' }, `$${symbol}`)
                    )
                ),

                // Actions
                h('div', { className: 'share-actions' },
                    h('button', {
                        className: 'btn btn-primary share-btn',
                        onClick: this.bind(this.handleCopyLink)
                    },
                        h('span', {
                            className: 'share-btn-icon',
                            innerHTML: this.state.copied ? this.getCheckIcon() : this.getCopyIcon()
                        }),
                        this.state.copied ? 'Copied!' : 'Copy Link'
                    ),
                    h('button', {
                        className: 'btn btn-secondary share-btn',
                        onClick: this.bind(this.handleShareX)
                    },
                        h('span', {
                            className: 'share-btn-icon',
                            innerHTML: this.getXIcon()
                        }),
                        'Share on X'
                    )
                ),

                // URL display
                h('div', { className: 'share-url' }, shareUrl)
            )
        );
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
}

export default ShareModal;
