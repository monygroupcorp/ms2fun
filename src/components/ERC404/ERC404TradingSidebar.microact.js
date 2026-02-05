/**
 * ERC404TradingSidebar - Microact Version
 *
 * Trading interface sidebar with buy/sell, token info, and portfolio button
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class ERC404TradingSidebar extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            isBuying: true,
            isBondingActive: true,
            price: '0',
            userBalance: '0',
            userNFTCount: 0,
            txPending: false,
            error: null,
            amount: '',
            message: ''
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectData() {
        return this.props.projectData || {};
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub2 = eventBus.on('wallet:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:disconnected', () => this.loadData());
        const unsub4 = eventBus.on('transaction:confirmed', () => this.loadData());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            let price = '0';
            try {
                const priceResult = await this.adapter.getCurrentPrice();
                price = typeof priceResult === 'number' ? priceResult.toString() : priceResult;
            } catch (e) {
                console.warn('[ERC404TradingSidebar] Error getting price:', e);
            }

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
                try {
                    const balance = await this.adapter.getTokenBalance(userAddress);
                    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                    userBalance = ethers.utils.formatUnits(balance, 18);
                } catch (e) {
                    console.warn('[ERC404TradingSidebar] Error getting balance:', e);
                }

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

    isConnected() {
        return walletService.isConnected();
    }

    handleToggleBuy() {
        this.setState({ isBuying: true, amount: '', message: '', error: null });
    }

    handleToggleSell() {
        this.setState({ isBuying: false, amount: '', message: '', error: null });
    }

    handleAmountChange(e) {
        this.setState({ amount: e.target.value, error: null });
    }

    handleMessageChange(e) {
        this.setState({ message: e.target.value });
    }

    handleQuickPick(value) {
        const { isBuying, userBalance } = this.state;

        if (isBuying) {
            this.setState({ amount: value });
        } else {
            const balance = parseFloat(userBalance) || 0;
            if (value === 'max') {
                this.setState({ amount: balance.toString() });
            } else {
                const percent = parseFloat(value);
                this.setState({ amount: ((balance * percent) / 100).toString() });
            }
        }
    }

    handleConnectClick() {
        eventBus.emit('wallet:request-connect');
    }

    handlePortfolioClick() {
        eventBus.emit('erc404:portfolio:open', {
            adapter: this.adapter,
            projectData: this.projectData
        });
    }

    async handleExecuteTrade() {
        const { amount, message, isBuying } = this.state;

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

            if (isBuying) {
                const ethAmountFloat = parseFloat(amount);
                const ethAmountWei = ethers.utils.parseEther(amount);

                const currentPrice = parseFloat(this.state.price) || 0.0001;
                const estimatedTokens = Math.floor(ethAmountFloat / currentPrice);

                if (estimatedTokens <= 0) {
                    throw new Error('Amount too small');
                }

                const tokenAmountWei = ethers.utils.parseUnits(estimatedTokens.toString(), 18);
                const maxCost = ethAmountWei.mul(105).div(100);

                const tradeMessage = message || '';
                const passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

                await this.adapter.buyBonding(
                    tokenAmountWei.toString(),
                    maxCost.toString(),
                    false,
                    passwordHash,
                    tradeMessage
                );
            } else {
                const tokenAmountWei = ethers.utils.parseUnits(amount, 18);

                let minRefund;
                try {
                    const refundWei = await this.adapter.calculateRefund(tokenAmountWei.toString());
                    minRefund = ethers.BigNumber.from(refundWei);
                    minRefund = minRefund.mul(98).div(100);
                } catch (e) {
                    console.warn('[ERC404TradingSidebar] Error calculating refund, using 0:', e);
                    minRefund = ethers.BigNumber.from(0);
                }

                const tradeMessage = message || '';
                const passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

                await this.adapter.sellBonding(
                    tokenAmountWei.toString(),
                    minRefund.toString(),
                    passwordHash,
                    tradeMessage
                );
            }

            this.setState({ amount: '', message: '', txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[ERC404TradingSidebar] Trade error:', error);
            this.setState({ txPending: false, error: error.message || 'Transaction failed' });
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    shouldUpdate(oldState, newState) {
        // Always update for most state changes
        if (oldState.loading !== newState.loading) return true;
        if (oldState.isBuying !== newState.isBuying) return true;
        if (oldState.txPending !== newState.txPending) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.price !== newState.price) return true;
        if (oldState.userBalance !== newState.userBalance) return true;
        if (oldState.userNFTCount !== newState.userNFTCount) return true;
        if (oldState.isBondingActive !== newState.isBondingActive) return true;

        // Skip re-render for input changes to preserve focus
        if (oldState.amount !== newState.amount) {
            this.updateAmountDisplay(newState.amount);
            return false;
        }
        if (oldState.message !== newState.message) {
            this.updateMessageDisplay(newState.message);
            return false;
        }

        return false;
    }

    updateAmountDisplay(value) {
        const input = this._element?.querySelector('input[name="amount"]');
        if (input && input.value !== value) {
            input.value = value;
        }
    }

    updateMessageDisplay(value) {
        const input = this._element?.querySelector('input[name="message"]');
        if (input && input.value !== value) {
            input.value = value;
        }
    }

    render() {
        const { loading, isBuying, isBondingActive, price, userBalance, userNFTCount, txPending, error, amount, message } = this.state;
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

        return h('div', { className: 'erc404-trading-sidebar' },
            h('div', { className: 'trading-controls' },
                h('div', { className: 'buy-sell-toggle' },
                    h('button', {
                        className: `toggle-btn ${isBuying ? 'active buy' : ''}`,
                        onClick: this.bind(this.handleToggleBuy)
                    }, 'Buy'),
                    h('button', {
                        className: `toggle-btn ${!isBuying ? 'active sell' : ''}`,
                        onClick: this.bind(this.handleToggleSell)
                    }, 'Sell')
                ),

                h('div', { className: 'amount-input-container' },
                    h('input', {
                        type: 'number',
                        name: 'amount',
                        className: 'amount-input',
                        placeholder: isBuying ? '0.0 ETH' : `0.0 ${symbol}`,
                        value: amount,
                        onInput: this.bind(this.handleAmountChange),
                        step: 'any',
                        min: '0',
                        disabled: txPending
                    }),
                    h('span', { className: 'currency-label' }, isBuying ? 'ETH' : symbol)
                ),

                h('div', { className: 'quick-picks' },
                    ...quickPicks.map(pick =>
                        h('button', {
                            key: `pick-${pick.value}`,
                            className: 'quick-pick-btn',
                            onClick: () => this.handleQuickPick(pick.value),
                            disabled: txPending
                        }, pick.label)
                    )
                ),

                isBondingActive && h('div', { className: 'message-input-container' },
                    h('input', {
                        type: 'text',
                        name: 'message',
                        className: 'message-input',
                        placeholder: 'Add a message (optional)',
                        value: message,
                        onInput: this.bind(this.handleMessageChange),
                        maxLength: 280,
                        disabled: txPending
                    })
                ),

                !connected
                    ? h('button', {
                        className: 'execute-btn connect-btn',
                        onClick: this.bind(this.handleConnectClick)
                    }, 'Connect Wallet')
                    : h('button', {
                        className: `execute-btn ${isBuying ? 'buy-btn' : 'sell-btn'}`,
                        onClick: this.bind(this.handleExecuteTrade),
                        disabled: txPending
                    }, txPending ? 'Confirming...' : (isBuying ? `Buy $${symbol}` : `Sell $${symbol}`)),

                error && h('div', { className: 'sidebar-error-message' }, error)
            ),

            h('div', { className: 'token-info-section' },
                h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Price'),
                    h('span', { className: 'info-value' }, `${loading ? '...' : parseFloat(price).toFixed(6)} ETH`)
                ),
                connected && [
                    h('div', { key: 'balance', className: 'info-row' },
                        h('span', { className: 'info-label' }, 'Your Balance'),
                        h('span', { className: 'info-value' }, `${parseFloat(userBalance).toFixed(4)} ${symbol}`)
                    ),
                    h('div', { key: 'nfts', className: 'info-row' },
                        h('span', { className: 'info-label' }, 'Your NFTs'),
                        h('span', { className: 'info-value' }, userNFTCount)
                    ),
                    h('button', {
                        key: 'portfolio',
                        className: 'portfolio-btn',
                        onClick: this.bind(this.handlePortfolioClick)
                    }, 'My Portfolio')
                ]
            ),

            h('div', { className: 'creator-info-section' },
                h('h4', { className: 'section-title' }, 'Creator'),
                h('a', {
                    className: 'creator-link',
                    href: `https://etherscan.io/address/${this.projectData.creator}`,
                    target: '_blank',
                    rel: 'noopener'
                }, this.truncateAddress(this.projectData.creator)),
                this.projectData.vault && h('div', { className: 'vault-info' },
                    h('span', { className: 'vault-label' }, 'Vault:'),
                    h('a', {
                        className: 'vault-link',
                        href: `https://etherscan.io/address/${this.projectData.vault}`,
                        target: '_blank',
                        rel: 'noopener'
                    }, this.truncateAddress(this.projectData.vault))
                )
            )
        );
    }
}

export default ERC404TradingSidebar;
