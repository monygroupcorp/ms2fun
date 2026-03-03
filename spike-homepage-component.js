/**
 * SPIKE: Homepage Component Translation
 *
 * Demonstrates converting homepage-v2-demo.html to Microact component using h()
 *
 * This is a simplified version to validate the pattern before building the full component.
 */

import { h, Component } from '@monygroupcorp/microact';

class HomePage extends Component {
    constructor(props) {
        super(props);
        this.state = {
            mobileMenuOpen: false,
            projects: [
                {
                    id: '1',
                    letter: 'A',
                    title: 'Project Alpha',
                    address: '0x742d...',
                    type: 'ERC404',
                    description: 'Bonding curve token with dual NFT representation. Price discovery through algorithmic curves.',
                    tvl: '$1.2M'
                },
                {
                    id: '2',
                    letter: 'B',
                    title: 'Project Beta',
                    address: '0x8b5c...',
                    type: 'ERC1155',
                    description: 'Open edition gallery featuring minimalist geometric compositions and digital abstractions.',
                    tvl: '$800K'
                },
                // ... more projects would go here
            ],
            featuredProject: {
                letter: 'F',
                title: 'Art Collection Alpha',
                address: '0x742d35Cc...',
                type: 'ERC404'
            },
            recentActivity: [
                'User minted NFT #42 in Project Alpha',
                'Creator launched Music Collection',
                'Collector bought Edition #7',
                'Artist updated Generative Series'
            ]
        };
    }

    toggleMobileMenu = () => {
        this.setState({ mobileMenuOpen: !this.state.mobileMenuOpen });
    }

    renderTopBar() {
        return h('div', { className: 'home-top-bar' },
            // Logo
            h('a', { href: '#/', className: 'home-logo' },
                'MS2',
                h('span', { className: 'logo-tld' }, '.fun')
            ),

            // Mobile menu toggle
            h('button', {
                className: 'mobile-menu-toggle',
                'aria-label': 'Menu',
                'aria-expanded': this.state.mobileMenuOpen,
                onClick: this.toggleMobileMenu
            },
                h('span', { className: 'hamburger-bar' })
            ),

            // Desktop nav links
            h('div', {
                className: 'nav-links',
                style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }
            },
                h('a', { href: '#/create', className: 'btn btn-primary' }, 'Create')
            ),

            // Mobile nav panel
            h('div', {
                className: `mobile-nav-panel ${this.state.mobileMenuOpen ? 'is-open' : ''}`,
                id: 'mobile-nav'
            },
                h('a', { href: '#/discover', className: 'mobile-nav-link' }, 'Discover'),
                h('a', { href: '#/portfolio', className: 'mobile-nav-link' }, 'Portfolio'),
                h('a', { href: '#/governance', className: 'mobile-nav-link' }, 'Governance'),
                h('a', { href: '#/docs', className: 'mobile-nav-link' }, 'Docs'),
                h('a', { href: '#/create', className: 'mobile-nav-link mobile-nav-link-primary' }, 'Create')
            )
        );
    }

    renderFeaturedBanner() {
        const { featuredProject } = this.state;

        return h('div', { className: 'featured-banner' },
            h('div', { className: 'featured-banner-image' }, featuredProject.letter),
            h('div', { className: 'featured-banner-content' },
                h('div', { className: 'featured-banner-label' }, 'FEATURED'),
                h('h2', { className: 'featured-banner-title' }, featuredProject.title),
                h('div', { className: 'featured-banner-meta' },
                    h('span', { className: 'text-mono text-secondary' }, featuredProject.address),
                    h('span', { className: 'badge' }, featuredProject.type)
                )
            )
        );
    }

    renderStatsBar() {
        return h('div', { className: 'stats-bar' },
            h('span', { className: 'stats-bar-label' }, 'TOP VAULTS:'),
            h('span', { className: 'stats-bar-item' },
                'Alpha Vault ',
                h('span', { className: 'text-mono' }, '$1.2M')
            ),
            h('span', { className: 'stats-bar-separator' }, '|'),
            h('span', { className: 'stats-bar-item' },
                'Beta Vault ',
                h('span', { className: 'text-mono' }, '$800K')
            ),
            h('span', { className: 'stats-bar-separator' }, '|'),
            h('span', { className: 'stats-bar-item' },
                'Gamma Vault ',
                h('span', { className: 'text-mono' }, '$650K')
            )
        );
    }

    renderActivitySection() {
        return h('div', { className: 'activity-section' },
            h('h3', { className: 'activity-title' }, 'RECENT ACTIVITY'),
            h('div', { className: 'activity-list' },
                this.state.recentActivity.map((activity, index) =>
                    h('div', { key: index, className: 'activity-item' },
                        h('span', { className: 'activity-bullet' }, '•'),
                        h('span', { className: 'activity-text' }, activity)
                    )
                )
            ),
            h('button', { className: 'btn btn-ghost' }, 'View All Activity →')
        );
    }

    renderProjectCard(project) {
        return h('div', { key: project.id, className: 'project-card' },
            h('div', { className: 'project-card-image' }, project.letter),
            h('div', { className: 'project-card-content' },
                h('h4', { className: 'project-card-title' }, project.title),
                h('div', { className: 'project-card-meta' },
                    h('span', { className: 'text-mono text-secondary' }, project.address),
                    h('span', { className: 'badge' }, project.type)
                ),
                h('p', { className: 'project-card-description' }, project.description),
                h('div', { className: 'project-card-tvl' },
                    h('span', { className: 'text-secondary' }, 'TVL:'),
                    h('span', { className: 'text-mono' }, project.tvl)
                )
            )
        );
    }

    renderProjectsSection() {
        return h('div', { className: 'projects-section' },
            h('h3', { className: 'projects-title' }, 'PROJECTS'),
            h('div', { className: 'projects-grid' },
                this.state.projects.map(project => this.renderProjectCard(project))
            ),
            h('button', {
                className: 'btn btn-secondary',
                style: { width: '100%' }
            }, 'View All Projects →')
        );
    }

    renderFooter() {
        return h('footer', { className: 'site-footer' },
            h('a', { href: '#/docs', className: 'site-footer-icon', 'aria-label': 'Docs' },
                // SVG would be inlined here - simplified for spike
                '📖'
            ),
            h('a', { href: 'https://github.com', className: 'site-footer-icon', 'aria-label': 'GitHub' },
                '⚙️'
            ),
            h('a', { href: 'https://x.com', className: 'site-footer-icon', 'aria-label': 'X' },
                '𝕏'
            )
        );
    }

    render() {
        return h('div', { className: 'home-page' },
            this.renderTopBar(),

            h('div', { className: 'home-content' },
                this.renderFeaturedBanner(),
                this.renderStatsBar(),
                this.renderActivitySection(),
                this.renderProjectsSection()
            ),

            // Floating wallet button
            h('button', {
                className: 'wallet-button',
                title: 'Connect Wallet'
            }, 'W'),

            this.renderFooter()
        );
    }
}

export default HomePage;

/**
 * OBSERVATIONS FROM TRANSLATION:
 *
 * 1. HTML → h() is straightforward but verbose
 *    - Each div becomes h('div', props, ...children)
 *    - Nesting gets deep quickly
 *
 * 2. Helper methods (renderTopBar, renderProjectCard) improve readability
 *    - Breaking render() into sections makes it manageable
 *    - Similar to React component patterns
 *
 * 3. Arrays map cleanly to .map()
 *    - Projects list, activity items work well
 *    - Need to add `key` prop for lists
 *
 * 4. Event handlers are simple
 *    - onClick, onChange work like React
 *    - Can use arrow functions or this.bind()
 *
 * 5. State management is clear
 *    - this.state for data
 *    - this.setState for updates
 *
 * 6. Missing from micro-web3:
 *    - No Badge component (using <span class="badge">)
 *    - No Card component (using <div class="project-card">)
 *    - No ActivityFeed component
 *    - No Stats/MetricsBar component
 *
 * 7. SVG icons are awkward
 *    - Inlining SVG in h() calls is verbose
 *    - Need an Icon component or SVG sprite system
 *
 * 8. CSS stays in separate file
 *    - The inline styles from demo should move to src/core/home-v2.css
 *    - Keep class-based styling approach
 *
 * 9. Mobile menu state works well
 *    - toggleMobileMenu updates state
 *    - Class toggling via template string
 *
 * NEXT STEPS:
 * - Test this component in actual app
 * - Identify library gaps (Badge, Card, Icon components)
 * - Move styles to proper CSS file
 * - Add real data fetching (contracts, wallet)
 */
