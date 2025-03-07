import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import priceService from '../../services/PriceService.js';
import { eventBus } from '../../core/EventBus.js';

// Add event name constants
const EVENTS = {
    UPDATE: {
        PRICE: 'price:updated',
        STATUS: 'price:status'
    }
};

export default class PriceDisplay extends Component {
    constructor() {
        super();
        this.state = {
            price: 0,
            lastUpdated: null,
            loading: false,
            error: null
        };
        
        // Bind methods
        this.handlePriceUpdate = this.handlePriceUpdate.bind(this);
        this.handleStatusUpdate = this.handleStatusUpdate.bind(this);
    }

    onMount() {
        // Subscribe to trading store changes
        this.unsubscribeStore = tradingStore.subscribe(() => {
            const priceData = tradingStore.selectPrice();
            
            this.setState({
                price: priceData.current,
                lastUpdated: priceData.lastUpdated,
                loading: tradingStore.state.loading,
                error: tradingStore.state.error
            });
        });

        // Subscribe to events
        eventBus.on('price:updated', this.handlePriceUpdate);
        eventBus.on(EVENTS.UPDATE.STATUS, this.handleStatusUpdate);
    }

    onUnmount() {
        // Cleanup store subscription
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
        }

        // Cleanup event subscriptions
        eventBus.off('price:updated', this.handlePriceUpdate);
        eventBus.off(EVENTS.UPDATE.STATUS, this.handleStatusUpdate);
    }

    handlePriceUpdate({ price }) {
        this.update();  // This will trigger a re-render
        // The actual price data will come from tradingStore during render
    }

    handleStatusUpdate({ loading, error }) {
        this.update();  // This will trigger a re-render
        // The status data will come from tradingStore during render
    }

    template() {
        const { price, lastUpdated, loading, error } = this.state;
        
        if (loading) return `<div>Loading...</div>`;
        if (error) return `<div>Error: ${error}</div>`;
        
        return `
            <div class="price-display ${loading ? 'loading' : ''} ${error ? 'error' : ''}">
                <div class="price-header">
                    <h3>Cult Exec </h3>
                    <h3>Bonding Curve Presale</h3>
                </div>
                
                <div class="price-content">
                    ${loading ? `
                        <div class="loading-indicator">Loading...</div>
                    ` : error ? `
                        <div class="error-message">${error}</div>
                    ` : `
                        <div class="price-value">
                            <span class="amount">${Number(price).toFixed(4)}</span>
                            <span class="currency">ETH / Cult Exec</span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    render() {
        return this.template();
    }

    // Add component styles
    static get styles() {
        return `
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
                color: #FFD700;
                font-size: 16px;
            }

            .last-updated {
                color: #666;
                font-size: 12px;
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
                color: #FFD700;
            }

            .loading-indicator {
                color: #666;
                font-style: italic;
            }

            .error-message {
                color: #ff4444;
                font-size: 14px;
            }

            /* Loading state animation */
            .price-display.loading .price-content {
                opacity: 0.7;
            }

            .price-display.loading .loading-indicator:after {
                content: '';
                animation: loading-dots 1.5s infinite;
            }

            @keyframes loading-dots {
                0% { content: '.'; }
                33% { content: '..'; }
                66% { content: '...'; }
            }

            /* Error state styles */
            .price-display.error {
                border: 1px solid #ff4444;
            }

            /* Mobile responsive styles */
            @media (max-width: 768px) {
                .price-display {
                    margin: 8px;
                    padding: 12px;
                }

                .price-header {
                    flex-direction: column;
                    align-items: flex-start;
                }

                .last-updated {
                    margin-top: 4px;
                }

                .price-value {
                    font-size: 20px;
                }
            }
        `;
    }
} 