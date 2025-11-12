import {Component} from '../../core/Component.js';
import BlockchainService from '../../services/BlockchainService.js';
import {eventBus} from '../../core/EventBus.js';
import { debounce } from '../../utils/helper.js';
import { tradingStore } from '../../store/tradingStore.js';

export default class BalanceDisplay extends Component {
    constructor(rootElement) {
        super(rootElement);
        
        this.store = tradingStore;
        
        // Bind methods
        this.handleBalanceUpdate = this.handleBalanceUpdate.bind(this);
    }

    template() {
        const balances = this.store.selectBalances();
        const status = this.store.selectStatus();
        
        return `
            <div class="balance-display marble-bg ${status.loading ? 'loading' : ''} ${status.error ? 'error' : ''}">
                <div class="balance-header">
                    <h3>Your Balances</h3>
                    ${balances.lastUpdated ? `
                        <span class="last-updated">
                            Last updated: ${new Date(balances.lastUpdated).toLocaleTimeString()}
                        </span>
                    ` : ''}
                </div>
                
                <div class="balance-content">
                    ${status.loading ? `
                        <div class="loading-indicator">Loading balances...</div>
                    ` : status.error ? `
                        <div class="error-message">${status.error}</div>
                    ` : `
                        <div class="balance-grid">
                            <div class="balance-item eth">
                                <span class="label">ETH Balance</span>
                                <span class="amount">${balances.eth}</span>
                            </div>
                            <div class="balance-item exec">
                                <span class="label">EXEC Balance</span>
                                <span class="amount">${balances.exec}</span>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    render() {
        return this.template();
    }

    onMount() {
        // Subscribe to store changes
        this.unsubscribeStore = this.store.subscribe(() => this.update());
        
        // Subscribe to balance updates
        this.unsubscribeEvents = [
            eventBus.on('balanceUpdate', this.handleBalanceUpdate)
        ];
    }

    onUnmount() {
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
        }
        if (this.unsubscribeEvents) {
            this.unsubscribeEvents.forEach(unsubscribe => unsubscribe());
        }
    }

    handleBalanceUpdate(balances) {
        // Just update the display when balances change
        this.update();
    }
} 