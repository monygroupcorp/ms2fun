/**
 * ERC404 Admin Modal Component
 *
 * Admin interface for ERC404 bonding curve projects with three tabs:
 * - Overview: Bonding status, staking info, featured rental
 * - Configuration: Progressive disclosure setup (hook, vault, times, staking, style)
 * - Advanced: Dangerous operations (transfer/renounce ownership)
 *
 * @migration-note Same workarounds as ERC1155AdminModal for microact's lack of VDOM
 */

import { Component } from '../../core/Component.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404AdminModal extends Component {
    constructor(contractAddress, contractType, adapter, projectData = null) {
        super();
        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.adapter = adapter;
        this.projectData = projectData;
        this.featuredAdapter = null;

        // Form values stored outside state to avoid re-renders on input
        this._formValues = {
            bondingOpenTime: '',
            bondingMaturityTime: '',
            hookAddress: '',
            vaultAddress: '',
            styleUri: '',
            newOwnerAddress: ''
        };

        this.state = {
            isOpen: false,
            activeTab: 'overview',
            loading: true,

            // Bonding status
            bondingPhase: 'pre-open', // 'pre-open' | 'bonding' | 'full' | 'matured' | 'deployed'
            bondingProgress: 0,
            reserve: '0',
            totalBondingSupply: '0',
            maxBondingSupply: '0',
            availableBondingSupply: '0',
            bondingOpenTime: 0,
            bondingMaturityTime: 0,
            bondingActive: false,
            liquidityDeployed: false,

            // Staking
            stakingEnabled: false,
            totalStaked: '0',

            // Setup status (for progressive disclosure)
            hookAddress: null,
            vaultAddress: null,
            styleUri: '',

            // Featured rental data
            isFeatured: false,
            featuredPosition: 0,
            featuredExpiry: 0,
            featuredRentedAt: 0,
            featuredRentPaid: '0',
            rentalPrice: '0',
            renewalDeposit: '0',
            queueLength: 0,
            queueMaxSize: 100,
            queueUtilizationPct: '0',

            // Advanced tab checkboxes
            transferConfirmed: false,
            renounceConfirmed1: false,
            renounceConfirmed2: false,

            // Transaction states
            txPending: false,
            txError: null,
            txSuccess: null
        };
    }

    /**
     * Prevent re-render for form field changes
     */
    shouldUpdate(oldState, newState) {
        if (oldState.isOpen !== newState.isOpen) return true;
        if (oldState.activeTab !== newState.activeTab) return true;
        if (oldState.loading !== newState.loading) return true;
        if (oldState.txPending !== newState.txPending) return true;
        if (oldState.txError !== newState.txError) return true;
        if (oldState.txSuccess !== newState.txSuccess) return true;
        if (oldState.bondingPhase !== newState.bondingPhase) return true;
        if (oldState.stakingEnabled !== newState.stakingEnabled) return true;
        if (oldState.isFeatured !== newState.isFeatured) return true;

        // Don't re-render for checkbox changes
        if (oldState.transferConfirmed !== newState.transferConfirmed ||
            oldState.renounceConfirmed1 !== newState.renounceConfirmed1 ||
            oldState.renounceConfirmed2 !== newState.renounceConfirmed2) {
            return false;
        }

        return false;
    }

    async onMount() {
        stylesheetLoader.load('src/components/AdminDashboard/erc404-admin.css', 'erc404-admin-styles');
    }

    open() {
        this.setState({ isOpen: true, loading: true });
        document.body.style.overflow = 'hidden';
        this.loadData();
    }

    close() {
        this.setState({ isOpen: false });
        document.body.style.overflow = '';
    }

    async loadData() {
        try {
            // Load all data in parallel
            const [bondingStatus, supplyInfo, stakingStats, hookAddress, vaultAddress, styleUri] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.getSupplyInfo().catch(() => null),
                this.adapter.getStakingStats().catch(() => ({ enabled: false, globalTotalStaked: '0' })),
                this.adapter.v4Hook().catch(() => null),
                this.adapter.vault().catch(() => null),
                this.adapter.getStyle().catch(() => '')
            ]);

            // Check if liquidity deployed
            const liquidityPool = await this.adapter.liquidityPool().catch(() => null);
            const liquidityDeployed = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';

            // Calculate bonding phase
            const bondingPhase = this.calculateBondingPhase(bondingStatus, supplyInfo, liquidityDeployed);

            // Calculate progress
            let bondingProgress = 0;
            if (supplyInfo && supplyInfo.maxBondingSupply) {
                const current = parseFloat(supplyInfo.currentBondingSupply) || 0;
                const max = parseFloat(supplyInfo.maxBondingSupply) || 1;
                bondingProgress = Math.min((current / max) * 100, 100);
            }

            // Normalize addresses
            const zeroAddr = '0x0000000000000000000000000000000000000000';
            const normalizedHook = hookAddress && hookAddress !== zeroAddr ? hookAddress : null;
            const normalizedVault = vaultAddress && vaultAddress !== zeroAddr ? vaultAddress : null;

            // Load featured data
            await this.loadFeaturedData();

            this.setState({
                loading: false,
                bondingPhase,
                bondingProgress,
                reserve: bondingStatus?.currentReserve || '0',
                totalBondingSupply: supplyInfo?.currentBondingSupply || '0',
                maxBondingSupply: supplyInfo?.maxBondingSupply || '0',
                availableBondingSupply: supplyInfo?.availableBondingSupply || '0',
                bondingOpenTime: bondingStatus?.openTime || 0,
                bondingMaturityTime: await this.adapter.bondingMaturityTime().catch(() => 0),
                bondingActive: bondingStatus?.isActive || false,
                liquidityDeployed,
                stakingEnabled: stakingStats?.enabled || false,
                totalStaked: stakingStats?.globalTotalStaked || '0',
                hookAddress: normalizedHook,
                vaultAddress: normalizedVault,
                styleUri: styleUri || ''
            });
        } catch (error) {
            console.error('[ERC404AdminModal] Error loading data:', error);
            this.setState({ loading: false, txError: error.message });
        }
    }

    calculateBondingPhase(bondingStatus, supplyInfo, liquidityDeployed) {
        if (liquidityDeployed) return 'deployed';

        const now = Math.floor(Date.now() / 1000);

        if (supplyInfo) {
            const current = parseFloat(supplyInfo.currentBondingSupply) || 0;
            const max = parseFloat(supplyInfo.maxBondingSupply) || 0;
            if (max > 0 && current >= max) return 'full';
        }

        if (bondingStatus?.maturityTime && now >= bondingStatus.maturityTime) return 'matured';

        if (bondingStatus?.isActive && bondingStatus?.openTime && now >= bondingStatus.openTime) {
            return 'bonding';
        }

        return 'pre-open';
    }

    async loadFeaturedData() {
        try {
            const featuredAdapter = await serviceFactory.getFeaturedQueueManagerAdapter();
            if (!featuredAdapter) return;
            this.featuredAdapter = featuredAdapter;

            const [rentalInfo, position1Price, queueUtilization] = await Promise.all([
                featuredAdapter.getRentalInfo(this.contractAddress),
                featuredAdapter.getPositionRentalPrice(1),
                featuredAdapter.getQueueUtilization()
            ]);

            this.setState({
                isFeatured: rentalInfo.rental.active && !rentalInfo.isExpired,
                featuredPosition: rentalInfo.position,
                featuredExpiry: rentalInfo.rental.expiresAt,
                featuredRentedAt: rentalInfo.rental.rentedAt,
                featuredRentPaid: rentalInfo.rental.rentPaid,
                renewalDeposit: rentalInfo.renewalDeposit,
                rentalPrice: position1Price,
                queueLength: queueUtilization.length,
                queueMaxSize: queueUtilization.maxSize,
                queueUtilizationPct: (queueUtilization.currentUtilization / 100).toFixed(1)
            });
        } catch (e) {
            console.warn('[ERC404AdminModal] Featured data not available:', e);
        }
    }

    switchTab(tab) {
        this.setState({ activeTab: tab, txError: null, txSuccess: null });
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION TAB ACTIONS
    // ═══════════════════════════════════════════════════════════

    async handleSetBondingOpenTime() {
        const timestamp = this.parseLocalDateTime(this._formValues.bondingOpenTime);
        if (!timestamp) {
            this.setState({ txError: 'Please select a valid date and time' });
            return;
        }

        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setBondingOpenTime(timestamp);
            this.setState({ txPending: false, txSuccess: 'Bonding open time set!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleSetBondingMaturityTime() {
        const timestamp = this.parseLocalDateTime(this._formValues.bondingMaturityTime);
        if (!timestamp) {
            this.setState({ txError: 'Please select a valid date and time' });
            return;
        }

        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setBondingMaturityTime(timestamp);
            this.setState({ txPending: false, txSuccess: 'Bonding maturity time set!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleSetBondingActive(active) {
        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setBondingActive(active);
            this.setState({ txPending: false, txSuccess: `Bonding ${active ? 'activated' : 'deactivated'}!` });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleSetV4Hook() {
        const address = this._formValues.hookAddress;
        if (!address || !ethers.utils.isAddress(address)) {
            this.setState({ txError: 'Please enter a valid address' });
            return;
        }

        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setV4Hook(address);
            this._formValues.hookAddress = '';
            this.setState({ txPending: false, txSuccess: 'V4 Hook set!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleSetVault() {
        const address = this._formValues.vaultAddress;
        if (!address || !ethers.utils.isAddress(address)) {
            this.setState({ txError: 'Please enter a valid address' });
            return;
        }

        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setVault(address);
            this._formValues.vaultAddress = '';
            this.setState({ txPending: false, txSuccess: 'Vault set!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleEnableStaking() {
        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.enableStaking();
            this.setState({ txPending: false, txSuccess: 'Staking enabled!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleSetStyle() {
        const uri = this._formValues.styleUri;
        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.setStyle(uri);
            this.setState({ txPending: false, txSuccess: 'Style updated!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FEATURED RENTAL ACTIONS (same as ERC1155)
    // ═══════════════════════════════════════════════════════════

    async handleRentFeatured() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const durationSelect = this.element?.querySelector('[data-ref="rental-duration"]');
            const duration = durationSelect?.value || '604800';
            const actualCost = await this.featuredAdapter.calculateRentalCost(1, duration);

            if (!actualCost || actualCost === '0') {
                this.setState({ txError: 'Could not determine rental price' });
                return;
            }

            this.setState({ txPending: true, txError: null });
            await this.featuredAdapter.rentFeaturedPosition(this.contractAddress, 1, duration, actualCost);
            this.setState({ txPending: false, txSuccess: 'Featured position rented!' });
            await this.loadFeaturedData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleRenewFeatured() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const duration = '604800';
            const basePrice = parseFloat(this.state.rentalPrice);
            const renewalCost = (basePrice * 0.9).toFixed(6);

            this.setState({ txPending: true, txError: null });
            await this.featuredAdapter.renewPosition(this.contractAddress, duration, renewalCost);
            this.setState({ txPending: false, txSuccess: 'Featured position renewed with 10% discount!' });
            await this.loadFeaturedData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleBumpFeatured() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const currentPosition = this.state.featuredPosition;
            if (currentPosition <= 1) {
                this.setState({ txError: "You're already at position #1!" });
                return;
            }

            const targetPosition = currentPosition - 1;
            const duration = '604800';
            const targetPrice = await this.featuredAdapter.getPositionRentalPrice(targetPosition);
            const estimatedCost = (parseFloat(targetPrice) * 2).toFixed(6);

            this.setState({ txPending: true, txError: null });
            await this.featuredAdapter.bumpPosition(this.contractAddress, targetPosition, duration, estimatedCost);
            this.setState({ txPending: false, txSuccess: `Bumped to position #${targetPosition}!` });
            await this.loadFeaturedData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleDepositAutoRenewal() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const amountInput = this.element?.querySelector('[data-ref="auto-renewal-amount"]');
            const amount = amountInput?.value;

            if (!amount || parseFloat(amount) <= 0) {
                this.setState({ txError: 'Please enter a valid deposit amount' });
                return;
            }

            this.setState({ txPending: true, txError: null });
            await this.featuredAdapter.depositForAutoRenewal(this.contractAddress, amount);
            if (amountInput) amountInput.value = '';
            this.setState({ txPending: false, txSuccess: `Deposited ${amount} ETH for auto-renewal!` });
            await this.loadFeaturedData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleWithdrawAutoRenewal() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const currentDeposit = this.state.renewalDeposit;
            if (!currentDeposit || parseFloat(currentDeposit) <= 0) {
                this.setState({ txError: 'No deposit to withdraw' });
                return;
            }

            this.setState({ txPending: true, txError: null });
            await this.featuredAdapter.withdrawRenewalDeposit(this.contractAddress);
            this.setState({ txPending: false, txSuccess: `Withdrew ${currentDeposit} ETH!` });
            await this.loadFeaturedData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED TAB ACTIONS
    // ═══════════════════════════════════════════════════════════

    async handleTransferOwnership() {
        try {
            if (!this.state.transferConfirmed) {
                this.setState({ txError: 'Please confirm you understand this action is irreversible' });
                return;
            }

            const newOwner = this._formValues.newOwnerAddress;
            if (!newOwner || !ethers.utils.isAddress(newOwner)) {
                this.setState({ txError: 'Please enter a valid Ethereum address' });
                return;
            }

            this.setState({ txPending: true, txError: null });
            await this.adapter.transferOwnership(newOwner);
            this.setState({
                txPending: false,
                txSuccess: 'Ownership transferred! You no longer have admin access.'
            });
            this.setTimeout(() => this.close(), 3000);
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleRenounceOwnership() {
        try {
            if (!this.state.renounceConfirmed1 || !this.state.renounceConfirmed2) {
                this.setState({ txError: 'Please confirm both checkboxes' });
                return;
            }

            this.setState({ txPending: true, txError: null });
            await this.adapter.renounceOwnership();
            this.setState({
                txPending: false,
                txSuccess: 'Ownership renounced! The contract now has no owner.'
            });
            this.setTimeout(() => this.close(), 3000);
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════

    render() {
        if (!this.state.isOpen) {
            return '';
        }

        return `
            <div class="erc404-admin-overlay" data-ref="overlay">
                <div class="erc404-admin-modal" data-ref="modal">
                    ${this.renderHeader()}
                    ${this.renderTabs()}
                    <div class="erc404-admin-content">
                        ${this.state.loading ? this.renderLoading() : this.renderActiveTab()}
                    </div>
                </div>
            </div>
        `;
    }

    renderHeader() {
        const projectName = this.projectData?.name || 'ERC404 Project';
        return `
            <div class="erc404-admin-header">
                <div class="erc404-admin-header-content">
                    <h2 class="erc404-admin-title">Admin Dashboard</h2>
                    <p class="erc404-admin-subtitle">${this.escapeHtml(projectName)}</p>
                </div>
                <button class="erc404-admin-close" data-ref="close-btn" aria-label="Close">
                    <span>&times;</span>
                </button>
            </div>
        `;
    }

    renderTabs() {
        const tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'configuration', label: 'Configuration' },
            { id: 'advanced', label: 'Advanced' }
        ];

        return `
            <div class="erc404-admin-tabs">
                ${tabs.map(tab => `
                    <button
                        class="erc404-admin-tab ${this.state.activeTab === tab.id ? 'active' : ''}"
                        data-tab="${tab.id}"
                        data-ref="tab-${tab.id}"
                    >
                        ${tab.label}
                    </button>
                `).join('')}
            </div>
        `;
    }

    renderLoading() {
        return `
            <div class="erc404-admin-loading">
                <div class="loading-spinner"></div>
                <p>Loading admin data...</p>
            </div>
        `;
    }

    renderActiveTab() {
        const { activeTab } = this.state;

        let content = '';
        if (activeTab === 'overview') {
            content = this.renderOverviewTab();
        } else if (activeTab === 'configuration') {
            content = this.renderConfigurationTab();
        } else if (activeTab === 'advanced') {
            content = this.renderAdvancedTab();
        }

        return `
            ${this.renderMessages()}
            ${content}
        `;
    }

    renderMessages() {
        const { txPending, txError, txSuccess } = this.state;

        if (txPending) {
            return `
                <div class="erc404-admin-message pending">
                    <div class="loading-spinner small"></div>
                    <span>Transaction pending...</span>
                </div>
            `;
        }

        if (txError) {
            return `
                <div class="erc404-admin-message error">
                    <span>${this.escapeHtml(txError)}</span>
                </div>
            `;
        }

        if (txSuccess) {
            return `
                <div class="erc404-admin-message success">
                    <span>${this.escapeHtml(txSuccess)}</span>
                </div>
            `;
        }

        return '';
    }

    // ═══════════════════════════════════════════════════════════
    // OVERVIEW TAB
    // ═══════════════════════════════════════════════════════════

    renderOverviewTab() {
        return `
            ${this.renderBondingStatusSection()}
            ${this.renderStakingSection()}
            ${this.renderFeaturedSection()}
        `;
    }

    renderBondingStatusSection() {
        const {
            bondingPhase, bondingProgress, reserve, totalBondingSupply,
            maxBondingSupply, bondingOpenTime, bondingMaturityTime, bondingActive
        } = this.state;

        const phaseLabels = {
            'pre-open': 'Pre-Open',
            'bonding': 'Bonding Active',
            'full': 'Curve Full',
            'matured': 'Matured',
            'deployed': 'Liquidity Deployed'
        };

        const phaseLabel = phaseLabels[bondingPhase] || bondingPhase;

        return `
            <div class="erc404-admin-section bonding-status-section">
                <div class="section-header-row">
                    <h3 class="section-header">Bonding Status</h3>
                    <span class="phase-badge phase-${bondingPhase}">${phaseLabel}</span>
                </div>

                <div class="bonding-progress-container">
                    <div class="bonding-progress-bar">
                        <div class="bonding-progress-fill" style="width: ${bondingProgress}%"></div>
                    </div>
                    <div class="bonding-progress-label">${bondingProgress.toFixed(1)}% filled</div>
                </div>

                <div class="stats-row">
                    <div class="stat-card">
                        <span class="stat-label">Reserve</span>
                        <span class="stat-value">${this.formatEth(reserve)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Supply</span>
                        <span class="stat-value">${this.formatSupply(totalBondingSupply)} / ${this.formatSupply(maxBondingSupply)}</span>
                    </div>
                </div>

                <div class="timeline-row">
                    <div class="timeline-item">
                        <span class="timeline-label">Opens</span>
                        <span class="timeline-value">${bondingOpenTime ? this.formatDate(bondingOpenTime) : 'Not set'}</span>
                    </div>
                    <div class="timeline-item">
                        <span class="timeline-label">Matures</span>
                        <span class="timeline-value">${bondingMaturityTime ? this.formatDate(bondingMaturityTime) : 'Not set'}</span>
                    </div>
                    <div class="timeline-item">
                        <span class="timeline-label">Status</span>
                        <span class="timeline-value ${bondingActive ? 'active' : 'inactive'}">${bondingActive ? 'Active' : 'Inactive'}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderStakingSection() {
        const { stakingEnabled, totalStaked } = this.state;

        return `
            <div class="erc404-admin-section staking-section">
                <div class="section-header-row">
                    <h3 class="section-header">Staking</h3>
                    <span class="status-badge ${stakingEnabled ? 'enabled' : 'disabled'}">
                        ${stakingEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                </div>

                ${stakingEnabled ? `
                    <div class="staking-stats">
                        <div class="stat-card">
                            <span class="stat-label">Total Staked</span>
                            <span class="stat-value">${this.formatSupply(totalStaked)} tokens</span>
                        </div>
                        <p class="staking-info">Vault fees are distributed to stakers proportionally.</p>
                    </div>
                ` : `
                    <p class="staking-info">Staking is not enabled. Enable it in Configuration to let holders stake for vault fees.</p>
                `}
            </div>
        `;
    }

    renderFeaturedSection() {
        const {
            isFeatured, featuredPosition, featuredExpiry, featuredRentedAt, featuredRentPaid,
            rentalPrice, renewalDeposit, queueLength, queueMaxSize, queueUtilizationPct
        } = this.state;

        const queueStatusHtml = `
            <div class="queue-status">
                <div class="queue-bar">
                    <div class="queue-fill" style="width: ${Math.min(100, queueUtilizationPct)}%"></div>
                </div>
                <p class="queue-info">${queueLength}/${queueMaxSize} positions filled (${queueUtilizationPct}%)</p>
            </div>
        `;

        if (isFeatured) {
            const timeRemaining = this.formatTimeRemaining(featuredExpiry);
            const rentedDate = featuredRentedAt ? new Date(featuredRentedAt * 1000).toLocaleDateString() : 'Unknown';
            const hasDeposit = parseFloat(renewalDeposit) > 0;
            const isTopPosition = featuredPosition <= 1;

            return `
                <div class="erc404-admin-section featured-section">
                    <h3 class="section-header">Featured Position</h3>
                    ${queueStatusHtml}
                    <div class="featured-status active">
                        <div class="featured-header">
                            <span class="featured-badge">FEATURED</span>
                            <span class="position-badge">#${featuredPosition}</span>
                            ${isTopPosition ? '<span class="top-position-badge">TOP</span>' : ''}
                        </div>

                        <div class="rental-details">
                            <div class="detail-row">
                                <span class="detail-label">Expires</span>
                                <span class="detail-value">${timeRemaining}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Rented</span>
                                <span class="detail-value">${rentedDate}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Paid</span>
                                <span class="detail-value">${featuredRentPaid} ETH</span>
                            </div>
                        </div>

                        <div class="featured-actions">
                            <button class="btn btn-silver" data-ref="renew-featured">
                                Renew (+1 week)
                            </button>
                            ${isTopPosition
                                ? '<span class="at-top-message">Already at #1!</span>'
                                : `<button class="btn btn-gold" data-ref="bump-featured">
                                    Bump to #${featuredPosition - 1}
                                </button>`
                            }
                        </div>
                        <p class="discount-info">Renewals get 10% off!</p>

                        <div class="auto-renewal-section">
                            <h4>Auto-Renewal Deposit</h4>
                            <p class="deposit-balance">Balance: <strong>${renewalDeposit} ETH</strong></p>
                            <p class="helper-text">Funds here auto-renew your position when it expires.</p>
                            <div class="deposit-actions">
                                <div class="input-group">
                                    <input
                                        type="number"
                                        class="form-input"
                                        placeholder="0.01"
                                        step="0.001"
                                        data-ref="auto-renewal-amount"
                                    />
                                    <span class="input-suffix">ETH</span>
                                </div>
                                <button class="btn btn-silver" data-ref="deposit-auto-renewal">
                                    Deposit
                                </button>
                                ${hasDeposit ? `
                                    <button class="btn btn-outline" data-ref="withdraw-auto-renewal">
                                        Withdraw All
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="erc404-admin-section featured-section">
                <h3 class="section-header">Featured Position</h3>
                ${queueStatusHtml}
                <div class="featured-status inactive">
                    <p>Get your project featured on the homepage carousel.</p>
                    <p class="rental-price">Position #1 costs <strong>${rentalPrice} ETH</strong> per week</p>
                    <p class="discount-info">5% off for 2 weeks | 10% off for 30 days</p>
                    <div class="duration-selector">
                        <label>Duration:</label>
                        <select data-ref="rental-duration" class="form-select">
                            <option value="604800">1 Week</option>
                            <option value="1209600">2 Weeks</option>
                            <option value="2592000">30 Days</option>
                        </select>
                    </div>
                    <button class="btn btn-gold" data-ref="rent-featured">
                        Rent Featured Slot
                    </button>
                </div>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION TAB
    // ═══════════════════════════════════════════════════════════

    renderConfigurationTab() {
        const needsSetup = this.getNeedsSetupItems();
        const completed = this.getCompletedItems();

        return `
            ${needsSetup.length > 0 ? `
                <div class="erc404-admin-section needs-setup-section">
                    <h3 class="section-header">Needs Setup</h3>
                    ${needsSetup.map(item => this.renderSetupItem(item)).join('')}
                </div>
            ` : ''}

            ${completed.length > 0 ? `
                <div class="erc404-admin-section completed-section">
                    <h3 class="section-header">Completed</h3>
                    <div class="completed-items">
                        ${completed.map(item => this.renderCompletedItem(item)).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="erc404-admin-section customization-section">
                <h3 class="section-header">Customization</h3>
                <div class="form-field">
                    <label class="form-label">Style URI</label>
                    <div class="input-group">
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            value="${this.escapeHtml(this.state.styleUri)}"
                            data-ref="style-uri"
                        />
                    </div>
                    <button class="btn btn-silver" data-ref="update-style">
                        Update Style
                    </button>
                </div>
            </div>
        `;
    }

    getNeedsSetupItems() {
        const items = [];
        const { hookAddress, vaultAddress, bondingOpenTime, bondingMaturityTime, bondingActive, stakingEnabled, liquidityDeployed } = this.state;

        if (!hookAddress && !liquidityDeployed) {
            items.push({ id: 'hook', label: 'V4 Hook', description: 'Required before activating bonding' });
        }

        if (!vaultAddress && !liquidityDeployed) {
            items.push({ id: 'vault', label: 'Vault', description: 'Required for staking support' });
        }

        if (!bondingOpenTime && !liquidityDeployed) {
            items.push({ id: 'openTime', label: 'Bonding Open Time', description: 'When bonding curve opens for trading' });
        }

        if (bondingOpenTime && !bondingMaturityTime && !liquidityDeployed) {
            items.push({ id: 'maturityTime', label: 'Bonding Maturity Time', description: 'When permissionless liquidity deployment is allowed' });
        }

        if (hookAddress && bondingOpenTime && !bondingActive && !liquidityDeployed) {
            items.push({ id: 'activate', label: 'Activate Bonding', description: 'Start the bonding curve' });
        }

        if (!stakingEnabled && !liquidityDeployed) {
            items.push({ id: 'staking', label: 'Enable Staking', description: 'Let holders stake for vault fees (irreversible)' });
        }

        return items;
    }

    getCompletedItems() {
        const items = [];
        const { hookAddress, vaultAddress, bondingOpenTime, bondingMaturityTime, bondingActive, stakingEnabled } = this.state;

        if (hookAddress) {
            items.push({ id: 'hook', label: 'V4 Hook', value: this.truncateAddress(hookAddress) });
        }

        if (vaultAddress) {
            items.push({ id: 'vault', label: 'Vault', value: this.truncateAddress(vaultAddress) });
        }

        if (bondingOpenTime) {
            items.push({ id: 'openTime', label: 'Bonding Open Time', value: this.formatDate(bondingOpenTime) });
        }

        if (bondingMaturityTime) {
            items.push({ id: 'maturityTime', label: 'Bonding Maturity Time', value: this.formatDate(bondingMaturityTime) });
        }

        if (bondingActive) {
            items.push({ id: 'activate', label: 'Bonding Active', value: 'Yes' });
        }

        if (stakingEnabled) {
            items.push({ id: 'staking', label: 'Staking', value: 'Enabled' });
        }

        return items;
    }

    renderSetupItem(item) {
        const { txPending } = this.state;

        switch (item.id) {
            case 'hook':
                return `
                    <div class="setup-item">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-form">
                            <div class="input-group">
                                <input
                                    type="text"
                                    class="form-input"
                                    placeholder="0x..."
                                    data-ref="hook-address"
                                    ${txPending ? 'disabled' : ''}
                                />
                            </div>
                            <button class="btn btn-gold" data-ref="set-hook" ${txPending ? 'disabled' : ''}>
                                Set Hook
                            </button>
                        </div>
                    </div>
                `;

            case 'vault':
                return `
                    <div class="setup-item">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-form">
                            <div class="input-group">
                                <input
                                    type="text"
                                    class="form-input"
                                    placeholder="0x..."
                                    data-ref="vault-address"
                                    ${txPending ? 'disabled' : ''}
                                />
                            </div>
                            <button class="btn btn-gold" data-ref="set-vault" ${txPending ? 'disabled' : ''}>
                                Set Vault
                            </button>
                        </div>
                    </div>
                `;

            case 'openTime':
                return `
                    <div class="setup-item">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-form">
                            <div class="input-group">
                                <input
                                    type="datetime-local"
                                    class="form-input"
                                    data-ref="bonding-open-time"
                                    ${txPending ? 'disabled' : ''}
                                />
                            </div>
                            <button class="btn btn-gold" data-ref="set-open-time" ${txPending ? 'disabled' : ''}>
                                Set Open Time
                            </button>
                        </div>
                    </div>
                `;

            case 'maturityTime':
                return `
                    <div class="setup-item">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-form">
                            <div class="input-group">
                                <input
                                    type="datetime-local"
                                    class="form-input"
                                    data-ref="bonding-maturity-time"
                                    ${txPending ? 'disabled' : ''}
                                />
                            </div>
                            <button class="btn btn-gold" data-ref="set-maturity-time" ${txPending ? 'disabled' : ''}>
                                Set Maturity Time
                            </button>
                        </div>
                    </div>
                `;

            case 'activate':
                return `
                    <div class="setup-item">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-form">
                            <button class="btn btn-gold" data-ref="activate-bonding" ${txPending ? 'disabled' : ''}>
                                Activate Bonding
                            </button>
                        </div>
                    </div>
                `;

            case 'staking':
                return `
                    <div class="setup-item staking-setup">
                        <div class="setup-item-header">
                            <h4>${item.label}</h4>
                            <p class="setup-description">${item.description}</p>
                        </div>
                        <div class="setup-item-warning">
                            <span class="warning-icon">⚠️</span>
                            <span>This action is irreversible</span>
                        </div>
                        <div class="setup-item-form">
                            <button class="btn btn-gold" data-ref="enable-staking" ${txPending ? 'disabled' : ''}>
                                Enable Staking Forever
                            </button>
                        </div>
                    </div>
                `;

            default:
                return '';
        }
    }

    renderCompletedItem(item) {
        return `
            <div class="completed-item">
                <span class="completed-check">✓</span>
                <span class="completed-label">${item.label}</span>
                <span class="completed-value">${item.value}</span>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED TAB
    // ═══════════════════════════════════════════════════════════

    renderAdvancedTab() {
        return `
            <div class="warning-banner">
                <span class="warning-icon">⚠️</span>
                <p>These actions are irreversible. Proceed with extreme caution.</p>
            </div>

            <div class="erc404-admin-section danger-section">
                <h3 class="section-header">Transfer Ownership</h3>
                <p class="danger-description">
                    Transfer complete ownership of this contract to another address.
                    You will lose all admin privileges.
                </p>
                <div class="form-field">
                    <label class="form-label">New Owner Address</label>
                    <input
                        type="text"
                        class="form-input"
                        placeholder="0x..."
                        data-ref="new-owner-address"
                    />
                </div>
                <div class="checkbox-field">
                    <input
                        type="checkbox"
                        id="transfer-confirm"
                        data-ref="transfer-confirm"
                    />
                    <label for="transfer-confirm">I understand this action is irreversible</label>
                </div>
                <button class="btn btn-danger" data-ref="transfer-ownership">
                    Transfer Ownership
                </button>
            </div>

            <div class="erc404-admin-section danger-section severe">
                <h3 class="section-header">Renounce Ownership</h3>
                <p class="danger-description">
                    Permanently remove all ownership from this contract. After renouncing:
                </p>
                <ul class="danger-list">
                    <li>No configuration changes</li>
                    <li>No style updates</li>
                    <li>No staking enable</li>
                    <li>Contract runs autonomously</li>
                </ul>
                <div class="checkbox-field">
                    <input
                        type="checkbox"
                        id="renounce-confirm-1"
                        data-ref="renounce-confirm-1"
                    />
                    <label for="renounce-confirm-1">I understand this cannot be undone</label>
                </div>
                <div class="checkbox-field">
                    <input
                        type="checkbox"
                        id="renounce-confirm-2"
                        data-ref="renounce-confirm-2"
                    />
                    <label for="renounce-confirm-2">I want to permanently remove all admin access</label>
                </div>
                <button class="btn btn-danger-severe" data-ref="renounce-ownership">
                    Renounce Ownership Forever
                </button>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    formatEth(wei) {
        try {
            const eth = ethers.utils.formatEther(wei || '0');
            const num = parseFloat(eth);
            if (num === 0) return '0';
            if (num < 0.001) return '<0.001';
            return num.toFixed(4).replace(/\.?0+$/, '');
        } catch {
            return '0';
        }
    }

    formatSupply(wei) {
        try {
            const tokens = parseFloat(wei || '0');
            if (tokens === 0) return '0';
            if (tokens >= 1e9) return (tokens / 1e9).toFixed(2) + 'B';
            if (tokens >= 1e6) return (tokens / 1e6).toFixed(2) + 'M';
            if (tokens >= 1e3) return (tokens / 1e3).toFixed(2) + 'K';
            return tokens.toFixed(0);
        } catch {
            return '0';
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return 'Not set';
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    formatTimeRemaining(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const remaining = timestamp - now;

        if (remaining <= 0) return 'Expired';

        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h`;
        return '<1h';
    }

    parseLocalDateTime(dateTimeStr) {
        if (!dateTimeStr) return 0;
        return Math.floor(new Date(dateTimeStr).getTime() / 1000);
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

    // ═══════════════════════════════════════════════════════════
    // EVENT BINDING
    // ═══════════════════════════════════════════════════════════

    mount(element) {
        super.mount(element);
        this.setupEventDelegation();
    }

    onStateUpdate(oldState, newState) {
        if (!oldState.isOpen && newState.isOpen) {
            this.setupEscapeHandler();
        }
    }

    setupEscapeHandler() {
        if (this._escapeHandler) return;
        const handleEscape = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) this.close();
        };
        document.addEventListener('keydown', handleEscape);
        this._escapeHandler = handleEscape;
    }

    setupEventDelegation() {
        if (!this.element) return;

        // Click delegation
        this.element.addEventListener('click', (e) => {
            const target = e.target.closest('[data-ref]') || e.target.closest('[data-tab]');
            if (!target) {
                if (e.target.classList.contains('erc404-admin-overlay')) {
                    this.close();
                }
                return;
            }

            const ref = target.dataset.ref;
            const tab = target.dataset.tab;

            if (tab) {
                this.switchTab(tab);
                return;
            }

            switch (ref) {
                case 'close-btn':
                    this.close();
                    break;
                // Configuration actions
                case 'set-hook':
                    this.handleSetV4Hook();
                    break;
                case 'set-vault':
                    this.handleSetVault();
                    break;
                case 'set-open-time':
                    this.handleSetBondingOpenTime();
                    break;
                case 'set-maturity-time':
                    this.handleSetBondingMaturityTime();
                    break;
                case 'activate-bonding':
                    this.handleSetBondingActive(true);
                    break;
                case 'enable-staking':
                    this.handleEnableStaking();
                    break;
                case 'update-style':
                    this.handleSetStyle();
                    break;
                // Featured actions
                case 'rent-featured':
                    this.handleRentFeatured();
                    break;
                case 'renew-featured':
                    this.handleRenewFeatured();
                    break;
                case 'bump-featured':
                    this.handleBumpFeatured();
                    break;
                case 'deposit-auto-renewal':
                    this.handleDepositAutoRenewal();
                    break;
                case 'withdraw-auto-renewal':
                    this.handleWithdrawAutoRenewal();
                    break;
                // Advanced actions
                case 'transfer-ownership':
                    this.handleTransferOwnership();
                    break;
                case 'renounce-ownership':
                    this.handleRenounceOwnership();
                    break;
            }
        });

        // Input delegation
        this.element.addEventListener('input', (e) => {
            const ref = e.target.dataset.ref;
            if (!ref) return;

            switch (ref) {
                case 'hook-address':
                    this._formValues.hookAddress = e.target.value;
                    break;
                case 'vault-address':
                    this._formValues.vaultAddress = e.target.value;
                    break;
                case 'bonding-open-time':
                    this._formValues.bondingOpenTime = e.target.value;
                    break;
                case 'bonding-maturity-time':
                    this._formValues.bondingMaturityTime = e.target.value;
                    break;
                case 'style-uri':
                    this._formValues.styleUri = e.target.value;
                    break;
                case 'new-owner-address':
                    this._formValues.newOwnerAddress = e.target.value;
                    break;
            }
        });

        // Change delegation for checkboxes
        this.element.addEventListener('change', (e) => {
            const ref = e.target.dataset.ref;
            if (!ref) return;

            switch (ref) {
                case 'transfer-confirm':
                    this.state.transferConfirmed = e.target.checked;
                    break;
                case 'renounce-confirm-1':
                    this.state.renounceConfirmed1 = e.target.checked;
                    break;
                case 'renounce-confirm-2':
                    this.state.renounceConfirmed2 = e.target.checked;
                    break;
            }
        });
    }

    unmount() {
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
        }
        document.body.style.overflow = '';
        stylesheetLoader.unload('erc404-admin-styles');
        super.unmount();
    }
}

export default ERC404AdminModal;
