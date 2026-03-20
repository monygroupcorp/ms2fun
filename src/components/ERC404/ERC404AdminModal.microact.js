/**
 * ERC404AdminModal - Tabbed admin settings modal
 *
 * Three tabs: Overview, Configuration, Advanced.
 * Opens via erc404:admin:open event.
 * Matches docs/examples/project-erc404-admin-demo.html admin modal.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { StyleBuilder } from '../shared/StyleBuilder.microact.js';

const PHASE_LABELS = ['Pre-Open', 'Bonding Active', 'Full', 'Matured', 'Deployed'];
const PHASE_CLASSES = ['pre-open', 'bonding', 'full', 'matured', 'deployed'];

export class ERC404AdminModal extends Component {
    constructor(props = {}) {
        super(props);
        this._boundKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        const unsub = eventBus.on('erc404:admin:open', () => this.open());
        this.registerCleanup(() => { unsub(); });
    }

    shouldUpdate() {
        return false;
    }

    // ── Open / Close ──

    open() {
        if (!this._el) return;
        const overlay = this._el.querySelector('.modal-overlay');
        if (overlay) overlay.classList.add('active');
        document.addEventListener('keydown', this._boundKeyDown);
        this.loadData();
    }

    close() {
        if (!this._el) return;
        const overlay = this._el.querySelector('.modal-overlay');
        if (overlay) overlay.classList.remove('active');
        document.removeEventListener('keydown', this._boundKeyDown);
    }

    // ── Tab Switching ──

    switchTab(tabName) {
        if (!this._el) return;
        this._el.querySelectorAll('.modal-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.modalTab === tabName);
        });
        this._el.querySelectorAll('.modal-tab-content').forEach(c => {
            c.classList.toggle('active', c.dataset.modalContent === tabName);
        });
    }

    // ── Data Loading ──

    async loadData() {
        if (!this.adapter) return;

        try {
            const [bondingStatus, stakingEnabled, canDeploy, hook, vault] = await Promise.all([
                this.adapter.getBondingStatus(),
                this.adapter.stakingEnabled(),
                this.adapter.canDeployPermissionless().catch(() => false),
                this.adapter.v4Hook().catch(() => ''),
                this.adapter.vault().catch(() => '')
            ]);

            this.updateOverviewDOM(bondingStatus, stakingEnabled, canDeploy);
            this.updateConfigDOM(bondingStatus, stakingEnabled, hook, vault);
        } catch (error) {
            console.warn('[ERC404AdminModal] Failed to load data:', error);
        }
    }

    updateOverviewDOM(bondingStatus, stakingEnabled, canDeploy) {
        if (!this._el) return;

        // Phase badge
        const badge = this._el.querySelector('[data-overview-phase]');
        if (badge) {
            const phase = bondingStatus.currentPhase || 0;
            badge.textContent = PHASE_LABELS[phase] || 'Unknown';
            badge.className = 'phase-badge ' + (PHASE_CLASSES[phase] || '');
        }

        // Progress bar
        const maxSupply = parseFloat(bondingStatus.maxBondingSupply || '0');
        const currentSupply = parseFloat(bondingStatus.currentSupply || '0');
        const pct = maxSupply > 0 ? (currentSupply / maxSupply * 100) : 0;
        const pctStr = pct.toFixed(1);

        const fill = this._el.querySelector('[data-overview-progress-fill]');
        if (fill) fill.style.width = pctStr + '%';

        const label = this._el.querySelector('[data-overview-progress-label]');
        if (label) {
            const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
            label.textContent = `${fmt(currentSupply)} / ${fmt(maxSupply)} (${pctStr}%)`;
        }

        // Stats
        const setValue = (key, val) => {
            const el = this._el.querySelector(`[data-overview-stat="${key}"]`);
            if (el) el.textContent = val;
        };

        const reserve = bondingStatus.currentReserve
            ? parseFloat(ethers.utils.formatEther(bondingStatus.currentReserve))
            : 0;
        setValue('reserve', (reserve < 0.01 && reserve > 0 ? reserve.toFixed(4) : reserve.toFixed(2)) + ' ETH');

        const fmtSupply = (n) => {
            const v = parseFloat(n || '0');
            return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0);
        };
        setValue('sold', fmtSupply(bondingStatus.currentSupply));

        const fmtDate = (ts) => {
            if (!ts || ts === '0') return 'Not Set';
            const d = new Date(parseInt(ts) * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        setValue('open', fmtDate(bondingStatus.openTime));
        setValue('maturity', fmtDate(bondingStatus.maturityTime));

        // Staking status
        const stakingStatusEl = this._el.querySelector('[data-overview-staking-status]');
        if (stakingStatusEl) stakingStatusEl.textContent = stakingEnabled ? 'Enabled' : 'Disabled';

        const enableStakingBtn = this._el.querySelector('[data-action="overview-enable-staking"]');
        if (enableStakingBtn) enableStakingBtn.style.display = stakingEnabled ? 'none' : '';

        // Pause/Resume button
        const pauseBtn = this._el.querySelector('[data-action="toggle-bonding"]');
        if (pauseBtn) {
            const isActive = bondingStatus.bondingActive !== false;
            pauseBtn.textContent = isActive ? 'Pause Bonding' : 'Resume Bonding';
        }

        // Deploy liquidity button
        const deployBtn = this._el.querySelector('[data-action="deploy-liquidity"]');
        if (deployBtn) {
            const phase = bondingStatus.currentPhase || 0;
            deployBtn.disabled = phase < 3; // Only enable if matured or later
        }
    }

    updateConfigDOM(bondingStatus, stakingEnabled, hook, vault) {
        if (!this._el) return;

        const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

        // V4 Hook
        const hookEl = this._el.querySelector('[data-config-value="hook"]');
        const hookStatusEl = this._el.querySelector('[data-config-status="hook"]');
        const hookItem = this._el.querySelector('[data-config-item="hook"]');
        if (hookEl) hookEl.textContent = hook && hook !== ZERO_ADDR ? hook.slice(0, 6) + '...' + hook.slice(-4) : 'Not Set';
        if (hookStatusEl) hookStatusEl.textContent = hook && hook !== ZERO_ADDR ? 'Locked' : 'Not Set';
        if (hookItem) hookItem.className = 'config-item' + (hook && hook !== ZERO_ADDR ? ' completed' : ' needs-setup');

        // Vault
        const vaultEl = this._el.querySelector('[data-config-value="vault"]');
        const vaultStatusEl = this._el.querySelector('[data-config-status="vault"]');
        const vaultItem = this._el.querySelector('[data-config-item="vault"]');
        if (vaultEl) vaultEl.textContent = vault && vault !== ZERO_ADDR ? vault.slice(0, 6) + '...' + vault.slice(-4) : 'Not Set';
        if (vaultStatusEl) vaultStatusEl.textContent = vault && vault !== ZERO_ADDR ? 'Locked' : 'Not Set';
        if (vaultItem) vaultItem.className = 'config-item' + (vault && vault !== ZERO_ADDR ? ' completed' : ' needs-setup');

        // Bonding times
        const fmtDate = (ts) => {
            if (!ts || ts === '0') return 'Not Set';
            const d = new Date(parseInt(ts) * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
        };

        const openEl = this._el.querySelector('[data-config-value="open-time"]');
        const openStatusEl = this._el.querySelector('[data-config-status="open-time"]');
        const openItem = this._el.querySelector('[data-config-item="open-time"]');
        if (openEl) openEl.textContent = fmtDate(bondingStatus.openTime);
        const openSet = bondingStatus.openTime && bondingStatus.openTime !== '0';
        if (openStatusEl) openStatusEl.textContent = openSet ? 'Locked' : 'Not Set';
        if (openItem) openItem.className = 'config-item' + (openSet ? ' completed' : '');

        const maturityEl = this._el.querySelector('[data-config-value="maturity-time"]');
        const maturityStatusEl = this._el.querySelector('[data-config-status="maturity-time"]');
        if (maturityEl) maturityEl.textContent = fmtDate(bondingStatus.maturityTime);
        const maturitySet = bondingStatus.maturityTime && bondingStatus.maturityTime !== '0';
        if (maturityStatusEl) maturityStatusEl.textContent = maturitySet ? 'Set' : 'Not Set';

        // Staking
        const stakingStatusEl = this._el.querySelector('[data-config-status="staking"]');
        const stakingItem = this._el.querySelector('[data-config-item="staking"]');
        if (stakingStatusEl) stakingStatusEl.textContent = stakingEnabled ? 'Enabled' : 'Not Enabled';
        if (stakingItem) stakingItem.className = 'config-item' + (stakingEnabled ? ' completed' : ' needs-setup');

        const enableBtn = this._el.querySelector('[data-action="config-enable-staking"]');
        if (enableBtn) enableBtn.style.display = stakingEnabled ? 'none' : '';

        // Style
        const styleStatusEl = this._el.querySelector('[data-config-status="style"]');
        if (styleStatusEl) styleStatusEl.textContent = 'Editable';

    }

    // ── Actions ──

    async handleToggleBonding() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="toggle-bonding"]');

        try {
            const bondingStatus = await this.adapter.getBondingStatus();
            const isActive = bondingStatus.bondingActive !== false;
            if (btn) btn.textContent = isActive ? 'Pausing...' : 'Resuming...';
            const tx = await this.adapter.setBondingActive(!isActive);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Toggle bonding failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => this.loadData(), 3000);
        }
    }

    async handleDeployLiquidity() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="deploy-liquidity"]');

        try {
            if (btn) btn.textContent = 'Deploying...';
            // Use default parameters — the contract handles defaults
            const tx = await this.adapter.deployLiquidity(3000, 60, 0, 0, 0);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Deploy Liquidity';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Deploy liquidity failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Deploy Liquidity'; }, 3000);
        }
    }

    async handleEnableStaking() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="overview-enable-staking"]')
            || this._el?.querySelector('[data-action="config-enable-staking"]');

        try {
            if (btn) btn.textContent = 'Enabling...';
            const tx = await this.adapter.enableStaking();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Enable staking failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Enable Staking'; }, 3000);
        }
    }

    async handleWithdrawDust() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="withdraw-dust"]');

        try {
            if (btn) btn.textContent = 'Withdrawing...';
            const tx = await this.adapter.withdrawDust(0);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Withdraw Dust';
        } catch (error) {
            console.error('[ERC404AdminModal] Withdraw dust failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Withdraw Dust'; }, 3000);
        }
    }

    // ── Configuration Actions ──

    async handleSetV4Hook() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="hook-address"]');
        const btn = this._el?.querySelector('[data-action="set-hook"]');
        const addr = input?.value?.trim();
        if (!addr) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const tx = await this.adapter.setV4Hook(addr);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (btn) btn.textContent = 'Set Hook';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Set V4 Hook failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Hook'; }, 3000);
        }
    }

    async handleSetVault() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="vault-address"]');
        const btn = this._el?.querySelector('[data-action="set-vault"]');
        const addr = input?.value?.trim();
        if (!addr) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const tx = await this.adapter.setVault(addr);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (btn) btn.textContent = 'Set Vault';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Set Vault failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Vault'; }, 3000);
        }
    }

    async handleSetOpenTime() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="open-time"]');
        const btn = this._el?.querySelector('[data-action="set-open-time"]');
        const val = input?.value;
        if (!val) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const timestamp = Math.floor(new Date(val).getTime() / 1000);
            const tx = await this.adapter.setBondingOpenTime(timestamp);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Set Time';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Set open time failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Time'; }, 3000);
        }
    }

    async handleSetMaturityTime() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="maturity-time"]');
        const btn = this._el?.querySelector('[data-action="set-maturity-time"]');
        const val = input?.value;
        if (!val) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const timestamp = Math.floor(new Date(val).getTime() / 1000);
            const tx = await this.adapter.setBondingMaturityTime(timestamp);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Set Time';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Set maturity time failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Time'; }, 3000);
        }
    }

    // ── Advanced Actions ──

    async handleTransferOwnership() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="transfer-address"]');
        const checkbox = this._el?.querySelector('[data-input="transfer-confirm"]');
        const btn = this._el?.querySelector('[data-action="transfer-ownership"]');
        const newOwner = input?.value?.trim();
        if (!newOwner || !checkbox?.checked) return;

        try {
            if (btn) btn.textContent = 'Transferring...';
            const tx = await this.adapter.transferOwnership(newOwner);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (checkbox) checkbox.checked = false;
            if (btn) btn.textContent = 'Transfer Ownership';
            this.close();
            eventBus.emit('erc404:admin:disabled');
        } catch (error) {
            console.error('[ERC404AdminModal] Transfer ownership failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Transfer Ownership'; }, 3000);
        }
    }

    async handleRenounceOwnership() {
        if (!this.adapter) return;
        const cb1 = this._el?.querySelector('[data-input="renounce-confirm-1"]');
        const cb2 = this._el?.querySelector('[data-input="renounce-confirm-2"]');
        const btn = this._el?.querySelector('[data-action="renounce-ownership"]');
        if (!cb1?.checked || !cb2?.checked) return;

        try {
            if (btn) btn.textContent = 'Renouncing...';
            const tx = await this.adapter.renounceOwnership();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Renounced';
            this.close();
            eventBus.emit('erc404:admin:disabled');
        } catch (error) {
            console.error('[ERC404AdminModal] Renounce ownership failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Renounce Ownership Forever'; }, 3000);
        }
    }

    // ── Render Helpers ──

    // ── Render ──

    render() {
        return h('div', { className: 'erc404-admin-modal' },
            h('div', { className: 'modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) this.close(); } },
                h('div', { className: 'modal' },
                    // Header
                    h('div', { className: 'modal-header' },
                        h('div', { className: 'modal-title' }, 'Project Administration'),
                        h('button', { className: 'modal-close', onClick: () => this.close() }, '\u00D7')
                    ),

                    // Tabs
                    h('div', { className: 'modal-tabs' },
                        h('button', {
                            className: 'modal-tab active',
                            'data-modal-tab': 'overview',
                            onClick: () => this.switchTab('overview')
                        }, 'Overview'),
                        h('button', {
                            className: 'modal-tab',
                            'data-modal-tab': 'configuration',
                            onClick: () => this.switchTab('configuration')
                        }, 'Configuration'),
                        h('button', {
                            className: 'modal-tab',
                            'data-modal-tab': 'advanced',
                            onClick: () => this.switchTab('advanced')
                        }, 'Advanced')
                    ),

                    // Body
                    h('div', { className: 'modal-body' },
                        // ── Overview Tab ──
                        h('div', { className: 'modal-tab-content active', 'data-modal-content': 'overview' },
                            // Bonding Status
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Bonding Status'),
                                h('span', { className: 'phase-badge', 'data-overview-phase': true, style: { marginBottom: 'var(--space-3)', display: 'inline-block' } }, 'Loading...'),

                                h('div', { className: 'progress-bar-container' },
                                    h('div', { className: 'progress-bar-label' },
                                        h('span', null, 'Supply Progress'),
                                        h('span', { 'data-overview-progress-label': true }, '—')
                                    ),
                                    h('div', { className: 'progress-bar' },
                                        h('div', { className: 'progress-bar-fill', 'data-overview-progress-fill': true, style: { width: '0%' } })
                                    )
                                ),

                                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)', marginTop: 'var(--space-3)' } },
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Reserve'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'reserve', style: { fontSize: 'var(--font-size-h4)' } }, '—')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Tokens Sold'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'sold', style: { fontSize: 'var(--font-size-h4)' } }, '—')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Open Time'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'open', style: { fontSize: 'var(--font-size-h4)' } }, '—')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Maturity Time'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'maturity', style: { fontSize: 'var(--font-size-h4)' } }, '—')
                                    )
                                ),

                                h('div', { style: { marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' } },
                                    h('button', {
                                        className: 'btn btn-secondary',
                                        'data-action': 'toggle-bonding',
                                        onClick: this.bind(this.handleToggleBonding)
                                    }, 'Pause Bonding'),
                                    h('button', {
                                        className: 'btn btn-secondary',
                                        'data-action': 'deploy-liquidity',
                                        onClick: this.bind(this.handleDeployLiquidity)
                                    }, 'Deploy Liquidity')
                                )
                            ),

                            // Staking Status
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Staking Status'),
                                h('div', { style: { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' } },
                                    h('div', { style: { fontSize: 'var(--font-size-body-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                        'Status: ',
                                        h('strong', { style: { color: 'var(--text-primary)' }, 'data-overview-staking-status': true }, 'Loading...')
                                    ),
                                    h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)' } },
                                        'Vault fees accrue to contract. Enable staking to distribute fees to stakers.'
                                    )
                                ),
                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'overview-enable-staking',
                                    onClick: this.bind(this.handleEnableStaking)
                                }, 'Enable Staking')
                            ),

                            // Withdraw Dust
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Withdraw Dust'),
                                h('button', {
                                    className: 'btn btn-secondary',
                                    'data-action': 'withdraw-dust',
                                    onClick: this.bind(this.handleWithdrawDust)
                                }, 'Withdraw Dust')
                            )
                        ),

                        // ── Configuration Tab ──
                        h('div', { className: 'modal-tab-content', 'data-modal-content': 'configuration' },
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Setup & Configuration'),

                                h('div', { className: 'config-items' },
                                    // V4 Hook
                                    h('div', { className: 'config-item', 'data-config-item': 'hook' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'V4 Hook'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'hook' }, '...')
                                        ),
                                        h('div', { className: 'config-item-value', 'data-config-value': 'hook' }, 'Loading...'),
                                        h('div', { style: { marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' } },
                                            h('input', {
                                                type: 'text',
                                                'data-input': 'hook-address',
                                                placeholder: '0x...',
                                                className: 'form-input',
                                                style: { flex: '1' }
                                            }),
                                            h('button', {
                                                className: 'btn btn-secondary',
                                                'data-action': 'set-hook',
                                                onClick: this.bind(this.handleSetV4Hook)
                                            }, 'Set Hook')
                                        )
                                    ),

                                    // Vault
                                    h('div', { className: 'config-item', 'data-config-item': 'vault' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'Vault'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'vault' }, '...')
                                        ),
                                        h('div', { className: 'config-item-value', 'data-config-value': 'vault' }, 'Loading...'),
                                        h('div', { style: { marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' } },
                                            h('input', {
                                                type: 'text',
                                                'data-input': 'vault-address',
                                                placeholder: '0x...',
                                                className: 'form-input',
                                                style: { flex: '1' }
                                            }),
                                            h('button', {
                                                className: 'btn btn-secondary',
                                                'data-action': 'set-vault',
                                                onClick: this.bind(this.handleSetVault)
                                            }, 'Set Vault')
                                        )
                                    ),

                                    // Bonding Open Time
                                    h('div', { className: 'config-item', 'data-config-item': 'open-time' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'Bonding Open Time'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'open-time' }, '...')
                                        ),
                                        h('div', { className: 'config-item-value', 'data-config-value': 'open-time' }, 'Loading...'),
                                        h('div', { style: { marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' } },
                                            h('input', {
                                                type: 'datetime-local',
                                                'data-input': 'open-time',
                                                className: 'form-input',
                                                style: { flex: '1' }
                                            }),
                                            h('button', {
                                                className: 'btn btn-secondary',
                                                'data-action': 'set-open-time',
                                                onClick: this.bind(this.handleSetOpenTime)
                                            }, 'Set Time')
                                        )
                                    ),

                                    // Bonding Maturity Time
                                    h('div', { className: 'config-item', 'data-config-item': 'maturity-time' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'Bonding Maturity Time'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'maturity-time' }, '...')
                                        ),
                                        h('div', { className: 'config-item-value', 'data-config-value': 'maturity-time' }, 'Loading...'),
                                        h('div', { style: { marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' } },
                                            h('input', {
                                                type: 'datetime-local',
                                                'data-input': 'maturity-time',
                                                className: 'form-input',
                                                style: { flex: '1' }
                                            }),
                                            h('button', {
                                                className: 'btn btn-secondary',
                                                'data-action': 'set-maturity-time',
                                                onClick: this.bind(this.handleSetMaturityTime)
                                            }, 'Set Time')
                                        )
                                    ),

                                    // Enable Staking
                                    h('div', { className: 'config-item needs-setup', 'data-config-item': 'staking' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'Enable Staking'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'staking' }, '...')
                                        ),
                                        h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', margin: 'var(--space-2) 0 var(--space-3)' } },
                                            'Once enabled, vault fees are distributed to stakers. This action is irreversible.'
                                        ),
                                        h('button', {
                                            className: 'btn btn-primary',
                                            'data-action': 'config-enable-staking',
                                            onClick: this.bind(this.handleEnableStaking)
                                        }, 'Enable Staking')
                                    ),

                                    // Style URI (with builder)
                                    h('div', { className: 'config-item', 'data-config-item': 'style' },
                                        h('div', { className: 'config-item-header' },
                                            h('div', { className: 'config-item-label' }, 'Style URI'),
                                            h('div', { className: 'config-item-status', 'data-config-status': 'style' }, 'Editable')
                                        ),
                                        h(StyleBuilder, {
                                            onSetStyle: (uri) => this.adapter.setStyle(uri),
                                            onGetStyle: () => this.adapter.getStyle(),
                                            onClearStyle: () => this.adapter.setStyle('')
                                        })
                                    )
                                )
                            )
                        ),

                        // ── Advanced Tab ──
                        h('div', { className: 'modal-tab-content', 'data-modal-content': 'advanced' },
                            // Transfer Ownership
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Transfer Ownership'),
                                h('p', { style: { fontSize: 'var(--font-size-body-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', lineHeight: 'var(--line-height-relaxed)' } },
                                    'Transfer ownership of this project to another address. The new owner will have full admin control.'
                                ),

                                h('div', { className: 'form-group' },
                                    h('label', { className: 'form-label' }, 'New Owner Address'),
                                    h('input', {
                                        type: 'text',
                                        className: 'form-input',
                                        placeholder: '0x...',
                                        'data-input': 'transfer-address'
                                    })
                                ),

                                h('div', { className: 'checkbox-row' },
                                    h('input', { type: 'checkbox', 'data-input': 'transfer-confirm' }),
                                    h('label', null, 'I understand that transferring ownership will immediately revoke my admin access.')
                                ),

                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'transfer-ownership',
                                    onClick: this.bind(this.handleTransferOwnership)
                                }, 'Transfer Ownership')
                            ),

                            // Renounce Ownership
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Renounce Ownership'),
                                h('p', { style: { fontSize: 'var(--font-size-body-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', lineHeight: 'var(--line-height-relaxed)' } },
                                    'Permanently renounce ownership of this project. This action cannot be undone.'
                                ),

                                h('div', { className: 'warning-list' },
                                    h('ul', null,
                                        h('li', null, 'You will lose all admin access permanently'),
                                        h('li', null, 'No one will be able to manage this project'),
                                        h('li', null, 'Configuration items will be locked forever'),
                                        h('li', null, 'This action is irreversible')
                                    )
                                ),

                                h('div', { className: 'checkbox-row' },
                                    h('input', { type: 'checkbox', 'data-input': 'renounce-confirm-1' }),
                                    h('label', null, 'I understand that renouncing ownership is permanent and irreversible.')
                                ),

                                h('div', { className: 'checkbox-row' },
                                    h('input', { type: 'checkbox', 'data-input': 'renounce-confirm-2' }),
                                    h('label', null, 'I understand that no one will be able to manage this project after renouncing ownership.')
                                ),

                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'renounce-ownership',
                                    style: { backgroundColor: '#ff0000', borderColor: '#ff0000' },
                                    onClick: this.bind(this.handleRenounceOwnership)
                                }, 'Renounce Ownership Forever')
                            )
                        )
                    )
                )
            )
        );
    }
}

export default ERC404AdminModal;
