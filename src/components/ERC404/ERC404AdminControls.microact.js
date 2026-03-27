/**
 * ERC404AdminControls - Inline admin stats section
 *
 * Shows bonding status, phase badge, progress bar, and 6-stat grid.
 * Hidden by default, shown via DOM when ownership confirmed.
 * Matches docs/examples/project-erc404-admin-demo.html admin-controls section.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

const PHASE_LABELS = ['Pre-Open', 'Bonding Active', 'Full', 'Matured', 'Deployed'];
const PHASE_CLASSES = ['pre-open', 'bonding', 'full', 'matured', 'deployed'];

export class ERC404AdminControls extends Component {
    constructor(props = {}) {
        super(props);
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('transaction:success', () => this.loadData());
        const unsub2 = eventBus.on('erc1155:mint:success', () => this.loadData());
        this.registerCleanup(() => { unsub1(); unsub2(); });
    }

    shouldUpdate() {
        return false;
    }

    async loadData() {
        if (!this.adapter) return;

        try {
            const [bondingStatus, stakingEnabled] = await Promise.all([
                this.adapter.getBondingStatus(),
                this.adapter.stakingEnabled()
            ]);

            this.updateDOM(bondingStatus, stakingEnabled);
        } catch (error) {
            console.warn('[ERC404AdminControls] Failed to load data:', error);
        }
    }

    updateDOM(bondingStatus, stakingEnabled) {
        if (!this._el) return;

        // Phase badge
        const badge = this._el.querySelector('[data-admin-phase]');
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

        const fill = this._el.querySelector('[data-admin-progress-fill]');
        if (fill) fill.style.width = pctStr + '%';

        const label = this._el.querySelector('[data-admin-progress-label]');
        if (label) {
            const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
            label.textContent = `${fmt(currentSupply)} / ${fmt(maxSupply)} Tokens (${pctStr}%)`;
        }

        // Stats
        const setValue = (key, val) => {
            const el = this._el.querySelector(`[data-admin-stat="${key}"]`);
            if (el) el.textContent = val;
        };

        // currentReserve is already ETH-formatted (string like "0.0" or "1.234") from getBondingStatus
        const reserve = parseFloat(bondingStatus.currentReserve || '0');
        setValue('reserve', reserve < 0.01 && reserve > 0 ? reserve.toFixed(4) : reserve.toFixed(2));

        const fmtSupply = (n) => {
            const v = parseFloat(n || '0');
            return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0);
        };
        setValue('sold', fmtSupply(bondingStatus.currentSupply));
        setValue('available', fmtSupply(bondingStatus.availableSupply));

        const fmtDate = (ts) => {
            if (!ts || ts === '0') return 'Not Set';
            const d = new Date(parseInt(ts) * 1000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };
        setValue('open', fmtDate(bondingStatus.openTime));
        setValue('maturity', fmtDate(bondingStatus.maturityTime));
        setValue('staking', stakingEnabled ? 'Enabled' : 'Disabled');
    }

    render() {
        return h('div', { className: 'admin-controls', style: { display: 'none' } },
            h('div', { className: 'admin-section-title' }, 'Bonding Status'),
            h('span', { className: 'phase-badge', 'data-admin-phase': true }, 'Loading...'),

            h('div', { className: 'progress-bar-container' },
                h('div', { className: 'progress-bar-label' },
                    h('span', null, 'Supply Progress'),
                    h('span', { 'data-admin-progress-label': true }, '— / — Tokens')
                ),
                h('div', { className: 'progress-bar' },
                    h('div', { className: 'progress-bar-fill', 'data-admin-progress-fill': true, style: { width: '0%' } })
                )
            ),

            h('div', { className: 'admin-stats-grid' },
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Reserve (ETH)'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'reserve' }, '—')
                ),
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Tokens Sold'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'sold' }, '—')
                ),
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Available'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'available' }, '—')
                ),
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Open Time'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'open' }, '—')
                ),
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Maturity'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'maturity' }, '—')
                ),
                h('div', { className: 'admin-stat' },
                    h('div', { className: 'admin-stat-label' }, 'Staking'),
                    h('div', { className: 'admin-stat-value', 'data-admin-stat': 'staking' }, '—')
                )
            )
        );
    }
}

export default ERC404AdminControls;
