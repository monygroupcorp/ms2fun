/**
 * CreateEditionModal Component
 * 
 * Modal for creators to create new editions (upload work, set price, etc.).
 */

import { Component } from '../../core/Component.js';

export class CreateEditionModal extends Component {
    constructor(adapter, onCreated) {
        super();
        this.adapter = adapter;
        this.onCreated = onCreated;
        this.state = {
            open: false,
            name: '',
            description: '',
            imageUrl: '',
            price: '',
            maxSupply: '',
            royaltyPercent: '0',
            loading: false,
            error: null
        };
    }

    open() {
        this.setState({ open: true, error: null });
    }

    close() {
        this.setState({ open: false, error: null });
    }

    render() {
        if (!this.state.open) {
            return '';
        }

        return `
            <div class="modal-overlay" ref="overlay">
                <div class="modal-content create-edition-modal">
                    <div class="modal-header">
                        <h2>Create New Edition</h2>
                        <button class="close-button" ref="close-button">×</button>
                    </div>
                    <div class="modal-body">
                        ${this.state.error ? `
                            <div class="error-message">${this.escapeHtml(this.state.error)}</div>
                        ` : ''}
                        <form ref="create-form">
                            <div class="form-group">
                                <label>Edition Name *</label>
                                <input type="text" ref="name-input" value="${this.escapeHtml(this.state.name)}" required />
                            </div>
                            <div class="form-group">
                                <label>Description</label>
                                <textarea ref="description-input" rows="3">${this.escapeHtml(this.state.description)}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Image URL *</label>
                                <input type="url" ref="image-input" value="${this.escapeHtml(this.state.imageUrl)}" required />
                            </div>
                            <div class="form-group">
                                <label>Price (ETH) *</label>
                                <input type="number" step="0.0001" min="0" ref="price-input" value="${this.escapeHtml(this.state.price)}" required />
                            </div>
                            <div class="form-group">
                                <label>Max Supply (0 for unlimited) *</label>
                                <input type="number" min="0" ref="max-supply-input" value="${this.escapeHtml(this.state.maxSupply)}" required />
                            </div>
                            <div class="form-group">
                                <label>Royalty Percent (0-100)</label>
                                <input type="number" min="0" max="100" ref="royalty-input" value="${this.escapeHtml(this.state.royaltyPercent)}" />
                            </div>
                            <div class="form-actions">
                                <button type="button" class="cancel-button" ref="cancel-button">Cancel</button>
                                <button type="submit" class="create-button" ${this.state.loading ? 'disabled' : ''}>
                                    ${this.state.loading ? 'Creating...' : 'Create Edition'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    setupDOMEventListeners() {
        const overlay = this.getRef('overlay', '.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.close();
                }
            });
        }

        const closeButton = this.getRef('close-button', '.close-button');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.close());
        }

        const cancelButton = this.getRef('cancel-button', '.cancel-button');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => this.close());
        }

        const form = this.getRef('create-form', 'form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleCreate();
            });
        }

        // Input listeners for state updates - update state directly to prevent focus loss
        const nameInput = this.getRef('name-input', 'input[type="text"]');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.state.name = e.target.value;
            });
        }

        const descriptionInput = this.getRef('description-input', 'textarea');
        if (descriptionInput) {
            descriptionInput.addEventListener('input', (e) => {
                this.state.description = e.target.value;
            });
        }

        const imageInput = this.getRef('image-input', 'input[type="url"]');
        if (imageInput) {
            imageInput.addEventListener('input', (e) => {
                this.state.imageUrl = e.target.value;
            });
        }

        const priceInput = this.getRef('price-input', 'input[type="number"]');
        if (priceInput) {
            priceInput.addEventListener('input', (e) => {
                this.state.price = e.target.value;
            });
        }

        const maxSupplyInput = this.getRef('max-supply-input', 'input[type="number"]');
        if (maxSupplyInput) {
            maxSupplyInput.addEventListener('input', (e) => {
                this.state.maxSupply = e.target.value;
            });
        }

        const royaltyInput = this.getRef('royalty-input', 'input[type="number"]');
        if (royaltyInput) {
            royaltyInput.addEventListener('input', (e) => {
                this.state.royaltyPercent = e.target.value;
            });
        }
    }

    /**
     * Override shouldUpdate to prevent re-renders when only form input values change
     * Form inputs update state directly to preserve focus during typing
     */
    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;

        // Only re-render for structural changes (open/close, loading, error)
        const structuralKeys = ['open', 'loading', 'error'];
        for (const key of structuralKeys) {
            if (oldState[key] !== newState[key]) {
                return true;
            }
        }

        // Form input changes don't require re-render
        return false;
    }

    async handleCreate() {
        try {
            this.setState({ loading: true, error: null });

            // Validate inputs
            if (!this.state.name || !this.state.imageUrl || !this.state.price) {
                throw new Error('Please fill in all required fields');
            }

            // Import ethers dynamically
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            const metadata = {
                name: this.state.name,
                description: this.state.description,
                image: this.state.imageUrl
            };

            const priceWei = ethers.utils.parseEther(this.state.price);

            const tx = await this.adapter.createEdition(
                metadata,
                priceWei.toString(),
                this.state.maxSupply || '0',
                this.state.royaltyPercent || '0'
            );

            // Wait for confirmation if it's a real transaction
            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            if (this.onCreated) {
                await this.onCreated();
            }

            this.close();
            this.setState({ 
                loading: false,
                name: '',
                description: '',
                imageUrl: '',
                price: '',
                maxSupply: '',
                royaltyPercent: '0'
            });
        } catch (error) {
            console.error('[CreateEditionModal] Failed to create edition:', error);
            this.setState({ 
                loading: false, 
                error: error.message || 'Failed to create edition' 
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

