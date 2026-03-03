/**
 * ProjectDiscovery - Browse and filter all projects
 *
 * Features:
 * - Search by name
 * - Filter by vault, type, ERC standard, state
 * - Sort by activity, TVL, volume, holders, newest
 * - Load more pagination
 *
 * @example
 * h(ProjectDiscovery)
 */

import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';
import {
    TYPE_ERC404, TYPE_ERC1155, TYPE_ERC721,
    STATE_BONDING, STATE_GRADUATED, STATE_ACTIVE, STATE_PAUSED, STATE_ENDED,
    getTypeLabel, getStateLabel
} from '../utils/lifecycleConstants.js';
import DataAdapter from '../services/DataAdapter.js';
import { debug } from '../utils/debug.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

export class ProjectDiscovery extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            projects: [],
            filters: {
                search: '',
                vault: '',
                type: '',
                erc: '',
                state: '',
                sortBy: 'recent'
            },
            resultsCount: 0,
            displayCount: 12, // Initial load
            filtersAppliedCount: 0
        };
    }

    async didMount() {
        // Load route-specific CSS with layer ID
        await stylesheetLoader.load('/src/core/route-discovery-v2.css', 'route:discovery');

        // Web3 context provided by route handler as props
        const { mode, config, provider } = this.props;
        debug.log('[ProjectDiscovery] Loading data with mode:', mode);
        await this.loadData(mode, config, provider);
    }

    async loadData(mode, config, provider) {
        try {
            debug.log('[ProjectDiscovery] Starting data load...');
            const t0 = performance.now();

            // Get project data
            const dataAdapter = new DataAdapter(mode, config, provider);
            const { projects, vaults } = await dataAdapter.getCriticalData();
            const t1 = performance.now();
            debug.log(`[ProjectDiscovery] ✓ Projects loaded: ${projects.length} projects, ${vaults.length} vaults (${(t1 - t0).toFixed(0)}ms)`);

            this.setState({
                loading: false,
                projects,
                vaults,
                resultsCount: projects.length
            });

            debug.log(`[ProjectDiscovery] ✓ Total load time: ${(t1 - t0).toFixed(0)}ms`);
        } catch (error) {
            debug.error('[ProjectDiscovery] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message
            });
        }
    }

    handleSearchChange = (e) => {
        this.updateFilter('search', e.target.value);
    }

    handleFilterChange = (filterName, value) => {
        this.updateFilter(filterName, value);
    }

    updateFilter(name, value) {
        const newFilters = { ...this.state.filters, [name]: value };

        // Count applied filters (non-empty, non-default)
        let count = 0;
        if (newFilters.search) count++;
        if (newFilters.vault) count++;
        if (newFilters.type) count++;
        if (newFilters.erc) count++;
        if (newFilters.state) count++;

        this.setState({
            filters: newFilters,
            filtersAppliedCount: count
        });
    }

    handleClearFilters = () => {
        this.setState({
            filters: {
                search: '',
                vault: '',
                type: '',
                erc: '',
                state: '',
                sortBy: 'recent'
            },
            filtersAppliedCount: 0
        });
    }

    handleLoadMore = () => {
        this.setState({
            displayCount: this.state.displayCount + 12
        });
    }

    handleProjectClick = (project) => {
        // Navigate to project detail page
        const route = project.address ? `/project/${project.address}` : `/${project.slug}`;
        window.router.navigate(route);
    }

    getFilteredProjects() {
        const { projects, filters } = this.state;
        let filtered = [...projects];

        // Search filter
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(searchLower) ||
                p.symbol?.toLowerCase().includes(searchLower) ||
                p.description?.toLowerCase().includes(searchLower)
            );
        }

        // Vault filter
        if (filters.vault) {
            filtered = filtered.filter(p => {
                // Match vault address (case-insensitive)
                return p.vault?.toLowerCase() === filters.vault.toLowerCase();
            });
        }

        // Project type filter (collection vs bonding)
        if (filters.type) {
            filtered = filtered.filter(p => {
                // Use QueryAggregator data: bonding projects have currentPrice > 0
                const isBonding = p.type === 'ERC404' && parseFloat(p.currentPrice || '0') > 0;
                if (filters.type === 'bonding') return isBonding;
                if (filters.type === 'collection') return !isBonding;
                return true;
            });
        }

        // ERC standard filter (using instanceType from IInstanceLifecycle)
        if (filters.erc) {
            filtered = filtered.filter(p => {
                // Use instanceType (bytes32) from indexed lifecycle data
                const instanceType = p.instanceType;
                if (filters.erc === '404') return instanceType === TYPE_ERC404;
                if (filters.erc === '1155') return instanceType === TYPE_ERC1155;
                if (filters.erc === '721') return instanceType === TYPE_ERC721;
                return true;
            });
        }

        // State filter (using currentState from StateChanged events)
        if (filters.state) {
            filtered = filtered.filter(p => {
                // Use currentState (bytes32) from indexed StateChanged events
                const currentState = p.currentState;

                // Match UI filter values to lifecycle state constants
                if (filters.state === 'bonding') {
                    return currentState === STATE_BONDING;
                }
                if (filters.state === 'graduated') {
                    return currentState === STATE_GRADUATED;
                }
                if (filters.state === 'active' || filters.state === 'deployed') {
                    return currentState === STATE_ACTIVE;
                }
                if (filters.state === 'minting') {
                    return currentState === STATE_MINTING;
                }
                if (filters.state === 'paused') {
                    return currentState === STATE_PAUSED;
                }
                if (filters.state === 'ended' || filters.state === 'inactive') {
                    return currentState === STATE_ENDED;
                }

                return true;
            });
        }

        // Sort
        if (filters.sortBy === 'newest') {
            filtered.reverse(); // Newest first
        } else if (filters.sortBy === 'tvl') {
            // Sort by TVL (highest first)
            filtered.sort((a, b) => {
                const tvlA = parseFloat(a.tvl || '0');
                const tvlB = parseFloat(b.tvl || '0');
                return tvlB - tvlA;
            });
        } else if (filters.sortBy === 'volume') {
            // Sort by volume (highest first)
            filtered.sort((a, b) => {
                const volA = parseFloat(a.volume || '0');
                const volB = parseFloat(b.volume || '0');
                return volB - volA;
            });
        }
        // 'recent' is default - keep original order

        return filtered;
    }

    renderProjectCard(project, index) {
        // Extract first letter for placeholder image
        const firstLetter = project.name ? project.name[0].toUpperCase() : '?';

        // Shorten address for display
        const shortAddress = project.address
            ? `${project.address.slice(0, 6)}...`
            : '0x????...';

        // Determine state badge text
        let stateBadge = 'Deployed';
        if (project.bondingCurve) {
            stateBadge = 'Bonding Active';
        }

        return h('div', {
            key: project.address || index,
            className: 'project-card',
            onclick: () => this.handleProjectClick(project)
        },
            h('div', { className: 'project-card-image' }, firstLetter),
            h('div', { className: 'project-card-content' },
                h('h3', { className: 'project-card-title' }, project.name),
                h('div', { className: 'project-card-meta' },
                    h('span', { className: 'text-mono text-secondary' }, shortAddress),
                    h('span', { className: 'badge' }, project.type)
                ),
                h('p', { className: 'project-card-description' },
                    project.description || 'No description available.'
                ),
                h('div', { className: 'project-card-stats' },
                    h('span', { className: 'text-secondary' }, 'TVL:'),
                    h('span', { className: 'text-mono' },
                        project.bondingCurve?.totalSupply
                            ? `${project.bondingCurve.totalSupply} tokens`
                            : 'N/A'
                    )
                ),
                h('div', { className: 'project-card-state' }, stateBadge)
            )
        );
    }

    render() {
        const { loading, error, filters, resultsCount, displayCount, filtersAppliedCount, vaults } = this.state;
        const filteredProjects = this.getFilteredProjects();
        const visibleProjects = filteredProjects.slice(0, displayCount);
        const hasMore = filteredProjects.length > displayCount;

        return h(Layout, {
            currentPath: '/discover',
            children: h('div', { className: 'discovery-page' },
                // Content
                h('div', { className: 'discovery-content' },
                    h('h1', { className: 'page-title' }, 'Projects'),

                    // Search
                    h('div', { className: 'search-section' },
                        h('div', { className: 'search-bar' },
                            h('input', {
                                type: 'text',
                                className: 'search-input',
                                placeholder: 'Search projects by name...',
                                value: filters.search,
                                oninput: this.handleSearchChange
                            }),
                            h('button', { className: 'btn btn-primary' }, 'Search')
                        )
                    ),

                    // Filters
                    h('div', { className: 'filter-panel' },
                        h('div', { className: 'filter-grid' },
                            // Vault filter - populated from real vault data
                            h('div', { className: 'filter-group' },
                                h('label', { className: 'filter-label' }, 'Vault'),
                                h('select', {
                                    className: 'filter-select',
                                    value: filters.vault,
                                    onchange: (e) => this.handleFilterChange('vault', e.target.value)
                                },
                                    h('option', { value: '' }, 'All Vaults'),
                                    ...(vaults || []).map(vault =>
                                        h('option', { value: vault.address, key: vault.address },
                                            vault.name || `Vault ${vault.address.slice(0, 6)}...`
                                        )
                                    )
                                )
                            ),

                            // Type filter (TODO: populate from factory types)
                            h('div', { className: 'filter-group' },
                                h('label', { className: 'filter-label' }, 'Project Type'),
                                h('select', {
                                    className: 'filter-select',
                                    value: filters.type,
                                    onchange: (e) => this.handleFilterChange('type', e.target.value)
                                },
                                    h('option', { value: '' }, 'All Types'),
                                    h('option', { value: 'collection' }, 'Collection'),
                                    h('option', { value: 'bonding' }, 'Bonding')
                                )
                            ),

                            // ERC standard filter
                            h('div', { className: 'filter-group' },
                                h('label', { className: 'filter-label' }, 'Token Standard'),
                                h('select', {
                                    className: 'filter-select',
                                    value: filters.erc,
                                    onchange: (e) => this.handleFilterChange('erc', e.target.value)
                                },
                                    h('option', { value: '' }, 'All Standards'),
                                    h('option', { value: '721' }, 'ERC721'),
                                    h('option', { value: '1155' }, 'ERC1155'),
                                    h('option', { value: '404' }, 'ERC404')
                                )
                            ),

                            // State filter (TODO: determine state from on-chain data)
                            h('div', { className: 'filter-group' },
                                h('label', { className: 'filter-label' }, 'State'),
                                h('select', {
                                    className: 'filter-select',
                                    value: filters.state,
                                    onchange: (e) => this.handleFilterChange('state', e.target.value)
                                },
                                    h('option', { value: '' }, 'All States'),
                                    h('option', { value: 'minting' }, 'Minting'),
                                    h('option', { value: 'bonding' }, 'Bonding Active'),
                                    h('option', { value: 'deployed' }, 'Deployed')
                                )
                            ),

                            // Sort
                            h('div', { className: 'filter-group' },
                                h('label', { className: 'filter-label' }, 'Sort By'),
                                h('select', {
                                    className: 'filter-select',
                                    value: filters.sortBy,
                                    onchange: (e) => this.handleFilterChange('sortBy', e.target.value)
                                },
                                    h('option', { value: 'recent' }, 'Recent Activity'),
                                    h('option', { value: 'newest' }, 'Newest'),
                                    h('option', { value: 'tvl' }, 'TVL (Highest)'),
                                    h('option', { value: 'volume' }, 'Volume')
                                )
                            )
                        ),

                        h('div', { className: 'filter-actions' },
                            h('button', {
                                className: 'btn btn-ghost btn-sm',
                                onclick: this.handleClearFilters
                            }, 'Clear Filters'),
                            h('span', {
                                className: 'text-secondary text-uppercase',
                                style: 'font-size: var(--font-size-caption); letter-spacing: var(--letter-spacing-wide);'
                            }, `${filtersAppliedCount} filters applied`)
                        )
                    ),

                    // Loading state
                    loading ? h('div', { className: 'loading-message' }, 'Loading projects...') : null,

                    // Error state
                    error ? h('div', { className: 'error-message' }, `Error: ${error}`) : null,

                    // Results
                    !loading && !error ? [
                        h('div', { className: 'results-header' },
                            h('div', { className: 'results-count' },
                                `${filteredProjects.length} Project${filteredProjects.length === 1 ? '' : 's'} Found`
                            )
                        ),

                        h('div', { className: 'projects-grid' },
                            ...visibleProjects.map((project, i) => this.renderProjectCard(project, i))
                        ),

                        // Load More
                        hasMore ? h('div', { className: 'load-more-section' },
                            h('button', {
                                className: 'btn btn-secondary',
                                onclick: this.handleLoadMore
                            }, 'Load More Projects')
                        ) : null
                    ] : null
                )
            )
        });
    }
}

export default ProjectDiscovery;
