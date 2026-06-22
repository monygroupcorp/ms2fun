/**
 * FeaturedRental Component
 *
 * Allows project owners to rent featured positions for their projects:
 * - View current featured queue and position prices
 * - Rent a position for a specific duration
 * - Renew/extend existing position
 * - Bump to a better position
 * - Manage auto-renewal deposits
 * - Cleanup expired rentals (permissionless, incentivized)
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class FeaturedRental extends Component {
    constructor(instanceAddress, adapter) {
        super();
        this.instanceAddress = instanceAddress;
        this.adapter = adapter;
        this.featuredQueueManager = null;
        this.masterRegistry = null;  // For instance info lookups
        this.state = {
            loading: true,
            error: null,
            txPending: false,
            // Rental configuration
            minDuration: 0,
            maxDuration: 0,
            basePrice: '0',
            maxQueueSize: 0,
            // Current rental info for this instance
            currentRental: null,
            // Featured queue info
            featuredQueue: [],
            queueUtilization: null,
            // Position prices
            positionPrices: [],
            // Form state
            selectedPosition: 0,
            rentalDuration: 86400, // 1 day default
            depositAmount: '',
            calculatedCost: '0',
            // View state
            activeTab: 'rent'
        };
    }

    async onMount() {
        await this.initialize();
        this.setupSubscriptions();
    }

    onUnmount() {
        if (this._unsubscribers) {
            this._unsubscribers.forEach(unsub => unsub());
        }
    }

    setupSubscriptions() {
        this._unsubscribers = [
            eventBus.on('transaction:confirmed', () => this.loadData()),
            eventBus.on('account:changed', () => this.loadData()),
            eventBus.on('wallet:connected', () => this.loadData()),
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false }))
        ];
    }

    async initialize() {
        try {
            this.setState({ loading: true, error: null });

            // Get FeaturedQueueManager adapter for rental operations
            this.featuredQueueManager = await serviceFactory.getFeaturedQueueManagerAdapter();
            if (!this.featuredQueueManager) {
                throw new Error('FeaturedQueueManager not available');
            }

            // Get MasterRegistry adapter for instance info lookups
            this.masterRegistry = await serviceFactory.getMasterRegistryAdapter();

            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Initialize error:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to initialize'
            });
        }
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Load rental configuration from FeaturedQueueManager in parallel
            const [minDuration, maxDuration, basePrice, maxQueueSize] = await Promise.all([
                this.featuredQueueManager.minRentalDuration().catch(() => 604800),  // 7 days default
                this.featuredQueueManager.maxRentalDuration().catch(() => 31536000), // 365 days default
                this.featuredQueueManager.baseRentalPrice().catch(() => '0.001'),
                this.featuredQueueManager.maxQueueSize().catch(() => 100)
            ]);

            // Load current rental info for this instance
            const currentRental = await this.featuredQueueManager.getRentalInfo(this.instanceAddress)
                .catch(() => ({ rental: { active: false }, position: 0, renewalDeposit: '0', isExpired: false }));

            // Load queue utilization
            const queueUtilization = await this.featuredQueueManager.getQueueUtilization()
                .catch(() => ({ currentUtilization: 0, adjustedBasePrice: '0.001', length: 0, maxSize: 100 }));

            // Load featured queue (first 10 positions or queue length, whichever is smaller)
            const queueLength = await this.featuredQueueManager.queueLength().catch(() => 0);
            const loadSize = Math.min(queueLength, 10);
            const featuredQueue = loadSize > 0 ? await this.loadFeaturedQueue(loadSize) : [];

            // Load position prices for first 10 positions
            const positionPrices = await this.loadPositionPrices(10);

            this.setState({
                loading: false,
                minDuration,
                maxDuration,
                basePrice,
                maxQueueSize,
                currentRental,
                queueUtilization,
                featuredQueue,
                positionPrices
            });

            // Calculate initial cost
            await this.updateCalculatedCost();
        } catch (error) {
            console.error('[FeaturedRental] Load data error:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load rental data'
            });
        }
    }

    async loadFeaturedQueue(size) {
        try {
            if (size <= 0) return [];

            const result = await this.featuredQueueManager.getFeaturedInstances(0, size);
            const instances = result.instances || [];
            const queue = [];

            for (let i = 0; i < instances.length; i++) {
                if (instances[i] && instances[i] !== '0x0000000000000000000000000000000000000000') {
                    const rentalInfo = await this.featuredQueueManager.getRentalInfo(instances[i]).catch(() => null);
                    // Get instance info from MasterRegistry if available
                    let instanceInfo = null;
                    if (this.masterRegistry) {
                        instanceInfo = await this.masterRegistry.getInstanceInfo(instances[i]).catch(() => null);
                    }

                    queue.push({
                        position: i + 1,  // 1-indexed
                        instanceAddress: instances[i],
                        expiresAt: rentalInfo?.rental?.expiresAt || 0,
                        isActive: rentalInfo?.rental?.active || false,
                        creator: instanceInfo?.creator || null,
                        renter: rentalInfo?.rental?.renter || null
                    });
                } else {
                    queue.push({
                        position: i + 1,
                        instanceAddress: null,
                        expiresAt: 0,
                        isActive: false,
                        creator: null,
                        renter: null
                    });
                }
            }

            return queue;
        } catch (error) {
            console.warn('[FeaturedRental] Failed to load featured queue:', error);
            return [];
        }
    }

    async loadPositionPrices(size) {
        const prices = [];
        for (let i = 1; i <= size; i++) {  // 1-indexed positions
            try {
                const price = await this.featuredQueueManager.getPositionRentalPrice(i);
                prices.push({ position: i, price });
            } catch (error) {
                prices.push({ position: i, price: '0' });
            }
        }
        return prices;
    }

    async updateCalculatedCost() {
        try {
            const { selectedPosition, rentalDuration, minDuration } = this.state;
            if (selectedPosition <= 0 || rentalDuration < minDuration) {
                this.setState({ calculatedCost: '0' });
                return;
            }
            const cost = await this.featuredQueueManager.calculateRentalCost(selectedPosition, rentalDuration);
            this.setState({ calculatedCost: cost });
        } catch (error) {
            console.warn('[FeaturedRental] Failed to calculate cost:', error);
            this.setState({ calculatedCost: '0' });
        }
    }

    // =========================
    // Action Handlers
    // =========================

    async handleRentPosition() {
        const { selectedPosition, rentalDuration, calculatedCost } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.rentFeaturedPosition(
                this.instanceAddress,
                selectedPosition,
                rentalDuration,
                calculatedCost  // Payment value
            );

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Rent position error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to rent position'
            });
        }
    }

    async handleRenewPosition() {
        const { rentalDuration, calculatedCost } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.renewPosition(
                this.instanceAddress,
                rentalDuration,
                calculatedCost  // Payment value (with renewal discount applied by contract)
            );

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Renew position error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to renew position'
            });
        }
    }

    async handleBumpPosition() {
        const { selectedPosition, rentalDuration, calculatedCost } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.bumpPosition(
                this.instanceAddress,
                selectedPosition,
                rentalDuration,
                calculatedCost  // Payment value
            );

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Bump position error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to bump position'
            });
        }
    }

    async handleDepositForAutoRenewal() {
        const { depositAmount } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!depositAmount || parseFloat(depositAmount) <= 0) {
            this.setState({ error: 'Please enter a valid deposit amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.depositForAutoRenewal(this.instanceAddress, depositAmount);

            this.setState({ txPending: false, depositAmount: '' });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Deposit error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to deposit for auto-renewal'
            });
        }
    }

    async handleWithdrawDeposit() {
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.withdrawRenewalDeposit(this.instanceAddress);

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Withdraw deposit error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to withdraw deposit'
            });
        }
    }

    async handleCleanupExpired() {
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.featuredQueueManager.cleanupExpiredRentals(10); // Clean up to 10 at a time

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[FeaturedRental] Cleanup error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to cleanup expired rentals'
            });
        }
    }

    handlePositionChange(position) {
        this.setState({ selectedPosition: parseInt(position) });
        this.updateCalculatedCost();
    }

    handleDurationChange(duration) {
        this.setState({ rentalDuration: parseInt(duration) });
        this.updateCalculatedCost();
    }

    // =========================
    // Render Methods
    // =========================

    render() {
        const walletConnected = !!walletService.getAddress();

        if (!walletConnected) {
            return `
                <div class="featured-rental marble-bg">
                    <div class="panel-header">
                        <h3>Featured Position Rental</h3>
                    </div>
                    <div class="connect-prompt">
                        <p>Connect your wallet to rent a featured position</p>
                    </div>
                </div>
            `;
        }

        if (this.state.loading) {
            return `
                <div class="featured-rental marble-bg loading">
                    <div class="loading-spinner"></div>
                    <p>Loading rental info...</p>
                </div>
            `;
        }

        const { error, txPending, activeTab, currentRental } = this.state;
        const hasActiveRental = currentRental && currentRental.isActive;

        return `
            <div class="featured-rental marble-bg">
                <div class="panel-header">
                    <h3>Featured Position Rental</h3>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                <div class="rental-tabs">
                    <button class="tab-btn ${activeTab === 'rent' ? 'active' : ''}" data-tab="rent">
                        ${hasActiveRental ? 'Manage Position' : 'Rent Position'}
                    </button>
                    <button class="tab-btn ${activeTab === 'queue' ? 'active' : ''}" data-tab="queue">
                        Featured Queue
                    </button>
                    <button class="tab-btn ${activeTab === 'cleanup' ? 'active' : ''}" data-tab="cleanup">
                        Cleanup
                    </button>
                </div>

                <div class="tab-content">
                    ${activeTab === 'rent' ? this.renderRentTab(hasActiveRental, txPending) : ''}
                    ${activeTab === 'queue' ? this.renderQueueTab() : ''}
                    ${activeTab === 'cleanup' ? this.renderCleanupTab(txPending) : ''}
                </div>
            </div>
        `;
    }

    renderRentTab(hasActiveRental, txPending) {
        const {
            currentRental, positionPrices, selectedPosition, rentalDuration,
            calculatedCost, depositAmount, minDuration, maxDuration
        } = this.state;

        const durationDays = Math.floor(rentalDuration / 86400);
        const minDays = Math.ceil(minDuration / 86400);
        const maxDays = Math.floor(maxDuration / 86400);

        return `
            <div class="rent-tab">
                ${hasActiveRental ? this.renderCurrentRental(currentRental) : ''}

                <div class="rent-section">
                    <h4>${hasActiveRental ? 'Extend or Bump Position' : 'Rent a Featured Position'}</h4>
                    <p class="section-description">
                        Featured projects appear prominently on the homepage and get more visibility.
                    </p>

                    <div class="form-group">
                        <label>Position</label>
                        <select class="form-select" data-field="position" ${txPending ? 'disabled' : ''}>
                            ${positionPrices.map(p => `
                                <option value="${p.position}" ${p.position === selectedPosition ? 'selected' : ''}>
                                    Position ${p.position + 1} - ${p.price} ETH/day
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Duration (${durationDays} day${durationDays !== 1 ? 's' : ''})</label>
                        <input
                            type="range"
                            class="form-range"
                            min="${minDuration}"
                            max="${maxDuration}"
                            step="86400"
                            value="${rentalDuration}"
                            data-field="duration"
                            ${txPending ? 'disabled' : ''}
                        />
                        <div class="range-labels">
                            <span>${minDays} day${minDays !== 1 ? 's' : ''}</span>
                            <span>${maxDays} day${maxDays !== 1 ? 's' : ''}</span>
                        </div>
                    </div>

                    <div class="cost-display">
                        <span class="cost-label">Total Cost:</span>
                        <span class="cost-value">${calculatedCost} ETH</span>
                    </div>

                    <div class="rent-actions">
                        ${hasActiveRental ? `
                            <button
                                class="action-btn renew-btn"
                                data-action="renew"
                                ${txPending ? 'disabled' : ''}
                            >
                                ${txPending ? 'Processing...' : 'Extend Rental'}
                            </button>
                            <button
                                class="action-btn bump-btn"
                                data-action="bump"
                                ${txPending ? 'disabled' : ''}
                            >
                                ${txPending ? 'Processing...' : 'Bump to Position'}
                            </button>
                        ` : `
                            <button
                                class="action-btn rent-btn"
                                data-action="rent"
                                ${txPending ? 'disabled' : ''}
                            >
                                ${txPending ? 'Processing...' : 'Rent Position'}
                            </button>
                        `}
                    </div>
                </div>

                ${hasActiveRental ? this.renderAutoRenewalSection(currentRental, depositAmount, txPending) : ''}
            </div>
        `;
    }

    renderCurrentRental(rental) {
        const expiresDate = new Date(rental.expiresAt * 1000);
        const now = Date.now();
        const isExpired = rental.expiresAt * 1000 < now;
        const timeRemaining = this.formatTimeRemaining(rental.expiresAt);

        return `
            <div class="current-rental-section">
                <h4>Your Current Position</h4>
                <div class="rental-info-grid">
                    <div class="rental-stat">
                        <span class="stat-label">Position</span>
                        <span class="stat-value">#${rental.position + 1}</span>
                    </div>
                    <div class="rental-stat">
                        <span class="stat-label">Expires</span>
                        <span class="stat-value ${isExpired ? 'expired' : ''}">${timeRemaining}</span>
                    </div>
                    <div class="rental-stat">
                        <span class="stat-label">Auto-Renewal Deposit</span>
                        <span class="stat-value">${rental.autoRenewalDeposit} ETH</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderAutoRenewalSection(rental, depositAmount, txPending) {
        return `
            <div class="auto-renewal-section">
                <h4>Auto-Renewal</h4>
                <p class="section-description">
                    Deposit ETH to automatically renew your position when it expires.
                </p>

                <div class="deposit-display">
                    <span class="deposit-label">Current Deposit:</span>
                    <span class="deposit-value">${rental.autoRenewalDeposit} ETH</span>
                </div>

                <div class="deposit-controls">
                    <div class="input-row">
                        <input
                            type="number"
                            class="deposit-input"
                            placeholder="Amount in ETH"
                            value="${depositAmount}"
                            data-field="deposit"
                            step="0.01"
                            min="0"
                            ${txPending ? 'disabled' : ''}
                        />
                        <button
                            class="action-btn deposit-btn"
                            data-action="deposit"
                            ${txPending ? 'disabled' : ''}
                        >
                            ${txPending ? '...' : 'Deposit'}
                        </button>
                    </div>
                    ${parseFloat(rental.autoRenewalDeposit) > 0 ? `
                        <button
                            class="action-btn withdraw-btn"
                            data-action="withdraw"
                            ${txPending ? 'disabled' : ''}
                        >
                            ${txPending ? 'Processing...' : 'Withdraw Deposit'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderQueueTab() {
        const { featuredQueue, queueUtilization } = this.state;

        return `
            <div class="queue-tab">
                <div class="queue-stats">
                    <div class="queue-stat">
                        <span class="stat-label">Total Slots</span>
                        <span class="stat-value">${queueUtilization?.totalSlots || 0}</span>
                    </div>
                    <div class="queue-stat">
                        <span class="stat-label">Occupied</span>
                        <span class="stat-value">${queueUtilization?.occupiedSlots || 0}</span>
                    </div>
                    <div class="queue-stat">
                        <span class="stat-label">Utilization</span>
                        <span class="stat-value">${(queueUtilization?.utilizationPercent * 100 || 0).toFixed(1)}%</span>
                    </div>
                </div>

                <div class="queue-list">
                    <h4>Featured Queue</h4>
                    ${featuredQueue.length === 0 ? `
                        <p class="empty-queue">No featured projects currently</p>
                    ` : `
                        <div class="queue-items">
                            ${featuredQueue.map(item => this.renderQueueItem(item)).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    renderQueueItem(item) {
        const isEmpty = !item.instanceAddress;
        const isOurs = item.instanceAddress?.toLowerCase() === this.instanceAddress?.toLowerCase();
        const timeRemaining = item.expiresAt ? this.formatTimeRemaining(item.expiresAt) : '-';

        return `
            <div class="queue-item ${isEmpty ? 'empty' : ''} ${isOurs ? 'is-ours' : ''}">
                <span class="position-number">#${item.position + 1}</span>
                ${isEmpty ? `
                    <span class="empty-slot">Available</span>
                ` : `
                    <span class="instance-address">${this.truncateAddress(item.instanceAddress)}</span>
                    <span class="expires">${timeRemaining}</span>
                    ${isOurs ? '<span class="your-badge">Your Project</span>' : ''}
                `}
            </div>
        `;
    }

    renderCleanupTab(txPending) {
        const { queueUtilization } = this.state;

        return `
            <div class="cleanup-tab">
                <h4>Cleanup Expired Rentals</h4>
                <p class="section-description">
                    Anyone can cleanup expired rentals and earn a reward. This helps keep
                    the featured queue accurate and earns you a small ETH reward.
                </p>

                <div class="cleanup-info">
                    <div class="cleanup-stat">
                        <span class="stat-label">Occupied Slots</span>
                        <span class="stat-value">${queueUtilization?.occupiedSlots || 0}</span>
                    </div>
                </div>

                <button
                    class="action-btn cleanup-btn"
                    data-action="cleanup"
                    ${txPending ? 'disabled' : ''}
                >
                    ${txPending ? 'Processing...' : 'Cleanup Expired (Earn Reward)'}
                </button>
            </div>
        `;
    }

    // =========================
    // Helper Methods
    // =========================

    formatTimeRemaining(expiresAt) {
        const now = Date.now() / 1000;
        const remaining = expiresAt - now;

        if (remaining <= 0) return 'Expired';

        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
                case 'rent':
                    this.handleRentPosition();
                    break;
                case 'renew':
                    this.handleRenewPosition();
                    break;
                case 'bump':
                    this.handleBumpPosition();
                    break;
                case 'deposit':
                    this.handleDepositForAutoRenewal();
                    break;
                case 'withdraw':
                    this.handleWithdrawDeposit();
                    break;
                case 'cleanup':
                    this.handleCleanupExpired();
                    break;
            }
        });

        // Form input handling
        container.addEventListener('input', (e) => {
            const field = e.target.dataset.field;
            if (!field) return;

            switch (field) {
                case 'deposit':
                    this.setState({ depositAmount: e.target.value, error: null });
                    break;
            }
        });

        // Select and range change handling
        container.addEventListener('change', (e) => {
            const field = e.target.dataset.field;
            if (!field) return;

            switch (field) {
                case 'position':
                    this.handlePositionChange(e.target.value);
                    break;
                case 'duration':
                    this.handleDurationChange(e.target.value);
                    break;
            }
        });
    }
}
