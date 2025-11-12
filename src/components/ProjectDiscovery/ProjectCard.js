import { Component } from '../../core/Component.js';
import { FACTORY_METADATA } from '../../utils/factoryMetadata.js';
import { generateProjectURL } from '../../utils/navigation.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { loadMockData } from '../../services/mock/mockData.js';
import { renderIcon } from '../../core/icons.js';

/**
 * ProjectCard component
 * Displays a single project card
 */
export class ProjectCard extends Component {
    constructor(project, onNavigate) {
        super();
        this.project = project;
        this.onNavigate = onNavigate;
        this.state = {
            hovered: false
        };
    }

    /**
     * Check if this project is a mock/demonstration project
     * @returns {boolean} True if project is a mock
     */
    isMockProject() {
        if (!serviceFactory.isUsingMock()) {
            return false;
        }
        
        const address = this.project.address || '';
        
        // Check common mock patterns
        if (address.startsWith('0xMOCK') || 
            address.includes('mock') ||
            address.startsWith('0xFACTORY')) {
            return true;
        }
        
        // Check if address exists in mock data instances
        try {
            const mockData = loadMockData();
            if (mockData && mockData.instances && mockData.instances[address]) {
                return true;
            }
        } catch (error) {
            // If we can't load mock data, assume it's not a mock contract
        }
        
        return false;
    }

    render() {
        const isFeatured = this.project.name === 'CULT EXECUTIVES' || this.project.name === 'CULT EXEC';
        const isMock = this.isMockProject();
        const contractType = this.project.contractType || 'Unknown';
        const volume = this.project.stats?.volume || '0 ETH';
        const holders = this.project.stats?.holders || 0;
        const supply = this.project.stats?.totalSupply || 0;
        const audited = this.project.audited || false;
        const creatorTwitter = this.project.creatorTwitter || null;
        const etherscanUrl = this.project.etherscanUrl || null;
        const githubUrl = this.project.githubUrl || null;
        const twitterUrl = this.project.twitterUrl || null;
        const address = this.project.address || '';
        
        // Get factory allegiance from metadata
        const factoryMetadata = FACTORY_METADATA[contractType];
        const allegiance = factoryMetadata?.allegiance || null;

        // Generate etherscan URL if address exists but no URL provided
        const etherscanLink = etherscanUrl || (address ? `https://etherscan.io/address/${address}` : null);

        // Get card image - use project imageURI if available, otherwise use CULT EXEC hardcoded image
        const projectImage = this.project.imageURI || this.project.image || null;
        const cardImage = isFeatured ? 'public/execs/695.jpeg' : projectImage;
        const cardTopBarStyle = cardImage ? `style="background-image: url('${this.escapeHtml(cardImage)}'); background-size: cover; background-position: center; background-repeat: no-repeat;"` : '';
        const hasImage = !!cardImage;

        return `
            <div class="project-card marble-bg marble-stretch-sheer ${isFeatured ? 'featured' : ''}" data-project-id="${address}">
                <div class="card-top-bar ${hasImage ? 'has-background-image' : ''}" ${cardTopBarStyle}>
                    <div class="card-top-left">
                        ${audited ? `<div class="audit-badge-top">${renderIcon('audited', 'icon-audited')} Audited</div>` : ''}
                    </div>
                    <div class="card-top-right">
                        ${etherscanLink ? `
                            <a href="${etherscanLink}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="card-link-icon"
                               title="View on Etherscan"
                               aria-label="View on Etherscan"
                               onclick="event.stopPropagation()">
                                ${renderIcon('etherscan', 'icon-etherscan')}
                            </a>
                        ` : ''}
                        ${githubUrl ? `
                            <a href="${this.escapeHtml(githubUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="card-link-icon"
                               title="View on GitHub"
                               aria-label="View on GitHub"
                               onclick="event.stopPropagation()">
                                ${renderIcon('github', 'icon-github')}
                            </a>
                        ` : ''}
                        ${twitterUrl ? `
                            <a href="${this.escapeHtml(twitterUrl)}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="card-link-icon"
                               title="View on Twitter"
                               aria-label="View on Twitter"
                               onclick="event.stopPropagation()">
                                ${renderIcon('twitter', 'icon-twitter')}
                            </a>
                        ` : ''}
                        ${creatorTwitter ? `
                            <a href="https://twitter.com/${this.escapeHtml(creatorTwitter.replace('@', ''))}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="card-link-icon"
                               title="Creator Twitter"
                               aria-label="Creator Twitter"
                               onclick="event.stopPropagation()">
                                ${renderIcon('creator', 'icon-creator')}
                            </a>
                        ` : ''}
                    </div>
                </div>
                
                ${isFeatured ? '<div class="featured-badge">FEATURED</div>' : ''}
                ${isMock ? '<div class="mock-badge">For Demonstration Only</div>' : ''}
                
                <div class="card-header">
                    <h3 class="card-title">${this.escapeHtml(this.project.name)}</h3>
                    <span class="contract-type-badge ${contractType.toLowerCase()}">${contractType}</span>
                </div>
                
                <div class="card-scrollable-content">
                <p class="card-description">${this.escapeHtml(this.project.description || 'No description available')}</p>
                
                ${isFeatured ? `
                    <div class="card-meta">
                        <div class="meta-item allegiance">
                            <img src="public/remilia.gif" alt="Remilia" class="meta-icon-image" />
                            <span class="meta-text">
                                Ultra-Aligned Dual Nature NFT
                            </span>
                        </div>
                    </div>
                ` : allegiance ? `
                    <div class="card-meta">
                        <div class="meta-item allegiance">
                            <span class="meta-icon">${allegiance.icon}</span>
                            <span class="meta-text" title="${this.escapeHtml(allegiance.description)}">
                                ${this.escapeHtml(allegiance.benefactor)}
                            </span>
                        </div>
                    </div>
                ` : ''}
                
                <div class="card-stats">
                    <div class="stat">
                        <span class="stat-label">Volume:</span>
                        <span class="stat-value">${volume}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Holders:</span>
                        <span class="stat-value">${holders}</span>
                    </div>
                    ${supply > 0 ? `
                        <div class="stat">
                            <span class="stat-label">Supply:</span>
                            <span class="stat-value">${supply}</span>
                        </div>
                    ` : ''}
                </div>
                </div>
                
                <button class="view-project-button" data-ref="view-button">
                    ${isFeatured ? 'View CULT EXECUTIVES →' : 'View Project →'}
                </button>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        const viewButton = this.getRef('view-button', '.view-project-button');
        const card = this.element;

        if (viewButton) {
            viewButton.addEventListener('click', () => {
                this.handleViewProject();
            });
        }

        if (card) {
            card.addEventListener('click', (e) => {
                // If click is not on the button, navigate anyway
                if (!e.target.closest('.view-project-button')) {
                    this.handleViewProject();
                }
            });

            card.addEventListener('mouseenter', () => {
                this.setState({ hovered: true });
            });

            card.addEventListener('mouseleave', () => {
                this.setState({ hovered: false });
            });
        }
    }

    async handleViewProject() {
        if (this.onNavigate) {
            // CULT EXECUTIVES has special route
            if (this.project.name === 'CULT EXECUTIVES' || this.project.name === 'CULT EXEC') {
                this.onNavigate('/cultexecs');
                return;
            }

            // Try to generate title-based URL with chain ID
            try {
                // Get factory for this project
                const factoryAddress = this.project.factoryAddress;
                if (factoryAddress && serviceFactory.isUsingMock()) {
                    // Access mock data through the service manager
                    const mockManager = serviceFactory.mockManager;
                    if (mockManager) {
                        const mockData = mockManager.getMockData();
                        const factory = mockData?.factories?.[factoryAddress];
                        
                        if (factory && factory.title && this.project.name) {
                            // Default to chain ID 1 (Ethereum mainnet) for now
                            // In production, this should come from the wallet/network connection
                            const chainId = 1;
                            const projectURL = generateProjectURL(factory, this.project, null, chainId);
                            if (projectURL && !projectURL.startsWith('/project/')) {
                                this.onNavigate(projectURL);
                                return;
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to generate title-based URL, falling back to address:', error);
            }

            // Fallback to address-based URL
            this.onNavigate(`/project/${this.project.address}`);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

