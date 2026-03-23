/**
 * ERC721PortfolioModal
 * Shows user's owned auction NFTs with detail view and transfer ability.
 * Opens via eventBus 'erc721:portfolio:open'.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';

export class ERC721PortfolioModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            open: false,
            view: 'grid',   // 'grid' | 'detail'
            loading: false,
            nfts: [],
            selectedNFT: null,
            txPending: false,
            error: null,
            success: null
        };
    }

    get adapter() { return this.props.adapter; }

    async didMount() {
        const unsub1 = eventBus.on('erc721:portfolio:open', () => this.open());
        const unsub2 = eventBus.on('transaction:confirmed', () => {
            if (this.state.open) this.loadNFTs();
        });

        this._handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (this.state.view === 'detail') {
                    this.state.view = 'grid';
                    this.state.selectedNFT = null;
                    this.state.error = null;
                    this.state.success = null;
                    this.setState({});
                } else {
                    this.close();
                }
            }
        };
        document.addEventListener('keydown', this._handleKeyDown);

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            document.removeEventListener('keydown', this._handleKeyDown);
        });
    }

    async open() {
        this.setState({ open: true, view: 'grid', selectedNFT: null, error: null, success: null });
        document.body.style.overflow = 'hidden';
        await this.loadNFTs();
    }

    close() {
        this.setState({ open: false });
        document.body.style.overflow = '';
    }

    async loadNFTs() {
        if (!walletService.isConnected() || !this.adapter?.contract) return;
        this.setState({ loading: true, error: null });

        try {
            const walletAddress = walletService.getAddress().toLowerCase();

            // Use AuctionSettled events to find NFTs won by user
            const settlements = await this.adapter.getSettlementHistory();
            const wonByUser = settlements.filter(s => s.winner.toLowerCase() === walletAddress);

            // Verify ownership (user may have transferred away) and load metadata
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const nfts = [];

            for (const s of wonByUser) {
                try {
                    const owner = await this.adapter.executeContractCall('ownerOf', [s.tokenId]);
                    if (owner.toLowerCase() !== walletAddress) continue;

                    const tokenURI = await this.adapter.executeContractCall('tokenURI', [s.tokenId]).catch(() => null);
                    let metadata = null;
                    let imageUrl = null;

                    if (tokenURI) {
                        metadata = this.parseMetadata(tokenURI);
                        if (metadata?.image) imageUrl = this.resolveImageUrl(metadata.image);
                    }

                    nfts.push({
                        tokenId: s.tokenId,
                        metadata,
                        imageUrl,
                        winningBid: ethers.utils.formatEther(s.amount)
                    });
                } catch (e) { /* skip */ }
            }

            // Also check Transfer events TO user (in case they received via transfer, not auction)
            try {
                const fromBlock = await this.adapter._getDeployBlock();
                const filter = this.adapter.contract.filters.Transfer(null, walletAddress);
                const events = await this.adapter.contract.queryFilter(filter, fromBlock, 'latest');
                const candidateIds = [...new Set(events.map(e => parseInt(e.args.tokenId.toString())))];
                const existingIds = new Set(nfts.map(n => n.tokenId));

                for (const tokenId of candidateIds) {
                    if (existingIds.has(tokenId)) continue;
                    try {
                        const owner = await this.adapter.executeContractCall('ownerOf', [tokenId]);
                        if (owner.toLowerCase() !== walletAddress) continue;

                        const tokenURI = await this.adapter.executeContractCall('tokenURI', [tokenId]).catch(() => null);
                        let metadata = null;
                        let imageUrl = null;
                        if (tokenURI) {
                            metadata = this.parseMetadata(tokenURI);
                            if (metadata?.image) imageUrl = this.resolveImageUrl(metadata.image);
                        }
                        nfts.push({ tokenId, metadata, imageUrl, winningBid: null });
                    } catch (e) { /* skip */ }
                }
            } catch (e) { /* Transfer events may not be available */ }

            this.setState({ nfts, loading: false });
        } catch (error) {
            console.error('[ERC721PortfolioModal] Failed to load NFTs:', error);
            this.setState({ loading: false, error: 'Failed to load portfolio' });
        }
    }

    parseMetadata(uri) {
        if (!uri) return null;
        try {
            if (uri.startsWith('data:application/json,')) {
                return JSON.parse(decodeURIComponent(uri.replace('data:application/json,', '')));
            }
            if (uri.startsWith('data:application/json;base64,')) {
                return JSON.parse(atob(uri.replace('data:application/json;base64,', '')));
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    resolveImageUrl(image) {
        if (!image) return null;
        if (image.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${image.slice(7)}`;
        return image;
    }

    selectNFT(nft) {
        this.setState({ view: 'detail', selectedNFT: nft, error: null, success: null });
    }

    backToGrid() {
        this.setState({ view: 'grid', selectedNFT: null, error: null, success: null });
    }

    async handleSend() {
        const input = this._el?.querySelector('.send-address-input');
        const sendAddress = input?.value?.trim();
        if (!sendAddress) {
            this.setState({ error: 'Enter a recipient address' });
            return;
        }

        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        if (!ethers.utils.isAddress(sendAddress)) {
            this.setState({ error: 'Invalid address' });
            return;
        }

        const { selectedNFT } = this.state;
        this.setState({ txPending: true, error: null });

        try {
            const { signer } = walletService.getProviderAndSigner();
            const fromAddress = await signer.getAddress();
            const contractWithSigner = this.adapter.contract.connect(signer);

            const tx = await contractWithSigner['safeTransferFrom(address,address,uint256)'](
                fromAddress, sendAddress, selectedNFT.tokenId
            );
            await tx.wait();

            this.setState({ txPending: false, success: 'Transfer complete!' });

            // Refresh and go back to grid after a moment
            setTimeout(async () => {
                await this.loadNFTs();
                this.setState({ view: 'grid', selectedNFT: null, success: null });
            }, 1500);
        } catch (error) {
            this.setState({ txPending: false, error: error.message || 'Transfer failed' });
        }
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('portfolio-overlay')) {
            if (this.state.view === 'detail') {
                this.backToGrid();
            } else {
                this.close();
            }
        }
    }

    shouldUpdate(oldProps, newProps, oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState.open !== newState.open) return true;
        if (oldState.view !== newState.view) return true;
        if (oldState.loading !== newState.loading) return true;
        if (oldState.nfts !== newState.nfts) return true;
        if (oldState.txPending !== newState.txPending) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.success !== newState.success) return true;
        return false;
    }

    render() {
        const { open, view, nfts, loading, selectedNFT, txPending, error, success } = this.state;

        if (!open) {
            return h('div', { className: 'portfolio-modal-container', style: { display: 'none' } });
        }

        return h('div', { className: 'portfolio-modal-container' },
            h('div', {
                className: 'portfolio-overlay',
                onClick: this.bind(this.handleOverlayClick)
            },
                h('div', { className: 'portfolio-modal' },
                    // Header — always present, content varies by view
                    h('div', { className: 'portfolio-header' },
                        view === 'detail'
                            ? h('button', { className: 'portfolio-back', onClick: this.bind(this.backToGrid) }, '\u2190 Back')
                            : h('h2', null, 'My Collection'),
                        h('button', { className: 'portfolio-close', onClick: this.bind(this.close) }, '\u00d7')
                    ),

                    // Content
                    h('div', { className: 'portfolio-body' },
                        loading
                            ? h('div', { className: 'portfolio-loading' }, 'Loading...')
                            : view === 'detail'
                                ? this.renderDetailContent()
                                : this.renderGridContent()
                    )
                )
            )
        );
    }

    renderGridContent() {
        const { nfts, error } = this.state;

        if (error) return h('div', { className: 'portfolio-error' }, error);

        if (nfts.length === 0) {
            return h('div', { className: 'portfolio-empty' },
                h('p', { className: 'empty-title' }, 'No NFTs yet'),
                h('p', { className: 'empty-hint' }, 'Win an auction to add pieces to your collection')
            );
        }

        return h('div', { className: 'portfolio-nft-grid' },
            ...nfts.map(nft => this.renderNFTCard(nft))
        );
    }

    renderNFTCard(nft) {
        const name = nft.metadata?.name || `Piece #${nft.tokenId}`;
        const imageHtml = nft.imageUrl
            ? renderIpfsImage(nft.imageUrl, name, 'portfolio-nft-img')
            : null;

        return h('div', {
            className: 'portfolio-nft-card',
            onClick: () => { this.selectNFT(nft); }
        },
            h('div', { className: 'portfolio-nft-image' },
                imageHtml
                    ? h('div', { innerHTML: imageHtml })
                    : h('div', { className: 'nft-placeholder' }, `#${nft.tokenId}`)
            ),
            h('div', { className: 'portfolio-nft-info' },
                h('div', { className: 'nft-name' }, name),
                h('div', { className: 'nft-id' }, `#${nft.tokenId}`),
                nft.winningBid && h('div', { className: 'nft-bid' }, `Won at ${nft.winningBid} ETH`)
            )
        );
    }

    renderDetailContent() {
        const { selectedNFT, txPending, error, success } = this.state;
        if (!selectedNFT) return null;

        const name = selectedNFT.metadata?.name || `Piece #${selectedNFT.tokenId}`;
        const description = selectedNFT.metadata?.description || '';
        const imageHtml = selectedNFT.imageUrl
            ? renderIpfsImage(selectedNFT.imageUrl, name, 'portfolio-detail-img')
            : null;

        return h('div', { className: 'portfolio-detail' },
            h('div', { className: 'portfolio-detail-image' },
                imageHtml
                    ? h('div', { innerHTML: imageHtml })
                    : h('div', { className: 'nft-placeholder-lg' }, `#${selectedNFT.tokenId}`)
            ),
            h('div', { className: 'portfolio-detail-info' },
                h('h3', { className: 'detail-name' }, name),
                h('div', { className: 'detail-meta' },
                    h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'Token ID'),
                        h('span', { className: 'detail-value' }, `#${selectedNFT.tokenId}`)
                    ),
                    selectedNFT.winningBid && h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'Won At'),
                        h('span', { className: 'detail-value' }, `${selectedNFT.winningBid} ETH`)
                    ),
                    h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'Standard'),
                        h('span', { className: 'detail-value' }, 'ERC721')
                    )
                ),
                description && h('p', { className: 'detail-description' }, description),

                // Send form
                h('div', { className: 'send-section' },
                    h('div', { className: 'send-title' }, 'Transfer'),
                    h('input', {
                        type: 'text',
                        className: 'send-address-input',
                        placeholder: '0x... recipient address',
                        disabled: txPending
                    }),
                    h('button', {
                        className: 'btn btn-primary send-btn',
                        onClick: this.bind(this.handleSend),
                        disabled: txPending
                    }, txPending ? 'Sending...' : 'Send'),

                    error && h('div', { className: 'send-error' }, error),
                    success && h('div', { className: 'send-success' }, success)
                )
            )
        );
    }
}

export default ERC721PortfolioModal;
