/**
 * ProjectHeaderCompact - Microact Version
 *
 * Displays project identity (name, ticker, icon, creator, date) and actions (share, copy, star).
 * Uses FavoritesService for favorite state.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import favoritesService from '../../services/FavoritesService.js';

export class ProjectHeaderCompact extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isFavorite: favoritesService.isFavorite(props.projectData?.address),
            copied: false
        };
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

    handleOpenShare() {
        eventBus.emit('share:open', { projectData: this.projectData });
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatDate(timestamp) {
        if (!timestamp) return '';
        // registeredAt may already be in ms (> 1e10) or in seconds
        const ms = timestamp > 1e10 ? timestamp : timestamp * 1000;
        const date = new Date(ms);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    render() {
        const { name, symbol, image, project_photo, creator, createdAt, address, description } = this.projectData;
        const { isFavorite, copied } = this.state;
        const iconSrc = project_photo || image || null;

        return h('div', { className: 'project-header-compact' },
            h('h1', { className: 'project-name' },
                name,
                ' ',
                h('span', { className: 'project-ticker' }, `($${symbol})`)
            ),
            h('div', { className: 'project-icon' },
                iconSrc
                    ? h('img', { src: iconSrc, alt: name })
                    : h('div', { className: 'icon-placeholder' })
            ),
            description && h('p', { className: 'project-description' }, description),
            createdAt && h('div', { className: 'project-meta' },
                h('span', { className: 'date' }, `Created ${this.formatDate(createdAt)}`)
            ),
            h('div', { className: 'project-actions' },
                h('button', {
                    className: 'action-btn',
                    onClick: this.bind(this.handleOpenShare)
                }, 'Share'),
                h('button', {
                    className: `action-btn address-btn ${copied ? 'copied' : ''}`,
                    onClick: this.bind(this.handleCopyAddress)
                }, copied ? `${this.truncateAddress(address)} ✓` : `${this.truncateAddress(address)} ⎘`),
                h('button', {
                    className: `action-btn favorite-btn ${isFavorite ? 'is-favorite' : ''}`,
                    onClick: this.bind(this.handleToggleFavorite)
                }, isFavorite ? '★' : '☆')
            )
        );
    }
}

export default ProjectHeaderCompact;
