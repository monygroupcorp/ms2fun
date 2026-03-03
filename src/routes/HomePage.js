/**
 * HomePage - Gallery Brutalism homepage with environment detection
 *
 * Uses EnvironmentDetector to determine mode:
 * - LOCAL_BLOCKCHAIN: Real data from local Anvil
 * - PLACEHOLDER_MOCK: Hardcoded placeholder data
 * - PRODUCTION_DEPLOYED: Real data from deployed contracts
 * - COMING_SOON: Minimal content for pre-launch
 *
 * @example
 * h(HomePage)
 */

import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';
import { DataAdapter } from '../services/DataAdapter.js';
import { ProjectCardSkeleton, ActivityItemSkeleton, FeaturedBannerSkeleton } from '../components/Skeletons/Skeletons.js';
import { debug } from '../utils/debug.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

export class HomePage extends Component {
    constructor(props) {
        super(props);

        this.state = {
            // Progressive loading states
            loading: true,
            loadingFeatured: true,
            loadingProjects: true,
            loadingActivity: true,

            error: null,
            featured: null,
            projects: [],
            vaults: [],
            activity: [],
            message: null,
            contracts: null
        };
    }

    async didMount() {
        // Load route-specific CSS with layer ID
        await stylesheetLoader.load('/src/core/route-home-v2.css', 'route:home');

        // Web3 context provided by route handler as props
        const { mode, config, provider } = this.props;
        debug.log('[HomePage] Loading data with mode:', mode);
        this.loadData(mode, config, provider);
    }

    async loadData(mode, config, provider) {
        try {
            // Create adapter with provider
            const adapter = new DataAdapter(mode, config, provider);

            // Load featured + projects first (critical path)
            const t0 = performance.now();
            const criticalData = await adapter.getCriticalData();
            const t1 = performance.now();
            console.log(`[HomePage] ✓ Critical data loaded (${(t1 - t0).toFixed(0)}ms): featured="${criticalData.featured?.name}", projects=${criticalData.projects.length}, vaults=${criticalData.vaults.length}`);

            this.setState({
                loading: false,
                loadingFeatured: false,
                loadingProjects: false,
                featured: criticalData.featured,
                projects: criticalData.projects,
                vaults: criticalData.vaults,
                contracts: criticalData.contracts
            });

            // Load activity lazily in background
            this.loadActivityAsync(adapter);

        } catch (error) {
            debug.error('[HomePage] Data loading failed:', error);
            this.setState({
                loading: false,
                loadingFeatured: false,
                loadingProjects: false,
                loadingActivity: false,
                error: error.message
            });
        }
    }

    async loadActivityAsync(adapter) {
        try {
            const t0 = performance.now();
            const allActivity = await adapter.getActivity(0); // Get all activity

            // Filter to only show on-chain actions (trades, mints) - no messages or reactions
            const actions = allActivity
                .filter(item => item.type !== 'message') // Exclude all messages
                .slice(0, 4); // Top 4 actions for homepage preview

            const t1 = performance.now();
            console.log(`[HomePage] ✓ Activity indexed (${(t1 - t0).toFixed(0)}ms): ${actions.length} items`);

            this.setState({
                activity: actions,
                loadingActivity: false
            });
        } catch (error) {
            debug.error('[HomePage] Activity loading failed:', error);
            this.setState({ loadingActivity: false });
        }
    }

    formatProjectNameForUrl(projectName) {
        // Convert project name to URL-safe format
        // "Early-Launch" -> "early-launch"
        // "Demo Gallery" -> "demo-gallery"
        return projectName.toLowerCase().replace(/\s+/g, '-');
    }

    handleProjectClick = (project) => (e) => {
        e.preventDefault();
        const projectSlug = this.formatProjectNameForUrl(project.name);
        const path = `/${projectSlug}`;
        window.router.navigate(path);
    }

    handleFeaturedClick = () => {
        const { featured } = this.state;
        if (!featured) return;

        // CULT EXECS always navigates to /cultexecs
        if (featured.name === 'CULT EXECUTIVES' || featured.name === 'CULT EXEC') {
            window.router.navigate('/cultexecs');
            return;
        }

        // Other projects navigate to their name slug
        const projectSlug = this.formatProjectNameForUrl(featured.name);
        const path = `/${projectSlug}`;
        window.router.navigate(path);
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
        const {
            loading, loadingFeatured, loadingProjects, loadingActivity,
            error, featured, projects, vaults, activity
        } = this.state;

        // Get mode from props (provided by Layout)
        const { mode } = this.props;

        // Error state
        if (error) {
            return h(Layout, {
                currentPath: '/',
                mode,
                children: h('div', { className: 'home-page' },
                    h('div', { className: 'home-content' },
                        h('div', { className: 'error-state', style: 'text-align: center; padding: var(--space-10);' },
                            h('h2', {}, 'Error Loading Data'),
                            h('p', { className: 'text-secondary' }, error)
                        )
                    )
                )
            });
        }

        // Coming Soon state
        if (mode === 'COMING_SOON') {
            return h(Layout, {
                currentPath: '/',
                mode,
                children: h('div', { className: 'home-page' },
                    h('div', { className: 'home-content' },
                        // Featured Banner - CULT EXECS is always shown
                        h('div', { className: 'featured-banner', onclick: () => window.router.navigate('/cultexecs') },
                            h('div', { className: 'featured-banner-image' },
                                h('img', {
                                    src: '/execs/695.jpeg',
                                    alt: 'CULT EXECUTIVES #695',
                                    className: 'featured-banner-img'
                                })
                            ),
                            h('div', { className: 'featured-banner-content' },
                                h('div', { className: 'featured-banner-label' }, 'FEATURED'),
                                h('h2', { className: 'featured-banner-title' }, 'CULT EXECUTIVES'),
                                h('div', { className: 'featured-banner-meta' },
                                    h('span', { className: 'badge' }, 'ERC404')
                                )
                            )
                        ),

                        // Coming Soon message
                        h('div', { className: 'coming-soon-state', style: 'text-align: center; padding: var(--space-10);' },
                            h('p', { className: 'text-secondary', style: 'font-size: var(--font-size-h3);' }, 'More Projects Coming Soon'),
                            h('p', { className: 'text-secondary', style: 'margin-top: var(--space-4);' },
                                'The next generation of creative projects is launching soon.'
                            ),
                            h('p', { className: 'text-secondary', style: 'margin-top: var(--space-6);' },
                                'Prepare your collection on ',
                                h('a', {
                                    href: 'https://noema.art',
                                    target: '_blank',
                                    rel: 'noopener noreferrer',
                                    className: 'text-link'
                                }, 'noema.art'),
                                ' and be ready to launch on day one.'
                            )
                        )
                    )
                )
            });
        }

        // Normal state (with data)
        return h(Layout, {
            currentPath: '/',
            children: h('div', { className: 'home-page' },
                h('div', { className: 'home-content' },
                    // Featured Banner (show skeleton while loading, then real data)
                    loadingFeatured
                        ? FeaturedBannerSkeleton()
                        : featured ? h('div', { className: 'featured-banner', onclick: this.handleFeaturedClick },
                        h('div', { className: 'featured-banner-image' },
                            // CULT EXECS gets special image treatment - show piece from collection
                            (featured.name === 'CULT EXECUTIVES' || featured.name === 'CULT EXEC')
                                ? h('img', {
                                    src: '/execs/695.jpeg',
                                    alt: 'CULT EXECUTIVES #695',
                                    className: 'featured-banner-img'
                                })
                                : featured.name.charAt(0).toUpperCase()
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
                    ) : null,

                    // Stats Bar (only show if we have vaults)
                    vaults.length > 0 ? h('div', { className: 'stats-bar' },
                        h('span', { className: 'stats-bar-label' }, 'TOP VAULTS:'),
                        ...vaults.flatMap((vault, index) => {
                            const items = [
                                h('span', { key: `vault-${index}`, className: 'stats-bar-item' },
                                    vault.name + ' ',
                                    h('span', { className: 'text-mono' }, this.formatTVL(vault.tvl))
                                )
                            ];
                            if (index < vaults.length - 1) {
                                items.push(h('span', { key: `sep-${index}`, className: 'stats-bar-separator' }, '|'));
                            }
                            return items;
                        })
                    ) : null,

                    // Activity Section (show skeleton while loading)
                    loadingActivity
                        ? h('div', { className: 'activity-section' },
                            h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
                            h('div', { className: 'activity-list' },
                                ActivityItemSkeleton(),
                                ActivityItemSkeleton(),
                                ActivityItemSkeleton(),
                                ActivityItemSkeleton()
                            )
                        )
                        : activity.length > 0 ? h('div', { className: 'activity-section' },
                        h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
                        h('div', { className: 'activity-list' },
                            ...activity.map((item, index) =>
                                h('div', { key: index, className: 'activity-item' },
                                    h('span', { className: 'activity-bullet' }, '•'),
                                    h('span', { className: 'activity-text' }, item.text)
                                )
                            )
                        ),
                        h('button', { className: 'btn btn-ghost', onclick: this.handleViewAllActivity },
                            'View All Activity →'
                        )
                    ) : null,

                    // Projects Grid (show skeletons while loading)
                    loadingProjects
                        ? h('div', { className: 'projects-section' },
                            h('h3', { className: 'projects-title' }, 'PROJECTS'),
                            h('div', { className: 'projects-grid' },
                                ProjectCardSkeleton(),
                                ProjectCardSkeleton(),
                                ProjectCardSkeleton(),
                                ProjectCardSkeleton(),
                                ProjectCardSkeleton(),
                                ProjectCardSkeleton()
                            )
                        )
                        : projects.length > 0 ? h('div', { className: 'projects-section' },
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
                                            project.description || 'No description'
                                        ),
                                        h('div', { className: 'project-card-tvl' },
                                            h('span', { className: 'text-secondary' }, 'TVL:'),
                                            h('span', { className: 'text-mono' }, this.formatTVL(project.tvl))
                                        )
                                    )
                                )
                            )
                        ),
                        h('button', {
                            className: 'btn btn-secondary',
                            style: 'width: 100%;',
                            onclick: (e) => {
                                e.preventDefault();
                                window.router.navigate('/discover');
                            }
                        }, 'View All Projects →')
                    ) : null
                )
            )
        });
    }
}

export default HomePage;
