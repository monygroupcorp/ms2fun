/**
 * HomePage - Gallery Brutalism homepage
 *
 * Sections:
 * - Featured Banner (hero)
 * - Stats Bar (top vaults)
 * - Recent Activity
 * - Projects Grid
 *
 * @example
 * h(HomePage)
 */

import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';
import { Skeleton, SkeletonProjectCard } from '../components/Loading/index.js';

export class HomePage extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            featured: null,
            projects: [],
            vaults: [],
            activity: [],
            error: null
        };
    }

    async didMount() {
        await this.loadData();
    }

    async loadData() {
        try {
            const serviceFactory = window.serviceFactory;

            // Initialize if needed
            if (!serviceFactory.initialized) {
                await serviceFactory.initialize();
            }

            // Load featured project
            const featuredData = await this.loadFeaturedProject(serviceFactory);

            // Load projects from master registry
            const projectsData = await this.loadProjects(serviceFactory);

            // Load top vaults
            const vaultsData = await this.loadTopVaults(serviceFactory);

            // Load recent activity
            const activityData = await this.loadRecentActivity(serviceFactory);

            this.setState({
                loading: false,
                featured: featuredData,
                projects: projectsData,
                vaults: vaultsData,
                activity: activityData
            });
        } catch (error) {
            console.error('[HomePage] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message
            });
        }
    }

    async loadFeaturedProject(serviceFactory) {
        try {
            const masterService = serviceFactory.getMasterService();
            const featuredQueue = await serviceFactory.getFeaturedQueueManagerAdapter();

            // Get current featured project
            const featured = await featuredQueue.getCurrentFeatured();

            if (featured && featured.instanceAddress) {
                // Get instance details from master registry
                const instanceInfo = await masterService.getInstanceInfo(featured.instanceAddress);

                return {
                    address: featured.instanceAddress,
                    name: instanceInfo?.name || 'Featured Project',
                    type: instanceInfo?.factoryType || 'ERC404',
                    description: instanceInfo?.description || '',
                    tvl: featured.tvl || '0'
                };
            }

            return null;
        } catch (error) {
            console.log('[HomePage] No featured project:', error.message);
            return null;
        }
    }

    async loadProjects(serviceFactory) {
        try {
            const masterService = serviceFactory.getMasterService();
            const instances = await masterService.getAllInstances();

            // Get details for each instance
            const projectsData = await Promise.all(
                instances.slice(0, 8).map(async (address) => {
                    try {
                        const info = await masterService.getInstanceInfo(address);
                        return {
                            address,
                            name: info?.name || 'Unnamed Project',
                            type: info?.factoryType || 'UNKNOWN',
                            description: info?.description || '',
                            tvl: '0' // TODO: Calculate TVL
                        };
                    } catch (error) {
                        console.error('[HomePage] Error loading project:', address, error);
                        return null;
                    }
                })
            );

            return projectsData.filter(p => p !== null);
        } catch (error) {
            console.error('[HomePage] Error loading projects:', error);
            return [];
        }
    }

    async loadTopVaults(serviceFactory) {
        try {
            const masterService = serviceFactory.getMasterService();
            const vaults = await masterService.getAllVaults();

            // Get vault details
            const vaultsData = await Promise.all(
                vaults.slice(0, 3).map(async (address) => {
                    try {
                        const vaultAdapter = await serviceFactory.getVaultAdapter(address);
                        const name = await vaultAdapter.name();
                        const tvl = await vaultAdapter.getTotalValueLocked();

                        return {
                            address,
                            name: name || 'Unnamed Vault',
                            tvl: tvl || '0'
                        };
                    } catch (error) {
                        console.error('[HomePage] Error loading vault:', address, error);
                        return null;
                    }
                })
            );

            return vaultsData.filter(v => v !== null);
        } catch (error) {
            console.error('[HomePage] Error loading vaults:', error);
            return [];
        }
    }

    async loadRecentActivity(serviceFactory) {
        try {
            // TODO: Implement activity feed from event indexer
            // For now, return empty array
            return [];
        } catch (error) {
            console.error('[HomePage] Error loading activity:', error);
            return [];
        }
    }

    handleProjectClick = (project) => (e) => {
        e.preventDefault();
        const path = `/${project.address}`;
        window.router.navigate(path);
    }

    handleFeaturedClick = () => {
        if (this.state.featured) {
            const path = `/${this.state.featured.address}`;
            window.router.navigate(path);
        }
    }

    handleViewAllActivity = (e) => {
        e.preventDefault();
        window.router.navigate('/activity');
    }

    formatTVL(tvl) {
        if (!tvl || tvl === '0') return '$0';

        const num = parseFloat(tvl);
        if (num >= 1000000) {
            return `$${(num / 1000000).toFixed(1)}M`;
        } else if (num >= 1000) {
            return `$${(num / 1000).toFixed(0)}K`;
        }
        return `$${num.toFixed(0)}`;
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { loading, featured, projects, vaults, activity, error } = this.state;

        return h(Layout, { currentPath: '/' },
            h('div', { className: 'home-page' },
                h('div', { className: 'home-content' },
                    // Featured Banner
                    this.renderFeaturedBanner(loading, featured),

                    // Stats Bar
                    this.renderStatsBar(loading, vaults),

                    // Activity Section
                    this.renderActivitySection(loading, activity),

                    // Projects Grid
                    this.renderProjectsSection(loading, projects),

                    // Error message
                    error && h('div', { className: 'error-message' },
                        h('p', null, `Error: ${error}`)
                    )
                )
            )
        );
    }

    renderFeaturedBanner(loading, featured) {
        if (loading) {
            return h('div', { className: 'featured-banner' },
                h(Skeleton, { className: 'skeleton-banner' })
            );
        }

        if (!featured) {
            return null;
        }

        return h('div', {
            className: 'featured-banner',
            onclick: this.handleFeaturedClick
        },
            h('div', { className: 'featured-banner-image' },
                featured.name.charAt(0).toUpperCase()
            ),
            h('div', { className: 'featured-banner-content' },
                h('div', { className: 'featured-banner-label' }, 'FEATURED'),
                h('h2', { className: 'featured-banner-title' }, featured.name),
                h('div', { className: 'featured-banner-meta' },
                    h('span', { className: 'text-mono text-secondary' },
                        this.truncateAddress(featured.address)
                    ),
                    h('span', { className: 'badge' }, featured.type)
                )
            )
        );
    }

    renderStatsBar(loading, vaults) {
        if (loading) {
            return h('div', { className: 'stats-bar' },
                h('span', { className: 'stats-bar-label' }, 'TOP VAULTS:'),
                h(Skeleton, { width: '150px', height: '1em' }),
                h(Skeleton, { width: '150px', height: '1em' }),
                h(Skeleton, { width: '150px', height: '1em' })
            );
        }

        if (!vaults || vaults.length === 0) {
            return null;
        }

        return h('div', { className: 'stats-bar' },
            h('span', { className: 'stats-bar-label' }, 'TOP VAULTS:'),
            ...vaults.flatMap((vault, index) => {
                const items = [
                    h('span', { key: `vault-${index}`, className: 'stats-bar-item' },
                        vault.name,
                        ' ',
                        h('span', { className: 'text-mono' }, this.formatTVL(vault.tvl))
                    )
                ];

                if (index < vaults.length - 1) {
                    items.push(
                        h('span', { key: `sep-${index}`, className: 'stats-bar-separator' }, '|')
                    );
                }

                return items;
            })
        );
    }

    renderActivitySection(loading, activity) {
        if (loading) {
            return h('div', { className: 'activity-section' },
                h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
                h('div', { className: 'activity-list' },
                    h(Skeleton, { width: '100%', height: '1em' }),
                    h(Skeleton, { width: '90%', height: '1em' }),
                    h(Skeleton, { width: '95%', height: '1em' }),
                    h(Skeleton, { width: '85%', height: '1em' })
                )
            );
        }

        // If no activity, show placeholder
        if (!activity || activity.length === 0) {
            return h('div', { className: 'activity-section' },
                h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
                h('div', { className: 'activity-list' },
                    h('div', { className: 'activity-item' },
                        h('span', { className: 'activity-bullet' }, '•'),
                        h('span', { className: 'activity-text' }, 'No recent activity')
                    )
                )
            );
        }

        return h('div', { className: 'activity-section' },
            h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
            h('div', { className: 'activity-list' },
                ...activity.map((item, index) =>
                    h('div', { key: index, className: 'activity-item' },
                        h('span', { className: 'activity-bullet' }, '•'),
                        h('span', { className: 'activity-text' }, item.text)
                    )
                )
            ),
            h('button', {
                className: 'btn btn-ghost',
                onclick: this.handleViewAllActivity
            }, 'View All Activity →')
        );
    }

    renderProjectsSection(loading, projects) {
        if (loading) {
            return h('div', { className: 'projects-section' },
                h('h3', { className: 'projects-title' }, 'PROJECTS'),
                h('div', { className: 'projects-grid' },
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard),
                    h(SkeletonProjectCard)
                )
            );
        }

        if (!projects || projects.length === 0) {
            return h('div', { className: 'projects-section' },
                h('h3', { className: 'projects-title' }, 'PROJECTS'),
                h('p', { className: 'text-secondary' }, 'No projects found')
            );
        }

        return h('div', { className: 'projects-section' },
            h('h3', { className: 'projects-title' }, 'PROJECTS'),
            h('div', { className: 'projects-grid' },
                ...projects.map((project) =>
                    h('div', {
                        key: project.address,
                        className: 'project-card',
                        onclick: this.handleProjectClick(project)
                    },
                        h('div', { className: 'project-card-image' },
                            project.name.charAt(0).toUpperCase()
                        ),
                        h('div', { className: 'project-card-content' },
                            h('h4', { className: 'project-card-title' }, project.name),
                            h('div', { className: 'project-card-meta' },
                                h('span', { className: 'text-mono text-secondary' },
                                    this.truncateAddress(project.address)
                                ),
                                h('span', { className: 'badge' }, project.type)
                            ),
                            h('p', { className: 'project-card-description' },
                                project.description || 'No description available'
                            ),
                            h('div', { className: 'project-card-tvl' },
                                h('span', { className: 'text-secondary' }, 'TVL:'),
                                h('span', { className: 'text-mono' }, this.formatTVL(project.tvl))
                            )
                        )
                    )
                )
            )
        );
    }
}

export default HomePage;
