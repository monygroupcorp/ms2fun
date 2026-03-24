import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import walletService from '../services/WalletService.js';
import serviceFactory from '../services/ServiceFactory.js';

const SECTIONS = ['overview', 'factories', 'vaults', 'alignment', 'parameters', 'treasury'];
const SECTION_LABELS = {
    overview: 'Overview',
    factories: 'Factories',
    vaults: 'Vaults',
    alignment: 'Alignment',
    parameters: 'Parameters',
    treasury: 'Treasury',
};

export class AdminPage extends Component {
    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            accessDenied: false,
            activeSection: 'overview',
            ownerAddress: null,
            // overview stats
            totalFactories: 0,
            totalVaults: 0,
            totalInstances: 0,
            // per-section data loaded on demand
            factories: [],
            vaults: [],
            alignmentTargets: [],
            // protocol params
            cleanupReward: '',
            featuredQueueManager: '',
            globalMessageRegistry: '',
            // treasury
            treasuryDeployed: false,
            treasuryBalance: '0',
            revenueSources: [],
            polInstances: [],
            // tx feedback
            txPending: false,
            txError: null,
            txSuccess: null,
        };

        // form state (kept separate to avoid re-render thrash)
        this._forms = {
            factory: { address: '', contractType: '', title: '', displayTitle: '', metadataURI: '' },
            vault: { address: '', vaultType: '', name: '', metadataURI: '' },
            alignmentNew: { title: '', description: '', metadataURI: '', assets: [{ token: '', symbol: '', info: '', metadataURI: '' }] },
            alignmentEdit: { targetId: null, description: '', metadataURI: '' },
            ambassador: { targetId: null, address: '' },
            params: { cleanupReward: '', featuredQueueManager: '', globalMessageRegistry: '' },
            withdraw: { to: '', amountEth: '' },
        };

        this.masterAdapter = null;
        this.alignmentAdapter = null;
        this.treasuryAdapter = null;
    }

    async didMount() {
        await stylesheetLoader.load('/src/core/route-admin-v2.css', 'route:admin');
        await this._initialize();
    }

    async _initialize() {
        try {
            this.masterAdapter = await serviceFactory.getMasterRegistryAdapter();
        } catch (err) {
            this.setState({ loading: false, accessDenied: false, txError: `Failed to load registry: ${err.message}` });
            return;
        }

        // Access gate: check owner
        let owner;
        try {
            owner = await this.masterAdapter.executeContractCall('owner');
        } catch {
            // If owner() fails try dictator() as fallback for older deployments
            try {
                owner = await this.masterAdapter.executeContractCall('dictator');
            } catch {
                owner = null;
            }
        }

        const connected = walletService.connectedAddress;
        if (!owner || !connected || owner.toLowerCase() !== connected.toLowerCase()) {
            this.setState({ loading: false, accessDenied: true });
            return;
        }

        this.setState({ ownerAddress: owner });
        await this._loadOverview();
        this.setState({ loading: false });
    }

    async _loadOverview() {
        try {
            const [totalFactories, totalVaults] = await Promise.all([
                this.masterAdapter.getTotalFactories(),
                this.masterAdapter.getTotalVaults(),
            ]);
            // Instance count: sum factory instance counts
            let totalInstances = 0;
            try {
                const allInstances = await this.masterAdapter.executeContractCall('getTotalInstances');
                totalInstances = parseInt(allInstances.toString());
            } catch { /* not available in all deployments */ }

            this.setState({ totalFactories, totalVaults, totalInstances });
        } catch (err) {
            console.error('[AdminPage] overview load error:', err);
        }
    }

    async _loadSection(section) {
        if (section === 'factories' && this.state.factories.length === 0) {
            try {
                const total = this.state.totalFactories || await this.masterAdapter.getTotalFactories();
                if (total > 0) {
                    const factories = await this.masterAdapter.getFactories(0, total);
                    this.setState({ factories });
                }
            } catch (err) { console.error('[AdminPage] factories load error:', err); }
        }

        if (section === 'vaults' && this.state.vaults.length === 0) {
            try {
                const total = this.state.totalVaults || await this.masterAdapter.getTotalVaults();
                if (total > 0) {
                    const vaults = await this.masterAdapter.getVaults(0, total);
                    this.setState({ vaults });
                }
            } catch (err) { console.error('[AdminPage] vaults load error:', err); }
        }

        if (section === 'alignment' && this.state.alignmentTargets.length === 0) {
            try {
                this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
                const targets = await this.alignmentAdapter.getAllTargets();
                this.setState({ alignmentTargets: targets });
            } catch (err) { console.error('[AdminPage] alignment load error:', err); }
        }

        if (section === 'parameters') {
            try {
                const [cleanupReward, featuredQueueManager, globalMessageRegistry] = await Promise.all([
                    this.masterAdapter.getStandardCleanupReward(),
                    this.masterAdapter.getFeaturedQueueManager(),
                    this.masterAdapter.getGlobalMessageRegistry(),
                ]);
                this._forms.params = {
                    cleanupReward: cleanupReward ? cleanupReward.toString() : '',
                    featuredQueueManager: featuredQueueManager || '',
                    globalMessageRegistry: globalMessageRegistry || '',
                };
                this.setState({
                    cleanupReward: this._forms.params.cleanupReward,
                    featuredQueueManager: this._forms.params.featuredQueueManager,
                    globalMessageRegistry: this._forms.params.globalMessageRegistry,
                });
            } catch (err) { console.error('[AdminPage] params load error:', err); }
        }

        if (section === 'treasury') {
            try {
                this.treasuryAdapter = await serviceFactory.getProtocolTreasuryAdapter();
                if (this.treasuryAdapter) {
                    const [balance, revenueSources, polInstances] = await Promise.all([
                        this.treasuryAdapter.getBalance(),
                        this.treasuryAdapter.getAllRevenueSources(),
                        this.treasuryAdapter.getPolInstances(),
                    ]);
                    this.setState({ treasuryDeployed: true, treasuryBalance: balance, revenueSources, polInstances });
                } else {
                    this.setState({ treasuryDeployed: false });
                }
            } catch (err) { console.error('[AdminPage] treasury load error:', err); }
        }
    }

    _setSection(section) {
        this.setState({ activeSection: section, txError: null, txSuccess: null });
        this._loadSection(section);
    }

    _clearTx() {
        this.setState({ txPending: false, txError: null, txSuccess: null });
    }

    // ── Render ────────────────────────────────────────────────────────────────

    render() {
        const { loading, accessDenied, activeSection } = this.state;

        return h(Layout, {
            currentPath: '/admin',
            mode: this.props.mode,
            children: h('div', { className: 'admin-page' },
                loading
                    ? this._renderLoading()
                    : accessDenied
                        ? this._renderLocked()
                        : this._renderPanel()
            )
        });
    }

    _renderLoading() {
        return h('div', { className: 'admin-locked' },
            h('span', { className: 'admin-locked-label' }, 'Checking access...')
        );
    }

    _renderLocked() {
        return h('div', { className: 'admin-locked' },
            h('span', { className: 'admin-locked-label' }, 'Not authorized')
        );
    }

    _renderPanel() {
        return h('div', { className: 'admin-layout' },
            this._renderSidebar(),
            h('div', { className: 'admin-content' },
                this._renderTxFeedback(),
                this._renderSection()
            )
        );
    }

    _renderSidebar() {
        const { activeSection } = this.state;
        return h('nav', { className: 'admin-sidebar' },
            h('div', { className: 'admin-sidebar-title' }, 'Protocol Admin'),
            ...SECTIONS.map(s =>
                h('button', {
                    className: `admin-nav-item${activeSection === s ? ' active' : ''}`,
                    onClick: () => this._setSection(s),
                }, SECTION_LABELS[s])
            )
        );
    }

    _renderTxFeedback() {
        const { txPending, txError, txSuccess } = this.state;
        if (txPending) return h('div', { className: 'admin-notice' }, 'Transaction pending...');
        if (txError) return h('div', { className: 'admin-notice error' }, txError);
        if (txSuccess) return h('div', { className: 'admin-notice success' }, txSuccess);
        return null;
    }

    _renderSection() {
        switch (this.state.activeSection) {
            case 'overview': return this._renderOverview();
            case 'factories': return this._renderFactories();
            case 'vaults': return this._renderVaults();
            case 'alignment': return this._renderAlignment();
            case 'parameters': return this._renderParameters();
            case 'treasury': return this._renderTreasury();
            default: return null;
        }
    }

    // ── Overview ──────────────────────────────────────────────────────────────

    _renderOverview() {
        const { totalFactories, totalVaults, totalInstances, ownerAddress } = this.state;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Overview'),
            h('p', { className: 'admin-section-subtitle' }, `Owner: ${ownerAddress || '—'}`),
            h('div', { className: 'admin-stats-grid' },
                h('div', { className: 'admin-stat-card' },
                    h('div', { className: 'admin-stat-label' }, 'Factories'),
                    h('div', { className: 'admin-stat-value' }, totalFactories)
                ),
                h('div', { className: 'admin-stat-card' },
                    h('div', { className: 'admin-stat-label' }, 'Vaults'),
                    h('div', { className: 'admin-stat-value' }, totalVaults)
                ),
                h('div', { className: 'admin-stat-card' },
                    h('div', { className: 'admin-stat-label' }, 'Instances'),
                    h('div', { className: 'admin-stat-value' }, totalInstances)
                ),
            )
        );
    }

    // ── Factories ─────────────────────────────────────────────────────────────

    _renderFactories() {
        const { factories } = this.state;
        const f = this._forms.factory;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Factories'),
            h('p', { className: 'admin-section-subtitle' }, 'Registered factory contracts'),

            // Table
            factories.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null,
                        h('tr', null,
                            h('th', null, 'ID'), h('th', null, 'Type'), h('th', null, 'Title'), h('th', null, 'Address')
                        )
                    ),
                    h('tbody', null,
                        ...factories.map(fac =>
                            h('tr', { key: fac.factoryId },
                                h('td', null, fac.factoryId?.toString()),
                                h('td', null, fac.contractType || fac.type || '—'),
                                h('td', null, fac.displayTitle || fac.title),
                                h('td', { className: 'addr' }, fac.factoryAddress || fac.address)
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No factories registered.'),

            // Register factory form
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Factory'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Address'),
                        h('input', { type: 'text', placeholder: '0x...', value: f.address,
                            onInput: e => { f.address = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Contract Type'),
                        h('input', { type: 'text', placeholder: 'ERC404', value: f.contractType,
                            onInput: e => { f.contractType = e.target.value; }
                        })
                    )
                ),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Title'),
                        h('input', { type: 'text', value: f.title,
                            onInput: e => { f.title = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Display Title'),
                        h('input', { type: 'text', value: f.displayTitle,
                            onInput: e => { f.displayTitle = e.target.value; }
                        })
                    )
                ),
                h('div', { className: 'admin-field' },
                    h('label', null, 'Metadata URI'),
                    h('input', { type: 'text', placeholder: 'ipfs://...', value: f.metadataURI,
                        onInput: e => { f.metadataURI = e.target.value; }
                    })
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._registerFactory()
                }, 'Register Factory')
            )
        );
    }

    async _registerFactory() {
        const f = this._forms.factory;
        if (!f.address || !f.contractType || !f.title || !f.displayTitle) {
            this.setState({ txError: 'All fields required.' });
            return;
        }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.registerFactory(f.address, f.contractType, f.title, f.displayTitle, f.metadataURI || '');
            this._forms.factory = { address: '', contractType: '', title: '', displayTitle: '', metadataURI: '' };
            // Reload factories
            const total = await this.masterAdapter.getTotalFactories();
            const factories = total > 0 ? await this.masterAdapter.getFactories(0, total) : [];
            this.setState({ txPending: false, txSuccess: 'Factory registered.', factories, totalFactories: total });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    // ── Vaults ────────────────────────────────────────────────────────────────

    _renderVaults() {
        const { vaults } = this.state;
        const v = this._forms.vault;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Vaults'),
            h('p', { className: 'admin-section-subtitle' }, 'Approved alignment vaults'),

            vaults.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null,
                        h('tr', null,
                            h('th', null, 'Name'), h('th', null, 'Type'), h('th', null, 'Status'), h('th', null, 'Address'), h('th', null, '')
                        )
                    ),
                    h('tbody', null,
                        ...vaults.map(vault =>
                            h('tr', { key: vault.vaultAddress },
                                h('td', null, vault.name),
                                h('td', null, vault.vaultType),
                                h('td', null,
                                    h('span', { className: `admin-badge ${vault.active ? 'active' : 'inactive'}` },
                                        vault.active ? 'active' : 'inactive'
                                    )
                                ),
                                h('td', { className: 'addr' }, vault.vaultAddress),
                                h('td', null,
                                    vault.active
                                        ? h('button', {
                                            className: 'admin-btn admin-btn-sm danger',
                                            disabled: this.state.txPending,
                                            onClick: () => this._deactivateVault(vault.vaultAddress)
                                        }, 'Deactivate')
                                        : null
                                )
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No vaults registered.'),

            // Register vault form
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Vault'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Address'),
                        h('input', { type: 'text', placeholder: '0x...', value: v.address,
                            onInput: e => { v.address = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Vault Type'),
                        h('input', { type: 'text', placeholder: 'UNIv4 / CYPHER / ZAMM', value: v.vaultType,
                            onInput: e => { v.vaultType = e.target.value; }
                        })
                    )
                ),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Name'),
                        h('input', { type: 'text', value: v.name,
                            onInput: e => { v.name = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Metadata URI'),
                        h('input', { type: 'text', placeholder: 'ipfs://...', value: v.metadataURI,
                            onInput: e => { v.metadataURI = e.target.value; }
                        })
                    )
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._registerVault()
                }, 'Register Vault')
            )
        );
    }

    async _registerVault() {
        const v = this._forms.vault;
        if (!v.address || !v.vaultType || !v.name) {
            this.setState({ txError: 'Address, type, and name required.' });
            return;
        }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.registerApprovedVault(v.address, v.vaultType, v.name, v.metadataURI || '');
            this._forms.vault = { address: '', vaultType: '', name: '', metadataURI: '' };
            const total = await this.masterAdapter.getTotalVaults();
            const vaults = total > 0 ? await this.masterAdapter.getVaults(0, total) : [];
            this.setState({ txPending: false, txSuccess: 'Vault registered.', vaults, totalVaults: total });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    async _deactivateVault(vaultAddress) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.deactivateVault(vaultAddress);
            const total = await this.masterAdapter.getTotalVaults();
            const vaults = total > 0 ? await this.masterAdapter.getVaults(0, total) : [];
            this.setState({ txPending: false, txSuccess: 'Vault deactivated.', vaults });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    // ── Alignment Targets ─────────────────────────────────────────────────────

    _renderAlignment() {
        const { alignmentTargets } = this.state;
        const n = this._forms.alignmentNew;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Alignment Targets'),
            h('p', { className: 'admin-section-subtitle' }, 'Registered alignment targets and their assets'),

            alignmentTargets.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null,
                        h('tr', null,
                            h('th', null, 'ID'), h('th', null, 'Title'), h('th', null, 'Assets'),
                            h('th', null, 'Status'), h('th', null, '')
                        )
                    ),
                    h('tbody', null,
                        ...alignmentTargets.map(t =>
                            h('tr', { key: t.id },
                                h('td', null, t.id),
                                h('td', null, t.title),
                                h('td', null, t.assets?.length || 0),
                                h('td', null,
                                    h('span', { className: `admin-badge ${t.active ? 'active' : 'inactive'}` },
                                        t.active ? 'active' : 'inactive'
                                    )
                                ),
                                h('td', null,
                                    t.active
                                        ? h('button', {
                                            className: 'admin-btn admin-btn-sm danger',
                                            disabled: this.state.txPending,
                                            onClick: () => this._deactivateTarget(t.id)
                                        }, 'Deactivate')
                                        : null
                                )
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No alignment targets registered.'),

            // Register new target form
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Alignment Target'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Title'),
                        h('input', { type: 'text', value: n.title,
                            onInput: e => { n.title = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Metadata URI'),
                        h('input', { type: 'text', placeholder: 'ipfs://...', value: n.metadataURI,
                            onInput: e => { n.metadataURI = e.target.value; }
                        })
                    )
                ),
                h('div', { className: 'admin-field' },
                    h('label', null, 'Description'),
                    h('textarea', { value: n.description,
                        onInput: e => { n.description = e.target.value; }
                    })
                ),
                h('div', { className: 'admin-form-title' }, 'Assets (min 1 required)'),
                h('div', { className: 'admin-asset-list' },
                    ...n.assets.map((asset, i) =>
                        h('div', { className: 'admin-asset-item', key: i },
                            h('div', { className: 'admin-field' },
                                h('label', null, 'Token Address'),
                                h('input', { type: 'text', placeholder: '0x...', value: asset.token,
                                    onInput: e => { n.assets[i].token = e.target.value; }
                                })
                            ),
                            h('div', { className: 'admin-field' },
                                h('label', null, 'Symbol'),
                                h('input', { type: 'text', placeholder: 'ETH', value: asset.symbol,
                                    onInput: e => { n.assets[i].symbol = e.target.value; }
                                })
                            ),
                            h('div', { className: 'admin-field' },
                                h('label', null, 'Info'),
                                h('input', { type: 'text', value: asset.info,
                                    onInput: e => { n.assets[i].info = e.target.value; }
                                })
                            ),
                            n.assets.length > 1
                                ? h('button', { className: 'admin-btn admin-btn-sm danger',
                                    style: { marginTop: '22px' },
                                    onClick: () => { n.assets.splice(i, 1); this.setState({}); }
                                }, '✕')
                                : h('div', null)
                        )
                    )
                ),
                h('button', { className: 'admin-btn admin-btn-sm', style: { marginBottom: 'var(--space-4)' },
                    onClick: () => { n.assets.push({ token: '', symbol: '', info: '', metadataURI: '' }); this.setState({}); }
                }, '+ Add Asset'),
                h('br', null),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._registerTarget()
                }, 'Register Target')
            )
        );
    }

    async _registerTarget() {
        const n = this._forms.alignmentNew;
        if (!n.title || !n.description || n.assets.length === 0 || !n.assets[0].token) {
            this.setState({ txError: 'Title, description, and at least one asset with token address required.' });
            return;
        }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) {
                this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            }
            await this.alignmentAdapter.registerAlignmentTarget(n.title, n.description, n.metadataURI || '', n.assets);
            this._forms.alignmentNew = { title: '', description: '', metadataURI: '', assets: [{ token: '', symbol: '', info: '', metadataURI: '' }] };
            const targets = await this.alignmentAdapter.getAllTargets();
            this.setState({ txPending: false, txSuccess: 'Alignment target registered.', alignmentTargets: targets });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    async _deactivateTarget(targetId) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) {
                this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            }
            await this.alignmentAdapter.deactivateAlignmentTarget(targetId);
            const targets = await this.alignmentAdapter.getAllTargets();
            this.setState({ txPending: false, txSuccess: 'Target deactivated.', alignmentTargets: targets });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    // ── Protocol Parameters ───────────────────────────────────────────────────

    _renderParameters() {
        const p = this._forms.params;
        const { cleanupReward, featuredQueueManager, globalMessageRegistry } = this.state;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Protocol Parameters'),
            h('p', { className: 'admin-section-subtitle' }, 'Registry configuration'),

            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Standard Cleanup Reward'),
                h('div', { className: 'admin-field' },
                    h('label', null, 'Reward (wei)'),
                    h('input', { type: 'text', value: cleanupReward,
                        onInput: e => { p.cleanupReward = e.target.value; this.setState({ cleanupReward: e.target.value }); }
                    })
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._setCleanupReward()
                }, 'Update')
            ),

            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Featured Queue Manager'),
                h('div', { className: 'admin-field' },
                    h('label', null, 'Address'),
                    h('input', { type: 'text', placeholder: '0x...', value: featuredQueueManager,
                        onInput: e => { p.featuredQueueManager = e.target.value; this.setState({ featuredQueueManager: e.target.value }); }
                    })
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._setFeaturedQueueManager()
                }, 'Update')
            ),

            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Global Message Registry'),
                h('div', { className: 'admin-field' },
                    h('label', null, 'Address'),
                    h('input', { type: 'text', placeholder: '0x...', value: globalMessageRegistry,
                        onInput: e => { p.globalMessageRegistry = e.target.value; this.setState({ globalMessageRegistry: e.target.value }); }
                    })
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._setGlobalMessageRegistry()
                }, 'Update')
            )
        );
    }

    async _setCleanupReward() {
        const val = this._forms.params.cleanupReward;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setStandardCleanupReward(val);
            this.setState({ txPending: false, txSuccess: 'Cleanup reward updated.' });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    async _setFeaturedQueueManager() {
        const val = this._forms.params.featuredQueueManager;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setFeaturedQueueManager(val);
            this.setState({ txPending: false, txSuccess: 'Featured queue manager updated.' });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    async _setGlobalMessageRegistry() {
        const val = this._forms.params.globalMessageRegistry;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setGlobalMessageRegistry(val);
            this.setState({ txPending: false, txSuccess: 'Global message registry updated.' });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    // ── Treasury ──────────────────────────────────────────────────────────────

    _renderTreasury() {
        const { treasuryDeployed, treasuryBalance, revenueSources, polInstances } = this.state;
        const w = this._forms.withdraw;

        if (!treasuryDeployed) {
            return h('div', null,
                h('h2', { className: 'admin-section-title' }, 'Treasury'),
                h('div', { className: 'admin-notice' }, 'ProtocolTreasuryV1 not deployed. Add address to contracts config to enable.')
            );
        }

        const balanceEth = (parseFloat(treasuryBalance) / 1e18).toFixed(6);

        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Treasury'),
            h('p', { className: 'admin-section-subtitle' }, `Balance: ${balanceEth} ETH`),

            // Revenue breakdown
            revenueSources.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null,
                        h('tr', null, h('th', null, 'Source'), h('th', null, 'Received'), h('th', null, 'Withdrawn'))
                    ),
                    h('tbody', null,
                        ...revenueSources.map(s =>
                            h('tr', { key: s.key },
                                h('td', null, s.label),
                                h('td', null, `${(parseFloat(s.received) / 1e18).toFixed(6)} ETH`),
                                h('td', null, `${(parseFloat(s.withdrawn) / 1e18).toFixed(6)} ETH`)
                            )
                        )
                    )
                )
                : null,

            // Withdraw ETH
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Withdraw ETH'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Recipient Address'),
                        h('input', { type: 'text', placeholder: '0x...', value: w.to,
                            onInput: e => { w.to = e.target.value; }
                        })
                    ),
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Amount (ETH)'),
                        h('input', { type: 'text', placeholder: '0.0', value: w.amountEth,
                            onInput: e => { w.amountEth = e.target.value; }
                        })
                    )
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending,
                    onClick: () => this._withdrawETH()
                }, 'Withdraw ETH')
            ),

            // POL positions
            polInstances.length > 0
                ? h('div', null,
                    h('div', { className: 'admin-form-title' }, 'POL Positions'),
                    h('table', { className: 'admin-table' },
                        h('thead', null,
                            h('tr', null, h('th', null, 'Instance'), h('th', null, 'Liquidity'), h('th', null, ''))
                        ),
                        h('tbody', null,
                            ...polInstances.map(pos =>
                                h('tr', { key: pos.address },
                                    h('td', { className: 'addr' }, pos.address),
                                    h('td', null, pos.liquidity),
                                    h('td', null,
                                        h('button', {
                                            className: 'admin-btn admin-btn-sm',
                                            disabled: this.state.txPending,
                                            onClick: () => this._claimPOLFees(pos.address)
                                        }, 'Claim Fees')
                                    )
                                )
                            )
                        )
                    )
                )
                : null
        );
    }

    async _withdrawETH() {
        const w = this._forms.withdraw;
        if (!w.to || !w.amountEth) {
            this.setState({ txError: 'Recipient and amount required.' });
            return;
        }
        const amountWei = (parseFloat(w.amountEth) * 1e18).toFixed(0);
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.withdrawETH(w.to, amountWei);
            const balance = await this.treasuryAdapter.getBalance();
            this._forms.withdraw = { to: '', amountEth: '' };
            this.setState({ txPending: false, txSuccess: 'ETH withdrawn.', treasuryBalance: balance });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }

    async _claimPOLFees(instanceAddress) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.claimPOLFees(instanceAddress);
            const balance = await this.treasuryAdapter.getBalance();
            this.setState({ txPending: false, txSuccess: `POL fees claimed for ${instanceAddress}.`, treasuryBalance: balance });
        } catch (err) {
            this.setState({ txPending: false, txError: err.message });
        }
    }
}

export default AdminPage;
