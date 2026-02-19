/**
 * HomePage - Gallery Brutalism homepage (MINIMAL TEST VERSION)
 *
 * This is a minimal test to verify:
 * 1. Microact component renders correctly
 * 2. Gallery Brutalism v2 styles apply
 * 3. Layout components work
 *
 * @example
 * h(HomePage)
 */

import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';

export class HomePage extends Component {
    constructor(props) {
        super(props);
        console.log('[HomePage] Constructor called');

        // MINIMAL TEST: Just hardcode mock data
        this.state = {
            loading: false,
            featured: {
                address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
                name: 'Art Collection Alpha',
                type: 'ERC404',
                description: 'Test featured project'
            },
            projects: [
                { address: '0x1111', name: 'Project Alpha', type: 'ERC404', description: 'Test project 1', tvl: '1200000' },
                { address: '0x2222', name: 'Project Beta', type: 'ERC1155', description: 'Test project 2', tvl: '800000' },
                { address: '0x3333', name: 'Project Gamma', type: 'ERC404', description: 'Test project 3', tvl: '650000' },
                { address: '0x4444', name: 'Project Delta', type: 'ERC721', description: 'Test project 4', tvl: '450000' }
            ],
            vaults: [
                { address: '0xaaaa', name: 'Alpha Vault', tvl: '1200000' },
                { address: '0xbbbb', name: 'Beta Vault', tvl: '800000' },
                { address: '0xcccc', name: 'Gamma Vault', tvl: '650000' }
            ],
            activity: [
                { text: 'User minted NFT #42 in Project Alpha' },
                { text: 'Creator launched Music Collection' },
                { text: 'Collector bought Edition #7' },
                { text: 'Artist updated Generative Series' }
            ]
        };
    }

    didMount() {
        console.log('[HomePage] didMount called - component mounted successfully!');
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
        console.log('[HomePage] render called');
        const { featured, projects, vaults, activity } = this.state;

        return h(Layout, { currentPath: '/' },
            h('div', { className: 'home-page' },
                h('div', { className: 'home-content' },
                    // Test message
                    h('div', { style: 'padding: 20px; background: yellow; color: black; margin: 20px 0;' },
                        h('h1', null, '✅ MINIMAL TEST: HomePage Component Rendering!'),
                        h('p', null, 'If you see this, Microact is working.')
                    ),

                    // Featured Banner
                    h('div', { className: 'featured-banner', onclick: this.handleFeaturedClick },
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
                    ),

                    // Stats Bar
                    h('div', { className: 'stats-bar' },
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
                    ),

                    // Activity Section
                    h('div', { className: 'activity-section' },
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
                    ),

                    // Projects Grid
                    h('div', { className: 'projects-section' },
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
                        )
                    )
                )
            )
        );
    }
}

export default HomePage;
