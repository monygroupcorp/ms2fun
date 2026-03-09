/**
 * EditionGallery - Microact Version
 *
 * Displays all editions in a grid layout for ERC1155 projects.
 * Uses v2 demo class names (gallery-grid, etc).
 */

import { Component, h } from '../../core/microact-setup.js';
import { EditionCard } from './EditionCard.microact.js';

export class EditionGallery extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            editions: [],
            loading: true,
            error: null
        };
    }

    get projectId() {
        return this.props.projectId;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadEditions();
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

    handleRetry() {
        this.loadEditions();
    }

    render() {
        const { loading, error, editions } = this.state;

        if (loading) {
            return h('div', { className: 'edition-gallery' },
                h('div', { className: 'loading-state' },
                    h('p', null, 'Loading editions...')
                )
            );
        }

        if (error) {
            return h('div', { className: 'edition-gallery' },
                h('p', { className: 'error-message' }, `Error: ${error}`),
                h('button', {
                    className: 'btn btn-secondary',
                    onClick: this.bind(this.handleRetry)
                }, 'Retry')
            );
        }

        if (editions.length === 0) {
            return h('div', { className: 'edition-gallery' },
                h('div', { className: 'empty-state' },
                    h('h3', null, 'No editions available yet'),
                    h('p', null, 'Check back later for new editions.')
                )
            );
        }

        return h('div', { className: 'edition-gallery' },
            h('div', { className: 'gallery-grid' },
                ...editions.map(edition =>
                    h(EditionCard, {
                        key: `edition-${edition.id}`,
                        edition,
                        adapter: this.adapter,
                        projectId: this.projectId,
                        project: this.props.project
                    })
                )
            )
        );
    }
}

export default EditionGallery;
