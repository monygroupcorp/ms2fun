import { Component } from '../../core/Component.js';
import { FactoryCard } from './FactoryCard.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { enrichFactoryData } from '../../utils/factoryMetadata.js';

/**
 * FactoryExploration component
 * Displays all available factories in an informative grid
 */
export class FactoryExploration extends Component {
    constructor() {
        super();
        this.masterService = serviceFactory.getMasterService();
        this.projectRegistry = serviceFactory.getProjectRegistry();
        this.state = {
            factories: [],
            loading: true,
            error: null
        };
    }

    async onMount() {
        await this.loadFactories();
    }

    async loadFactories() {
        try {
            this.setState({ loading: true, error: null });

            // Get all authorized factories
            const factoryAddresses = await this.masterService.getAuthorizedFactories();
            
            // Enrich factory data with metadata
            const enrichedFactories = [];
            for (const address of factoryAddresses) {
                const type = await this.masterService.getFactoryType(address);
                const instances = await this.masterService.getInstancesByFactory(address);
                
                // Get factory title from mock data (if available)
                let factoryTitle = null;
                let factoryDisplayTitle = null;
                if (serviceFactory.isUsingMock()) {
                    const mockData = serviceFactory.getMockData();
                    if (mockData) {
                        const factoryData = mockData?.factories?.[address];
                        if (factoryData) {
                            factoryTitle = factoryData.title;
                            factoryDisplayTitle = factoryData.displayTitle;
                        }
                    }
                }
                
                // Get example projects (if available)
                const exampleProjects = [];
                if (instances.length > 0) {
                    // Try to get project data for examples
                    for (let i = 0; i < Math.min(3, instances.length); i++) {
                        try {
                            const project = await this.projectRegistry.getProject(instances[i]);
                            if (project) {
                                exampleProjects.push(project);
                            }
                        } catch (err) {
                            // Project might not be indexed, skip
                        }
                    }
                }

                const factory = { 
                    address, 
                    type,
                    title: factoryTitle,
                    displayTitle: factoryDisplayTitle
                };
                const enriched = enrichFactoryData(factory, instances.length, exampleProjects);
                enrichedFactories.push(enriched);
            }

            this.setState({
                factories: enrichedFactories,
                loading: false
            });
        } catch (error) {
            console.error('Error loading factories:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load factories'
            });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="factory-exploration">
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Loading factories...</p>
                    </div>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="factory-exploration">
                    <div class="error-state">
                        <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                        <button class="retry-button" data-ref="retry-button">Retry</button>
                    </div>
                </div>
            `;
        }

        if (this.state.factories.length === 0) {
            return `
                <div class="factory-exploration">
                    <div class="empty-state">
                        <h2>No Factories Available</h2>
                        <p>There are no authorized factories available at this time.</p>
                        <button class="back-button" data-ref="back-button">← Back to Home</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="factory-exploration">
                <div class="exploration-header">
                    <h1>Launch Your Own Project</h1>
                    <p class="subtitle">Choose a factory to create your Web3 project</p>
                </div>

                <div class="factories-grid" data-ref="factories-container">
                    <!-- Factory cards will be mounted here -->
                </div>

                <div class="factory-actions">
                    <button class="apply-factory-button" data-ref="apply-factory-button">
                        <span class="button-icon">➕</span>
                        <span class="button-text">Apply for Factory</span>
                    </button>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.setupFactoryCards();
            this.setupDOMEventListeners();
        }, 0);
    }

    update() {
        super.update();
        this.setTimeout(() => {
            this.setupFactoryCards();
            this.setupDOMEventListeners();
        }, 0);
    }

    setupFactoryCards() {
        const container = this.getRef('factories-container', '.factories-grid');
        if (!container) return;

        // Clear existing cards
        const existingCards = this._children.get('factory-cards');
        if (existingCards && Array.isArray(existingCards)) {
            existingCards.forEach(card => {
                if (card && typeof card.unmount === 'function') {
                    card.unmount();
                }
            });
        }
        this._children.delete('factory-cards');

        // Create new factory cards
        const cards = this.state.factories.map((factory, index) => {
            const card = new FactoryCard(factory);
            const cardElement = document.createElement('div');
            container.appendChild(cardElement);
            card.mount(cardElement);
            
            this.registerCleanup(() => {
                if (card && typeof card.unmount === 'function') {
                    card.unmount();
                }
            });
            
            return card;
        });

        this._children.set('factory-cards', cards);
    }

    setupDOMEventListeners() {
        const retryButton = this.getRef('retry-button', '.retry-button');
        const backButton = this.getRef('back-button', '.back-button');
        const applyButton = this.getRef('apply-factory-button', '.apply-factory-button');

        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.loadFactories();
            });
        }

        if (backButton) {
            backButton.addEventListener('click', () => {
                if (window.router) {
                    window.router.navigate('/');
                } else {
                    window.location.href = '/';
                }
            });
        }

        if (applyButton) {
            applyButton.addEventListener('click', () => {
                if (window.router) {
                    window.router.navigate('/factories/apply');
                } else {
                    window.location.href = '/factories/apply';
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

