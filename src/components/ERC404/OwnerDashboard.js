import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { FeaturedRental } from '../FeaturedRental/FeaturedRental.js';

/**
 * OwnerDashboard Component
 *
 * Owner-only controls for ERC404 project management:
 * - Bonding timeline settings
 * - Liquidity deployment
 * - Staking enable
 * - Style and hook configuration
 */
export class OwnerDashboard extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            loading: true,
            error: null,
            isOwner: false,
            ownerAddress: null,
            bondingStatus: null,
            stakingEnabled: false,
            canDeployPermissionless: false,
            liquidityPool: null,
            // Form inputs
            openTime: '',
            maturityTime: '',
            styleUri: '',
            hookAddress: '',
            vaultAddress: '',
            // Liquidity params
            poolFee: '3000',
            tickSpacing: '60',
            txPending: false
        };
    }

    async onMount() {
        await this.loadData();
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
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false, isOwner: false }))
        ];
    }

    onStateUpdate(oldState, newState) {
        // Mount FeaturedRental when owner is verified and not loading
        if (newState.isOwner && !newState.loading && (oldState.loading || !oldState.isOwner)) {
            this.setTimeout(() => {
                this.mountFeaturedRental();
            }, 0);
        }
        // Unmount when no longer owner
        if (!newState.isOwner && oldState.isOwner) {
            this.unmountFeaturedRental();
        }
    }

    mountFeaturedRental() {
        const container = this.getRef('featured-rental-container', '.featured-rental-container');
        if (container && !this._children.has('featured-rental')) {
            // Get contract address from adapter or projectId
            const contractAddress = this.projectId;
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

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();

            // Get owner address
            const ownerAddress = await this.adapter.owner().catch(() => null);
            const isOwner = walletAddress && ownerAddress &&
                walletAddress.toLowerCase() === ownerAddress.toLowerCase();

            if (!isOwner) {
                this.setState({ loading: false, isOwner: false, ownerAddress });
                return;
            }

            // Load all owner-relevant data
            const [bondingStatus, stakingEnabled, canDeployPermissionless, liquidityPool, styleUri, hookAddress, vaultAddress] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.stakingEnabled().catch(() => false),
                this.adapter.canDeployPermissionless().catch(() => false),
                this.adapter.liquidityPool().catch(() => null),
                this.adapter.getStyle().catch(() => ''),
                this.adapter.v4Hook().catch(() => ''),
                this.adapter.vault().catch(() => '')
            ]);

            // Pre-populate form fields with current values
            this.setState({
                loading: false,
                isOwner: true,
                ownerAddress,
                bondingStatus,
                stakingEnabled,
                canDeployPermissionless,
                liquidityPool,
                styleUri: styleUri || '',
                hookAddress: hookAddress || '',
                vaultAddress: vaultAddress || '',
                openTime: bondingStatus?.openTime ? this.formatDateTimeLocal(bondingStatus.openTime) : '',
                maturityTime: bondingStatus?.maturityTime ? this.formatDateTimeLocal(bondingStatus.maturityTime) : ''
            });
        } catch (error) {
            console.error('[OwnerDashboard] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load owner data'
            });
        }
    }

    formatDateTimeLocal(timestamp) {
        if (!timestamp || timestamp === 0) return '';
        const date = new Date(timestamp * 1000);
        return date.toISOString().slice(0, 16);
    }

    parseLocalDateTime(dateTimeStr) {
        if (!dateTimeStr) return 0;
        return Math.floor(new Date(dateTimeStr).getTime() / 1000);
    }

    async handleSetBondingOpenTime() {
        const timestamp = this.parseLocalDateTime(this.state.openTime);
        if (!timestamp) {
            this.setState({ error: 'Invalid open time' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.setBondingOpenTime(timestamp);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to set open time' });
        }
    }

    async handleSetBondingMaturityTime() {
        const timestamp = this.parseLocalDateTime(this.state.maturityTime);
        if (!timestamp) {
            this.setState({ error: 'Invalid maturity time' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.setBondingMaturityTime(timestamp);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to set maturity time' });
        }
    }

    async handleToggleBondingActive() {
        try {
            this.setState({ txPending: true, error: null });
            const newState = !this.state.bondingStatus?.isActive;
            await this.adapter.setBondingActive(newState);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to toggle bonding' });
        }
    }

    async handleEnableStaking() {
        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.enableStaking();
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to enable staking' });
        }
    }

    async handleDeployLiquidity() {
        const { poolFee, tickSpacing } = this.state;

        try {
            this.setState({ txPending: true, error: null });

            // Get supply and reserve info for liquidity calculation
            const supplyInfo = await this.adapter.getSupplyInfo();
            const reserve = await this.adapter.reserve();

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            // Calculate liquidity amounts (using reserve and a portion of supply)
            const liquidityReserve = await this.adapter.LIQUIDITY_RESERVE();
            const amountToken = liquidityReserve;
            const amountETH = reserve;

            // Calculate initial sqrt price (simplified - uses current price ratio)
            // sqrtPriceX96 = sqrt(price) * 2^96
            // For simplicity, use a reasonable initial price
            const sqrtPriceX96 = ethers.BigNumber.from('79228162514264337593543950336'); // ~1:1 ratio

            await this.adapter.deployLiquidity(
                parseInt(poolFee),
                parseInt(tickSpacing),
                amountToken.toString(),
                amountETH.toString(),
                sqrtPriceX96.toString()
            );

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to deploy liquidity' });
        }
    }

    async handleSetStyle() {
        const { styleUri } = this.state;
        if (!styleUri) {
            this.setState({ error: 'Style URI is required' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.setStyle(styleUri);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to set style' });
        }
    }

    async handleSetV4Hook() {
        const { hookAddress } = this.state;
        if (!hookAddress || !hookAddress.startsWith('0x')) {
            this.setState({ error: 'Valid hook address is required' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.setV4Hook(hookAddress);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to set hook' });
        }
    }

    async handleSetVault() {
        const { vaultAddress } = this.state;
        if (!vaultAddress || !vaultAddress.startsWith('0x')) {
            this.setState({ error: 'Valid vault address is required' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            await this.adapter.setVault(vaultAddress);
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Failed to set vault' });
        }
    }

    handleInputChange(field, value) {
        this.setState({ [field]: value, error: null });
    }

    render() {
        const walletConnected = !!walletService.getAddress();

        if (!walletConnected) {
            return `
                <div class="owner-dashboard marble-bg">
                    <div class="panel-header">
                        <h3>Owner Dashboard</h3>
                    </div>
                    <div class="connect-prompt">
                        <p>Connect wallet to access owner controls</p>
                    </div>
                </div>
            `;
        }

        if (this.state.loading) {
            return `
                <div class="owner-dashboard loading">
                    <div class="loading-spinner"></div>
                    <p>Checking ownership...</p>
                </div>
            `;
        }

        if (!this.state.isOwner) {
            return `
                <div class="owner-dashboard not-owner marble-bg">
                    <div class="panel-header">
                        <h3>Owner Dashboard</h3>
                    </div>
                    <div class="not-owner-message">
                        <p>You are not the owner of this project.</p>
                        <p class="owner-address">Owner: ${this.truncateAddress(this.state.ownerAddress)}</p>
                    </div>
                </div>
            `;
        }

        const { bondingStatus, stakingEnabled, liquidityPool, error, txPending } = this.state;
        const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';

        return `
            <div class="owner-dashboard marble-bg">
                <div class="panel-header">
                    <h3>Owner Dashboard</h3>
                    <span class="owner-badge">Owner</span>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                ${this.renderBondingControls(bondingStatus, txPending)}
                ${this.renderStakingControls(stakingEnabled, txPending)}
                ${this.renderLiquidityControls(hasLiquidity, txPending)}
                ${this.renderAdvancedSettings(txPending)}

                <div class="owner-section featured-section">
                    <h4>Featured Position</h4>
                    <div class="featured-rental-container" ref="featured-rental-container">
                        <!-- FeaturedRental component will be mounted here -->
                    </div>
                </div>
            </div>
        `;
    }

    renderBondingControls(bondingStatus, txPending) {
        const isActive = bondingStatus?.isActive || false;
        const { openTime, maturityTime } = this.state;

        return `
            <div class="owner-section bonding-controls">
                <h4>Bonding Controls</h4>

                <div class="control-row">
                    <div class="control-group">
                        <label>Bonding Status</label>
                        <button
                            class="toggle-btn ${isActive ? 'active' : 'inactive'}"
                            data-action="toggle-bonding"
                            ${txPending ? 'disabled' : ''}
                        >
                            ${isActive ? 'Active' : 'Inactive'}
                        </button>
                    </div>
                </div>

                <div class="control-row">
                    <div class="control-group">
                        <label>Open Time</label>
                        <div class="input-action-row">
                            <input
                                type="datetime-local"
                                value="${openTime}"
                                data-field="openTime"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="action-btn small" data-action="set-open-time" ${txPending ? 'disabled' : ''}>
                                Set
                            </button>
                        </div>
                    </div>
                </div>

                <div class="control-row">
                    <div class="control-group">
                        <label>Maturity Time</label>
                        <div class="input-action-row">
                            <input
                                type="datetime-local"
                                value="${maturityTime}"
                                data-field="maturityTime"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="action-btn small" data-action="set-maturity-time" ${txPending ? 'disabled' : ''}>
                                Set
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderStakingControls(stakingEnabled, txPending) {
        return `
            <div class="owner-section staking-controls">
                <h4>Staking</h4>
                <div class="control-row">
                    <div class="control-info">
                        <span class="status-label">Status:</span>
                        <span class="status-value ${stakingEnabled ? 'enabled' : 'disabled'}">
                            ${stakingEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                    ${!stakingEnabled ? `
                        <button
                            class="action-btn enable-staking-btn"
                            data-action="enable-staking"
                            ${txPending ? 'disabled' : ''}
                        >
                            ${txPending ? 'Processing...' : 'Enable Staking'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderLiquidityControls(hasLiquidity, txPending) {
        const { poolFee, tickSpacing, canDeployPermissionless, liquidityPool } = this.state;

        return `
            <div class="owner-section liquidity-controls">
                <h4>Liquidity Deployment</h4>

                ${hasLiquidity ? `
                    <div class="liquidity-deployed">
                        <span class="deployed-label">Liquidity Deployed</span>
                        <span class="pool-address">${this.truncateAddress(liquidityPool)}</span>
                    </div>
                ` : `
                    <div class="liquidity-form">
                        <div class="control-row">
                            <div class="control-group">
                                <label>Pool Fee (basis points)</label>
                                <select data-field="poolFee" ${txPending ? 'disabled' : ''}>
                                    <option value="500" ${poolFee === '500' ? 'selected' : ''}>0.05%</option>
                                    <option value="3000" ${poolFee === '3000' ? 'selected' : ''}>0.3%</option>
                                    <option value="10000" ${poolFee === '10000' ? 'selected' : ''}>1%</option>
                                </select>
                            </div>
                            <div class="control-group">
                                <label>Tick Spacing</label>
                                <input
                                    type="number"
                                    value="${tickSpacing}"
                                    data-field="tickSpacing"
                                    ${txPending ? 'disabled' : ''}
                                />
                            </div>
                        </div>
                        <button
                            class="action-btn deploy-btn"
                            data-action="deploy-liquidity"
                            ${txPending ? 'disabled' : ''}
                        >
                            ${txPending ? 'Processing...' : 'Deploy Liquidity'}
                        </button>
                        ${canDeployPermissionless ? `
                            <p class="permissionless-note">Note: Anyone can deploy liquidity after maturity</p>
                        ` : ''}
                    </div>
                `}
            </div>
        `;
    }

    renderAdvancedSettings(txPending) {
        const { styleUri, hookAddress, vaultAddress } = this.state;

        return `
            <div class="owner-section advanced-settings">
                <h4>Advanced Settings</h4>

                <div class="control-row">
                    <div class="control-group">
                        <label>Style URI</label>
                        <div class="input-action-row">
                            <input
                                type="text"
                                placeholder="ipfs://... or https://..."
                                value="${this.escapeHtml(styleUri)}"
                                data-field="styleUri"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="action-btn small" data-action="set-style" ${txPending ? 'disabled' : ''}>
                                Set
                            </button>
                        </div>
                    </div>
                </div>

                <div class="control-row">
                    <div class="control-group">
                        <label>V4 Hook Address</label>
                        <div class="input-action-row">
                            <input
                                type="text"
                                placeholder="0x..."
                                value="${this.escapeHtml(hookAddress)}"
                                data-field="hookAddress"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="action-btn small" data-action="set-hook" ${txPending ? 'disabled' : ''}>
                                Set
                            </button>
                        </div>
                    </div>
                </div>

                <div class="control-row">
                    <div class="control-group">
                        <label>Vault Address</label>
                        <div class="input-action-row">
                            <input
                                type="text"
                                placeholder="0x..."
                                value="${this.escapeHtml(vaultAddress)}"
                                data-field="vaultAddress"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="action-btn small" data-action="set-vault" ${txPending ? 'disabled' : ''}>
                                Set
                            </button>
                        </div>
                    </div>
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

        container.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            switch (action) {
                case 'toggle-bonding':
                    this.handleToggleBondingActive();
                    break;
                case 'set-open-time':
                    this.handleSetBondingOpenTime();
                    break;
                case 'set-maturity-time':
                    this.handleSetBondingMaturityTime();
                    break;
                case 'enable-staking':
                    this.handleEnableStaking();
                    break;
                case 'deploy-liquidity':
                    this.handleDeployLiquidity();
                    break;
                case 'set-style':
                    this.handleSetStyle();
                    break;
                case 'set-hook':
                    this.handleSetV4Hook();
                    break;
                case 'set-vault':
                    this.handleSetVault();
                    break;
            }
        });

        container.addEventListener('input', (e) => {
            const field = e.target.dataset.field;
            if (field) {
                this.handleInputChange(field, e.target.value);
            }
        });

        container.addEventListener('change', (e) => {
            const field = e.target.dataset.field;
            if (field) {
                this.handleInputChange(field, e.target.value);
            }
        });
    }

    truncateAddress(address) {
        if (!address) return 'Unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
