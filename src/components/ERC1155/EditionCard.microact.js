/**
 * EditionCard - Microact Version
 *
 * Displays individual edition with image, price, supply, and mint button.
 */

import { Component, h } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { generateProjectURL } from '../../utils/navigation.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

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

        if (this.element) {
            enhanceAllIpfsImages(this.element);
        }
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

    handleCardClick(e) {
        e.preventDefault();
        const url = this.state.editionUrl;
        if (url && url !== '#') {
            if (window.router) {
                window.router.navigate(url);
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
        const description = edition.metadata?.description || '';
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
        const pricingDisplay = this.getPricingDisplay();

        return h('div', {
            className: 'edition-card marble-bg',
            'data-edition-id': edition.id
        },
            h('a', {
                href: this.state.editionUrl || '#',
                className: 'edition-link',
                onClick: this.bind(this.handleCardClick),
                'data-edition-id': edition.id
            },
                this.renderImage(),
                h('div', { className: 'edition-info' },
                    h('h3', { className: 'edition-name' }, name),
                    description && h('p', { className: 'edition-description' }, description),
                    h('div', { className: 'edition-stats' },
                        h('div', { className: 'stat' },
                            h('span', { className: 'stat-label' }, 'Price:'),
                            h('span', { className: 'stat-value' },
                                typeof pricingDisplay === 'string' ? pricingDisplay : pricingDisplay
                            )
                        ),
                        h('div', { className: 'stat' },
                            h('span', { className: 'stat-label' }, 'Supply:'),
                            h('span', { className: 'stat-value' }, supply)
                        ),
                        this.state.userBalance !== '0' && h('div', { className: 'stat' },
                            h('span', { className: 'stat-label' }, 'You own:'),
                            h('span', { className: 'stat-value' }, this.state.userBalance)
                        )
                    )
                )
            )
        );
    }
}

export default EditionCard;
