import { Component } from '../../core/Component.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * ProjectHeader component
 * Displays project header information
 */
export class ProjectHeader extends Component {
    constructor(project) {
        super();
        this.project = project;
        this.adminButton = null;
        this.listenersAttached = false;
        this.state = {
            metadataExpanded: false
        };
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
                    <div class="header-title-group">
                    <h1 class="project-name">${this.escapeHtml(this.project.name)}</h1>
                    <span class="contract-type-badge ${contractType.toLowerCase()}">${contractType}</span>
                    </div>
                    <div class="header-actions" data-ref="admin-button-container">
                        <!-- AdminButton will be mounted here -->
                    </div>
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

                <div class="project-metadata-toggle">
                    <button class="metadata-toggle-btn" data-ref="metadata-toggle">
                        <span class="toggle-text">${this.state.metadataExpanded ? 'Hide' : 'Show'} Contract Details</span>
                        <span class="toggle-icon">${this.state.metadataExpanded ? '▲' : '▼'}</span>
                    </button>
                </div>

                <div class="project-metadata" data-ref="metadata-content" style="display: ${this.state.metadataExpanded ? 'block' : 'none'}">
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
        this.setupAdminButton();
        this.setupDOMEventListeners();
    }

    async setupAdminButton() {
        try {
            // Get adapter from ProjectService
            const projectService = serviceFactory.getProjectService();
            const projectId = this.project.address || this.project.contractAddress;
            const adapter = projectService.getAdapter(projectId);

            if (!adapter) {
                // Try to load project if not loaded
                try {
                    await projectService.loadProject(
                        projectId,
                        this.project.address || this.project.contractAddress,
                        this.project.contractType
                    );
                } catch (error) {
                    console.warn('[ProjectHeader] Could not load project for admin button:', error);
                }
            }

            const finalAdapter = projectService.getAdapter(projectId);
            const contractAddress = this.project.address || this.project.contractAddress;
            const contractType = this.project.contractType;

            // Create and mount AdminButton
            const container = this.getRef('admin-button-container', '.header-actions');
            if (container) {
                this.adminButton = new AdminButton(contractAddress, contractType, finalAdapter);
                const buttonElement = document.createElement('div');
                container.appendChild(buttonElement);
                this.adminButton.mount(buttonElement);
                this.createChild('admin-button', this.adminButton);
            }
        } catch (error) {
            console.warn('[ProjectHeader] Error setting up admin button:', error);
        }
    }

    setupDOMEventListeners() {
        // Guard against duplicate listener attachment
        if (this.listenersAttached) {
            console.log('[ProjectHeader] Listeners already attached, skipping');
            return;
        }
        this.listenersAttached = true;

        console.log('[ProjectHeader] setupDOMEventListeners called, element:', this.element);
        const copyButton = this.getRef('copy-address', '.copy-button');
        const factoryLink = this.element?.querySelector('.metadata-link');
        const metadataToggle = this.element?.querySelector('.metadata-toggle-btn');

        console.log('[ProjectHeader] metadataToggle found:', metadataToggle);

        if (metadataToggle) {
            metadataToggle.addEventListener('click', (e) => {
                console.log('[ProjectHeader] Toggle clicked!');
                e.preventDefault();
                this.toggleMetadata();
            });
        } else {
            console.warn('[ProjectHeader] Could not find metadata toggle button');
        }

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

    toggleMetadata() {
        this.state.metadataExpanded = !this.state.metadataExpanded;
        console.log('[ProjectHeader] toggleMetadata, expanded:', this.state.metadataExpanded);

        // Update DOM directly with inline styles (CSS classes not working)
        const content = this.element?.querySelector('.project-metadata');
        const toggle = this.element?.querySelector('.metadata-toggle-btn');

        if (content) {
            if (this.state.metadataExpanded) {
                content.style.display = 'block';
                content.style.maxHeight = '500px';
                content.style.opacity = '1';
                content.style.visibility = 'visible';
            } else {
                content.style.display = 'none';
            }
        }

        if (toggle) {
            const textSpan = toggle.querySelector('.toggle-text');
            const iconSpan = toggle.querySelector('.toggle-icon');
            if (textSpan) textSpan.textContent = this.state.metadataExpanded ? 'Hide Contract Details' : 'Show Contract Details';
            if (iconSpan) iconSpan.textContent = this.state.metadataExpanded ? '▲' : '▼';
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

