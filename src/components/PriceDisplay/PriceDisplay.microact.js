/**
 * PriceDisplay - Microact Version
 *
 * Displays current price from tradingStore.
 * Migrated from template literals to h() hyperscript.
 */

import { Component, h } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

const EVENTS = {
    UPDATE: {
        PRICE: 'price:updated',
        STATUS: 'price:status'
    }
};

export default class PriceDisplay extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            price: 0,
            lastUpdated: null,
            loading: true,
            error: null
        };
    }

    didMount() {
        // Get initial price state
        const priceData = tradingStore.selectPrice();

        this.setState({
            price: priceData?.current || 0,
            lastUpdated: priceData?.lastUpdated,
            loading: !priceData?.current,
            error: null
        });

        // Subscribe to trading store changes
        const unsubscribe = tradingStore.subscribe(() => {
            const priceData = tradingStore.selectPrice();
            this.setState({
                price: priceData?.current || 0,
                lastUpdated: priceData?.lastUpdated,
                loading: tradingStore.state.loading,
                error: tradingStore.state.error
            });
        });
        this.registerCleanup(unsubscribe);

        // Subscribe to price events
        this.subscribe(EVENTS.UPDATE.PRICE, ({ price }) => {
            this.setState({ price: price || 0, loading: false });
        });

        this.subscribe(EVENTS.UPDATE.STATUS, ({ loading, error }) => {
            this.setState({ loading, error });
        });
    }

    render() {
        const { price, lastUpdated, loading, error } = this.state;

        if (loading) {
            return this.renderContainer('loading',
                h('div', { className: 'price-content' },
                    h('div', { className: 'loading-indicator' }, 'Loading...')
                )
            );
        }

        if (error) {
            return this.renderContainer('error',
                h('div', { className: 'price-content' },
                    h('div', { className: 'error-message' }, `Error: ${error}`)
                )
            );
        }

        return this.renderContainer('',
            h('div', { className: 'price-content' },
                h('div', { className: 'price-value' },
                    h('span', { className: 'amount' }, Number(price).toFixed(8)),
                    h('span', { className: 'currency' }, 'ETH / Cult Exec')
                )
            )
        );
    }

    renderContainer(modifier, content) {
        const className = ['price-display', 'marble-bg', modifier].filter(Boolean).join(' ');

        return h('div', { className },
            h('div', { className: 'price-header' },
                h('h3', null, 'Cult Exec '),
                h('h3', null, 'Bonding Curve Presale')
            ),
            content
        );
    }
}

// Static styles (can be extracted to CSS file)
PriceDisplay.styles = `
    .price-display {
        background: #1a1a1a;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .price-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }

    .price-header h3 {
        margin: 0;
        color: var(--price-display-header-color, var(--color-text-primary, #333));
        font-size: 16px;
    }

    .price-content {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 48px;
    }

    .price-value {
        font-size: 24px;
        font-weight: bold;
        color: #fff;
    }

    .amount {
        margin-right: 8px;
    }

    .currency {
        color: var(--price-display-currency-color, var(--color-accent, #764ba2));
    }

    .loading-indicator {
        color: #666;
        font-style: italic;
    }

    .error-message {
        color: #ff4444;
        font-size: 14px;
    }

    .price-display.loading .price-content {
        opacity: 0.7;
    }

    .price-display.error {
        border: 1px solid #ff4444;
    }
`;

export { PriceDisplay };
