/**
 * ERC404AdminModal - Tabbed admin settings modal
 *
 * Two tabs: Project Controls, Advanced.
 * Opens via erc404:admin:open event.
 *
 * Maps 1:1 to ERC404BondingInstance.sol onlyOwner functions:
 *   - setBondingOpenTime, setBondingMaturityTime, setStyle,
 *     migrateVault, activateStaking, claimAllFees,
 *     transferOwnership, renounceOwnership
 * Plus permissionless: deployLiquidity
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { StyleBuilder } from '../shared/StyleBuilder.microact.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';

// Phase 0=Pre-Open, 1=Scheduled(active+openTime future), 2=Bonding Active(openTime passed), 3=Matured, 4=Deployed
const PHASE_LABELS = ['Pre-Open', 'Scheduled', 'Bonding Active', 'Matured', 'Deployed'];
const PHASE_CLASSES = ['pre-open', 'scheduled', 'bonding', 'matured', 'deployed'];

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

    // ── Error Notification ──

    showError(message) {
        const popup = new MessagePopup();
        popup.error(message, 'Transaction Failed');
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
            const [bondingStatus, stakingEnabled, nftBaseURI] = await Promise.all([
                this.adapter.getBondingStatus(),
                this.adapter.stakingEnabled(),
                this.adapter.metadataURI().catch(() => '')
            ]);

            this.updateControlsDOM(bondingStatus, stakingEnabled);
            this.updateAdvancedDOM(bondingStatus, stakingEnabled);
            this.updateMetadataDOM(nftBaseURI);
        } catch (error) {
            console.warn('[ERC404AdminModal] Failed to load data:', error);
        }
    }

    updateControlsDOM(bondingStatus, stakingEnabled) {
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

        // currentReserve is already ETH-formatted (string like "0.0") from getBondingStatus
        const reserve = parseFloat(bondingStatus.currentReserve || '0');
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

        // Hide "Open Bonding" section once bonding is open
        const openBondingSection = this._el.querySelector('[data-section="open-bonding"]');
        if (openBondingSection) {
            const isAlreadyOpen = bondingStatus.openTime && bondingStatus.openTime !== '0'
                && parseInt(bondingStatus.openTime) * 1000 <= Date.now();
            openBondingSection.style.display = isAlreadyOpen ? 'none' : '';
        }

        // Deploy liquidity button
        const deployBtn = this._el.querySelector('[data-action="deploy-liquidity"]');
        if (deployBtn) {
            const phase = bondingStatus.currentPhase || 0;
            deployBtn.disabled = phase < 3;
        }
    }

    updateAdvancedDOM(bondingStatus, stakingEnabled) {
        if (!this._el) return;

        const fmtDate = (ts) => {
            if (!ts || ts === '0') return 'Not Set';
            const d = new Date(parseInt(ts) * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
        };

        // Open time
        const openEl = this._el.querySelector('[data-config-value="open-time"]');
        if (openEl) openEl.textContent = fmtDate(bondingStatus.openTime);
        const openPast = bondingStatus.openTime && bondingStatus.openTime !== '0' && parseInt(bondingStatus.openTime) * 1000 < Date.now();
        const openInput = this._el.querySelector('[data-input="open-time"]');
        const openBtn = this._el.querySelector('[data-action="set-open-time"]');
        if (openPast) {
            if (openInput) openInput.disabled = true;
            if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'Already Passed'; }
        }

        // Maturity time
        const maturityEl = this._el.querySelector('[data-config-value="maturity-time"]');
        if (maturityEl) maturityEl.textContent = fmtDate(bondingStatus.maturityTime);
        const maturityPast = bondingStatus.maturityTime && bondingStatus.maturityTime !== '0' && parseInt(bondingStatus.maturityTime) * 1000 < Date.now();
        const maturityInput = this._el.querySelector('[data-input="maturity-time"]');
        const maturityBtn = this._el.querySelector('[data-action="set-maturity-time"]');
        if (maturityPast) {
            if (maturityInput) maturityInput.disabled = true;
            if (maturityBtn) { maturityBtn.disabled = true; maturityBtn.textContent = 'Already Passed'; }
        }

        // Staking
        const stakingStatusEl = this._el.querySelector('[data-config-status="staking"]');
        if (stakingStatusEl) stakingStatusEl.textContent = stakingEnabled ? 'Active' : 'Not Active';
        const stakingBtn = this._el.querySelector('[data-action="activate-staking"]');
        if (stakingBtn) stakingBtn.style.display = stakingEnabled ? 'none' : '';
        const stakingNote = this._el.querySelector('[data-staking-note]');
        if (stakingNote) stakingNote.textContent = stakingEnabled
            ? 'Staking is active. Fees from claimAllFees are routed to stakers.'
            : 'Once activated, vault fees are distributed to token stakers. This cannot be undone.';
    }

    updateMetadataDOM(nftBaseURI) {
        if (!this._el) return;

        // Pre-fill NFT base URI
        const nftInput = this._el.querySelector('[data-input="nft-base-uri"]');
        if (nftInput && nftBaseURI) nftInput.value = nftBaseURI;
        const nftCurrent = this._el.querySelector('[data-current-value="nft-base-uri"]');
        if (nftCurrent) nftCurrent.textContent = nftBaseURI
            ? (nftBaseURI.length > 50 ? nftBaseURI.slice(0, 50) + '...' : nftBaseURI)
            : 'Not set';

        // Pre-fill project metadata fields from projectData metadataURI
        const metaURI = this.props.projectData?.metadataURI || '';
        let parsed = null;
        try {
            if (metaURI.startsWith('data:application/json,')) {
                parsed = JSON.parse(decodeURIComponent(metaURI.slice('data:application/json,'.length)));
            } else if (metaURI.startsWith('data:application/json;base64,')) {
                parsed = JSON.parse(atob(metaURI.slice('data:application/json;base64,'.length)));
            }
        } catch (e) { /* ignore */ }

        if (parsed) {
            const setVal = (sel, val) => {
                const el = this._el.querySelector(sel);
                if (el && val) el.value = val;
            };
            setVal('[data-input="meta-image"]', parsed.project_photo);
            setVal('[data-input="meta-banner"]', parsed.project_banner);
            setVal('[data-input="meta-description"]', parsed.description);
        }

        const metaCurrent = this._el.querySelector('[data-current-value="meta-uri"]');
        if (metaCurrent) metaCurrent.textContent = metaURI
            ? (metaURI.length > 50 ? metaURI.slice(0, 50) + '...' : metaURI)
            : 'Not set';
    }

    // ── Actions ──

    async handleOpenBondingNow() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="open-bonding-now"]');

        try {
            // Check if open time is already set — if so, skip setBondingOpenTime (saves 1 tx)
            const status = await this.adapter.getBondingStatus();
            const openTimeAlreadySet = status.openTime && status.openTime !== '0';

            if (!openTimeAlreadySet) {
                // Contract requires open time before setBondingActive — set to now + 60s
                // (Sepolia block time ~12s + getBondingStatus call time; 10s was too tight)
                if (btn) btn.textContent = 'Setting time... (1/2)';
                const openTimestamp = Math.floor(Date.now() / 1000) + 60;
                const tx1 = await this.adapter.setBondingOpenTime(openTimestamp);
                if (tx1 && typeof tx1.wait === 'function') await tx1.wait();
            }

            if (btn) btn.textContent = openTimeAlreadySet ? 'Activating...' : 'Activating... (2/2)';
            const tx2 = await this.adapter.setBondingActive(true);
            if (tx2 && typeof tx2.wait === 'function') await tx2.wait();

            if (btn) btn.textContent = 'Bonding Opened';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Open bonding failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Open Bonding Now'; }, 3000);
        }
    }

    async handleClaimFees() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="claim-fees"]');

        try {
            if (btn) btn.textContent = 'Claiming...';
            const tx = await this.adapter.claimAllFees();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Claim Fees';
        } catch (error) {
            console.error('[ERC404AdminModal] Claim fees failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Claim Fees'; }, 3000);
        }
    }

    async handleDeployLiquidity() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="deploy-liquidity"]');

        try {
            if (btn) btn.textContent = 'Deploying...';
            const tx = await this.adapter.deployLiquidity(3000, 60, 0, 0, 0);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Deploy Liquidity';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Deploy liquidity failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Deploy Liquidity'; }, 3000);
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
            this.showError(error.message || 'Transaction failed');
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
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Time'; }, 3000);
        }
    }

    async handleActivateStaking() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="activate-staking"]');

        try {
            if (btn) btn.textContent = 'Activating...';
            const tx = await this.adapter.activateStaking();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Activate staking failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Activate Staking'; }, 3000);
        }
    }

    async handleMigrateVault() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="vault-address"]');
        const btn = this._el?.querySelector('[data-action="migrate-vault"]');
        const addr = input?.value?.trim();
        if (!addr) return;

        try {
            if (btn) btn.textContent = 'Migrating...';
            const tx = await this.adapter.migrateVault(addr);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (btn) btn.textContent = 'Migrate Vault';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Migrate vault failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Migrate Vault'; }, 3000);
        }
    }

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
            this.showError(error.message || 'Transaction failed');
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
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Renounce Ownership Forever'; }, 3000);
        }
    }

    async handleUpdateProjectMetadata() {
        const masterAdapter = this.props.masterAdapter;
        const instanceAddress = this.props.instanceAddress;
        if (!masterAdapter || !instanceAddress) return;
        const btn = this._el?.querySelector('[data-action="update-project-meta"]');

        const image = this._el?.querySelector('[data-input="meta-image"]')?.value?.trim() || '';
        const banner = this._el?.querySelector('[data-input="meta-banner"]')?.value?.trim() || '';
        const description = this._el?.querySelector('[data-input="meta-description"]')?.value?.trim() || '';
        const rawUri = this._el?.querySelector('[data-input="meta-uri"]')?.value?.trim() || '';

        let uri = rawUri;
        if (!uri) {
            const obj = {};
            if (image) obj.project_photo = image;
            if (banner) obj.project_banner = banner;
            if (description) obj.description = description;
            if (Object.keys(obj).length === 0) return;
            uri = 'data:application/json,' + encodeURIComponent(JSON.stringify(obj));
        }

        try {
            if (btn) btn.textContent = 'Updating...';
            const tx = await masterAdapter.updateInstanceMetadata(instanceAddress, uri);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Update Project';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Update project metadata failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Update Project'; }, 3000);
        }
    }

    async handleSetNFTBaseURI() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="nft-base-uri"]');
        const btn = this._el?.querySelector('[data-action="set-nft-base-uri"]');
        const uri = input?.value?.trim();
        if (!uri) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const tx = await this.adapter.setMetadataURI(uri);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Set Base URI';
            await this.loadData();
        } catch (error) {
            console.error('[ERC404AdminModal] Set NFT base URI failed:', error);
            this.showError(error.message || 'Transaction failed');
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Set Base URI'; }, 3000);
        }
    }

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
                            'data-modal-tab': 'controls',
                            onClick: () => this.switchTab('controls')
                        }, 'Project Controls'),
                        h('button', {
                            className: 'modal-tab',
                            'data-modal-tab': 'advanced',
                            onClick: () => this.switchTab('advanced')
                        }, 'Advanced')
                    ),

                    // Body
                    h('div', { className: 'modal-body' },
                        // ── Project Controls Tab ──
                        h('div', { className: 'modal-tab-content active', 'data-modal-content': 'controls' },
                            // Bonding Status
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Bonding Status'),
                                h('span', { className: 'phase-badge', 'data-overview-phase': true, style: { marginBottom: 'var(--space-3)', display: 'inline-block' } }, 'Loading...'),

                                h('div', { className: 'progress-bar-container' },
                                    h('div', { className: 'progress-bar-label' },
                                        h('span', null, 'Supply Progress'),
                                        h('span', { 'data-overview-progress-label': true }, '\u2014')
                                    ),
                                    h('div', { className: 'progress-bar' },
                                        h('div', { className: 'progress-bar-fill', 'data-overview-progress-fill': true, style: { width: '0%' } })
                                    )
                                ),

                                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)', marginTop: 'var(--space-3)' } },
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Reserve'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'reserve', style: { fontSize: 'var(--font-size-h4)' } }, '\u2014')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Tokens Sold'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'sold', style: { fontSize: 'var(--font-size-h4)' } }, '\u2014')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Open Time'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'open', style: { fontSize: 'var(--font-size-h4)' } }, '\u2014')
                                    ),
                                    h('div', null,
                                        h('div', { className: 'admin-stat-label' }, 'Maturity Time'),
                                        h('div', { className: 'admin-stat-value', 'data-overview-stat': 'maturity', style: { fontSize: 'var(--font-size-h4)' } }, '\u2014')
                                    )
                                )
                            ),

                            // Open Bonding
                            h('div', { className: 'modal-section', 'data-section': 'open-bonding' },
                                h('div', { className: 'modal-section-title' }, 'Open Bonding'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } },
                                    'Start the bonding curve now so collectors can buy. To schedule a future date/time, use the Advanced tab.'
                                ),
                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'open-bonding-now',
                                    onClick: this.bind(this.handleOpenBondingNow)
                                }, 'Open Bonding Now')
                            ),

                            // Claim Fees
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Fees'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } },
                                    'Claim accumulated fees from alignment vaults. If staking is active, fees are routed to the staking module for distribution to stakers.'
                                ),
                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'claim-fees',
                                    onClick: this.bind(this.handleClaimFees)
                                }, 'Claim Fees')
                            ),

                            // Deploy Liquidity
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Deploy Liquidity'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } },
                                    'Deploy the bonding curve reserve to Uniswap V4. Available after maturity time passes. Anyone can call this \u2014 it\'s permissionless.'
                                ),
                                h('button', {
                                    className: 'btn btn-secondary',
                                    'data-action': 'deploy-liquidity',
                                    disabled: true,
                                    onClick: this.bind(this.handleDeployLiquidity)
                                }, 'Deploy Liquidity')
                            ),

                            // Edit Project
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Edit Project'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'Current: ',
                                    h('span', { 'data-current-value': 'meta-uri', style: { fontFamily: 'var(--font-mono)' } }, 'Loading...')
                                ),
                                h('div', { className: 'form-group' },
                                    h('label', { className: 'form-label' }, 'Project Image'),
                                    h('input', { type: 'text', className: 'form-input', 'data-input': 'meta-image', placeholder: 'https://... or ipfs://...' })
                                ),
                                h('div', { className: 'form-group' },
                                    h('label', { className: 'form-label' }, 'Project Banner'),
                                    h('input', { type: 'text', className: 'form-input', 'data-input': 'meta-banner', placeholder: 'https://... or ipfs://... (wide, landscape ratio)' })
                                ),
                                h('div', { className: 'form-group' },
                                    h('label', { className: 'form-label' }, 'Description'),
                                    h('textarea', { className: 'form-input', 'data-input': 'meta-description', rows: '3', placeholder: 'Short description shown on the homepage and discovery feed.' })
                                ),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'Or paste a URI directly (IPFS, HTTPS, Arweave, or data:application/json):'
                                ),
                                h('div', { style: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' } },
                                    h('input', { type: 'text', className: 'form-input', 'data-input': 'meta-uri', placeholder: 'ipfs://... or data:application/json,...', style: { flex: '1' } })
                                ),
                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'update-project-meta',
                                    onClick: this.bind(this.handleUpdateProjectMetadata)
                                }, 'Update Project')
                            ),

                            // Edit NFT Metadata
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Edit NFT Metadata'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'Current: ',
                                    h('span', { 'data-current-value': 'nft-base-uri', style: { fontFamily: 'var(--font-mono)' } }, 'Loading...')
                                ),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } },
                                    'Base path for NFT token metadata. tokenURI(id) returns this + the token number. Leave blank until your collection art is ready.'
                                ),
                                h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
                                    h('input', {
                                        type: 'text',
                                        className: 'form-input',
                                        'data-input': 'nft-base-uri',
                                        placeholder: 'ipfs://Qm.../ or https://api.myproject.com/metadata/',
                                        style: { flex: '1' }
                                    }),
                                    h('button', {
                                        className: 'btn btn-secondary',
                                        'data-action': 'set-nft-base-uri',
                                        onClick: this.bind(this.handleSetNFTBaseURI)
                                    }, 'Set Base URI')
                                )
                            ),

                            // Style
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Project Style'),
                                h(StyleBuilder, {
                                    onSetStyle: (uri) => this.adapter.setStyle(uri),
                                    onGetStyle: () => this.adapter.styleUri(),
                                    onClearStyle: () => this.adapter.setStyle('')
                                })
                            )
                        ),

                        // ── Advanced Tab ──
                        h('div', { className: 'modal-tab-content', 'data-modal-content': 'advanced' },
                            // Bonding Open Time
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Bonding Open Time'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'When the bonding curve becomes available for trading. Must be in the future.'
                                ),
                                h('div', { className: 'config-item-value', 'data-config-value': 'open-time', style: { marginBottom: 'var(--space-2)' } }, 'Loading...'),
                                h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
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
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Bonding Maturity Time'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'When the bonding curve matures and deployLiquidity becomes callable. Must be after open time.'
                                ),
                                h('div', { className: 'config-item-value', 'data-config-value': 'maturity-time', style: { marginBottom: 'var(--space-2)' } }, 'Loading...'),
                                h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
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

                            // Activate Staking
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Staking'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' } },
                                    'Status: ',
                                    h('strong', { 'data-config-status': 'staking' }, 'Loading...')
                                ),
                                h('div', {
                                    'data-staking-note': true,
                                    style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }
                                }, 'Once activated, vault fees are distributed to token stakers. This cannot be undone.'),
                                h('button', {
                                    className: 'btn btn-primary',
                                    'data-action': 'activate-staking',
                                    onClick: this.bind(this.handleActivateStaking)
                                }, 'Activate Staking')
                            ),

                            // Migrate Vault
                            h('div', { className: 'modal-section' },
                                h('div', { className: 'modal-section-title' }, 'Migrate Vault'),
                                h('div', { style: { fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } },
                                    'Move to a different alignment vault. This updates the vault reference on this contract and in the master registry.'
                                ),
                                h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
                                    h('input', {
                                        type: 'text',
                                        'data-input': 'vault-address',
                                        placeholder: '0x...',
                                        className: 'form-input',
                                        style: { flex: '1' }
                                    }),
                                    h('button', {
                                        className: 'btn btn-secondary',
                                        'data-action': 'migrate-vault',
                                        onClick: this.bind(this.handleMigrateVault)
                                    }, 'Migrate Vault')
                                )
                            ),

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
                                        h('li', null, 'Open time, maturity time, and staking cannot be changed'),
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
