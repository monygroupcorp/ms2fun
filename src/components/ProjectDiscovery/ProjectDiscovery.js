import { Component } from '../../core/Component.js';
import { ProjectSearch } from './ProjectSearch.js';
import { ProjectFilters } from './ProjectFilters.js';
import { ProjectCard } from './ProjectCard.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { FACTORY_METADATA } from '../../utils/factoryMetadata.js';
import { loadMockData } from '../../services/mock/mockData.js';
import { renderIcon } from '../../core/icons.js';

/**
 * ProjectDiscovery component
 * Main component for browsing and discovering projects
 */
export class ProjectDiscovery extends Component {
    constructor() {
        super();
        this.projectRegistry = serviceFactory.getProjectRegistry();
        this.masterService = serviceFactory.getMasterService();
        this.state = {
            projects: [],
            filteredProjects: [],
            searchQuery: '',
            filters: {
                type: 'all',
                factory: 'all',
                sortBy: 'date',
                viewMode: 'grid'
            },
            loading: true,
            error: null,
            factories: [],
            controlsExpanded: false
        };
    }

    async onMount() {
        await this.loadData();
    }

    onStateUpdate(oldState, newState) {
        // Update project cards using granular DOM updates (no remounting)
        if (oldState.filteredProjects !== newState.filteredProjects) {
            requestAnimationFrame(() => {
                this.updateProjectCardsContainer(newState.filteredProjects);
            });
        }
        // Note: No need to re-setup controls on state change - update() handles it
    }

    /**
     * Create hardcoded CULT EXEC project object
     * This is a featured project that appears at the top of the project list
     * @returns {Object} CULT EXEC project object
     */
    createHardcodedCultExecProject() {
        return {
            name: 'CULT EXECUTIVES',
            address: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2', // Real CULT EXEC address
            contractType: 'ERC404',
            description: 'The flagship ERC404 project. Bonding curve trading with automatic NFT minting.',
            stats: {
                volume: 'High',
                holders: 'Growing',
                totalSupply: 'Dynamic'
            },
            isFeatured: true,
            isHardcoded: true // Flag to distinguish from mock data
        };
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Load all projects
            const allProjects = await this.projectRegistry.getAllProjects();
            
            // Ensure projects are indexed
            if (!this.projectRegistry.isIndexed()) {
                await this.projectRegistry.indexFromMaster();
            }

            // Filter out CULT EXEC/CULT EXECUTIVES from mock data to prevent duplication
            const filteredProjects = allProjects.filter(p => p.name !== 'CULT EXEC' && p.name !== 'CULT EXECUTIVES');

            // Load factories for filter dropdown
            const factoryAddresses = await this.masterService.getAuthorizedFactories();
            const factories = [];
            for (const address of factoryAddresses) {
                const type = await this.masterService.getFactoryType(address);
                factories.push({ address, type });
            }

            this.setState({
                projects: filteredProjects, // Store filtered projects (no CULT EXEC from mock data)
                factories,
                loading: false
            });

            // Apply initial filters
            this.applyFilters();
        } catch (error) {
            console.error('Error loading projects:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load projects'
            });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="project-discovery">
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Loading projects...</p>
                    </div>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="project-discovery">
                    <div class="error-state">
                        <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                        <button class="retry-button" data-ref="retry-button">Retry</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="project-discovery">
                <div class="discovery-content">
                    <div class="projects-section">
                        <div class="section-header">
                            <h2 class="section-title">
                                Projects
                                ${this.state.filteredProjects.length > 0 ? `
                                    <span class="project-count">(${this.state.filteredProjects.length})</span>
                                ` : ''}
                            </h2>
                            <button class="search-toggle-btn" data-ref="search-toggle-btn" title="Search & Filter Projects">
                                <svg class="search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>

                        <div class="discovery-controls ${this.state.controlsExpanded ? 'expanded' : ''}" data-ref="controls-container">
                            <!-- ProjectSearch and ProjectFilters will be mounted here -->
                        </div>

                        ${this.state.filteredProjects.length === 0 ? `
                            <div class="empty-state">
                                <p>No projects found matching the specified criteria.</p>
                                <button class="clear-filters-button" data-ref="clear-all-button">Clear Filters</button>
                            </div>
                        ` : `
                            <div class="projects-grid ${this.state.filters.viewMode}" data-ref="projects-container">
                                <!-- Project cards will be mounted here -->
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);

        // Use event delegation on the root element for the search toggle button
        // This way we don't care if the button gets replaced during re-renders
        this.element.addEventListener('click', (e) => {
            const searchToggleBtn = e.target.closest('.search-toggle-btn');
            if (searchToggleBtn) {
                e.preventDefault();
                e.stopPropagation();
                this.handleSearchToggle();
            }
        });

        // Setup child components after DOM is ready
        this.setTimeout(() => {
            this.setupDOMEventListeners();
            this.setupProjectCards();
            this.setupControlsComponents();

            // Ensure controls have correct initial state
            const controlsContainer = this.getRef('controls-container', '.discovery-controls');
            if (controlsContainer && !this.state.controlsExpanded) {
                controlsContainer.classList.remove('expanded');
            }
        }, 0);
    }

    /**
     * Override update to re-setup child components after DOM updates
     * This ensures controls panel persists across state updates
     * Also preserves focus state during updates
     */
    update() {
        // Save focus and scroll state before update
        this._domUpdater.saveState(this.element);

        // Call parent update first
        super.update();

        // Re-setup child components after DOM is updated
        // Use setTimeout to ensure DOM is fully updated
        this.setTimeout(() => {
            // Only re-setup if component is still mounted
            if (this.mounted && this.element) {
                // Always setup project cards
                this.setupProjectCards();

                // Always setup controls (container is always in DOM, CSS handles visibility)
                this.setupControlsComponents();

                // Restore focus and scroll state after child components are set up
                // This ensures focus is restored even if components were recreated
                this._domUpdater.restoreState(this.element);
            }
        }, 0);
    }

    setupControlsComponents() {
        const controlsContainer = this.getRef('controls-container', '.discovery-controls');

        if (!controlsContainer) {
            // Controls container not ready yet, skip
            return;
        }
        
        // Helper function to check if a component's DOM is still valid
        const isComponentValid = (component) => {
            return component && 
                   component.element && 
                   this.element.contains(component.element);
        };
        
        // Check and recreate search component if needed
        const existingSearch = this._children.get('search');
        let searchComponent;
        if (!isComponentValid(existingSearch)) {
            // Preserve search query before unmounting
            const preservedQuery = existingSearch?.state?.query || this.state.searchQuery || '';
            
            // Unmount old component if it exists
            if (existingSearch && typeof existingSearch.unmount === 'function') {
                existingSearch.unmount();
            }
            this._children.delete('search');
            
            // Create new search component
            searchComponent = new ProjectSearch((query) => {
                this.handleSearch(query);
            });
            const searchContainer = document.createElement('div');
            searchContainer.className = 'search-container';
            controlsContainer.appendChild(searchContainer);
            searchComponent.mount(searchContainer);
            
            // Restore search query state after mount
            // Use setTimeout to ensure mount is complete
            this.setTimeout(() => {
                if (preservedQuery) {
                    searchComponent.setInitialQuery(preservedQuery);
                }
            }, 0);
            
            this.createChild('search', searchComponent);
        } else {
            searchComponent = existingSearch;
        }

        // Check and recreate filters component if needed
        const existingFilters = this._children.get('filters');
        let filtersComponent;
        let filtersContainer = controlsContainer.querySelector('.filters-container');
        
        if (!isComponentValid(existingFilters)) {
            // Preserve filter state before unmounting
            const preservedFilters = existingFilters?.getFilters?.() || this.state.filters || {
                type: 'all',
                factory: 'all',
                sortBy: 'date',
                viewMode: 'grid'
            };
            
            // Unmount old component if it exists
            if (existingFilters && typeof existingFilters.unmount === 'function') {
                existingFilters.unmount();
            }
            this._children.delete('filters');
            
            // Remove existing container if it exists
            if (filtersContainer) {
                filtersContainer.remove();
            }
            
            // Create new filters component
            filtersComponent = new ProjectFilters((filters) => {
                this.handleFilterChange(filters);
            });
            filtersContainer = document.createElement('div');
            filtersContainer.className = 'filters-container';
            
            // Add collapsible toggle button for mobile (always add it, CSS will hide on desktop)
            const toggleButton = document.createElement('button');
            toggleButton.className = 'filters-toggle-button';
            toggleButton.textContent = 'Filters';
            toggleButton.setAttribute('aria-label', 'Toggle filters');
            toggleButton.setAttribute('data-ref', 'filters-toggle');
            filtersContainer.appendChild(toggleButton);
            
            // Create a wrapper div for the filters component to prevent it from wiping out the toggle button
            const filtersWrapper = document.createElement('div');
            filtersWrapper.className = 'filters-wrapper';
            filtersContainer.appendChild(filtersWrapper);
            
            controlsContainer.appendChild(filtersContainer);
            
            // Mount filters component to the wrapper, not the container
            filtersComponent.mount(filtersWrapper);
            
            // Restore filter state after mount
            // Use setTimeout to ensure mount is complete
            this.setTimeout(() => {
                filtersComponent.setInitialState(preservedFilters);
                
                // Set up toggle button functionality after filters are mounted
                // Use a longer delay to ensure DOM is fully rendered
                this.setTimeout(() => {
                    this.setupFiltersToggle(filtersContainer, toggleButton);
                }, 100);
            }, 0);
            
            this.createChild('filters', filtersComponent);
        } else {
            filtersComponent = existingFilters;
            // Ensure toggle button exists even if component already exists
            // First, make sure we have the filtersContainer
            if (!filtersContainer) {
                filtersContainer = controlsContainer.querySelector('.filters-container');
            }
            
            if (filtersContainer) {
                let toggleButton = filtersContainer.querySelector('.filters-toggle-button');
                if (!toggleButton) {
                    toggleButton = document.createElement('button');
                    toggleButton.className = 'filters-toggle-button';
                    toggleButton.textContent = 'Filters';
                    toggleButton.setAttribute('aria-label', 'Toggle filters');
                    toggleButton.setAttribute('data-ref', 'filters-toggle');
                    // Insert at the beginning of the container
                    filtersContainer.insertBefore(toggleButton, filtersContainer.firstChild);
                }
                // Always re-setup the toggle to ensure it works
                this.setTimeout(() => {
                    this.setupFiltersToggle(filtersContainer, toggleButton);
                }, 100);
            } else {
                console.warn('Filters container not found when filters component exists');
            }
        }
        
        // Always update factories in filters component (in case factories list changed)
        if (filtersComponent && typeof filtersComponent.setFactories === 'function') {
            filtersComponent.setFactories(this.state.factories);
        }
    }

    setupProjectCards() {
        // Mount regular projects
        this.mountProjectCards('projects', this.state.filteredProjects, 'projects-container');
    }

    setupFiltersToggle(filtersContainer, toggleButton) {
        // Wait a bit more to ensure ProjectFilters has rendered
        this.setTimeout(() => {
            // Look for .project-filters in the container (it might be in a wrapper)
            const filtersEl = filtersContainer.querySelector('.project-filters');
            
            if (!filtersEl) {
                // Only retry once, then give up silently
                const retryCount = this._filtersToggleRetryCount || 0;
                if (retryCount < 1) {
                    this._filtersToggleRetryCount = retryCount + 1;
                    this.setTimeout(() => this.setupFiltersToggle(filtersContainer, toggleButton), 200);
                }
                return;
            }
            
            // Reset retry count on success
            this._filtersToggleRetryCount = 0;
            
            // Find toggle button in container if not provided or if it's been removed
            let actualToggleButton = toggleButton;
            if (!actualToggleButton || !actualToggleButton.parentNode) {
                actualToggleButton = filtersContainer.querySelector('.filters-toggle-button');
            }
            
            if (!actualToggleButton) {
                // Silently return - toggle button might not be needed
                return;
            }
            
            // Only replace if button has a parent (is in DOM)
            if (actualToggleButton.parentNode) {
                // Remove existing listeners by cloning
                const newToggleButton = actualToggleButton.cloneNode(true);
                actualToggleButton.parentNode.replaceChild(newToggleButton, actualToggleButton);
                actualToggleButton = newToggleButton;
            }
            
            // Check if mobile (window width <= 768px)
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                filtersEl.classList.remove('expanded');
                actualToggleButton.classList.remove('expanded');
            } else {
                filtersEl.classList.add('expanded');
                actualToggleButton.classList.add('expanded');
            }
            
            // Ensure toggle button is visible on mobile
            if (isMobile) {
                actualToggleButton.style.display = 'flex';
            }
            
            const handleToggleClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isExpanded = filtersEl.classList.contains('expanded');
                if (isExpanded) {
                    filtersEl.classList.remove('expanded');
                    actualToggleButton.classList.remove('expanded');
                } else {
                    filtersEl.classList.add('expanded');
                    actualToggleButton.classList.add('expanded');
                }
            };
            
            actualToggleButton.addEventListener('click', handleToggleClick);
            
            // Handle window resize
            const handleResize = () => {
                const isMobileNow = window.innerWidth <= 768;
                if (!isMobileNow) {
                    filtersEl.classList.add('expanded');
                    newToggleButton.classList.add('expanded');
                    newToggleButton.style.display = 'none';
                } else {
                    // On mobile, ensure toggle is visible
                    newToggleButton.style.display = 'flex';
                }
            };
            
            window.addEventListener('resize', handleResize);
            this.registerCleanup(() => {
                window.removeEventListener('resize', handleResize);
            });
        }, 50);
    }

    /**
     * Check if a project is a mock/demonstration project
     * @param {Object} project - Project data
     * @returns {boolean} True if project is a mock
     */
    isMockProject(project) {
        if (!serviceFactory.isUsingMock()) {
            return false;
        }
        
        const address = project.address || '';
        
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

    /**
     * Render HTML for a single project card
     * @param {Object} project - Project data
     * @returns {string} - HTML string for the card
     */
    renderProjectCardHTML(project) {
        const isFeatured = project.name === 'CULT EXECUTIVES' || project.name === 'CULT EXEC';
        const isMock = this.isMockProject(project);
        const contractType = project.contractType || 'Unknown';
        const volume = project.stats?.volume || '0 ETH';
        const holders = project.stats?.holders || 0;
        const supply = project.stats?.totalSupply || 0;
        const audited = project.audited || false;
        const creatorTwitter = project.creatorTwitter || null;
        const etherscanUrl = project.etherscanUrl || null;
        const githubUrl = project.githubUrl || null;
        const twitterUrl = project.twitterUrl || null;
        const name = this.escapeHtml(project.name);
        const description = this.escapeHtml(project.description || 'No description available');
        const address = this.escapeHtml(project.address);
        
        // Get factory allegiance from metadata
        const factoryMetadata = FACTORY_METADATA[contractType];
        const allegiance = factoryMetadata?.allegiance || null;

        // Generate etherscan URL if address exists but no URL provided
        const etherscanLink = etherscanUrl || (address ? `https://etherscan.io/address/${address}` : null);

        // Get card image - use project imageURI if available, otherwise use CULT EXEC hardcoded image
        const projectImage = project.imageURI || project.image || null;
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
                               onclick="event.stopPropagation()">
                                ${renderIcon('creator', 'icon-creator')}
                            </a>
                        ` : ''}
                    </div>
                </div>
                
                ${isFeatured ? '<div class="featured-badge">FEATURED</div>' : ''}
                ${isMock ? '<div class="mock-badge">For Demonstration Only</div>' : ''}
                
                <div class="card-header">
                    <h3 class="card-title">${name}</h3>
                    <span class="contract-type-badge ${contractType.toLowerCase()}">${contractType}</span>
                </div>
                
                <div class="card-scrollable-content">
                <p class="card-description">${description}</p>
                
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
                
                <button class="view-project-button" data-project-address="${address}">
                    ${isFeatured ? 'View CULT EXECUTIVES →' : 'View Project →'}
                </button>
            </div>
        `;
    }

    /**
     * Update project cards container using granular DOM update
     * Preserves scroll position and avoids remounting
     * @param {Array} projects - Array of project objects
     */
    updateProjectCardsContainer(projects) {
        const container = this.getRef('projects-container', '.projects-container');
        if (!container) return;

        // Save scroll position before update
        this._domUpdater.saveState(container);

        // Generate HTML for all project cards
        const cardsHTML = projects.map(project => this.renderProjectCardHTML(project)).join('');

        // Update container content (smooth with requestAnimationFrame)
        container.innerHTML = cardsHTML;

        // Re-attach click handlers for navigation (innerHTML clears data attributes, so always re-attach)
        // Reset the marker so handlers can be attached again
        container.dataset.cardHandlersAttached = 'false';
        this.attachCardClickHandlers(container);

        // Restore scroll position after update
        this._domUpdater.restoreState(container);
    }

    /**
     * Update featured cards container using granular DOM update
     * @param {Array} projects - Array of featured project objects
     */
    updateFeaturedCardsContainer(projects) {
        const container = this.getRef('featured-container', '.featured-grid');
        if (!container) return;

        // Save scroll position before update
        this._domUpdater.saveState(container);

        // Generate HTML for all featured project cards
        const cardsHTML = projects.map(project => this.renderProjectCardHTML(project)).join('');

        // Update container content
        container.innerHTML = cardsHTML;

        // Re-attach click handlers for navigation (innerHTML clears data attributes, so always re-attach)
        // Reset the marker so handlers can be attached again
        container.dataset.cardHandlersAttached = 'false';
        this.attachCardClickHandlers(container);

        // Restore scroll position after update
        this._domUpdater.restoreState(container);
    }

    /**
     * Attach click handlers to project cards in a container
     * Uses event delegation - only attaches once per container
     * @param {HTMLElement} container - Container element with project cards
     */
    attachCardClickHandlers(container) {
        if (!container) return;

        // Check if handler already attached (use data attribute as marker)
        if (container.dataset.cardHandlersAttached === 'true') {
            return; // Already attached, skip
        }

        // Mark as attached
        container.dataset.cardHandlersAttached = 'true';

        // Use event delegation for better performance
        // Single listener handles all cards
        container.addEventListener('click', async (e) => {
            const card = e.target.closest('.project-card');
            if (!card) return;

            const projectAddress = card.getAttribute('data-project-id');
            if (!projectAddress) return;

            // Find the project data
            // Check hardcoded CULT EXEC first, then regular projects, then featured
            let project = null;
            const cultExecProject = this.createHardcodedCultExecProject();
            if (cultExecProject.address === projectAddress) {
                project = cultExecProject;
            } else {
                project = this.state.projects.find(p => p.address === projectAddress) ||
                          this.state.featuredProjects.find(p => p.address === projectAddress);
            }
            
            if (!project) return;

            // CULT EXECUTIVES has special route
            if (project.name === 'CULT EXECUTIVES' || project.name === 'CULT EXEC') {
                if (window.router) {
                    window.router.navigate('/cultexecs');
                } else {
                    window.location.href = '/cultexecs';
                }
                return;
            }

            // Try to generate title-based URL
            let path = null;
            try {
                const factoryAddress = project.factoryAddress;
                const projectName = project.name || project.displayName || project.title;

                if (factoryAddress && projectName) {
                    // Load contract config to get factory title
                    const { detectNetwork } = await import('../../config/network.js');
                    const network = detectNetwork();
                    const chainId = network.chainId || 1;

                    const configResponse = await fetch('/src/config/contracts.local.json');
                    if (configResponse.ok) {
                        const config = await configResponse.json();
                        const factory = config.factories?.find(f =>
                            f.address.toLowerCase() === factoryAddress.toLowerCase()
                        );

                        if (factory && factory.title) {
                            const { generateProjectURL } = await import('../../utils/navigation.js');
                            path = generateProjectURL(
                                { title: factory.title },
                                { name: projectName, address: project.address },
                                null,
                                chainId
                            );
                            console.log('[ProjectDiscovery] Generated name-based URL:', path);
                        } else {
                            console.warn('[ProjectDiscovery] Factory not found in config:', factoryAddress);
                        }
                    }
                }
            } catch (error) {
                console.warn('[ProjectDiscovery] Failed to generate name-based URL:', error);
            }

            // Fallback to address-based URL
            if (!path) {
                path = `/project/${project.address}`;
            }

            if (window.router) {
                window.router.navigate(path);
            } else {
                window.location.href = path;
            }
        });
    }

    /**
     * Legacy method for initial mount - still used in setupChildComponents
     * For updates, use updateProjectCardsContainer instead
     */
    mountProjectCards(key, projects, containerRef) {
        const container = this.getRef(containerRef, `[data-ref="${containerRef}"]`);
        if (!container) return;

        // Clear existing cards
        const existingKey = `cards-${key}`;
        if (this._children.has(existingKey)) {
            const existing = this._children.get(existingKey);
            if (Array.isArray(existing)) {
                existing.forEach(card => {
                    if (card && typeof card.unmount === 'function') {
                        card.unmount();
                    }
                });
            } else if (existing && typeof existing.unmount === 'function') {
                existing.unmount();
            }
            this._children.delete(existingKey);
        }

        // For initial mount, we can still use component-based approach
        // But for updates, we use the HTML-based approach
        // Create new cards
        const cards = projects.map((project, index) => {
            const card = new ProjectCard(project, (path) => {
                if (window.router) {
                    window.router.navigate(path);
                } else {
                    window.location.href = path;
                }
            });
            const cardElement = document.createElement('div');
            container.appendChild(cardElement);
            card.mount(cardElement);
            
            // Register cleanup for each card
            this.registerCleanup(() => {
                if (card && typeof card.unmount === 'function') {
                    card.unmount();
                }
            });
            
            return card;
        });

        // Store cards array for reference (not using createChild since it's an array)
        this._children.set(existingKey, cards);
    }

    setupDOMEventListeners() {
        const retryButton = this.getRef('retry-button', '.retry-button');
        const clearAllButton = this.getRef('clear-all-button', '.clear-filters-button');

        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.loadData();
            });
        }

        if (clearAllButton) {
            clearAllButton.addEventListener('click', () => {
                const filters = this._children.get('filters');
                if (filters) {
                    filters.setState({
                        selectedType: 'all',
                        selectedFactory: 'all',
                        sortBy: 'date'
                    });
                    filters.notifyChange();
                }
            });
        }

        // Note: Search toggle button uses event delegation in mount() - no need to attach here
    }

    handleSearchToggle() {
        console.log('[ProjectDiscovery] Search toggle clicked, current state:', this.state.controlsExpanded);
        const newExpanded = !this.state.controlsExpanded;
        this.setState({ controlsExpanded: newExpanded });

        // Directly toggle the class for immediate visual feedback
        const controlsContainer = this.getRef('controls-container', '.discovery-controls');
        console.log('[ProjectDiscovery] Controls container found:', !!controlsContainer);
        if (controlsContainer) {
            if (newExpanded) {
                console.log('[ProjectDiscovery] Adding expanded class');
                controlsContainer.classList.add('expanded');
            } else {
                console.log('[ProjectDiscovery] Removing expanded class');
                controlsContainer.classList.remove('expanded');
            }
        }
    }

    handleSearch(query) {
        this.setState({ searchQuery: query });
        this.applyFilters();
    }

    handleFilterChange(filters) {
        this.setState({ filters });
        this.applyFilters();
    }

    async applyFilters() {
        try {
            // Save focus state before filtering (may trigger re-render)
            this._domUpdater.saveState(this.element);

            let filtered = [...this.state.projects];

            // Apply search filter
            if (this.state.searchQuery) {
                const searchResults = await this.projectRegistry.searchProjects(this.state.searchQuery);
                const searchAddresses = new Set(searchResults.map(p => p.address));
                filtered = filtered.filter(p => searchAddresses.has(p.address));
            }

            // Apply type filter
            if (this.state.filters.type !== 'all') {
                const typeResults = await this.projectRegistry.filterByType(this.state.filters.type);
                const typeAddresses = new Set(typeResults.map(p => p.address));
                filtered = filtered.filter(p => typeAddresses.has(p.address));
            }

            // Apply factory filter
            if (this.state.filters.factory !== 'all') {
                const factoryResults = await this.projectRegistry.filterByFactory(this.state.filters.factory);
                const factoryAddresses = new Set(factoryResults.map(p => p.address));
                filtered = filtered.filter(p => factoryAddresses.has(p.address));
            }

            // Apply sorting
            const sorted = await this.projectRegistry.sortBy(this.state.filters.sortBy, filtered);

            // Prepend hardcoded CULT EXEC project to the top of the list
            // This ensures it always appears first, regardless of filters or sorting
            const cultExecProject = this.createHardcodedCultExecProject();
            const finalProjects = [cultExecProject, ...sorted];

            // Update state (this will trigger onStateUpdate which handles the DOM update)
            this.setState({ filteredProjects: finalProjects });

            // Restore focus state after state update completes
            // Use setTimeout to ensure state update has processed
            this.setTimeout(() => {
                this._domUpdater.restoreState(this.element);
            }, 0);
        } catch (error) {
            console.error('Error applying filters:', error);
            this.setState({ error: 'Failed to filter projects' });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

