/**
 * CreatorDashboard Component
 *
 * Dashboard for creators to manage their ERC1155 collections:
 * - View earnings and total proceeds
 * - Withdraw creator balance
 * - Claim vault fees (if owner is benefactor)
 * - Update edition metadata
 * - Customize styles (instance and per-edition)
 * - Add new editions
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { FeaturedRental } from '../FeaturedRental/FeaturedRental.js';

export class CreatorDashboard extends Component {
    constructor(projectId, adapter, project) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.project = project;
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

    async onMount() {
        await this.loadDashboardData();
        this.setupSubscriptions();
    }

    onUnmount() {
        if (this._unsubscribers) {
            this._unsubscribers.forEach(unsub => unsub());
        }
    }

    onStateUpdate(oldState, newState) {
        // Mount FeaturedRental when featured tab becomes active
        if (newState.activeTab === 'featured' && oldState.activeTab !== 'featured') {
            // Use setTimeout to ensure DOM is ready after render
            this.setTimeout(() => {
                this.mountFeaturedRental();
            }, 0);
        }
        // Unmount FeaturedRental when leaving featured tab
        if (oldState.activeTab === 'featured' && newState.activeTab !== 'featured') {
            this.unmountFeaturedRental();
        }
    }

    mountFeaturedRental() {
        const container = this.getRef('featured-rental-container', '.featured-rental-container');
        if (container && !this._children.has('featured-rental')) {
            const contractAddress = this.project?.contractAddress || this.project?.address || this.projectId;
            const featuredComponent = new FeaturedRental(contractAddress, this.adapter);
            const featuredElement = document.createElement('div');
            container.appendChild(featuredElement);
            featuredComponent.mount(featuredElement);
            this.createChild('featured-rental', featuredComponent);
        }
    }

    unmountFeaturedRental() {
        if (this._children.has('featured-rental')) {
            const child = this._children.get('featured-rental');
            if (child && child.unmount) {
                child.unmount();
            }
            this._children.delete('featured-rental');
        }
    }

    setupSubscriptions() {
        this._unsubscribers = [
            eventBus.on('transaction:confirmed', () => this.loadDashboardData()),
            eventBus.on('account:changed', () => this.loadDashboardData()),
            eventBus.on('wallet:connected', () => this.loadDashboardData()),
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false }))
        ];
    }

    async loadDashboardData() {
        try {
            this.setState({ loading: true, error: null });

            const address = walletService.getAddress();
            if (!address) {
                this.setState({ loading: false });
                return;
            }

            // Load all dashboard data in parallel
            const [editions, totalProceeds, ownerAddress, instanceStyle] = await Promise.all([
                this.adapter.getEditions().catch(() => []),
                this.adapter.getTotalProceeds().catch(() => '0'),
                this.adapter.owner().catch(() => null),
                this.adapter.getStyle().catch(() => '')
            ]);

            // Load creator balance for each edition the user created
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

    isOwner() {
        const address = walletService.getAddress();
        return address && this.state.ownerAddress &&
            address.toLowerCase() === this.state.ownerAddress.toLowerCase();
    }

    // =========================
    // Withdraw Functions
    // =========================

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

    async handleWithdrawMax() {
        const totalEarnings = this.calculateTotalEarnings();
        this.setState({ withdrawAmount: totalEarnings });
    }

    // =========================
    // Vault Fees Functions
    // =========================

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

    // =========================
    // Metadata Update Functions
    // =========================

    async handleUpdateMetadata() {
        const { metadataUpdate } = this.state;
        if (!metadataUpdate.editionId || !metadataUpdate.uri) {
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

    // =========================
    // Style Update Functions
    // =========================

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

    // =========================
    // Add Edition Functions
    // =========================

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
            const maxSupply = newEdition.maxSupply || '0'; // 0 = unlimited

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

    // =========================
    // Helper Functions
    // =========================

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

    formatPrice(priceWei) {
        return this.formatEther(priceWei);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================
    // Render Functions
    // =========================

    render() {
        const walletConnected = !!walletService.getAddress();

        if (!walletConnected) {
            return `
                <div class="creator-dashboard marble-bg">
                    <div class="panel-header">
                        <h2>Creator Dashboard</h2>
                    </div>
                    <div class="connect-prompt">
                        <p>Connect your wallet to manage your collection</p>
                    </div>
                </div>
            `;
        }

        if (this.state.loading) {
            return `
                <div class="creator-dashboard loading marble-bg">
                    <div class="loading-spinner"></div>
                    <p>Loading dashboard...</p>
                </div>
            `;
        }

        const isOwner = this.isOwner();

        // Don't render anything if user is not the owner
        if (!isOwner) {
            return '';
        }

        const address = walletService.getAddress();
        const creatorEditions = this.state.editions.filter(e =>
            e.creator?.toLowerCase() === address?.toLowerCase()
        );

        const { activeTab, error, txPending } = this.state;

        return `
            <div class="creator-dashboard marble-bg">
                <div class="panel-header">
                    <h2>Creator Dashboard</h2>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                <div class="dashboard-tabs">
                    <button class="tab-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">
                        Overview
                    </button>
                    <button class="tab-btn ${activeTab === 'withdraw' ? 'active' : ''}" data-tab="withdraw">
                        Withdraw
                    </button>
                    ${isOwner ? `
                        <button class="tab-btn ${activeTab === 'editions' ? 'active' : ''}" data-tab="editions">
                            Editions
                        </button>
                        <button class="tab-btn ${activeTab === 'style' ? 'active' : ''}" data-tab="style">
                            Style
                        </button>
                        <button class="tab-btn ${activeTab === 'featured' ? 'active' : ''}" data-tab="featured">
                            Featured
                        </button>
                    ` : ''}
                </div>

                <div class="tab-content">
                    ${activeTab === 'overview' ? this.renderOverviewTab(creatorEditions, isOwner) : ''}
                    ${activeTab === 'withdraw' ? this.renderWithdrawTab(creatorEditions, txPending) : ''}
                    ${activeTab === 'editions' && isOwner ? this.renderEditionsTab(txPending) : ''}
                    ${activeTab === 'style' && isOwner ? this.renderStyleTab(txPending) : ''}
                    ${activeTab === 'featured' && isOwner ? this.renderFeaturedTab() : ''}
                </div>
            </div>
        `;
    }

    renderOverviewTab(creatorEditions, isOwner) {
        const totalEarnings = this.calculateTotalEarnings();
        const totalProceeds = this.formatEther(this.state.totalProceeds);

        return `
            <div class="overview-tab">
                <div class="dashboard-stats">
                    <div class="stat-card">
                        <span class="stat-label">Your Editions</span>
                        <span class="stat-value">${creatorEditions.length}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Your Earnings</span>
                        <span class="stat-value">${totalEarnings} ETH</span>
                    </div>
                    ${isOwner ? `
                        <div class="stat-card">
                            <span class="stat-label">Total Proceeds</span>
                            <span class="stat-value">${totalProceeds} ETH</span>
                        </div>
                    ` : ''}
                </div>

                <div class="creator-editions">
                    <h3>Your Editions</h3>
                    <div class="editions-list">
                        ${creatorEditions.map(edition => this.renderCreatorEdition(edition)).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    renderCreatorEdition(edition) {
        const earnings = this.state.earnings[edition.id] || '0';
        const earningsEth = this.formatEther(earnings);
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;

        return `
            <div class="creator-edition-card">
                <h4>${this.escapeHtml(name)}</h4>
                <div class="edition-details">
                    <p><strong>Supply:</strong> ${supply}</p>
                    <p><strong>Earnings:</strong> ${earningsEth} ETH</p>
                    <p><strong>Price:</strong> ${this.formatPrice(edition.price)} ETH</p>
                </div>
            </div>
        `;
    }

    renderWithdrawTab(creatorEditions, txPending) {
        const totalEarnings = this.calculateTotalEarnings();
        const { withdrawAmount } = this.state;
        const canWithdraw = parseFloat(totalEarnings) > 0;

        return `
            <div class="withdraw-tab">
                <div class="withdraw-section">
                    <h3>Withdraw Earnings</h3>
                    <p class="section-description">
                        Your earnings from edition sales (80% after tithe to vault).
                    </p>

                    <div class="balance-display">
                        <span class="balance-label">Available to Withdraw:</span>
                        <span class="balance-value">${totalEarnings} ETH</span>
                    </div>

                    <div class="withdraw-controls">
                        <div class="input-row">
                            <input
                                type="number"
                                class="withdraw-input"
                                placeholder="Amount in ETH"
                                value="${withdrawAmount}"
                                data-action="withdraw-amount"
                                step="0.0001"
                                min="0"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button
                                class="max-btn"
                                data-action="withdraw-max"
                                ${!canWithdraw || txPending ? 'disabled' : ''}
                            >
                                MAX
                            </button>
                        </div>
                        <button
                            class="action-btn withdraw-btn"
                            data-action="withdraw"
                            ${!canWithdraw || txPending ? 'disabled' : ''}
                        >
                            ${txPending ? 'Processing...' : 'Withdraw'}
                        </button>
                    </div>
                </div>

                <div class="vault-fees-section">
                    <h3>Vault Fees</h3>
                    <p class="section-description">
                        If you're a vault benefactor, claim accumulated fees here.
                    </p>
                    <button
                        class="action-btn claim-fees-btn"
                        data-action="claim-vault-fees"
                        ${txPending ? 'disabled' : ''}
                    >
                        ${txPending ? 'Processing...' : 'Claim Vault Fees'}
                    </button>
                </div>
            </div>
        `;
    }

    renderEditionsTab(txPending) {
        const { newEdition, metadataUpdate, editions } = this.state;

        return `
            <div class="editions-tab">
                <div class="add-edition-section">
                    <h3>Add New Edition</h3>
                    <div class="form-group">
                        <label>Name</label>
                        <input
                            type="text"
                            class="form-input"
                            placeholder="Edition name"
                            value="${this.escapeHtml(newEdition.name)}"
                            data-field="newEdition.name"
                            ${txPending ? 'disabled' : ''}
                        />
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <textarea
                            class="form-textarea"
                            placeholder="Edition description"
                            data-field="newEdition.description"
                            ${txPending ? 'disabled' : ''}
                        >${this.escapeHtml(newEdition.description)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Image URL</label>
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            value="${this.escapeHtml(newEdition.imageUrl)}"
                            data-field="newEdition.imageUrl"
                            ${txPending ? 'disabled' : ''}
                        />
                    </div>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Price (ETH)</label>
                            <input
                                type="number"
                                class="form-input"
                                placeholder="0.01"
                                value="${newEdition.price}"
                                data-field="newEdition.price"
                                step="0.001"
                                min="0"
                                ${txPending ? 'disabled' : ''}
                            />
                        </div>
                        <div class="form-group half">
                            <label>Max Supply (0 = unlimited)</label>
                            <input
                                type="number"
                                class="form-input"
                                placeholder="100"
                                value="${newEdition.maxSupply}"
                                data-field="newEdition.maxSupply"
                                min="0"
                                ${txPending ? 'disabled' : ''}
                            />
                        </div>
                    </div>
                    <button
                        class="action-btn add-edition-btn"
                        data-action="add-edition"
                        ${txPending ? 'disabled' : ''}
                    >
                        ${txPending ? 'Processing...' : 'Add Edition'}
                    </button>
                </div>

                <div class="update-metadata-section">
                    <h3>Update Edition Metadata</h3>
                    <div class="form-row">
                        <div class="form-group half">
                            <label>Edition</label>
                            <select
                                class="form-select"
                                data-field="metadataUpdate.editionId"
                                ${txPending ? 'disabled' : ''}
                            >
                                <option value="">Select edition...</option>
                                ${editions.map(e => `
                                    <option value="${e.id}" ${metadataUpdate.editionId == e.id ? 'selected' : ''}>
                                        ${e.metadata?.name || `Edition #${e.id}`}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="form-group half">
                            <label>Metadata URI</label>
                            <input
                                type="text"
                                class="form-input"
                                placeholder="ipfs://..."
                                value="${this.escapeHtml(metadataUpdate.uri)}"
                                data-field="metadataUpdate.uri"
                                ${txPending ? 'disabled' : ''}
                            />
                        </div>
                    </div>
                    <button
                        class="action-btn update-metadata-btn"
                        data-action="update-metadata"
                        ${txPending ? 'disabled' : ''}
                    >
                        ${txPending ? 'Processing...' : 'Update Metadata'}
                    </button>
                </div>
            </div>
        `;
    }

    renderStyleTab(txPending) {
        const { styleUpdate, instanceStyle, editions } = this.state;

        return `
            <div class="style-tab">
                <div class="current-style-section">
                    <h3>Current Style</h3>
                    <p class="current-style">
                        ${instanceStyle ? this.escapeHtml(instanceStyle) : 'No style set'}
                    </p>
                </div>

                <div class="update-style-section">
                    <h3>Update Style</h3>
                    <p class="section-description">
                        Set a custom style URI for the entire collection or a specific edition.
                    </p>

                    <div class="form-group">
                        <label>Target</label>
                        <select
                            class="form-select"
                            data-field="styleUpdate.editionId"
                            ${txPending ? 'disabled' : ''}
                        >
                            <option value="" ${styleUpdate.editionId === null ? 'selected' : ''}>
                                Entire Collection
                            </option>
                            ${editions.map(e => `
                                <option value="${e.id}" ${styleUpdate.editionId == e.id ? 'selected' : ''}>
                                    ${e.metadata?.name || `Edition #${e.id}`}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Style URI</label>
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            value="${this.escapeHtml(styleUpdate.uri)}"
                            data-field="styleUpdate.uri"
                            ${txPending ? 'disabled' : ''}
                        />
                    </div>

                    <button
                        class="action-btn update-style-btn"
                        data-action="update-style"
                        ${txPending ? 'disabled' : ''}
                    >
                        ${txPending ? 'Processing...' : 'Update Style'}
                    </button>
                </div>
            </div>
        `;
    }

    renderFeaturedTab() {
        return `
            <div class="featured-tab">
                <div class="featured-rental-container" ref="featured-rental-container">
                    <!-- FeaturedRental component will be mounted here -->
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMListeners();
    }

    setupDOMListeners() {
        const container = this._element;
        if (!container) return;

        // Tab switching
        container.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                if (tab) {
                    this.setState({ activeTab: tab, error: null });
                }
                return;
            }

            const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action;
            if (!action) return;

            switch (action) {
                case 'withdraw':
                    this.handleWithdraw();
                    break;
                case 'withdraw-max':
                    this.handleWithdrawMax();
                    break;
                case 'claim-vault-fees':
                    this.handleClaimVaultFees();
                    break;
                case 'add-edition':
                    this.handleAddEdition();
                    break;
                case 'update-metadata':
                    this.handleUpdateMetadata();
                    break;
                case 'update-style':
                    this.handleUpdateStyle();
                    break;
            }
        });

        // Form input handling
        container.addEventListener('input', (e) => {
            const field = e.target.dataset.field || e.target.dataset.action;
            if (!field) return;

            if (field === 'withdraw-amount') {
                this.setState({ withdrawAmount: e.target.value, error: null });
            } else if (field.startsWith('newEdition.')) {
                const key = field.replace('newEdition.', '');
                this.setState({
                    newEdition: { ...this.state.newEdition, [key]: e.target.value },
                    error: null
                });
            } else if (field.startsWith('metadataUpdate.')) {
                const key = field.replace('metadataUpdate.', '');
                this.setState({
                    metadataUpdate: { ...this.state.metadataUpdate, [key]: e.target.value },
                    error: null
                });
            } else if (field.startsWith('styleUpdate.')) {
                const key = field.replace('styleUpdate.', '');
                const value = key === 'editionId' ? (e.target.value === '' ? null : parseInt(e.target.value)) : e.target.value;
                this.setState({
                    styleUpdate: { ...this.state.styleUpdate, [key]: value },
                    error: null
                });
            }
        });

        // Select change handling
        container.addEventListener('change', (e) => {
            if (e.target.tagName !== 'SELECT') return;
            const field = e.target.dataset.field;
            if (!field) return;

            if (field === 'metadataUpdate.editionId') {
                this.setState({
                    metadataUpdate: {
                        ...this.state.metadataUpdate,
                        editionId: e.target.value ? parseInt(e.target.value) : null
                    },
                    error: null
                });
            } else if (field === 'styleUpdate.editionId') {
                this.setState({
                    styleUpdate: {
                        ...this.state.styleUpdate,
                        editionId: e.target.value === '' ? null : parseInt(e.target.value)
                    },
                    error: null
                });
            }
        });
    }
}
