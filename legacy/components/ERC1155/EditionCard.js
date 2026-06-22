/**
 * EditionCard Component
 * 
 * Displays individual edition with image, price, supply, and mint button.
 */

import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { generateProjectURL } from '../../utils/navigation.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

export class EditionCard extends Component {
    constructor(edition, adapter, projectId, project = null) {
        super();
        this.edition = edition;
        this.adapter = adapter;
        this.projectId = projectId;
        this.project = project;
        this.state = {
            userBalance: '0',
            loading: false,
            editionUrl: '#',
            mintStats: null,
            pricingInfo: null,
            currentPrice: null
        };
    }

    async onMount() {
        await Promise.all([
            this.loadUserBalance(),
            this.generateEditionURL(),
            this.loadMintStats(),
            this.loadPricingInfo(),
            this.loadCurrentPrice()
        ]);

        // Enhance IPFS images after mount
        if (this.element) {
            enhanceAllIpfsImages(this.element);
        }
    }

    async generateEditionURL() {
        try {
            // Try to get project data if not provided
            let project = this.project;
            if (!project) {
                const projectRegistry = serviceFactory.getProjectRegistry();
                project = await projectRegistry.getProject(this.projectId);
            }

            // Get network info for chainId
            const { detectNetwork } = await import('../../config/network.js');
            const network = detectNetwork();
            const chainId = network.chainId || 1;

            const instanceName = project?.name || project?.displayName;
            const pieceTitle = this.edition.pieceTitle || this.edition.metadata?.name || this.edition.metadata?.displayTitle;

            if (instanceName && pieceTitle) {
                // Generate simple URL: /:chainId/:instanceName/:pieceTitle
                const url = generateProjectURL(
                    null, // no factory
                    { name: instanceName },
                    { title: pieceTitle },
                    chainId
                );
                if (url) {
                    this.setState({ editionUrl: url });
                    return;
                }
            }

            // No valid URL - edition will not be linkable
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

    render() {
        const imageUrl = this.edition.metadata?.image ||
                        this.edition.metadata?.image_url ||
                        '/placeholder-edition.png';
        const name = this.edition.metadata?.name || `Edition #${this.edition.id}`;
        const description = this.edition.metadata?.description || '';
        const price = this.formatPrice(this.edition.price);
        const currentSupply = BigInt(this.edition.currentSupply || '0');
        const maxSupply = BigInt(this.edition.maxSupply || '0');
        const supply = `${this.edition.currentSupply} / ${this.edition.maxSupply === '0' ? '∞' : this.edition.maxSupply}`;
        const isSoldOut = this.edition.maxSupply !== '0' &&
                         currentSupply >= maxSupply;

        // Calculate mint stats badge
        const mintStatsBadge = this.getMintStatsBadge();
        const supplyStatusBadge = this.getSupplyStatusBadge();
        const pricingDisplay = this.getPricingDisplay();

        return `
            <div class="edition-card marble-bg" data-edition-id="${this.edition.id}">
                <a href="${this.state.editionUrl || '#'}" class="edition-link" ref="edition-link" data-edition-id="${this.edition.id}">
                    <div class="edition-image">
                        ${renderIpfsImage(imageUrl, name, 'edition-card-image', { loading: 'lazy' })}
                        ${isSoldOut ? '<div class="sold-out-badge">Sold Out</div>' : ''}
                        ${mintStatsBadge}
                        ${supplyStatusBadge}
                    </div>
                    <div class="edition-info">
                        <h3 class="edition-name">${this.escapeHtml(name)}</h3>
                        ${description ? `<p class="edition-description">${this.escapeHtml(description)}</p>` : ''}
                        <div class="edition-stats">
                            <div class="stat">
                                <span class="stat-label">Price:</span>
                                <span class="stat-value">${pricingDisplay}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">Supply:</span>
                                <span class="stat-value">${supply}</span>
                            </div>
                            ${this.state.userBalance !== '0' ? `
                                <div class="stat">
                                    <span class="stat-label">You own:</span>
                                    <span class="stat-value">${this.state.userBalance}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </a>
            </div>
        `;
    }

    getMintStatsBadge() {
        if (!this.state.mintStats) return '';

        const { minted, maxSupply } = this.state.mintStats;
        const isUnlimited = maxSupply === '0' || maxSupply === 0;

        if (isUnlimited) {
            return '<div class="mint-stats-badge unlimited">Unlimited</div>';
        }

        return `<div class="mint-stats-badge">${minted}/${maxSupply} minted</div>`;
    }

    getSupplyStatusBadge() {
        if (!this.state.mintStats) return '';

        const { minted, maxSupply } = this.state.mintStats;
        const isUnlimited = maxSupply === '0' || maxSupply === 0;

        if (isUnlimited) {
            return '<div class="supply-status-badge open-edition">Open Edition</div>';
        }

        const mintedNum = parseInt(minted);
        const maxNum = parseInt(maxSupply);
        const percentMinted = (mintedNum / maxNum) * 100;

        if (percentMinted >= 90) {
            return '<div class="supply-status-badge nearly-sold-out">Nearly Sold Out!</div>';
        } else if (percentMinted >= 50) {
            return '<div class="supply-status-badge limited">Limited Edition</div>';
        }

        return '';
    }

    getPricingDisplay() {
        if (!this.state.pricingInfo || !this.state.currentPrice) {
            // Fallback to base price
            return `${this.formatPrice(this.edition.price)} ETH`;
        }

        const { pricingModel } = this.state.pricingInfo;
        const currentPrice = this.formatPrice(this.state.currentPrice);
        const basePrice = this.formatPrice(this.edition.price);

        // pricingModel: 0 = fixed, 1 = linear, 2 = exponential
        if (pricingModel === 0 || pricingModel === '0') {
            return `${currentPrice} ETH`;
        }

        // Dynamic pricing
        if (currentPrice !== basePrice) {
            return `${basePrice} ETH <span class="price-arrow">→</span> ${currentPrice} ETH`;
        }

        return `${currentPrice} ETH <span class="price-indicator">(dynamic)</span>`;
    }

    formatPrice(priceWei) {
        try {
            // Try to use ethers if available globally
            if (typeof window !== 'undefined' && window.ethers) {
                const priceEth = parseFloat(window.ethers.utils.formatEther(priceWei));
                return priceEth.toFixed(4);
            }
            // Fallback calculation
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        } catch (error) {
            // Fallback if ethers not available
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        }
    }

    setupDOMEventListeners() {
        const editionLink = this.getRef('edition-link', '.edition-link');
        if (editionLink && this.state.editionUrl && this.state.editionUrl !== '#') {
            editionLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate(this.state.editionUrl);
                } else {
                    window.location.href = this.state.editionUrl;
                }
            });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

