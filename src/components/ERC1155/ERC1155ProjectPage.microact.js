/**
 * ERC1155ProjectPage - Microact Version
 *
 * Full page-level component for ERC1155 projects.
 * Renders: header, stats bar, vault alignment, tabbed content (Gallery/About/Activity).
 * Loads custom project style from adapter.
 * Matches docs/examples/project-erc1155-demo.html
 */

import { Component, h } from '../../core/microact-setup.js';
import { EditionGallery } from './EditionGallery.microact.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.microact.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class ERC1155ProjectPage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            activeTab: 'gallery',
            // Project info
            projectName: '',
            projectDescription: '',
            creator: '',
            contractAddress: '',
            deployedDate: '',
            // Stats
            editionCount: 0,
            totalMinted: 0,
            totalVolume: '0',
            // Vault
            vaultAddress: null,
            vaultName: '',
            vaultDescription: '',
            vaultContributed: '0',
            vaultTVL: '0',
            vaultBenefactorCount: 0
        };
        this._projectStyleId = null;
    }

    get projectId() {
        return this.props.projectId;
    }

    get adapter() {
        return this.props.adapter;
    }

    get project() {
        return this.props.project;
    }

    async didMount() {
        stylesheetLoader.load('src/components/ERC1155/erc1155.css', 'erc1155-styles');

        this.registerCleanup(() => {
            stylesheetLoader.unload('erc1155-styles');
            this.unloadProjectStyle();
        });

        await this.loadProjectData();
        this.loadProjectStyle();
        this.loadStats();
        this.loadVaultData();
    }

    async loadProjectData() {
        try {
            const project = this.project || {};

            this.setState({
                loading: false,
                projectName: project.name || project.displayName || 'Untitled Project',
                projectDescription: project.description || '',
                creator: project.creator || project.creatorAddress || '',
                contractAddress: project.contractAddress || project.address || this.projectId,
                deployedDate: project.createdAt
                    ? new Date(project.createdAt).toLocaleDateString()
                    : '',
                vaultAddress: project.vault || null
            });
        } catch (error) {
            console.error('[ERC1155ProjectPage] Failed to load project data:', error);
            this.setState({ loading: false });
        }
    }

    async loadStats() {
        if (!this.adapter) return;
        try {
            const editions = await this.adapter.getEditions();
            let totalMinted = 0;
            let totalVolume = BigInt(0);

            for (const edition of editions) {
                const minted = parseInt(edition.currentSupply || '0');
                totalMinted += minted;
                // volume = minted * price
                const price = BigInt(edition.price || '0');
                totalVolume += price * BigInt(minted);
            }

            const volumeEth = Number(totalVolume) / 1e18;

            this.updateStatsDOM({
                editionCount: editions.length,
                totalMinted,
                totalVolume: volumeEth < 0.01 && volumeEth > 0
                    ? volumeEth.toFixed(4)
                    : volumeEth.toFixed(2)
            });
        } catch (error) {
            console.warn('[ERC1155ProjectPage] Failed to load stats:', error);
        }
    }

    async loadVaultData() {
        const vaultAddress = this.state.vaultAddress || this.project?.vault;
        if (!vaultAddress) return;

        try {
            const projectService = serviceFactory.getProjectService();
            // Try to get vault adapter through the service
            const { loadABI } = await import('../../utils/abiLoader.js');
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            const abi = await loadABI('UltraAlignmentVault');
            const provider = this.adapter?.provider || this.adapter?.contract?.provider;
            if (!provider) return;

            const vaultContract = new ethers.Contract(vaultAddress, abi, provider);

            const [description, accumulatedFees, totalShares] = await Promise.allSettled([
                vaultContract.description().catch(() => ''),
                vaultContract.accumulatedFees().catch(() => BigInt(0)),
                vaultContract.totalShares().catch(() => BigInt(0))
            ]);

            // Get this instance's contribution
            let contributed = '0';
            try {
                const contrib = await vaultContract.benefactorTotalETH(this.projectId);
                contributed = (Number(contrib) / 1e18).toFixed(4);
            } catch (e) {
                // benefactorTotalETH may not exist
            }

            const feesValue = accumulatedFees.status === 'fulfilled'
                ? (Number(accumulatedFees.value) / 1e18).toFixed(4)
                : '0';

            this.updateVaultDOM({
                vaultDescription: description.status === 'fulfilled' ? description.value : '',
                vaultContributed: contributed,
                vaultTVL: feesValue
            });
        } catch (error) {
            console.warn('[ERC1155ProjectPage] Failed to load vault data:', error);
        }
    }

    // Direct DOM updates for data that loads after initial render
    updateStatsDOM(stats) {
        if (!this._element) {
            this.setState(stats);
            return;
        }
        const el = this._element;
        const setValue = (selector, value) => {
            const node = el.querySelector(selector);
            if (node) node.textContent = value;
        };
        setValue('[data-stat="editions"]', stats.editionCount);
        setValue('[data-stat="minted"]', stats.totalMinted);
        setValue('[data-stat="volume"]', `${stats.totalVolume} ETH`);
    }

    updateVaultDOM(data) {
        if (!this._element) {
            this.setState(data);
            return;
        }
        const el = this._element;
        const setValue = (selector, value) => {
            const node = el.querySelector(selector);
            if (node) node.textContent = value;
        };
        if (data.vaultDescription) {
            setValue('.vault-alignment-description', data.vaultDescription);
        }
        setValue('[data-vault-stat="contributed"]', `${data.vaultContributed} ETH`);
        setValue('[data-vault-stat="tvl"]', `${data.vaultTVL} ETH`);
    }

    shouldUpdate(oldState, newState) {
        // Only re-render for structural changes
        if (oldState.loading !== newState.loading) return true;

        // Handle tab switch via DOM manipulation
        if (oldState.activeTab !== newState.activeTab) {
            this.updateTabDisplay(newState.activeTab);
            return false;
        }

        return false;
    }

    handleTabClick(tab) {
        if (tab !== this.state.activeTab) {
            this.setState({ activeTab: tab });
        }
    }

    updateTabDisplay(activeTab) {
        if (!this._element) return;

        // Update tab buttons
        const tabs = this._element.querySelectorAll('.tab');
        tabs.forEach(btn => {
            if (btn.dataset.tab === activeTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab content visibility
        const panels = this._element.querySelectorAll('[data-tab-content]');
        panels.forEach(panel => {
            panel.style.display = panel.dataset.tabContent === activeTab ? 'block' : 'none';
        });
    }

    // Project style loading
    async loadProjectStyle() {
        try {
            const cacheKey = `projectStyle:${this.projectId}`;
            const cachedUri = localStorage.getItem(cacheKey);

            if (cachedUri) {
                this._applyProjectStyle(cachedUri);
            }

            if (!this.adapter) return;

            const styleUri = await this.adapter.getStyle().catch(() => '');

            if (styleUri && styleUri.trim()) {
                localStorage.setItem(cacheKey, styleUri);
                if (styleUri !== cachedUri) {
                    this._applyProjectStyle(styleUri);
                }
            } else if (cachedUri) {
                localStorage.removeItem(cacheKey);
                this.unloadProjectStyle();
            }
        } catch (error) {
            console.warn('[ERC1155ProjectPage] Failed to load project style:', error);
        }
    }

    _applyProjectStyle(styleUri) {
        const styleId = `project-style-${this.projectId}`;

        document.documentElement.classList.add('has-project-style');
        document.body.classList.add('has-project-style');
        document.body.setAttribute('data-project-style', this.projectId);

        const existingLink = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
        if (existingLink) {
            document.documentElement.classList.add('project-style-loaded', 'project-style-resolved');
            document.body.classList.add('project-style-loaded', 'project-style-resolved');
        } else {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleUri.startsWith('/') || styleUri.startsWith('http') ? styleUri : '/' + styleUri;
            link.setAttribute('data-stylesheet-id', styleId);

            link.onload = () => {
                document.documentElement.classList.add('project-style-loaded', 'project-style-resolved');
                document.body.classList.add('project-style-loaded', 'project-style-resolved');
            };

            link.onerror = () => {
                document.documentElement.classList.remove('has-project-style');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
            };

            document.head.appendChild(link);
        }

        this._projectStyleId = styleId;
    }

    unloadProjectStyle() {
        if (this._projectStyleId) {
            const link = document.querySelector(`link[data-stylesheet-id="${this._projectStyleId}"]`);
            if (link) link.remove();
            this._projectStyleId = null;

            document.documentElement.classList.remove('has-project-style', 'project-style-loaded', 'project-style-resolved', 'project-style-pending');
            document.body.classList.remove('has-project-style', 'project-style-loaded', 'project-style-resolved', 'project-style-pending');
            document.body.removeAttribute('data-project-style');
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatAddress(address) {
        if (!address || address.length < 10) return address || '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const {
            loading, activeTab,
            projectName, projectDescription, creator, contractAddress, deployedDate,
            editionCount, totalMinted, totalVolume,
            vaultAddress, vaultDescription, vaultContributed, vaultTVL
        } = this.state;

        if (loading) {
            return h('div', { className: 'erc1155-project-page' },
                h('div', { className: 'loading-state' },
                    h('p', null, 'Loading project...')
                )
            );
        }

        return h('div', { className: 'erc1155-project-page' },

            // ── Project Header ──
            h('header', { className: 'project-header' },
                h('div', { className: 'project-type-badge' }, 'ERC1155 Gallery'),
                h('h1', { className: 'project-title' }, this.escapeHtml(projectName)),
                projectDescription && h('p', { className: 'project-description' },
                    this.escapeHtml(projectDescription)
                ),
                h('div', { className: 'project-meta' },
                    creator && h('div', { className: 'project-meta-item' },
                        h('span', { className: 'project-meta-label' }, 'Created by:'),
                        h('span', { className: 'text-mono' }, this.formatAddress(creator))
                    ),
                    contractAddress && h('div', { className: 'project-meta-item' },
                        h('span', { className: 'project-meta-label' }, 'Contract:'),
                        h('span', { className: 'text-mono' }, this.formatAddress(contractAddress))
                    ),
                    deployedDate && h('div', { className: 'project-meta-item' },
                        h('span', { className: 'project-meta-label' }, 'Deployed:'),
                        h('span', null, deployedDate)
                    )
                )
            ),

            // ── Stats Bar ──
            h('div', { className: 'stats-bar' },
                h('div', { className: 'stat' },
                    h('div', { className: 'stat-value', 'data-stat': 'editions' }, editionCount || '—'),
                    h('div', { className: 'stat-label' }, 'Editions')
                ),
                h('div', { className: 'stat' },
                    h('div', { className: 'stat-value', 'data-stat': 'minted' }, totalMinted || '—'),
                    h('div', { className: 'stat-label' }, 'Total Minted')
                ),
                h('div', { className: 'stat' },
                    h('div', { className: 'stat-value', 'data-stat': 'volume' }, totalVolume !== '0' ? `${totalVolume} ETH` : '—'),
                    h('div', { className: 'stat-label' }, 'Total Volume')
                )
            ),

            // ── Vault Alignment ──
            vaultAddress && h('div', { className: 'vault-alignment' },
                h('div', { className: 'vault-alignment-header' },
                    h('div', { className: 'vault-alignment-title' }, 'Vault Alignment'),
                    h('div', { className: 'vault-alignment-badge' }, this.formatAddress(vaultAddress))
                ),
                vaultDescription && h('div', { className: 'vault-alignment-description' },
                    this.escapeHtml(vaultDescription)
                ),
                h('div', { className: 'vault-alignment-stats' },
                    h('div', { className: 'vault-stat' },
                        h('div', { className: 'vault-stat-label' }, 'Contributed'),
                        h('div', { className: 'vault-stat-value', 'data-vault-stat': 'contributed' },
                            vaultContributed !== '0' ? `${vaultContributed} ETH` : '—'
                        )
                    ),
                    h('div', { className: 'vault-stat' },
                        h('div', { className: 'vault-stat-label' }, 'Vault Fees'),
                        h('div', { className: 'vault-stat-value', 'data-vault-stat': 'tvl' },
                            vaultTVL !== '0' ? `${vaultTVL} ETH` : '—'
                        )
                    )
                )
            ),

            // ── Tabs ──
            h('div', { className: 'tabs' },
                h('button', {
                    className: `tab ${activeTab === 'gallery' ? 'active' : ''}`,
                    'data-tab': 'gallery',
                    onClick: () => this.handleTabClick('gallery')
                }, 'Gallery'),
                h('button', {
                    className: `tab ${activeTab === 'about' ? 'active' : ''}`,
                    'data-tab': 'about',
                    onClick: () => this.handleTabClick('about')
                }, 'About'),
                h('button', {
                    className: `tab ${activeTab === 'activity' ? 'active' : ''}`,
                    'data-tab': 'activity',
                    onClick: () => this.handleTabClick('activity')
                }, 'Activity')
            ),

            // ── Gallery Tab ──
            h('div', { 'data-tab-content': 'gallery', style: { display: activeTab === 'gallery' ? 'block' : 'none' } },
                h(EditionGallery, {
                    projectId: this.projectId,
                    adapter: this.adapter,
                    project: this.project
                })
            ),

            // ── About Tab ──
            h('div', { 'data-tab-content': 'about', style: { display: activeTab === 'about' ? 'block' : 'none' } },
                h('div', { className: 'about-section' },
                    h('h2', { className: 'about-title' }, 'About This Project'),
                    projectDescription && h('p', { className: 'about-text' },
                        this.escapeHtml(projectDescription)
                    ),
                    h('h3', { className: 'about-title about-title-sm' }, 'Project Details'),
                    h('div', { className: 'about-details' },
                        this.renderDetailRow('Contract Type', 'ERC1155 Gallery'),
                        this.renderDetailRow('Total Editions', editionCount || '—'),
                        this.renderDetailRow('Contract Address', this.formatAddress(contractAddress)),
                        deployedDate && this.renderDetailRow('Deployed', deployedDate),
                        creator && this.renderDetailRow('Creator', this.formatAddress(creator)),
                        vaultAddress && this.renderDetailRow('Vault', this.formatAddress(vaultAddress))
                    )
                )
            ),

            // ── Activity Tab (Comment Feed) ──
            h('div', { 'data-tab-content': 'activity', style: { display: activeTab === 'activity' ? 'block' : 'none' } },
                h(ProjectCommentFeed, {
                    projectAddress: this.projectId
                })
            ),

            // ── Free Mint Gating (placeholder — ERC1155 contracts don't support gating yet) ──
            h('div', { className: 'free-mint-placeholder' },
                h('div', { className: 'free-mint-header' },
                    h('div', { className: 'free-mint-title' }, 'Free Mint'),
                    h('div', { className: 'free-mint-badge free-mint-badge-disabled' }, 'Not Available')
                ),
                h('div', { className: 'free-mint-description' },
                    'Free mint gating is not yet supported for ERC1155 projects. When available, eligible users will be able to claim editions at no cost based on configured gating rules.'
                )
            ),

            // Bottom spacer
            h('div', { style: { height: '80px' } })
        );
    }

    renderDetailRow(label, value) {
        return h('div', { className: 'about-detail-row' },
            h('div', { className: 'about-detail-label' }, label),
            h('div', { className: 'about-detail-value' }, String(value))
        );
    }
}

export default ERC1155ProjectPage;
