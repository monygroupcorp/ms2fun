/**
 * EditionGallery - Microact Version
 *
 * Displays all editions in a grid layout for ERC1155 projects.
 */

import { Component, h } from '../../core/microact-setup.js';
import { EditionCard } from './EditionCard.microact.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class EditionGallery extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            editions: [],
            loading: true,
            error: null,
            selectedEdition: null
        };
    }

    get projectId() {
        return this.props.projectId;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        // Load ERC1155 styles
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');

        setTimeout(() => {
            const link = document.querySelector('link[data-stylesheet-id="erc1155-styles"]');
            if (!link) {
                console.warn('[EditionGallery] ERC1155 CSS link not found, creating manually');
                const manualLink = document.createElement('link');
                manualLink.rel = 'stylesheet';
                manualLink.href = '/src/components/ERC1155/erc1155.css';
                manualLink.setAttribute('data-stylesheet-id', 'erc1155-styles');
                document.head.appendChild(manualLink);
            }
        }, 100);

        await this.loadEditions();
        await this.loadProjectStyle();

        this.registerCleanup(() => {
            this.unloadProjectStyle();
        });
    }

    async loadProjectStyle() {
        try {
            const cacheKey = `projectStyle:${this.projectId}`;
            const cachedUri = localStorage.getItem(cacheKey);

            if (cachedUri) {
                this._applyProjectStyle(cachedUri);
            }

            const styleUri = await this.adapter.getStyle().catch(() => '');

            if (styleUri && styleUri.trim()) {
                localStorage.setItem(cacheKey, styleUri);

                if (styleUri !== cachedUri) {
                    this._applyProjectStyle(styleUri);
                }
            } else if (cachedUri) {
                localStorage.removeItem(cacheKey);
                this.unloadProjectStyle();
            }
        } catch (error) {
            console.warn('[EditionGallery] Failed to load project style:', error);
        }
    }

    _applyProjectStyle(styleUri) {
        console.log('[EditionGallery] Applying project style:', styleUri);
        const styleId = `project-style-${this.projectId}`;

        document.documentElement.classList.add('has-project-style');
        document.body.classList.add('has-project-style');
        document.body.setAttribute('data-project-style', this.projectId);

        const existingLink = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
        if (existingLink) {
            document.documentElement.classList.add('project-style-loaded');
            document.documentElement.classList.add('project-style-resolved');
            document.body.classList.add('project-style-loaded');
            document.body.classList.add('project-style-resolved');
        } else {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleUri.startsWith('/') || styleUri.startsWith('http') ? styleUri : '/' + styleUri;
            link.setAttribute('data-stylesheet-id', styleId);

            link.onload = () => {
                console.log('[EditionGallery] Project style loaded');
                document.documentElement.classList.add('project-style-loaded');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.add('project-style-loaded');
                document.body.classList.add('project-style-resolved');
            };

            link.onerror = () => {
                console.warn('[EditionGallery] Failed to load project style CSS');
                document.documentElement.classList.remove('has-project-style');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
            };

            document.head.appendChild(link);
        }

        this._projectStyleId = styleId;
    }

    unloadProjectStyle() {
        if (this._projectStyleId) {
            stylesheetLoader.unload(this._projectStyleId);
            this._projectStyleId = null;

            document.documentElement.classList.remove('has-project-style');
            document.documentElement.classList.remove('project-style-loaded');
            document.documentElement.classList.remove('project-style-resolved');
            document.documentElement.classList.remove('project-style-pending');
            document.body.classList.remove('has-project-style');
            document.body.classList.remove('project-style-loaded');
            document.body.classList.remove('project-style-resolved');
            document.body.classList.remove('project-style-pending');
            document.body.removeAttribute('data-project-style');
        }
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
            return h('div', { className: 'edition-gallery loading marble-bg' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading editions...')
            );
        }

        if (error) {
            return h('div', { className: 'edition-gallery error marble-bg' },
                h('p', { className: 'error-message' }, `Error: ${error}`),
                h('button', {
                    className: 'retry-button',
                    onClick: this.bind(this.handleRetry)
                }, 'Retry')
            );
        }

        if (editions.length === 0) {
            return h('div', { className: 'edition-gallery empty marble-bg' },
                h('div', { className: 'empty-state' },
                    h('h3', null, 'No editions available yet'),
                    h('p', null, 'Check back later for new editions.')
                )
            );
        }

        return h('div', { className: 'edition-gallery marble-bg' },
            h('div', { className: 'gallery-header' },
                h('h2', null, 'Editions'),
                h('p', { className: 'edition-count' },
                    `${editions.length} edition${editions.length !== 1 ? 's' : ''}`
                )
            ),
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
