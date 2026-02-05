/**
 * PortfolioModal - Microact Version
 *
 * Modal displaying user's NFT portfolio with search, pagination, and actions.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';
import { fetchJsonWithIpfsSupport } from '../../services/IpfsService.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

export class PortfolioModal extends Component {
    constructor(props = {}) {
        super(props);
        this._allNFTs = [];
        this._filteredNFTs = null;
        this._mintModal = null;
        this._sendModal = null;
        this._reRollModal = null;
        this.state = {
            isOpen: false,
            loading: true,
            nfts: [],
            totalNFTs: 0,
            currentPage: 1,
            itemsPerPage: 8,
            searchQuery: '',
            expandedDetails: {}
        };
    }

    get blockchainService() {
        return this.props.blockchainService;
    }

    async didMount() {
        const unsub1 = eventBus.on('portfolio:open', () => this.open());
        const unsub2 = eventBus.on('portfolio:close', () => this.close());
        const unsub3 = eventBus.on('mint:complete', () => this.handleMintComplete());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
        });
    }

    open() {
        this.setState({ isOpen: true, loading: true });
        document.body.style.overflow = 'hidden';
        this.loadNFTData();
    }

    close() {
        this.setState({ isOpen: false });
        document.body.style.overflow = '';
        eventBus.emit('portfolio:close');
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('portfolio-modal-overlay')) {
            this.close();
        }
    }

    async loadNFTData() {
        try {
            const address = tradingStore.selectConnectedAddress();

            if (!address) {
                console.warn('[PortfolioModal] No address connected');
                this.setState({ loading: false, nfts: [] });
                return;
            }

            const balances = tradingStore.selectBalances();
            const totalNFTs = parseInt(balances.nfts) || 0;

            const nftsWithMetadata = await this.blockchainService.getUserNFTsWithMetadata(address, totalNFTs);

            const processedNFTs = nftsWithMetadata.map(nft => ({
                ...nft,
                processedMetadata: null,
                imageUrl: null
            }));

            // Load metadata for visible NFTs
            const visibleNFTs = processedNFTs.slice(0, this.state.itemsPerPage);
            await this.loadMetadataForNFTs(visibleNFTs);

            this._allNFTs = processedNFTs;

            this.setState({
                loading: false,
                nfts: processedNFTs,
                totalNFTs: totalNFTs
            });

            // Enhance IPFS images after render
            setTimeout(() => {
                if (this._element) {
                    enhanceAllIpfsImages(this._element);
                }
            }, 100);

        } catch (error) {
            console.error('[PortfolioModal] Error loading NFT data:', error);
            this.setState({ loading: false });
        }
    }

    async loadMetadataForNFTs(nfts) {
        const needsMetadata = nfts.filter(nft => !nft.processedMetadata);

        await Promise.all(needsMetadata.map(async (nft) => {
            try {
                if (nft.metadata) {
                    const jsonData = await fetchJsonWithIpfsSupport(nft.metadata);
                    nft.processedMetadata = jsonData;

                    if (jsonData.image) {
                        nft.imageUrl = jsonData.image;
                    }
                }
            } catch (error) {
                console.error(`[PortfolioModal] Error fetching metadata for NFT #${nft.tokenId}:`, error);
            }
        }));
    }

    async handlePageChange(newPage) {
        const allNFTs = this._filteredNFTs || this._allNFTs;
        const { itemsPerPage } = this.state;

        const startIndex = (newPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const visibleNFTs = allNFTs.slice(startIndex, endIndex);

        await this.loadMetadataForNFTs(visibleNFTs);

        this.setState({ currentPage: newPage });
    }

    handleSearchInput(e) {
        this.setState({ searchQuery: e.target.value });
    }

    executeSearch() {
        const { searchQuery } = this.state;

        if (!searchQuery.trim()) {
            this._filteredNFTs = null;
            this.setState({ currentPage: 1 });
            return;
        }

        this._filteredNFTs = this._allNFTs.filter(nft =>
            nft.tokenId.toString().includes(searchQuery) ||
            (nft.processedMetadata?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
        );

        this.setState({ currentPage: 1 });
    }

    toggleDetails(tokenId) {
        const { expandedDetails } = this.state;
        this.setState({
            expandedDetails: {
                ...expandedDetails,
                [tokenId]: !expandedDetails[tokenId]
            }
        });
    }

    async handleSend(tokenId) {
        if (!this._sendModal) {
            const { SendModal } = await import('../SendModal/SendModal.js');
            this._sendModal = new SendModal(tokenId, this.blockchainService);
            const container = this._element?.querySelector('.portfolio-modal-content');
            if (container) {
                this._sendModal.mount(container);
            }
        } else {
            this._sendModal.tokenId = tokenId;
        }
        this._sendModal.show();
    }

    async handleMint() {
        const balances = tradingStore.selectBalances();
        const execForOneNFT = BigInt('1000000000000000000000000');
        const currentExecBalance = BigInt(balances.exec);
        const currentNFTs = parseInt(balances.nfts);
        const potentialNFTs = Number(currentExecBalance / execForOneNFT);
        const maxMintable = Math.max(0, potentialNFTs - currentNFTs);

        if (!this._mintModal) {
            const { MintModal } = await import('../MintModal/MintModal.js');
            this._mintModal = new MintModal(maxMintable, this.blockchainService);
            const container = this._element?.querySelector('.portfolio-modal-content');
            if (container) {
                this._mintModal.mount(container);
            }
        }
        this._mintModal.show();
    }

    async handleReroll() {
        if (!this._reRollModal) {
            const { ReRollModal } = await import('../ReRollModal/ReRollModal.js');
            this._reRollModal = new ReRollModal(this.blockchainService);
            const container = this._element?.querySelector('.portfolio-modal-content');
            if (container) {
                this._reRollModal.mount(container);
            }
        }
        this._reRollModal.show();
    }

    async handleMintComplete() {
        await this.loadNFTData();
    }

    getDisplayNFTs() {
        const allNFTs = this._filteredNFTs || this._allNFTs;
        const { currentPage, itemsPerPage } = this.state;

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;

        return allNFTs.slice(startIndex, endIndex);
    }

    getTotalPages() {
        const allNFTs = this._filteredNFTs || this._allNFTs;
        return Math.ceil(allNFTs.length / this.state.itemsPerPage);
    }

    renderNFTCard(nft) {
        const { expandedDetails } = this.state;
        const isExpanded = expandedDetails[nft.tokenId];
        const { mirror } = tradingStore.selectContracts();

        if (!nft.processedMetadata) {
            return h('div', { key: `nft-${nft.tokenId}`, className: 'nft-card loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, `Loading NFT #${nft.tokenId}...`)
            );
        }

        return h('div', { key: `nft-${nft.tokenId}`, className: 'nft-card' },
            h('div', { className: 'nft-image-container' },
                h('div', {
                    className: 'nft-img-wrapper',
                    innerHTML: renderIpfsImage(nft.imageUrl || '', nft.processedMetadata?.name || 'NFT', 'nft-image')
                })
            ),
            h('div', { className: 'nft-info' },
                h('h3', null, nft.processedMetadata.name),
                h('div', { className: 'nft-buttons' },
                    h('button', {
                        className: 'toggle-details',
                        onClick: () => this.toggleDetails(nft.tokenId)
                    }, isExpanded ? 'Hide Details' : 'Show Details'),
                    h('button', {
                        className: 'send-button',
                        onClick: () => this.handleSend(nft.tokenId)
                    }, 'Send \u2324'),
                    h('a', {
                        className: 'opensea-button',
                        href: `https://opensea.io/assets/${mirror}/${nft.tokenId}`,
                        target: '_blank',
                        rel: 'noopener noreferrer'
                    }, 'View on OpenSea \u26F5')
                ),
                isExpanded && h('div', { className: 'nft-details' },
                    h('p', { className: 'nft-description' }, nft.processedMetadata.description),
                    nft.processedMetadata.attributes && h('div', { className: 'nft-attributes' },
                        ...nft.processedMetadata.attributes.map(attr =>
                            h('div', { key: `attr-${attr.trait_type}`, className: 'nft-attribute' },
                                h('span', { className: 'trait-type' }, `${attr.trait_type}:`),
                                h('span', { className: 'trait-value' }, attr.value)
                            )
                        )
                    )
                )
            )
        );
    }

    renderDashboard() {
        const balances = tradingStore.selectBalances();
        const execBalance = parseInt(balances.exec).toLocaleString();
        const nftBalance = parseInt(balances.nfts).toLocaleString();

        const execForOneNFT = BigInt('1000000000000000000000000');
        const currentExecBalance = BigInt(balances.exec);
        const currentNFTs = parseInt(balances.nfts);
        const potentialNFTs = Number(currentExecBalance / execForOneNFT);
        const remainingNFTs = Math.max(0, potentialNFTs - currentNFTs);

        return h('div', { className: 'portfolio-dashboard' },
            h('div', { className: 'dashboard-stats' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, '$EXEC Balance'),
                    h('span', { className: 'stat-value' }, execBalance)
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'NFTs Owned'),
                    h('span', { className: 'stat-value' }, nftBalance)
                )
            ),

            remainingNFTs > 0 && h('div', { className: 'mint-info' },
                h('div', { className: 'mint-status' },
                    `You can mint ${remainingNFTs} more NFT${remainingNFTs > 1 ? 's' : ''}!`
                ),
                h('button', {
                    className: 'mint-button',
                    onClick: this.bind(this.handleMint)
                }, 'Mint NFT')
            ),

            h('div', { className: 'reroll-section' },
                h('div', { className: 'reroll-info' },
                    h('div', { className: 'reroll-status' }, 'Risk-on procedure: Re-roll your Exec NFTs'),
                    h('button', {
                        className: 'reroll-button',
                        onClick: this.bind(this.handleReroll)
                    }, 'Re-roll NFTs')
                )
            )
        );
    }

    renderPagination() {
        const totalPages = this.getTotalPages();
        const { currentPage } = this.state;

        if (totalPages <= 1) return null;

        const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

        return h('div', { className: 'pagination-container' },
            h('div', { className: 'pagination-controls' },
                ...pages.map(page =>
                    h('button', {
                        key: `page-${page}`,
                        className: `page-btn ${page === currentPage ? 'active' : ''}`,
                        onClick: () => this.handlePageChange(page)
                    }, page)
                )
            )
        );
    }

    render() {
        const { isOpen, loading, searchQuery } = this.state;

        if (!isOpen) {
            return h('div', { className: 'portfolio-modal-container', style: { display: 'none' } });
        }

        const displayNFTs = this.getDisplayNFTs();

        return h('div', { className: 'portfolio-modal-container' },
            h('div', {
                className: 'portfolio-modal-overlay',
                onClick: this.bind(this.handleOverlayClick)
            },
                h('div', { className: 'portfolio-modal' },
                    h('button', {
                        className: 'portfolio-modal-close',
                        onClick: this.bind(this.close)
                    }, '\u00D7'),

                    h('div', { className: 'portfolio-modal-content' },
                        h('h2', null, 'Your Portfolio'),

                        loading
                            ? h('div', { className: 'loading-container' },
                                h('div', { className: 'loading-spinner' }),
                                h('p', null, 'Loading your NFTs...')
                            )
                            : h('div', { className: 'portfolio-content' },
                                h('div', { className: 'search-container' },
                                    h('div', { className: 'search-input-group' },
                                        h('input', {
                                            type: 'text',
                                            className: 'nft-search',
                                            placeholder: 'Search by ID or name...',
                                            value: searchQuery,
                                            onInput: this.bind(this.handleSearchInput),
                                            onKeyPress: (e) => {
                                                if (e.key === 'Enter') this.executeSearch();
                                            }
                                        }),
                                        h('button', {
                                            className: 'search-button',
                                            onClick: this.bind(this.executeSearch)
                                        }, 'Search')
                                    )
                                ),

                                this.renderDashboard(),

                                h('div', { className: 'nft-cards-container' },
                                    displayNFTs.length === 0
                                        ? h('div', { className: 'no-results' },
                                            searchQuery ? `No NFTs found matching "${searchQuery}"` : 'No NFTs found'
                                        )
                                        : displayNFTs.map(nft => this.renderNFTCard(nft))
                                ),

                                this.renderPagination()
                            )
                    )
                )
            )
        );
    }
}

export default PortfolioModal;
