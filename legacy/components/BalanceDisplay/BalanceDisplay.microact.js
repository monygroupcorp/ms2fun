/**
 * BalanceDisplay - Microact Version
 *
 * Displays user ETH and token balances from tradingStore.
 * Migrated from template literals to h() hyperscript.
 */

import { Component, h } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export default class BalanceDisplay extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
    }

    didMount() {
        // Subscribe to store changes with auto-cleanup
        const unsubscribe = this.store.subscribe(() => {
            this._update();
        });
        this.registerCleanup(unsubscribe);

        // Subscribe to balance update events
        this.subscribe('balanceUpdate', () => {
            this._update();
        });
    }

    render() {
        const balances = this.store.selectBalances();
        const status = this.store.selectStatus();

        const className = [
            'balance-display',
            'marble-bg',
            status.loading ? 'loading' : '',
            status.error ? 'error' : ''
        ].filter(Boolean).join(' ');

        return h('div', { className },
            // Header
            h('div', { className: 'balance-header' },
                h('h3', null, 'Your Balances'),
                balances.lastUpdated &&
                    h('span', { className: 'last-updated' },
                        `Last updated: ${new Date(balances.lastUpdated).toLocaleTimeString()}`
                    )
            ),

            // Content
            h('div', { className: 'balance-content' },
                this.renderContent(balances, status)
            )
        );
    }

    renderContent(balances, status) {
        if (status.loading) {
            return h('div', { className: 'loading-indicator' }, 'Loading balances...');
        }

        if (status.error) {
            return h('div', { className: 'error-message' }, status.error);
        }

        return h('div', { className: 'balance-grid' },
            h('div', { className: 'balance-item eth' },
                h('span', { className: 'label' }, 'ETH Balance'),
                h('span', { className: 'amount' }, balances.eth)
            ),
            h('div', { className: 'balance-item exec' },
                h('span', { className: 'label' }, 'EXEC Balance'),
                h('span', { className: 'amount' }, balances.exec)
            )
        );
    }
}
