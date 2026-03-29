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
import MessagePopup from '../MessagePopup/MessagePopup.js';
import serviceFactory from '../../services/ServiceFactory.js';

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

        // Nudge wallet to correct chain
        this.checkChain();

        // Re-check on wallet events
        const unsub1 = eventBus.on('wallet:connected', () => { this.checkOwnership(); this.checkChain(); });
        const unsub2 = eventBus.on('wallet:disconnected', () => this.hideAdmin());
        const unsub3 = eventBus.on('wallet:changed', () => { this.checkOwnership(); this.checkChain(); });
        const unsub4 = eventBus.on('erc404:admin:disabled', () => this.hideAdmin());
        this.registerCleanup(() => { unsub1(); unsub2(); unsub3(); unsub4(); });

        try {
            this._masterAdapter = await serviceFactory.getMasterRegistryAdapter();
        } catch (e) {
            console.warn('[ERC404ProjectPage] Could not load master adapter:', e);
        }
    }

    async checkChain() {
        if (!walletService.isConnected()) return;

        // Extract chainId from URL (e.g. /11155111/test-project)
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const urlChainId = pathParts.length > 0 ? parseInt(pathParts[0]) : null;
        if (!urlChainId || isNaN(urlChainId)) return;

        try {
            const { provider } = walletService.getProviderAndSigner();
            if (!provider) return;
            const network = await provider.getNetwork();
            if (network.chainId === urlChainId) return;

            // Mismatch — show nudge
            const popup = new MessagePopup();
            const chainNames = { 1: 'Mainnet', 11155111: 'Sepolia', 1337: 'Anvil Local', 31337: 'Anvil Local' };
            const targetName = chainNames[urlChainId] || `Chain ${urlChainId}`;
            const el = popup.show({
                title: 'Wrong Network',
                message: `This project is on ${targetName}. Switch your wallet to continue.`,
                type: 'warning',
                duration: 0
            });

            // Add switch button inside the popup
            const textEl = el.querySelector('.message-text');
            if (textEl) {
                const btn = document.createElement('button');
                btn.textContent = `Switch to ${targetName}`;
                btn.style.cssText = 'margin-top:8px;padding:4px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:var(--text-primary,#000);color:var(--bg-primary,#fff);border:none;cursor:pointer;width:100%';
                btn.addEventListener('click', async () => {
                    try {
                        await walletService.switchNetwork(urlChainId);
                        el.remove();
                    } catch (err) {
                        console.warn('[ERC404ProjectPage] Network switch failed:', err);
                    }
                });
                textEl.appendChild(btn);
            }
        } catch (e) {
            // Silent — don't block page load
        }
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
        const controls = this._el.querySelector('.erc404-admin-status');
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
        const controls = this._el.querySelector('.erc404-admin-status');
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

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatDate(timestamp) {
        if (!timestamp) return null;
        const ms = timestamp > 1e10 ? timestamp : timestamp * 1000;
        return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    render() {
        const { activeTab } = this.state;
        const projectData = this.projectData;
        const projectAddress = projectData.contractAddress || projectData.address || this.projectId;
        const hasTokenInfo = projectData.symbol || projectAddress || projectData.stats?.volume;
        const hasCreatorInfo = projectData.creator || projectData.createdAt || projectData.description;

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

            // Project header — always above grid
            h(ProjectHeaderCompact, { projectData }),

            // 2-column grid: project-tabs (left) + trading-controls (right)
            // On mobile, trading-controls gets order:-1 via CSS so swap appears first
            h('div', { className: 'erc404-content-grid' },
                h('div', { className: 'project-tabs' },
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
                    h('div', {
                        'data-tab-content': 'token',
                        style: { display: activeTab === 'token' ? 'block' : 'none' }
                    }),
                    h('div', {
                        'data-tab-content': 'nft',
                        style: { display: activeTab === 'nft' ? 'block' : 'none' }
                    },
                        h(NFTGalleryPreview, { adapter: this.adapter, projectId: this.projectId })
                    )
                ),

                h('div', { className: 'trading-controls' },
                    h(ERC404TradingSidebar, { adapter: this.adapter, projectData })
                )
            ),

            // Full-width sections below grid
            h('div', { className: 'bonding-status' },
                h(BondingProgressSection, { adapter: this.adapter })
            ),

            hasTokenInfo && h('div', { className: 'token-info-section' },
                projectData.symbol && h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Symbol'),
                    h('span', { className: 'info-value' }, `$${projectData.symbol}`)
                ),
                projectAddress && h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Contract'),
                    h('span', { className: 'info-value mono' }, this.truncateAddress(projectAddress))
                ),
                projectData.stats?.volume && h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Volume'),
                    h('span', { className: 'info-value' }, projectData.stats.volume)
                )
            ),

            hasCreatorInfo && h('div', { className: 'creator-info' },
                projectData.creator && h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Creator'),
                    h('span', { className: 'info-value mono' }, this.truncateAddress(projectData.creator))
                ),
                this.formatDate(projectData.createdAt) && h('div', { className: 'info-row' },
                    h('span', { className: 'info-label' }, 'Created'),
                    h('span', { className: 'info-value' }, this.formatDate(projectData.createdAt))
                ),
                projectData.description && h('div', { className: 'info-row description' },
                    h('span', { className: 'info-label' }, 'About'),
                    h('span', { className: 'info-value' }, projectData.description)
                )
            ),

            h('div', { className: 'alignment-section' },
                h(StakingSection, { adapter: this.adapter })
            ),

            // Admin status (hidden until ownership confirmed)
            h(ERC404AdminControls, { adapter: this.adapter }),

            // Comments
            h('div', { className: 'comments-section' },
                h('div', { className: 'section-title' }, 'Comments'),
                h(ProjectCommentFeed, { projectAddress, adapter: this.adapter })
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
                adapter: this.adapter,
                projectData: this.projectData,
                masterAdapter: this._masterAdapter || null,
                instanceAddress: this.projectData?.contractAddress || this.projectData?.address || this.projectId
            })
        );
    }
}

export default ERC404ProjectPage;
