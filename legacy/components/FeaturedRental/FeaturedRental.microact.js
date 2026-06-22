/**
 * FeaturedRental - Microact Version
 *
 * Allows project owners to rent featured positions for their projects:
 * - View current featured queue and position prices
 * - Rent a position for a specific duration
 * - Renew/extend existing position
 * - Bump to a better position
 * - Manage auto-renewal deposits
 * - Cleanup expired rentals (permissionless, incentivized)
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class FeaturedRental extends Component {
    constructor(props = {}) {
        super(props);
        this.featuredQueueManager = null;
        this.masterRegistry = null;
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

    get instanceAddress() {
        return this.props.instanceAddress;
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.initialize();

        const unsub1 = eventBus.on('transaction:confirmed', () => this.loadData());
        const unsub2 = eventBus.on('account:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub4 = eventBus.on('wallet:disconnected', () => this.setState({ loading: false }));

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    async initialize() {
        try {
            this.setState({ loading: true, error: null });

            this.featuredQueueManager = await serviceFactory.getFeaturedQueueManagerAdapter();
            if (!this.featuredQueueManager) {
                throw new Error('FeaturedQueueManager not available');
            }

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

            const [minDuration, maxDuration, basePrice, maxQueueSize] = await Promise.all([
                this.featuredQueueManager.minRentalDuration().catch(() => 604800),
                this.featuredQueueManager.maxRentalDuration().catch(() => 31536000),
                this.featuredQueueManager.baseRentalPrice().catch(() => '0.001'),
                this.featuredQueueManager.maxQueueSize().catch(() => 100)
            ]);

            const currentRental = await this.featuredQueueManager.getRentalInfo(this.instanceAddress)
                .catch(() => ({ rental: { active: false }, position: 0, renewalDeposit: '0', isExpired: false }));

            const queueUtilization = await this.featuredQueueManager.getQueueUtilization()
                .catch(() => ({ currentUtilization: 0, adjustedBasePrice: '0.001', length: 0, maxSize: 100 }));

            const queueLength = await this.featuredQueueManager.queueLength().catch(() => 0);
            const loadSize = Math.min(queueLength, 10);
            const featuredQueue = loadSize > 0 ? await this.loadFeaturedQueue(loadSize) : [];

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
                    let instanceInfo = null;
                    if (this.masterRegistry) {
                        instanceInfo = await this.masterRegistry.getInstanceInfo(instances[i]).catch(() => null);
                    }

                    queue.push({
                        position: i + 1,
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
        for (let i = 1; i <= size; i++) {
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

    isConnected() {
        return !!walletService.getAddress();
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
                calculatedCost
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
                calculatedCost
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
                calculatedCost
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

            await this.featuredQueueManager.cleanupExpiredRentals(10);

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

    handlePositionChange(e) {
        this.setState({ selectedPosition: parseInt(e.target.value), error: null });
        this.updateCalculatedCost();
    }

    handleDurationChange(e) {
        this.setState({ rentalDuration: parseInt(e.target.value), error: null });
        this.updateCalculatedCost();
    }

    handleDepositAmountChange(e) {
        this.setState({ depositAmount: e.target.value, error: null });
    }

    handleTabChange(tab) {
        this.setState({ activeTab: tab, error: null });
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

    // =========================
    // Render Methods
    // =========================

    renderCurrentRental(rental) {
        const isExpired = rental.expiresAt * 1000 < Date.now();
        const timeRemaining = this.formatTimeRemaining(rental.expiresAt);

        return h('div', { className: 'current-rental-section' },
            h('h4', null, 'Your Current Position'),
            h('div', { className: 'rental-info-grid' },
                h('div', { className: 'rental-stat' },
                    h('span', { className: 'stat-label' }, 'Position'),
                    h('span', { className: 'stat-value' }, `#${rental.position + 1}`)
                ),
                h('div', { className: 'rental-stat' },
                    h('span', { className: 'stat-label' }, 'Expires'),
                    h('span', { className: `stat-value ${isExpired ? 'expired' : ''}` }, timeRemaining)
                ),
                h('div', { className: 'rental-stat' },
                    h('span', { className: 'stat-label' }, 'Auto-Renewal Deposit'),
                    h('span', { className: 'stat-value' }, `${rental.autoRenewalDeposit} ETH`)
                )
            )
        );
    }

    renderAutoRenewalSection(rental, depositAmount, txPending) {
        return h('div', { className: 'auto-renewal-section' },
            h('h4', null, 'Auto-Renewal'),
            h('p', { className: 'section-description' },
                'Deposit ETH to automatically renew your position when it expires.'
            ),
            h('div', { className: 'deposit-display' },
                h('span', { className: 'deposit-label' }, 'Current Deposit:'),
                h('span', { className: 'deposit-value' }, `${rental.autoRenewalDeposit} ETH`)
            ),
            h('div', { className: 'deposit-controls' },
                h('div', { className: 'input-row' },
                    h('input', {
                        type: 'number',
                        className: 'deposit-input',
                        placeholder: 'Amount in ETH',
                        value: depositAmount,
                        onInput: this.bind(this.handleDepositAmountChange),
                        step: '0.01',
                        min: '0',
                        disabled: txPending
                    }),
                    h('button', {
                        className: 'action-btn deposit-btn',
                        onClick: this.bind(this.handleDepositForAutoRenewal),
                        disabled: txPending
                    }, txPending ? '...' : 'Deposit')
                ),
                parseFloat(rental.autoRenewalDeposit) > 0 && h('button', {
                    className: 'action-btn withdraw-btn',
                    onClick: this.bind(this.handleWithdrawDeposit),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Withdraw Deposit')
            )
        );
    }

    renderRentTab(hasActiveRental, txPending) {
        const {
            currentRental, positionPrices, selectedPosition, rentalDuration,
            calculatedCost, depositAmount, minDuration, maxDuration
        } = this.state;

        const durationDays = Math.floor(rentalDuration / 86400);
        const minDays = Math.ceil(minDuration / 86400);
        const maxDays = Math.floor(maxDuration / 86400);

        return h('div', { className: 'rent-tab' },
            hasActiveRental && this.renderCurrentRental(currentRental),

            h('div', { className: 'rent-section' },
                h('h4', null, hasActiveRental ? 'Extend or Bump Position' : 'Rent a Featured Position'),
                h('p', { className: 'section-description' },
                    'Featured projects appear prominently on the homepage and get more visibility.'
                ),

                h('div', { className: 'form-group' },
                    h('label', null, 'Position'),
                    h('select', {
                        className: 'form-select',
                        value: selectedPosition,
                        onChange: this.bind(this.handlePositionChange),
                        disabled: txPending
                    },
                        ...positionPrices.map(p =>
                            h('option', { key: `pos-${p.position}`, value: p.position },
                                `Position ${p.position + 1} - ${p.price} ETH/day`
                            )
                        )
                    )
                ),

                h('div', { className: 'form-group' },
                    h('label', null, `Duration (${durationDays} day${durationDays !== 1 ? 's' : ''})`),
                    h('input', {
                        type: 'range',
                        className: 'form-range',
                        min: minDuration,
                        max: maxDuration,
                        step: '86400',
                        value: rentalDuration,
                        onInput: this.bind(this.handleDurationChange),
                        disabled: txPending
                    }),
                    h('div', { className: 'range-labels' },
                        h('span', null, `${minDays} day${minDays !== 1 ? 's' : ''}`),
                        h('span', null, `${maxDays} day${maxDays !== 1 ? 's' : ''}`)
                    )
                ),

                h('div', { className: 'cost-display' },
                    h('span', { className: 'cost-label' }, 'Total Cost:'),
                    h('span', { className: 'cost-value' }, `${calculatedCost} ETH`)
                ),

                h('div', { className: 'rent-actions' },
                    hasActiveRental
                        ? [
                            h('button', {
                                key: 'renew',
                                className: 'action-btn renew-btn',
                                onClick: this.bind(this.handleRenewPosition),
                                disabled: txPending
                            }, txPending ? 'Processing...' : 'Extend Rental'),
                            h('button', {
                                key: 'bump',
                                className: 'action-btn bump-btn',
                                onClick: this.bind(this.handleBumpPosition),
                                disabled: txPending
                            }, txPending ? 'Processing...' : 'Bump to Position')
                        ]
                        : h('button', {
                            className: 'action-btn rent-btn',
                            onClick: this.bind(this.handleRentPosition),
                            disabled: txPending
                        }, txPending ? 'Processing...' : 'Rent Position')
                )
            ),

            hasActiveRental && this.renderAutoRenewalSection(currentRental, depositAmount, txPending)
        );
    }

    renderQueueItem(item) {
        const isEmpty = !item.instanceAddress;
        const isOurs = item.instanceAddress?.toLowerCase() === this.instanceAddress?.toLowerCase();
        const timeRemaining = item.expiresAt ? this.formatTimeRemaining(item.expiresAt) : '-';

        return h('div', {
            key: `queue-${item.position}`,
            className: `queue-item ${isEmpty ? 'empty' : ''} ${isOurs ? 'is-ours' : ''}`
        },
            h('span', { className: 'position-number' }, `#${item.position + 1}`),
            isEmpty
                ? h('span', { className: 'empty-slot' }, 'Available')
                : [
                    h('span', { key: 'addr', className: 'instance-address' }, this.truncateAddress(item.instanceAddress)),
                    h('span', { key: 'exp', className: 'expires' }, timeRemaining),
                    isOurs && h('span', { key: 'badge', className: 'your-badge' }, 'Your Project')
                ]
        );
    }

    renderQueueTab() {
        const { featuredQueue, queueUtilization } = this.state;

        return h('div', { className: 'queue-tab' },
            h('div', { className: 'queue-stats' },
                h('div', { className: 'queue-stat' },
                    h('span', { className: 'stat-label' }, 'Total Slots'),
                    h('span', { className: 'stat-value' }, queueUtilization?.totalSlots || 0)
                ),
                h('div', { className: 'queue-stat' },
                    h('span', { className: 'stat-label' }, 'Occupied'),
                    h('span', { className: 'stat-value' }, queueUtilization?.occupiedSlots || 0)
                ),
                h('div', { className: 'queue-stat' },
                    h('span', { className: 'stat-label' }, 'Utilization'),
                    h('span', { className: 'stat-value' },
                        `${((queueUtilization?.utilizationPercent || 0) * 100).toFixed(1)}%`
                    )
                )
            ),

            h('div', { className: 'queue-list' },
                h('h4', null, 'Featured Queue'),
                featuredQueue.length === 0
                    ? h('p', { className: 'empty-queue' }, 'No featured projects currently')
                    : h('div', { className: 'queue-items' },
                        ...featuredQueue.map(item => this.renderQueueItem(item))
                    )
            )
        );
    }

    renderCleanupTab(txPending) {
        const { queueUtilization } = this.state;

        return h('div', { className: 'cleanup-tab' },
            h('h4', null, 'Cleanup Expired Rentals'),
            h('p', { className: 'section-description' },
                'Anyone can cleanup expired rentals and earn a reward. This helps keep the featured queue accurate and earns you a small ETH reward.'
            ),
            h('div', { className: 'cleanup-info' },
                h('div', { className: 'cleanup-stat' },
                    h('span', { className: 'stat-label' }, 'Occupied Slots'),
                    h('span', { className: 'stat-value' }, queueUtilization?.occupiedSlots || 0)
                )
            ),
            h('button', {
                className: 'action-btn cleanup-btn',
                onClick: this.bind(this.handleCleanupExpired),
                disabled: txPending
            }, txPending ? 'Processing...' : 'Cleanup Expired (Earn Reward)')
        );
    }

    render() {
        const walletConnected = this.isConnected();

        if (!walletConnected) {
            return h('div', { className: 'featured-rental marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Featured Position Rental')
                ),
                h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect your wallet to rent a featured position')
                )
            );
        }

        if (this.state.loading) {
            return h('div', { className: 'featured-rental marble-bg loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading rental info...')
            );
        }

        const { error, txPending, activeTab, currentRental } = this.state;
        const hasActiveRental = currentRental && currentRental.isActive;

        return h('div', { className: 'featured-rental marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Featured Position Rental')
            ),

            error && h('div', { className: 'error-banner' }, error),

            h('div', { className: 'rental-tabs' },
                h('button', {
                    className: `tab-btn ${activeTab === 'rent' ? 'active' : ''}`,
                    onClick: () => this.handleTabChange('rent')
                }, hasActiveRental ? 'Manage Position' : 'Rent Position'),
                h('button', {
                    className: `tab-btn ${activeTab === 'queue' ? 'active' : ''}`,
                    onClick: () => this.handleTabChange('queue')
                }, 'Featured Queue'),
                h('button', {
                    className: `tab-btn ${activeTab === 'cleanup' ? 'active' : ''}`,
                    onClick: () => this.handleTabChange('cleanup')
                }, 'Cleanup')
            ),

            h('div', { className: 'tab-content' },
                activeTab === 'rent' && this.renderRentTab(hasActiveRental, txPending),
                activeTab === 'queue' && this.renderQueueTab(),
                activeTab === 'cleanup' && this.renderCleanupTab(txPending)
            )
        );
    }
}

export default FeaturedRental;
