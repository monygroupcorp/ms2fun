/**
 * EditionDetail - Microact Version
 *
 * Displays full detail page for an individual ERC1155 edition with minting interface.
 * Matches docs/examples/edition-ocean-currents-demo.html
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';
import { EditionMintInterface } from './EditionMintInterface.microact.js';
import { UpdateMetadataModal } from './UpdateMetadataModal.microact.js';
import { SetEditionStyleModal } from './SetEditionStyleModal.microact.js';

export class EditionDetail extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            edition: null,
            userBalance: '0',
            currentPrice: null,
            loading: true,
            error: null
        };
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

    get projectName() {
        return this.props.projectName || null;
    }

    async didMount() {
        await this.loadEdition();
        await Promise.all([
            this.loadUserBalance(),
            this.loadCurrentPrice()
        ]);

        const unsub1 = eventBus.on('erc1155:mint:success', (data) => this.handleMintSuccess(data));
        const unsub2 = eventBus.on('account:changed', () => {
            this.loadUserBalance();
            this.checkOwnership();
        });
        const unsub3 = eventBus.on('wallet:connected', () => {
            this.loadUserBalance();
            this.checkOwnership();
        });
        const unsub4 = eventBus.on('wallet:disconnected', () => this.hideAdminControls());
        const unsub5 = eventBus.on('wallet:changed', () => this.checkOwnership());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            unsub5();
        });

        this.checkOwnership();
    }

    async handleMintSuccess(data) {
        if (data.editionId.toString() !== this.editionId.toString()) return;

        // Invalidate cache for fresh data
        try {
            const [edition, currentPrice] = await Promise.all([
                this.adapter.getEditionInfo(this.editionId),
                this.adapter.getCurrentPrice(this.editionId).catch(() => null)
            ]);

            const updates = { edition };
            if (currentPrice) updates.currentPrice = currentPrice;

            const address = walletService.getAddress();
            if (address) {
                const balance = await this.adapter.getBalanceForEdition(address, this.editionId);
                updates.userBalance = balance;
            }

            this.setState(updates);
        } catch (error) {
            console.error('[EditionDetail] Failed to refresh after mint:', error);
        }
    }

    async loadCurrentPrice() {
        try {
            const currentPrice = await this.adapter.getCurrentPrice(this.editionId);
            this.setState({ currentPrice });
        } catch (e) {
            // Fall back to edition.price
        }
    }

    async loadEdition() {
        try {
            this.setState({ loading: true, error: null });
            const edition = await this.adapter.getEditionInfo(this.editionId);
            this.setState({ edition, loading: false });
        } catch (error) {
            console.error('[EditionDetail] Failed to load edition:', error);
            this.setState({ error: error.message || 'Failed to load edition information', loading: false });
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
                return parseFloat(window.ethers.utils.formatEther(priceWei)).toFixed(4);
            }
            return (parseFloat(priceWei) / 1e18).toFixed(4);
        } catch (error) {
            return (parseFloat(priceWei) / 1e18).toFixed(4);
        }
    }

    formatAddress(address) {
        if (!address) return 'N/A';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    async handleBackClick(e) {
        if (e) e.preventDefault();
        // Navigate back to the project, carrying forward the original source
        const from = window.history.state?.from || null;
        const { navigateToProject } = await import('../../utils/navigation.js');
        await navigateToProject(this.projectId, null, from ? { from } : {});
    }

    handleHomeClick(e) {
        if (e) e.preventDefault();
        if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    handleSourceClick(e) {
        if (e) e.preventDefault();
        const from = window.history.state?.from;
        const path = from === 'projects' ? '/discover' : from === 'activity' ? '/activity' : '/';
        if (window.router) {
            window.router.navigate(path);
        } else {
            window.location.href = path;
        }
    }

    async checkOwnership() {
        if (!this.adapter) return;
        try {
            const userAddress = walletService.getAddress();
            if (!userAddress) { this.hideAdminControls(); return; }

            const ownerAddress = await this.adapter.owner();
            if (ownerAddress && userAddress.toLowerCase() === ownerAddress.toLowerCase()) {
                this.showAdminControls();
            } else {
                this.hideAdminControls();
            }
        } catch (error) {
            this.hideAdminControls();
        }
    }

    showAdminControls() {
        if (!this._el) return;
        const controls = this._el.querySelector('.edition-admin-section');
        if (controls) controls.style.display = '';
    }

    hideAdminControls() {
        if (!this._el) return;
        const controls = this._el.querySelector('.edition-admin-section');
        if (controls) controls.style.display = 'none';
    }

    renderBreadcrumb(projectName) {
        const from = window.history.state?.from;
        const sourceLabels = { projects: 'Projects', activity: 'Activity' };
        const sourceLabel = sourceLabels[from];
        const displayName = window.history.state?.projectName || projectName || 'Project';
        return h('div', { className: 'breadcrumb' },
            h('a', { href: '/', className: 'breadcrumb-wordmark', onClick: this.bind(this.handleHomeClick) },
                'MS2', h('span', { className: 'logo-tld' }, '.fun')
            ),
            sourceLabel && h('span', { className: 'breadcrumb-separator' }, '/'),
            sourceLabel && h('a', {
                href: from === 'projects' ? '/discover' : `/${from}`,
                onClick: this.bind(this.handleSourceClick)
            }, sourceLabel),
            h('span', { className: 'breadcrumb-separator' }, '/'),
            h('a', { href: '#', onClick: this.bind(this.handleBackClick) }, displayName)
        );
    }

    renderEditionImage(imageUrl, name, isSoldOut) {
        if (imageUrl && imageUrl !== '/placeholder-edition.png') {
            const imgHtml = renderIpfsImage(imageUrl, name, 'edition-main-image');
            return h('div', { className: 'edition-image', innerHTML: imgHtml });
        }
        return h('div', { className: 'edition-image edition-image-placeholder' }, 'IMG');
    }

    render() {
        const { loading, error, edition, userBalance } = this.state;

        if (loading) {
            return h('div', { className: 'edition-detail-page' },
                this.renderBreadcrumb(this.projectName),
                h('div', { className: 'edition-loading' },
                    h('div', { className: 'loading-spinner' }),
                    h('p', null, 'Loading edition...')
                )
            );
        }

        if (error || !edition) {
            return h('div', { className: 'edition-detail-page' },
                this.renderBreadcrumb(this.projectName),
                h('div', { className: 'edition-error' },
                    h('h2', null, 'Error'),
                    h('p', null, error || 'Edition not found')
                )
            );
        }

        const imageUrl = edition.metadata?.image || edition.metadata?.image_url || '/placeholder-edition.png';
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const description = edition.metadata?.description || '';
        const price = this.formatPrice(this.state.currentPrice || edition.price);
        const currentSupply = BigInt(edition.currentSupply || '0');
        const maxSupply = BigInt(edition.maxSupply || '0');
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
        const isSoldOut = edition.maxSupply !== '0' && currentSupply >= maxSupply;
        const projectName = this.projectName;

        return h('div', { className: 'edition-detail-page' },

            // Breadcrumb — reflects navigation depth: MS2.fun / [source] / projectName
            this.renderBreadcrumb(projectName),

            // Two-column layout
            h('div', { className: 'edition-layout' },

                // Left: Image section (sticky)
                h('div', { className: 'image-section' },
                    this.renderEditionImage(imageUrl, name, isSoldOut),
                    isSoldOut && h('div', { className: 'sold-out-overlay' }, 'Sold Out'),

                    h('div', { className: 'image-details' },
                        h('div', { className: 'image-detail-row' },
                            h('div', { className: 'image-detail-label' }, 'Token ID'),
                            h('div', { className: 'image-detail-value' }, `#${edition.id}`)
                        ),
                        edition.creator && h('div', { className: 'image-detail-row' },
                            h('div', { className: 'image-detail-label' }, 'Creator'),
                            h('div', { className: 'image-detail-value' }, this.formatAddress(edition.creator))
                        ),
                        h('div', { className: 'image-detail-row' },
                            h('div', { className: 'image-detail-label' }, 'Standard'),
                            h('div', { className: 'image-detail-value' }, 'ERC1155')
                        ),
                        userBalance !== '0' && h('div', { className: 'image-detail-row' },
                            h('div', { className: 'image-detail-label' }, 'You Own'),
                            h('div', { className: 'image-detail-value' }, userBalance)
                        )
                    )
                ),

                // Right: Info section
                h('div', { className: 'info-section' },

                    h('div', null,
                        h('div', { className: 'edition-badge' }, `Edition #${edition.id}`),
                        h('h1', { className: 'edition-title' }, name),
                        projectName && h('a', {
                            className: 'project-link',
                            href: '#',
                            onClick: this.bind(this.handleBackClick)
                        }, `From ${projectName} →`)
                    ),

                    description && h('p', { className: 'edition-description' }, description),

                    // Stats grid
                    h('div', { className: 'stats-grid' },
                        h('div', { className: 'stat' },
                            h('div', { className: 'stat-label' }, 'Price'),
                            h('div', { className: 'stat-value' }, `${price} ETH`)
                        ),
                        h('div', { className: 'stat' },
                            h('div', { className: 'stat-label' }, 'Minted'),
                            h('div', { className: 'stat-value' }, supply)
                        )
                    ),

                    // Mint section
                    h('div', { className: 'mint-section' },
                        h('div', { className: 'mint-title' }, 'Mint Edition'),
                        isSoldOut
                            ? h('p', { className: 'sold-out-message' }, 'This edition is sold out.')
                            : h(EditionMintInterface, { edition, adapter: this.adapter })
                    ),

                    // Project context
                    projectName && h('div', { className: 'project-context' },
                        h('div', { className: 'context-title' }, `About ${projectName}`),
                        h('a', {
                            href: '#',
                            className: 'context-link',
                            onClick: this.bind(this.handleBackClick)
                        }, 'View All Editions \u2192')
                    ),

                    // Admin controls (hidden until ownership confirmed)
                    h('div', { className: 'edition-admin-section', style: { display: 'none' } },
                        h('div', { className: 'edition-admin-section-title' }, 'Admin'),
                        h('div', { className: 'edition-admin-controls' },
                            h('button', {
                                className: 'btn btn-secondary btn-sm',
                                onClick: () => eventBus.emit('erc1155:admin:update-metadata', { editionId: edition.id })
                            }, 'Update Metadata'),
                            h('button', {
                                className: 'btn btn-secondary btn-sm',
                                onClick: () => eventBus.emit('erc1155:admin:set-edition-style', { editionId: edition.id })
                            }, 'Set Edition Style')
                        )
                    )
                )
            ),

            // Admin modals
            h(UpdateMetadataModal, { adapter: this.adapter }),
            h(SetEditionStyleModal, { adapter: this.adapter })
        );
    }
}

export default EditionDetail;
