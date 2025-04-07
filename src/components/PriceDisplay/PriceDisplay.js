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
            loading: true,
            error: null
        };
        
        this.handlePriceUpdate = this.handlePriceUpdate.bind(this);
        this.handleStatusUpdate = this.handleStatusUpdate.bind(this);
    }

    onMount() {
        // Get initial price state
        const priceData = tradingStore.selectPrice();
        
        this.setState({
            price: priceData?.current || 0,
            lastUpdated: priceData?.lastUpdated,
            loading: !priceData?.current,
            error: null
        });

        // Subscribe to trading store changes
        this.unsubscribeStore = tradingStore.subscribe(() => {
            const priceData = tradingStore.selectPrice();
            this.setState({
                price: priceData?.current || 0,
                lastUpdated: priceData?.lastUpdated,
                loading: tradingStore.state.loading,
                error: tradingStore.state.error
            });
        });

        eventBus.on(EVENTS.UPDATE.PRICE, this.handlePriceUpdate);
        eventBus.on(EVENTS.UPDATE.STATUS, this.handleStatusUpdate);
    }

    onUnmount() {
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
        }
        eventBus.off(EVENTS.UPDATE.PRICE, this.handlePriceUpdate);
        eventBus.off(EVENTS.UPDATE.STATUS, this.handleStatusUpdate);
    }

    setState(newState) {
        super.setState(newState);
    }

    handlePriceUpdate({ price }) {
        this.setState({
            price: price || 0,
            loading: false
        });
    }

    handleStatusUpdate({ loading, error }) {
        this.setState({ loading, error });
    }

    template() {
        const { price, lastUpdated, loading, error } = this.state;
        
        if (loading) return `
            <div class="price-display loading">
                <div class="price-header">
                    <h3>Cult Exec </h3>
                    <h3>Bonding Curve Presale</h3>
                </div>
                <div class="price-content">
                    <div class="loading-indicator">Loading...</div>
                </div>
            </div>`;
            
        if (error) return `
            <div class="price-display error">
                <div class="price-header">
                    <h3>Cult Exec </h3>
                    <h3>Bonding Curve Presale</h3>
                </div>
                <div class="price-content">
                    <div class="error-message">Error: ${error}</div>
                </div>
            </div>`;
        
        return `
            <div class="price-display">
                <div class="price-header">
                    <h3>Cult Exec </h3>
                    <h3>Bonding Curve Presale</h3>
                </div>
                
                <div class="price-content">
                    <div class="price-value">
                        <span class="amount">${Number(price).toFixed(8)}</span>
                        <span class="currency">ETH / Cult Exec</span>
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        const result = this.template();
        return result;
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