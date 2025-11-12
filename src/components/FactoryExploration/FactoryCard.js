import { Component } from '../../core/Component.js';

/**
 * FactoryCard component
 * Displays a single factory card with information and CTA
 */
import { renderIcon } from '../../core/icons.js';

export class FactoryCard extends Component {
    constructor(factory) {
        super();
        this.factory = factory;
    }

    render() {
        const factory = this.factory;
        const address = this.escapeHtml(factory.address);
        const name = this.escapeHtml(factory.name);
        const description = this.escapeHtml(factory.description);
        const type = this.escapeHtml(factory.type);
        const instanceCount = factory.instanceCount || 0;
        const icon = factory.icon || '✦';
        const color = factory.color || '#6b7280';
        
        // Get factory links (if available in factory data)
        const etherscanUrl = factory.etherscanUrl || `https://etherscan.io/address/${factory.address}`;
        const githubUrl = factory.githubUrl || null;
        const websiteUrl = factory.websiteUrl || null;
        const twitterUrl = factory.twitterUrl || null;
        const audited = factory.audited || false;

        return `
            <div class="factory-card marble-bg marble-stretch-sheer" style="--factory-color: ${color}">
                <!-- Top Section: Icon, Title, Badge -->
                <div class="factory-card-top">
                    <div class="factory-header">
                        <span class="factory-icon">${icon}</span>
                        <div class="factory-title-group">
                            <h3 class="factory-name">${name}</h3>
                            <span class="factory-type-badge ${type.toLowerCase()}">
                                ${type}
                            </span>
                        </div>
                    </div>
                    ${audited ? 
                        '<div class="factory-audit-badge">✓ Audited</div>' : 
                        '<div class="factory-audit-badge factory-audit-warning">⚠ Not Audited</div>'
                    }
                </div>
                
                <!-- Scrollable Middle Section -->
                <div class="factory-card-scrollable">
                    <p class="factory-description">${description}</p>
                    
                    <div class="factory-stats">
                        <span class="stat">
                            <strong>${instanceCount}</strong> project${instanceCount !== 1 ? 's' : ''} created
                        </span>
                    </div>
                    
                    ${factory.features && factory.features.length > 0 ? `
                        <div class="factory-features">
                            <h4>Key Features:</h4>
                            <ul class="features-list">
                                ${factory.features.map(feature => `
                                    <li>${this.escapeHtml(feature)}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${factory.useCases && factory.useCases.length > 0 ? `
                        <div class="factory-use-cases">
                            <h4>Use Cases:</h4>
                            <ul class="use-cases-list">
                                ${factory.useCases.map(useCase => `
                                    <li>${this.escapeHtml(useCase)}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    
                    ${factory.allegiance ? `
                        <div class="factory-allegiance">
                            <h4>Factory Allegiance:</h4>
                            <div class="allegiance-info">
                                <span class="allegiance-icon">${factory.allegiance.icon}</span>
                                <div class="allegiance-details">
                                    <div class="allegiance-benefactor">${this.escapeHtml(factory.allegiance.benefactor)}</div>
                                    <div class="allegiance-description">${this.escapeHtml(factory.allegiance.description)}</div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Bottom Section: Address, Links, Button -->
                <div class="factory-card-bottom">
                    <div class="factory-address">
                        <span class="address-label">Factory Address:</span>
                        <code class="address-value" data-ref="factory-address">${address}</code>
                        <button class="copy-address-button" data-ref="copy-button" title="Copy address" aria-label="Copy address">
                            ${renderIcon('copy', 'icon-copy')}
                        </button>
                    </div>
                    
                    <div class="factory-links">
                        <a href="${etherscanUrl}" 
                           target="_blank" 
                           rel="noopener noreferrer"
                           class="factory-link available"
                           title="View on Etherscan"
                           aria-label="View on Etherscan"
                           onclick="event.stopPropagation()">
                            ${renderIcon('etherscan', 'icon-etherscan')}
                        </a>
                        ${githubUrl ? `
                            <a href="${this.escapeHtml(githubUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="View on GitHub"
                               aria-label="View on GitHub"
                               onclick="event.stopPropagation()">
                                ${renderIcon('github', 'icon-github')}
                            </a>
                        ` : `
                            <span class="factory-link" title="GitHub not available">${renderIcon('github', 'icon-github')}</span>
                        `}
                        ${websiteUrl ? `
                            <a href="${this.escapeHtml(websiteUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="Visit Website"
                               aria-label="Visit Website"
                               onclick="event.stopPropagation()">
                                ${renderIcon('website', 'icon-website')}
                            </a>
                        ` : `
                            <span class="factory-link" title="Website not available">${renderIcon('website', 'icon-website')}</span>
                        `}
                        ${twitterUrl ? `
                            <a href="${this.escapeHtml(twitterUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="View on Twitter"
                               aria-label="View on Twitter"
                               onclick="event.stopPropagation()">
                                ${renderIcon('twitter', 'icon-twitter')}
                            </a>
                        ` : `
                            <span class="factory-link" title="Twitter not available">${renderIcon('twitter', 'icon-twitter')}</span>
                        `}
                    </div>
                    
                    <a href="${this._getCreateURL(factory)}" 
                       class="create-project-button" 
                       data-ref="create-button">
                        Establish ${type} Project
                    </a>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.bindEvents();
        }, 0);
    }

    bindEvents() {
        const createButton = this.getRef('create-button', '.create-project-button');
        const copyButton = this.getRef('copy-button', '.copy-address-button');

        if (createButton) {
            createButton.addEventListener('click', (e) => {
                e.preventDefault();
                const url = this._getCreateURL(this.factory);
                if (window.router) {
                    window.router.navigate(url);
                } else {
                    window.location.href = url;
                }
            });
        }

        if (copyButton) {
            copyButton.addEventListener('click', () => {
                const address = this.factory.address;
                navigator.clipboard.writeText(address).then(() => {
                    // Show feedback
                    const originalHTML = copyButton.innerHTML;
                    copyButton.innerHTML = renderIcon('copy', 'icon-copy');
                    this.setTimeout(() => {
                        copyButton.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy address:', err);
                });
            });
        }
    }

    /**
     * Get create URL for factory (new format: /chainId/factoryTitle/create)
     * Falls back to old format if factory title not available
     * @returns {string} Create URL
     * @private
     */
    _getCreateURL(factory) {
        // Try to get factory title from factory data
        const factoryTitle = factory.title || factory.displayTitle;
        if (factoryTitle) {
            // Use new format: /chainId/factoryTitle/create
            const chainId = 1; // Default to Ethereum mainnet
            const titleSlug = factoryTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            return `/${chainId}/${titleSlug}/create`;
        }
        
        // Fallback to old format
        return `/create?factory=${encodeURIComponent(factory.address)}`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

