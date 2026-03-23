/**
 * ERC1155ProjectPage - Microact Version
 *
 * Full page-level component for ERC1155 projects.
 * Renders: header, stats bar, vault alignment, tabbed content (Gallery/About/Activity).
 * Loads custom project style from adapter.
 * Matches docs/examples/project-erc1155-demo.html
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { EditionGallery } from './EditionGallery.microact.js';
import { ERC1155PortfolioModal } from './ERC1155PortfolioModal.microact.js';
import { ERC1155AdminPanel } from './ERC1155AdminPanel.microact.js';
import { CreateEditionModal } from './CreateEditionModal.microact.js';
import { UpdateMetadataModal } from './UpdateMetadataModal.microact.js';
import { SetEditionStyleModal } from './SetEditionStyleModal.microact.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.microact.js';
import walletService from '../../services/WalletService.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class ERC1155ProjectPage extends Component {
    constructor(props = {}) {
        super(props);
        const project = props.project || {};
        this.state = {
            loading: false,
            // Project info (initialized from props so no async setState needed)
            projectName: project.name || project.displayName || 'Untitled Project',
            projectDescription: project.description || '',
            creator: project.creator || project.creatorAddress || '',
            contractAddress: project.contractAddress || project.address || '',
            deployedDate: project.createdAt
                ? new Date(project.createdAt).toLocaleDateString()
                : '',
            // Stats (populated async via DOM updates)
            editionCount: 0,
            totalMinted: 0,
            totalVolume: '0',
            // Vault
            vaultAddress: project.vault || null,
            vaultName: '',
            vaultDescription: '',
            vaultAlignmentTokenName: '',
            vaultAlignmentTokenSymbol: '',
            vaultContributed: '0',
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

        // State is initialized from props in constructor, no async load needed.
        // Stats and vault data update the DOM directly after async contract calls.
        this.loadProjectStyle();
        this.loadStats();
        this.loadVaultData();

        // Refresh stats after a mint
        const unsub = eventBus.on('erc1155:mint:success', () => {
            // Invalidate adapter cache so we get fresh data
            this.loadStats();
        });
        this.registerCleanup(() => unsub());

        // Refresh editions after creation
        const unsub2 = eventBus.on('erc1155:edition:created', () => {
            this.loadStats();
        });
        this.registerCleanup(() => unsub2());

        // Check admin ownership
        this.checkOwnership();

        // Re-check on wallet events
        const unsub3 = eventBus.on('wallet:connected', () => this.checkOwnership());
        const unsub4 = eventBus.on('wallet:disconnected', () => this.hideAdmin());
        const unsub5 = eventBus.on('wallet:changed', () => this.checkOwnership());
        this.registerCleanup(() => { unsub3(); unsub4(); unsub5(); });
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

            const abi = await loadABI('UniAlignmentVault');
            const provider = this.adapter?.provider || this.adapter?.contract?.provider;
            if (!provider) return;

            const vaultContract = new ethers.Contract(vaultAddress, abi, provider);

            const [alignmentTokenAddr] = await Promise.allSettled([
                vaultContract.alignmentToken().catch(() => null)
            ]);

            // Fetch alignment token name + symbol
            let alignmentTokenName = '';
            let alignmentTokenSymbol = '';
            const tokenAddress = alignmentTokenAddr.status === 'fulfilled' ? alignmentTokenAddr.value : null;
            if (tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000') {
                try {
                    const erc20Abi = ['function name() view returns (string)', 'function symbol() view returns (string)'];
                    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
                    const [tokenName, tokenSymbol] = await Promise.allSettled([
                        tokenContract.name().catch(() => ''),
                        tokenContract.symbol().catch(() => '')
                    ]);
                    alignmentTokenName = tokenName.status === 'fulfilled' ? tokenName.value : '';
                    alignmentTokenSymbol = tokenSymbol.status === 'fulfilled' ? tokenSymbol.value : '';
                } catch (e) {
                    console.warn('[ERC1155ProjectPage] Failed to load alignment token metadata:', e);
                }
            }

            // Get this instance's contribution
            let contributed = '0';
            try {
                const contrib = await vaultContract.benefactorTotalETH(this.projectId);
                contributed = (Number(contrib) / 1e18).toFixed(4);
            } catch (e) {
                // benefactorTotalETH may not exist
            }

            this.updateVaultDOM({
                vaultAlignmentTokenName: alignmentTokenName,
                vaultAlignmentTokenSymbol: alignmentTokenSymbol,
                vaultContributed: contributed
            });
        } catch (error) {
            console.warn('[ERC1155ProjectPage] Failed to load vault data:', error);
        }
    }

    // Direct DOM updates for data that loads after initial render
    updateStatsDOM(stats) {
        if (!this._el) {
            this.setState(stats);
            return;
        }
        const el = this._el;
        const setValue = (selector, value) => {
            const node = el.querySelector(selector);
            if (node) node.textContent = value;
        };
        setValue('[data-stat="editions"]', stats.editionCount);
        setValue('[data-stat="minted"]', stats.totalMinted);
        setValue('[data-stat="volume"]', `${stats.totalVolume} ETH`);
    }

    updateVaultDOM(data) {
        if (!this._el) {
            this.setState(data);
            return;
        }
        const el = this._el;
        const setValue = (selector, value) => {
            const node = el.querySelector(selector);
            if (node) node.textContent = value;
        };
        if (data.vaultAlignmentTokenName !== undefined) {
            const name = data.vaultAlignmentTokenName;
            const symbol = data.vaultAlignmentTokenSymbol;
            const display = name && symbol ? `${name} (${symbol})` : name || symbol || '—';
            setValue('.vault-alignment-description', display);
        }
        setValue('[data-vault-stat="contributed"]', `${data.vaultContributed} ETH`);
    }

    shouldUpdate() {
        return false;
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

    async checkOwnership() {
        if (!this.adapter) return;

        try {
            const userAddress = walletService.getAddress();
            if (!userAddress) {
                this.hideAdmin();
                return;
            }

            const ownerAddress = await this.adapter.owner();
            if (ownerAddress && userAddress.toLowerCase() === ownerAddress.toLowerCase()) {
                this.showAdmin();
            } else {
                this.hideAdmin();
            }
        } catch (error) {
            console.warn('[ERC1155ProjectPage] Failed to check ownership:', error);
            this.hideAdmin();
        }
    }

    showAdmin() {
        if (!this._el) return;
        const notice = this._el.querySelector('.admin-notice');
        const panel = this._el.querySelector('.admin-panel');
        if (notice) notice.style.display = '';
        if (panel) panel.style.display = '';
        this._el.classList.remove('admin-hidden');
        eventBus.emit('erc1155:admin:enabled');
    }

    hideAdmin() {
        if (!this._el) return;
        const notice = this._el.querySelector('.admin-notice');
        const panel = this._el.querySelector('.admin-panel');
        if (notice) notice.style.display = 'none';
        if (panel) panel.style.display = 'none';
        eventBus.emit('erc1155:admin:disabled');
    }

    toggleAdmin() {
        if (!this._el) return;
        const isHidden = this._el.classList.toggle('admin-hidden');
        const toggleBtn = this._el.querySelector('.admin-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = isHidden ? 'Show Admin Controls' : 'Hide Admin Controls';
        }
    }

    render() {
        const {
            projectName, projectDescription, creator, contractAddress, deployedDate,
            editionCount, totalMinted, totalVolume,
            vaultAddress, vaultAlignmentTokenName, vaultAlignmentTokenSymbol, vaultContributed
        } = this.state;

        return h('div', { className: 'erc1155-project-page' },

            // ── Admin Notice Bar (hidden until ownership confirmed) ──
            h('div', { className: 'admin-notice', style: { display: 'none' } },
                h('div', { className: 'admin-notice-text' },
                    '\u2699 You are viewing this as the project creator \u2014 Admin controls enabled'
                ),
                h('button', {
                    className: 'admin-toggle',
                    onClick: this.bind(this.toggleAdmin)
                }, 'Hide Admin Controls')
            ),

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
                ),
                h('div', { className: 'project-actions' },
                    h('button', {
                        className: 'action-btn',
                        onClick: () => eventBus.emit('erc1155:portfolio:open')
                    }, 'My Editions')
                )
            ),

            // ── Admin Panel (hidden until ownership confirmed) ──
            h(ERC1155AdminPanel, { adapter: this.adapter }),

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
                h('div', { className: 'vault-alignment-label' }, 'Aligned with'),
                (() => {
                    const tokenDisplay = vaultAlignmentTokenName && vaultAlignmentTokenSymbol
                        ? `${vaultAlignmentTokenName} (${vaultAlignmentTokenSymbol})`
                        : vaultAlignmentTokenName || vaultAlignmentTokenSymbol || null;
                    return tokenDisplay
                        ? h('div', { className: 'vault-alignment-description' }, tokenDisplay)
                        : h('div', { className: 'vault-alignment-description vault-alignment-description--loading' }, '—');
                })(),
                h('div', { className: 'vault-alignment-stats' },
                    h('div', { className: 'vault-stat' },
                        h('div', { className: 'vault-stat-label' }, 'Contributed'),
                        h('div', { className: 'vault-stat-value', 'data-vault-stat': 'contributed' },
                            vaultContributed !== '0' ? `${vaultContributed} ETH` : '—'
                        )
                    )
                ),
                h('div', { className: 'vault-alignment-address' }, this.formatAddress(vaultAddress))
            ),

            // ── Editions ──
            h(EditionGallery, {
                projectId: this.projectId,
                adapter: this.adapter,
                project: this.project
            }),

            // ── Activity Feed ──
            h('div', { className: 'activity-section' },
                h('h2', { className: 'section-title' }, 'Activity'),
                h(ProjectCommentFeed, {
                    projectAddress: this.projectId
                })
            ),

            // Bottom spacer
            h('div', { style: { height: '80px' } }),

            // Portfolio modal (hidden until opened via event)
            h(ERC1155PortfolioModal, { adapter: this.adapter }),

            // Admin modals
            h(CreateEditionModal, { adapter: this.adapter }),
            h(UpdateMetadataModal, { adapter: this.adapter }),
            h(SetEditionStyleModal, { adapter: this.adapter })
        );
    }

}

export default ERC1155ProjectPage;
