/**
 * ERC404PortfolioModal - Microact Version
 *
 * Modal displaying user's ERC404 tokens and NFTs.
 * Grid view: token balance, NFT count, NFT grid.
 * Detail view: image, metadata, owner, send form, reroll.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404PortfolioModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isOpen: false,
            view: 'grid', // 'grid' | 'detail'
            loading: false,
            tokenBalance: '0',
            tokenBalanceWei: '0',
            nfts: [],
            unit: '0',
            // Detail view
            selectedNFT: null,
            detailOwner: null,
            detailLoading: false,
            // Reroll mode
            rerollMode: false,
            shieldedIds: [], // NFT IDs to exempt from reroll
            // Actions
            txPending: false,
            txType: null,
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
            this.setState({ tokenBalance: '0', tokenBalanceWei: '0', nfts: [], error: null, success: null });
        });
        const unsub4 = eventBus.on('erc404:portfolio:open', () => {
            this.open();
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
        this.setState({ isOpen: true, view: 'grid', selectedNFT: null, error: null, success: null });
        this._keyHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                if (this.state.view === 'detail') {
                    this.backToGrid();
                } else {
                    this.close();
                }
            }
        };
        document.addEventListener('keydown', this._keyHandler);
        document.body.style.overflow = 'hidden';
        this.loadPortfolio();
    }

    close() {
        this.setState({ isOpen: false, view: 'grid', selectedNFT: null, error: null, success: null });
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        document.body.style.overflow = '';
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('erc404-portfolio-overlay')) {
            if (this.state.view === 'detail') {
                this.backToGrid();
            } else {
                this.close();
            }
        }
    }

    backToGrid() {
        this.setState({ view: 'grid', selectedNFT: null, detailOwner: null, error: null, success: null });
    }

    async loadPortfolio() {
        const walletAddress = walletService.getAddress();
        if (!walletAddress) {
            this.setState({ loading: false, error: 'Connect your wallet to view your portfolio' });
            return;
        }

        try {
            this.setState({ loading: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            // Fetch token balance and unit in parallel
            const [balanceWei, unitWei] = await Promise.all([
                this.adapter.getTokenBalance(walletAddress).catch(() => '0'),
                this.adapter.executeContractCall('unit').catch(() => ethers.BigNumber.from(0))
            ]);

            const tokenBalance = ethers.utils.formatUnits(balanceWei, 18);
            const unit = unitWei.toString();

            // Find user's NFTs: query Transfer events TO user for candidate IDs, verify with ownerOf
            let nfts = [];
            const mirror = this.adapter?.mirrorContract;
            if (mirror) {
                try {
                    const inEvents = await mirror.queryFilter(
                        mirror.filters.Transfer(null, walletAddress)
                    ).catch(() => []);

                    // Dedupe candidate token IDs
                    const candidateIds = [...new Set(
                        inEvents.map(ev => (ev.args[2] || ev.args.tokenId).toString())
                    )];

                    // Verify ownership + load metadata in parallel
                    if (candidateIds.length > 0) {
                        const verified = await Promise.all(candidateIds.map(async (tokenId) => {
                            try {
                                const owner = await mirror.ownerOf(tokenId);
                                if (owner.toLowerCase() !== walletAddress.toLowerCase()) return null;

                                const nft = { tokenId, metadata: null, imageUrl: null };
                                const tokenUri = await mirror.tokenURI(tokenId).catch(() => null);
                                if (tokenUri) {
                                    nft.metadata = await this.parseMetadata(tokenUri);
                                    if (nft.metadata?.image) {
                                        nft.imageUrl = this.resolveImageUrl(nft.metadata.image);
                                    }
                                }
                                return nft;
                            } catch (e) { return null; }
                        }));
                        nfts = verified.filter(Boolean);
                    }
                } catch (e) {
                    console.warn('[ERC404PortfolioModal] NFT enumeration error:', e);
                }
            }

            this.setState({ loading: false, tokenBalance, tokenBalanceWei: balanceWei.toString(), nfts, unit });

        } catch (error) {
            console.error('[ERC404PortfolioModal] Load error:', error);
            this.setState({ loading: false, error: error.message || 'Failed to load portfolio' });
        }
    }

    async parseMetadata(uri) {
        if (!uri) return null;
        if (uri.startsWith('data:application/json')) {
            try {
                return JSON.parse(atob(uri.split(',')[1]));
            } catch (e) { return null; }
        }
        let fetchUrl = uri;
        if (uri.startsWith('ipfs://')) {
            fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }
        try {
            const res = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } });
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    }

    resolveImageUrl(url) {
        if (!url) return null;
        if (url.startsWith('ipfs://')) return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
        return url;
    }

    async openDetail(nft) {
        this.setState({
            view: 'detail',
            selectedNFT: nft,
            detailOwner: null,
            detailLoading: true,
            error: null,
            success: null
        });

        // Load owner
        try {
            const mirror = this.adapter?.mirrorContract;
            if (mirror) {
                const owner = await mirror.ownerOf(nft.tokenId);
                this.setState({ detailOwner: owner, detailLoading: false });
            } else {
                this.setState({ detailLoading: false });
            }
        } catch (e) {
            this.setState({ detailLoading: false });
        }
    }

    async handleSend() {
        const { selectedNFT } = this.state;
        if (!selectedNFT) return;

        // Read address from DOM (uncontrolled input to avoid re-render focus loss)
        const input = this._el?.querySelector('.send-address-input');
        const sendAddress = input?.value?.trim();
        if (!sendAddress) {
            this.setState({ error: 'Enter a recipient address' });
            return;
        }

        // Basic address validation
        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        if (!ethers.utils.isAddress(sendAddress)) {
            this.setState({ error: 'Invalid address' });
            return;
        }

        try {
            this.setState({ txPending: true, txType: 'send', error: null, success: null });
            await this.adapter.transferNFT(selectedNFT.tokenId, sendAddress);
            this.setState({
                txPending: false,
                txType: null,
                success: `NFT #${selectedNFT.tokenId} sent!`
            });
            // Refresh and go back to grid
            await this.loadPortfolio();
            this.setState({ view: 'grid', selectedNFT: null });
        } catch (error) {
            console.error('[ERC404PortfolioModal] Send error:', error);
            this.setState({
                txPending: false,
                txType: null,
                error: error.message || 'Transfer failed'
            });
        }
    }

    // ─── Reroll Mode ───

    enterRerollMode() {
        // Default: all NFTs shielded (user unshields what they want rerolled)
        const allIds = this.state.nfts.map(n => n.tokenId);
        this.setState({ rerollMode: true, shieldedIds: allIds, error: null, success: null });
    }

    exitRerollMode() {
        this.setState({ rerollMode: false, shieldedIds: [], error: null });
    }

    toggleShield(tokenId) {
        const { shieldedIds } = this.state;
        const isShielded = shieldedIds.includes(tokenId);
        this.setState({
            shieldedIds: isShielded
                ? shieldedIds.filter(id => id !== tokenId)
                : [...shieldedIds, tokenId]
        });
    }

    async executeReroll() {
        if (!walletService.getAddress()) {
            this.setState({ error: 'Connect your wallet' });
            return;
        }

        const { nfts, shieldedIds, unit } = this.state;
        const toReroll = nfts.filter(n => !shieldedIds.includes(n.tokenId));

        if (toReroll.length === 0) {
            this.setState({ error: 'Unshield at least one NFT to reroll' });
            return;
        }

        try {
            this.setState({ txPending: true, txType: 'reroll', error: null, success: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            // tokenAmount = unit * ALL NFTs (shielded + rerolled)
            // Contract calculates: rerollAmount = tokenAmount - (exemptCount * unit)
            const unitBN = ethers.BigNumber.from(unit || '0');
            const tokenAmount = unitBN.mul(nfts.length).toString();

            await this.adapter.rerollSelectedNFTs(tokenAmount, shieldedIds);

            this.setState({
                txPending: false,
                txType: null,
                rerollMode: false,
                shieldedIds: [],
                success: `${toReroll.length} NFT${toReroll.length > 1 ? 's' : ''} rerolled!`
            });

            await this.loadPortfolio();
        } catch (error) {
            console.error('[ERC404PortfolioModal] Reroll error:', error);
            this.setState({
                txPending: false,
                txType: null,
                error: error.message || 'Reroll failed'
            });
        }
    }

    formatNumber(num) {
        const n = parseFloat(num);
        if (isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(n < 1 ? 4 : 2);
    }

    truncateAddress(addr) {
        if (!addr || addr.length < 10) return addr || '';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }

    // ─── Render Helpers ───

    renderGridView() {
        const { tokenBalance, nfts, txPending, error, success, unit } = this.state;
        const symbol = this.projectData?.symbol || 'TOKEN';
        const walletConnected = !!walletService.getAddress();

        if (!walletConnected) {
            return h('div', { className: 'portfolio-connect-prompt' },
                h('p', null, 'Connect your wallet to view your portfolio')
            );
        }

        // Calculate mintable NFTs from token balance
        const { ethers } = window; // Already imported during loadPortfolio
        let mintableNFTs = 0;
        try {
            if (unit && unit !== '0') {
                const balBN = ethers?.BigNumber?.from(this.state.tokenBalanceWei || '0');
                const unitBN = ethers?.BigNumber?.from(unit);
                if (balBN && unitBN && !unitBN.isZero()) {
                    mintableNFTs = balBN.div(unitBN).toNumber();
                }
            }
        } catch (e) { /* ignore */ }

        return [
            error && h('div', { key: 'error', className: 'portfolio-error' }, error),
            success && h('div', { key: 'success', className: 'portfolio-success' }, success),

            // Balance section
            h('div', { key: 'balance', className: 'portfolio-balance-section' },
                h('div', { className: 'balance-card' },
                    h('span', { className: 'balance-label' }, 'Token Balance'),
                    h('span', { className: 'balance-value' }, `${this.formatNumber(tokenBalance)} ${symbol}`)
                ),
                h('div', { className: 'balance-card' },
                    h('span', { className: 'balance-label' }, 'NFTs Owned'),
                    h('span', { className: 'balance-value' }, String(nfts.length))
                )
            ),

            // NFTs section
            h('div', { key: 'nfts', className: 'portfolio-nfts-section' },
                h('div', { className: 'portfolio-nfts-header' },
                    h('div', { className: 'portfolio-section-header' }, 'Your NFTs'),
                    nfts.length > 0 && !this.state.rerollMode && h('button', {
                        className: 'reroll-mode-btn',
                        onClick: this.bind(this.enterRerollMode),
                        disabled: txPending
                    }, 'Reroll')
                ),

                // Reroll mode toolbar
                this.state.rerollMode && this.renderRerollToolbar(),

                nfts.length === 0
                    ? h('div', { className: 'portfolio-empty' },
                        h('p', null, 'No NFTs from this collection yet.')
                    )
                    : h('div', { className: 'portfolio-nft-grid' },
                        ...nfts.map(nft => this.renderNFTCard(nft))
                    )
            )
        ];
    }

    renderRerollToolbar() {
        const { nfts, shieldedIds, txPending, txType } = this.state;
        const toRerollCount = nfts.length - shieldedIds.length;

        return h('div', { className: 'reroll-toolbar' },
            h('div', { className: 'reroll-info' },
                h('span', null, `${shieldedIds.length} shielded`),
                h('span', { className: 'reroll-separator' }, '/'),
                h('span', { className: toRerollCount > 0 ? 'reroll-count-active' : '' },
                    `${toRerollCount} to reroll`
                )
            ),
            h('div', { className: 'reroll-actions' },
                h('button', {
                    className: 'reroll-cancel-btn',
                    onClick: this.bind(this.exitRerollMode),
                    disabled: txPending
                }, 'Cancel'),
                h('button', {
                    className: 'reroll-confirm-btn',
                    onClick: this.bind(this.executeReroll),
                    disabled: txPending || toRerollCount === 0
                }, txPending && txType === 'reroll'
                    ? 'Rerolling...'
                    : `Reroll ${toRerollCount} NFT${toRerollCount !== 1 ? 's' : ''}`)
            )
        );
    }

    renderNFTCard(nft) {
        const { rerollMode, shieldedIds } = this.state;
        const isShielded = shieldedIds.includes(nft.tokenId);

        const cardClass = rerollMode
            ? `portfolio-nft-card reroll-selectable ${isShielded ? 'shielded' : 'unshielded'}`
            : 'portfolio-nft-card';

        const onClick = rerollMode
            ? () => this.toggleShield(nft.tokenId)
            : () => this.openDetail(nft);

        return h('div', {
            key: `nft-${nft.tokenId}`,
            className: cardClass,
            onClick
        },
            h('div', { className: 'portfolio-nft-image' },
                nft.imageUrl
                    ? h('img', { src: nft.imageUrl, alt: nft.metadata?.name || `#${nft.tokenId}`, className: 'nft-img' })
                    : h('div', { className: 'nft-placeholder' },
                        h('span', null, `#${nft.tokenId}`)
                    ),
                // Shield/reroll overlay in reroll mode
                rerollMode && h('div', { className: `reroll-overlay ${isShielded ? 'shielded' : 'unshielded'}` },
                    h('span', null, isShielded ? 'SHIELDED' : 'REROLL')
                )
            ),
            h('div', { className: 'portfolio-nft-info' },
                h('span', { className: 'nft-name' }, nft.metadata?.name || `#${nft.tokenId}`),
                h('span', { className: 'nft-id' }, `#${nft.tokenId}`)
            )
        );
    }

    renderDetailView() {
        const { selectedNFT, detailOwner, detailLoading, txPending, txType, error, success } = this.state;
        if (!selectedNFT) return null;

        const name = selectedNFT.metadata?.name || `#${selectedNFT.tokenId}`;
        const description = selectedNFT.metadata?.description;
        const attributes = selectedNFT.metadata?.attributes;
        const imageSrc = selectedNFT.imageUrl;

        const isMyNFT = detailOwner && walletService.getAddress() &&
            detailOwner.toLowerCase() === walletService.getAddress().toLowerCase();

        return [
            error && h('div', { key: 'error', className: 'portfolio-error' }, error),
            success && h('div', { key: 'success', className: 'portfolio-success' }, success),

            // NFT detail layout
            h('div', { key: 'detail', className: 'portfolio-detail-content' },
                // Image
                h('div', { className: 'portfolio-detail-image' },
                    imageSrc
                        ? h('img', { src: imageSrc, alt: name, className: 'detail-img' })
                        : h('div', { className: 'detail-placeholder' },
                            h('span', null, `#${selectedNFT.tokenId}`)
                        )
                ),

                // Info panel
                h('div', { className: 'portfolio-detail-info' },
                    h('h3', { className: 'detail-name' }, name),

                    h('div', { className: 'detail-meta' },
                        h('div', { className: 'detail-row' },
                            h('span', { className: 'detail-label' }, 'Token ID'),
                            h('span', { className: 'detail-value' }, `#${selectedNFT.tokenId}`)
                        ),
                        h('div', { className: 'detail-row' },
                            h('span', { className: 'detail-label' }, 'Owner'),
                            h('span', { className: 'detail-value' },
                                detailLoading ? '...' : this.truncateAddress(detailOwner)
                            )
                        )
                    ),

                    // Description
                    description && h('div', { className: 'detail-description' },
                        h('div', { className: 'detail-section-title' }, 'Description'),
                        h('p', null, description)
                    ),

                    // Attributes
                    attributes && attributes.length > 0 && h('div', { className: 'detail-attributes' },
                        h('div', { className: 'detail-section-title' }, 'Attributes'),
                        h('div', { className: 'detail-attributes-grid' },
                            ...attributes.map((attr, i) =>
                                h('div', { key: `attr-${i}`, className: 'detail-attribute' },
                                    h('div', { className: 'attr-type' }, attr.trait_type || 'Property'),
                                    h('div', { className: 'attr-value' }, String(attr.value ?? ''))
                                )
                            )
                        )
                    )
                )
            ),

            // Actions (only if user owns this NFT)
            isMyNFT && h('div', { key: 'actions', className: 'portfolio-detail-actions' },
                h('div', { className: 'detail-action-group' },
                    h('div', { className: 'detail-section-title' }, 'Send'),
                    h('div', { className: 'detail-send-form' },
                        h('input', {
                            type: 'text',
                            className: 'send-address-input',
                            placeholder: '0x... recipient address',
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'send-btn',
                            onClick: this.bind(this.handleSend),
                            disabled: txPending
                        }, txPending && txType === 'send' ? 'Sending...' : 'Send')
                    )
                )
            )
        ];
    }

    shouldUpdate(oldProps, newProps, oldState, newState) {
        // Always re-render for any state change in this modal
        return true;
    }

    render() {
        const { isOpen, view, loading } = this.state;

        if (!isOpen) {
            return h('div', { className: 'erc404-portfolio-modal-container' });
        }

        return h('div', { className: 'erc404-portfolio-modal-container' },
            h('div', {
                className: 'erc404-portfolio-overlay',
                onClick: this.bind(this.handleOverlayClick)
            },
                h('div', { className: 'erc404-portfolio-modal' },
                    // Header
                    h('div', { className: 'erc404-portfolio-header' },
                        view === 'detail'
                            ? h('button', {
                                className: 'portfolio-back-btn',
                                onClick: this.bind(this.backToGrid)
                            }, '\u2190 Back')
                            : h('div', { className: 'portfolio-title-row' },
                                h('h2', null, 'My Portfolio'),
                                this.projectData?.name && h('span', { className: 'portfolio-project-name' }, this.projectData.name)
                            ),
                        h('button', {
                            className: 'erc404-portfolio-close',
                            onClick: this.bind(this.close)
                        }, '\u00D7')
                    ),

                    // Content
                    h('div', { className: 'erc404-portfolio-content' },
                        loading
                            ? h('div', { className: 'portfolio-loading' },
                                h('div', { className: 'portfolio-spinner' }),
                                h('p', null, 'Loading...')
                            )
                            : view === 'detail'
                                ? this.renderDetailView()
                                : this.renderGridView()
                    )
                )
            )
        );
    }
}

export default ERC404PortfolioModal;
