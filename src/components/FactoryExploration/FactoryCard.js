import { Component } from '../../core/Component.js';

/**
 * FactoryCard component
 * Displays a single factory card with information and CTA
 */
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
        const icon = factory.icon || '📦';
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
                        <button class="copy-address-button" data-ref="copy-button" title="Copy address">
                            📋
                        </button>
                    </div>
                    
                    <div class="factory-links">
                        <a href="${etherscanUrl}" 
                           target="_blank" 
                           rel="noopener noreferrer"
                           class="factory-link available"
                           title="View on Etherscan"
                           onclick="event.stopPropagation()">
                            🔗
                        </a>
                        ${githubUrl ? `
                            <a href="${this.escapeHtml(githubUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="View on GitHub"
                               onclick="event.stopPropagation()">
                                💻
                            </a>
                        ` : `
                            <span class="factory-link" title="GitHub not available">💻</span>
                        `}
                        ${websiteUrl ? `
                            <a href="${this.escapeHtml(websiteUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="Visit Website"
                               onclick="event.stopPropagation()">
                                🌐
                            </a>
                        ` : `
                            <span class="factory-link" title="Website not available">🌐</span>
                        `}
                        ${twitterUrl ? `
                            <a href="${this.escapeHtml(twitterUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="factory-link available"
                               title="View on Twitter"
                               onclick="event.stopPropagation()">
                                🐦
                            </a>
                        ` : `
                            <span class="factory-link" title="Twitter not available">🐦</span>
                        `}
                    </div>
                    
                    <a href="/create?factory=${encodeURIComponent(factory.address)}" 
                       class="create-project-button" 
                       data-ref="create-button">
                        Create ${type} Project →
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
                const factoryAddress = this.factory.address;
                if (window.router) {
                    window.router.navigate(`/create?factory=${encodeURIComponent(factoryAddress)}`);
                } else {
                    window.location.href = `/create?factory=${encodeURIComponent(factoryAddress)}`;
                }
            });
        }

        if (copyButton) {
            copyButton.addEventListener('click', () => {
                const address = this.factory.address;
                navigator.clipboard.writeText(address).then(() => {
                    // Show feedback
                    const originalText = copyButton.textContent;
                    copyButton.textContent = '✓';
                    this.setTimeout(() => {
                        copyButton.textContent = originalText;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy address:', err);
                });
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

