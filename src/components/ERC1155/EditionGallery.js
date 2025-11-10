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
        // Load ERC1155 styles immediately (don't wait)
        // Also ensure it's loaded even if route didn't load it
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');
        
        // Double-check the link was created
        this.setTimeout(() => {
            const link = document.querySelector('link[data-stylesheet-id="erc1155-styles"]');
            if (!link) {
                console.warn('[EditionGallery] ERC1155 CSS link not found, creating manually');
                const manualLink = document.createElement('link');
                manualLink.rel = 'stylesheet';
                manualLink.href = '/src/components/ERC1155/erc1155.css';
                manualLink.setAttribute('data-stylesheet-id', 'erc1155-styles');
                document.head.appendChild(manualLink);
            } else {
                console.log('[EditionGallery] ERC1155 CSS link found:', link.href);
            }
        }, 100);
        
        await this.loadEditions();
    }

    onUnmount() {
        // Don't unload styles on unmount - they might be needed if user navigates back
        // stylesheetLoader.unload('erc1155-styles');
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
    
    onStateUpdate(oldState, newState) {
        // When editions load, setup child components (only once)
        if (oldState.editions.length === 0 && newState.editions.length > 0 && !newState.loading) {
            this.setTimeout(() => {
                this.setupChildComponents();
            }, 0);
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
        // Only setup if we have editions and haven't already set them up
        if (!this.state.editions || this.state.editions.length === 0) {
            return;
        }
        
        // Check if children already exist
        if (this._children && this._children.size > 0) {
            // Children already mounted, skip
            return;
        }
        
        // Mount EditionCard components for each edition
        this.state.editions.forEach((edition) => {
            const wrapper = this.getRef(`edition-${edition.id}`, `[data-edition-id="${edition.id}"]`);
            if (wrapper && !this._children.has(`edition-card-${edition.id}`)) {
                const cardComponent = new EditionCard(edition, this.adapter, this.projectId, this.state.project);
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

