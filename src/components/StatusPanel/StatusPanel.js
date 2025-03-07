import { Component } from '../../core/Component.js';
//import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';

class StatusPanel extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            network: 'CONNECTED',
            chainId: '1 (ETHEREUM)', 
            block: '19,234,567',
            lastUpdate: '2024-03-14 19:32',
            apiStatus: 'ACTIVE',
            cache: 'SYNCED',
            totalChecks: '1,234',
            successRate: '99.9%'
        };
        this.unsubscribeEvents = [];
    }

    onMount() {
        this.setupEventListeners();
        this.updateStatus();
    }

    onUnmount() {
        this.unsubscribeEvents.forEach(unsubscribe => unsubscribe());
    }

    setupEventListeners() {
        this.unsubscribeEvents = [
            eventBus.on('network:updated', (data) => {
                this.updateStatus();
            })
        ];
    }

    updateStatus() {
        // Here you would typically fetch latest status data
        // For now using static data from state
        this.setState({
            ...this.state
        });
    }

    render() {
        
        return `
            <div class="panel stats-panel">
                <h2>3) SYSTEM STATUS | SYS</h2>
                <div class="stats-content">
                    <p>NETWORK: <span class="status-indicator">${this.state.network}</span></p>
                    <p>CHAIN ID: <span>${this.state.chainId}</span></p>
                    <p>BLOCK: <span>${this.state.block}</span></p>
                    <p>LAST UPDATE: <span>${this.state.lastUpdate}</span></p>
                    <p>API STATUS: <span class="status-indicator">${this.state.apiStatus}</span></p>
                    <p>CACHE: <span class="status-indicator">${this.state.cache}</span></p>
                    <p>TOTAL CHECKS: <span>${this.state.totalChecks}</span></p>
                    <p>SUCCESS RATE: <span>${this.state.successRate}</span></p>
                </div>
            </div>
        `;
    }
}

export default StatusPanel;
