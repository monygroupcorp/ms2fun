/**
 * ERC1155PortfolioModal
 * Shows user's owned editions with balances, detail view, and transfer ability.
 * Opens via eventBus 'erc1155:portfolio:open'.
 * Reuses shared portfolio-* CSS classes from erc721.css.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { renderIpfsImage } from '../../utils/ipfsImageHelper.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC1155PortfolioModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            open: false,
            view: 'grid',
            loading: false,
            editions: [],     // { editionId, balance, metadata, imageUrl }
            selectedEdition: null,
            sendQuantity: 1,
            txPending: false,
            error: null,
            success: null
        };
    }

    get adapter() { return this.props.adapter; }

    async didMount() {
        // Load shared portfolio CSS (defined in erc721.css)
        stylesheetLoader.load('src/components/ERC721/erc721.css', 'portfolio-shared-styles');

        const unsub1 = eventBus.on('erc1155:portfolio:open', () => this.open());
        const unsub2 = eventBus.on('erc1155:mint:success', () => {
            if (this.state.open) this.loadEditions();
        });

        this._handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (this.state.view === 'detail') {
                    this.backToGrid();
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
        this.setState({ open: true, view: 'grid', selectedEdition: null, error: null, success: null });
        document.body.style.overflow = 'hidden';
        await this.loadEditions();
    }

    close() {
        this.setState({ open: false });
        document.body.style.overflow = '';
    }

    backToGrid() {
        this.setState({ view: 'grid', selectedEdition: null, error: null, success: null, sendQuantity: 1 });
    }

    async loadEditions() {
        if (!walletService.isConnected() || !this.adapter) return;
        this.setState({ loading: true, error: null });

        try {
            const address = walletService.getAddress();
            const allEditions = await this.adapter.getEditions();
            const owned = [];

            for (const edition of allEditions) {
                try {
                    const balance = await this.adapter.getBalanceForEdition(address, edition.id);
                    const balanceNum = parseInt(balance);
                    if (balanceNum > 0) {
                        const imageUrl = edition.metadata?.image
                            ? this.resolveImageUrl(edition.metadata.image)
                            : null;
                        owned.push({
                            editionId: edition.id,
                            balance: balanceNum,
                            metadata: edition.metadata,
                            imageUrl,
                            price: edition.price
                        });
                    }
                } catch (e) { /* skip */ }
            }

            this.setState({ editions: owned, loading: false });
        } catch (error) {
            console.error('[ERC1155PortfolioModal] Failed to load editions:', error);
            this.setState({ loading: false, error: 'Failed to load portfolio' });
        }
    }

    resolveImageUrl(image) {
        if (!image) return null;
        if (image.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${image.slice(7)}`;
        return image;
    }

    selectEdition(edition) {
        this.setState({ view: 'detail', selectedEdition: edition, error: null, success: null, sendQuantity: 1 });
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

        const qtyInput = this._el?.querySelector('.send-quantity-input');
        const quantity = parseInt(qtyInput?.value) || 1;
        const { selectedEdition } = this.state;

        if (quantity < 1 || quantity > selectedEdition.balance) {
            this.setState({ error: `Quantity must be between 1 and ${selectedEdition.balance}` });
            return;
        }

        this.setState({ txPending: true, error: null });

        try {
            const fromAddress = walletService.getAddress();
            await this.adapter.safeTransferFrom(fromAddress, sendAddress, selectedEdition.editionId, quantity);

            this.setState({ txPending: false, success: `Transferred ${quantity}x!` });

            setTimeout(async () => {
                await this.loadEditions();
                this.setState({ view: 'grid', selectedEdition: null, success: null });
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
        if (oldState.editions !== newState.editions) return true;
        if (oldState.txPending !== newState.txPending) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.success !== newState.success) return true;
        return false;
    }

    render() {
        const { open, view, editions, loading, selectedEdition, txPending, error, success } = this.state;

        if (!open) {
            return h('div', { className: 'portfolio-modal-container', style: { display: 'none' } });
        }

        return h('div', { className: 'portfolio-modal-container' },
            h('div', {
                className: 'portfolio-overlay',
                onClick: this.bind(this.handleOverlayClick)
            },
                h('div', { className: 'portfolio-modal' },
                    // Header
                    h('div', { className: 'portfolio-header' },
                        view === 'detail'
                            ? h('button', { className: 'portfolio-back', onClick: this.bind(this.backToGrid) }, '\u2190 Back')
                            : h('h2', null, 'My Editions'),
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
        const { editions, error } = this.state;

        if (error) return h('div', { className: 'portfolio-error' }, error);

        if (editions.length === 0) {
            return h('div', { className: 'portfolio-empty' },
                h('p', { className: 'empty-title' }, 'No editions yet'),
                h('p', { className: 'empty-hint' }, 'Mint an edition to start your collection')
            );
        }

        return h('div', { className: 'portfolio-nft-grid' },
            ...editions.map(ed => this.renderEditionCard(ed))
        );
    }

    renderEditionCard(edition) {
        const name = edition.metadata?.name || `Edition #${edition.editionId}`;
        const imageHtml = edition.imageUrl
            ? renderIpfsImage(edition.imageUrl, name, 'portfolio-nft-img')
            : null;

        return h('div', {
            className: 'portfolio-nft-card',
            onClick: () => { this.selectEdition(edition); }
        },
            h('div', { className: 'portfolio-nft-image' },
                imageHtml
                    ? h('div', { innerHTML: imageHtml })
                    : h('div', { className: 'nft-placeholder' }, `#${edition.editionId}`)
            ),
            h('div', { className: 'portfolio-nft-info' },
                h('div', { className: 'nft-name' }, name),
                h('div', { className: 'nft-id' }, `Edition #${edition.editionId}`),
                h('div', { className: 'nft-bid' }, `Owned: ${edition.balance}`)
            )
        );
    }

    renderDetailContent() {
        const { selectedEdition, txPending, error, success } = this.state;
        if (!selectedEdition) return null;

        const name = selectedEdition.metadata?.name || `Edition #${selectedEdition.editionId}`;
        const description = selectedEdition.metadata?.description || '';
        const imageHtml = selectedEdition.imageUrl
            ? renderIpfsImage(selectedEdition.imageUrl, name, 'portfolio-detail-img')
            : null;

        return h('div', { className: 'portfolio-detail' },
            h('div', { className: 'portfolio-detail-image' },
                imageHtml
                    ? h('div', { innerHTML: imageHtml })
                    : h('div', { className: 'nft-placeholder-lg' }, `#${selectedEdition.editionId}`)
            ),
            h('div', { className: 'portfolio-detail-info' },
                h('h3', { className: 'detail-name' }, name),
                h('div', { className: 'detail-meta' },
                    h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'Edition'),
                        h('span', { className: 'detail-value' }, `#${selectedEdition.editionId}`)
                    ),
                    h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'You Own'),
                        h('span', { className: 'detail-value' }, `${selectedEdition.balance}`)
                    ),
                    h('div', { className: 'detail-row' },
                        h('span', { className: 'detail-label' }, 'Standard'),
                        h('span', { className: 'detail-value' }, 'ERC1155')
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
                    selectedEdition.balance > 1 && h('div', { className: 'send-quantity-row' },
                        h('label', { className: 'send-quantity-label' }, 'Quantity:'),
                        h('input', {
                            type: 'number',
                            className: 'send-quantity-input',
                            min: '1',
                            max: selectedEdition.balance.toString(),
                            value: '1',
                            disabled: txPending
                        })
                    ),
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

export default ERC1155PortfolioModal;
