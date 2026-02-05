/**
 * ERC404PortfolioModal - Microact Version
 *
 * Modal displaying user's ERC404 tokens and NFTs with mint and reroll controls.
 * Provides a unified view of user's holdings for a specific ERC404 project.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404PortfolioModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isOpen: false,
            loading: false,
            tokenBalance: '0',
            nfts: [],
            selectedNFT: null,
            txPending: false,
            error: null,
            success: null
        };
        this._keyHandler = null;
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectData() {
        return this.props.projectData || {};
    }

    async didMount() {
        stylesheetLoader.load('src/components/ERC404/erc404-portfolio.css', 'erc404-portfolio-styles');

        const unsub1 = eventBus.on('transaction:confirmed', () => {
            if (this.state.isOpen) this.loadPortfolio();
        });
        const unsub2 = eventBus.on('wallet:connected', () => {
            if (this.state.isOpen) this.loadPortfolio();
        });
        const unsub3 = eventBus.on('wallet:disconnected', () => {
            this.setState({ tokenBalance: '0', nfts: [], error: null, success: null });
        });
        const unsub4 = eventBus.on('erc404:portfolio:open', (data) => {
            if (data?.adapter === this.adapter) {
                this.open();
            }
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            stylesheetLoader.unload('erc404-portfolio-styles');
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
            }
        });
    }

    open() {
        this.setState({ isOpen: true, error: null, success: null });
        this._keyHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._keyHandler);
        document.body.style.overflow = 'hidden';
        this.loadPortfolio();
    }

    close() {
        this.setState({ isOpen: false, selectedNFT: null, error: null, success: null });
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        document.body.style.overflow = '';
        eventBus.emit('portfolio:close');
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('erc404-portfolio-overlay')) {
            this.close();
        }
    }

    async loadPortfolio() {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({
                loading: false,
                error: 'Please connect your wallet to view your portfolio'
            });
            return;
        }

        try {
            this.setState({ loading: true, error: null });

            let tokenBalance = '0';
            try {
                const balanceWei = await this.adapter.getTokenBalance(walletAddress);
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                tokenBalance = ethers.utils.formatUnits(balanceWei, 18);
            } catch (e) {
                console.warn('[ERC404PortfolioModal] Error getting token balance:', e);
            }

            let nfts = [];
            try {
                const nftIds = await this.adapter.getUserNFTIds(walletAddress);
                if (nftIds && nftIds.length > 0) {
                    nfts = await Promise.all(nftIds.map(async (tokenId) => {
                        const nft = { tokenId, metadata: null, imageUrl: null };
                        try {
                            const tokenUri = await this.adapter.getTokenUri(tokenId);
                            if (tokenUri) {
                                const { fetchJsonWithIpfsSupport } = await import('../../services/IpfsService.js');
                                const metadata = await fetchJsonWithIpfsSupport(tokenUri);
                                nft.metadata = metadata;
                                if (metadata && metadata.image) {
                                    nft.imageUrl = metadata.image;
                                }
                            }
                        } catch (e) {
                            console.warn(`[ERC404PortfolioModal] Error loading metadata for NFT #${tokenId}:`, e);
                        }
                        return nft;
                    }));
                }
            } catch (e) {
                console.warn('[ERC404PortfolioModal] Error getting NFT data:', e);
            }

            this.setState({ loading: false, tokenBalance, nfts });

            // Enhance IPFS images after render
            setTimeout(() => {
                if (this._element) {
                    enhanceAllIpfsImages(this._element);
                }
            }, 100);

        } catch (error) {
            console.error('[ERC404PortfolioModal] Error loading portfolio:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load portfolio data'
            });
        }
    }

    async handleMint() {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        const balance = parseFloat(this.state.tokenBalance);
        const mintableNFTs = Math.floor(balance);
        if (mintableNFTs < 1) {
            this.setState({ error: 'Insufficient token balance to mint an NFT (need at least 1 whole token)' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits('1', 18).toString();

            await this.adapter.balanceMint(amountWei);

            this.setState({
                txPending: false,
                success: 'NFT minted successfully!'
            });

            await this.loadPortfolio();

        } catch (error) {
            console.error('[ERC404PortfolioModal] Mint error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to mint NFT'
            });
        }
    }

    async handleReroll(tokenId) {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null, selectedNFT: tokenId });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const tokenBalanceWei = ethers.utils.parseUnits(this.state.tokenBalance, 18).toString();

            await this.adapter.rerollSelectedNFTs(tokenBalanceWei, []);

            this.setState({
                txPending: false,
                selectedNFT: null,
                success: 'NFT rerolled successfully!'
            });

            await this.loadPortfolio();

        } catch (error) {
            console.error('[ERC404PortfolioModal] Reroll error:', error);
            this.setState({
                txPending: false,
                selectedNFT: null,
                error: error.message || 'Failed to reroll NFT'
            });
        }
    }

    formatNumber(num) {
        const n = parseFloat(num);
        if (isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    renderNFTCard(nft) {
        const { txPending, selectedNFT } = this.state;
        const isSelected = selectedNFT === nft.tokenId;

        return h('div', { key: `nft-${nft.tokenId}`, className: 'portfolio-nft-card' },
            h('div', { className: 'portfolio-nft-image' },
                nft.imageUrl
                    ? h('div', {
                        className: 'nft-img-container',
                        innerHTML: renderIpfsImage(nft.imageUrl, nft.metadata?.name || `NFT #${nft.tokenId}`, 'nft-img')
                    })
                    : h('div', { className: 'nft-placeholder' },
                        h('span', null, `#${nft.tokenId}`)
                    )
            ),
            h('div', { className: 'portfolio-nft-info' },
                h('span', { className: 'nft-name' }, nft.metadata?.name || `NFT #${nft.tokenId}`),
                h('span', { className: 'nft-id' }, `#${nft.tokenId}`)
            ),
            h('button', {
                className: 'nft-reroll-btn',
                onClick: () => this.handleReroll(nft.tokenId),
                disabled: txPending
            }, isSelected && txPending ? 'Rerolling...' : 'Reroll')
        );
    }

    render() {
        const { isOpen, loading, tokenBalance, nfts, txPending, error, success } = this.state;

        if (!isOpen) {
            return h('div', { className: 'erc404-portfolio-modal-container' });
        }

        const walletConnected = !!walletService.getAddress();
        const symbol = this.projectData?.symbol || 'TOKEN';
        const balance = parseFloat(tokenBalance);
        const mintableNFTs = Math.floor(balance);

        return h('div', { className: 'erc404-portfolio-modal-container' },
            h('div', {
                className: 'erc404-portfolio-overlay',
                onClick: this.bind(this.handleOverlayClick)
            },
                h('div', { className: 'erc404-portfolio-modal' },
                    h('button', {
                        className: 'erc404-portfolio-close',
                        onClick: this.bind(this.close)
                    }, '×'),

                    h('div', { className: 'erc404-portfolio-header' },
                        h('h2', null, 'My Portfolio'),
                        this.projectData?.name && h('span', { className: 'portfolio-project-name' }, this.projectData.name)
                    ),

                    h('div', { className: 'erc404-portfolio-content' },
                        !walletConnected
                            ? h('div', { className: 'portfolio-connect-prompt' },
                                h('p', null, 'Connect your wallet to view your portfolio')
                            )
                            : loading
                                ? h('div', { className: 'portfolio-loading' },
                                    h('div', { className: 'portfolio-spinner' }),
                                    h('p', null, 'Loading your portfolio...')
                                )
                                : [
                                    error && h('div', { key: 'error', className: 'portfolio-error' }, error),
                                    success && h('div', { key: 'success', className: 'portfolio-success' }, success),

                                    h('div', { key: 'balance', className: 'portfolio-balance-section' },
                                        h('div', { className: 'balance-card' },
                                            h('span', { className: 'balance-label' }, 'Token Balance'),
                                            h('span', { className: 'balance-value' }, `${this.formatNumber(tokenBalance)} ${symbol}`)
                                        ),
                                        h('div', { className: 'balance-card' },
                                            h('span', { className: 'balance-label' }, 'NFTs Owned'),
                                            h('span', { className: 'balance-value' }, nfts.length)
                                        ),
                                        mintableNFTs > 0 && h('div', { className: 'mint-action' },
                                            h('span', { className: 'mint-info' }, `You can mint ${mintableNFTs} NFT${mintableNFTs > 1 ? 's' : ''}`),
                                            h('button', {
                                                className: 'portfolio-mint-btn',
                                                onClick: this.bind(this.handleMint),
                                                disabled: txPending
                                            }, txPending ? 'Minting...' : 'Mint NFT')
                                        )
                                    ),

                                    h('div', { key: 'nfts', className: 'portfolio-nfts-section' },
                                        h('h3', null, 'Your NFTs'),
                                        nfts.length === 0
                                            ? h('div', { className: 'no-nfts' },
                                                h('p', null, "You don't own any NFTs from this collection yet."),
                                                mintableNFTs > 0 && h('p', null, 'Mint NFTs from your token balance above!')
                                            )
                                            : h('div', { className: 'portfolio-nft-grid' },
                                                ...nfts.map(nft => this.renderNFTCard(nft))
                                            )
                                    )
                                ]
                    )
                )
            )
        );
    }
}

export default ERC404PortfolioModal;
