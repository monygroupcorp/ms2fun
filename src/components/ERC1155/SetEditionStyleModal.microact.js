/**
 * SetEditionStyleModal - Microact Version
 *
 * Modal to set a per-edition style URI with inline style builder.
 * Opens via erc1155:admin:set-edition-style event.
 * Includes both CSS URL mode and token builder mode (same as project-level).
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { StyleBuilder } from '../shared/StyleBuilder.microact.js';

export class SetEditionStyleModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            open: false,
            editionId: null,
            mode: 'builder',
            loading: false,
            error: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    didMount() {
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.state.open) this.close();
        };
        document.addEventListener('keydown', escHandler);
        this.registerCleanup(() => document.removeEventListener('keydown', escHandler));

        const unsub = eventBus.on('erc1155:admin:set-edition-style', (data) => {
            this.setState({
                open: true,
                editionId: data.editionId,
                mode: 'builder',
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
        if (e.target === e.currentTarget) this.close();
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

    // ── Render ──

    render() {
        if (!this.state.open) {
            return h('div', { className: 'set-edition-style-modal-container' });
        }

        const { editionId, loading, error } = this.state;

        return h('div', {
            className: 'modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'modal-content set-edition-style-modal' },
                h('div', { className: 'modal-header' },
                    h('h2', null, `Set Style \u2014 Edition #${editionId}`),
                    h('button', {
                        className: 'close-button',
                        onClick: this.bind(this.close)
                    }, '\u00d7')
                ),

                h('div', { className: 'modal-body' },
                    h('div', { className: 'style-builder-guide-text' },
                        'Customize the look of this specific edition. This overrides the project-level style when viewing this edition\'s detail page. ',
                        'Use the builder to pick design tokens, or paste a CSS URL directly.'
                    ),

                    error && h('div', { className: 'error-message' }, error),

                    h(StyleBuilder, {
                        onSetStyle: (uri) => this.adapter.setEditionStyle(this.state.editionId, uri),
                        onClearStyle: () => this.adapter.setEditionStyle(this.state.editionId, ''),
                        prefix: 'e',
                        inputClass: 'admin-inline-input'
                    })
                )
            )
        );
    }
}

export default SetEditionStyleModal;
