/**
 * ERC404ProjectPage Component
 * Main two-column layout with trading sidebar and tabbed content
 */

import { Component } from '../../core/Component.js';
import { ProjectHeaderCompact } from './ProjectHeaderCompact.js';
import { ERC404TradingSidebar } from './ERC404TradingSidebar.js';
import { BondingProgressSection } from './BondingProgressSection.js';
import { StakingSection } from './StakingSection.js';
import { NFTGalleryPreview } from './NFTGalleryPreview.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class ERC404ProjectPage extends Component {
    constructor(projectId, adapter, projectData) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.projectData = projectData;
        this.state = {
            activeTab: 'token',
            loading: false
        };

        // Child components
        this.header = null;
        this.sidebar = null;
        this.bondingSection = null;
        this.stakingSection = null;
        this.galleryPreview = null;
        this.commentFeed = null;
        this.adminButton = null;
    }

    onMount() {
        // Load both the page layout CSS and the main erc404 component styles
        stylesheetLoader.load('src/components/ERC404/erc404-project-page.css', 'erc404-project-page-styles');
        stylesheetLoader.load('src/components/ERC404/erc404.css', 'erc404-styles');
        this.setupEventDelegation();
        this.setTimeout(() => this.mountAllComponents(), 50);
    }

    // Prevent re-renders - handle tab switching via DOM manipulation
    shouldUpdate(oldState, newState) {
        // Only re-render for structural changes, not tab switches
        if (oldState.loading !== newState.loading) return true;

        // Handle tab switch without re-render
        if (oldState.activeTab !== newState.activeTab) {
            this.updateTabDisplay(newState.activeTab);
            return false;
        }

        return false;
    }

    updateTabDisplay(activeTab) {
        // Update tab buttons
        const tabBtns = this.element?.querySelectorAll('[data-tab]');
        tabBtns?.forEach(btn => {
            if (btn.dataset.tab === activeTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab content visibility
        const tokenContent = this.element?.querySelector('[data-tab-content="token"]');
        const nftContent = this.element?.querySelector('[data-tab-content="nft"]');

        if (tokenContent) {
            tokenContent.style.display = activeTab === 'token' ? 'block' : 'none';
        }
        if (nftContent) {
            nftContent.style.display = activeTab === 'nft' ? 'block' : 'none';
        }
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                if (tab !== this.state.activeTab) {
                    this.setState({ activeTab: tab });
                }
            }
        });
    }

    mountAllComponents() {
        // Header
        const headerContainer = this.element?.querySelector('[data-ref="header"]');
        if (headerContainer && !this.header) {
            this.header = new ProjectHeaderCompact(this.projectData);
            this.header.mount(headerContainer);
        }

        // Sidebar
        const sidebarContainer = this.element?.querySelector('[data-ref="sidebar"]');
        if (sidebarContainer && !this.sidebar) {
            this.sidebar = new ERC404TradingSidebar(this.adapter, this.projectData);
            this.sidebar.mount(sidebarContainer);
        }

        // Admin button
        const adminContainer = this.element?.querySelector('[data-ref="admin-button"]');
        if (adminContainer && !this.adminButton) {
            this.adminButton = new AdminButton(
                this.projectData.address,
                'ERC404',
                this.adapter,
                this.projectData
            );
            this.adminButton.mount(adminContainer);
        }

        // Token tab content (bonding + staking)
        const bondingContainer = this.element?.querySelector('[data-ref="bonding"]');
        if (bondingContainer && !this.bondingSection) {
            this.bondingSection = new BondingProgressSection(this.adapter, this.projectId);
            this.bondingSection.mount(bondingContainer);
        }

        const stakingContainer = this.element?.querySelector('[data-ref="staking"]');
        if (stakingContainer && !this.stakingSection) {
            this.stakingSection = new StakingSection(this.adapter);
            this.stakingSection.mount(stakingContainer);
        }

        // NFT tab content (gallery preview)
        const galleryContainer = this.element?.querySelector('[data-ref="gallery"]');
        if (galleryContainer && !this.galleryPreview) {
            this.galleryPreview = new NFTGalleryPreview(this.adapter, this.projectId);
            this.galleryPreview.mount(galleryContainer);
        }

        // Comments (always visible)
        const commentsContainer = this.element?.querySelector('[data-ref="comments"]');
        if (commentsContainer && !this.commentFeed) {
            this.commentFeed = new ProjectCommentFeed(this.projectData.address, this.adapter);
            this.commentFeed.mount(commentsContainer);
        }

        // Set initial tab visibility
        this.updateTabDisplay(this.state.activeTab);
    }

    render() {
        const { activeTab } = this.state;

        return `
            <div class="erc404-project-page">
                <div class="two-column-layout">
                    <div class="page-main">
                        <div data-ref="header"></div>
                        <div data-ref="admin-button" class="admin-button-container"></div>

                        <div class="tab-bar">
                            <button class="tab-btn ${activeTab === 'token' ? 'active' : ''}" data-tab="token">Token</button>
                            <button class="tab-btn ${activeTab === 'nft' ? 'active' : ''}" data-tab="nft">NFT</button>
                        </div>

                        <div class="tab-content">
                            <div data-tab-content="token" style="display: ${activeTab === 'token' ? 'block' : 'none'}">
                                <div data-ref="bonding"></div>
                                <div data-ref="staking"></div>
                            </div>
                            <div data-tab-content="nft" style="display: ${activeTab === 'nft' ? 'block' : 'none'}">
                                <div data-ref="gallery"></div>
                            </div>
                        </div>
                    </div>

                    <div class="page-sidebar">
                        <div data-ref="sidebar"></div>
                    </div>
                </div>

                <div class="comments-section">
                    <div data-ref="comments"></div>
                </div>
            </div>
        `;
    }

    unmount() {
        // Unmount all child components
        [this.header, this.sidebar, this.bondingSection, this.stakingSection,
         this.galleryPreview, this.commentFeed, this.adminButton].forEach(component => {
            if (component && typeof component.unmount === 'function') {
                component.unmount();
            }
        });

        stylesheetLoader.unload('erc404-project-page-styles');
        stylesheetLoader.unload('erc404-styles');
        super.unmount();
    }
}

export default ERC404ProjectPage;
