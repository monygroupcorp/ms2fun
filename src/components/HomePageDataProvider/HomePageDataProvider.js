import { Component } from '../../core/Component.js';
import queryService from '../../services/QueryService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { eventBus } from '../../core/EventBus.js';

/**
 * HomePageDataProvider
 *
 * Fetches all home page data in a single batched call via QueryService.
 * Passes data down to child components, eliminating redundant RPC calls.
 *
 * Data provided:
 * - projects: Featured project cards
 * - topVaults: Top vaults by TVL
 * - recentActivity: Recent global messages
 * - totalFeatured: Total count for pagination
 */
export class HomePageDataProvider extends Component {
    constructor() {
        super();
        this.state = {
            projects: [],
            topVaults: [],
            recentActivity: [],
            totalFeatured: 0,
            loading: true,
            error: null,
            lastFetchTime: null
        };

        // Child component instances (set by parent after mounting)
        this.children = {
            topVaultsWidget: null,
            recentActivityWidget: null,
            projectDiscovery: null
        };
    }

    async onMount() {
        this._setupEventListeners();
        await this.fetchData();
    }

    _setupEventListeners() {
        // Refresh on transaction confirmation
        this.subscribe('transaction:confirmed', () => {
            this.fetchData();
        });

        // Refresh on wallet connect (user data may change)
        this.subscribe('wallet:connected', () => {
            this.fetchData();
        });
    }

    /**
     * Subscribe to eventBus with automatic cleanup
     */
    subscribe(event, handler) {
        eventBus.on(event, handler);
        this._subscriptions.add({ event, handler });
    }

    /**
     * Fetch all home page data in one batched call
     */
    async fetchData() {
        try {
            this.setState({ loading: true, error: null });

            console.log('[HomePageDataProvider] Fetching home page data...');
            const startTime = performance.now();

            // Single batched call via QueryService
            const data = await queryService.getHomePageData(0, 20);

            let projects = data.projects || [];
            let totalFeatured = data.totalFeatured || 0;

            // Always supplement featured projects with non-featured instances
            // The featured queue may only contain a subset of all registered instances
            if (!await queryService.isInPreLaunchMode()) {
                const allInstances = await this._fetchAllInstancesAsProjects();

                if (allInstances.length > 0) {
                    // Create a Set of featured addresses for quick lookup
                    const featuredAddresses = new Set(
                        projects.map(p => (p.instance || p.address || '').toLowerCase())
                    );

                    // Add non-featured instances after featured ones
                    const nonFeatured = allInstances.filter(
                        p => !featuredAddresses.has((p.instance || p.address || '').toLowerCase())
                    );

                    if (nonFeatured.length > 0) {
                        console.log(`[HomePageDataProvider] Adding ${nonFeatured.length} non-featured instances`);
                        projects = [...projects, ...nonFeatured];
                    }
                }
            }

            const fetchTime = performance.now() - startTime;
            console.log(`[HomePageDataProvider] Data fetched in ${fetchTime.toFixed(0)}ms`);
            console.log(`[HomePageDataProvider] Projects: ${projects.length} (${totalFeatured} featured), Vaults: ${data.topVaults?.length || 0}, Messages: ${data.recentActivity?.length || 0}`);

            this.setState({
                projects,
                topVaults: data.topVaults || [],
                recentActivity: data.recentActivity || [],
                totalFeatured,
                loading: false,
                lastFetchTime: Date.now()
            });

            // Notify children of new data
            this._updateChildren();

        } catch (error) {
            console.error('[HomePageDataProvider] Error fetching data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load home page data'
            });
        }
    }

    /**
     * Fallback: Fetch all registered instances as project cards
     * Used when featured queue is empty
     */
    async _fetchAllInstancesAsProjects() {
        try {
            const masterService = serviceFactory.getMasterService();
            const allInstances = await masterService.getAllInstances();

            if (!allInstances || allInstances.length === 0) {
                return [];
            }

            // Extract addresses (instances may be objects or strings)
            const addresses = allInstances
                .slice(0, 20) // Limit to 20 for home page
                .map(inst => inst.instanceAddress || inst.address || inst);

            // Use QueryService to get project cards (with caching)
            const projects = await queryService.getProjectCardsBatch(addresses);
            return projects;
        } catch (error) {
            console.warn('[HomePageDataProvider] Failed to fetch all instances:', error.message);
            return [];
        }
    }

    /**
     * Update child components with new data
     */
    _updateChildren() {
        const { projects, topVaults, recentActivity, totalFeatured } = this.state;

        // Update TopVaultsWidget if registered
        if (this.children.topVaultsWidget) {
            this.children.topVaultsWidget.setVaultsData(topVaults);
        }

        // Update RecentActivityWidget if registered
        if (this.children.recentActivityWidget) {
            this.children.recentActivityWidget.setMessagesData(recentActivity);
        }

        // Update ProjectDiscovery if registered
        if (this.children.projectDiscovery) {
            this.children.projectDiscovery.setProjectsData(projects, totalFeatured);
        }
    }

    /**
     * Register a child component to receive data updates
     * @param {string} name - Child name (topVaultsWidget, recentActivityWidget, projectDiscovery)
     * @param {Component} component - Child component instance
     */
    registerChild(name, component) {
        if (this.children.hasOwnProperty(name)) {
            this.children[name] = component;

            // If we already have data, send it immediately
            if (!this.state.loading && !this.state.error) {
                this._updateChild(name);
            }
        }
    }

    /**
     * Update a single child with current data
     */
    _updateChild(name) {
        const { projects, topVaults, recentActivity, totalFeatured } = this.state;

        switch (name) {
            case 'topVaultsWidget':
                if (this.children.topVaultsWidget) {
                    this.children.topVaultsWidget.setVaultsData(topVaults);
                }
                break;
            case 'recentActivityWidget':
                if (this.children.recentActivityWidget) {
                    this.children.recentActivityWidget.setMessagesData(recentActivity);
                }
                break;
            case 'projectDiscovery':
                if (this.children.projectDiscovery) {
                    this.children.projectDiscovery.setProjectsData(projects, totalFeatured);
                }
                break;
        }
    }

    /**
     * Manual refresh - can be called by parent or children
     */
    async refresh() {
        await this.fetchData();
    }

    /**
     * Get current data state (for components that need it synchronously)
     */
    getData() {
        return {
            projects: this.state.projects,
            topVaults: this.state.topVaults,
            recentActivity: this.state.recentActivity,
            totalFeatured: this.state.totalFeatured,
            loading: this.state.loading,
            error: this.state.error
        };
    }

    /**
     * Check if data is stale (older than TTL)
     * @param {number} ttlMs - Time-to-live in milliseconds
     */
    isStale(ttlMs = 30000) {
        if (!this.state.lastFetchTime) return true;
        return Date.now() - this.state.lastFetchTime > ttlMs;
    }

    render() {
        // This component doesn't render anything itself
        // It just provides data to children
        return '';
    }
}

export default HomePageDataProvider;
