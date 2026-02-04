/**
 * ERC1155 Admin Modal Component
 *
 * Comprehensive admin interface for ERC1155 contracts with three tabs:
 * - Overview: Earnings, withdraw, vault fees, featured rental
 * - Editions: Create editions, manage existing, styles
 * - Advanced: Dangerous operations (transfer/renounce ownership)
 *
 * @migration-note This component has significant workarounds for microact's lack
 * of virtual DOM (shouldUpdate overrides, CSS animations to mask re-render flash,
 * form values stored outside state). When migrating to improved component library:
 * - Remove shouldUpdate() workaround - rely on proper diffing
 * - Move _formValues back into state - inputs won't lose focus
 * - Remove CSS fade animations on .erc1155-admin-content - transitions will be smooth
 * - Consider splitting into smaller sub-components for each tab
 */

import { Component } from '../../core/Component.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC1155AdminModal extends Component {
    constructor(contractAddress, contractType, adapter, projectData = null) {
        super();
        this.contractAddress = contractAddress;
        this.contractType = contractType;
        this.adapter = adapter;
        this.projectData = projectData;
        this.featuredAdapter = null;

        // Form values stored outside state to avoid re-renders on input
        this._formValues = {
            withdrawAmount: '',
            projectStyleUri: '',
            newOwnerAddress: '',
            newEditionForm: {
                pieceTitle: '',
                metadataUri: '',
                basePrice: '',
                supply: '',
                pricingModel: '0',
                priceIncreaseRate: ''
            }
        };

        this.state = {
            isOpen: false,
            activeTab: 'overview',
            loading: true,
            // Overview data
            totalProceeds: '0',
            contractBalance: '0',
            withdrawableAmount: '0',
            claimableVaultFees: '0',
            // Featured rental data
            isFeatured: false,
            featuredPosition: 0,
            featuredExpiry: 0,
            featuredRentedAt: 0,
            featuredRentPaid: '0',
            rentalPrice: '0',
            renewalDeposit: '0',
            // Queue utilization
            queueLength: 0,
            queueMaxSize: 100,
            queueUtilizationPct: '0',
            // Editions data
            editions: [],
            editionCount: 0,
            projectStyleUri: '',
            // Form visibility states only
            showNewEditionForm: false,
            // Advanced tab checkboxes (these need state for conditional logic)
            transferConfirmed: false,
            renounceConfirmed1: false,
            renounceConfirmed2: false,
            // Transaction states
            txPending: false,
            txError: null,
            txSuccess: null,
            // Edition management
            manageEditionId: null
        };
    }

    /**
     * Prevent re-render for form field changes - only re-render for structural changes
     * Workaround for microact lacking VDOM (logged in MICROACT_IMPROVEMENTS.md)
     */
    shouldUpdate(oldState, newState) {
        // Always re-render for these structural changes
        if (oldState.isOpen !== newState.isOpen) return true;
        if (oldState.activeTab !== newState.activeTab) return true;
        if (oldState.loading !== newState.loading) return true;
        if (oldState.showNewEditionForm !== newState.showNewEditionForm) return true;
        if (oldState.manageEditionId !== newState.manageEditionId) return true;
        if (oldState.txPending !== newState.txPending) return true;
        if (oldState.txError !== newState.txError) return true;
        if (oldState.txSuccess !== newState.txSuccess) return true;

        // Re-render if data changed
        if (oldState.editions !== newState.editions) return true;
        if (oldState.totalProceeds !== newState.totalProceeds) return true;
        if (oldState.contractBalance !== newState.contractBalance) return true;

        // Don't re-render for checkbox changes - update DOM directly
        if (oldState.transferConfirmed !== newState.transferConfirmed ||
            oldState.renounceConfirmed1 !== newState.renounceConfirmed1 ||
            oldState.renounceConfirmed2 !== newState.renounceConfirmed2) {
            return false;
        }

        return false;
    }

    async onMount() {
        stylesheetLoader.load('src/components/AdminDashboard/erc1155-admin.css', 'erc1155-admin-styles');
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
            // Load overview data
            const [totalProceeds, editions] = await Promise.all([
                this.adapter.getTotalProceeds().catch(() => '0'),
                this.adapter.getEditions().catch(() => [])
            ]);

            // Get contract balance
            let contractBalance = '0';
            try {
                const { provider } = walletService.getProviderAndSigner();
                if (provider) {
                    const balance = await provider.getBalance(this.contractAddress);
                    contractBalance = balance.toString();
                }
            } catch (e) {
                console.warn('[ERC1155AdminModal] Could not get contract balance:', e);
            }

            // Calculate withdrawable (80% of balance)
            const balanceBN = ethers.BigNumber.from(contractBalance);
            const withdrawable = balanceBN.mul(80).div(100);

            // Get project style
            const projectStyleUri = await this.adapter.getStyle().catch(() => '');

            // Load featured rental data
            await this.loadFeaturedData();

            this.setState({
                loading: false,
                totalProceeds,
                contractBalance,
                withdrawableAmount: withdrawable.toString(),
                editions,
                editionCount: editions.length,
                projectStyleUri,
                showNewEditionForm: editions.length === 0
            });
        } catch (error) {
            console.error('[ERC1155AdminModal] Error loading data:', error);
            this.setState({ loading: false, txError: error.message });
        }
    }

    async loadFeaturedData() {
        try {
            const featuredAdapter = await serviceFactory.getFeaturedQueueManagerAdapter();
            if (!featuredAdapter) {
                return;
            }
            this.featuredAdapter = featuredAdapter;

            // Fetch all featured data in parallel
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
                // Queue utilization info
                queueLength: queueUtilization.length,
                queueMaxSize: queueUtilization.maxSize,
                queueUtilizationPct: (queueUtilization.currentUtilization / 100).toFixed(1)
            });
        } catch (e) {
            console.warn('[ERC1155AdminModal] Featured data not available:', e);
        }
    }

    switchTab(tab) {
        this.setState({ activeTab: tab, txError: null, txSuccess: null });
    }

    // ═══════════════════════════════════════════════════════════
    // OVERVIEW TAB ACTIONS
    // ═══════════════════════════════════════════════════════════

    async handleWithdraw() {
        try {
            const amount = this._formValues.withdrawAmount;
            if (!amount || parseFloat(amount) <= 0) {
                this.setState({ txError: 'Please enter a valid amount' });
                return;
            }

            const amountWei = ethers.utils.parseEther(amount);
            this.setState({ txPending: true, txError: null });

            await this.adapter.withdraw(amountWei.toString());

            // Clear input
            this._formValues.withdrawAmount = '';
            const input = this.element?.querySelector('[data-ref="withdraw-amount"]');
            if (input) input.value = '';

            this.setState({
                txPending: false,
                txSuccess: 'Withdrawal successful!'
            });

            // Reload data
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    setMaxWithdraw() {
        const maxEth = ethers.utils.formatEther(this.state.withdrawableAmount);
        this._formValues.withdrawAmount = maxEth;
        // Update input directly
        const input = this.element?.querySelector('[data-ref="withdraw-amount"]');
        if (input) input.value = maxEth;
    }

    async handleClaimVaultFees() {
        try {
            this.setState({ txPending: true, txError: null });
            await this.adapter.claimVaultFees();
            this.setState({ txPending: false, txSuccess: 'Vault fees claimed!' });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleRentFeatured() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const durationSelect = this.element?.querySelector('[data-ref="rental-duration"]');
            const duration = durationSelect?.value || '604800'; // Default 7 days (minimum)

            // Calculate actual cost based on duration (includes bulk discounts)
            const actualCost = await this.featuredAdapter.calculateRentalCost(1, duration);

            if (!actualCost || actualCost === '0') {
                this.setState({ txError: 'Could not determine rental price' });
                return;
            }

            console.log('[ERC1155AdminModal] Renting featured position:', {
                contractAddress: this.contractAddress,
                position: 1,
                duration,
                actualCost
            });

            this.setState({ txPending: true, txError: null });

            await this.featuredAdapter.rentFeaturedPosition(
                this.contractAddress,
                1, // Position 1
                duration,
                actualCost
            );

            this.setState({ txPending: false, txSuccess: 'Featured position rented!' });
            await this.loadFeaturedData();
        } catch (error) {
            console.error('[ERC1155AdminModal] Rent featured error:', error);
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleRenewFeatured() {
        try {
            if (!this.featuredAdapter) {
                this.setState({ txError: 'Featured queue not available' });
                return;
            }

            const duration = '604800'; // 7 days (minimum renewal)
            // Renewals get 10% discount (renewalDiscount = 90 in contract)
            const basePrice = parseFloat(this.state.rentalPrice);
            const renewalCost = (basePrice * 0.9).toFixed(6);

            this.setState({ txPending: true, txError: null });

            await this.featuredAdapter.renewPosition(
                this.contractAddress,
                duration,
                renewalCost
            );

            this.setState({ txPending: false, txSuccess: 'Featured position renewed with 10% discount!' });
            await this.loadFeaturedData();
        } catch (error) {
            console.error('[ERC1155AdminModal] Renew featured error:', error);
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

            // Can't bump if already at position 1
            if (currentPosition <= 1) {
                this.setState({ txError: "You're already at position #1 - can't bump higher!" });
                return;
            }

            const targetPosition = currentPosition - 1; // Bump up one position
            const duration = '604800'; // 7 days (minimum)

            // Get target position price - bump cost is based on this (minus credit from remaining time)
            // Contract refunds excess, so overpay slightly to be safe
            const targetPrice = await this.featuredAdapter.getPositionRentalPrice(targetPosition);
            // Add extra week's cost for the additional duration
            const estimatedCost = (parseFloat(targetPrice) * 2).toFixed(6);

            this.setState({ txPending: true, txError: null });

            await this.featuredAdapter.bumpPosition(
                this.contractAddress,
                targetPosition,
                duration,
                estimatedCost
            );

            this.setState({ txPending: false, txSuccess: `Bumped to position #${targetPosition}!` });
            await this.loadFeaturedData();
        } catch (error) {
            console.error('[ERC1155AdminModal] Bump featured error:', error);
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

            await this.featuredAdapter.depositForAutoRenewal(
                this.contractAddress,
                amount
            );

            // Clear input
            if (amountInput) amountInput.value = '';

            this.setState({ txPending: false, txSuccess: `Deposited ${amount} ETH for auto-renewal!` });
            await this.loadFeaturedData();
        } catch (error) {
            console.error('[ERC1155AdminModal] Deposit auto-renewal error:', error);
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

            this.setState({ txPending: false, txSuccess: `Withdrew ${currentDeposit} ETH from auto-renewal deposit!` });
            await this.loadFeaturedData();
        } catch (error) {
            console.error('[ERC1155AdminModal] Withdraw auto-renewal error:', error);
            this.setState({ txPending: false, txError: error.message });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // EDITIONS TAB ACTIONS
    // ═══════════════════════════════════════════════════════════

    toggleNewEditionForm() {
        this.setState({ showNewEditionForm: !this.state.showNewEditionForm });
    }

    updateNewEditionForm(field, value) {
        // Update internal form values without triggering re-render
        this._formValues.newEditionForm[field] = value;

        // Special handling for pricing model - show/hide price increase field
        if (field === 'pricingModel') {
            const increaseField = this.element?.querySelector('[data-ref="edition-price-increase"]')?.closest('.form-field');
            if (increaseField) {
                increaseField.classList.toggle('hidden', value !== '2');
            }
        }
    }

    async handleCreateEdition() {
        try {
            const form = this._formValues.newEditionForm;

            if (!form.pieceTitle.trim()) {
                this.setState({ txError: 'Piece title is required' });
                return;
            }
            if (!form.basePrice || parseFloat(form.basePrice) <= 0) {
                this.setState({ txError: 'Base price is required' });
                return;
            }

            const pricingModel = parseInt(form.pricingModel);
            const supply = form.supply ? parseInt(form.supply) : 0;
            const priceIncreaseRate = form.priceIncreaseRate ? parseInt(form.priceIncreaseRate) : 0;

            // Validate supply based on pricing model
            // 0 = UNLIMITED (supply must be 0), 1 = LIMITED_FIXED, 2 = LIMITED_DYNAMIC
            if (pricingModel === 0 && supply !== 0) {
                this.setState({ txError: 'Unlimited editions must have supply set to 0' });
                return;
            }
            if (pricingModel !== 0 && supply <= 0) {
                this.setState({ txError: 'Limited editions require supply greater than 0' });
                return;
            }
            if (pricingModel === 2 && priceIncreaseRate <= 0) {
                this.setState({ txError: 'Dynamic pricing requires a price increase rate' });
                return;
            }

            this.setState({ txPending: true, txError: null });

            // Contract signature: addEdition(pieceTitle, basePrice, supply, metadataURI, pricingModel, priceIncreaseRate)
            const priceWei = ethers.utils.parseEther(form.basePrice);

            console.log('[ERC1155AdminModal] Creating edition with:', {
                pieceTitle: form.pieceTitle,
                basePrice: priceWei.toString(),
                supply,
                metadataUri: form.metadataUri || '',
                pricingModel,
                priceIncreaseRate
            });

            await this.adapter.executeContractCall(
                'addEdition',
                [form.pieceTitle, priceWei, supply, form.metadataUri || '', pricingModel, priceIncreaseRate],
                { requiresSigner: true }
            );

            // Reset form values
            this._formValues.newEditionForm = {
                pieceTitle: '',
                metadataUri: '',
                basePrice: '',
                supply: '',
                pricingModel: '0',
                priceIncreaseRate: ''
            };

            this.setState({
                txPending: false,
                txSuccess: 'Edition created successfully!',
                showNewEditionForm: false
            });

            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleUpdateProjectStyle() {
        try {
            const uri = this._formValues.projectStyleUri;
            this.setState({ txPending: true, txError: null });
            await this.adapter.setStyle(uri);
            this.setState({ txPending: false, txSuccess: 'Project style updated!' });
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    // Edition management
    openEditionManage(editionId) {
        this.setState({ manageEditionId: editionId });
    }

    closeEditionManage() {
        this.setState({ manageEditionId: null });
    }

    async handleUpdateEditionMetadata(editionId) {
        try {
            const input = this.element?.querySelector(`[data-ref="edition-metadata-${editionId}"]`);
            const uri = input?.value || '';

            this.setState({ txPending: true, txError: null });
            await this.adapter.updateEditionMetadata(editionId, uri);
            this.setState({ txPending: false, txSuccess: 'Edition metadata updated!', manageEditionId: null });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, txError: error.message });
        }
    }

    async handleUpdateEditionStyle(editionId) {
        try {
            const input = this.element?.querySelector(`[data-ref="edition-style-${editionId}"]`);
            const uri = input?.value || '';

            this.setState({ txPending: true, txError: null });
            await this.adapter.setEditionStyle(editionId, uri);
            this.setState({ txPending: false, txSuccess: 'Edition style updated!', manageEditionId: null });
            await this.loadData();
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

            // Close modal after successful transfer
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

            // Close modal after successful renounce
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
            <div class="erc1155-admin-overlay" data-ref="overlay">
                <div class="erc1155-admin-modal" data-ref="modal">
                    ${this.renderHeader()}
                    ${this.renderTabs()}
                    <div class="erc1155-admin-content">
                        ${this.state.loading ? this.renderLoading() : this.renderActiveTab()}
                    </div>
                </div>
            </div>
        `;
    }

    renderHeader() {
        const projectName = this.projectData?.name || 'ERC1155 Project';
        return `
            <div class="erc1155-admin-header">
                <div class="erc1155-admin-header-content">
                    <h2 class="erc1155-admin-title">Admin Dashboard</h2>
                    <p class="erc1155-admin-subtitle">${this.escapeHtml(projectName)}</p>
                </div>
                <button class="erc1155-admin-close" data-ref="close-btn" aria-label="Close">
                    <span>&times;</span>
                </button>
            </div>
        `;
    }

    renderTabs() {
        const tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'editions', label: 'Editions' },
            { id: 'advanced', label: 'Advanced' }
        ];

        return `
            <div class="erc1155-admin-tabs">
                ${tabs.map(tab => `
                    <button
                        class="erc1155-admin-tab ${this.state.activeTab === tab.id ? 'active' : ''}"
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
            <div class="erc1155-admin-loading">
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
        } else if (activeTab === 'editions') {
            content = this.renderEditionsTab();
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
                <div class="erc1155-admin-message pending">
                    <div class="loading-spinner small"></div>
                    <span>Transaction pending...</span>
                </div>
            `;
        }

        if (txError) {
            return `
                <div class="erc1155-admin-message error">
                    <span>${this.escapeHtml(txError)}</span>
                </div>
            `;
        }

        if (txSuccess) {
            return `
                <div class="erc1155-admin-message success">
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
        const { contractBalance, totalProceeds, withdrawableAmount, editions } = this.state;
        const hasBalance = ethers.BigNumber.from(contractBalance).gt(0);
        const hasProceeds = ethers.BigNumber.from(totalProceeds).gt(0);

        return `
            <div class="erc1155-admin-section">
                <h3 class="section-header">Earnings</h3>
                ${hasBalance ? this.renderEarningsStats() : this.renderEmptyEarnings(hasProceeds, editions.length)}
            </div>

            ${hasBalance ? this.renderWithdrawSection() : ''}

            ${this.renderVaultFeesSection()}

            ${this.renderFeaturedSection()}
        `;
    }

    renderEarningsStats() {
        const { totalProceeds, contractBalance, withdrawableAmount } = this.state;

        return `
            <div class="stats-row">
                <div class="stat-card">
                    <span class="stat-label">Lifetime Earnings</span>
                    <span class="stat-value">${this.formatEth(totalProceeds)} ETH</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">Available Balance</span>
                    <span class="stat-value">${this.formatEth(contractBalance)} ETH</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">Your Share (80%)</span>
                    <span class="stat-value price">${this.formatEth(withdrawableAmount)} ETH</span>
                </div>
            </div>
        `;
    }

    renderEmptyEarnings(hasProceeds, editionCount) {
        if (hasProceeds) {
            return `
                <div class="empty-state">
                    <p class="empty-headline">All caught up!</p>
                    <p class="empty-subtext">You've withdrawn all available earnings.</p>
                    <button class="btn btn-silver" data-ref="add-edition-from-empty">
                        Add New Edition
                    </button>
                </div>
            `;
        }

        return `
            <div class="empty-state">
                <p class="empty-headline">No earnings yet</p>
                <p class="empty-subtext">Create editions and start collecting mints</p>
                <button class="btn btn-gold" data-ref="create-first-edition">
                    Create Your First Edition
                </button>
            </div>
        `;
    }

    renderWithdrawSection() {
        const { withdrawableAmount } = this.state;
        const hasBalance = ethers.BigNumber.from(withdrawableAmount).gt(0);

        return `
            <div class="erc1155-admin-section">
                <h3 class="section-header">Withdraw Earnings</h3>
                <div class="withdraw-form">
                    <div class="input-group">
                        <input
                            type="number"
                            class="form-input"
                            placeholder="0.0"
                            step="0.001"
                            data-ref="withdraw-amount"
                            ${!hasBalance ? 'disabled' : ''}
                        />
                        <span class="input-suffix">ETH</span>
                        <button class="btn btn-silver btn-sm" data-ref="max-withdraw" ${!hasBalance ? 'disabled' : ''}>
                            MAX
                        </button>
                    </div>
                    <p class="helper-text">20% tithe automatically sent to vault</p>
                    <button class="btn btn-gold" data-ref="withdraw-btn" ${!hasBalance ? 'disabled' : ''}>
                        Withdraw
                    </button>
                </div>
            </div>
        `;
    }

    renderVaultFeesSection() {
        return `
            <div class="erc1155-admin-section">
                <h3 class="section-header">Vault Fee Share</h3>
                <div class="vault-fees">
                    <p class="claimable-amount">Claimable: <span class="price">${this.formatEth(this.state.claimableVaultFees)} ETH</span></p>
                    <button class="btn btn-silver" data-ref="claim-vault-fees">
                        Claim Vault Fees
                    </button>
                </div>
            </div>
        `;
    }

    renderFeaturedSection() {
        const {
            isFeatured, featuredPosition, featuredExpiry, featuredRentedAt, featuredRentPaid,
            rentalPrice, renewalDeposit, queueLength, queueMaxSize, queueUtilizationPct
        } = this.state;

        // Queue status bar (shown in both states)
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
                <div class="erc1155-admin-section">
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
            <div class="erc1155-admin-section">
                <h3 class="section-header">Featured Position</h3>
                ${queueStatusHtml}
                <div class="featured-status inactive">
                    <p>Get your project featured on the homepage carousel.</p>
                    <p class="rental-price">Position #1 costs <strong>${rentalPrice} ETH</strong> per week</p>
                    <p class="discount-info">5% off for 2 weeks • 10% off for 30 days</p>
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
    // EDITIONS TAB
    // ═══════════════════════════════════════════════════════════

    renderEditionsTab() {
        const { editions, projectStyleUri } = this.state;

        return `
            ${this.renderNewEditionSection()}

            <div class="erc1155-admin-section">
                <h3 class="section-header">Your Editions (${editions.length})</h3>
                ${editions.length === 0
                    ? '<p class="no-editions">No editions yet. Create your first edition above.</p>'
                    : this.renderEditionsList()
                }
            </div>

            <div class="erc1155-admin-section">
                <h3 class="section-header">Project Style</h3>
                <div class="style-form">
                    <p class="current-style">Current: ${projectStyleUri || 'None set'}</p>
                    <div class="input-group">
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            data-ref="project-style-uri"
                        />
                    </div>
                    <button class="btn btn-silver" data-ref="update-project-style">
                        Update Project Style
                    </button>
                </div>
            </div>
        `;
    }

    renderNewEditionSection() {
        const { showNewEditionForm } = this.state;

        if (!showNewEditionForm) {
            return `
                <div class="new-edition-toggle" data-ref="toggle-new-edition">
                    <span class="toggle-icon">+</span>
                    <span>Add New Edition</span>
                </div>
            `;
        }

        return `
            <div class="erc1155-admin-section new-edition-form">
                <h3 class="section-header">Create New Edition</h3>
                <div class="form-grid">
                    <div class="form-field">
                        <label class="form-label">Piece Title *</label>
                        <input
                            type="text"
                            class="form-input"
                            placeholder="Enter title"
                            data-ref="edition-title"
                        />
                    </div>
                    <div class="form-field">
                        <label class="form-label">Metadata URI</label>
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            data-ref="edition-metadata-uri"
                        />
                    </div>
                    <div class="form-field">
                        <label class="form-label">Base Price (ETH) *</label>
                        <input
                            type="number"
                            class="form-input"
                            placeholder="0.01"
                            step="0.001"
                            data-ref="edition-price"
                        />
                    </div>
                    <div class="form-field">
                        <label class="form-label">Supply (0 = unlimited)</label>
                        <input
                            type="number"
                            class="form-input"
                            placeholder="0"
                            data-ref="edition-supply"
                        />
                    </div>
                    <div class="form-field">
                        <label class="form-label">Pricing Model</label>
                        <select class="form-select" data-ref="edition-pricing-model">
                            <option value="0">Unlimited (Fixed)</option>
                            <option value="1">Limited (Fixed)</option>
                            <option value="2">Limited (Dynamic)</option>
                        </select>
                    </div>
                    <div class="form-field hidden">
                        <label class="form-label">Price Increase Rate (%)</label>
                        <input
                            type="number"
                            class="form-input"
                            placeholder="10"
                            data-ref="edition-price-increase"
                        />
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn btn-gold" data-ref="create-edition">
                        Create Edition
                    </button>
                    <button class="btn-link silver" data-ref="cancel-new-edition">
                        Cancel
                    </button>
                </div>
            </div>
        `;
    }

    renderEditionsList() {
        const { editions } = this.state;

        return `
            <div class="editions-list">
                ${editions.map((edition, index) => this.renderEditionRow(edition, index)).join('')}
            </div>
        `;
    }

    renderEditionRow(edition, index) {
        const minted = parseInt(edition.currentSupply || '0');
        const maxSupply = parseInt(edition.maxSupply || '0');
        const isUnlimited = maxSupply === 0;
        const progress = isUnlimited ? 0 : Math.min((minted / maxSupply) * 100, 100);
        const priceEth = this.formatEth(edition.price);
        const title = edition.metadata?.name || edition.pieceTitle || `Edition #${edition.id}`;
        const isManaging = this.state.manageEditionId === parseInt(edition.id);

        return `
            <div class="edition-row ${isManaging ? 'managing' : ''}" data-edition-id="${edition.id}">
                <div class="edition-thumb">
                    ${edition.metadata?.image
                        ? `<img src="${this.escapeHtml(edition.metadata.image)}" alt="${this.escapeHtml(title)}" />`
                        : '<div class="edition-thumb-placeholder"></div>'
                    }
                </div>
                <div class="edition-details">
                    <h4 class="edition-title">Edition #${edition.id}: "${this.escapeHtml(title)}"</h4>
                    <p class="edition-meta">
                        Price: ${priceEth} ETH (${this.getPricingModelLabel(edition.pricingModel)})
                    </p>
                    <p class="edition-stats">
                        Minted: ${minted}${isUnlimited ? '' : `/${maxSupply}`}
                        ${isUnlimited ? '(unlimited)' : `(${progress.toFixed(0)}%)`}
                    </p>
                    ${!isUnlimited ? `
                        <div class="edition-progress">
                            <div class="edition-progress-bar" style="width: ${progress}%"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="edition-actions">
                    <button class="btn btn-silver btn-sm" data-ref="manage-edition-${edition.id}" data-edition-id="${edition.id}">
                        ${isManaging ? 'Close' : 'Manage'}
                    </button>
                </div>
                ${isManaging ? this.renderEditionManagePanel(edition) : ''}
            </div>
        `;
    }

    renderEditionManagePanel(edition) {
        return `
            <div class="edition-manage-panel">
                <div class="manage-section">
                    <h5>Update Metadata URI</h5>
                    <div class="input-group">
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            data-ref="edition-metadata-${edition.id}"
                        />
                        <button class="btn btn-silver btn-sm" data-ref="save-metadata-${edition.id}" data-edition-id="${edition.id}">
                            Save
                        </button>
                    </div>
                </div>
                <div class="manage-section">
                    <h5>Update Style URI</h5>
                    <div class="input-group">
                        <input
                            type="text"
                            class="form-input"
                            placeholder="ipfs://... or https://..."
                            data-ref="edition-style-${edition.id}"
                        />
                        <button class="btn btn-silver btn-sm" data-ref="save-style-${edition.id}" data-edition-id="${edition.id}">
                            Save
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    getPricingModelLabel(model) {
        const models = ['Fixed', 'Fixed', 'Dynamic'];
        return models[parseInt(model) || 0];
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED TAB
    // ═══════════════════════════════════════════════════════════

    renderAdvancedTab() {
        return `
            <div class="warning-banner">
                <span class="warning-icon">&#9888;</span>
                <p>These actions are irreversible. Proceed with extreme caution.</p>
            </div>

            <div class="erc1155-admin-section danger-section">
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

            <div class="erc1155-admin-section danger-section severe">
                <h3 class="section-header">Renounce Ownership</h3>
                <p class="danger-description">
                    Permanently remove all ownership from this contract. After renouncing:
                </p>
                <ul class="danger-list">
                    <li>No future editions can be added</li>
                    <li>No metadata can be updated</li>
                    <li>No styles can be changed</li>
                    <li>Remaining balance can still be withdrawn</li>
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
        // Use event delegation - attach once to element, handles all dynamic content
        this.setupEventDelegation();
    }

    onStateUpdate(oldState, newState) {
        // Escape key handler setup when modal opens
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

    /**
     * Event delegation - single handler for all clicks
     * Uses this.element (set by Component base class)
     */
    setupEventDelegation() {
        if (!this.element) {
            console.error('[ERC1155AdminModal] No element for event delegation');
            return;
        }

        // Click delegation
        this.element.addEventListener('click', (e) => {
            const target = e.target.closest('[data-ref]') || e.target.closest('[data-tab]');
            if (!target) {
                // Check if click was on overlay background
                if (e.target.classList.contains('erc1155-admin-overlay')) {
                    this.close();
                }
                return;
            }

            const ref = target.dataset.ref;
            const tab = target.dataset.tab;

            // Tab switching
            if (tab) {
                this.switchTab(tab);
                return;
            }

            // Handle by ref
            switch (ref) {
                case 'close-btn':
                    this.close();
                    break;
                case 'max-withdraw':
                    this.setMaxWithdraw();
                    break;
                case 'withdraw-btn':
                    this.handleWithdraw();
                    break;
                case 'claim-vault-fees':
                    this.handleClaimVaultFees();
                    break;
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
                case 'create-first-edition':
                case 'add-edition-from-empty':
                    this.setState({ activeTab: 'editions', showNewEditionForm: true });
                    break;
                case 'toggle-new-edition':
                    this.toggleNewEditionForm();
                    break;
                case 'create-edition':
                    this.handleCreateEdition();
                    break;
                case 'cancel-new-edition':
                    this.setState({ showNewEditionForm: false });
                    break;
                case 'update-project-style':
                    this.handleUpdateProjectStyle();
                    break;
                case 'transfer-ownership':
                    this.handleTransferOwnership();
                    break;
                case 'renounce-ownership':
                    this.handleRenounceOwnership();
                    break;
                default:
                    // Handle dynamic refs
                    if (ref?.startsWith('manage-edition-')) {
                        const editionId = parseInt(target.dataset.editionId);
                        console.log('[ERC1155AdminModal] Manage button clicked:', { ref, editionId, currentManageId: this.state.manageEditionId });
                        if (this.state.manageEditionId === editionId) {
                            this.closeEditionManage();
                        } else {
                            this.openEditionManage(editionId);
                        }
                    } else if (ref?.startsWith('save-metadata-')) {
                        const editionId = parseInt(target.dataset.editionId);
                        this.handleUpdateEditionMetadata(editionId);
                    } else if (ref?.startsWith('save-style-')) {
                        const editionId = parseInt(target.dataset.editionId);
                        this.handleUpdateEditionStyle(editionId);
                    }
            }
        });

        // Input delegation for form values
        this.element.addEventListener('input', (e) => {
            const ref = e.target.dataset.ref;
            if (!ref) return;

            switch (ref) {
                case 'withdraw-amount':
                    this._formValues.withdrawAmount = e.target.value;
                    break;
                case 'edition-title':
                    this.updateNewEditionForm('pieceTitle', e.target.value);
                    break;
                case 'edition-metadata-uri':
                    this.updateNewEditionForm('metadataUri', e.target.value);
                    break;
                case 'edition-price':
                    this.updateNewEditionForm('basePrice', e.target.value);
                    break;
                case 'edition-supply':
                    this.updateNewEditionForm('supply', e.target.value);
                    break;
                case 'edition-price-increase':
                    this.updateNewEditionForm('priceIncreaseRate', e.target.value);
                    break;
                case 'project-style-uri':
                    this._formValues.projectStyleUri = e.target.value;
                    break;
                case 'new-owner-address':
                    this._formValues.newOwnerAddress = e.target.value;
                    break;
            }
        });

        // Change delegation for selects and checkboxes
        this.element.addEventListener('change', (e) => {
            const ref = e.target.dataset.ref;
            if (!ref) return;

            switch (ref) {
                case 'edition-pricing-model':
                    this.updateNewEditionForm('pricingModel', e.target.value);
                    break;
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
        stylesheetLoader.unload('erc1155-admin-styles');
        super.unmount();
    }
}

export default ERC1155AdminModal;
