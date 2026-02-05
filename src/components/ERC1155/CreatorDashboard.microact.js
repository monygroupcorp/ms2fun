/**
 * CreatorDashboard - Microact Version
 *
 * Dashboard for creators to manage their ERC1155 collections:
 * - View earnings and total proceeds
 * - Withdraw creator balance
 * - Claim vault fees (if owner is benefactor)
 * - Update edition metadata
 * - Customize styles (instance and per-edition)
 * - Add new editions
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class CreatorDashboard extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            editions: [],
            earnings: {},
            totalProceeds: '0',
            instanceStyle: '',
            ownerAddress: null,
            loading: true,
            txPending: false,
            error: null,
            activeTab: 'overview',
            withdrawAmount: '',
            // New edition form
            newEdition: {
                name: '',
                description: '',
                imageUrl: '',
                price: '',
                maxSupply: ''
            },
            // Metadata update form
            metadataUpdate: {
                editionId: null,
                uri: ''
            },
            // Style update form
            styleUpdate: {
                editionId: null,
                uri: ''
            }
        };
    }

    get projectId() {
        return this.props.projectId;
    }

    get adapter() {
        return this.props.adapter;
    }

    get project() {
        return this.props.project;
    }

    async didMount() {
        await this.loadDashboardData();

        const unsub1 = eventBus.on('transaction:confirmed', () => this.loadDashboardData());
        const unsub2 = eventBus.on('account:changed', () => this.loadDashboardData());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadDashboardData());
        const unsub4 = eventBus.on('wallet:disconnected', () => this.setState({ loading: false }));

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    isConnected() {
        return !!walletService.getAddress();
    }

    isOwner() {
        const address = walletService.getAddress();
        return address && this.state.ownerAddress &&
            address.toLowerCase() === this.state.ownerAddress.toLowerCase();
    }

    async loadDashboardData() {
        try {
            this.setState({ loading: true, error: null });

            const address = walletService.getAddress();
            if (!address) {
                this.setState({ loading: false });
                return;
            }

            const [editions, totalProceeds, ownerAddress, instanceStyle] = await Promise.all([
                this.adapter.getEditions().catch(() => []),
                this.adapter.getTotalProceeds().catch(() => '0'),
                this.adapter.owner().catch(() => null),
                this.adapter.getStyle().catch(() => '')
            ]);

            const earnings = {};
            for (const edition of editions) {
                if (edition.creator?.toLowerCase() === address?.toLowerCase()) {
                    try {
                        earnings[edition.id] = await this.adapter.getCreatorBalance(edition.id);
                    } catch (error) {
                        console.warn(`Failed to get earnings for edition ${edition.id}:`, error);
                        earnings[edition.id] = '0';
                    }
                }
            }

            this.setState({
                editions,
                earnings,
                totalProceeds,
                ownerAddress,
                instanceStyle,
                loading: false
            });
        } catch (error) {
            console.error('[CreatorDashboard] Failed to load dashboard data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load dashboard data'
            });
        }
    }

    // Tab switching
    handleTabClick(tab) {
        this.setState({ activeTab: tab, error: null });
    }

    // Withdraw handlers
    async handleWithdraw() {
        const { withdrawAmount } = this.state;
        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseEther(withdrawAmount).toString();

            await this.adapter.withdraw(amountWei);

            this.setState({ withdrawAmount: '', txPending: false });
            await this.loadDashboardData();
        } catch (error) {
            console.error('[CreatorDashboard] Withdraw error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Withdraw failed'
            });
        }
    }

    handleWithdrawMax() {
        const totalEarnings = this.calculateTotalEarnings();
        this.setState({ withdrawAmount: totalEarnings });
    }

    handleWithdrawAmountChange(e) {
        this.setState({ withdrawAmount: e.target.value, error: null });
    }

    async handleClaimVaultFees() {
        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.claimVaultFees();
            this.setState({ txPending: false });
            await this.loadDashboardData();
        } catch (error) {
            console.error('[CreatorDashboard] Claim vault fees error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to claim vault fees'
            });
        }
    }

    // Add Edition handlers
    async handleAddEdition() {
        const { newEdition } = this.state;

        if (!newEdition.name || !newEdition.price) {
            this.setState({ error: 'Please enter name and price for the edition' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            const metadata = {
                name: newEdition.name,
                description: newEdition.description,
                image: newEdition.imageUrl
            };
            const priceWei = ethers.utils.parseEther(newEdition.price).toString();
            const maxSupply = newEdition.maxSupply || '0';

            await this.adapter.addEdition({
                metadata,
                price: priceWei,
                maxSupply,
                royaltyPercent: '0'
            });

            this.setState({
                txPending: false,
                newEdition: {
                    name: '',
                    description: '',
                    imageUrl: '',
                    price: '',
                    maxSupply: ''
                }
            });
            await this.loadDashboardData();
        } catch (error) {
            console.error('[CreatorDashboard] Add edition error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to add edition'
            });
        }
    }

    handleNewEditionChange(field, value) {
        this.setState({
            newEdition: { ...this.state.newEdition, [field]: value },
            error: null
        });
    }

    // Metadata update handlers
    async handleUpdateMetadata() {
        const { metadataUpdate } = this.state;
        if (metadataUpdate.editionId === null || !metadataUpdate.uri) {
            this.setState({ error: 'Please select an edition and enter a metadata URI' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.updateEditionMetadata(metadataUpdate.editionId, metadataUpdate.uri);
            this.setState({
                txPending: false,
                metadataUpdate: { editionId: null, uri: '' }
            });
            await this.loadDashboardData();
        } catch (error) {
            console.error('[CreatorDashboard] Update metadata error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to update metadata'
            });
        }
    }

    handleMetadataEditionChange(e) {
        this.setState({
            metadataUpdate: {
                ...this.state.metadataUpdate,
                editionId: e.target.value ? parseInt(e.target.value) : null
            },
            error: null
        });
    }

    handleMetadataUriChange(e) {
        this.setState({
            metadataUpdate: {
                ...this.state.metadataUpdate,
                uri: e.target.value
            },
            error: null
        });
    }

    // Style update handlers
    async handleUpdateStyle() {
        const { styleUpdate } = this.state;
        if (!styleUpdate.uri) {
            this.setState({ error: 'Please enter a style URI' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            if (styleUpdate.editionId !== null) {
                await this.adapter.setEditionStyle(styleUpdate.editionId, styleUpdate.uri);
            } else {
                await this.adapter.setStyle(styleUpdate.uri);
            }

            this.setState({
                txPending: false,
                styleUpdate: { editionId: null, uri: '' }
            });
            await this.loadDashboardData();
        } catch (error) {
            console.error('[CreatorDashboard] Update style error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to update style'
            });
        }
    }

    handleStyleEditionChange(e) {
        this.setState({
            styleUpdate: {
                ...this.state.styleUpdate,
                editionId: e.target.value === '' ? null : parseInt(e.target.value)
            },
            error: null
        });
    }

    handleStyleUriChange(e) {
        this.setState({
            styleUpdate: {
                ...this.state.styleUpdate,
                uri: e.target.value
            },
            error: null
        });
    }

    calculateTotalEarnings() {
        try {
            const total = Object.values(this.state.earnings).reduce((sum, earnings) => {
                return sum + BigInt(earnings || '0');
            }, BigInt(0));
            return this.formatEther(total.toString());
        } catch (error) {
            return '0.0000';
        }
    }

    formatEther(wei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                return parseFloat(window.ethers.utils.formatEther(wei)).toFixed(4);
            }
            const eth = parseFloat(wei) / 1e18;
            return eth.toFixed(4);
        } catch (error) {
            return '0.0000';
        }
    }

    renderOverviewTab() {
        const address = walletService.getAddress();
        const creatorEditions = this.state.editions.filter(e =>
            e.creator?.toLowerCase() === address?.toLowerCase()
        );
        const totalEarnings = this.calculateTotalEarnings();
        const totalProceeds = this.formatEther(this.state.totalProceeds);
        const isOwner = this.isOwner();

        return h('div', { className: 'overview-tab' },
            h('div', { className: 'dashboard-stats' },
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Your Editions'),
                    h('span', { className: 'stat-value' }, creatorEditions.length)
                ),
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Your Earnings'),
                    h('span', { className: 'stat-value' }, `${totalEarnings} ETH`)
                ),
                isOwner && h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Total Proceeds'),
                    h('span', { className: 'stat-value' }, `${totalProceeds} ETH`)
                )
            ),

            h('div', { className: 'creator-editions' },
                h('h3', null, 'Your Editions'),
                h('div', { className: 'editions-list' },
                    ...creatorEditions.map(edition => this.renderCreatorEdition(edition))
                )
            )
        );
    }

    renderCreatorEdition(edition) {
        const earnings = this.state.earnings[edition.id] || '0';
        const earningsEth = this.formatEther(earnings);
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;

        return h('div', { className: 'creator-edition-card', key: `edition-${edition.id}` },
            h('h4', null, name),
            h('div', { className: 'edition-details' },
                h('p', null, h('strong', null, 'Supply:'), ` ${supply}`),
                h('p', null, h('strong', null, 'Earnings:'), ` ${earningsEth} ETH`),
                h('p', null, h('strong', null, 'Price:'), ` ${this.formatEther(edition.price)} ETH`)
            )
        );
    }

    renderWithdrawTab() {
        const { withdrawAmount, txPending } = this.state;
        const totalEarnings = this.calculateTotalEarnings();
        const canWithdraw = parseFloat(totalEarnings) > 0;

        return h('div', { className: 'withdraw-tab' },
            h('div', { className: 'withdraw-section' },
                h('h3', null, 'Withdraw Earnings'),
                h('p', { className: 'section-description' },
                    'Your earnings from edition sales (80% after tithe to vault).'
                ),

                h('div', { className: 'balance-display' },
                    h('span', { className: 'balance-label' }, 'Available to Withdraw:'),
                    h('span', { className: 'balance-value' }, `${totalEarnings} ETH`)
                ),

                h('div', { className: 'withdraw-controls' },
                    h('div', { className: 'input-row' },
                        h('input', {
                            type: 'number',
                            className: 'withdraw-input',
                            placeholder: 'Amount in ETH',
                            value: withdrawAmount,
                            onInput: this.bind(this.handleWithdrawAmountChange),
                            step: '0.0001',
                            min: '0',
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'max-btn',
                            onClick: this.bind(this.handleWithdrawMax),
                            disabled: !canWithdraw || txPending
                        }, 'MAX')
                    ),
                    h('button', {
                        className: 'action-btn withdraw-btn',
                        onClick: this.bind(this.handleWithdraw),
                        disabled: !canWithdraw || txPending
                    }, txPending ? 'Processing...' : 'Withdraw')
                )
            ),

            h('div', { className: 'vault-fees-section' },
                h('h3', null, 'Vault Fees'),
                h('p', { className: 'section-description' },
                    'If you\'re a vault benefactor, claim accumulated fees here.'
                ),
                h('button', {
                    className: 'action-btn claim-fees-btn',
                    onClick: this.bind(this.handleClaimVaultFees),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Claim Vault Fees')
            )
        );
    }

    renderEditionsTab() {
        const { newEdition, metadataUpdate, editions, txPending } = this.state;

        return h('div', { className: 'editions-tab' },
            h('div', { className: 'add-edition-section' },
                h('h3', null, 'Add New Edition'),
                h('div', { className: 'form-group' },
                    h('label', null, 'Name'),
                    h('input', {
                        type: 'text',
                        className: 'form-input',
                        placeholder: 'Edition name',
                        value: newEdition.name,
                        onInput: (e) => this.handleNewEditionChange('name', e.target.value),
                        disabled: txPending
                    })
                ),
                h('div', { className: 'form-group' },
                    h('label', null, 'Description'),
                    h('textarea', {
                        className: 'form-textarea',
                        placeholder: 'Edition description',
                        value: newEdition.description,
                        onInput: (e) => this.handleNewEditionChange('description', e.target.value),
                        disabled: txPending
                    })
                ),
                h('div', { className: 'form-group' },
                    h('label', null, 'Image URL'),
                    h('input', {
                        type: 'text',
                        className: 'form-input',
                        placeholder: 'ipfs://... or https://...',
                        value: newEdition.imageUrl,
                        onInput: (e) => this.handleNewEditionChange('imageUrl', e.target.value),
                        disabled: txPending
                    })
                ),
                h('div', { className: 'form-row' },
                    h('div', { className: 'form-group half' },
                        h('label', null, 'Price (ETH)'),
                        h('input', {
                            type: 'number',
                            className: 'form-input',
                            placeholder: '0.01',
                            value: newEdition.price,
                            onInput: (e) => this.handleNewEditionChange('price', e.target.value),
                            step: '0.001',
                            min: '0',
                            disabled: txPending
                        })
                    ),
                    h('div', { className: 'form-group half' },
                        h('label', null, 'Max Supply (0 = unlimited)'),
                        h('input', {
                            type: 'number',
                            className: 'form-input',
                            placeholder: '100',
                            value: newEdition.maxSupply,
                            onInput: (e) => this.handleNewEditionChange('maxSupply', e.target.value),
                            min: '0',
                            disabled: txPending
                        })
                    )
                ),
                h('button', {
                    className: 'action-btn add-edition-btn',
                    onClick: this.bind(this.handleAddEdition),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Add Edition')
            ),

            h('div', { className: 'update-metadata-section' },
                h('h3', null, 'Update Edition Metadata'),
                h('div', { className: 'form-row' },
                    h('div', { className: 'form-group half' },
                        h('label', null, 'Edition'),
                        h('select', {
                            className: 'form-select',
                            value: metadataUpdate.editionId || '',
                            onChange: this.bind(this.handleMetadataEditionChange),
                            disabled: txPending
                        },
                            h('option', { value: '' }, 'Select edition...'),
                            ...editions.map(e =>
                                h('option', { value: e.id, key: `meta-${e.id}` },
                                    e.metadata?.name || `Edition #${e.id}`
                                )
                            )
                        )
                    ),
                    h('div', { className: 'form-group half' },
                        h('label', null, 'Metadata URI'),
                        h('input', {
                            type: 'text',
                            className: 'form-input',
                            placeholder: 'ipfs://...',
                            value: metadataUpdate.uri,
                            onInput: this.bind(this.handleMetadataUriChange),
                            disabled: txPending
                        })
                    )
                ),
                h('button', {
                    className: 'action-btn update-metadata-btn',
                    onClick: this.bind(this.handleUpdateMetadata),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Update Metadata')
            )
        );
    }

    renderStyleTab() {
        const { styleUpdate, instanceStyle, editions, txPending } = this.state;

        return h('div', { className: 'style-tab' },
            h('div', { className: 'current-style-section' },
                h('h3', null, 'Current Style'),
                h('p', { className: 'current-style' },
                    instanceStyle || 'No style set'
                )
            ),

            h('div', { className: 'update-style-section' },
                h('h3', null, 'Update Style'),
                h('p', { className: 'section-description' },
                    'Set a custom style URI for the entire collection or a specific edition.'
                ),

                h('div', { className: 'form-group' },
                    h('label', null, 'Target'),
                    h('select', {
                        className: 'form-select',
                        value: styleUpdate.editionId === null ? '' : styleUpdate.editionId,
                        onChange: this.bind(this.handleStyleEditionChange),
                        disabled: txPending
                    },
                        h('option', { value: '' }, 'Entire Collection'),
                        ...editions.map(e =>
                            h('option', { value: e.id, key: `style-${e.id}` },
                                e.metadata?.name || `Edition #${e.id}`
                            )
                        )
                    )
                ),

                h('div', { className: 'form-group' },
                    h('label', null, 'Style URI'),
                    h('input', {
                        type: 'text',
                        className: 'form-input',
                        placeholder: 'ipfs://... or https://...',
                        value: styleUpdate.uri,
                        onInput: this.bind(this.handleStyleUriChange),
                        disabled: txPending
                    })
                ),

                h('button', {
                    className: 'action-btn update-style-btn',
                    onClick: this.bind(this.handleUpdateStyle),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Update Style')
            )
        );
    }

    renderFeaturedTab() {
        return h('div', { className: 'featured-tab' },
            h('div', { className: 'featured-rental-container' },
                h('p', { className: 'featured-placeholder' }, 'Featured rental component placeholder')
            )
        );
    }

    render() {
        const { loading, error, activeTab } = this.state;
        const walletConnected = this.isConnected();

        if (!walletConnected) {
            return h('div', { className: 'creator-dashboard marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h2', null, 'Creator Dashboard')
                ),
                h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect your wallet to manage your collection')
                )
            );
        }

        if (loading) {
            return h('div', { className: 'creator-dashboard loading marble-bg' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading dashboard...')
            );
        }

        const isOwner = this.isOwner();

        if (!isOwner) {
            return h('div', { className: 'creator-dashboard-hidden' });
        }

        return h('div', { className: 'creator-dashboard marble-bg' },
            h('div', { className: 'panel-header' },
                h('h2', null, 'Creator Dashboard')
            ),

            error && h('div', { className: 'error-banner' }, error),

            h('div', { className: 'dashboard-tabs' },
                h('button', {
                    className: `tab-btn ${activeTab === 'overview' ? 'active' : ''}`,
                    onClick: () => this.handleTabClick('overview')
                }, 'Overview'),
                h('button', {
                    className: `tab-btn ${activeTab === 'withdraw' ? 'active' : ''}`,
                    onClick: () => this.handleTabClick('withdraw')
                }, 'Withdraw'),
                isOwner && h('button', {
                    className: `tab-btn ${activeTab === 'editions' ? 'active' : ''}`,
                    onClick: () => this.handleTabClick('editions')
                }, 'Editions'),
                isOwner && h('button', {
                    className: `tab-btn ${activeTab === 'style' ? 'active' : ''}`,
                    onClick: () => this.handleTabClick('style')
                }, 'Style'),
                isOwner && h('button', {
                    className: `tab-btn ${activeTab === 'featured' ? 'active' : ''}`,
                    onClick: () => this.handleTabClick('featured')
                }, 'Featured')
            ),

            h('div', { className: 'tab-content' },
                activeTab === 'overview' && this.renderOverviewTab(),
                activeTab === 'withdraw' && this.renderWithdrawTab(),
                activeTab === 'editions' && isOwner && this.renderEditionsTab(),
                activeTab === 'style' && isOwner && this.renderStyleTab(),
                activeTab === 'featured' && isOwner && this.renderFeaturedTab()
            )
        );
    }
}

export default CreatorDashboard;
