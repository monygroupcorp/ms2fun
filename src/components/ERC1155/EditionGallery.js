/**
 * EditionGallery Component
 * 
 * Displays all editions in a grid layout for ERC1155 projects.
 */

import { Component } from '../../core/Component.js';
import { EditionCard } from './EditionCard.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class EditionGallery extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            editions: [],
            loading: true,
            error: null,
            selectedEdition: null
        };
    }

    async onMount() {
        // Load ERC1155 styles
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
        await this.loadEditions();
    }

    onUnmount() {
        // Unload styles when component unmounts
        stylesheetLoader.unload('erc1155-styles');
    }

    async loadEditions() {
        try {
            this.setState({ loading: true, error: null });
            const editions = await this.adapter.getEditions();
            this.setState({ editions, loading: false });
        } catch (error) {
            console.error('[EditionGallery] Failed to load editions:', error);
            this.setState({ error: error.message || 'Failed to load editions', loading: false });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="edition-gallery loading">
                    <div class="loading-spinner"></div>
                    <p>Loading editions...</p>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="edition-gallery error">
                    <p class="error-message">Error: ${this.escapeHtml(this.state.error)}</p>
                    <button class="retry-button" ref="retry-button">Retry</button>
                </div>
            `;
        }

        if (this.state.editions.length === 0) {
            return `
                <div class="edition-gallery empty">
                    <div class="empty-state">
                        <h3>No editions available yet</h3>
                        <p>Check back later for new editions.</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="edition-gallery">
                <div class="gallery-header">
                    <h2>Editions</h2>
                    <p class="edition-count">${this.state.editions.length} edition${this.state.editions.length !== 1 ? 's' : ''}</p>
                </div>
                <div class="gallery-grid" ref="gallery-grid">
                    ${this.state.editions.map((edition, index) => `
                        <div class="edition-card-wrapper" data-edition-id="${edition.id}" ref="edition-${edition.id}">
                            <!-- EditionCard will be mounted here -->
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    setupChildComponents() {
        // Mount EditionCard components for each edition
        this.state.editions.forEach((edition) => {
            const wrapper = this.getRef(`edition-${edition.id}`, `[data-edition-id="${edition.id}"]`);
            if (wrapper) {
                const cardComponent = new EditionCard(edition, this.adapter);
                const cardElement = document.createElement('div');
                wrapper.appendChild(cardElement);
                cardComponent.mount(cardElement);
                this.createChild(`edition-card-${edition.id}`, cardComponent);
            }
        });
    }

    setupDOMEventListeners() {
        const retryButton = this.getRef('retry-button', '.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.loadEditions();
            });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

