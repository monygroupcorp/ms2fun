/**
 * ERC404ProjectPage - Microact Version
 *
 * Two-column layout with trading sidebar and tabbed content (Token/NFT).
 * Matches docs/examples/project-erc404-demo.html
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import { ProjectHeaderCompact } from './ProjectHeaderCompact.microact.js';
import { ERC404TradingSidebar } from './ERC404TradingSidebar.microact.js';
import { BondingProgressSection } from './BondingProgressSection.microact.js';
import { StakingSection } from './StakingSection.microact.js';
import { NFTGalleryPreview } from './NFTGalleryPreview.microact.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.microact.js';
import { ERC404PortfolioModal } from './ERC404PortfolioModal.microact.js';
import { ShareModal } from '../ShareModal/ShareModal.microact.js';
import { ERC404AdminControls } from './ERC404AdminControls.microact.js';
import { ERC404AdminModal } from './ERC404AdminModal.microact.js';
import walletService from '../../services/WalletService.js';

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

        // Check admin ownership
        this.checkOwnership();

        // Re-check on wallet events
        const unsub1 = eventBus.on('wallet:connected', () => this.checkOwnership());
        const unsub2 = eventBus.on('wallet:disconnected', () => this.hideAdmin());
        const unsub3 = eventBus.on('wallet:changed', () => this.checkOwnership());
        const unsub4 = eventBus.on('erc404:admin:disabled', () => this.hideAdmin());
        this.registerCleanup(() => { unsub1(); unsub2(); unsub3(); unsub4(); });
    }

    async checkOwnership() {
        if (!this.adapter) return;

        try {
            const userAddress = walletService.getAddress();
            if (!userAddress) {
                this.hideAdmin();
                return;
            }

            const isOwner = await this.adapter.checkOwnership(userAddress);
            if (isOwner) {
                this.showAdmin();
            } else {
                this.hideAdmin();
            }
        } catch (error) {
            console.warn('[ERC404ProjectPage] Failed to check ownership:', error);
            this.hideAdmin();
        }
    }

    showAdmin() {
        if (!this._el) return;
        const notice = this._el.querySelector('.admin-notice');
        const controls = this._el.querySelector('.admin-controls');
        if (notice) notice.style.display = '';
        if (controls) controls.style.display = '';

        // Inject admin settings button into project actions
        const actions = this._el.querySelector('.project-actions');
        if (actions && !actions.querySelector('.admin-settings-btn')) {
            const btn = document.createElement('button');
            btn.className = 'action-btn admin-settings-btn';
            btn.textContent = 'Admin Settings';
            btn.addEventListener('click', () => eventBus.emit('erc404:admin:open'));
            actions.appendChild(btn);
        }

        eventBus.emit('erc404:admin:enabled');
    }

    hideAdmin() {
        if (!this._el) return;
        const notice = this._el.querySelector('.admin-notice');
        const controls = this._el.querySelector('.admin-controls');
        if (notice) notice.style.display = 'none';
        if (controls) controls.style.display = 'none';

        // Remove admin settings button
        const adminBtn = this._el.querySelector('.admin-settings-btn');
        if (adminBtn) adminBtn.remove();
    }

    toggleAdminControls() {
        if (!this._el) return;
        const page = this._el;
        const isHidden = page.classList.toggle('admin-hidden');
        const toggleText = this._el.querySelector('[data-admin-toggle-text]');
        if (toggleText) {
            toggleText.textContent = isHidden ? 'Show Admin Controls' : 'Hide Admin Controls';
        }
    }

    handleTabClick(tab) {
        if (tab !== this.state.activeTab) {
            this.setState({ activeTab: tab });
        }
    }

    shouldUpdate(oldProps, newProps, oldState, newState) {
        if (oldState.loading !== newState.loading) return true;

        // Handle tab switch via DOM manipulation to preserve child components
        if (oldState.activeTab !== newState.activeTab) {
            this.updateTabDisplay(newState.activeTab);
            return false;
        }

        return false;
    }

    updateTabDisplay(activeTab) {
        if (!this._el) return;

        const tabBtns = this._el.querySelectorAll('[data-tab]');
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeTab);
        });

        const tokenContent = this._el.querySelector('[data-tab-content="token"]');
        const nftContent = this._el.querySelector('[data-tab-content="nft"]');

        if (tokenContent) tokenContent.style.display = activeTab === 'token' ? 'block' : 'none';
        if (nftContent) nftContent.style.display = activeTab === 'nft' ? 'block' : 'none';
    }

    render() {
        const { activeTab } = this.state;
        const projectData = this.projectData;
        const projectAddress = projectData.contractAddress || projectData.address || this.projectId;

        return h('div', { className: 'erc404-project-page' },
            // Admin notice bar (hidden until ownership confirmed)
            h('div', { className: 'admin-notice', style: { display: 'none' } },
                h('div', { className: 'admin-notice-text' },
                    'You are viewing this as the project creator \u2014 Admin controls enabled'
                ),
                h('a', {
                    className: 'admin-notice-toggle',
                    'data-admin-toggle-text': true,
                    onClick: () => this.toggleAdminControls()
                }, 'Hide Admin Controls')
            ),

            // Project header — outside the grid so it's always first on mobile
            h(ProjectHeaderCompact, {
                projectData: projectData
            }),

            // Admin controls (hidden until ownership confirmed)
            h(ERC404AdminControls, {
                adapter: this.adapter
            }),

            h('div', { className: 'project-layout' },
                // Main content column
                h('div', { className: 'main-content' },
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
            ),

            // Portfolio modal (hidden until opened via event)
            h(ERC404PortfolioModal, {
                adapter: this.adapter,
                projectData: projectData
            }),

            // Share modal (hidden until opened via event)
            h(ShareModal, {
                projectData: projectData
            }),

            // Admin modal (hidden until opened via event)
            h(ERC404AdminModal, {
                adapter: this.adapter
            })
        );
    }
}

export default ERC404ProjectPage;
