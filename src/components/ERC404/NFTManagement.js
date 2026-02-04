import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';

/**
 * NFTManagement Component
 *
 * Manages ERC404 NFT settings and operations:
 * - Skip NFT toggle (disable automatic NFT minting on token transfers)
 * - Balance mint (convert tokens to NFTs)
 * - Reroll NFTs (get new traits by re-minting)
 */
export class NFTManagement extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            loading: true,
            error: null,
            skipNFT: false,
            tokenBalance: '0',
            nftBalance: 0,
            rerollEscrow: '0',
            mintAmount: '',
            rerollExemptions: [],
            userNFTs: [],
            txPending: false
        };
    }

    async onMount() {
        await this.loadData();
        this.setupSubscriptions();
    }

    onUnmount() {
        if (this._unsubscribers) {
            this._unsubscribers.forEach(unsub => unsub());
        }
    }

    setupSubscriptions() {
        this._unsubscribers = [
            eventBus.on('transaction:confirmed', () => this.loadData()),
            eventBus.on('account:changed', () => this.loadData()),
            eventBus.on('wallet:connected', () => this.loadData()),
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false }))
        ];
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();
            if (!walletAddress) {
                this.setState({ loading: false });
                return;
            }

            // Load all NFT-related data
            const [skipNFT, tokenBalance, nftBalance, rerollEscrow] = await Promise.all([
                this.adapter.getSkipNFT(walletAddress).catch(() => false),
                this.adapter.getTokenBalance(walletAddress).catch(() => '0'),
                this.adapter.getNFTBalance(walletAddress).catch(() => 0),
                this.adapter.getRerollEscrow(walletAddress).catch(() => '0')
            ]);

            // Try to get user's NFT IDs for reroll exemption selection
            let userNFTs = [];
            try {
                userNFTs = await this.adapter.getUserNFTIds(walletAddress) || [];
            } catch (e) {
                console.warn('[NFTManagement] Could not load user NFT IDs:', e);
            }

            this.setState({
                loading: false,
                skipNFT,
                tokenBalance,
                nftBalance,
                rerollEscrow,
                userNFTs
            });
        } catch (error) {
            console.error('[NFTManagement] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load NFT data'
            });
        }
    }

    async handleToggleSkipNFT() {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const newValue = !this.state.skipNFT;
            await this.adapter.setSkipNFT(newValue);

            this.setState({ skipNFT: newValue, txPending: false });
        } catch (error) {
            console.error('[NFTManagement] setSkipNFT error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to update skip NFT setting'
            });
        }
    }

    async handleBalanceMint() {
        const { mintAmount, tokenBalance } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!mintAmount || parseFloat(mintAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        const amount = parseFloat(mintAmount);
        const balance = parseFloat(tokenBalance);

        if (amount > balance) {
            this.setState({ error: 'Insufficient token balance' });
            return;
        }

        // ERC404 requires whole token amounts for NFT minting (1 token = 1 NFT)
        // Check if amount is a whole number
        if (amount !== Math.floor(amount)) {
            this.setState({ error: 'NFT mint amount must be a whole number' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(mintAmount, 18).toString();

            await this.adapter.balanceMint(amountWei);

            this.setState({ mintAmount: '', txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[NFTManagement] balanceMint error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to mint NFTs from balance'
            });
        }
    }

    async handleReroll() {
        const { tokenBalance, rerollExemptions, nftBalance } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (nftBalance <= 0) {
            this.setState({ error: 'You have no NFTs to reroll' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            // Use entire token balance for reroll (standard behavior)
            const amountWei = ethers.utils.parseUnits(tokenBalance, 18).toString();

            await this.adapter.rerollSelectedNFTs(amountWei, rerollExemptions);

            this.setState({ rerollExemptions: [], txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[NFTManagement] rerollSelectedNFTs error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to reroll NFTs'
            });
        }
    }

    handleMintAmountChange(value) {
        this.setState({ mintAmount: value, error: null });
    }

    handleExemptionToggle(nftId) {
        const { rerollExemptions } = this.state;
        const exists = rerollExemptions.includes(nftId);

        if (exists) {
            this.setState({
                rerollExemptions: rerollExemptions.filter(id => id !== nftId)
            });
        } else {
            this.setState({
                rerollExemptions: [...rerollExemptions, nftId]
            });
        }
    }

    handleMaxMint() {
        // Get max whole tokens that can be minted as NFTs
        const balance = parseFloat(this.state.tokenBalance);
        const wholeTokens = Math.floor(balance);
        this.setState({ mintAmount: wholeTokens.toString() });
    }

    render() {
        const walletConnected = !!walletService.getAddress();

        if (!walletConnected) {
            return `
                <div class="nft-management marble-bg">
                    <div class="panel-header">
                        <h3>NFT Management</h3>
                    </div>
                    <div class="connect-prompt">
                        <p>Connect your wallet to manage NFT settings</p>
                    </div>
                </div>
            `;
        }

        if (this.state.loading) {
            return `
                <div class="nft-management loading">
                    <div class="loading-spinner"></div>
                    <p>Loading NFT settings...</p>
                </div>
            `;
        }

        const { skipNFT, tokenBalance, nftBalance, rerollEscrow, userNFTs, error, txPending } = this.state;
        const balance = parseFloat(tokenBalance);
        const canMint = balance >= 1; // Need at least 1 whole token

        return `
            <div class="nft-management marble-bg">
                <div class="panel-header">
                    <h3>NFT Management</h3>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                ${this.renderSkipNFTSection(skipNFT, txPending)}
                ${this.renderBalanceSection(balance, nftBalance)}
                ${this.renderBalanceMintSection(canMint, txPending)}
                ${this.renderRerollSection(nftBalance, userNFTs, rerollEscrow, txPending)}
            </div>
        `;
    }

    renderSkipNFTSection(skipNFT, txPending) {
        return `
            <div class="nft-section skip-section">
                <h4>Auto-Mint Setting</h4>
                <div class="skip-toggle-row">
                    <div class="toggle-info">
                        <span class="toggle-label">Skip NFT Minting</span>
                        <p class="toggle-description">
                            When enabled, buying tokens won't automatically mint NFTs.
                            This saves gas but you won't receive NFTs with purchases.
                        </p>
                    </div>
                    <button
                        class="toggle-btn ${skipNFT ? 'active' : ''}"
                        data-action="toggle-skip"
                        ${txPending ? 'disabled' : ''}
                    >
                        ${skipNFT ? 'ON' : 'OFF'}
                    </button>
                </div>
            </div>
        `;
    }

    renderBalanceSection(tokenBalance, nftBalance) {
        return `
            <div class="nft-section balance-section">
                <h4>Your Holdings</h4>
                <div class="holdings-grid">
                    <div class="holding-item">
                        <span class="holding-label">Token Balance</span>
                        <span class="holding-value">${this.formatNumber(tokenBalance)}</span>
                    </div>
                    <div class="holding-item">
                        <span class="holding-label">NFT Count</span>
                        <span class="holding-value">${nftBalance}</span>
                    </div>
                    <div class="holding-item">
                        <span class="holding-label">Mintable NFTs</span>
                        <span class="holding-value">${Math.floor(tokenBalance)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderBalanceMintSection(canMint, txPending) {
        const { mintAmount } = this.state;

        return `
            <div class="nft-section mint-section">
                <h4>Mint NFTs from Balance</h4>
                <p class="section-description">
                    Convert your tokens to NFTs. Each whole token can become 1 NFT.
                </p>
                <div class="mint-controls">
                    <div class="input-row">
                        <input
                            type="number"
                            class="mint-input"
                            placeholder="Amount to mint"
                            value="${mintAmount}"
                            data-action="mint-amount"
                            min="1"
                            step="1"
                            ${txPending ? 'disabled' : ''}
                        />
                        <button class="max-btn" data-action="max-mint" ${txPending ? 'disabled' : ''}>
                            MAX
                        </button>
                    </div>
                    <button
                        class="action-btn mint-btn"
                        data-action="balance-mint"
                        ${!canMint || txPending ? 'disabled' : ''}
                    >
                        ${txPending ? 'Processing...' : 'Mint NFTs'}
                    </button>
                </div>
            </div>
        `;
    }

    renderRerollSection(nftBalance, userNFTs, rerollEscrow, txPending) {
        const { rerollExemptions } = this.state;
        const hasNFTs = nftBalance > 0;
        const escrowAmount = parseFloat(rerollEscrow);

        return `
            <div class="nft-section reroll-section">
                <h4>Reroll NFTs</h4>
                <p class="section-description">
                    Reroll your NFTs to get new random traits. Select NFTs to keep (exempt from reroll).
                </p>

                ${escrowAmount > 0 ? `
                    <div class="escrow-info">
                        <span class="escrow-label">Reroll Escrow:</span>
                        <span class="escrow-value">${this.formatNumber(escrowAmount)} tokens</span>
                    </div>
                ` : ''}

                ${userNFTs.length > 0 ? `
                    <div class="nft-selection">
                        <span class="selection-label">Select NFTs to KEEP:</span>
                        <div class="nft-grid">
                            ${userNFTs.map(nftId => `
                                <div
                                    class="nft-item ${rerollExemptions.includes(nftId) ? 'selected' : ''}"
                                    data-action="toggle-exemption"
                                    data-nft-id="${nftId}"
                                >
                                    <span class="nft-id">#${nftId}</span>
                                    <span class="selection-indicator">${rerollExemptions.includes(nftId) ? '>' : ''}</span>
                                </div>
                            `).join('')}
                        </div>
                        <p class="selection-hint">
                            ${rerollExemptions.length > 0
                                ? `${rerollExemptions.length} NFT(s) will be kept`
                                : 'All NFTs will be rerolled'}
                        </p>
                    </div>
                ` : hasNFTs ? `
                    <p class="no-nft-ids">You have ${nftBalance} NFT(s) that can be rerolled</p>
                ` : ''}

                <button
                    class="action-btn reroll-btn"
                    data-action="reroll"
                    ${!hasNFTs || txPending ? 'disabled' : ''}
                >
                    ${txPending ? 'Processing...' : 'Reroll NFTs'}
                </button>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMListeners();
    }

    setupDOMListeners() {
        const container = this._element;
        if (!container) return;

        container.addEventListener('click', (e) => {
            const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action;
            if (!action) return;

            switch (action) {
                case 'toggle-skip':
                    this.handleToggleSkipNFT();
                    break;
                case 'balance-mint':
                    this.handleBalanceMint();
                    break;
                case 'reroll':
                    this.handleReroll();
                    break;
                case 'max-mint':
                    this.handleMaxMint();
                    break;
                case 'toggle-exemption':
                    const nftId = parseInt(e.target.closest('[data-nft-id]')?.dataset.nftId);
                    if (!isNaN(nftId)) {
                        this.handleExemptionToggle(nftId);
                    }
                    break;
            }
        });

        container.addEventListener('input', (e) => {
            if (e.target.dataset.action === 'mint-amount') {
                this.handleMintAmountChange(e.target.value);
            }
        });
    }

    formatNumber(num) {
        const n = parseFloat(num);
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
