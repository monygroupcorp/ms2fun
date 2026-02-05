/**
 * FactoryExploration - Microact Version
 *
 * Displays all available factories in an informative grid.
 * Fetches factory data from MasterService and enriches with metadata.
 */

import { Component, h } from '../../core/microact-setup.js';
import { FactoryCard } from './FactoryCard.microact.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { enrichFactoryData } from '../../utils/factoryMetadata.js';

export class FactoryExploration extends Component {
    constructor(props = {}) {
        super(props);
        this.masterService = serviceFactory.getMasterService();
        this.projectRegistry = serviceFactory.getProjectRegistry();
        this.state = {
            factories: [],
            loading: true,
            error: null
        };
        this.factoryCards = [];
    }

    async didMount() {
        await this.loadFactories();
    }

    async loadFactories() {
        try {
            this.setState({ loading: true, error: null });

            const factoryAddresses = await this.masterService.getAuthorizedFactories();
            const enrichedFactories = [];

            for (const address of factoryAddresses) {
                const type = await this.masterService.getFactoryType(address);
                const instances = await this.masterService.getInstancesByFactory(address);

                let factoryTitle = null;
                let factoryDisplayTitle = null;
                if (serviceFactory.isUsingMock()) {
                    const mockData = serviceFactory.getMockData();
                    const factoryData = mockData?.factories?.[address];
                    if (factoryData) {
                        factoryTitle = factoryData.title;
                        factoryDisplayTitle = factoryData.displayTitle;
                    }
                }

                const exampleProjects = [];
                for (let i = 0; i < Math.min(3, instances.length); i++) {
                    try {
                        const project = await this.projectRegistry.getProject(instances[i]);
                        if (project) exampleProjects.push(project);
                    } catch (err) {
                        // Project might not be indexed
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
            console.error('[FactoryExploration] Error loading factories:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load factories'
            });
        }
    }

    handleRetry() {
        this.loadFactories();
    }

    handleBack() {
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate('/');
        } else if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    handleApplyFactory() {
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate('/factories/apply');
        } else if (window.router) {
            window.router.navigate('/factories/apply');
        } else {
            window.location.href = '/factories/apply';
        }
    }

    render() {
        const { factories, loading, error } = this.state;

        if (loading) {
            return h('div', { className: 'factory-exploration' },
                h('div', { className: 'loading-state' },
                    h('div', { className: 'spinner' }),
                    h('p', null, 'Loading factories...')
                )
            );
        }

        if (error) {
            return h('div', { className: 'factory-exploration' },
                h('div', { className: 'error-state' },
                    h('p', { className: 'error-message' }, error),
                    h('button', {
                        className: 'retry-button',
                        onClick: this.bind(this.handleRetry)
                    }, 'Retry')
                )
            );
        }

        if (factories.length === 0) {
            return h('div', { className: 'factory-exploration' },
                h('div', { className: 'empty-state' },
                    h('h2', null, 'No Factories Available'),
                    h('p', null, 'There are no authorized factories available at this time.'),
                    h('button', {
                        className: 'back-button',
                        onClick: this.bind(this.handleBack)
                    }, '← Back to Home')
                )
            );
        }

        return h('div', { className: 'factory-exploration' },
            h('div', { className: 'exploration-header' },
                h('h1', null, 'Launch Your Own Project'),
                h('p', { className: 'subtitle' }, 'Choose a factory to create your Web3 project')
            ),

            h('div', { className: 'factories-grid' },
                ...factories.map((factory, index) =>
                    h(FactoryCard, {
                        key: factory.address,
                        factory,
                        onNavigate: this.props.onNavigate
                    })
                )
            ),

            h('div', { className: 'factory-actions' },
                h('button', {
                    className: 'apply-factory-button',
                    onClick: this.bind(this.handleApplyFactory)
                },
                    h('span', { className: 'button-icon' }, '➕'),
                    h('span', { className: 'button-text' }, 'Apply for Factory')
                )
            )
        );
    }
}

export default FactoryExploration;
