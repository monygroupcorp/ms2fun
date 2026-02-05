/**
 * ERC404ProjectPage - Microact Version
 *
 * Main two-column layout with trading sidebar and tabbed content for ERC404 projects.
 */

import { Component, h } from '../../core/microact-setup.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

// Note: Child components would be imported as microact versions when they exist
// For now, this is a stub that renders the structure

export class ERC404ProjectPage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            activeTab: 'token',
            loading: false
        };
    }

    get projectId() {
        return this.props.projectId;
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectData() {
        return this.props.projectData || {};
    }

    async didMount() {
        stylesheetLoader.load('src/components/ERC404/erc404-project-page.css', 'erc404-project-page-styles');
        stylesheetLoader.load('src/components/ERC404/erc404.css', 'erc404-styles');

        this.registerCleanup(() => {
            stylesheetLoader.unload('erc404-project-page-styles');
            stylesheetLoader.unload('erc404-styles');
        });
    }

    handleTabClick(tab) {
        if (tab !== this.state.activeTab) {
            this.setState({ activeTab: tab });
        }
    }

    shouldUpdate(oldState, newState) {
        // Only re-render for structural changes
        if (oldState.loading !== newState.loading) return true;

        // Handle tab switch via DOM manipulation for perf
        if (oldState.activeTab !== newState.activeTab) {
            this.updateTabDisplay(newState.activeTab);
            return false;
        }

        return false;
    }

    updateTabDisplay(activeTab) {
        if (!this._element) return;

        // Update tab buttons
        const tabBtns = this._element.querySelectorAll('[data-tab]');
        tabBtns.forEach(btn => {
            if (btn.dataset.tab === activeTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab content visibility
        const tokenContent = this._element.querySelector('[data-tab-content="token"]');
        const nftContent = this._element.querySelector('[data-tab-content="nft"]');

        if (tokenContent) {
            tokenContent.style.display = activeTab === 'token' ? 'block' : 'none';
        }
        if (nftContent) {
            nftContent.style.display = activeTab === 'nft' ? 'block' : 'none';
        }
    }

    render() {
        const { activeTab } = this.state;
        const projectData = this.projectData;

        return h('div', { className: 'erc404-project-page' },
            h('div', { className: 'two-column-layout' },
                h('div', { className: 'page-main' },
                    // Header placeholder - would mount ProjectHeaderCompact
                    h('div', { className: 'project-header-compact' },
                        h('h1', { className: 'project-title' }, projectData.name || 'Project'),
                        h('p', { className: 'project-symbol' }, `$${projectData.symbol || 'TOKEN'}`)
                    ),

                    // Admin button placeholder
                    h('div', { className: 'admin-button-container' }),

                    // Tab bar
                    h('div', { className: 'tab-bar' },
                        h('button', {
                            className: `tab-btn ${activeTab === 'token' ? 'active' : ''}`,
                            'data-tab': 'token',
                            onClick: () => this.handleTabClick('token')
                        }, 'Token'),
                        h('button', {
                            className: `tab-btn ${activeTab === 'nft' ? 'active' : ''}`,
                            'data-tab': 'nft',
                            onClick: () => this.handleTabClick('nft')
                        }, 'NFT')
                    ),

                    // Tab content
                    h('div', { className: 'tab-content' },
                        h('div', {
                            'data-tab-content': 'token',
                            style: { display: activeTab === 'token' ? 'block' : 'none' }
                        },
                            // Bonding progress section placeholder
                            h('div', { className: 'bonding-section-placeholder' },
                                h('p', null, 'Bonding Progress Section')
                            ),
                            // Staking section placeholder
                            h('div', { className: 'staking-section-placeholder' },
                                h('p', null, 'Staking Section')
                            )
                        ),
                        h('div', {
                            'data-tab-content': 'nft',
                            style: { display: activeTab === 'nft' ? 'block' : 'none' }
                        },
                            // NFT gallery placeholder
                            h('div', { className: 'gallery-preview-placeholder' },
                                h('p', null, 'NFT Gallery Preview')
                            )
                        )
                    )
                ),

                // Sidebar
                h('div', { className: 'page-sidebar' },
                    // Trading sidebar placeholder - would mount ERC404TradingSidebar
                    h('div', { className: 'trading-sidebar-placeholder' },
                        h('p', null, 'Trading Sidebar')
                    )
                )
            ),

            // Comments section
            h('div', { className: 'comments-section' },
                // Comments placeholder - would mount ProjectCommentFeed
                h('div', { className: 'comments-placeholder' },
                    h('p', null, 'Project Comments')
                )
            )
        );
    }
}

export default ERC404ProjectPage;
