/**
 * CreateEditionModal - Microact Version
 *
 * Modal for creators to create new editions (upload work, set price, etc.).
 * Uses direct state mutation for form inputs to preserve focus.
 */

import { Component, h } from '../../core/microact-setup.js';

export class CreateEditionModal extends Component {
    constructor(props = {}) {
        super(props);
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

    get adapter() {
        return this.props.adapter;
    }

    didMount() {
        // Handle ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.state.open) {
                this.close();
            }
        };
        document.addEventListener('keydown', escHandler);
        this.registerCleanup(() => document.removeEventListener('keydown', escHandler));
    }

    open() {
        this.setState({ open: true, error: null });
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.setState({ open: false, error: null });
        document.body.style.overflow = '';
    }

    handleOverlayClick(e) {
        if (e.target === e.currentTarget) {
            this.close();
        }
    }

    // Direct state mutations for form inputs to preserve focus
    handleNameInput(e) { this.state.name = e.target.value; }
    handleDescriptionInput(e) { this.state.description = e.target.value; }
    handleImageInput(e) { this.state.imageUrl = e.target.value; }
    handlePriceInput(e) { this.state.price = e.target.value; }
    handleMaxSupplyInput(e) { this.state.maxSupply = e.target.value; }
    handleRoyaltyInput(e) { this.state.royaltyPercent = e.target.value; }

    async handleSubmit(e) {
        e.preventDefault();
        await this.handleCreate();
    }

    async handleCreate() {
        try {
            this.setState({ loading: true, error: null });

            if (!this.state.name || !this.state.imageUrl || !this.state.price) {
                throw new Error('Please fill in all required fields');
            }

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

            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            const { onCreated } = this.props;
            if (onCreated) {
                await onCreated();
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

    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;

        // Only re-render for structural changes
        const structuralKeys = ['open', 'loading', 'error'];
        for (const key of structuralKeys) {
            if (oldState[key] !== newState[key]) return true;
        }
        return false;
    }

    render() {
        if (!this.state.open) {
            return h('div', { className: 'create-edition-modal-container' });
        }

        const { name, description, imageUrl, price, maxSupply, royaltyPercent, loading, error } = this.state;

        return h('div', {
            className: 'modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'modal-content create-edition-modal' },
                h('div', { className: 'modal-header' },
                    h('h2', null, 'Create New Edition'),
                    h('button', {
                        className: 'close-button',
                        onClick: this.bind(this.close)
                    }, '×')
                ),

                h('div', { className: 'modal-body' },
                    error && h('div', { className: 'error-message' }, error),

                    h('form', { onSubmit: this.bind(this.handleSubmit) },
                        h('div', { className: 'form-group' },
                            h('label', null, 'Edition Name *'),
                            h('input', {
                                type: 'text',
                                value: name,
                                required: true,
                                onInput: this.bind(this.handleNameInput)
                            })
                        ),

                        h('div', { className: 'form-group' },
                            h('label', null, 'Description'),
                            h('textarea', {
                                rows: '3',
                                onInput: this.bind(this.handleDescriptionInput)
                            }, description)
                        ),

                        h('div', { className: 'form-group' },
                            h('label', null, 'Image URL *'),
                            h('input', {
                                type: 'url',
                                value: imageUrl,
                                required: true,
                                onInput: this.bind(this.handleImageInput)
                            })
                        ),

                        h('div', { className: 'form-group' },
                            h('label', null, 'Price (ETH) *'),
                            h('input', {
                                type: 'number',
                                step: '0.0001',
                                min: '0',
                                value: price,
                                required: true,
                                onInput: this.bind(this.handlePriceInput)
                            })
                        ),

                        h('div', { className: 'form-group' },
                            h('label', null, 'Max Supply (0 for unlimited) *'),
                            h('input', {
                                type: 'number',
                                min: '0',
                                value: maxSupply,
                                required: true,
                                onInput: this.bind(this.handleMaxSupplyInput)
                            })
                        ),

                        h('div', { className: 'form-group' },
                            h('label', null, 'Royalty Percent (0-100)'),
                            h('input', {
                                type: 'number',
                                min: '0',
                                max: '100',
                                value: royaltyPercent,
                                onInput: this.bind(this.handleRoyaltyInput)
                            })
                        ),

                        h('div', { className: 'form-actions' },
                            h('button', {
                                type: 'button',
                                className: 'cancel-button',
                                onClick: this.bind(this.close)
                            }, 'Cancel'),
                            h('button', {
                                type: 'submit',
                                className: 'create-button',
                                disabled: loading
                            }, loading ? 'Creating...' : 'Create Edition')
                        )
                    )
                )
            )
        );
    }
}

export default CreateEditionModal;
