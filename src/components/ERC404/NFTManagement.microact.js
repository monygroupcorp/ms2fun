/**
 * NFTManagement - Microact Version
 *
 * Manages ERC404 NFT settings and operations:
 * - Skip NFT toggle (disable automatic NFT minting on token transfers)
 * - Balance mint (convert tokens to NFTs)
 * - Reroll NFTs (get new traits by re-minting)
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class NFTManagement extends Component {
    constructor(props = {}) {
        super(props);
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

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('transaction:confirmed', () => this.loadData());
        const unsub2 = eventBus.on('account:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub4 = eventBus.on('wallet:disconnected', () => this.setState({ loading: false }));

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    isConnected() {
        return !!walletService.getAddress();
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();
            if (!walletAddress) {
                this.setState({ loading: false });
                return;
            }

            const [skipNFT, tokenBalance, nftBalance, rerollEscrow] = await Promise.all([
                this.adapter.getSkipNFT(walletAddress).catch(() => false),
                this.adapter.getTokenBalance(walletAddress).catch(() => '0'),
                this.adapter.getNFTBalance(walletAddress).catch(() => 0),
                this.adapter.getRerollEscrow(walletAddress).catch(() => '0')
            ]);

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

    handleMintAmountChange(e) {
        this.setState({ mintAmount: e.target.value, error: null });
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
        const balance = parseFloat(this.state.tokenBalance);
        const wholeTokens = Math.floor(balance);
        this.setState({ mintAmount: wholeTokens.toString() });
    }

    formatNumber(num) {
        const n = parseFloat(num);
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    renderSkipNFTSection() {
        const { skipNFT, txPending } = this.state;

        return h('div', { className: 'nft-section skip-section' },
            h('h4', null, 'Auto-Mint Setting'),
            h('div', { className: 'skip-toggle-row' },
                h('div', { className: 'toggle-info' },
                    h('span', { className: 'toggle-label' }, 'Skip NFT Minting'),
                    h('p', { className: 'toggle-description' },
                        'When enabled, buying tokens won\'t automatically mint NFTs. This saves gas but you won\'t receive NFTs with purchases.'
                    )
                ),
                h('button', {
                    className: `toggle-btn ${skipNFT ? 'active' : ''}`,
                    onClick: this.bind(this.handleToggleSkipNFT),
                    disabled: txPending
                }, skipNFT ? 'ON' : 'OFF')
            )
        );
    }

    renderBalanceSection() {
        const { tokenBalance, nftBalance } = this.state;
        const balance = parseFloat(tokenBalance);

        return h('div', { className: 'nft-section balance-section' },
            h('h4', null, 'Your Holdings'),
            h('div', { className: 'holdings-grid' },
                h('div', { className: 'holding-item' },
                    h('span', { className: 'holding-label' }, 'Token Balance'),
                    h('span', { className: 'holding-value' }, this.formatNumber(balance))
                ),
                h('div', { className: 'holding-item' },
                    h('span', { className: 'holding-label' }, 'NFT Count'),
                    h('span', { className: 'holding-value' }, nftBalance)
                ),
                h('div', { className: 'holding-item' },
                    h('span', { className: 'holding-label' }, 'Mintable NFTs'),
                    h('span', { className: 'holding-value' }, Math.floor(balance))
                )
            )
        );
    }

    renderBalanceMintSection() {
        const { mintAmount, tokenBalance, txPending } = this.state;
        const balance = parseFloat(tokenBalance);
        const canMint = balance >= 1;

        return h('div', { className: 'nft-section mint-section' },
            h('h4', null, 'Mint NFTs from Balance'),
            h('p', { className: 'section-description' },
                'Convert your tokens to NFTs. Each whole token can become 1 NFT.'
            ),
            h('div', { className: 'mint-controls' },
                h('div', { className: 'input-row' },
                    h('input', {
                        type: 'number',
                        className: 'mint-input',
                        placeholder: 'Amount to mint',
                        value: mintAmount,
                        onInput: this.bind(this.handleMintAmountChange),
                        min: '1',
                        step: '1',
                        disabled: txPending
                    }),
                    h('button', {
                        className: 'max-btn',
                        onClick: this.bind(this.handleMaxMint),
                        disabled: txPending
                    }, 'MAX')
                ),
                h('button', {
                    className: 'action-btn mint-btn',
                    onClick: this.bind(this.handleBalanceMint),
                    disabled: !canMint || txPending
                }, txPending ? 'Processing...' : 'Mint NFTs')
            )
        );
    }

    renderRerollSection() {
        const { nftBalance, userNFTs, rerollEscrow, rerollExemptions, txPending } = this.state;
        const hasNFTs = nftBalance > 0;
        const escrowAmount = parseFloat(rerollEscrow);

        return h('div', { className: 'nft-section reroll-section' },
            h('h4', null, 'Reroll NFTs'),
            h('p', { className: 'section-description' },
                'Reroll your NFTs to get new random traits. Select NFTs to keep (exempt from reroll).'
            ),

            escrowAmount > 0 && h('div', { className: 'escrow-info' },
                h('span', { className: 'escrow-label' }, 'Reroll Escrow:'),
                h('span', { className: 'escrow-value' }, `${this.formatNumber(escrowAmount)} tokens`)
            ),

            userNFTs.length > 0 && h('div', { className: 'nft-selection' },
                h('span', { className: 'selection-label' }, 'Select NFTs to KEEP:'),
                h('div', { className: 'nft-grid' },
                    ...userNFTs.map(nftId =>
                        h('div', {
                            key: `nft-${nftId}`,
                            className: `nft-item ${rerollExemptions.includes(nftId) ? 'selected' : ''}`,
                            onClick: () => this.handleExemptionToggle(nftId)
                        },
                            h('span', { className: 'nft-id' }, `#${nftId}`),
                            h('span', { className: 'selection-indicator' },
                                rerollExemptions.includes(nftId) ? '>' : ''
                            )
                        )
                    )
                ),
                h('p', { className: 'selection-hint' },
                    rerollExemptions.length > 0
                        ? `${rerollExemptions.length} NFT(s) will be kept`
                        : 'All NFTs will be rerolled'
                )
            ),

            userNFTs.length === 0 && hasNFTs && h('p', { className: 'no-nft-ids' },
                `You have ${nftBalance} NFT(s) that can be rerolled`
            ),

            h('button', {
                className: 'action-btn reroll-btn',
                onClick: this.bind(this.handleReroll),
                disabled: !hasNFTs || txPending
            }, txPending ? 'Processing...' : 'Reroll NFTs')
        );
    }

    render() {
        const { loading, error } = this.state;
        const walletConnected = this.isConnected();

        if (!walletConnected) {
            return h('div', { className: 'nft-management marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'NFT Management')
                ),
                h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect your wallet to manage NFT settings')
                )
            );
        }

        if (loading) {
            return h('div', { className: 'nft-management loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading NFT settings...')
            );
        }

        return h('div', { className: 'nft-management marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'NFT Management')
            ),

            error && h('div', { className: 'error-banner' }, error),

            this.renderSkipNFTSection(),
            this.renderBalanceSection(),
            this.renderBalanceMintSection(),
            this.renderRerollSection()
        );
    }
}

export default NFTManagement;
