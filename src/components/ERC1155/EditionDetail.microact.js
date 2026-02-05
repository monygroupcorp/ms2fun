/**
 * EditionDetail - Microact Version
 *
 * Displays full detail page for an individual ERC1155 edition with minting interface.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class EditionDetail extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            edition: null,
            userBalance: '0',
            loading: true,
            error: null
        };
        this._projectStyleId = null;
    }

    get projectId() {
        return this.props.projectId;
    }

    get editionId() {
        return this.props.editionId;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        // Load ERC1155 styles
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');

        await this.loadEdition();
        await this.loadUserBalance();
        await this.loadProjectStyle();

        const unsub1 = eventBus.on('erc1155:mint:success', (data) => this.handleMintSuccess(data));
        const unsub2 = eventBus.on('account:changed', () => this.loadUserBalance());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadUserBalance());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
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
            console.warn('[EditionDetail] Failed to load project style:', error);
        }
    }

    _applyProjectStyle(styleUri) {
        console.log('[EditionDetail] Applying project style:', styleUri);
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
                console.log('[EditionDetail] Project style loaded');
                document.documentElement.classList.add('project-style-loaded');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.add('project-style-loaded');
                document.body.classList.add('project-style-resolved');
            };

            link.onerror = () => {
                console.warn('[EditionDetail] Failed to load project style CSS');
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

    async handleMintSuccess(data) {
        if (data.editionId.toString() !== this.editionId.toString()) {
            return;
        }

        try {
            const edition = await this.adapter.getEditionInfo(this.editionId);
            this.setState({ edition });

            const address = walletService.getAddress();
            if (address) {
                const balance = await this.adapter.getBalanceForEdition(address, this.editionId);
                this.setState({ userBalance: balance });
            }
        } catch (error) {
            console.error('[EditionDetail] Failed to refresh after mint:', error);
        }
    }

    async loadEdition() {
        try {
            this.setState({ loading: true, error: null });
            const edition = await this.adapter.getEditionInfo(this.editionId);
            this.setState({ edition, loading: false });
        } catch (error) {
            console.error('[EditionDetail] Failed to load edition:', error);
            this.setState({
                error: error.message || 'Failed to load edition information',
                loading: false
            });
        }
    }

    async loadUserBalance() {
        try {
            const address = walletService.getAddress();
            if (address && this.state.edition) {
                const balance = await this.adapter.getBalanceForEdition(address, this.editionId);
                this.setState({ userBalance: balance });
            }
        } catch (error) {
            console.error('[EditionDetail] Failed to load user balance:', error);
        }
    }

    formatPrice(priceWei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                const priceEth = parseFloat(window.ethers.utils.formatEther(priceWei));
                return priceEth.toFixed(4);
            }
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        } catch (error) {
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        }
    }

    formatAddress(address) {
        if (!address) return 'N/A';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    async handleBackClick() {
        const { navigateToProject } = await import('../../utils/navigation.js');
        await navigateToProject(this.projectId);
    }

    renderEditionImage(imageUrl, name, isSoldOut) {
        // For IPFS images, use the helper
        const imgHtml = renderIpfsImage(imageUrl, name, 'edition-main-image');

        // Since renderIpfsImage returns HTML string, we need to use innerHTML approach
        // Create a wrapper div and set innerHTML
        return h('div', { className: 'edition-image-wrapper' },
            h('div', {
                className: 'ipfs-image-container',
                innerHTML: imgHtml
            }),
            isSoldOut && h('div', { className: 'sold-out-badge large' }, 'Sold Out')
        );
    }

    render() {
        const { loading, error, edition, userBalance } = this.state;

        if (loading) {
            return h('div', { className: 'edition-detail loading marble-bg' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading edition...')
            );
        }

        if (error || !edition) {
            return h('div', { className: 'edition-detail error marble-bg' },
                h('h2', null, 'Error'),
                h('p', null, error || 'Edition not found'),
                h('button', {
                    className: 'back-button',
                    onClick: this.bind(this.handleBackClick)
                }, '← Back to Project')
            );
        }

        const imageUrl = edition.metadata?.image ||
                        edition.metadata?.image_url ||
                        '/placeholder-edition.png';
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const description = edition.metadata?.description || '';
        const price = this.formatPrice(edition.price);
        const currentSupply = BigInt(edition.currentSupply || '0');
        const maxSupply = BigInt(edition.maxSupply || '0');
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
        const isSoldOut = edition.maxSupply !== '0' && currentSupply >= maxSupply;

        return h('div', { className: 'edition-detail marble-bg' },
            h('div', { className: 'edition-header-actions' },
                h('button', {
                    className: 'back-button',
                    onClick: this.bind(this.handleBackClick)
                }, '← Back to Project'),
                h('div', { className: 'admin-button-container' })
                // AdminButton would be mounted here as child component
            ),

            h('div', { className: 'edition-detail-content' },
                h('div', { className: 'edition-image-section' },
                    this.renderEditionImage(imageUrl, name, isSoldOut)
                ),

                h('div', { className: 'edition-info-section' },
                    h('h1', { className: 'edition-title' }, name),

                    description && h('div', { className: 'edition-description-full' },
                        h('p', null, description)
                    ),

                    h('div', { className: 'edition-stats-grid' },
                        h('div', { className: 'stat-card marble-bg' },
                            h('span', { className: 'stat-label' }, 'Price'),
                            h('span', { className: 'stat-value price' }, `${price} ETH`)
                        ),
                        h('div', { className: 'stat-card marble-bg' },
                            h('span', { className: 'stat-label' }, 'Supply'),
                            h('span', { className: 'stat-value' }, supply)
                        ),
                        userBalance !== '0' && h('div', { className: 'stat-card marble-bg' },
                            h('span', { className: 'stat-label' }, 'You Own'),
                            h('span', { className: 'stat-value' }, userBalance)
                        ),
                        edition.creator && h('div', { className: 'stat-card marble-bg' },
                            h('span', { className: 'stat-label' }, 'Creator'),
                            h('span', { className: 'stat-value address' }, this.formatAddress(edition.creator))
                        )
                    ),

                    h('div', { className: 'edition-mint-section' })
                    // EditionMintInterface would be mounted here as child component
                    // Stub for now - full migration would include this child
                )
            )
        );
    }
}

export default EditionDetail;
