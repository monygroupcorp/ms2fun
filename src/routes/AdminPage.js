import { h, Component } from '@monygroupcorp/microact';
import { Layout } from '../components/Layout/Layout.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import walletService from '../services/WalletService.js';
import serviceFactory from '../services/ServiceFactory.js';

const SECTIONS = ['overview', 'factories', 'vaults', 'instances', 'alignment', 'components', 'governance', 'messages', 'parameters', 'treasury'];
const SECTION_LABELS = {
    overview: 'Overview',
    factories: 'Factories',
    vaults: 'Vaults',
    instances: 'Instances',
    alignment: 'Alignment',
    components: 'Components',
    governance: 'Governance',
    messages: 'Messages',
    parameters: 'Parameters',
    treasury: 'Treasury',
};

function fmtAddr(addr) {
    if (!addr || addr.length < 10) return addr || '—';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmtDuration(seconds) {
    const s = parseInt(seconds) || 0;
    if (s === 0) return '0s';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
}

function fmtWei(wei) {
    if (!wei || wei === '') return '—';
    try { return (parseFloat(wei) / 1e18).toFixed(6) + ' ETH'; } catch { return wei; }
}

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
            totalComponents: 0,
            totalMessages: 0,
            // per-section data
            factories: [],
            vaults: [],
            instances: [],
            alignmentTargets: [],
            editingTargetId: null,
            targetAmbassadors: {},
            components: [],
            recentMessages: [],
            // governance
            governanceMode: '',
            abdicationInitiatedAt: 0,
            abdicationTimelock: 0,
            govSafe: '',
            dictatorAddress: '',
            // parameters
            cleanupReward: '',
            featuredQueueManager: '',
            globalMessageRegistry: '',
            applicationFee: '',
            vaultRegistrationFee: '',
            baseRentalPrice: '',
            demandMultiplier: '',
            maxQueueSize: '',
            maxRentalDuration: '',
            minRentalDuration: '',
            renewalDiscount: '',
            visibleThreshold: '',
            alignmentRegistry: '',
            componentRegistry: '',
            grandCentral: '',
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

        this._forms = {
            factory: { address: '', contractType: '', title: '', displayTitle: '', metadataURI: '' },
            vault: { address: '', vaultType: '', name: '', metadataURI: '' },
            migrateVault: { instance: '', newVault: '' },
            alignmentNew: { title: '', description: '', metadataURI: '', assets: [{ token: '', symbol: '', info: '', metadataURI: '' }] },
            alignmentEdit: { description: '', metadataURI: '' },
            ambassadorAdd: { address: '' },
            approveComponent: { address: '', tag: '', name: '' },
            agentAdd: { address: '' },
            params: { cleanupReward: '', featuredQueueManager: '', globalMessageRegistry: '' },
            setAlignmentRegistry: { address: '' },
            setComponentRegistry: { address: '' },
            setGrandCentral: { address: '' },
            routeToDAO: { safe: '', amountEth: '' },
            setTreasuryRegistry: { address: '' },
            setRevenueConductor: { address: '' },
            withdraw: { to: '', amountEth: '' },
        };

        this.masterAdapter = null;
        this.alignmentAdapter = null;
        this.treasuryAdapter = null;
        this.componentAdapter = null;
    }

    async didMount() {
        await stylesheetLoader.load('/src/core/route-admin-v2.css', 'route:admin');
        await this._initialize();
    }

    async _initialize() {
        try {
            this.masterAdapter = await serviceFactory.getMasterRegistryAdapter();
        } catch (err) {
            this.setState({ loading: false, txError: `Failed to load registry: ${err.message}` });
            return;
        }

        let owner;
        try { owner = await this.masterAdapter.getOwner(); } catch { owner = null; }

        const isMock = this.masterAdapter.isMock;
        const connected = walletService.connectedAddress;

        if (!isMock) {
            if (!owner || !connected || owner.toLowerCase() !== connected.toLowerCase()) {
                this.setState({ loading: false, accessDenied: true });
                return;
            }
        }

        this.setState({ ownerAddress: owner });
        await this._loadOverview();
        this.setState({ loading: false });
    }

    async _loadOverview() {
        try {
            const totalFactories = await this.masterAdapter.getTotalFactories().catch(() => 0);
            const config = this.props.config || {};
            const totalVaults = config.vaults?.length || 0;
            const instances = config.instances || {};
            const totalInstances = (instances.erc404?.length || 0) + (instances.erc1155?.length || 0) + (instances.erc721?.length || 0);
            this.setState({ totalFactories, totalVaults, totalInstances });
        } catch (err) {
            console.error('[AdminPage] overview load error:', err);
        }

        try {
            const compAdapter = await serviceFactory.getComponentRegistryAdapter();
            if (compAdapter) {
                const components = await compAdapter.getAllComponents();
                this.setState({ totalComponents: components.length });
            }
        } catch { /* optional */ }

        try {
            const msgAdapter = await serviceFactory.getMessageRegistryAdapter();
            if (msgAdapter) {
                const count = await msgAdapter.getMessageCount().catch(() => 0);
                this.setState({ totalMessages: parseInt(count.toString()) });
            }
        } catch { /* optional */ }
    }

    async _loadSection(section) {
        if (section === 'factories' && this.state.factories.length === 0) {
            try {
                const nextId = await this.masterAdapter.nextFactoryId();
                const factories = [];
                for (let i = 1; i < nextId; i++) {
                    try { factories.push(await this.masterAdapter.getFactoryInfo(i)); } catch { /* skip */ }
                }
                this.setState({ factories });
            } catch (err) { console.error('[AdminPage] factories load error:', err); }
        }

        if (section === 'vaults' && this.state.vaults.length === 0) {
            try {
                const configVaults = this.props.config?.vaults || [];
                const vaults = await Promise.all(
                    configVaults.map(async v => {
                        const info = await this.masterAdapter.getVaultInfo(v.address).catch(() => null);
                        return { vaultAddress: v.address, name: info?.name || v.name, vaultType: v.vaultType, isActive: info ? info.isActive : true };
                    })
                );
                this.setState({ vaults });
            } catch (err) { console.error('[AdminPage] vaults load error:', err); }
        }

        if (section === 'instances' && this.state.instances.length === 0) {
            const cfg = this.props.config?.instances || {};
            const flat = [
                ...(cfg.erc404 || []).map(i => ({ ...i, type: 'ERC404' })),
                ...(cfg.erc1155 || []).map(i => ({ ...i, type: 'ERC1155' })),
                ...(cfg.erc721 || []).map(i => ({ ...i, type: 'ERC721' })),
            ];
            this.setState({ instances: flat });
        }

        if (section === 'alignment' && this.state.alignmentTargets.length === 0) {
            try {
                this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
                const targets = await this.alignmentAdapter.getAllTargets();
                this.setState({ alignmentTargets: targets });
            } catch (err) { console.error('[AdminPage] alignment load error:', err); }
        }

        if (section === 'components' && this.state.components.length === 0) {
            try {
                this.componentAdapter = await serviceFactory.getComponentRegistryAdapter();
                if (this.componentAdapter) {
                    const components = await this.componentAdapter.getAllComponents();
                    this.setState({ components });
                }
            } catch (err) { console.error('[AdminPage] components load error:', err); }
        }

        if (section === 'governance') {
            try {
                const [initiatedAt, timelock, dictatorAddr] = await Promise.all([
                    this.masterAdapter.abdicationInitiatedAt().catch(() => 0),
                    this.masterAdapter.ABDICATION_TIMELOCK().catch(() => 0),
                    this.masterAdapter.dictator().catch(() => ''),
                ]);
                const gov = this.props.config?.governance || {};
                this.setState({
                    abdicationInitiatedAt: parseInt(initiatedAt.toString()),
                    abdicationTimelock: parseInt(timelock.toString()),
                    dictatorAddress: dictatorAddr,
                    governanceMode: gov.mode || '',
                    govSafe: gov.safe || '',
                });
            } catch (err) { console.error('[AdminPage] governance load error:', err); }
        }

        if (section === 'messages') {
            try {
                const msgAdapter = await serviceFactory.getMessageRegistryAdapter();
                const [count, recentMessages] = await Promise.all([
                    msgAdapter.getMessageCount().catch(() => 0),
                    msgAdapter.getRecentMessages(10).catch(() => []),
                ]);
                this.setState({ totalMessages: parseInt(count.toString()), recentMessages });
            } catch (err) { console.error('[AdminPage] messages load error:', err); }
        }

        if (section === 'parameters') {
            try {
                const [
                    cleanupReward, featuredQueueManager, globalMsgRegistry,
                    applicationFee, vaultRegistrationFee, baseRentalPrice,
                    demandMultiplier, maxQueueSize, maxRentalDuration,
                    minRentalDuration, renewalDiscount, visibleThreshold,
                    alignmentRegistry, componentRegistry, grandCentral,
                ] = await Promise.all([
                    this.masterAdapter.standardCleanupReward().catch(() => ''),
                    this.masterAdapter.featuredQueueManager().catch(() => ''),
                    this.masterAdapter.getGlobalMessageRegistry().catch(() => ''),
                    this.masterAdapter.APPLICATION_FEE().catch(() => ''),
                    this.masterAdapter.vaultRegistrationFee().catch(() => ''),
                    this.masterAdapter.baseRentalPrice().catch(() => ''),
                    this.masterAdapter.demandMultiplier().catch(() => ''),
                    this.masterAdapter.maxQueueSize().catch(() => ''),
                    this.masterAdapter.maxRentalDuration().catch(() => ''),
                    this.masterAdapter.minRentalDuration().catch(() => ''),
                    this.masterAdapter.renewalDiscount().catch(() => ''),
                    this.masterAdapter.visibleThreshold().catch(() => ''),
                    this.masterAdapter.alignmentRegistry().catch(() => ''),
                    this.masterAdapter.componentRegistry().catch(() => ''),
                    this.masterAdapter.grandCentral().catch(() => ''),
                ]);
                this._forms.params = { cleanupReward: cleanupReward?.toString() || '', featuredQueueManager: featuredQueueManager || '', globalMessageRegistry: globalMsgRegistry || '' };
                this._forms.setAlignmentRegistry.address = alignmentRegistry || '';
                this._forms.setComponentRegistry.address = componentRegistry || '';
                this._forms.setGrandCentral.address = grandCentral || '';
                this.setState({
                    cleanupReward: cleanupReward?.toString() || '',
                    featuredQueueManager: featuredQueueManager || '',
                    globalMessageRegistry: globalMsgRegistry || '',
                    applicationFee: applicationFee?.toString() || '',
                    vaultRegistrationFee: vaultRegistrationFee?.toString() || '',
                    baseRentalPrice: baseRentalPrice?.toString() || '',
                    demandMultiplier: demandMultiplier?.toString() || '',
                    maxQueueSize: maxQueueSize?.toString() || '',
                    maxRentalDuration: maxRentalDuration?.toString() || '',
                    minRentalDuration: minRentalDuration?.toString() || '',
                    renewalDiscount: renewalDiscount?.toString() || '',
                    visibleThreshold: visibleThreshold?.toString() || '',
                    alignmentRegistry: alignmentRegistry || '',
                    componentRegistry: componentRegistry || '',
                    grandCentral: grandCentral || '',
                });
            } catch (err) { console.error('[AdminPage] parameters load error:', err); }
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

    // ── Render ────────────────────────────────────────────────────────────────

    render() {
        const { loading, accessDenied, activeSection } = this.state;
        return h(Layout, {
            currentPath: '/admin',
            mode: this.props.mode,
            children: h('div', { className: 'admin-page' },
                loading ? this._renderLoading()
                    : accessDenied ? this._renderLocked()
                        : this._renderPanel()
            )
        });
    }

    _renderLoading() {
        return h('div', { className: 'admin-locked' }, h('span', { className: 'admin-locked-label' }, 'Checking access...'));
    }

    _renderLocked() {
        return h('div', { className: 'admin-locked' }, h('span', { className: 'admin-locked-label' }, 'Not authorized'));
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
            case 'instances': return this._renderInstances();
            case 'alignment': return this._renderAlignment();
            case 'components': return this._renderComponents();
            case 'governance': return this._renderGovernance();
            case 'messages': return this._renderMessages();
            case 'parameters': return this._renderParameters();
            case 'treasury': return this._renderTreasury();
            default: return null;
        }
    }

    // ── Overview ──────────────────────────────────────────────────────────────

    _renderOverview() {
        const { totalFactories, totalVaults, totalInstances, totalComponents, totalMessages, ownerAddress } = this.state;
        const gov = this.props.config?.governance || {};
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Overview'),
            h('p', { className: 'admin-section-subtitle' }, `Owner: ${ownerAddress || '—'}`),
            h('div', { className: 'admin-stats-grid' },
                h('div', { className: 'admin-stat-card' }, h('div', { className: 'admin-stat-label' }, 'Factories'), h('div', { className: 'admin-stat-value' }, totalFactories)),
                h('div', { className: 'admin-stat-card' }, h('div', { className: 'admin-stat-label' }, 'Vaults'), h('div', { className: 'admin-stat-value' }, totalVaults)),
                h('div', { className: 'admin-stat-card' }, h('div', { className: 'admin-stat-label' }, 'Instances'), h('div', { className: 'admin-stat-value' }, totalInstances)),
                h('div', { className: 'admin-stat-card' }, h('div', { className: 'admin-stat-label' }, 'Components'), h('div', { className: 'admin-stat-value' }, totalComponents)),
                h('div', { className: 'admin-stat-card' }, h('div', { className: 'admin-stat-label' }, 'Messages'), h('div', { className: 'admin-stat-value' }, totalMessages)),
            ),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Governance Status'),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Mode'), h('span', { className: 'param-value' }, gov.mode || '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Dictator'), h('span', { className: 'param-value' }, fmtAddr(gov.dictator))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Safe'), h('span', { className: 'param-value' }, fmtAddr(gov.safe))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Abdication'), h('span', { className: 'param-value' }, gov.abdicationInitiated ? 'Initiated' : 'Not initiated')),
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
            factories.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'ID'), h('th', null, 'Type'), h('th', null, 'Title'), h('th', null, 'Address'), h('th', null, 'Status'), h('th', null, '')
                    )),
                    h('tbody', null,
                        ...factories.map(fac =>
                            h('tr', { key: fac.factoryAddress },
                                h('td', null, fac.factoryId?.toString() || '—'),
                                h('td', null, fac.contractType || '—'),
                                h('td', null, fac.displayTitle || fac.title),
                                h('td', { className: 'addr' }, fmtAddr(fac.factoryAddress)),
                                h('td', null, h('span', { className: `admin-badge ${fac.isActive !== false ? 'active' : 'inactive'}` }, fac.isActive !== false ? 'active' : 'inactive')),
                                h('td', null,
                                    fac.isActive !== false
                                        ? h('button', { className: 'admin-btn admin-btn-sm danger', disabled: this.state.txPending, onClick: () => this._deactivateFactory(fac.factoryAddress) }, 'Deactivate')
                                        : null
                                )
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No factories registered.'),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Factory'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Address'), h('input', { type: 'text', placeholder: '0x...', value: f.address, onInput: e => { f.address = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Contract Type'), h('input', { type: 'text', placeholder: 'ERC404', value: f.contractType, onInput: e => { f.contractType = e.target.value; } }))
                ),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Title'), h('input', { type: 'text', value: f.title, onInput: e => { f.title = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Display Title'), h('input', { type: 'text', value: f.displayTitle, onInput: e => { f.displayTitle = e.target.value; } }))
                ),
                h('div', { className: 'admin-field' }, h('label', null, 'Metadata URI'), h('input', { type: 'text', placeholder: 'ipfs://...', value: f.metadataURI, onInput: e => { f.metadataURI = e.target.value; } })),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._registerFactory() }, 'Register Factory')
            )
        );
    }

    // ── Vaults ────────────────────────────────────────────────────────────────

    _renderVaults() {
        const { vaults } = this.state;
        const v = this._forms.vault;
        const mv = this._forms.migrateVault;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Vaults'),
            h('p', { className: 'admin-section-subtitle' }, 'Approved alignment vaults'),
            vaults.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'Name'), h('th', null, 'Type'), h('th', null, 'Status'), h('th', null, 'Address'), h('th', null, '')
                    )),
                    h('tbody', null,
                        ...vaults.map(vault =>
                            h('tr', { key: vault.vaultAddress },
                                h('td', null, vault.name),
                                h('td', null, vault.vaultType),
                                h('td', null, h('span', { className: `admin-badge ${vault.isActive ? 'active' : 'inactive'}` }, vault.isActive ? 'active' : 'inactive')),
                                h('td', { className: 'addr' }, fmtAddr(vault.vaultAddress)),
                                h('td', null,
                                    vault.isActive
                                        ? h('button', { className: 'admin-btn admin-btn-sm danger', disabled: this.state.txPending, onClick: () => this._deactivateVault(vault.vaultAddress) }, 'Deactivate')
                                        : null
                                )
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No vaults registered.'),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Vault'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Address'), h('input', { type: 'text', placeholder: '0x...', value: v.address, onInput: e => { v.address = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Vault Type'), h('input', { type: 'text', placeholder: 'UNIv4 / CYPHER / ZAMM', value: v.vaultType, onInput: e => { v.vaultType = e.target.value; } }))
                ),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Name'), h('input', { type: 'text', value: v.name, onInput: e => { v.name = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Metadata URI'), h('input', { type: 'text', placeholder: 'ipfs://...', value: v.metadataURI, onInput: e => { v.metadataURI = e.target.value; } }))
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._registerVault() }, 'Register Vault')
            ),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Migrate Vault'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Instance Address'), h('input', { type: 'text', placeholder: '0x...', value: mv.instance, onInput: e => { mv.instance = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'New Vault Address'), h('input', { type: 'text', placeholder: '0x...', value: mv.newVault, onInput: e => { mv.newVault = e.target.value; } }))
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._migrateVault() }, 'Migrate Vault')
            )
        );
    }

    // ── Instances ─────────────────────────────────────────────────────────────

    _renderInstances() {
        const { instances } = this.state;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Instances'),
            h('p', { className: 'admin-section-subtitle' }, 'All registered instances by type'),
            instances.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'Type'), h('th', null, 'Name'), h('th', null, 'Address'), h('th', null, 'Vault'), h('th', null, 'Creator'), h('th', null, 'State')
                    )),
                    h('tbody', null,
                        ...instances.map(inst =>
                            h('tr', { key: inst.address },
                                h('td', null, h('span', { className: 'admin-badge active' }, inst.type)),
                                h('td', null, inst.name || '—'),
                                h('td', { className: 'addr' }, fmtAddr(inst.address)),
                                h('td', { className: 'addr' }, fmtAddr(inst.vault)),
                                h('td', { className: 'addr' }, fmtAddr(inst.creator)),
                                h('td', null, inst.state ? h('span', { className: `admin-badge ${inst.state === 'active' ? 'active' : 'inactive'}` }, inst.state) : '—')
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No instances found in config.')
        );
    }

    // ── Alignment ─────────────────────────────────────────────────────────────

    _renderAlignment() {
        const { alignmentTargets, editingTargetId, targetAmbassadors, txPending } = this.state;
        const n = this._forms.alignmentNew;
        const ed = this._forms.alignmentEdit;
        const amb = this._forms.ambassadorAdd;
        const editing = editingTargetId !== null ? alignmentTargets.find(t => t.id === editingTargetId) : null;
        const ambassadors = editingTargetId !== null ? (targetAmbassadors[editingTargetId] || []) : [];

        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Alignment Targets'),
            h('p', { className: 'admin-section-subtitle' }, 'Registered alignment targets — click Edit to update metadata or manage ambassadors'),

            // ── Target list ──
            alignmentTargets.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'ID'),
                        h('th', null, 'Title'),
                        h('th', null, 'Assets'),
                        h('th', null, 'Status'),
                        h('th', null, '')
                    )),
                    h('tbody', null,
                        ...alignmentTargets.map(t => [
                            h('tr', { key: t.id, style: editingTargetId === t.id ? { background: 'var(--bg-secondary)' } : {} },
                                h('td', null, t.id),
                                h('td', null, t.title),
                                h('td', null, (t.assets || []).map(a => a.symbol || fmtAddr(a.token)).join(', ') || '—'),
                                h('td', null, h('span', { className: `admin-badge ${t.active ? 'active' : 'inactive'}` }, t.active ? 'active' : 'inactive')),
                                h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
                                    editingTargetId === t.id
                                        ? h('button', { className: 'admin-btn admin-btn-sm', onClick: () => this.setState({ editingTargetId: null }) }, 'Close')
                                        : h('button', { className: 'admin-btn admin-btn-sm', onClick: () => this._openEditTarget(t) }, 'Edit')
                                )
                            ),
                            // ── Inline edit panel ──
                            editingTargetId === t.id && editing ? h('tr', { key: `edit-${t.id}` },
                                h('td', { colSpan: 5, style: { padding: 0 } },
                                    h('div', { className: 'admin-target-edit-panel' },

                                        // Editable metadata
                                        h('div', { className: 'admin-form', style: { marginBottom: 'var(--space-6)' } },
                                            h('div', { className: 'admin-form-title' }, `Edit Metadata — "${editing.title}"`),
                                            h('p', { style: { fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', fontFamily: 'var(--font-mono)' } },
                                                'Title and assets are set at registration and cannot be changed.'
                                            ),
                                            h('div', { className: 'admin-field' },
                                                h('label', null, 'Description'),
                                                h('textarea', { value: ed.description, onInput: e => { ed.description = e.target.value; } })
                                            ),
                                            h('div', { className: 'admin-field' },
                                                h('label', null, 'Metadata URI'),
                                                h('input', { type: 'text', placeholder: 'ipfs://...', value: ed.metadataURI, onInput: e => { ed.metadataURI = e.target.value; } })
                                            ),
                                            h('div', { style: { display: 'flex', gap: 'var(--space-3)', alignItems: 'center' } },
                                                h('button', { className: 'admin-btn', disabled: txPending, onClick: () => this._updateTarget(editing.id) }, 'Update Metadata'),
                                                editing.active
                                                    ? h('button', { className: 'admin-btn danger', disabled: txPending, onClick: () => this._deactivateTarget(editing.id) }, 'Deactivate Target')
                                                    : null
                                            )
                                        ),

                                        // Read-only assets
                                        h('div', { className: 'admin-form', style: { marginBottom: 'var(--space-6)' } },
                                            h('div', { className: 'admin-form-title' }, 'Assets (immutable)'),
                                            (editing.assets || []).length > 0
                                                ? h('table', { className: 'admin-table' },
                                                    h('thead', null, h('tr', null, h('th', null, 'Token'), h('th', null, 'Symbol'), h('th', null, 'Info'))),
                                                    h('tbody', null,
                                                        ...(editing.assets || []).map((a, i) =>
                                                            h('tr', { key: i },
                                                                h('td', { className: 'addr' }, fmtAddr(a.token)),
                                                                h('td', null, a.symbol),
                                                                h('td', null, a.info || '—')
                                                            )
                                                        )
                                                    )
                                                )
                                                : h('p', { style: { color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' } }, 'No assets.')
                                        ),

                                        // Ambassadors
                                        h('div', { className: 'admin-form' },
                                            h('div', { className: 'admin-form-title' }, 'Ambassadors'),
                                            ambassadors.length > 0
                                                ? h('table', { className: 'admin-table', style: { marginBottom: 'var(--space-4)' } },
                                                    h('thead', null, h('tr', null, h('th', null, 'Address'), h('th', null, ''))),
                                                    h('tbody', null,
                                                        ...ambassadors.map(addr =>
                                                            h('tr', { key: addr },
                                                                h('td', { className: 'addr' }, addr),
                                                                h('td', { style: { textAlign: 'right' } },
                                                                    h('button', { className: 'admin-btn admin-btn-sm danger', disabled: txPending, onClick: () => this._removeAmbassador(editing.id, addr) }, 'Remove')
                                                                )
                                                            )
                                                        )
                                                    )
                                                )
                                                : h('p', { style: { color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-4)' } }, 'No ambassadors.'),
                                            h('div', { style: { display: 'flex', gap: 'var(--space-3)' } },
                                                h('input', { type: 'text', placeholder: '0x ambassador address', value: amb.address, style: { flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-2) var(--space-3)' }, onInput: e => { amb.address = e.target.value; } }),
                                                h('button', { className: 'admin-btn', disabled: txPending, onClick: () => this._addAmbassador(editing.id) }, 'Add Ambassador')
                                            )
                                        )
                                    )
                                )
                            ) : null,
                        ].filter(Boolean))
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No alignment targets registered.'),

            // ── Register form ──
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Register Alignment Target'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Title'), h('input', { type: 'text', value: n.title, onInput: e => { n.title = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Metadata URI'), h('input', { type: 'text', placeholder: 'ipfs://...', value: n.metadataURI, onInput: e => { n.metadataURI = e.target.value; } }))
                ),
                h('div', { className: 'admin-field' }, h('label', null, 'Description'), h('textarea', { value: n.description, onInput: e => { n.description = e.target.value; } })),
                h('div', { className: 'admin-form-title' }, 'Assets'),
                h('p', { style: { fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)', fontFamily: 'var(--font-mono)' } }, 'At least one asset required. Assets cannot be changed after registration.'),
                h('div', { className: 'admin-asset-list' },
                    ...n.assets.map((asset, i) =>
                        h('div', { className: 'admin-asset-item', key: i },
                            h('div', { className: 'admin-field' }, h('label', null, 'Token'), h('input', { type: 'text', placeholder: '0x...', value: asset.token, onInput: e => { n.assets[i].token = e.target.value; } })),
                            h('div', { className: 'admin-field' }, h('label', null, 'Symbol'), h('input', { type: 'text', placeholder: 'ETH', value: asset.symbol, onInput: e => { n.assets[i].symbol = e.target.value; } })),
                            h('div', { className: 'admin-field' }, h('label', null, 'Info'), h('input', { type: 'text', value: asset.info, onInput: e => { n.assets[i].info = e.target.value; } })),
                            n.assets.length > 1
                                ? h('button', { className: 'admin-btn admin-btn-sm danger', style: { marginTop: '22px' }, onClick: () => { n.assets.splice(i, 1); this.setState({}); } }, '✕')
                                : h('div', null)
                        )
                    )
                ),
                h('button', { className: 'admin-btn admin-btn-sm', style: { marginBottom: 'var(--space-4)' }, onClick: () => { n.assets.push({ token: '', symbol: '', info: '', metadataURI: '' }); this.setState({}); } }, '+ Add Asset'),
                h('br', null),
                h('button', { className: 'admin-btn', disabled: txPending, onClick: () => this._registerTarget() }, 'Register Target')
            )
        );
    }

    // ── Components ────────────────────────────────────────────────────────────

    _renderComponents() {
        const { components } = this.state;
        const ac = this._forms.approveComponent;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Components'),
            h('p', { className: 'admin-section-subtitle' }, 'DAO-approved component implementations'),
            components.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'Name'), h('th', null, 'Tag'), h('th', null, 'Address'), h('th', null, '')
                    )),
                    h('tbody', null,
                        ...components.map(c =>
                            h('tr', { key: c.address },
                                h('td', null, c.name),
                                h('td', { className: 'addr' }, c.tag ? c.tag.slice(0, 10) + '…' : '—'),
                                h('td', { className: 'addr' }, fmtAddr(c.address)),
                                h('td', null,
                                    h('button', { className: 'admin-btn admin-btn-sm danger', disabled: this.state.txPending, onClick: () => this._revokeComponent(c.address) }, 'Revoke')
                                )
                            )
                        )
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No approved components.'),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Approve Component'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Component Address'), h('input', { type: 'text', placeholder: '0x...', value: ac.address, onInput: e => { ac.address = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Name'), h('input', { type: 'text', value: ac.name, onInput: e => { ac.name = e.target.value; } }))
                ),
                h('div', { className: 'admin-field' }, h('label', null, 'Tag Hash (bytes32)'), h('input', { type: 'text', placeholder: '0x...', value: ac.tag, onInput: e => { ac.tag = e.target.value; } })),
                h('div', { className: 'admin-notice' }, 'Tag must be a bytes32 hex string, e.g. keccak256("gating") or keccak256("liquidity")'),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._approveComponent() }, 'Approve')
            )
        );
    }

    // ── Governance ────────────────────────────────────────────────────────────

    _renderGovernance() {
        const { governanceMode, abdicationInitiatedAt, abdicationTimelock, govSafe, dictatorAddress } = this.state;
        const now = Math.floor(Date.now() / 1000);
        const timeRemaining = abdicationInitiatedAt > 0 ? Math.max(0, (abdicationInitiatedAt + abdicationTimelock) - now) : 0;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Governance'),
            h('p', { className: 'admin-section-subtitle' }, 'Protocol ownership and abdication lifecycle'),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Governance Status'),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Dictator'), h('span', { className: 'param-value' }, dictatorAddress ? fmtAddr(dictatorAddress) : '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Mode'), h('span', { className: 'param-value' }, governanceMode || '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Safe'), h('span', { className: 'param-value' }, govSafe ? fmtAddr(govSafe) : '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Timelock'), h('span', { className: 'param-value' }, fmtDuration(abdicationTimelock))),
                h('div', { className: 'admin-param-row' },
                    h('span', { className: 'param-label' }, 'Abdication initiated'),
                    h('span', { className: 'param-value' }, abdicationInitiatedAt > 0 ? new Date(abdicationInitiatedAt * 1000).toLocaleString() : 'None')
                ),
                abdicationInitiatedAt > 0
                    ? h('div', { className: 'admin-param-row' },
                        h('span', { className: 'param-label' }, 'Time remaining'),
                        h('span', { className: 'param-value' }, fmtDuration(timeRemaining))
                    )
                    : null
            ),
            abdicationInitiatedAt === 0
                ? h('div', { className: 'admin-form' },
                    h('div', { className: 'admin-form-title' }, 'Initiate Abdication'),
                    h('div', { className: 'admin-notice' }, `Starts the ${fmtDuration(abdicationTimelock)} timelock. Transfers control to governance safe after timelock expires.`),
                    h('button', { className: 'admin-btn danger', disabled: this.state.txPending, onClick: () => this._initiateAbdication() }, 'Initiate Abdication')
                )
                : h('div', null,
                    h('div', { className: 'admin-form' },
                        h('div', { className: 'admin-form-title' }, 'Cancel Abdication'),
                        h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._cancelAbdication() }, 'Cancel Abdication')
                    ),
                    h('div', { className: 'admin-form' },
                        h('div', { className: 'admin-form-title' }, 'Finalize Abdication'),
                        h('div', { className: 'admin-notice' }, 'Irreversible. Permanently transfers protocol control to the governance safe.'),
                        h('button', { className: 'admin-btn danger', disabled: this.state.txPending || timeRemaining > 0, onClick: () => this._finalizeAbdication() },
                            timeRemaining > 0 ? `Locked (${fmtDuration(timeRemaining)} remaining)` : 'Finalize Abdication'
                        )
                    )
                )
        );
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    _renderMessages() {
        const { totalMessages, recentMessages } = this.state;
        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Messages'),
            h('p', { className: 'admin-section-subtitle' }, `Total messages: ${totalMessages}`),
            recentMessages.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null,
                        h('th', null, 'ID'), h('th', null, 'Instance'), h('th', null, 'Type'), h('th', null, 'Content')
                    )),
                    h('tbody', null,
                        ...recentMessages.map((msg, i) => {
                            const content = msg.message || msg.content || msg.packedData || '';
                            return h('tr', { key: msg.id || i },
                                h('td', null, msg.id?.toString() || i),
                                h('td', { className: 'addr' }, fmtAddr(msg.instance || msg.instanceAddress)),
                                h('td', null, msg.messageType?.toString() || msg.type?.toString() || '—'),
                                h('td', null, content.length > 60 ? content.slice(0, 60) + '…' : content)
                            );
                        })
                    )
                )
                : h('p', { className: 'admin-section-subtitle' }, 'No messages found.')
        );
    }

    // ── Parameters ────────────────────────────────────────────────────────────

    _renderParameters() {
        const s = this.state;
        const p = this._forms.params;
        const testAccounts = this.props.config?.testAccounts || {};
        const agentRows = Object.entries(testAccounts).map(([role, addr]) => ({ role, addr }));

        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Parameters'),
            h('p', { className: 'admin-section-subtitle' }, 'Protocol configuration'),

            // A — Fees
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Fees'),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Application Fee'), h('span', { className: 'param-value' }, fmtWei(s.applicationFee))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Vault Registration Fee'), h('span', { className: 'param-value' }, fmtWei(s.vaultRegistrationFee))),
                h('div', { className: 'admin-field', style: { marginTop: 'var(--space-4)' } },
                    h('label', null, 'Standard Cleanup Reward (wei)'),
                    h('input', { type: 'text', value: s.cleanupReward, onInput: e => { p.cleanupReward = e.target.value; this.setState({ cleanupReward: e.target.value }); } })
                ),
                h('button', { className: 'admin-btn', disabled: s.txPending, onClick: () => this._setCleanupReward() }, 'Update Cleanup Reward')
            ),

            // B — Queue
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Featured Queue'),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Base Rental Price'), h('span', { className: 'param-value' }, fmtWei(s.baseRentalPrice))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Max Queue Size'), h('span', { className: 'param-value' }, s.maxQueueSize || '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Max Rental Duration'), h('span', { className: 'param-value' }, fmtDuration(s.maxRentalDuration))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Min Rental Duration'), h('span', { className: 'param-value' }, fmtDuration(s.minRentalDuration))),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Renewal Discount'), h('span', { className: 'param-value' }, s.renewalDiscount ? s.renewalDiscount + ' bps' : '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Visible Threshold'), h('span', { className: 'param-value' }, s.visibleThreshold || '—')),
                h('div', { className: 'admin-param-row' }, h('span', { className: 'param-label' }, 'Demand Multiplier'), h('span', { className: 'param-value' }, s.demandMultiplier || '—'))
            ),

            // C — Registry Addresses
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Registry Addresses'),
                ...this._registryAddressField('Featured Queue Manager', s.featuredQueueManager, v => { p.featuredQueueManager = v; this.setState({ featuredQueueManager: v }); }, () => this._setFeaturedQueueManager()),
                ...this._registryAddressField('Global Message Registry', s.globalMessageRegistry, v => { p.globalMessageRegistry = v; this.setState({ globalMessageRegistry: v }); }, () => this._setGlobalMessageRegistry()),
                ...this._registryAddressField('Alignment Registry', s.alignmentRegistry, v => { this._forms.setAlignmentRegistry.address = v; this.setState({ alignmentRegistry: v }); }, () => this._setAlignmentRegistry()),
                ...this._registryAddressField('Component Registry', s.componentRegistry, v => { this._forms.setComponentRegistry.address = v; this.setState({ componentRegistry: v }); }, () => this._setComponentRegistry()),
                ...this._registryAddressField('Grand Central', s.grandCentral, v => { this._forms.setGrandCentral.address = v; this.setState({ grandCentral: v }); }, () => this._setGrandCentral()),
            ),

            // D — Agents
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Agents'),
                agentRows.length > 0
                    ? h('table', { className: 'admin-table' },
                        h('thead', null, h('tr', null, h('th', null, 'Role'), h('th', null, 'Address'), h('th', null, ''))),
                        h('tbody', null,
                            ...agentRows.map(({ role, addr }) =>
                                h('tr', { key: role },
                                    h('td', null, role),
                                    h('td', { className: 'addr' }, fmtAddr(addr)),
                                    h('td', null, h('button', { className: 'admin-btn admin-btn-sm danger', disabled: s.txPending, onClick: () => this._revokeAgent(addr) }, 'Revoke'))
                                )
                            )
                        )
                    )
                    : null,
                h('div', { className: 'admin-form-row', style: { marginTop: 'var(--space-4)' } },
                    h('div', { className: 'admin-field' },
                        h('label', null, 'Grant Agent Address'),
                        h('input', { type: 'text', placeholder: '0x...', value: this._forms.agentAdd.address, onInput: e => { this._forms.agentAdd.address = e.target.value; } })
                    ),
                    h('div', { className: 'admin-field', style: { display: 'flex', alignItems: 'flex-end' } },
                        h('button', { className: 'admin-btn', disabled: s.txPending, onClick: () => this._setAgent(this._forms.agentAdd.address, true) }, 'Grant Agent')
                    )
                )
            )
        );
    }

    _registryAddressField(label, value, onInput, onUpdate) {
        return [
            h('div', { className: 'admin-form-row', style: { marginBottom: 'var(--space-3)' } },
                h('div', { className: 'admin-field' },
                    h('label', null, label),
                    h('input', { type: 'text', placeholder: '0x...', value: value, onInput: e => onInput(e.target.value) })
                ),
                h('div', { className: 'admin-field', style: { display: 'flex', alignItems: 'flex-end' } },
                    h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: onUpdate }, 'Update')
                )
            )
        ];
    }

    // ── Treasury ──────────────────────────────────────────────────────────────

    _renderTreasury() {
        const { treasuryDeployed, treasuryBalance, revenueSources, polInstances } = this.state;
        const w = this._forms.withdraw;
        const r = this._forms.routeToDAO;
        const tr = this._forms.setTreasuryRegistry;
        const rc = this._forms.setRevenueConductor;

        if (!treasuryDeployed) {
            return h('div', null,
                h('h2', { className: 'admin-section-title' }, 'Treasury'),
                h('div', { className: 'admin-notice' }, 'ProtocolTreasuryV1 not deployed.')
            );
        }

        return h('div', null,
            h('h2', { className: 'admin-section-title' }, 'Treasury'),
            h('p', { className: 'admin-section-subtitle' }, `Balance: ${fmtWei(treasuryBalance)}`),
            revenueSources.length > 0
                ? h('table', { className: 'admin-table' },
                    h('thead', null, h('tr', null, h('th', null, 'Source'), h('th', null, 'Received'), h('th', null, 'Withdrawn'))),
                    h('tbody', null,
                        ...revenueSources.map(s =>
                            h('tr', { key: s.key }, h('td', null, s.label), h('td', null, fmtWei(s.received)), h('td', null, fmtWei(s.withdrawn)))
                        )
                    )
                )
                : null,
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Withdraw ETH'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Recipient'), h('input', { type: 'text', placeholder: '0x...', value: w.to, onInput: e => { w.to = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Amount (ETH)'), h('input', { type: 'text', placeholder: '0.0', value: w.amountEth, onInput: e => { w.amountEth = e.target.value; } }))
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._withdrawETH() }, 'Withdraw ETH')
            ),
            polInstances.length > 0
                ? h('div', null,
                    h('div', { className: 'admin-form-title', style: { padding: '0 0 var(--space-3)' } }, 'POL Positions'),
                    h('table', { className: 'admin-table' },
                        h('thead', null, h('tr', null, h('th', null, 'Instance'), h('th', null, 'Liquidity'), h('th', null, ''))),
                        h('tbody', null,
                            ...polInstances.map(pos =>
                                h('tr', { key: pos.address },
                                    h('td', { className: 'addr' }, pos.address),
                                    h('td', null, pos.liquidity),
                                    h('td', null, h('button', { className: 'admin-btn admin-btn-sm', disabled: this.state.txPending, onClick: () => this._claimPOLFees(pos.address) }, 'Claim Fees'))
                                )
                            )
                        )
                    )
                )
                : null,
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Route to DAO'),
                h('div', { className: 'admin-form-row' },
                    h('div', { className: 'admin-field' }, h('label', null, 'Safe Address'), h('input', { type: 'text', placeholder: '0x...', value: r.safe, onInput: e => { r.safe = e.target.value; } })),
                    h('div', { className: 'admin-field' }, h('label', null, 'Amount (ETH)'), h('input', { type: 'text', placeholder: '0.0', value: r.amountEth, onInput: e => { r.amountEth = e.target.value; } }))
                ),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._routeToDAO() }, 'Route to DAO')
            ),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Set Master Registry'),
                h('div', { className: 'admin-field' }, h('label', null, 'Registry Address'), h('input', { type: 'text', placeholder: '0x...', value: tr.address, onInput: e => { tr.address = e.target.value; } })),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._setTreasuryMasterRegistry() }, 'Update')
            ),
            h('div', { className: 'admin-form' },
                h('div', { className: 'admin-form-title' }, 'Set Revenue Conductor'),
                h('div', { className: 'admin-field' }, h('label', null, 'Conductor Address'), h('input', { type: 'text', placeholder: '0x...', value: rc.address, onInput: e => { rc.address = e.target.value; } })),
                h('button', { className: 'admin-btn', disabled: this.state.txPending, onClick: () => this._setRevenueConductor() }, 'Update')
            )
        );
    }

    // ── Transaction Handlers ──────────────────────────────────────────────────

    async _registerFactory() {
        const f = this._forms.factory;
        if (!f.address || !f.contractType || !f.title || !f.displayTitle) { this.setState({ txError: 'All fields required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.registerFactory(f.address, f.contractType, f.title, f.displayTitle, f.metadataURI || '');
            this._forms.factory = { address: '', contractType: '', title: '', displayTitle: '', metadataURI: '' };
            const nextId = await this.masterAdapter.nextFactoryId();
            const factories = [];
            for (let i = 1; i < nextId; i++) { try { factories.push(await this.masterAdapter.getFactoryInfo(i)); } catch { } }
            this.setState({ txPending: false, txSuccess: 'Factory registered.', factories, totalFactories: factories.length });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _deactivateFactory(factoryAddress) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.deactivateFactory(factoryAddress);
            this.setState({ factories: [] });
            await this._loadSection('factories');
            this.setState({ txPending: false, txSuccess: 'Factory deactivated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _registerVault() {
        const v = this._forms.vault;
        if (!v.address || !v.vaultType || !v.name) { this.setState({ txError: 'Address, type, and name required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.registerApprovedVault(v.address, v.vaultType, v.name, v.metadataURI || '');
            this._forms.vault = { address: '', vaultType: '', name: '', metadataURI: '' };
            this.setState({ vaults: [] });
            await this._loadSection('vaults');
            this.setState({ txPending: false, txSuccess: 'Vault registered.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _deactivateVault(vaultAddress) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.deactivateVault(vaultAddress);
            this.setState({ vaults: [] });
            await this._loadSection('vaults');
            this.setState({ txPending: false, txSuccess: 'Vault deactivated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _migrateVault() {
        const mv = this._forms.migrateVault;
        if (!mv.instance || !mv.newVault) { this.setState({ txError: 'Instance and new vault address required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.migrateVault(mv.instance, mv.newVault);
            this._forms.migrateVault = { instance: '', newVault: '' };
            this.setState({ txPending: false, txSuccess: 'Vault migrated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _openEditTarget(target) {
        this._forms.alignmentEdit.description = target.description || '';
        this._forms.alignmentEdit.metadataURI = target.metadataURI || '';
        this._forms.ambassadorAdd.address = '';
        this.setState({ editingTargetId: target.id, txError: null, txSuccess: null });
        // load ambassadors if not cached
        if (!this.state.targetAmbassadors[target.id]) {
            try {
                if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
                const ambassadors = await this.alignmentAdapter.getAmbassadors(target.id);
                this.setState({ targetAmbassadors: { ...this.state.targetAmbassadors, [target.id]: ambassadors } });
            } catch (err) {
                console.error('[AdminPage] failed to load ambassadors:', err);
                this.setState({ targetAmbassadors: { ...this.state.targetAmbassadors, [target.id]: [] } });
            }
        }
    }

    async _updateTarget(targetId) {
        const ed = this._forms.alignmentEdit;
        if (!ed.description) { this.setState({ txError: 'Description is required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            await this.alignmentAdapter.updateAlignmentTarget(targetId, ed.description, ed.metadataURI || '');
            const targets = await this.alignmentAdapter.getAllTargets();
            this.setState({ txPending: false, txSuccess: 'Target updated.', alignmentTargets: targets });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _addAmbassador(targetId) {
        const addr = this._forms.ambassadorAdd.address.trim();
        if (!addr) { this.setState({ txError: 'Ambassador address required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            await this.alignmentAdapter.addAmbassador(targetId, addr);
            this._forms.ambassadorAdd.address = '';
            const ambassadors = await this.alignmentAdapter.getAmbassadors(targetId);
            const updated = { ...this.state.targetAmbassadors, [targetId]: ambassadors };
            this.setState({ txPending: false, txSuccess: 'Ambassador added.', targetAmbassadors: updated });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _removeAmbassador(targetId, address) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            await this.alignmentAdapter.removeAmbassador(targetId, address);
            const ambassadors = await this.alignmentAdapter.getAmbassadors(targetId);
            const updated = { ...this.state.targetAmbassadors, [targetId]: ambassadors };
            this.setState({ txPending: false, txSuccess: 'Ambassador removed.', targetAmbassadors: updated });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _registerTarget() {
        const n = this._forms.alignmentNew;
        if (!n.title || !n.description || !n.assets[0]?.token) { this.setState({ txError: 'Title, description, and at least one asset required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            await this.alignmentAdapter.registerAlignmentTarget(n.title, n.description, n.metadataURI || '', n.assets);
            this._forms.alignmentNew = { title: '', description: '', metadataURI: '', assets: [{ token: '', symbol: '', info: '', metadataURI: '' }] };
            const targets = await this.alignmentAdapter.getAllTargets();
            this.setState({ txPending: false, txSuccess: 'Alignment target registered.', alignmentTargets: targets });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _deactivateTarget(targetId) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.alignmentAdapter) this.alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter();
            await this.alignmentAdapter.deactivateAlignmentTarget(targetId);
            const targets = await this.alignmentAdapter.getAllTargets();
            this.setState({ txPending: false, txSuccess: 'Target deactivated.', alignmentTargets: targets });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _approveComponent() {
        const ac = this._forms.approveComponent;
        if (!ac.address || !ac.tag || !ac.name) { this.setState({ txError: 'Address, tag hash, and name required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.componentAdapter) this.componentAdapter = await serviceFactory.getComponentRegistryAdapter();
            await this.componentAdapter.approveComponent(ac.address, ac.tag, ac.name);
            this._forms.approveComponent = { address: '', tag: '', name: '' };
            this.setState({ components: [] });
            await this._loadSection('components');
            this.setState({ txPending: false, txSuccess: 'Component approved.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _revokeComponent(address) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            if (!this.componentAdapter) this.componentAdapter = await serviceFactory.getComponentRegistryAdapter();
            await this.componentAdapter.revokeComponent(address);
            this.setState({ components: [] });
            await this._loadSection('components');
            this.setState({ txPending: false, txSuccess: 'Component revoked.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _initiateAbdication() {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.initiateAbdication();
            this.setState({ abdicationInitiatedAt: 0 }); // force reload
            await this._loadSection('governance');
            this.setState({ txPending: false, txSuccess: 'Abdication initiated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _cancelAbdication() {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.cancelAbdication();
            this.setState({ abdicationInitiatedAt: 0 });
            await this._loadSection('governance');
            this.setState({ txPending: false, txSuccess: 'Abdication cancelled.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _finalizeAbdication() {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.finalizeAbdication();
            this.setState({ abdicationInitiatedAt: 0 });
            await this._loadSection('governance');
            this.setState({ txPending: false, txSuccess: 'Abdication finalized.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setAgent(address, authorized) {
        if (!address) { this.setState({ txError: 'Address required.' }); return; }
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setAgent(address, authorized);
            this._forms.agentAdd.address = '';
            this.setState({ txPending: false, txSuccess: `Agent ${authorized ? 'granted' : 'revoked'}.` });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _revokeAgent(address) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.revokeAgent(address);
            this.setState({ txPending: false, txSuccess: 'Agent revoked.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setCleanupReward() {
        const val = this._forms.params.cleanupReward;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setStandardCleanupReward(val);
            this.setState({ txPending: false, txSuccess: 'Cleanup reward updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setFeaturedQueueManager() {
        const val = this._forms.params.featuredQueueManager;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setFeaturedQueueManager(val);
            this.setState({ txPending: false, txSuccess: 'Featured queue manager updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setGlobalMessageRegistry() {
        const val = this._forms.params.globalMessageRegistry;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setGlobalMessageRegistry(val);
            this.setState({ txPending: false, txSuccess: 'Global message registry updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setAlignmentRegistry() {
        const val = this._forms.setAlignmentRegistry.address;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setAlignmentRegistry(val);
            this.setState({ txPending: false, txSuccess: 'Alignment registry updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setComponentRegistry() {
        const val = this._forms.setComponentRegistry.address;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setComponentRegistry(val);
            this.setState({ txPending: false, txSuccess: 'Component registry updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setGrandCentral() {
        const val = this._forms.setGrandCentral.address;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.masterAdapter.setGrandCentral(val);
            this.setState({ txPending: false, txSuccess: 'Grand central updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _withdrawETH() {
        const w = this._forms.withdraw;
        if (!w.to || !w.amountEth) { this.setState({ txError: 'Recipient and amount required.' }); return; }
        const amountWei = (parseFloat(w.amountEth) * 1e18).toFixed(0);
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.withdrawETH(w.to, amountWei);
            const balance = await this.treasuryAdapter.getBalance();
            this._forms.withdraw = { to: '', amountEth: '' };
            this.setState({ txPending: false, txSuccess: 'ETH withdrawn.', treasuryBalance: balance });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _claimPOLFees(instanceAddress) {
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.claimPOLFees(instanceAddress);
            const balance = await this.treasuryAdapter.getBalance();
            this.setState({ txPending: false, txSuccess: `POL fees claimed.`, treasuryBalance: balance });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _routeToDAO() {
        const r = this._forms.routeToDAO;
        if (!r.safe || !r.amountEth) { this.setState({ txError: 'Safe address and amount required.' }); return; }
        const amountWei = (parseFloat(r.amountEth) * 1e18).toFixed(0);
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.routeToDAO(r.safe, amountWei);
            this._forms.routeToDAO = { safe: '', amountEth: '' };
            this.setState({ txPending: false, txSuccess: 'Routed to DAO.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setTreasuryMasterRegistry() {
        const val = this._forms.setTreasuryRegistry.address;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.setMasterRegistry(val);
            this.setState({ txPending: false, txSuccess: 'Treasury master registry updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }

    async _setRevenueConductor() {
        const val = this._forms.setRevenueConductor.address;
        if (!val) return;
        this.setState({ txPending: true, txError: null, txSuccess: null });
        try {
            await this.treasuryAdapter.setRevenueConductor(val);
            this.setState({ txPending: false, txSuccess: 'Revenue conductor updated.' });
        } catch (err) { this.setState({ txPending: false, txError: err.message }); }
    }
}

export default AdminPage;
