/**
 * UpdateMetadataModal - Microact Version
 *
 * Simple modal to update edition metadata URI.
 * Opens via erc1155:admin:update-metadata event.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';

export class UpdateMetadataModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            open: false,
            editionId: null,
            metadataURI: '',
            loading: false,
            error: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    didMount() {
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.state.open) {
                this.close();
            }
        };
        document.addEventListener('keydown', escHandler);
        this.registerCleanup(() => document.removeEventListener('keydown', escHandler));

        const unsub = eventBus.on('erc1155:admin:update-metadata', (data) => {
            this.setState({
                open: true,
                editionId: data.editionId,
                metadataURI: '',
                error: null
            });
            document.body.style.overflow = 'hidden';
        });
        this.registerCleanup(() => unsub());
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

    handleURIInput(e) {
        this.state.metadataURI = e.target.value;
    }

    async handleSubmit(e) {
        e.preventDefault();

        try {
            this.setState({ loading: true, error: null });

            if (!this.state.metadataURI.trim()) {
                throw new Error('Please enter a metadata URI');
            }

            const tx = await this.adapter.updateEditionMetadata(
                this.state.editionId,
                this.state.metadataURI.trim()
            );

            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            this.close();
            this.setState({ loading: false });
        } catch (error) {
            console.error('[UpdateMetadataModal] Failed to update metadata:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to update metadata'
            });
        }
    }

    shouldUpdate(oldProps, newProps, oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;
        const structuralKeys = ['open', 'loading', 'error', 'editionId'];
        for (const key of structuralKeys) {
            if (oldState[key] !== newState[key]) return true;
        }
        return false;
    }

    render() {
        if (!this.state.open) {
            return h('div', { className: 'update-metadata-modal-container' });
        }

        const { editionId, loading, error } = this.state;

        return h('div', {
            className: 'modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'modal-content update-metadata-modal' },
                h('div', { className: 'modal-header' },
                    h('h2', null, `Update Metadata — Edition #${editionId}`),
                    h('button', {
                        className: 'close-button',
                        onClick: this.bind(this.close)
                    }, '\u00d7')
                ),

                h('div', { className: 'modal-body' },
                    error && h('div', { className: 'error-message' }, error),

                    h('form', { onSubmit: this.bind(this.handleSubmit) },
                        h('div', { className: 'form-group' },
                            h('label', null, 'Metadata URI *'),
                            h('input', {
                                type: 'text',
                                placeholder: 'ipfs://... or https://...',
                                required: true,
                                onInput: this.bind(this.handleURIInput)
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
                            }, loading ? 'Updating...' : 'Update Metadata')
                        )
                    )
                )
            )
        );
    }
}

export default UpdateMetadataModal;
