/**
 * ERC404TradingSidebar Component
 * Trading interface sidebar with buy/sell, token info, and portfolio button
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { ERC404PortfolioModal } from './ERC404PortfolioModal.js';

export class ERC404TradingSidebar extends Component {
    constructor(adapter, projectData) {
        super();
        this.adapter = adapter;
        this.projectData = projectData;
        this.portfolioModal = null;
        this._formValues = { amount: '', message: '' };
        this.state = {
            loading: true,
            isBuying: true,
            isBondingActive: true,
            price: '0',
            userBalance: '0',
            userNFTCount: 0,
            txPending: false,
            error: null
        };
    }

    async onMount() {
        await this.loadData();
        this.setupEventDelegation();

        // Subscribe to wallet events
        this.subscribe('wallet:connected', () => this.loadData());
        this.subscribe('wallet:changed', () => this.loadData());
        this.subscribe('wallet:disconnected', () => this.loadData());
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Get price using getCurrentPrice (both adapters have this)
            let price = '0';
            try {
                const priceResult = await this.adapter.getCurrentPrice();
                price = typeof priceResult === 'number' ? priceResult.toString() : priceResult;
            } catch (e) {
                console.warn('[ERC404TradingSidebar] Error getting price:', e);
            }

            // Check if bonding is still active (for message input)
            let isBondingActive = true;
            try {
                const bondingStatus = await this.adapter.getBondingStatus();
                isBondingActive = bondingStatus.isActive && !bondingStatus.hasLiquidity;
            } catch (e) {
                console.warn('[ERC404TradingSidebar] Error getting bonding status:', e);
            }

            const userAddress = walletService.getAddress();

            let userBalance = '0';
            let userNFTCount = 0;

            if (userAddress) {
                // Get token balance
                try {
                    const balance = await this.adapter.getTokenBalance(userAddress);
                    // Format from wei to tokens
                    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                    userBalance = ethers.utils.formatUnits(balance, 18);
                } catch (e) {
                    console.warn('[ERC404TradingSidebar] Error getting balance:', e);
                }

                // Get NFT count
                try {
                    const nftBalance = await this.adapter.getNFTBalance(userAddress);
                    userNFTCount = parseInt(nftBalance) || 0;
                } catch (e) {
                    console.warn('[ERC404TradingSidebar] Error getting NFT balance:', e);
                }
            }

            this.setState({
                loading: false,
                price,
                isBondingActive,
                userBalance,
                userNFTCount
            });
        } catch (error) {
            console.error('[ERC404TradingSidebar] Error:', error);
            this.setState({ loading: false, error: error.message });
        }
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', async (e) => {
            const target = e.target;

            if (target.closest('[data-action="toggle-buy"]')) {
                this.setState({ isBuying: true });
                this._formValues.amount = '';
                this._formValues.message = '';
                this.update();
            } else if (target.closest('[data-action="toggle-sell"]')) {
                this.setState({ isBuying: false });
                this._formValues.amount = '';
                this._formValues.message = '';
                this.update();
            } else if (target.closest('[data-action="quick-pick"]')) {
                const value = target.closest('[data-action="quick-pick"]').dataset.value;
                this.handleQuickPick(value);
            } else if (target.closest('[data-action="execute"]')) {
                await this.handleExecuteTrade();
            } else if (target.closest('[data-action="connect"]')) {
                eventBus.emit('wallet:request-connect');
            } else if (target.closest('[data-action="portfolio"]')) {
                this.openPortfolioModal();
            }
        });

        this.element.addEventListener('input', (e) => {
            if (e.target.name === 'amount') {
                this._formValues.amount = e.target.value;
            } else if (e.target.name === 'message') {
                this._formValues.message = e.target.value;
            }
        });
    }

    handleQuickPick(value) {
        if (this.state.isBuying) {
            // ETH amounts for buying
            this._formValues.amount = value;
        } else {
            // Percentages for selling
            const balance = parseFloat(this.state.userBalance) || 0;
            if (value === 'max') {
                this._formValues.amount = balance.toString();
            } else {
                const percent = parseFloat(value);
                this._formValues.amount = ((balance * percent) / 100).toString();
            }
        }
        this.update();
    }

    async handleExecuteTrade() {
        const amount = this._formValues.amount;
        if (!amount || parseFloat(amount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        if (!this.isConnected()) {
            eventBus.emit('wallet:request-connect');
            return;
        }

        try {
            this.setState({ txPending: true, error: null });
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            if (this.state.isBuying) {
                // Buy: amount is in ETH
                const ethAmountFloat = parseFloat(amount);
                const ethAmountWei = ethers.utils.parseEther(amount);

                // Estimate tokens from current price
                const currentPrice = parseFloat(this.state.price) || 0.0001;
                const estimatedTokens = Math.floor(ethAmountFloat / currentPrice);

                if (estimatedTokens <= 0) {
                    throw new Error('Amount too small');
                }

                // Convert to wei (tokens have 18 decimals in ERC404)
                const tokenAmountWei = ethers.utils.parseUnits(estimatedTokens.toString(), 18);

                // Add 5% slippage to max cost
                const maxCost = ethAmountWei.mul(105).div(100);

                const message = this._formValues.message || '';
                const passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

                // buyBonding(amount, maxCost, mintNFT, passwordHash, message)
                await this.adapter.buyBonding(
                    tokenAmountWei.toString(),
                    maxCost.toString(),
                    false, // mintNFT
                    passwordHash,
                    message
                );
            } else {
                // Sell: amount is in tokens
                const tokenAmountWei = ethers.utils.parseUnits(amount, 18);

                // Calculate expected ETH return using adapter method
                let minRefund;
                try {
                    const refundWei = await this.adapter.calculateRefund(tokenAmountWei.toString());
                    minRefund = ethers.BigNumber.from(refundWei);
                    // Apply 2% slippage tolerance
                    minRefund = minRefund.mul(98).div(100);
                } catch (e) {
                    console.warn('[ERC404TradingSidebar] Error calculating refund, using 0:', e);
                    minRefund = ethers.BigNumber.from(0);
                }

                const message = this._formValues.message || '';
                const passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

                // sellBonding(amount, minRefund, passwordHash, message)
                await this.adapter.sellBonding(
                    tokenAmountWei.toString(),
                    minRefund.toString(),
                    passwordHash,
                    message
                );
            }

            this._formValues.amount = '';
            this._formValues.message = '';
            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[ERC404TradingSidebar] Trade error:', error);
            this.setState({ txPending: false, error: error.message || 'Transaction failed' });
        }
    }

    openPortfolioModal() {
        if (!this.portfolioModal) {
            this.portfolioModal = new ERC404PortfolioModal(this.adapter, this.projectData);
            const container = document.createElement('div');
            container.id = 'portfolio-modal-container';
            document.body.appendChild(container);
            this.portfolioModal.mount(container);
        }
        this.portfolioModal.open();
    }

    isConnected() {
        return walletService.isConnected();
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { loading, isBuying, isBondingActive, price, userBalance, userNFTCount, txPending, error } = this.state;
        const connected = this.isConnected();
        const symbol = this.projectData.symbol || 'TOKEN';

        const buyQuickPicks = [
            { value: '0.01', label: '0.01' },
            { value: '0.05', label: '0.05' },
            { value: '0.1', label: '0.1' },
            { value: '1', label: '1' }
        ];

        const sellQuickPicks = [
            { value: '25', label: '25%' },
            { value: '50', label: '50%' },
            { value: '75', label: '75%' },
            { value: 'max', label: 'Max' }
        ];

        const quickPicks = isBuying ? buyQuickPicks : sellQuickPicks;

        return `
            <div class="erc404-trading-sidebar">
                <div class="trading-controls">
                    <div class="buy-sell-toggle">
                        <button class="toggle-btn ${isBuying ? 'active buy' : ''}" data-action="toggle-buy">Buy</button>
                        <button class="toggle-btn ${!isBuying ? 'active sell' : ''}" data-action="toggle-sell">Sell</button>
                    </div>

                    <div class="amount-input-container">
                        <input
                            type="number"
                            name="amount"
                            class="amount-input"
                            placeholder="${isBuying ? '0.0 ETH' : '0.0 ' + symbol}"
                            value="${this._formValues.amount}"
                            step="any"
                            min="0"
                            ${txPending ? 'disabled' : ''}
                        >
                        <span class="currency-label">${isBuying ? 'ETH' : symbol}</span>
                    </div>

                    <div class="quick-picks">
                        ${quickPicks.map(pick => `
                            <button class="quick-pick-btn" data-action="quick-pick" data-value="${pick.value}" ${txPending ? 'disabled' : ''}>
                                ${pick.label}
                            </button>
                        `).join('')}
                    </div>

                    ${isBondingActive ? `
                        <div class="message-input-container">
                            <input
                                type="text"
                                name="message"
                                class="message-input"
                                placeholder="Add a message (optional)"
                                value="${this.escapeHtml(this._formValues.message)}"
                                maxlength="280"
                                ${txPending ? 'disabled' : ''}
                            >
                        </div>
                    ` : ''}

                    ${!connected ? `
                        <button class="execute-btn connect-btn" data-action="connect">
                            Connect Wallet
                        </button>
                    ` : `
                        <button class="execute-btn ${isBuying ? 'buy-btn' : 'sell-btn'}" data-action="execute" ${txPending ? 'disabled' : ''}>
                            ${txPending ? 'Confirming...' : (isBuying ? `Buy $${symbol}` : `Sell $${symbol}`)}
                        </button>
                    `}

                    ${error ? `<div class="sidebar-error-message">${this.escapeHtml(error)}</div>` : ''}
                </div>

                <div class="token-info-section">
                    <div class="info-row">
                        <span class="info-label">Price</span>
                        <span class="info-value">${loading ? '...' : parseFloat(price).toFixed(6)} ETH</span>
                    </div>
                    ${connected ? `
                        <div class="info-row">
                            <span class="info-label">Your Balance</span>
                            <span class="info-value">${parseFloat(userBalance).toFixed(4)} ${symbol}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Your NFTs</span>
                            <span class="info-value">${userNFTCount}</span>
                        </div>
                        <button class="portfolio-btn" data-action="portfolio">
                            My Portfolio
                        </button>
                    ` : ''}
                </div>

                <div class="creator-info-section">
                    <h4 class="section-title">Creator</h4>
                    <a class="creator-link" href="https://etherscan.io/address/${this.projectData.creator}" target="_blank" rel="noopener">
                        ${this.truncateAddress(this.projectData.creator)}
                    </a>
                    ${this.projectData.vault ? `
                        <div class="vault-info">
                            <span class="vault-label">Vault:</span>
                            <a class="vault-link" href="https://etherscan.io/address/${this.projectData.vault}" target="_blank" rel="noopener">
                                ${this.truncateAddress(this.projectData.vault)}
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    unmount() {
        if (this.portfolioModal) {
            this.portfolioModal.close();
            const container = document.getElementById('portfolio-modal-container');
            if (container) container.remove();
            this.portfolioModal = null;
        }
        super.unmount();
    }
}

export default ERC404TradingSidebar;
