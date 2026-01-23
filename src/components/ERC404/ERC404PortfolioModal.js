/**
 * ERC404PortfolioModal Component
 *
 * Modal displaying user's ERC404 tokens and NFTs with mint and reroll controls.
 * Provides a unified view of user's holdings for a specific ERC404 project.
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404PortfolioModal extends Component {
    constructor(adapter, projectData) {
        super();
        this.adapter = adapter;
        this.projectData = projectData;
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

        // Bind methods
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.loadPortfolio = this.loadPortfolio.bind(this);
        this.handleMint = this.handleMint.bind(this);
        this.handleReroll = this.handleReroll.bind(this);
        this.handleOverlayClick = this.handleOverlayClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    onMount() {
        stylesheetLoader.load('src/components/ERC404/erc404-portfolio.css', 'erc404-portfolio-styles');
        this.setupSubscriptions();
    }

    onUnmount() {
        stylesheetLoader.unload('erc404-portfolio-styles');
        document.removeEventListener('keydown', this.handleKeyDown);
    }

    setupSubscriptions() {
        this.subscribe('transaction:confirmed', () => {
            if (this.state.isOpen) {
                this.loadPortfolio();
            }
        });
        this.subscribe('wallet:connected', () => {
            if (this.state.isOpen) {
                this.loadPortfolio();
            }
        });
        this.subscribe('wallet:disconnected', () => {
            this.setState({
                tokenBalance: '0',
                nfts: [],
                error: null,
                success: null
            });
        });
    }

    /**
     * Open the modal and load portfolio data
     */
    open() {
        this.setState({ isOpen: true, error: null, success: null });
        document.addEventListener('keydown', this.handleKeyDown);
        document.body.style.overflow = 'hidden';
        this.loadPortfolio();
    }

    /**
     * Close the modal
     */
    close() {
        this.setState({ isOpen: false, selectedNFT: null, error: null, success: null });
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.style.overflow = '';
        eventBus.emit('portfolio:close');
    }

    /**
     * Handle escape key to close modal
     */
    handleKeyDown(e) {
        if (e.key === 'Escape' && this.state.isOpen) {
            this.close();
        }
    }

    /**
     * Handle click on overlay to close modal
     */
    handleOverlayClick(e) {
        if (e.target.classList.contains('erc404-portfolio-overlay')) {
            this.close();
        }
    }

    /**
     * Load user's portfolio data
     */
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

            // Get token balance
            let tokenBalance = '0';
            try {
                const balanceWei = await this.adapter.getTokenBalance(walletAddress);
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                tokenBalance = ethers.utils.formatUnits(balanceWei, 18);
            } catch (e) {
                console.warn('[ERC404PortfolioModal] Error getting token balance:', e);
            }

            // Get NFT balance and IDs
            let nfts = [];
            try {
                const nftIds = await this.adapter.getUserNFTIds(walletAddress);
                if (nftIds && nftIds.length > 0) {
                    // Load metadata for each NFT
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

            this.setState({
                loading: false,
                tokenBalance,
                nfts
            });

            // Enhance IPFS images after render
            this.setTimeout(() => {
                if (this.element) {
                    enhanceAllIpfsImages(this.element);
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

    /**
     * Handle minting NFTs from token balance
     */
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
            // Mint 1 NFT (1 token = 1 NFT in ERC404)
            const amountWei = ethers.utils.parseUnits('1', 18).toString();

            await this.adapter.balanceMint(amountWei);

            this.setState({
                txPending: false,
                success: 'NFT minted successfully!'
            });

            // Reload portfolio after mint
            await this.loadPortfolio();

        } catch (error) {
            console.error('[ERC404PortfolioModal] Mint error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Failed to mint NFT'
            });
        }
    }

    /**
     * Handle rerolling an NFT
     * @param {string} tokenId - NFT token ID to reroll
     */
    async handleReroll(tokenId) {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null, selectedNFT: tokenId });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            // Use token balance for reroll, exempting the selected NFT (keeping it)
            // If we want to reroll the selected NFT, we pass an empty exemption list
            const tokenBalanceWei = ethers.utils.parseUnits(this.state.tokenBalance, 18).toString();

            // Reroll with empty exemption list to reroll all NFTs
            await this.adapter.rerollSelectedNFTs(tokenBalanceWei, []);

            this.setState({
                txPending: false,
                selectedNFT: null,
                success: 'NFT rerolled successfully!'
            });

            // Reload portfolio after reroll
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

    /**
     * Format number for display
     */
    formatNumber(num) {
        const n = parseFloat(num);
        if (isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Setup DOM event listeners after render
     */
    setupDOMEventListeners() {
        if (!this.element) return;

        // Close button
        const closeBtn = this.element.querySelector('.erc404-portfolio-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', this.close);
        }

        // Overlay click
        const overlay = this.element.querySelector('.erc404-portfolio-overlay');
        if (overlay) {
            overlay.addEventListener('click', this.handleOverlayClick);
        }

        // Mint button
        const mintBtn = this.element.querySelector('.portfolio-mint-btn');
        if (mintBtn) {
            mintBtn.addEventListener('click', this.handleMint);
        }

        // Reroll buttons
        const rerollBtns = this.element.querySelectorAll('.nft-reroll-btn');
        rerollBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tokenId = e.target.dataset.tokenId;
                if (tokenId) {
                    this.handleReroll(tokenId);
                }
            });
        });
    }

    render() {
        if (!this.state.isOpen) {
            return '<div class="erc404-portfolio-modal-container"></div>';
        }

        const { loading, tokenBalance, nfts, txPending, error, success } = this.state;
        const walletConnected = !!walletService.getAddress();
        const symbol = this.projectData?.symbol || 'TOKEN';
        const balance = parseFloat(tokenBalance);
        const mintableNFTs = Math.floor(balance);

        return `
            <div class="erc404-portfolio-modal-container">
                <div class="erc404-portfolio-overlay">
                    <div class="erc404-portfolio-modal">
                        <button class="erc404-portfolio-close">&times;</button>

                        <div class="erc404-portfolio-header">
                            <h2>My Portfolio</h2>
                            ${this.projectData?.name ? `<span class="portfolio-project-name">${this.escapeHtml(this.projectData.name)}</span>` : ''}
                        </div>

                        <div class="erc404-portfolio-content">
                            ${!walletConnected ? `
                                <div class="portfolio-connect-prompt">
                                    <p>Connect your wallet to view your portfolio</p>
                                </div>
                            ` : loading ? `
                                <div class="portfolio-loading">
                                    <div class="portfolio-spinner"></div>
                                    <p>Loading your portfolio...</p>
                                </div>
                            ` : `
                                ${error ? `<div class="portfolio-error">${this.escapeHtml(error)}</div>` : ''}
                                ${success ? `<div class="portfolio-success">${this.escapeHtml(success)}</div>` : ''}

                                <!-- Balance Section -->
                                <div class="portfolio-balance-section">
                                    <div class="balance-card">
                                        <span class="balance-label">Token Balance</span>
                                        <span class="balance-value">${this.formatNumber(tokenBalance)} ${this.escapeHtml(symbol)}</span>
                                    </div>
                                    <div class="balance-card">
                                        <span class="balance-label">NFTs Owned</span>
                                        <span class="balance-value">${nfts.length}</span>
                                    </div>
                                    ${mintableNFTs > 0 ? `
                                        <div class="mint-action">
                                            <span class="mint-info">You can mint ${mintableNFTs} NFT${mintableNFTs > 1 ? 's' : ''}</span>
                                            <button class="portfolio-mint-btn" ${txPending ? 'disabled' : ''}>
                                                ${txPending ? 'Minting...' : 'Mint NFT'}
                                            </button>
                                        </div>
                                    ` : ''}
                                </div>

                                <!-- NFTs Section -->
                                <div class="portfolio-nfts-section">
                                    <h3>Your NFTs</h3>
                                    ${nfts.length === 0 ? `
                                        <div class="no-nfts">
                                            <p>You don't own any NFTs from this collection yet.</p>
                                            ${mintableNFTs > 0 ? '<p>Mint NFTs from your token balance above!</p>' : ''}
                                        </div>
                                    ` : `
                                        <div class="portfolio-nft-grid">
                                            ${nfts.map(nft => `
                                                <div class="portfolio-nft-card">
                                                    <div class="portfolio-nft-image">
                                                        ${nft.imageUrl ?
                                                            renderIpfsImage(nft.imageUrl, nft.metadata?.name || `NFT #${nft.tokenId}`, 'nft-img') :
                                                            `<div class="nft-placeholder"><span>#${nft.tokenId}</span></div>`
                                                        }
                                                    </div>
                                                    <div class="portfolio-nft-info">
                                                        <span class="nft-name">${this.escapeHtml(nft.metadata?.name || `NFT #${nft.tokenId}`)}</span>
                                                        <span class="nft-id">#${nft.tokenId}</span>
                                                    </div>
                                                    <button
                                                        class="nft-reroll-btn"
                                                        data-token-id="${nft.tokenId}"
                                                        ${txPending ? 'disabled' : ''}
                                                    >
                                                        ${this.state.selectedNFT === nft.tokenId && txPending ? 'Rerolling...' : 'Reroll'}
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    `}
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

export default ERC404PortfolioModal;
