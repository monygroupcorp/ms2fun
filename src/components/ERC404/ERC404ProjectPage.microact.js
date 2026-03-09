/**
 * ERC404ProjectPage - Microact Version
 *
 * Two-column layout with trading sidebar and tabbed content (Token/NFT).
 * Matches docs/examples/project-erc404-demo.html
 */

import { Component, h } from '../../core/microact-setup.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import { ProjectHeaderCompact } from './ProjectHeaderCompact.microact.js';
import { ERC404TradingSidebar } from './ERC404TradingSidebar.microact.js';
import { BondingProgressSection } from './BondingProgressSection.microact.js';
import { StakingSection } from './StakingSection.microact.js';
import { NFTGalleryPreview } from './NFTGalleryPreview.microact.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.microact.js';

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
        return this.props.project || this.props.projectData || {};
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
        if (oldState.loading !== newState.loading) return true;

        // Handle tab switch via DOM manipulation to preserve child components
        if (oldState.activeTab !== newState.activeTab) {
            this.updateTabDisplay(newState.activeTab);
            return false;
        }

        return false;
    }

    updateTabDisplay(activeTab) {
        if (!this._element) return;

        const tabBtns = this._element.querySelectorAll('[data-tab]');
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeTab);
        });

        const tokenContent = this._element.querySelector('[data-tab-content="token"]');
        const nftContent = this._element.querySelector('[data-tab-content="nft"]');

        if (tokenContent) tokenContent.style.display = activeTab === 'token' ? 'block' : 'none';
        if (nftContent) nftContent.style.display = activeTab === 'nft' ? 'block' : 'none';
    }

    render() {
        const { activeTab } = this.state;
        const projectData = this.projectData;
        const projectAddress = projectData.contractAddress || projectData.address || this.projectId;

        return h('div', { className: 'erc404-project-page' },
            h('div', { className: 'project-layout' },
                // Main content column
                h('div', { className: 'main-content' },
                    // Project header
                    h(ProjectHeaderCompact, {
                        projectData: projectData
                    }),

                    // Tabs
                    h('div', { className: 'tabs' },
                        h('button', {
                            className: `tab ${activeTab === 'token' ? 'active' : ''}`,
                            'data-tab': 'token',
                            onClick: () => this.handleTabClick('token')
                        }, 'Token'),
                        h('button', {
                            className: `tab ${activeTab === 'nft' ? 'active' : ''}`,
                            'data-tab': 'nft',
                            onClick: () => this.handleTabClick('nft')
                        }, 'NFT')
                    ),

                    // Token tab content
                    h('div', {
                        'data-tab-content': 'token',
                        style: { display: activeTab === 'token' ? 'block' : 'none' }
                    },
                        h(BondingProgressSection, {
                            adapter: this.adapter
                        }),
                        h(StakingSection, {
                            adapter: this.adapter
                        })
                    ),

                    // NFT tab content
                    h('div', {
                        'data-tab-content': 'nft',
                        style: { display: activeTab === 'nft' ? 'block' : 'none' }
                    },
                        h(NFTGalleryPreview, {
                            adapter: this.adapter,
                            projectId: this.projectId
                        })
                    )
                ),

                // Sidebar
                h('div', { className: 'sidebar' },
                    h(ERC404TradingSidebar, {
                        adapter: this.adapter,
                        projectData: projectData
                    })
                )
            ),

            // Comments section below the two-column layout
            h('div', { className: 'comments-section' },
                h('div', { className: 'section-title' }, 'Comments'),
                h(ProjectCommentFeed, {
                    projectAddress: projectAddress,
                    adapter: this.adapter
                })
            )
        );
    }
}

export default ERC404ProjectPage;
