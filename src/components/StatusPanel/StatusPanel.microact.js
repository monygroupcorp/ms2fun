/**
 * StatusPanel - Microact Version
 *
 * System status panel showing network, chain, block, and contract info.
 * Uses BlockchainService for real-time data updates.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';

export class StatusPanel extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            network: 'CONNECTING...',
            chainId: '...',
            block: '...',
            blockTimestamp: null,
            lastUpdate: this.formatDate(new Date()),
            apiStatus: 'INITIALIZING',
            cache: 'INITIALIZING',
            totalChecks: '0',
            successRate: '0%',
            contractAddress: '...',
            mirrorAddress: '...'
        };
        this.blockchainService = null;
    }

    async didMount() {
        try {
            const { default: BlockchainService } = await import('../../services/BlockchainService.js');

            if (window.blockchainServiceInstance) {
                this.blockchainService = window.blockchainServiceInstance;
            } else {
                this.blockchainService = new BlockchainService();
                await this.blockchainService.initialize();
                window.blockchainServiceInstance = this.blockchainService;
            }

            this.setupEventListeners();
            await this.updateStatus();

            const intervalId = this.setInterval(() => this.updateStatus(), 30000);
            this.registerCleanup(() => clearInterval(intervalId));
        } catch (error) {
            console.error('[StatusPanel] Error initializing:', error);
            this.setState({
                network: 'ERROR',
                apiStatus: 'ERROR',
                cache: 'ERROR'
            });
        }
    }

    setupEventListeners() {
        const events = [
            'network:changed',
            'network:switched',
            'wallet:connected',
            'blockchain:initialized',
            'contract:updated'
        ];

        events.forEach(event => {
            const unsub = eventBus.on(event, () => this.updateStatus());
            this.registerCleanup(unsub);
        });
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

    formatAddress(address) {
        if (!address || address === '...' || address.length < 42) {
            return address || '...';
        }
        return `${address.substring(0, 6)}...${address.substring(38)}`;
    }

    async updateStatus() {
        try {
            if (!this.blockchainService?.provider) {
                return;
            }

            const network = await this.blockchainService.provider.getNetwork();
            let blockNumber, blockTimestamp;

            try {
                const blockInfo = await this.blockchainService.getCurrentBlockInfo();
                blockNumber = blockInfo.number;
                blockTimestamp = blockInfo.date;
            } catch (error) {
                blockNumber = await this.blockchainService.provider.getBlockNumber();
                blockTimestamp = new Date();
            }

            const lastUpdate = new Date();
            let contractAddress = '...';
            let mirrorAddress = '...';

            if (this.blockchainService.contract) {
                contractAddress = this.blockchainService.contract.address;
                try {
                    if (this.blockchainService.mirrorContract) {
                        mirrorAddress = this.blockchainService.mirrorContract.address;
                    }
                } catch (e) {
                    // Ignore
                }
            }

            let totalChecks = this.state.totalChecks;
            let successRate = this.state.successRate;

            try {
                const totalSupply = await this.blockchainService.getNFTSupply();
                totalChecks = this.formatNumber(totalSupply);
                successRate = '100%';
            } catch (e) {
                // Ignore
            }

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
            console.error('[StatusPanel] Error updating status:', error);
            this.setState({
                network: 'ERROR',
                lastUpdate: this.formatDate(new Date())
            });
        }
    }

    getStatusClass(value, connectedValue = 'CONNECTED') {
        return value === connectedValue ? 'connected' : 'error';
    }

    render() {
        const { network, chainId, block, blockTimestamp, lastUpdate, apiStatus, cache, totalChecks, successRate, contractAddress, mirrorAddress } = this.state;

        return h('div', { className: 'panel stats-panel' },
            h('h2', null, '3) SYSTEM STATUS | SYS'),
            h('div', { className: 'stats-content' },
                h('p', null,
                    'NETWORK: ',
                    h('span', { className: `status-indicator ${this.getStatusClass(network)}` }, network)
                ),
                h('p', null,
                    'CHAIN ID: ',
                    h('span', null, chainId)
                ),
                h('p', null,
                    'BLOCK: ',
                    h('span', null, block)
                ),
                h('p', null,
                    'BLOCK TIME: ',
                    h('span', null, blockTimestamp || 'N/A')
                ),
                h('p', null,
                    'LAST UPDATE: ',
                    h('span', null, lastUpdate)
                ),
                h('p', null,
                    'CONTRACT: ',
                    h('span', { className: 'address-text' }, contractAddress)
                ),
                h('p', null,
                    'MIRROR NFT: ',
                    h('span', { className: 'address-text' }, mirrorAddress)
                ),
                h('p', null,
                    'API STATUS: ',
                    h('span', { className: `status-indicator ${this.getStatusClass(apiStatus, 'ACTIVE')}` }, apiStatus)
                ),
                h('p', null,
                    'CACHE: ',
                    h('span', { className: `status-indicator ${this.getStatusClass(cache, 'SYNCED')}` }, cache)
                ),
                h('p', null,
                    'TOTAL TOKENS: ',
                    h('span', null, totalChecks)
                ),
                h('p', null,
                    'SUCCESS RATE: ',
                    h('span', null, successRate)
                )
            )
        );
    }
}

export default StatusPanel;
