/**
 * ProjectCreationPage - Data-driven creation wizard
 *
 * Steps are dynamically generated from on-chain registries:
 *   1. Factory selection (from MasterRegistryV1)
 *   2..N Component selection (from factory.features() ∩ ComponentRegistry)
 *   N+1. Configure (project details + free mint)
 *   N+2. Preview
 *   N+3. Vault selection (from MasterRegistryV1)
 *   N+4. Deploy
 */

import { Component } from '../core/Component.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';

// Step type constants
const STEP_FACTORY = 'factory';
const STEP_COMPONENT = 'component';
const STEP_CONFIGURE = 'configure';
const STEP_PREVIEW = 'preview';
const STEP_VAULT = 'vault';
const STEP_DEPLOY = 'deploy';

export default class ProjectCreationPage extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            // Wizard navigation
            currentStepIndex: 0,
            steps: [{ type: STEP_FACTORY, label: '1. Factory' }],

            // Data from registries
            factories: [],
            vaults: [],

            // Selections
            selectedFactory: null,
            componentSteps: [],         // [{ tag, tagName, components, required }]
            componentSelections: {},     // { tagHash: address }
            selectedVault: null,

            // Form data
            formData: {
                name: '',
                symbol: '',
                description: '',
                styleUri: '',
                metadataURI: '',
                nftCount: 1000,
                presetId: 0,
                creationTier: 0,
            },
            freeMint: {
                allocation: 0,
                scope: 'BOTH', // BOTH | FREE_MINT_ONLY | PAID_ONLY
            },

            // Preview
            activePreviewTab: 'banner',

            // Status
            loading: true,
            error: null,
            deployStatus: null, // null | 'pending' | 'confirming' | 'success' | 'error'
            deployedAddress: null,
        };
    }

    async onMount() {
        await stylesheetLoader.load('/src/core/route-create-v2.css', 'route:create');
        await this._loadFactories();
    }

    async _loadFactories() {
        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            if (!masterAdapter) {
                this.setState({ loading: false, error: 'MasterRegistry not available' });
                return;
            }

            const factories = await masterAdapter.getActiveFactories();
            this.setState({ factories, loading: false });
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load factories:', err);
            this.setState({ loading: false, error: err.message });
        }
    }

    // ── Step Navigation ──

    _buildStepsFrom(componentSteps) {
        const steps = [{ type: STEP_FACTORY, label: '1. Factory' }];
        let num = 2;

        for (const cs of componentSteps) {
            steps.push({
                type: STEP_COMPONENT,
                label: `${num}. ${cs.tagName}`,
                tag: cs.tag,
            });
            num++;
        }

        steps.push({ type: STEP_CONFIGURE, label: `${num}. Configure` });
        num++;
        steps.push({ type: STEP_PREVIEW, label: `${num}. Preview` });
        num++;
        steps.push({ type: STEP_VAULT, label: `${num}. Vault` });
        num++;
        steps.push({ type: STEP_DEPLOY, label: `${num}. Deploy` });

        return steps;
    }

    _currentStep() {
        return this.state.steps[this.state.currentStepIndex];
    }

    _goNext() {
        const { currentStepIndex, steps } = this.state;
        if (currentStepIndex < steps.length - 1) {
            this.setState({ currentStepIndex: currentStepIndex + 1 });
        }
    }

    _goBack() {
        const { currentStepIndex } = this.state;
        if (currentStepIndex > 0) {
            this.setState({ currentStepIndex: currentStepIndex - 1 });
        }
    }

    // ── Factory Selection ──

    async _selectFactory(factoryAddress) {
        const factory = this.state.factories.find(f => f.address === factoryAddress);
        if (!factory) return;

        this.setState({ selectedFactory: factory, loading: true });

        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            const componentRegistryAdapter = await serviceFactory.getComponentRegistryAdapter();

            // Get factory's supported component tags
            const featureTags = await masterAdapter.getFactoryFeatures(factoryAddress);
            const requiredTags = await masterAdapter.getFactoryRequiredFeatures(factoryAddress);
            const requiredSet = new Set(requiredTags);

            // For each tag, query ComponentRegistry for approved components
            const componentSteps = [];
            if (componentRegistryAdapter) {
                for (const tag of featureTags) {
                    const components = await componentRegistryAdapter.getComponentsByTag(tag);
                    if (components.length > 0) {
                        const tagName = this._tagToName(tag);
                        componentSteps.push({
                            tag,
                            tagName,
                            components,
                            required: requiredSet.has(tag),
                        });
                    }
                }
            }

            // Rebuild steps with the new component steps
            const newState = {
                componentSteps,
                componentSelections: {},
                loading: false,
            };
            newState.steps = this._buildStepsFrom(componentSteps);
            newState.currentStepIndex = 1; // advance past factory step

            this.setState(newState);
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load factory features:', err);
            this.setState({ loading: false, error: err.message });
        }
    }

    _tagToName(tagHash) {
        // Known tags — extensible
        const { ethers } = window;
        if (!ethers) return 'Module';
        const gating = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating'));
        const liquidity = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity'));
        if (tagHash === gating) return 'Gating';
        if (tagHash === liquidity) return 'Liquidity';
        return 'Module';
    }

    // ── Component Selection ──

    _selectComponent(tag, address) {
        const selections = { ...this.state.componentSelections, [tag]: address };
        this.setState({ componentSelections: selections });
        this._goNext();
    }

    // ── Vault Selection ──

    async _loadVaults() {
        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            const vaults = await masterAdapter.getActiveVaults();
            this.setState({ vaults });
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load vaults:', err);
        }
    }

    _selectVault(vaultAddress) {
        const vault = this.state.vaults.find(v => v.address === vaultAddress);
        this.setState({ selectedVault: vault });
    }

    // ── Form Updates ──

    _updateFormData(field, value) {
        const formData = { ...this.state.formData, [field]: value };
        this.setState({ formData });
    }

    _updateFreeMint(field, value) {
        const freeMint = { ...this.state.freeMint, [field]: value };
        this.setState({ freeMint });
    }

    // ── Deploy ──

    async _deploy() {
        const {
            selectedFactory, componentSelections, formData,
            freeMint, selectedVault, componentSteps
        } = this.state;

        if (!selectedFactory || !selectedVault) return;

        this.setState({ deployStatus: 'pending' });

        try {
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const { provider, signer } = walletService.getProviderAndSigner();
            if (!signer) throw new Error('Wallet not connected');

            const { loadABI } = await import('../utils/abiLoader.js');
            const abi = await loadABI(selectedFactory.title || 'ERC404Factory');
            const factoryContract = new ethers.Contract(selectedFactory.address, abi, signer);

            const connectedAddress = await signer.getAddress();
            let tx;

            if (selectedFactory.contractType === 'ERC404') {
                const gatingTag = this._getGatingTag();
                const liqTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity'));

                const gatingModule = (gatingTag && componentSelections[gatingTag]) || ethers.constants.AddressZero;
                const liquidityDeployer = componentSelections[liqTag];

                const identity = {
                    name: formData.name,
                    symbol: formData.symbol.toUpperCase(),
                    styleUri: formData.styleUri || '',
                    owner: connectedAddress,
                    vault: selectedVault.address,
                    nftCount: parseInt(formData.nftCount) || 1000,
                    presetId: parseInt(formData.presetId) || 0,
                    creationTier: parseInt(formData.creationTier) || 0,
                };

                const freeMintParams = {
                    allocation: parseInt(freeMint.allocation) || 0,
                    scope: freeMint.scope === 'FREE_MINT_ONLY' ? 1 : freeMint.scope === 'PAID_ONLY' ? 2 : 0,
                };

                tx = await factoryContract.createInstance(
                    identity,
                    formData.metadataURI || '',
                    liquidityDeployer,
                    gatingModule,
                    freeMintParams
                );
            } else if (selectedFactory.contractType === 'ERC1155') {
                const gatingTag = this._getGatingTag();
                const gatingModule = (gatingTag && componentSelections[gatingTag]) || ethers.constants.AddressZero;

                const freeMintParams = {
                    allocation: parseInt(freeMint.allocation) || 0,
                    scope: freeMint.scope === 'FREE_MINT_ONLY' ? 1 : freeMint.scope === 'PAID_ONLY' ? 2 : 0,
                };

                tx = await factoryContract['createInstance(string,string,address,address,string,address,(uint256,uint8))'](
                    formData.name,
                    formData.metadataURI || '',
                    connectedAddress,
                    selectedVault.address,
                    formData.styleUri || '',
                    gatingModule,
                    freeMintParams
                );
            } else if (selectedFactory.contractType === 'ERC721') {
                tx = await factoryContract.createInstance({
                    name: formData.name,
                    metadataURI: formData.metadataURI || '',
                    creator: connectedAddress,
                    vault: selectedVault.address,
                    symbol: formData.symbol.toUpperCase(),
                    lines: 1,
                    baseDuration: 86400,
                    timeBuffer: 300,
                    bidIncrement: ethers.utils.parseEther('0.01'),
                });
            }

            this.setState({ deployStatus: 'confirming' });
            const receipt = await tx.wait();

            // Extract instance address from InstanceCreated event
            const instanceEvent = receipt.events?.find(e => e.event === 'InstanceCreated');
            const deployedAddress = instanceEvent?.args?.instance || receipt.contractAddress;

            this.setState({ deployStatus: 'success', deployedAddress });
        } catch (err) {
            console.error('[ProjectCreationPage] Deploy failed:', err);
            this.setState({ deployStatus: 'error' });
        }
    }

    // ── Event Delegation ──

    setupDOMEventListeners() {
        if (!this.element) return;

        this.element.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;

            const action = actionEl.dataset.action;

            switch (action) {
                case 'select-factory':
                    this._selectFactory(actionEl.dataset.address);
                    break;
                case 'select-component':
                    this._selectComponent(actionEl.dataset.tag, actionEl.dataset.address);
                    break;
                case 'select-vault':
                    this._selectVault(actionEl.dataset.address);
                    break;
                case 'next-step':
                    this._goNext();
                    break;
                case 'prev-step':
                    this._goBack();
                    break;
                case 'preview-tab':
                    this.setState({ activePreviewTab: actionEl.dataset.tab });
                    break;
                case 'deploy':
                    this._deploy();
                    break;
                case 'view-project':
                    window.location.href = `/project/${this.state.deployedAddress}`;
                    break;
            }
        });

        this.element.addEventListener('input', (e) => {
            if (e.target.dataset.field) {
                this._updateFormData(e.target.dataset.field, e.target.value);
                return;
            }
            if (e.target.dataset.freemint) {
                this._updateFreeMint(e.target.dataset.freemint, e.target.value);
                return;
            }
        });

        this.element.addEventListener('change', (e) => {
            if (e.target.dataset.freemint === 'scope') {
                this._updateFreeMint('scope', e.target.value);
            }
        });
    }

    // ── Render ──

    shouldUpdate(oldState, newState) {
        // Re-render for structural changes
        if (oldState.loading !== newState.loading) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.currentStepIndex !== newState.currentStepIndex) return true;
        if (oldState.steps !== newState.steps) return true;
        if (oldState.factories !== newState.factories) return true;
        if (oldState.selectedFactory !== newState.selectedFactory) return true;
        if (oldState.componentSteps !== newState.componentSteps) return true;
        if (oldState.componentSelections !== newState.componentSelections) return true;
        if (oldState.selectedVault !== newState.selectedVault) return true;
        if (oldState.vaults !== newState.vaults) return true;
        if (oldState.activePreviewTab !== newState.activePreviewTab) return true;
        if (oldState.deployStatus !== newState.deployStatus) return true;
        if (oldState.deployedAddress !== newState.deployedAddress) return true;

        // Don't re-render for form data changes (handled by native input values)
        if (oldState.formData !== newState.formData) return false;
        if (oldState.freeMint !== newState.freeMint) return false;

        return false;
    }

    template() {
        const { loading, error } = this.state;

        if (loading) return this._renderLoading();
        if (error) return this._renderError(error);

        const connectedAddress = walletService.getAddress();
        if (!connectedAddress) return this._renderConnectWallet();

        return `
            <div class="create-page">
                <div class="create-container">
                    ${this._renderHeader()}
                    ${this._renderBreadcrumb()}
                    ${this._renderCurrentStep()}
                </div>
            </div>
        `;
    }

    _renderLoading() {
        return `
            <div class="create-page">
                <div class="create-container">
                    <div style="text-align: center; padding: var(--space-12);">Loading...</div>
                </div>
            </div>
        `;
    }

    _renderError(msg) {
        return `
            <div class="create-page">
                <div class="create-container">
                    <div class="alert alert-info">
                        <div class="alert-title">Error</div>
                        <div>${msg}</div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderConnectWallet() {
        return `
            <div class="create-page">
                <div class="create-container">
                    ${this._renderHeader()}
                    <div style="text-align: center; padding: var(--space-12);">
                        <p>Connect your wallet to create a project.</p>
                    </div>
                </div>
            </div>
        `;
    }

    _renderHeader() {
        return `
            <div class="create-header">
                <h1 class="create-title">Create Project</h1>
            </div>
        `;
    }

    _renderBreadcrumb() {
        const { steps, currentStepIndex } = this.state;
        const items = steps.map((step, i) => {
            const active = i === currentStepIndex ? ' active' : '';
            const separator = i < steps.length - 1 ? '<span class="breadcrumb-separator">&rarr;</span>' : '';
            return `<span class="breadcrumb-item${active}">${step.label}</span>${separator}`;
        }).join('');

        return `<div class="breadcrumb">${items}</div>`;
    }

    _renderCurrentStep() {
        const step = this._currentStep();
        if (!step) return '';

        switch (step.type) {
            case STEP_FACTORY: return this._renderFactoryStep();
            case STEP_COMPONENT: return this._renderComponentStep(step.tag);
            case STEP_CONFIGURE: return this._renderConfigureStep();
            case STEP_PREVIEW: return this._renderPreviewStep();
            case STEP_VAULT: return this._renderVaultStep();
            case STEP_DEPLOY: return this._renderDeployStep();
            default: return '';
        }
    }

    _renderFactoryStep() {
        const { factories } = this.state;

        const cards = factories.map(f => `
            <div class="type-card" data-action="select-factory" data-address="${f.address}">
                <h3 class="type-card-title">${f.displayTitle || f.title}</h3>
                <p class="type-card-description">${this._factoryDescription(f.contractType)}</p>
                <div class="type-card-action">Select &rarr;</div>
            </div>
        `).join('');

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Select Factory
                </h2>
                <div class="type-grid">${cards}</div>
                ${this._renderGovernanceFooter('factory')}
            </div>
        `;
    }

    _factoryDescription(contractType) {
        const descriptions = {
            'ERC404': 'Hybrid token standard. Combines fungible tokens with NFT ownership. Enables bonding curve mechanics and dual-nature assets.',
            'ERC1155': 'Multi-token standard. Supports both fungible and non-fungible tokens in a single contract. Ideal for open editions and galleries.',
            'ERC721': 'Non-fungible tokens. Each token is unique and indivisible. Standard for NFT collections and individual artworks.',
        };
        return descriptions[contractType] || '';
    }

    _renderComponentStep(tag) {
        const stepData = this.state.componentSteps.find(cs => cs.tag === tag);
        if (!stepData) return '';

        const selected = this.state.componentSelections[tag];

        // "None" option only if not required
        const noneCard = stepData.required ? '' : `
            <div class="component-card${selected === '0x0000000000000000000000000000000000000000' ? ' selected' : ''}"
                 data-action="select-component" data-tag="${tag}"
                 data-address="0x0000000000000000000000000000000000000000">
                <h3 class="component-card-title">None</h3>
                <p class="type-card-description">No ${stepData.tagName.toLowerCase()} module. Open access.</p>
            </div>
        `;

        const componentCards = stepData.components.map(c => `
            <div class="component-card${selected === c.address ? ' selected' : ''}"
                 data-action="select-component" data-tag="${tag}" data-address="${c.address}">
                <h3 class="component-card-title">${c.name}</h3>
                <div class="component-card-address">${c.address.slice(0, 6)}...${c.address.slice(-4)}</div>
            </div>
        `).join('');

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Select ${stepData.tagName}
                </h2>
                ${stepData.required ? `
                    <div class="alert alert-info" style="margin-bottom: var(--space-6);">
                        <div class="alert-title">Required</div>
                        <div>You must select a ${stepData.tagName.toLowerCase()} module for this factory type.</div>
                    </div>
                ` : ''}
                <div class="type-grid">
                    ${noneCard}
                    ${componentCards}
                </div>
                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                </div>
                ${this._renderGovernanceFooter(stepData.tagName.toLowerCase())}
            </div>
        `;
    }

    _renderConfigureStep() {
        const { formData, freeMint, selectedFactory, componentSelections } = this.state;
        const isERC404 = selectedFactory?.contractType === 'ERC404';

        // Check if gating was selected (to show free mint section)
        const gatingTag = this._getGatingTag();
        const hasGating = gatingTag && componentSelections[gatingTag] &&
            componentSelections[gatingTag] !== '0x0000000000000000000000000000000000000000';

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Configure Project
                </h2>

                <div class="form-section">
                    <h3 class="form-section-title">Project Details</h3>
                    <div class="form-group">
                        <label class="form-label form-label-required">Project Name</label>
                        <input type="text" class="form-input" data-field="name"
                               placeholder="My Project" value="${formData.name}">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label form-label-required">Token Symbol</label>
                            <input type="text" class="form-input" data-field="symbol"
                                   placeholder="SYM" value="${formData.symbol}"
                                   style="text-transform: uppercase;">
                            <div class="form-help">3-10 uppercase letters or numbers</div>
                        </div>
                        ${isERC404 ? `
                        <div class="form-group">
                            <label class="form-label form-label-required">NFT Count</label>
                            <input type="number" class="form-input" data-field="nftCount"
                                   placeholder="1000" value="${formData.nftCount}" min="1">
                            <div class="form-help">Total number of NFTs in the collection</div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-input form-textarea" data-field="description"
                                  placeholder="Describe your project">${formData.description}</textarea>
                    </div>
                </div>

                <div class="form-section">
                    <h3 class="form-section-title">Media & Styling</h3>
                    <div class="form-group">
                        <label class="form-label">IPFS Metadata URI</label>
                        <input type="text" class="form-input" data-field="metadataURI"
                               placeholder="ipfs://..." value="${formData.metadataURI}">
                        <div class="form-help">If left empty, metadata will be auto-generated.</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Custom Style URL</label>
                        <input type="text" class="form-input" data-field="styleUri"
                               placeholder="https://... or ipfs://..." value="${formData.styleUri}">
                        <div class="form-help">Link to CSS file for custom project page styling.</div>
                    </div>
                </div>

                ${hasGating ? this._renderFreeMintSection(freeMint, isERC404 ? formData.nftCount : 0) : ''}

                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                    <button class="btn btn-primary" data-action="next-step">Continue &rarr;</button>
                </div>
            </div>
        `;
    }

    _getGatingTag() {
        try {
            const { ethers } = window;
            if (!ethers) return null;
            return ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating'));
        } catch { return null; }
    }

    _renderFreeMintSection(freeMint, maxNfts) {
        return `
            <div class="form-section">
                <h3 class="form-section-title">Free Mints</h3>
                <div class="form-group">
                    <label class="form-label">Free Mint Allocation</label>
                    <input type="number" class="form-input" data-freemint="allocation"
                           placeholder="0" value="${freeMint.allocation}" min="0"
                           ${maxNfts > 0 ? `max="${maxNfts - 1}"` : ''}>
                    <div class="form-help">NFTs reserved for zero-cost claims (0 = disabled).${maxNfts > 0 ? ` Max: ${maxNfts - 1}` : ''}</div>
                </div>
                ${freeMint.allocation > 0 ? `
                <div class="form-group">
                    <label class="form-label">Gating Scope</label>
                    <select class="form-input" data-freemint="scope">
                        <option value="BOTH" ${freeMint.scope === 'BOTH' ? 'selected' : ''}>Both - gates free mints and paid buys</option>
                        <option value="FREE_MINT_ONLY" ${freeMint.scope === 'FREE_MINT_ONLY' ? 'selected' : ''}>Free Mint Only - gates claims only, paid buys are open</option>
                        <option value="PAID_ONLY" ${freeMint.scope === 'PAID_ONLY' ? 'selected' : ''}>Paid Only - gates paid buys only, free claims are open</option>
                    </select>
                    <div class="form-help">Controls which entry points the gating module guards.</div>
                </div>
                ` : ''}
            </div>
        `;
    }

    _renderPreviewStep() {
        const { formData, activePreviewTab, selectedFactory } = this.state;
        const initial = (formData.name || 'P').charAt(0).toUpperCase();
        const type = selectedFactory?.contractType || 'ERC404';

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Preview Project
                </h2>

                ${this._renderConfigSummary()}

                <div class="preview-tabs">
                    <button class="preview-tab${activePreviewTab === 'banner' ? ' active' : ''}"
                            data-action="preview-tab" data-tab="banner">Featured Banner</button>
                    <button class="preview-tab${activePreviewTab === 'card' ? ' active' : ''}"
                            data-action="preview-tab" data-tab="card">Project Card</button>
                    <button class="preview-tab${activePreviewTab === 'page' ? ' active' : ''}"
                            data-action="preview-tab" data-tab="page">Project Page</button>
                </div>

                <div class="preview-panel${activePreviewTab === 'banner' ? ' active' : ''}" id="preview-banner">
                    <p class="text-secondary" style="margin-bottom: var(--space-4);">
                        This is how your project will appear in the #1 featured spot.
                    </p>
                    <div class="preview-featured-banner">
                        ${initial}
                        <div class="preview-featured-content">
                            <div style="font-size: var(--font-size-caption); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); color: var(--text-secondary); margin-bottom: var(--space-1);">FEATURED</div>
                            <h3 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">${formData.name || 'Your Project'}</h3>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <span class="badge">${type}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="preview-panel${activePreviewTab === 'card' ? ' active' : ''}">
                    <p class="text-secondary" style="margin-bottom: var(--space-4);">
                        This is how your project will appear in the project grid.
                    </p>
                    <div class="preview-project-card">
                        <div class="preview-card-image">${initial}</div>
                        <div class="preview-card-content">
                            <h4 style="font-size: var(--font-size-h4); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">
                                ${formData.name || 'Your Project'}
                            </h4>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
                                <span class="badge">${type}</span>
                            </div>
                            <p class="preview-card-description">${formData.description || 'Project description will appear here.'}</p>
                        </div>
                    </div>
                </div>

                <div class="preview-panel${activePreviewTab === 'page' ? ' active' : ''}">
                    <p class="text-secondary" style="margin-bottom: var(--space-4);">
                        This is how your custom project page will look.
                    </p>
                    <div class="preview-custom-page">
                        <div style="text-align: center;">
                            <div style="font-size: var(--font-size-h1); font-weight: var(--font-weight-bold); margin-bottom: var(--space-3);">
                                ${formData.name || 'Your Project'}
                            </div>
                            <p style="max-width: 600px; margin: 0 auto;">
                                ${formData.description || 'Project description will appear here.'}
                            </p>
                        </div>
                    </div>
                </div>

                <div class="step-nav" style="margin-top: var(--space-6);">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Edit</button>
                    <button class="btn btn-primary" data-action="next-step">Continue &rarr;</button>
                </div>
            </div>
        `;
    }

    _renderConfigSummary() {
        const { formData, selectedFactory, componentSelections, componentSteps, freeMint } = this.state;
        const rows = [
            ['Factory', selectedFactory?.displayTitle || selectedFactory?.title || '—'],
            ['Type', selectedFactory?.contractType || '—'],
            ['Name', formData.name || '—'],
            ['Symbol', formData.symbol || '—'],
            ['Description', formData.description || '—'],
        ];

        if (selectedFactory?.contractType === 'ERC404') {
            rows.push(['NFT Count', formData.nftCount.toLocaleString()]);
        }

        for (const cs of componentSteps) {
            const addr = componentSelections[cs.tag];
            const comp = cs.components.find(c => c.address === addr);
            const label = !addr || addr === '0x0000000000000000000000000000000000000000'
                ? 'None' : (comp?.name || addr.slice(0, 10) + '...');
            rows.push([cs.tagName, label]);
        }

        if (freeMint.allocation > 0) {
            rows.push(['Free Mints', `${freeMint.allocation} (${freeMint.scope})`]);
        }

        const rowsHtml = rows.map(([label, value]) => `
            <div style="display: flex; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--border-tertiary);">
                <span class="text-secondary text-uppercase" style="font-size: var(--font-size-body-sm); letter-spacing: var(--letter-spacing-wide);">${label}</span>
                <span style="font-weight: var(--font-weight-medium); text-align: right; max-width: 60%;">${value}</span>
            </div>
        `).join('');

        return `
            <div class="form-section" style="margin-bottom: var(--space-8);">
                <h3 class="form-section-title">Configuration Summary</h3>
                <div style="display: grid; gap: var(--space-3);">${rowsHtml}</div>
            </div>
        `;
    }

    _renderVaultStep() {
        const { vaults, selectedVault } = this.state;

        // Load vaults on first render of this step
        if (vaults.length === 0) {
            this._loadVaults();
        }

        const vaultCards = vaults.map(v => `
            <div class="vault-card${selectedVault?.address === v.address ? ' selected' : ''}"
                 data-action="select-vault" data-address="${v.address}">
                <h3 class="vault-name">${v.name || v.address.slice(0, 10) + '...'}</h3>
                <div class="vault-tvl">Target ID: ${v.targetId || '—'}</div>
            </div>
        `).join('');

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Align to Vault
                </h2>

                <div class="alert alert-info" style="margin-bottom: var(--space-6);">
                    <div class="alert-title">Vault Requirement</div>
                    <div>Every project must align to a vault. Your project's fees flow to this vault.</div>
                </div>

                <div class="vault-grid">
                    ${vaultCards || '<p class="text-secondary">Loading vaults...</p>'}
                </div>

                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                    <button class="btn btn-primary" data-action="next-step"
                            ${!selectedVault ? 'disabled' : ''}>Continue &rarr;</button>
                </div>
                ${this._renderGovernanceFooter('vault')}
            </div>
        `;
    }

    _renderDeployStep() {
        const { deployStatus, deployedAddress } = this.state;

        if (deployStatus === 'success' && deployedAddress) {
            return `
                <div class="step-content active">
                    <div class="success-state">
                        <div class="success-icon">&check;</div>
                        <h2 class="success-title">Project Created</h2>
                        <p class="text-secondary" style="margin-bottom: var(--space-2);">Your project has been deployed successfully.</p>
                        <div class="success-address">${deployedAddress}</div>
                        <button class="btn btn-primary" data-action="view-project">View Project &rarr;</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Deploy
                </h2>

                ${this._renderConfigSummary()}

                <div style="display: flex; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--border-tertiary); margin-bottom: var(--space-6);">
                    <span class="text-secondary text-uppercase" style="font-size: var(--font-size-body-sm); letter-spacing: var(--letter-spacing-wide);">Vault</span>
                    <span style="font-weight: var(--font-weight-medium);">${this.state.selectedVault?.name || '—'}</span>
                </div>

                ${deployStatus === 'error' ? `
                    <div class="deploy-status error">
                        <p>Deployment failed. Check console for details.</p>
                    </div>
                ` : ''}

                ${deployStatus === 'pending' || deployStatus === 'confirming' ? `
                    <div class="deploy-status pending">
                        <p>${deployStatus === 'pending' ? 'Waiting for wallet confirmation...' : 'Transaction submitted. Waiting for confirmation...'}</p>
                    </div>
                ` : ''}

                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step"
                            ${deployStatus ? 'disabled' : ''}>&larr; Back</button>
                    <button class="btn btn-primary" data-action="deploy"
                            ${deployStatus ? 'disabled' : ''}>Deploy Project</button>
                </div>
            </div>
        `;
    }

    _renderGovernanceFooter(type) {
        const tweetTexts = {
            factory: encodeURIComponent('I want a factory for @ms2fun that does this: '),
            gating: encodeURIComponent('I want a gating module for @ms2fun that does this: '),
            liquidity: encodeURIComponent('I want a liquidity deployer for @ms2fun that does this: '),
            vault: encodeURIComponent('I need a vault on @ms2fun for this community: '),
            module: encodeURIComponent('I want a module for @ms2fun that does this: '),
        };

        const tweet = tweetTexts[type] || tweetTexts.module;

        return `
            <div class="step-footer">
                <span>Don't see what you need?</span>
                <a href="/governance/apply">Apply via governance &rarr;</a>
                <a href="https://x.com/intent/tweet?text=${tweet}" target="_blank" rel="noopener">Post on X &rarr;</a>
            </div>
        `;
    }
}
