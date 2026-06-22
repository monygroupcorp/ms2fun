/**
 * OwnerDashboard - Microact Version
 *
 * Owner-only controls for ERC404 project management:
 * - Bonding timeline settings
 * - Liquidity deployment
 * - Staking enable
 * - Style and hook configuration
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class OwnerDashboard extends Component {
    constructor(props = {}) {
        super(props);
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

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('transaction:confirmed', () => this.loadData());
        const unsub2 = eventBus.on('account:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub4 = eventBus.on('wallet:disconnected', () => {
            this.setState({ loading: false, isOwner: false });
        });

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

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();

            const ownerAddress = await this.adapter.owner().catch(() => null);
            const isOwner = walletAddress && ownerAddress &&
                walletAddress.toLowerCase() === ownerAddress.toLowerCase();

            if (!isOwner) {
                this.setState({ loading: false, isOwner: false, ownerAddress });
                return;
            }

            const [bondingStatus, stakingEnabled, canDeployPermissionless, liquidityPool, styleUri, hookAddress, vaultAddress] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.stakingEnabled().catch(() => false),
                this.adapter.canDeployPermissionless().catch(() => false),
                this.adapter.liquidityPool().catch(() => null),
                this.adapter.getStyle().catch(() => ''),
                this.adapter.v4Hook().catch(() => ''),
                this.adapter.vault().catch(() => '')
            ]);

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

    truncateAddress(address) {
        if (!address) return 'Unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    // Handler methods for stable binding
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

            const supplyInfo = await this.adapter.getSupplyInfo();
            const reserve = await this.adapter.reserve();

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            const liquidityReserve = await this.adapter.LIQUIDITY_RESERVE();
            const amountToken = liquidityReserve;
            const amountETH = reserve;

            const sqrtPriceX96 = ethers.BigNumber.from('79228162514264337593543950336');

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

    handleOpenTimeChange(e) {
        this.setState({ openTime: e.target.value, error: null });
    }

    handleMaturityTimeChange(e) {
        this.setState({ maturityTime: e.target.value, error: null });
    }

    handlePoolFeeChange(e) {
        this.setState({ poolFee: e.target.value, error: null });
    }

    handleTickSpacingChange(e) {
        this.setState({ tickSpacing: e.target.value, error: null });
    }

    handleStyleUriChange(e) {
        this.setState({ styleUri: e.target.value, error: null });
    }

    handleHookAddressChange(e) {
        this.setState({ hookAddress: e.target.value, error: null });
    }

    handleVaultAddressChange(e) {
        this.setState({ vaultAddress: e.target.value, error: null });
    }

    renderBondingControls() {
        const { bondingStatus, openTime, maturityTime, txPending } = this.state;
        const isActive = bondingStatus?.isActive || false;

        return h('div', { className: 'owner-section bonding-controls' },
            h('h4', null, 'Bonding Controls'),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'Bonding Status'),
                    h('button', {
                        className: `toggle-btn ${isActive ? 'active' : 'inactive'}`,
                        onClick: this.bind(this.handleToggleBondingActive),
                        disabled: txPending
                    }, isActive ? 'Active' : 'Inactive')
                )
            ),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'Open Time'),
                    h('div', { className: 'input-action-row' },
                        h('input', {
                            type: 'datetime-local',
                            value: openTime,
                            onInput: this.bind(this.handleOpenTimeChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'action-btn small',
                            onClick: this.bind(this.handleSetBondingOpenTime),
                            disabled: txPending
                        }, 'Set')
                    )
                )
            ),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'Maturity Time'),
                    h('div', { className: 'input-action-row' },
                        h('input', {
                            type: 'datetime-local',
                            value: maturityTime,
                            onInput: this.bind(this.handleMaturityTimeChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'action-btn small',
                            onClick: this.bind(this.handleSetBondingMaturityTime),
                            disabled: txPending
                        }, 'Set')
                    )
                )
            )
        );
    }

    renderStakingControls() {
        const { stakingEnabled, txPending } = this.state;

        return h('div', { className: 'owner-section staking-controls' },
            h('h4', null, 'Staking'),
            h('div', { className: 'control-row' },
                h('div', { className: 'control-info' },
                    h('span', { className: 'status-label' }, 'Status:'),
                    h('span', { className: `status-value ${stakingEnabled ? 'enabled' : 'disabled'}` },
                        stakingEnabled ? 'Enabled' : 'Disabled'
                    )
                ),
                !stakingEnabled && h('button', {
                    className: 'action-btn enable-staking-btn',
                    onClick: this.bind(this.handleEnableStaking),
                    disabled: txPending
                }, txPending ? 'Processing...' : 'Enable Staking')
            )
        );
    }

    renderLiquidityControls() {
        const { liquidityPool, poolFee, tickSpacing, canDeployPermissionless, txPending } = this.state;
        const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';

        return h('div', { className: 'owner-section liquidity-controls' },
            h('h4', null, 'Liquidity Deployment'),

            hasLiquidity
                ? h('div', { className: 'liquidity-deployed' },
                    h('span', { className: 'deployed-label' }, 'Liquidity Deployed'),
                    h('span', { className: 'pool-address' }, this.truncateAddress(liquidityPool))
                )
                : h('div', { className: 'liquidity-form' },
                    h('div', { className: 'control-row' },
                        h('div', { className: 'control-group' },
                            h('label', null, 'Pool Fee (basis points)'),
                            h('select', {
                                value: poolFee,
                                onChange: this.bind(this.handlePoolFeeChange),
                                disabled: txPending
                            },
                                h('option', { value: '500' }, '0.05%'),
                                h('option', { value: '3000' }, '0.3%'),
                                h('option', { value: '10000' }, '1%')
                            )
                        ),
                        h('div', { className: 'control-group' },
                            h('label', null, 'Tick Spacing'),
                            h('input', {
                                type: 'number',
                                value: tickSpacing,
                                onInput: this.bind(this.handleTickSpacingChange),
                                disabled: txPending
                            })
                        )
                    ),
                    h('button', {
                        className: 'action-btn deploy-btn',
                        onClick: this.bind(this.handleDeployLiquidity),
                        disabled: txPending
                    }, txPending ? 'Processing...' : 'Deploy Liquidity'),
                    canDeployPermissionless && h('p', { className: 'permissionless-note' },
                        'Note: Anyone can deploy liquidity after maturity'
                    )
                )
        );
    }

    renderAdvancedSettings() {
        const { styleUri, hookAddress, vaultAddress, txPending } = this.state;

        return h('div', { className: 'owner-section advanced-settings' },
            h('h4', null, 'Advanced Settings'),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'Style URI'),
                    h('div', { className: 'input-action-row' },
                        h('input', {
                            type: 'text',
                            placeholder: 'ipfs://... or https://...',
                            value: styleUri,
                            onInput: this.bind(this.handleStyleUriChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'action-btn small',
                            onClick: this.bind(this.handleSetStyle),
                            disabled: txPending
                        }, 'Set')
                    )
                )
            ),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'V4 Hook Address'),
                    h('div', { className: 'input-action-row' },
                        h('input', {
                            type: 'text',
                            placeholder: '0x...',
                            value: hookAddress,
                            onInput: this.bind(this.handleHookAddressChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'action-btn small',
                            onClick: this.bind(this.handleSetV4Hook),
                            disabled: txPending
                        }, 'Set')
                    )
                )
            ),

            h('div', { className: 'control-row' },
                h('div', { className: 'control-group' },
                    h('label', null, 'Vault Address'),
                    h('div', { className: 'input-action-row' },
                        h('input', {
                            type: 'text',
                            placeholder: '0x...',
                            value: vaultAddress,
                            onInput: this.bind(this.handleVaultAddressChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'action-btn small',
                            onClick: this.bind(this.handleSetVault),
                            disabled: txPending
                        }, 'Set')
                    )
                )
            )
        );
    }

    render() {
        const { loading, error, isOwner, ownerAddress } = this.state;
        const walletConnected = this.isConnected();

        if (!walletConnected) {
            return h('div', { className: 'owner-dashboard marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Owner Dashboard')
                ),
                h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect wallet to access owner controls')
                )
            );
        }

        if (loading) {
            return h('div', { className: 'owner-dashboard loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Checking ownership...')
            );
        }

        if (!isOwner) {
            return h('div', { className: 'owner-dashboard not-owner marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Owner Dashboard')
                ),
                h('div', { className: 'not-owner-message' },
                    h('p', null, 'You are not the owner of this project.'),
                    h('p', { className: 'owner-address' }, `Owner: ${this.truncateAddress(ownerAddress)}`)
                )
            );
        }

        return h('div', { className: 'owner-dashboard marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Owner Dashboard'),
                h('span', { className: 'owner-badge' }, 'Owner')
            ),

            error && h('div', { className: 'error-banner' }, error),

            this.renderBondingControls(),
            this.renderStakingControls(),
            this.renderLiquidityControls(),
            this.renderAdvancedSettings(),

            h('div', { className: 'owner-section featured-section' },
                h('h4', null, 'Featured Position'),
                h('div', { className: 'featured-rental-container' },
                    h('p', { className: 'featured-placeholder' }, 'Featured rental component placeholder')
                )
            )
        );
    }
}

export default OwnerDashboard;
