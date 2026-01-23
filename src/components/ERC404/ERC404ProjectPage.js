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
        stylesheetLoader.load('src/components/ERC404/erc404-project-page.css', 'erc404-project-page-styles');
        this.setupEventDelegation();
        this.setTimeout(() => this.mountChildComponents(), 50);
    }

    setupEventDelegation() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                if (tab !== this.state.activeTab) {
                    this.setState({ activeTab: tab });
                    this.setTimeout(() => this.mountTabContent(), 50);
                }
            }
        });
    }

    mountChildComponents() {
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

        // Tab content
        this.mountTabContent();

        // Comments (always present)
        const commentsContainer = this.element?.querySelector('[data-ref="comments"]');
        if (commentsContainer && !this.commentFeed) {
            this.commentFeed = new ProjectCommentFeed(this.projectData.address, this.adapter);
            this.commentFeed.mount(commentsContainer);
        }
    }

    mountTabContent() {
        const { activeTab } = this.state;

        // Unmount inactive tab components
        if (activeTab !== 'token') {
            if (this.bondingSection) {
                this.bondingSection.unmount();
                this.bondingSection = null;
            }
            if (this.stakingSection) {
                this.stakingSection.unmount();
                this.stakingSection = null;
            }
        }
        if (activeTab !== 'nft') {
            if (this.galleryPreview) {
                this.galleryPreview.unmount();
                this.galleryPreview = null;
            }
        }

        // Mount active tab components
        if (activeTab === 'token') {
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
        } else if (activeTab === 'nft') {
            const galleryContainer = this.element?.querySelector('[data-ref="gallery"]');
            if (galleryContainer && !this.galleryPreview) {
                this.galleryPreview = new NFTGalleryPreview(this.adapter, this.projectId);
                this.galleryPreview.mount(galleryContainer);
            }
        }
    }

    render() {
        const { activeTab } = this.state;

        return `
            <div class="erc404-project-page">
                <div class="page-main">
                    <div data-ref="header"></div>
                    <div data-ref="admin-button" class="admin-button-container"></div>

                    <div class="tab-bar">
                        <button class="tab-btn ${activeTab === 'token' ? 'active' : ''}" data-tab="token">Token</button>
                        <button class="tab-btn ${activeTab === 'nft' ? 'active' : ''}" data-tab="nft">NFT</button>
                    </div>

                    <div class="tab-content">
                        ${activeTab === 'token' ? `
                            <div data-ref="bonding"></div>
                            <div data-ref="staking"></div>
                        ` : `
                            <div data-ref="gallery"></div>
                        `}
                    </div>

                    <div class="comments-section">
                        <div data-ref="comments"></div>
                    </div>
                </div>

                <div class="page-sidebar">
                    <div data-ref="sidebar"></div>
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
        super.unmount();
    }
}

export default ERC404ProjectPage;
