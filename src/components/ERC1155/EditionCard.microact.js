/**
 * EditionCard - Microact Version
 *
 * Displays individual edition with image, price, supply, and mint button.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { generateProjectURL } from '../../utils/navigation.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';
import { EditionMintInterface } from './EditionMintInterface.microact.js';

export class EditionCard extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            userBalance: '0',
            loading: false,
            editionUrl: '#',
            mintStats: null,
            pricingInfo: null,
            currentPrice: null
        };
    }

    get edition() {
        return this.props.edition;
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    get project() {
        return this.props.project;
    }

    async didMount() {
        await Promise.all([
            this.loadUserBalance(),
            this.generateEditionURL(),
            this.loadMintStats(),
            this.loadPricingInfo(),
            this.loadCurrentPrice()
        ]);

        // Update price display now that async data is loaded
        this.updatePriceDOM();

        if (this._el) {
            enhanceAllIpfsImages(this._el);
        }

        // Listen for mint success to refresh stats without re-rendering
        const unsub = eventBus.on('erc1155:mint:success', (data) => {
            // Invalidate cache so we get fresh data
            this.refreshAfterMint();
        });
        this.registerCleanup(() => unsub());

        // Listen for admin enabled to inject per-edition controls
        if (EditionCard._adminEnabled) {
            this.injectAdminControls();
        }
        const unsub2 = eventBus.on('erc1155:admin:enabled', () => {
            EditionCard._adminEnabled = true;
            this.injectAdminControls();
        });
        const unsub3 = eventBus.on('erc1155:admin:disabled', () => {
            EditionCard._adminEnabled = false;
            this.removeAdminControls();
        });
        this.registerCleanup(() => { unsub2(); unsub3(); });
    }

    shouldUpdate() {
        // Never re-render — EditionMintInterface is a child that must be preserved
        return false;
    }

    updatePriceDOM() {
        if (!this._el) return;
        const priceStatItems = this._el.querySelectorAll('.edition-stat-item');
        for (const item of priceStatItems) {
            const label = item.querySelector('.edition-stat-label');
            if (label && label.textContent === 'Price') {
                const valueEl = item.querySelector('.edition-stat-value');
                if (!valueEl) break;

                const currentPrice = this.state.currentPrice;
                const pricingModel = this.state.pricingInfo?.pricingModel;

                if (currentPrice && pricingModel && pricingModel !== 0 && pricingModel !== '0') {
                    const current = this.formatPrice(currentPrice);
                    const base = this.formatPrice(this.edition.price);
                    if (current !== base) {
                        valueEl.innerHTML = `${base} ETH <span class="price-arrow">\u2192</span> ${current} ETH`;
                    } else {
                        valueEl.textContent = `${current} ETH (dynamic)`;
                    }
                } else if (currentPrice) {
                    valueEl.textContent = `${this.formatPrice(currentPrice)} ETH`;
                }
                break;
            }
        }
    }

    async refreshAfterMint() {
        if (!this._el) return;
        const el = this._el;

        // Refresh balance
        const address = walletService.getAddress();
        if (address) {
            try {
                const balance = await this.adapter.getBalanceForEdition(address, this.edition.id);
                this.state.userBalance = balance;

                let balanceEl = el.querySelector('.edition-user-balance');
                if (balance !== '0') {
                    if (!balanceEl) {
                        // Create the balance element
                        balanceEl = document.createElement('div');
                        balanceEl.className = 'edition-user-balance';
                        balanceEl.innerHTML = `<span class="edition-stat-label">You own: </span><span class="edition-stat-value">${balance}</span>`;
                        const infoEl = el.querySelector('.edition-info');
                        if (infoEl) infoEl.appendChild(balanceEl);
                    } else {
                        const valueEl = balanceEl.querySelector('.edition-stat-value');
                        if (valueEl) valueEl.textContent = balance;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Refresh mint stats
        try {
            const stats = await this.adapter.getMintStats(this.edition.id);
            this.state.mintStats = stats;

            // Update the "Minted" display
            const mintedStatItems = el.querySelectorAll('.edition-stat-item');
            for (const item of mintedStatItems) {
                const label = item.querySelector('.edition-stat-label');
                if (label && label.textContent === 'Minted') {
                    const valueEl = item.querySelector('.edition-stat-value');
                    const maxSupply = this.edition.maxSupply === '0' ? '∞' : this.edition.maxSupply;
                    if (valueEl) valueEl.textContent = `${stats.minted || stats.totalMinted || '0'}/${maxSupply}`;
                }
            }
        } catch (e) { /* ignore */ }

        // Refresh price for dynamic pricing
        try {
            const currentPrice = await this.adapter.getCurrentPrice(this.edition.id);
            this.state.currentPrice = currentPrice;
            this.updatePriceDOM();
        } catch (e) { /* ignore */ }
    }

    async generateEditionURL() {
        try {
            let project = this.project;
            if (!project) {
                const projectRegistry = serviceFactory.getProjectRegistry();
                project = await projectRegistry.getProject(this.projectId);
            }

            const { detectNetwork } = await import('../../config/network.js');
            const network = detectNetwork();
            const chainId = network.chainId || 1;

            const instanceName = project?.name || project?.displayName;
            const pieceTitle = this.edition.pieceTitle || this.edition.metadata?.name || this.edition.metadata?.displayTitle;

            if (instanceName && pieceTitle) {
                const url = generateProjectURL(
                    null,
                    { name: instanceName },
                    { title: pieceTitle },
                    chainId
                );
                if (url) {
                    this.setState({ editionUrl: url });
                    return;
                }
            }

            console.error('[EditionCard] Cannot generate URL - missing instanceName or pieceTitle:', {
                instanceName,
                pieceTitle,
                projectId: this.projectId,
                editionId: this.edition.id
            });
            this.setState({ editionUrl: null });
        } catch (error) {
            console.error('[EditionCard] Failed to generate edition URL:', error);
            this.setState({ editionUrl: null });
        }
    }

    async loadUserBalance() {
        try {
            const address = walletService.getAddress();
            if (address) {
                const balance = await this.adapter.getBalanceForEdition(address, this.edition.id);
                this.setState({ userBalance: balance });
            }
        } catch (error) {
            console.error('[EditionCard] Failed to load user balance:', error);
        }
    }

    async loadMintStats() {
        try {
            const stats = await this.adapter.getMintStats(this.edition.id);
            this.setState({ mintStats: stats });
        } catch (error) {
            console.error('[EditionCard] Failed to load mint stats:', error);
        }
    }

    async loadPricingInfo() {
        try {
            const pricingInfo = await this.adapter.getPricingInfo(this.edition.id);
            this.setState({ pricingInfo });
        } catch (error) {
            console.error('[EditionCard] Failed to load pricing info:', error);
        }
    }

    async loadCurrentPrice() {
        try {
            const currentPrice = await this.adapter.getCurrentPrice(this.edition.id);
            this.setState({ currentPrice });
        } catch (error) {
            console.error('[EditionCard] Failed to load current price:', error);
        }
    }

    injectAdminControls() {
        if (!this._el || this._el.querySelector('.edition-admin-controls')) return;

        const controls = document.createElement('div');
        controls.className = 'edition-admin-controls';

        const updateBtn = document.createElement('button');
        updateBtn.className = 'btn btn-secondary btn-sm';
        updateBtn.textContent = 'Update Metadata';
        updateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            eventBus.emit('erc1155:admin:update-metadata', { editionId: this.edition.id });
        });

        const styleBtn = document.createElement('button');
        styleBtn.className = 'btn btn-secondary btn-sm';
        styleBtn.textContent = 'Set Edition Style';
        styleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            eventBus.emit('erc1155:admin:set-edition-style', { editionId: this.edition.id });
        });

        controls.appendChild(updateBtn);
        controls.appendChild(styleBtn);
        this._el.appendChild(controls);
    }

    removeAdminControls() {
        if (!this._el) return;
        const controls = this._el.querySelector('.edition-admin-controls');
        if (controls) controls.remove();
    }

    handleCardClick(e) {
        e.preventDefault();
        const url = this.state.editionUrl;
        if (url && url !== '#') {
            // Carry forward the navigation source so the edition breadcrumb knows the full path
            const from = window.history.state?.from || null;
            if (window.router) {
                window.router.navigate(url, { state: { from, projectName: this.project?.name || '' } });
            } else {
                window.location.href = url;
            }
        }
    }

    formatPrice(priceWei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                const priceEth = parseFloat(window.ethers.utils.formatEther(priceWei));
                return priceEth.toFixed(4);
            }
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        } catch (error) {
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        }
    }

    getMintStatsBadge() {
        if (!this.state.mintStats) return null;

        const { minted, maxSupply } = this.state.mintStats;
        const isUnlimited = maxSupply === '0' || maxSupply === 0;

        if (isUnlimited) {
            return h('div', { className: 'mint-stats-badge unlimited' }, 'Unlimited');
        }

        return h('div', { className: 'mint-stats-badge' }, `${minted}/${maxSupply} minted`);
    }

    getSupplyStatusBadge() {
        if (!this.state.mintStats) return null;

        const { minted, maxSupply } = this.state.mintStats;
        const isUnlimited = maxSupply === '0' || maxSupply === 0;

        if (isUnlimited) {
            return h('div', { className: 'supply-status-badge open-edition' }, 'Open Edition');
        }

        const mintedNum = parseInt(minted);
        const maxNum = parseInt(maxSupply);
        const percentMinted = (mintedNum / maxNum) * 100;

        if (percentMinted >= 90) {
            return h('div', { className: 'supply-status-badge nearly-sold-out' }, 'Nearly Sold Out!');
        } else if (percentMinted >= 50) {
            return h('div', { className: 'supply-status-badge limited' }, 'Limited Edition');
        }

        return null;
    }

    getPricingDisplay() {
        if (!this.state.pricingInfo || !this.state.currentPrice) {
            return `${this.formatPrice(this.edition.price)} ETH`;
        }

        const { pricingModel } = this.state.pricingInfo;
        const currentPrice = this.formatPrice(this.state.currentPrice);
        const basePrice = this.formatPrice(this.edition.price);

        if (pricingModel === 0 || pricingModel === '0') {
            return `${currentPrice} ETH`;
        }

        if (currentPrice !== basePrice) {
            return h('span', null,
                `${basePrice} ETH `,
                h('span', { className: 'price-arrow' }, '→'),
                ` ${currentPrice} ETH`
            );
        }

        return h('span', null,
            `${currentPrice} ETH `,
            h('span', { className: 'price-indicator' }, '(dynamic)')
        );
    }

    renderImage() {
        const imageUrl = this.edition.metadata?.image ||
                        this.edition.metadata?.image_url ||
                        '/placeholder-edition.png';
        const name = this.edition.metadata?.name || `Edition #${this.edition.id}`;
        const currentSupply = BigInt(this.edition.currentSupply || '0');
        const maxSupply = BigInt(this.edition.maxSupply || '0');
        const isSoldOut = this.edition.maxSupply !== '0' && currentSupply >= maxSupply;

        // Use innerHTML for IPFS image helper
        const imageHtml = renderIpfsImage(imageUrl, name, 'edition-card-image', { loading: 'lazy' });

        return h('div', { className: 'edition-image' },
            h('div', { innerHTML: imageHtml }),
            isSoldOut && h('div', { className: 'sold-out-badge' }, 'Sold Out'),
            this.getMintStatsBadge(),
            this.getSupplyStatusBadge()
        );
    }

    render() {
        const edition = this.edition;
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const supply = `${edition.currentSupply}/${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
        const pricingDisplay = this.getPricingDisplay();

        return h('div', {
            className: 'edition-card',
            'data-edition-id': edition.id
        },
            // Clickable area for navigation
            h('a', {
                href: this.state.editionUrl || '#',
                className: 'edition-link',
                onClick: this.bind(this.handleCardClick),
                'data-edition-id': edition.id
            },
                this.renderImage(),
                h('div', { className: 'edition-info' },
                    h('div', { className: 'edition-header' },
                        h('div', { className: 'edition-name' }, name),
                        h('div', { className: 'edition-id' }, `#${edition.id}`)
                    ),
                    h('div', { className: 'edition-stats' },
                        h('div', { className: 'edition-stat-item' },
                            h('div', { className: 'edition-stat-label' }, 'Price'),
                            h('div', { className: 'edition-stat-value' },
                                typeof pricingDisplay === 'string' ? pricingDisplay : pricingDisplay
                            )
                        ),
                        h('div', { className: 'edition-stat-item' },
                            h('div', { className: 'edition-stat-label' }, 'Minted'),
                            h('div', { className: 'edition-stat-value' }, supply)
                        )
                    ),
                    this.state.userBalance !== '0' && h('div', { className: 'edition-user-balance' },
                        h('span', { className: 'edition-stat-label' }, 'You own: '),
                        h('span', { className: 'edition-stat-value' }, this.state.userBalance)
                    )
                )
            ),
            // Mint interface — full component with quantity, cost, message, and actual tx
            h(EditionMintInterface, {
                edition: edition,
                adapter: this.adapter
            })
        );
    }
}

// Module-level flag for admin state (handles timing race with event).
// This listener runs at module scope so it catches the event even if
// no EditionCard instances have mounted yet.
EditionCard._adminEnabled = false;
eventBus.on('erc1155:admin:enabled', () => { EditionCard._adminEnabled = true; });
eventBus.on('erc1155:admin:disabled', () => { EditionCard._adminEnabled = false; });

export default EditionCard;
