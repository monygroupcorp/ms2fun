import { Component } from '../../core/Component.js';
//import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';

class StatusPanel extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            network: 'CONNECTING...',
            chainId: '...',
            block: '...',
            lastUpdate: this.formatDate(new Date()),
            apiStatus: 'INITIALIZING',
            cache: 'INITIALIZING',
            totalChecks: '0',
            successRate: '0%',
            contractAddress: '...',
            mirrorAddress: '...'
        };
        this.unsubscribeEvents = [];
        this.updateInterval = null;
        this.blockchainService = null;
    }

    async onMount() {
        try {
            // Import BlockchainService
            const { default: BlockchainService } = await import('../../services/BlockchainService.js');
            
            // Use existing instance if available, otherwise create new one
            if (window.blockchainServiceInstance) {
                this.blockchainService = window.blockchainServiceInstance;
                console.log('Using existing BlockchainService instance');
            } else {
                this.blockchainService = new BlockchainService();
                await this.blockchainService.initialize();
                window.blockchainServiceInstance = this.blockchainService;
                console.log('Created new BlockchainService instance');
            }
            
            this.setupEventListeners();
            await this.updateStatus();
            
            // Set up interval to update every 30 seconds
            this.updateInterval = setInterval(() => this.updateStatus(), 30000);
        } catch (error) {
            console.error('Error initializing StatusPanel:', error);
            this.setState({
                ...this.state,
                network: 'ERROR',
                apiStatus: 'ERROR',
                cache: 'ERROR'
            });
        }
    }

    onUnmount() {
        // Clear update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        // Unsubscribe from events
        this.unsubscribeEvents.forEach(unsubscribe => unsubscribe());
    }

    setupEventListeners() {
        this.unsubscribeEvents = [
            eventBus.on('network:changed', () => this.updateStatus()),
            eventBus.on('network:switched', () => this.updateStatus()),
            eventBus.on('wallet:connected', () => this.updateStatus()),
            eventBus.on('blockchain:initialized', () => this.updateStatus()),
            eventBus.on('contract:updated', () => this.updateStatus())
        ];
    }

    formatDate(date) {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    formatNumber(num) {
        return new Intl.NumberFormat('en-US').format(num);
    }

    getNetworkName(chainId) {
        const networks = {
            1: 'ETHEREUM MAINNET',
            5: 'GOERLI TESTNET',
            11155111: 'SEPOLIA TESTNET',
            137: 'POLYGON MAINNET',
            80001: 'POLYGON MUMBAI',
            56: 'BSC MAINNET',
            97: 'BSC TESTNET',
            42161: 'ARBITRUM ONE',
            10: 'OPTIMISM',
            43114: 'AVALANCHE'
        };
        
        return networks[chainId] || `NETWORK ${chainId}`;
    }

    /**
     * Safely format an Ethereum address for display
     * @param {string} address - Ethereum address to format
     * @returns {string} Formatted address
     */
    formatAddress(address) {
        if (!address || address === '...' || address.length < 42) {
            return address || '...';
        }
        return `${address.substring(0, 6)}...${address.substring(38)}`;
    }

    async updateStatus() {
        try {
            if (!this.blockchainService?.provider) {
                console.warn('BlockchainService or provider not available yet');
                return;
            }
            
            // Get current network and block info
            const network = await this.blockchainService.provider.getNetwork();
            let blockNumber, blockTimestamp;
            
            try {
                const blockInfo = await this.blockchainService.getCurrentBlockInfo();
                blockNumber = blockInfo.number;
                blockTimestamp = blockInfo.date;
            } catch (error) {
                console.warn('Error getting detailed block info, falling back to basic block number', error);
                blockNumber = await this.blockchainService.provider.getBlockNumber();
                blockTimestamp = new Date();
            }
            
            // Current time for last update
            const lastUpdate = new Date();
            
            // Get contract addresses
            let contractAddress = '...';
            let mirrorAddress = '...';
            
            // Fetch contract and mirror addresses if available
            if (this.blockchainService.contract) {
                contractAddress = this.blockchainService.contract.address;
                
                try {
                    if (this.blockchainService.mirrorContract) {
                        mirrorAddress = this.blockchainService.mirrorContract.address;
                    }
                } catch (e) {
                    console.warn('Could not get mirror contract address:', e);
                }
            }
            
            // Get total successful transactions 
            let totalChecks = this.state.totalChecks;
            let successRate = this.state.successRate;
            
            try {
                const currentTier = await this.blockchainService.getCurrentTier();
                const totalSupply = await this.blockchainService.getNFTSupply();
                
                // Format data for display
                totalChecks = this.formatNumber(totalSupply);
                successRate = '100%'; // Can be calculated based on specific metrics if available
            } catch (e) {
                console.warn('Error getting contract statistics:', e);
            }
            
            // Update state with real data
            this.setState({
                network: 'CONNECTED',
                chainId: `${network.chainId} (${this.getNetworkName(network.chainId)})`,
                block: this.formatNumber(blockNumber),
                lastUpdate: this.formatDate(lastUpdate),
                blockTimestamp: this.formatDate(blockTimestamp),
                apiStatus: 'ACTIVE',
                cache: 'SYNCED',
                totalChecks,
                successRate,
                contractAddress: this.formatAddress(contractAddress),
                mirrorAddress: this.formatAddress(mirrorAddress)
            });
        } catch (error) {
            console.error('Error updating status:', error);
            this.setState({
                ...this.state,
                network: 'ERROR',
                lastUpdate: this.formatDate(new Date())
            });
        }
    }

    render() {
        return `
            <div class="panel stats-panel">
                <h2>3) SYSTEM STATUS | SYS</h2>
                <div class="stats-content">
                    <p>NETWORK: <span class="status-indicator ${this.state.network === 'CONNECTED' ? 'connected' : 'error'}">${this.state.network}</span></p>
                    <p>CHAIN ID: <span>${this.state.chainId}</span></p>
                    <p>BLOCK: <span>${this.state.block}</span></p>
                    <p>BLOCK TIME: <span>${this.state.blockTimestamp || 'N/A'}</span></p>
                    <p>LAST UPDATE: <span>${this.state.lastUpdate}</span></p>
                    <p>CONTRACT: <span class="address-text">${this.state.contractAddress}</span></p>
                    <p>MIRROR NFT: <span class="address-text">${this.state.mirrorAddress}</span></p>
                    <p>API STATUS: <span class="status-indicator ${this.state.apiStatus === 'ACTIVE' ? 'connected' : 'error'}">${this.state.apiStatus}</span></p>
                    <p>CACHE: <span class="status-indicator ${this.state.cache === 'SYNCED' ? 'connected' : 'error'}">${this.state.cache}</span></p>
                    <p>TOTAL TOKENS: <span>${this.state.totalChecks}</span></p>
                    <p>SUCCESS RATE: <span>${this.state.successRate}</span></p>
                </div>
            </div>
        `;
    }
}

// Add CSS styles for the status panel
StatusPanel.styles = `
.stats-panel {
    font-family: monospace;
}

.stats-content p {
    margin: 8px 0;
    display: flex;
    justify-content: space-between;
}

.status-indicator {
    font-weight: bold;
}

.status-indicator.connected {
    color: #4caf50;
}

.status-indicator.error {
    color: #f44336;
}

.address-text {
    font-family: monospace;
    font-size: 0.9em;
}
`;

export default StatusPanel;
