import { Component } from '../../core/Component.js';

/**
 * ProjectHeader component
 * Displays project header information
 */
export class ProjectHeader extends Component {
    constructor(project) {
        super();
        this.project = project;
    }

    render() {
        if (!this.project) {
            return '<div class="project-header">No project data</div>';
        }

        const contractType = this.project.contractType || 'Unknown';
        const volume = this.project.stats?.volume || '0 ETH';
        const holders = this.project.stats?.holders || 0;
        const supply = this.project.stats?.totalSupply || 0;
        const address = this.project.address || '';
        const factoryAddress = this.project.factoryAddress || '';
        const creator = this.project.creator || '';
        const createdAt = this.project.createdAt ? new Date(this.project.createdAt).toLocaleDateString() : 'Unknown';

        return `
            <div class="project-header marble-bg">
                <div class="header-top">
                    <h1 class="project-name">${this.escapeHtml(this.project.name)}</h1>
                    <span class="contract-type-badge ${contractType.toLowerCase()}">${contractType}</span>
                </div>
                
                <p class="project-description">${this.escapeHtml(this.project.description || 'No description available')}</p>
                
                <div class="project-stats">
                    <div class="stat-item">
                        <span class="stat-label">Volume:</span>
                        <span class="stat-value">${volume}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Holders:</span>
                        <span class="stat-value">${holders}</span>
                    </div>
                    ${supply > 0 ? `
                        <div class="stat-item">
                            <span class="stat-label">Total Supply:</span>
                            <span class="stat-value">${supply}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="project-metadata">
                    <div class="metadata-item">
                        <span class="metadata-label">Contract Address:</span>
                        <span class="metadata-value address" data-ref="contract-address">${address}</span>
                        <button class="copy-button" data-ref="copy-address" data-address="${address}" aria-label="Copy address">
                            📋
                        </button>
                    </div>
                    
                    ${factoryAddress ? `
                        <div class="metadata-item">
                            <span class="metadata-label">Factory:</span>
                            <a href="/factory/${factoryAddress}" class="metadata-link">${factoryAddress.slice(0, 10)}...${factoryAddress.slice(-8)}</a>
                        </div>
                    ` : ''}
                    
                    ${creator ? `
                        <div class="metadata-item">
                            <span class="metadata-label">Creator:</span>
                            <span class="metadata-value">${creator.slice(0, 10)}...${creator.slice(-8)}</span>
                        </div>
                    ` : ''}
                    
                    <div class="metadata-item">
                        <span class="metadata-label">Created:</span>
                        <span class="metadata-value">${createdAt}</span>
                    </div>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        const copyButton = this.getRef('copy-address', '.copy-button');
        const factoryLink = this.element?.querySelector('.metadata-link');

        if (copyButton) {
            copyButton.addEventListener('click', () => {
                const address = copyButton.getAttribute('data-address');
                if (address) {
                    navigator.clipboard.writeText(address).then(() => {
                        // Show feedback
                        const originalText = copyButton.textContent;
                        copyButton.textContent = '✓';
                        setTimeout(() => {
                            copyButton.textContent = originalText;
                        }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy:', err);
                    });
                }
            });
        }

        if (factoryLink) {
            factoryLink.addEventListener('click', (e) => {
                e.preventDefault();
                const href = factoryLink.getAttribute('href');
                if (window.router) {
                    window.router.navigate(href);
                } else {
                    window.location.href = href;
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

