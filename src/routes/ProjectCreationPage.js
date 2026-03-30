/**
 * ProjectCreationPage - Artist-friendly creation wizard
 *
 * Steps:
 *   1. Collection size question (artist-friendly entry point)
 *   2. Factory selection (filtered by collection answer, artist-friendly names)
 *   3..N Component selection (from factory.features() ∩ ComponentRegistry)
 *   N+1. Configure (project details + free mint)
 *   N+2. Preview
 *   N+3. Vault selection (from MasterRegistryV1)
 *   N+4. Deploy
 */

import { Component } from '../core/Component.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';
import { detectNetwork, getExplorerUrl } from '../config/network.js';

// Step type constants
const STEP_COLLECTION_SIZE = 'collection_size';
const STEP_FACTORY = 'factory';
const STEP_COMPONENT = 'component';
const STEP_CONFIGURE = 'configure';
const STEP_PREVIEW = 'preview';
const STEP_VAULT = 'vault';
const STEP_DEPLOY = 'deploy';

// Collection size answers
const SIZE_MANY = 'many';     // >100 pieces
const SIZE_SOME = 'some';     // a few pieces
const SIZE_OPEN = 'open';     // not decided yet

// Which contract types to recommend per collection size
const RECOMMENDATIONS = {
    [SIZE_MANY]: ['ERC404', 'ERC721'],
    [SIZE_SOME]: ['ERC1155', 'ERC721'],
    [SIZE_OPEN]: ['ERC404', 'ERC1155', 'ERC721'],
};

// Launch profiles (presetId → DAO-configured LaunchManager preset).
// Copy describes the intent; actual parameters live on-chain.
const LAUNCH_PROFILES = [
    {
        presetId: 0,
        name: 'Niche',
        subtitle: '5 ETH target · 1B tokens/NFT',
        description: 'For tight, dedicated communities. Lower raise target (~$10K), highly fungible token layer. Each NFT backs 1 billion token units — entry is accessible, the holder base stays small.',
    },
    {
        presetId: 1,
        name: 'Standard',
        subtitle: '25 ETH target · 1M tokens/NFT',
        description: 'The balanced default. A 25 ETH raise (~$50K) with a million token units per NFT. Works for most launches without a strong prior on audience size.',
    },
    {
        presetId: 2,
        name: 'Hype',
        subtitle: '50 ETH target · 1K tokens/NFT',
        description: 'Built for broad, speculative demand. Larger raise target (~$100K), scarcer token supply — 1,000 units per NFT. Higher stakes, higher visibility.',
    },
];

// Step-level context and per-component descriptions for each module tag.
// Keyed by the human-readable tag name returned from _tagToName().
const COMPONENT_INFO = {
    Gating: {
        heading: 'Who can participate?',
        blurb: 'Choose how access to your launch is controlled. You can keep it open to everyone, restrict it to a curated allowlist, or protect it with a password system. This is optional — skip it and your launch is public.',
        none: 'Anyone can participate. No restrictions.',
        components: {
            'Merkle Allowlist Gating': {
                subtitle: 'Allowlist · Merkle Tree',
                description: 'Upload a list of wallet addresses. Only wallets on the list can participate. Uses a Merkle tree so the full list never needs to go on-chain — just a single root hash.',
            },
            'Password Tier Gating': {
                subtitle: 'Password · Tiered Access',
                description: 'Set one or more passwords, each unlocking a different tier of access or pricing. Share codes with your community however you like — Discord, email, or word of mouth.',
            },
        },
    },
    Liquidity: {
        heading: 'How is liquidity deployed?',
        blurb: 'Choose which DEX your project graduates to. When the bonding curve fills, collected ETH is paired with your token and deposited as liquidity on the chosen exchange.',
        none: null, // liquidity is required for ERC404
        components: {
            'Uniswap V4 Deployer': {
                subtitle: 'Uniswap V4 · Hook-Based',
                description: 'Deploy liquidity to a Uniswap V4 pool. Swap fees compound directly into the pool, deepening liquidity over time.',
            },
            'ZAMM Deployer': {
                subtitle: 'ZAMM · Constant Product',
                description: 'Deploy liquidity to ZAMM, a gas-efficient constant-product AMM. Simple and battle-tested.',
            },
            'Cypher Deployer': {
                subtitle: 'Cypher · Concentrated Liquidity',
                description: 'Deploy liquidity to Cypher, a concentrated liquidity DEX. Capital-efficient ranges and deep liquidity with tighter spreads.',
            },
        },
    },
};

// Artist-friendly display info per contract type
const FACTORY_DISPLAY = {
    ERC404: {
        name: 'Pump Launch',
        subtitle: 'Bonding Curve · Dual Nature',
        tagline: 'Starts with a bonding curve price discovery phase. Each NFT is also a tradeable token — collectors can trade fractions or hold the whole piece.',
        recommended: [SIZE_MANY],
        badge: 'PUMP',
    },
    ERC721: {
        name: 'AuctionCore Collection',
        subtitle: 'Numbered · Auction',
        tagline: 'A numbered collection of unique pieces, each sold via auction. Simple, proven, and widely understood by collectors.',
        recommended: [SIZE_MANY],
        badge: null,
    },
    ERC1155: {
        name: 'Open Edition',
        subtitle: 'Few Pieces · Many Collectors',
        tagline: 'A small number of pieces where anyone can mint their own copy at a fixed price. Great for prints, zines, or limited runs.',
        recommended: [SIZE_SOME],
        badge: null,
    },
};

export default class ProjectCreationPage extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            // Wizard navigation
            currentStepIndex: 0,
            steps: [
                { type: STEP_COLLECTION_SIZE, label: '1. Collection' },
                { type: STEP_FACTORY, label: '2. Format' },
                { type: STEP_CONFIGURE, label: '3. Configure' },
                { type: STEP_PREVIEW, label: '4. Preview' },
                { type: STEP_VAULT, label: '5. Vault' },
                { type: STEP_DEPLOY, label: '6. Deploy' },
            ],

            // Artist intro answer
            collectionAnswer: null, // SIZE_MANY | SIZE_SOME | SIZE_OPEN

            // Data from registries
            factories: [],
            vaults: [],
            alignmentTargets: [], // [{ targetId, title, vaults: [...] }]
            selectedTarget: null, // chosen alignment target before picking vault

            // Selections
            selectedFactory: null,
            componentSteps: [],         // [{ tag, tagName, components, required }]
            componentSelections: {},     // { tagHash: address }
            componentConfigs: {},        // { tagHash: configData } — for components needing setup
            selectedVault: null,

            // Form data
            formData: {
                name: '',
                symbol: '',
                description: '',
                projectPhoto: '',   // project card photo (goes into metadataURI JSON)
                projectBanner: '',  // project card banner (goes into metadataURI JSON)
                styleUri: '',
                metadataURI: '',    // project metadata URI (built from projectPhoto/Banner/description)
                tokenBaseURI: '',   // NFT token base URI — tokenURI(id) returns this + tokenId
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
            configError: null,   // validation error string shown on configure step
            deployStatus: null,  // null | 'pending' | 'confirming' | 'success' | 'error'
            deployError: null,   // human-readable error from failed deploy
            deployedAddress: null,

            // Draft
            hasDraft: false,

            // Vanity mining
            miningPattern: '',
            miningMode: 'prefix', // 'prefix' | 'suffix'
            miningActive: false,
            miningAttempts: 0,
            miningError: null,
            minedSalt: null,
            minedAddress: null,
            lockedSalt: null,    // explicitly locked by user, persisted in draft
        };
    }

    async onMount() {
        await stylesheetLoader.load('/src/core/route-create-v2.css', 'route:create');
        this._checkDraft();
        await this._loadFactories();
    }

    _parseMetadataURI(uri) {
        if (!uri) return null;
        try {
            if (uri.startsWith('data:application/json,')) {
                return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
            }
            if (uri.startsWith('data:application/json;base64,')) {
                return JSON.parse(atob(uri.slice('data:application/json;base64,'.length)));
            }
        } catch (e) {
            // malformed — ignore
        }
        return null;
    }

    async _loadFactories() {
        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            if (!masterAdapter) {
                this.setState({ loading: false, error: 'MasterRegistry not available' });
                return;
            }

            const raw = await masterAdapter.getActiveFactories();
            const factories = raw.map(f => ({
                ...f,
                metadata: this._parseMetadataURI(f.metadataURI),
            }));
            this.setState({ factories, loading: false });

            // Auto-select factory if ?type= query param is present
            const params = new URLSearchParams(window.location.search);
            const typeParam = params.get('type');
            if (typeParam && !this.state.selectedFactory) {
                const match = factories.find(f => f.contractType === typeParam);
                if (match) {
                    await this._selectFactory(match.address);
                }
            }
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load factories:', err);
            const isCallException = err.message?.includes('CALL_EXCEPTION') || err.code === 'CALL_EXCEPTION';
            const message = isCallException
                ? 'Contract connection failed. Your local chain may need restarting: npm run chain:start'
                : err.message;
            this.setState({ loading: false, error: message });
        }
    }

    // ── Step Navigation ──

    _buildStepsFrom(componentSteps) {
        const steps = [
            { type: STEP_COLLECTION_SIZE, label: '1. Collection' },
            { type: STEP_FACTORY, label: '2. Format' },
        ];
        let num = 3;

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
        const { currentStepIndex, steps, formData } = this.state;
        const currentStep = steps[currentStepIndex];

        if (currentStep?.type === STEP_CONFIGURE) {
            // Harvest presentation builder into formData.styleUri before validating
            this._readStyleFromDOM();
            const missing = [];
            if (!formData.name?.trim()) missing.push('Project Name');
            if (!formData.symbol?.trim()) missing.push('Token Symbol');
            if (!formData.projectPhoto?.trim()) missing.push('Project Photo');
            if (!formData.projectBanner?.trim()) missing.push('Project Banner');
            if (missing.length) {
                this.setState({ configError: `Required: ${missing.join(', ')}` });
                return;
            }
        }

        this.setState({ configError: null, currentStepIndex: currentStepIndex + 1 });
    }

    _goBack() {
        const { currentStepIndex } = this.state;
        if (currentStepIndex > 0) {
            this.setState({ currentStepIndex: currentStepIndex - 1 });
        }
    }

    // ── Collection Size Answer ──

    _selectCollectionSize(answer) {
        this.setState({ collectionAnswer: answer });
        this._goNext();
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
            newState.currentStepIndex = 2; // advance past collection + factory steps

            this.setState(newState);
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load factory features:', err);
            this.setState({ loading: false, error: err.message });
        }
    }

    _tagToName(tagHash) {
        // Precomputed: keccak256(toUtf8Bytes('gating')) and keccak256(toUtf8Bytes('liquidity'))
        if (tagHash === '0x819a7435de35b1093a692ccd52bab7faca49092a62636c547a80c6f5d21d9696') return 'Gating';
        if (tagHash === '0xbb7d9f8cddc6f064ba72d0e3c1e53eb67867dd8506fa4f5d61c86189caca8ee5') return 'Liquidity';
        return 'Module';
    }

    // ── Component Selection ──

    _selectComponent(tag, address) {
        const selections = { ...this.state.componentSelections, [tag]: address };
        this.setState({ componentSelections: selections });

        // For components with a configType, the step re-renders as the config view.
        // For all others (including "Open"), auto-advance.
        const stepData = this.state.componentSteps.find(cs => cs.tag === tag);
        const selectedComp = stepData?.components.find(c => c.address === address);
        const needsConfig = selectedComp?.metadata?.configType;
        if (!needsConfig) {
            this._goNext();
        }
    }

    _clearComponentSelection(tag) {
        const selections = { ...this.state.componentSelections };
        delete selections[tag];
        this.setState({ componentSelections: selections });
    }

    _updateComponentConfig(tag, config) {
        const componentConfigs = { ...this.state.componentConfigs, [tag]: config };
        this.setState({ componentConfigs });
    }

    _getPasswordTierConfig(tag) {
        return this.state.componentConfigs[tag] || { tierType: 'VOLUME_CAP', tiers: [] };
    }

    _setPasswordTierType(tag, tierType) {
        const config = { ...this._getPasswordTierConfig(tag), tierType };
        this._updateComponentConfig(tag, config);
    }

    _addPasswordTier(tag) {
        const config = this._getPasswordTierConfig(tag);
        const tiers = [...config.tiers, { password: '', cap: '', delay: '' }];
        this._updateComponentConfig(tag, { ...config, tiers });
    }

    _removePasswordTier(tag, index) {
        const config = this._getPasswordTierConfig(tag);
        const tiers = config.tiers.filter((_, i) => i !== index);
        this._updateComponentConfig(tag, { ...config, tiers });
    }

    _updatePasswordTierField(tag, index, field, value) {
        const config = this._getPasswordTierConfig(tag);
        const tiers = config.tiers.map((t, i) => i === index ? { ...t, [field]: value } : t);
        this._updateComponentConfig(tag, { ...config, tiers });
    }

    // ── Vault Selection ──

    async _loadVaults() {
        try {
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();

            // Load alignment registry adapter for target metadata
            const alignmentAdapter = await serviceFactory.getAlignmentRegistryAdapter?.().catch(() => null);

            // MasterRegistryV1 has no vault enumeration — read from current env config
            let configVaults = [];
            try {
                const { loadContractConfig } = await import('../config/contractConfig.js');
                const cfg = await loadContractConfig();
                configVaults = cfg?.vaults || [];
            } catch { /* config not available */ }

            let vaults;
            if (configVaults.length > 0) {
                vaults = await Promise.all(configVaults.map(async (cv) => {
                    try {
                        const info = await masterAdapter.getVaultInfo(cv.address);
                        // Parse description from metadataURI (data:application/json,...)
                        let description = '';
                        if (info.metadataURI) {
                            try {
                                const jsonStr = decodeURIComponent(info.metadataURI.replace('data:application/json,', ''));
                                const meta = JSON.parse(jsonStr);
                                description = meta.description || '';
                            } catch { /* metadata parse failed */ }
                        }
                        return {
                            address: cv.address,
                            name: info.name || '',
                            active: info.isActive,
                            targetId: info.targetId?.toString() || null,
                            alignmentToken: cv.alignmentToken,
                            description,
                        };
                    } catch {
                        return { address: cv.address, name: '', active: true, alignmentToken: cv.alignmentToken, targetId: null, description: '' };
                    }
                }));
                vaults = vaults.filter(v => v.active);
            } else {
                vaults = await masterAdapter.getActiveVaults();
            }

            // Group vaults by targetId, fetching target title for each group
            const byTarget = new Map();
            for (const v of vaults) {
                const tid = v.targetId || 'unknown';
                if (!byTarget.has(tid)) {
                    // Derive alignment target name from vault name e.g. "MS2 UNIv4" → "MS2"
                    const title = v.name?.split(' ')[0] || `Target ${tid}`;
                    byTarget.set(tid, { targetId: tid, title, vaults: [] });
                }
                byTarget.get(tid).vaults.push(v);
            }

            const alignmentTargets = [...byTarget.values()];
            this.setState({ vaults, alignmentTargets });
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to load vaults:', err);
        }
    }

    _selectTarget(targetId) {
        const target = this.state.alignmentTargets.find(t => t.targetId === targetId);
        this.setState({ selectedTarget: target, selectedVault: null });
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

    _readStyleFromDOM() {
        if (!this.element) return;
        const fd = this.state.formData;

        // Build CSS from token pickers
        const tokenKeys = [
            '--bg-primary', '--bg-secondary', '--bg-tertiary',
            '--text-primary', '--text-secondary',
            '--border-primary', '--border-secondary',
        ];
        const overrides = [];
        for (const key of tokenKeys) {
            const textInput = this.element.querySelector(`[data-style-token-text="${key}"]`);
            const val = textInput?.value?.trim();
            if (val) overrides.push(`  ${key}: ${val};`);
        }
        const fontFamily = this.element.querySelector('[data-style-ext="font-family"]')?.value?.trim();
        if (fontFamily) overrides.push(`  --font-primary: ${fontFamily};`);

        const cssParts = [];
        if (overrides.length) cssParts.push(`:root {\n${overrides.join('\n')}\n}`);

        const bgImage = this.element.querySelector('[data-style-ext="bg-image"]')?.value?.trim();
        if (bgImage) {
            cssParts.push(`body {\n  background-image: url('${bgImage}');\n  background-size: cover;\n  background-position: center;\n  background-attachment: fixed;\n}`);
        }

        const customCSS = this.element.querySelector('[data-style-ext="custom-css"]')?.value?.trim();
        if (customCSS) cssParts.push(customCSS);

        // Build metadataURI JSON: project_photo + project_banner + description
        // Stored in MasterRegistry as the project's identity (updateable via updateInstanceMetadata)
        const metaObj = {};
        if (fd.description) metaObj.description = fd.description;
        if (fd.projectPhoto) metaObj.project_photo = fd.projectPhoto;
        if (fd.projectBanner) metaObj.project_banner = fd.projectBanner;
        if (Object.keys(metaObj).length > 0) {
            const metaUri = 'data:application/json,' + encodeURIComponent(JSON.stringify(metaObj));
            this.state.formData = { ...this.state.formData, metadataURI: metaUri };
        }

        // Build styleUri JSON: CSS only
        const css = cssParts.join('\n\n');
        if (css) {
            const styleObj = { css };
            const uri = 'data:application/json,' + encodeURIComponent(JSON.stringify(styleObj));
            this.state.formData = { ...this.state.formData, styleUri: uri };
        }
    }

    _updateFreeMint(field, value) {
        const freeMint = { ...this.state.freeMint, [field]: value };
        this.setState({ freeMint });
    }

    // ── Draft persistence ──

    _draftKey() { return 'ms2fun:wizard:draft'; }

    _checkDraft() {
        try {
            const raw = localStorage.getItem(this._draftKey());
            if (raw) this.setState({ hasDraft: true });
        } catch {}
    }

    _saveDraft() {
        try {
            const { collectionAnswer, selectedFactory, componentSelections, componentConfigs,
                    formData, freeMint, selectedVault, selectedTarget, currentStepIndex,
                    lockedSalt } = this.state;
            const draft = {
                savedAt: Date.now(),
                currentStepIndex,
                collectionAnswer,
                selectedFactory: selectedFactory ? { address: selectedFactory.address, contractType: selectedFactory.contractType, title: selectedFactory.title } : null,
                componentSelections,
                componentConfigs,
                formData,
                freeMint,
                selectedVaultAddress: selectedVault?.address || null,
                selectedTargetId: selectedTarget?.targetId || null,
                lockedSalt: lockedSalt || null,
            };
            localStorage.setItem(this._draftKey(), JSON.stringify(draft));
        } catch {}
    }

    async _restoreDraft() {
        try {
            const raw = localStorage.getItem(this._draftKey());
            if (!raw) return;
            const draft = JSON.parse(raw);

            // Need a factory to rebuild step structure
            const factory = draft.selectedFactory?.address
                ? this.state.factories.find(f => f.address === draft.selectedFactory.address)
                : null;

            if (!factory) {
                // No factory context — just restore basic state at step 0
                this.setState({
                    hasDraft: false,
                    collectionAnswer: draft.collectionAnswer || null,
                    componentSelections: draft.componentSelections || {},
                    componentConfigs: draft.componentConfigs || {},
                    formData: { ...this.state.formData, ...draft.formData },
                    freeMint: { ...this.state.freeMint, ...draft.freeMint },
                });
                return;
            }

            this.setState({ loading: true });

            // Rebuild component steps (same as _selectFactory)
            const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
            const componentRegistryAdapter = await serviceFactory.getComponentRegistryAdapter();
            const featureTags = await masterAdapter.getFactoryFeatures(factory.address);
            const requiredTags = await masterAdapter.getFactoryRequiredFeatures(factory.address);
            const requiredSet = new Set(requiredTags);

            const componentSteps = [];
            if (componentRegistryAdapter) {
                for (const tag of featureTags) {
                    const components = await componentRegistryAdapter.getComponentsByTag(tag);
                    if (components.length > 0) {
                        componentSteps.push({ tag, tagName: this._tagToName(tag), components, required: requiredSet.has(tag) });
                    }
                }
            }

            const steps = this._buildStepsFrom(componentSteps);
            const savedIndex = Math.min(draft.currentStepIndex || 0, steps.length - 1);

            // Resolve vault + target
            let selectedVault = null;
            let selectedTarget = null;
            if (draft.selectedVaultAddress || draft.selectedTargetId) {
                if (!this.state.vaults.length) await this._loadVaults();
                if (draft.selectedVaultAddress) {
                    selectedVault = this.state.vaults.find(v => v.address === draft.selectedVaultAddress) || null;
                }
                if (draft.selectedTargetId) {
                    selectedTarget = this.state.alignmentTargets.find(t => t.targetId === draft.selectedTargetId) || null;
                }
            }

            this.setState({
                hasDraft: false,
                loading: false,
                selectedFactory: factory,
                componentSteps,
                steps,
                currentStepIndex: savedIndex,
                collectionAnswer: draft.collectionAnswer || null,
                componentSelections: draft.componentSelections || {},
                componentConfigs: draft.componentConfigs || {},
                formData: { ...this.state.formData, ...draft.formData },
                freeMint: { ...this.state.freeMint, ...draft.freeMint },
                ...(selectedVault ? { selectedVault } : {}),
                ...(selectedTarget ? { selectedTarget } : {}),
                ...(draft.lockedSalt ? { lockedSalt: draft.lockedSalt } : {}),
            });
        } catch (err) {
            console.error('[ProjectCreationPage] Failed to restore draft:', err);
            this.setState({ hasDraft: false, loading: false });
        }
    }

    _clearDraft() {
        try { localStorage.removeItem(this._draftKey()); } catch {}
        this.setState({ hasDraft: false });
    }

    // ── Vanity Mining ──

    _startMining() {
        if (this.state.miningActive) return;
        const pattern = this.state.miningPattern?.replace(/^0x/, '') || '';
        if (!/^[0-9a-fA-F]+$/.test(pattern)) {
            this.setState({ miningError: 'Pattern must be hex characters only (0-9, a-f).' });
            return;
        }
        this.setState({ miningActive: true, miningAttempts: 0, minedSalt: null, minedAddress: null, miningError: null });
        this._miningRunning = true;
        this._mineLoop();
    }

    _stopMining() {
        this._miningRunning = false;
        this.setState({ miningActive: false });
    }

    async _mineLoop() {
        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        const sender = walletService.getAddress();
        if (!sender) { this._stopMining(); return; }

        if (!this.state.selectedFactory?.address) { this._stopMining(); return; }

        // Pure local CREATE3 address prediction — no RPC.
        //
        // The ERC404Factory does:
        //   senderBoundSalt = keccak256(abi.encodePacked(msg.sender, params.salt))
        //   instance        = createX.deployCreate3(senderBoundSalt, proxyCode)
        //
        // CreateX's _guard(senderBoundSalt) checks if address(bytes20(senderBoundSalt)) == factory.
        // For a random user salt, senderBoundSalt is a keccak256 hash whose first 20 bytes are
        // pseudo-random — they will NOT equal the factory address. So _guard returns senderBoundSalt
        // unchanged (NoProtection path), and CreateX does:
        //   proxy = CREATE2(CREATEX, senderBoundSalt, PROXY_INITCODE_HASH)
        //   instance = nonce1(proxy)
        //
        // NOTE: ERC404Factory.computeInstanceAddress() applies an extra keccak256(factory, senderBoundSalt)
        // step that does NOT match the actual deployment for random salts. That function is buggy.
        // The correct prediction is below.

        const CREATEX = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
        const PROXY_INITCODE_HASH = '0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f';

        const predictAddress = (salt) => {
            const senderBoundSalt = ethers.utils.keccak256(
                ethers.utils.solidityPack(['address', 'bytes32'], [sender, salt])
            );
            // CreateX _guard: no protection applied for random senderBoundSalt
            // guardedSalt === senderBoundSalt (returned unchanged)
            const proxy = ethers.utils.getCreate2Address(CREATEX, senderBoundSalt, PROXY_INITCODE_HASH);
            return ethers.utils.getContractAddress({ from: proxy, nonce: 1 });
        };

        // Large batches — pure CPU, no await needed per iteration
        const BATCH = 500;
        let attempts = 0;

        while (this._miningRunning) {
            const { miningPattern, miningMode } = this.state;
            if (!miningPattern) { this._stopMining(); return; }
            const pattern = miningPattern.toLowerCase().replace(/^0x/, '');

            for (let i = 0; i < BATCH; i++) {
                if (!this._miningRunning) return;
                const salt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
                const addr = predictAddress(salt).toLowerCase();
                const hex = addr.slice(2);
                const match = miningMode === 'prefix' ? hex.startsWith(pattern) : hex.endsWith(pattern);
                if (match) {
                    this._miningRunning = false;
                    this.setState({ miningActive: false, miningAttempts: attempts + i + 1, minedSalt: salt, minedAddress: addr });
                    return;
                }
            }

            attempts += BATCH;
            this.setState({ miningAttempts: attempts });
            await new Promise(r => setTimeout(r, 0)); // yield to UI between batches
        }
    }

    // ── Deploy ──

    async _deploy() {
        const {
            selectedFactory, componentSelections, formData,
            freeMint, selectedVault, componentSteps, componentConfigs,
        } = this.state;

        if (!selectedFactory || !selectedVault) return;

        this.setState({ deployStatus: 'pending' });

        try {
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const { provider, signer } = walletService.getProviderAndSigner();
            if (!signer) throw new Error('Wallet not connected');

            const { loadABI } = await import('../utils/abiLoader.js');
            const abiName = { ERC404: 'ERC404Factory', ERC1155: 'ERC1155Factory', ERC721: 'ERC721AuctionFactory' }[selectedFactory.contractType] || 'ERC404Factory';
            const abi = await loadABI(abiName);
            const factoryContract = new ethers.Contract(selectedFactory.address, abi, signer);

            const connectedAddress = await signer.getAddress();
            let tx;

            if (selectedFactory.contractType === 'ERC404') {
                const gatingTag = this._getGatingTag();
                const liqTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity'));

                const gatingModule = (gatingTag && componentSelections[gatingTag]) || ethers.constants.AddressZero;

                // Prefer user-selected liquidity deployer; fall back to config default when factory
                // has no registered feature tags (empty componentSteps for liquidity).
                let liquidityDeployer = componentSelections[liqTag];
                if (!liquidityDeployer) {
                    const { loadContractConfig } = await import('../config/contractConfig.js');
                    const cfg = await loadContractConfig();
                    liquidityDeployer = cfg?.contracts?.LiquidityDeployerModule;
                }

                if (!liquidityDeployer) throw new Error('No liquidity deployer selected. Go back and select a liquidity option.');
                if (!formData.name?.trim()) throw new Error('Project name is required.');
                if (!formData.symbol?.trim()) throw new Error('Token symbol is required.');

                const identity = {
                    salt: this.state.lockedSalt || this.state.minedSalt || ethers.utils.hexlify(ethers.utils.randomBytes(32)),
                    name: formData.name.trim(),
                    symbol: formData.symbol.trim().toUpperCase(),
                    styleUri: formData.styleUri || '',
                    tokenBaseURI: formData.tokenBaseURI || '',
                    owner: connectedAddress,
                    vault: selectedVault.address,
                    nftCount: parseInt(formData.nftCount) || 1000,
                    presetId: componentConfigs[liqTag]?.presetId ?? 1,
                    stakingModule: ethers.constants.AddressZero,
                };

                console.log('[ProjectCreationPage] ERC404 deploy args:', {
                    identity,
                    metadataURI: formData.metadataURI || '',
                    liquidityDeployer,
                    gatingModule,
                    freeMintParams: {
                        allocation: parseInt(freeMint.allocation) || 0,
                        scope: freeMint.scope,
                    },
                });

                const freeMintParams = {
                    allocation: parseInt(freeMint.allocation) || 0,
                    scope: freeMint.scope === 'FREE_MINT_ONLY' ? 1 : freeMint.scope === 'PAID_ONLY' ? 2 : 0,
                };

                // Check if selected gating module has password-tier config
                const gatingStepData = gatingTag && componentSteps.find(cs => cs.tag === gatingTag);
                const selectedGatingComponent = gatingStepData?.components?.find(
                    c => c.address === gatingModule
                );
                const isPasswordTierGating = selectedGatingComponent?.metadata?.configType === 'password-tier-gating';
                const tierConfig = isPasswordTierGating ? componentConfigs[gatingTag] : null;

                if (isPasswordTierGating && tierConfig?.tiers?.length > 0) {
                    const passwordHashes = tierConfig.tiers.map(t =>
                        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(t.password || ''))
                    );
                    const isTimeBased = tierConfig.tierType === 'TIME_BASED';
                    const contractTierConfig = {
                        tierType: isTimeBased ? 1 : 0,
                        passwordHashes,
                        volumeCaps: isTimeBased
                            ? new Array(tierConfig.tiers.length).fill(0)
                            : tierConfig.tiers.map(t => ethers.utils.parseEther(t.cap || '0')),
                        tierUnlockTimes: isTimeBased
                            ? tierConfig.tiers.map(t => Math.floor(Date.now() / 1000) + parseInt(t.delay || '0') * 3600)
                            : new Array(tierConfig.tiers.length).fill(0),
                    };

                    tx = await factoryContract.createInstanceWithTiers(
                        identity,
                        formData.metadataURI || '',
                        liquidityDeployer,
                        contractTierConfig,
                        freeMintParams
                    );
                } else {
                    tx = await factoryContract.createInstance(
                        identity,
                        formData.metadataURI || '',
                        liquidityDeployer,
                        gatingModule,
                        freeMintParams
                    );
                }
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

            this._clearDraft();
            this.setState({ deployStatus: 'success', deployedAddress });
        } catch (err) {
            // MetaMask wraps the actual revert reason at err.data.message or err.error.data.message
            const rawMessage =
                err?.reason ||
                err?.error?.data?.message ||
                err?.data?.message ||
                err?.data?.data ||
                err?.message ||
                'Transaction failed.';

            // Detect stale MetaMask cache against a restarted local node
            const isStaleState = typeof rawMessage === 'string' &&
                (rawMessage.includes('historical state') || rawMessage.includes('-32000'));
            const deployError = isStaleState
                ? 'Local chain state mismatch. Open MetaMask → Settings → Advanced → Reset Account, then try again.'
                : rawMessage;

            console.error('[ProjectCreationPage] Deploy failed:', deployError, err);
            this.setState({ deployStatus: 'error', deployError });
        }
    }

    // ── Event Delegation ──

    setupDOMEventListeners() {
        if (!this.element) return;

        // Abort previous listeners before re-attaching to prevent stacking
        if (this._listenerController) {
            this._listenerController.abort();
        }
        this._listenerController = new AbortController();
        const { signal } = this._listenerController;

        this.element.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;

            const action = actionEl.dataset.action;

            switch (action) {
                case 'select-collection-size':
                    this._selectCollectionSize(actionEl.dataset.size);
                    break;
                case 'select-factory':
                    this._selectFactory(actionEl.dataset.address);
                    break;
                case 'select-component':
                    this._selectComponent(actionEl.dataset.tag, actionEl.dataset.address);
                    break;
                case 'clear-component':
                    this._clearComponentSelection(actionEl.dataset.tag);
                    break;
                case 'select-launch-profile':
                    this._updateComponentConfig(actionEl.dataset.tag, {
                        ...this.state.componentConfigs[actionEl.dataset.tag],
                        presetId: parseInt(actionEl.dataset.presetId),
                    });
                    this._goNext();
                    break;
                case 'select-target':
                    this._selectTarget(actionEl.dataset.targetId);
                    break;
                case 'clear-target':
                    this.setState({ selectedTarget: null, selectedVault: null });
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
                case 'view-project': {
                    const { chainId } = detectNetwork();
                    window.location.href = `/${chainId}/${this.state.formData.name}`;
                    break;
                }
                case 'add-tier':
                    this._addPasswordTier(actionEl.dataset.tag);
                    break;
                case 'remove-tier':
                    this._removePasswordTier(actionEl.dataset.tag, parseInt(actionEl.dataset.index));
                    break;
                case 'restore-draft':
                    this._restoreDraft();
                    break;
                case 'clear-draft':
                    this._clearDraft();
                    break;
                case 'start-mining':
                    this._startMining();
                    break;
                case 'stop-mining':
                    this._stopMining();
                    break;
                case 'lock-salt':
                    this.setState({ lockedSalt: this.state.minedSalt });
                    this._saveDraft();
                    break;
                case 'unlock-salt':
                    this.setState({ lockedSalt: null });
                    this._saveDraft();
                    break;
            }
        }, { signal });

        this.element.addEventListener('change', (e) => {
            const action = e.target.dataset.action;
            if (action === 'tier-type') {
                this._setPasswordTierType(e.target.dataset.tag, e.target.value);
            } else if (action === 'mining-mode') {
                this.setState({ miningMode: e.target.value });
            } else if (e.target.dataset.freemint === 'scope') {
                this._updateFreeMint('scope', e.target.value);
            }
        }, { signal });

        this.element.addEventListener('input', (e) => {
            // Sync color picker ↔ text for inline style builder
            if (e.target.hasAttribute('data-style-token') && e.target.type === 'color') {
                const key = e.target.getAttribute('data-style-token');
                const textEl = this.element.querySelector(`[data-style-token-text="${key}"]`);
                if (textEl) textEl.value = e.target.value;
                return;
            }
            if (e.target.hasAttribute('data-style-token-text')) {
                const key = e.target.getAttribute('data-style-token-text');
                const colorEl = this.element.querySelector(`[data-style-token="${key}"]`);
                if (colorEl && e.target.value.match(/^#[0-9a-fA-F]{6}$/)) colorEl.value = e.target.value;
                return;
            }
            const action = e.target.dataset.action;
            if (action === 'mining-pattern') {
                this.setState({ miningPattern: e.target.value, miningError: null });
                return;
            }
            if (action === 'tier-password') {
                this._updatePasswordTierField(e.target.dataset.tag, parseInt(e.target.dataset.index), 'password', e.target.value);
                return;
            }
            if (action === 'tier-cap') {
                this._updatePasswordTierField(e.target.dataset.tag, parseInt(e.target.dataset.index), 'cap', e.target.value);
                return;
            }
            if (action === 'tier-delay') {
                this._updatePasswordTierField(e.target.dataset.tag, parseInt(e.target.dataset.index), 'delay', e.target.value);
                return;
            }
            if (e.target.dataset.field) {
                let value = e.target.value;
                // Name must be URL-safe: only alphanumeric, hyphens, underscores
                if (e.target.dataset.field === 'name') {
                    value = value.replace(/ /g, '_').replace(/[^0-9A-Za-z\-_]/g, '');
                    if (e.target.value !== value) {
                        e.target.value = value;
                    }
                }
                this._updateFormData(e.target.dataset.field, value);
                return;
            }
            if (e.target.dataset.freemint) {
                this._updateFreeMint(e.target.dataset.freemint, e.target.value);
                return;
            }
        }, { signal });
    }

    // ── Render ──

    shouldUpdate(oldState, newState) {
        if (oldState.loading !== newState.loading) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.currentStepIndex !== newState.currentStepIndex) { this._saveDraft(); return true; }
        if (oldState.steps !== newState.steps) return true;
        if (oldState.collectionAnswer !== newState.collectionAnswer) return true;
        if (oldState.factories !== newState.factories) return true;
        if (oldState.selectedFactory !== newState.selectedFactory) return true;
        if (oldState.componentSteps !== newState.componentSteps) return true;
        if (oldState.componentSelections !== newState.componentSelections) { this._saveDraft(); return true; }
        if (oldState.componentConfigs !== newState.componentConfigs) {
            // Re-render on structural changes only; skip re-render for password/cap/delay
            // typing to preserve input focus. Profile selection always re-renders.
            const oldCfgs = oldState.componentConfigs;
            const newCfgs = newState.componentConfigs;
            const tags = new Set([...Object.keys(oldCfgs), ...Object.keys(newCfgs)]);
            for (const t of tags) {
                if (!oldCfgs[t] || !newCfgs[t]) return true;
                if (oldCfgs[t].presetId !== newCfgs[t].presetId) return true;
                if (oldCfgs[t].tierType !== newCfgs[t].tierType) return true;
                if ((oldCfgs[t].tiers?.length || 0) !== (newCfgs[t].tiers?.length || 0)) return true;
            }
            return false;
        }
        if (oldState.selectedVault !== newState.selectedVault) { this._saveDraft(); return true; }
        if (oldState.vaults !== newState.vaults) return true;
        if (oldState.alignmentTargets !== newState.alignmentTargets) return true;
        if (oldState.selectedTarget !== newState.selectedTarget) return true;
        if (oldState.activePreviewTab !== newState.activePreviewTab) return true;
        if (oldState.configError !== newState.configError) return true;
        if (oldState.deployStatus !== newState.deployStatus) return true;
        if (oldState.deployError !== newState.deployError) return true;
        if (oldState.deployedAddress !== newState.deployedAddress) return true;
        if (oldState.hasDraft !== newState.hasDraft) return true;
        if (oldState.miningPattern !== newState.miningPattern) {
            // Update Mine button disabled state directly without re-render (preserve input focus)
            const mineBtn = this.element?.querySelector('[data-action="start-mining"]');
            if (mineBtn) mineBtn.disabled = !newState.miningPattern;
            return false;
        }
        if (oldState.miningMode !== newState.miningMode) return true;
        if (oldState.miningError !== newState.miningError) return true;
        if (oldState.miningActive !== newState.miningActive) return true;
        if (oldState.miningAttempts !== newState.miningAttempts) {
            // Update attempts counter directly in DOM — no re-render needed.
            // Avoids thrashing listeners on every 500-iteration batch, which
            // makes the Stop button unreliable.
            const attemptsEl = this.element?.querySelector('[data-mining-attempts]');
            if (attemptsEl) attemptsEl.textContent = `${newState.miningAttempts.toLocaleString()} attempts...`;
            return false;
        }
        if (oldState.minedSalt !== newState.minedSalt) return true;
        if (oldState.minedAddress !== newState.minedAddress) return true;
        if (oldState.lockedSalt !== newState.lockedSalt) return true;

        // Don't re-render for form data changes (handled by native input values)
        if (oldState.formData !== newState.formData) {
            this._saveDraft();
            return false;
        }
        if (oldState.freeMint !== newState.freeMint) return false;

        return false;
    }

    template() {
        const { loading, error } = this.state;

        if (loading) return this._renderLoading();
        if (error) return this._renderError(error);

        const connectedAddress = walletService.getAddress();
        if (!connectedAddress) return this._renderConnectWallet();

        const { hasDraft } = this.state;

        return `
            <div class="create-page">
                <div class="create-container">
                    ${this._renderHeader()}
                    ${hasDraft ? `
                        <div class="draft-notice">
                            Draft saved &mdash;
                            <button class="draft-action" data-action="restore-draft">Restore</button>
                            &middot;
                            <button class="draft-action" data-action="clear-draft">Discard</button>
                        </div>
                    ` : ''}
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
                    <div class="create-header">
                        <div class="skeleton skeleton-text title" style="width: 180px;"></div>
                        <div class="skeleton skeleton-text short" style="width: 80px;"></div>
                    </div>
                    <div class="skeleton skeleton-text short" style="width: 240px; margin-bottom: var(--space-6);"></div>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4);">
                        <div class="skeleton skeleton-box" style="height: 120px;"></div>
                        <div class="skeleton skeleton-box" style="height: 120px;"></div>
                        <div class="skeleton skeleton-box" style="height: 120px;"></div>
                    </div>
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
                <a href="/" class="create-home-link">MS2<span class="logo-tld">.fun</span></a>
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
            case STEP_COLLECTION_SIZE: return this._renderCollectionSizeStep();
            case STEP_FACTORY:        return this._renderFactoryStep();
            case STEP_COMPONENT:      return this._renderComponentStep(step.tag);
            case STEP_CONFIGURE:      return this._renderConfigureStep();
            case STEP_PREVIEW:        return this._renderPreviewStep();
            case STEP_VAULT:          return this._renderVaultStep();
            case STEP_DEPLOY:         return this._renderDeployStep();
            default: return '';
        }
    }

    // ── Step: Collection Size ──

    _renderCollectionSizeStep() {
        return `
            <div class="step-content active">
                <h2 class="step-question">How many pieces are in your collection?</h2>

                <div class="collection-size-grid">
                    <div class="collection-size-card" data-action="select-collection-size" data-size="${SIZE_MANY}">
                        <div class="collection-size-number">100+</div>
                        <div class="collection-size-label">Many pieces</div>
                        <p class="collection-size-desc">A large collection — numbered editions, a generative series, or anything with a big supply.</p>
                    </div>

                    <div class="collection-size-card" data-action="select-collection-size" data-size="${SIZE_SOME}">
                        <div class="collection-size-number">A few</div>
                        <div class="collection-size-label">Open editions</div>
                        <p class="collection-size-desc">A handful of pieces where collectors can mint their own copy — prints, zines, or open runs.</p>
                    </div>

                    <div class="collection-size-card" data-action="select-collection-size" data-size="${SIZE_OPEN}">
                        <div class="collection-size-number">?</div>
                        <div class="collection-size-label">Not sure yet</div>
                        <p class="collection-size-desc">Still figuring it out — see all options and decide.</p>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Step: Factory (format selection) ──

    _renderFactoryStep() {
        const { factories, collectionAnswer } = this.state;
        const recommended = RECOMMENDATIONS[collectionAnswer] || Object.keys(FACTORY_DISPLAY);

        // Filter or sort: recommended factories first
        const sorted = [...factories].sort((a, b) => {
            const aRec = recommended.includes(a.contractType) ? 0 : 1;
            const bRec = recommended.includes(b.contractType) ? 0 : 1;
            return aRec - bRec;
        });

        const cards = sorted.map(f => {
            const meta = f.metadata || {};
            const fallback = FACTORY_DISPLAY[f.contractType] || {};
            const name = meta.name || fallback.name || f.displayTitle || f.title;
            const subtitle = meta.subtitle || fallback.subtitle || '';
            const tagline = meta.tagline || fallback.tagline || '';
            const badge = meta.badge || fallback.badge || null;
            const isRecommended = recommended.includes(f.contractType);
            const badgeHtml = badge && isRecommended
                ? `<span class="factory-badge">${badge}</span>`
                : '';

            return `
                <div class="type-card${isRecommended ? ' recommended' : ''}"
                     data-action="select-factory" data-address="${f.address}">
                    ${badgeHtml}
                    <h3 class="type-card-title">${name}</h3>
                    ${subtitle ? `<div class="type-card-subtitle">${subtitle}</div>` : ''}
                    <p class="type-card-description">${tagline}</p>
                    <div class="type-card-action">Choose this &rarr;</div>
                </div>
            `;
        }).join('');

        const headingText = collectionAnswer === SIZE_MANY
            ? 'Great. Now pick your format.'
            : collectionAnswer === SIZE_SOME
            ? 'Open editions are perfect for a few pieces.'
            : 'All formats — pick the one that fits.';

        return `
            <div class="step-content active">
                <h2 class="step-question">${headingText}</h2>
                <div class="type-grid">${cards}</div>
                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                </div>
                            </div>
        `;
    }

    // ── Step: Component ──

    _renderComponentStep(tag) {
        const stepData = this.state.componentSteps.find(cs => cs.tag === tag);
        if (!stepData) return '';

        const selected = this.state.componentSelections[tag];
        const info = COMPONENT_INFO[stepData.tagName] || {};

        const noneCard = stepData.required ? '' : `
            <div class="component-card${selected === '0x0000000000000000000000000000000000000000' ? ' selected' : ''}"
                 data-action="select-component" data-tag="${tag}"
                 data-address="0x0000000000000000000000000000000000000000">
                <h3 class="component-card-title">Open</h3>
                <p class="type-card-description">${info.none || `Open access — no ${stepData.tagName.toLowerCase()} module.`}</p>
            </div>
        `;

        const componentCards = stepData.components.map(c => {
            const meta = c.metadata || {};
            return `
                <div class="component-card${selected === c.address ? ' selected' : ''}"
                     data-action="select-component" data-tag="${tag}" data-address="${c.address}">
                    <h3 class="component-card-title">${meta.name || c.name}</h3>
                    ${meta.subtitle ? `<div class="type-card-subtitle">${meta.subtitle}</div>` : ''}
                    ${meta.description ? `<p class="type-card-description">${meta.description}</p>` : ''}
                </div>
            `;
        }).join('');

        // If the selected component needs config, show the config form as the full step view.
        const selectedComp = selected && selected !== '0x0000000000000000000000000000000000000000'
            ? stepData.components.find(c => c.address === selected)
            : null;
        const configType = selectedComp?.metadata?.configType;

        if (configType) {
            // For password tiers: Continue gated on tiers existing (passwords validated at deploy).
            // For launch profile and others: Continue gated on full validity.
            const canContinue = configType === 'password-tier-gating'
                ? (this.state.componentConfigs[tag]?.tiers?.length || 0) > 0
                : this._isComponentConfigValid(tag, configType);
            return `
                <div class="step-content active">
                    <button class="btn btn-ghost" style="margin-bottom: var(--space-4);"
                            data-action="clear-component" data-tag="${tag}">
                        &larr; Change selection
                    </button>
                    <h2 class="step-question">${selectedComp.name}</h2>
                    ${selectedComp.metadata?.subtitle ? `<p style="margin-bottom: var(--space-6); color: var(--text-secondary);">${selectedComp.metadata.subtitle}</p>` : ''}
                    ${this._renderComponentConfigForm(tag, configType)}
                    <div class="step-nav">
                        <button class="btn btn-secondary" data-action="next-step">Skip for now &rarr;</button>
                        ${canContinue ? `<button class="btn btn-primary" data-action="next-step">Continue &rarr;</button>` : ''}
                    </div>
                                    </div>
            `;
        }

        return `
            <div class="step-content active">
                <h2 class="step-question">${info.heading || `Select ${stepData.tagName}`}</h2>
                ${info.blurb ? `<p style="margin-bottom: var(--space-6); color: var(--text-secondary);">${info.blurb}</p>` : ''}
                <div class="type-grid">
                    ${noneCard}
                    ${componentCards}
                </div>
                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                </div>
                            </div>
        `;
    }

    _renderComponentConfigForm(tag, configType) {
        if (configType === 'password-tier-gating') {
            return this._renderPasswordTierConfig(tag);
        }
        if (configType === 'launch-profile') {
            return this._renderLaunchProfileConfig(tag);
        }
        return '';
    }

    _renderLaunchProfileConfig(tag) {
        const selected = this.state.componentConfigs[tag]?.presetId;
        const cards = LAUNCH_PROFILES.map(p => `
            <div class="component-card${selected === p.presetId ? ' selected' : ''}"
                 data-action="select-launch-profile" data-tag="${tag}" data-preset-id="${p.presetId}">
                <h3 class="component-card-title">${p.name}</h3>
                <div class="type-card-subtitle">${p.subtitle}</div>
                <p class="type-card-description">${p.description}</p>
            </div>
        `).join('');
        return `<div class="type-grid" style="margin-top: var(--space-6);">${cards}</div>`;
    }

    _isComponentConfigValid(tag, configType) {
        if (configType === 'password-tier-gating') {
            const config = this.state.componentConfigs[tag];
            if (!config?.tiers?.length) return false;
            return config.tiers.every(t => t.password && t.password.trim() !== '');
        }
        if (configType === 'launch-profile') {
            return this.state.componentConfigs[tag]?.presetId !== undefined;
        }
        return true;
    }

    _renderPasswordTierConfig(tag) {
        const config = this.state.componentConfigs[tag] || { tierType: 'VOLUME_CAP', tiers: [] };
        const { tierType, tiers } = config;

        const tierRows = tiers.map((t, i) => `
            <div class="password-tier-row" data-tier-index="${i}">
                <div class="form-group" style="flex: 1; min-width: 160px;">
                    <label class="form-label">Password</label>
                    <input type="text" class="form-input" placeholder="e.g. earlybird"
                           data-action="tier-password" data-tag="${tag}" data-index="${i}"
                           value="${t.password || ''}">
                </div>
                ${tierType === 'VOLUME_CAP' ? `
                <div class="form-group" style="width: 180px;">
                    <label class="form-label">Max tokens</label>
                    <input type="number" class="form-input" placeholder="500"
                           data-action="tier-cap" data-tag="${tag}" data-index="${i}"
                           value="${t.cap || ''}">
                    <div class="form-help">Per address</div>
                </div>
                ` : `
                <div class="form-group" style="width: 180px;">
                    <label class="form-label">Unlock after</label>
                    <input type="number" class="form-input" placeholder="24"
                           data-action="tier-delay" data-tag="${tag}" data-index="${i}"
                           value="${t.delay || ''}">
                    <div class="form-help">Hours from launch</div>
                </div>
                `}
                <button class="btn btn-secondary" style="align-self: flex-end;"
                        data-action="remove-tier" data-tag="${tag}" data-index="${i}">Remove</button>
            </div>
        `).join('');

        return `
            <div class="component-config-panel" style="margin-top: var(--space-6);">
                <div class="form-section">
                    <h3 class="form-section-title">Configure Password Tiers</h3>

                    <div class="form-group" style="margin-bottom: var(--space-4);">
                        <label class="form-label">Tier type</label>
                        <div style="display: flex; gap: var(--space-3);">
                            <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer;">
                                <input type="radio" name="tier-type-${tag}" value="VOLUME_CAP"
                                       data-action="tier-type" data-tag="${tag}"
                                       ${tierType === 'VOLUME_CAP' ? 'checked' : ''}>
                                Volume cap — limit tokens per address per tier
                            </label>
                            <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer;">
                                <input type="radio" name="tier-type-${tag}" value="TIME_BASED"
                                       data-action="tier-type" data-tag="${tag}"
                                       ${tierType === 'TIME_BASED' ? 'checked' : ''}>
                                Time-based — unlock tiers in sequence
                            </label>
                        </div>
                        <div class="form-help" style="margin-top: var(--space-2);">
                            ${tierType === 'VOLUME_CAP'
                                ? 'Each password gives access to a specific token allocation. Holders of a password can buy up to their cap.'
                                : 'Each password unlocks after a set time from launch. Earlier tiers get in first.'}
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: var(--space-3);">
                        ${tiers.length === 0
                            ? `<p style="color: var(--text-secondary); font-size: var(--font-size-body-sm);">No tiers yet. Add a tier below.</p>`
                            : tierRows}
                    </div>

                    <button class="btn btn-secondary" style="margin-top: var(--space-4);"
                            data-action="add-tier" data-tag="${tag}">
                        + Add tier
                    </button>

                    ${tiers.length > 0 ? `
                    <p style="margin-top: var(--space-4); font-size: var(--font-size-body-sm); color: var(--text-secondary);">
                        Passwords are hashed in your browser before being sent on-chain — the plaintext is never stored.
                        Anyone without a password can still participate freely.
                    </p>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // ── Step: Configure ──

    _renderConfigureStep() {
        const { formData, freeMint, selectedFactory, componentSelections, configError } = this.state;
        const isERC404 = selectedFactory?.contractType === 'ERC404';

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
                               placeholder="My_Project" value="${formData.name}">
                        <div class="form-hint">Letters, numbers, hyphens, underscores only. Spaces become underscores.</div>
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
                </div>

                <div class="form-section">
                    <h3 class="form-section-title">Project Presentation</h3>
                    <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-4);">
                        How your project appears on ms2.fun — discovery feed, project page header, and social shares.
                        All of this is stored in your project's Style URI and can be updated by the owner at any time after launch.
                    </p>
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-input form-textarea" data-field="description"
                                  placeholder="Describe your project — what it is, who it's for, what makes it unique."
                                  rows="3">${formData.description}</textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label form-label-required">Project Photo</label>
                            <input type="text" class="form-input" data-field="projectPhoto"
                                   placeholder="https://... or ipfs://..." value="${formData.projectPhoto}">
                            <div class="form-help">Square avatar/icon shown alongside your project name. Minimum 400×400.</div>
                        </div>
                        <div class="form-group">
                            <label class="form-label form-label-required">Project Banner</label>
                            <input type="text" class="form-input" data-field="projectBanner"
                                   placeholder="https://... or ipfs://..." value="${formData.projectBanner}">
                            <div class="form-help">Wide image shown as the project card background. Landscape ratio (e.g. 1500×500) works best.</div>
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h3 class="form-section-title">NFT Token Base URI <span style="font-weight: normal; color: var(--text-secondary); font-size: var(--font-size-sm);">(optional)</span></h3>
                    <div class="form-group">
                        <input type="text" class="form-input" data-field="tokenBaseURI"
                               placeholder="ipfs://Qm.../ or https://api.myproject.com/metadata/" value="${formData.tokenBaseURI}">
                        <div class="form-help">
                            Base path for your NFT collection metadata. Each token's metadata is found at
                            <strong>[your URI + token number]</strong> — e.g. <code>ipfs://Qm.../1</code>.
                            Supports IPFS (<code>ipfs://</code>), Arweave (<code>ar://</code>), or HTTPS.
                            Leave blank if your art isn't ready — you can set it after launch in Admin Settings.
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h3 class="form-section-title">Custom Style <span style="font-weight: normal; color: var(--text-secondary); font-size: var(--font-size-sm);">(optional)</span></h3>
                    <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--space-4);">
                        Override design tokens to customize colors, fonts, and page background.
                        Combined with the presentation fields above into your project's Style URI.
                    </p>

                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); margin-bottom: var(--space-4);">
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: var(--font-size-caption);">Background</label>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <input type="color" data-style-token="--bg-primary" value="#ffffff"
                                       style="width: 36px; height: 32px; border: 1px solid var(--border-primary); cursor: pointer; padding: 2px;">
                                <input type="text" class="form-input" data-style-token-text="--bg-primary"
                                       placeholder="#ffffff" style="flex: 1; font-size: var(--font-size-caption);">
                            </div>
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: var(--font-size-caption);">Surface</label>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <input type="color" data-style-token="--bg-secondary" value="#fafafa"
                                       style="width: 36px; height: 32px; border: 1px solid var(--border-primary); cursor: pointer; padding: 2px;">
                                <input type="text" class="form-input" data-style-token-text="--bg-secondary"
                                       placeholder="#fafafa" style="flex: 1; font-size: var(--font-size-caption);">
                            </div>
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: var(--font-size-caption);">Text</label>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <input type="color" data-style-token="--text-primary" value="#000000"
                                       style="width: 36px; height: 32px; border: 1px solid var(--border-primary); cursor: pointer; padding: 2px;">
                                <input type="text" class="form-input" data-style-token-text="--text-primary"
                                       placeholder="#000000" style="flex: 1; font-size: var(--font-size-caption);">
                            </div>
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" style="font-size: var(--font-size-caption);">Border</label>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <input type="color" data-style-token="--border-primary" value="#000000"
                                       style="width: 36px; height: 32px; border: 1px solid var(--border-primary); cursor: pointer; padding: 2px;">
                                <input type="text" class="form-input" data-style-token-text="--border-primary"
                                       placeholder="#000000" style="flex: 1; font-size: var(--font-size-caption);">
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: var(--font-size-caption);">Font Family</label>
                        <input type="text" class="form-input" data-style-ext="font-family"
                               placeholder="'Inter', sans-serif" style="font-size: var(--font-size-caption);">
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: var(--font-size-caption);">Page Background Image</label>
                        <input type="text" class="form-input" data-style-ext="bg-image"
                               placeholder="https://... or ipfs://..." style="font-size: var(--font-size-caption);">
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: var(--font-size-caption);">Custom CSS</label>
                        <textarea class="form-input" data-style-ext="custom-css" rows="3"
                                  placeholder=".project-title { font-style: italic; }"
                                  style="font-family: var(--font-mono); font-size: var(--font-size-caption);"></textarea>
                    </div>
                </div>

                ${hasGating ? this._renderFreeMintSection(freeMint, isERC404 ? formData.nftCount : 0) : ''}

                ${configError ? `<div class="deploy-status error" style="margin-bottom: var(--space-4);">${configError}</div>` : ''}
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

    // ── Step: Preview ──

    _renderPreviewStep() {
        const { formData, activePreviewTab, selectedFactory } = this.state;
        const initial = (formData.name || 'P').charAt(0).toUpperCase();
        const meta = selectedFactory?.metadata || {};
        const fallback = FACTORY_DISPLAY[selectedFactory?.contractType] || {};
        const typeName = meta.name || fallback.name || selectedFactory?.contractType || 'Collection';

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
                    <div class="preview-featured-banner" style="${formData.projectBanner ? `background-image: url(${formData.projectBanner}); background-size: cover; background-position: center;` : ''}">
                        ${formData.projectBanner ? '' : initial}
                        <div class="preview-featured-content">
                            <div style="font-size: var(--font-size-caption); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); color: var(--text-secondary); margin-bottom: var(--space-1);">FEATURED</div>
                            <h3 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">${formData.name || 'Your Project'}</h3>
                            <div style="display: flex; gap: var(--space-2); align-items: center;">
                                <span class="badge">${typeName}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="preview-panel${activePreviewTab === 'card' ? ' active' : ''}">
                    <p class="text-secondary" style="margin-bottom: var(--space-4);">
                        This is how your project will appear in the project grid.
                    </p>
                    <div class="preview-project-card">
                        <div class="preview-card-image" style="${formData.projectPhoto ? `background-image: url(${formData.projectPhoto}); background-size: cover; background-position: center;` : ''}">
                            ${formData.projectPhoto ? '' : initial}
                        </div>
                        <div class="preview-card-content">
                            <h4 style="font-size: var(--font-size-h4); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2);">
                                ${formData.name || 'Your Project'}
                            </h4>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
                                <span class="badge">${typeName}</span>
                            </div>
                            <p class="preview-card-description">${formData.description || 'Project description will appear here.'}</p>
                        </div>
                    </div>
                </div>

                <div class="preview-panel${activePreviewTab === 'page' ? ' active' : ''}">
                    <p class="text-secondary" style="margin-bottom: var(--space-4);">
                        This is how your custom project page will look.
                    </p>
                    <div class="preview-custom-page" style="${formData.projectBanner ? `background-image: url(${formData.projectBanner}); background-size: cover; background-position: center;` : ''}">
                        <div style="text-align: center; padding: var(--space-8) var(--space-4); ${formData.projectBanner ? 'background: rgba(0,0,0,0.5);' : ''} width: 100%;">
                            <div style="font-size: var(--font-size-h1); font-weight: var(--font-weight-bold); margin-bottom: var(--space-3); ${formData.projectBanner ? 'color: #fff;' : ''}">
                                ${formData.name || 'Your Project'}
                            </div>
                            <p style="max-width: 600px; margin: 0 auto; ${formData.projectBanner ? 'color: rgba(255,255,255,0.85);' : ''}">
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
        const { formData, selectedFactory, componentSelections, componentSteps, freeMint, collectionAnswer } = this.state;
        const meta = selectedFactory?.metadata || {};
        const display = { ...( FACTORY_DISPLAY[selectedFactory?.contractType] || {}), ...meta };

        const sizeLabels = {
            [SIZE_MANY]: 'Many pieces (100+)',
            [SIZE_SOME]: 'A few pieces (open editions)',
            [SIZE_OPEN]: 'Not decided yet',
        };

        const rows = [
            ['Collection', sizeLabels[collectionAnswer] || '—'],
            ['Format', display.name || selectedFactory?.displayTitle || selectedFactory?.title || '—'],
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

    // ── Step: Vault ──

    _renderVaultStep() {
        const { vaults, alignmentTargets, selectedTarget, selectedVault } = this.state;

        if (vaults.length === 0 && alignmentTargets.length === 0) {
            this._loadVaults();
        }

        // Phase 2: vault picked for target — show vault selection
        if (selectedTarget) {
            const VAULT_TYPE_LABELS = {
                'UNIv4': 'Uniswap V4',
                'ZAMM': 'ZAMM',
                'CYPHER': 'Cypher',
            };
            const targetVaults = selectedTarget.vaults || [];
            const vaultCards = targetVaults.map(v => {
                // Vault type is the second word in the name e.g. "MS2 UNIv4" → "UNIv4"
                const typeKey = v.name?.split(' ').slice(1).join(' ') || '';
                const vaultType = VAULT_TYPE_LABELS[typeKey] || typeKey || 'Vault';
                const etherscanUrl = getExplorerUrl(v.address);
                const descHtml = v.description
                    ? `<p class="type-card-description" style="margin: var(--space-2) 0 var(--space-3); color: var(--text-secondary); font-size: var(--font-size-small);">${v.description}</p>`
                    : '';
                return `
                    <div class="component-card${selectedVault?.address === v.address ? ' selected' : ''}"
                         data-action="select-vault" data-address="${v.address}">
                        <h3 class="component-card-title">${vaultType}</h3>
                        ${descHtml}
                        <span class="type-card-subtitle" style="font-family: var(--font-mono); color: var(--text-tertiary);">${v.address.slice(0, 8)}...${v.address.slice(-4)}${etherscanUrl
                            ? ` <a href="${etherscanUrl}" target="_blank" rel="noopener"
                                  style="color: var(--text-tertiary); text-decoration: none; font-size: var(--font-size-caption);"
                                  onclick="event.stopPropagation();">↗</a>`
                            : ''
                        }</span>
                    </div>
                `;
            }).join('');

            const deployCard = `
                <div class="component-card" style="border-style: dashed; opacity: 0.6; cursor: default;">
                    <h3 class="component-card-title">+ Deploy New Vault</h3>
                    <p class="type-card-description">
                        Need a different vault type? New vault types coming soon.
                    </p>
                </div>
            `;

            return `
                <div class="step-content active">
                    <button class="btn btn-ghost" style="margin-bottom: var(--space-4);"
                            data-action="clear-target">
                        &larr; Change target
                    </button>
                    <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-2); text-transform: uppercase;">
                        ${selectedTarget.title}
                    </h2>
                    <p style="margin-bottom: var(--space-6); color: var(--text-secondary);">Choose a vault. Your project's fees flow here and buy the alignment token.</p>
                    <div class="type-grid">
                        ${vaultCards}
                        ${deployCard}
                    </div>
                    <div class="step-nav">
                        <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                        <button class="btn btn-primary" data-action="next-step"
                                ${!selectedVault ? 'disabled' : ''}>Continue &rarr;</button>
                    </div>
                                    </div>
            `;
        }

        // Phase 1: pick alignment target
        const targetCards = alignmentTargets.length > 0
            ? alignmentTargets.map(t => `
                <div class="component-card" data-action="select-target" data-target-id="${t.targetId}">
                    <h3 class="component-card-title">${t.title}</h3>
                    <div class="type-card-subtitle">${t.vaults.length} vault${t.vaults.length !== 1 ? 's' : ''} available</div>
                </div>
            `).join('')
            : `
                <div class="skeleton skeleton-box" style="height: 72px;"></div>
                <div class="skeleton skeleton-box" style="height: 72px;"></div>
                <div class="skeleton skeleton-box" style="height: 72px;"></div>
            `;

        return `
            <div class="step-content active">
                <h2 style="font-size: var(--font-size-h2); font-weight: var(--font-weight-bold); margin-bottom: var(--space-6); text-transform: uppercase;">
                    Choose Alignment Target
                </h2>
                <p style="margin-bottom: var(--space-6); color: var(--text-secondary);">
                    Your project aligns to a community. 20% of all fees flow to a vault that buys and LPs that community's token — strengthening both projects.
                </p>
                <div class="type-grid">
                    ${targetCards}
                </div>
                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step">&larr; Back</button>
                </div>
                            </div>
        `;
    }

    // ── Step: Deploy ──

    _renderDeployStep() {
        const { deployStatus, deployedAddress } = this.state;

        if (deployStatus === 'success' && deployedAddress) {
            const truncated = `${deployedAddress.slice(0, 6)}...${deployedAddress.slice(-4)}`;
            const explorerUrl = getExplorerUrl(deployedAddress);
            const addressEl = explorerUrl
                ? `<a class="success-address" href="${explorerUrl}" target="_blank" rel="noopener noreferrer">${truncated}</a>`
                : `<div class="success-address">${truncated}</div>`;

            return `
                <div class="step-content active">
                    <div class="success-state">
                        <div class="success-icon">&check;</div>
                        <h2 class="success-title">Project Created</h2>
                        <p class="text-secondary" style="margin-bottom: var(--space-2);">Your project has been deployed successfully.</p>
                        ${addressEl}
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
                        <p><strong>Deployment failed.</strong> ${this.state.deployError || 'An unexpected error occurred.'}</p>
                    </div>
                ` : ''}

                ${deployStatus === 'pending' || deployStatus === 'confirming' ? `
                    <div class="deploy-status pending">
                        <p>${deployStatus === 'pending' ? 'Waiting for wallet confirmation...' : 'Transaction submitted. Waiting for confirmation...'}</p>
                    </div>
                ` : ''}

                ${this._renderVanityMiningPanel()}

                <div class="step-nav">
                    <button class="btn btn-secondary" data-action="prev-step"
                            ${deployStatus === 'pending' || deployStatus === 'confirming' ? 'disabled' : ''}>&larr; Back</button>
                    <button class="btn btn-primary" data-action="deploy"
                            ${deployStatus === 'pending' || deployStatus === 'confirming' ? 'disabled' : ''}>Deploy Project</button>
                </div>
            </div>
        `;
    }

    _renderVanityMiningPanel() {
        const { miningPattern, miningMode, miningActive, miningAttempts, miningError, minedSalt, minedAddress, lockedSalt, selectedFactory } = this.state;
        const factoryAddress = selectedFactory?.address || '(factory not selected)';
        const walletAddress = walletService.getAddress() || '(wallet not connected)';

        return `
            <div class="vanity-panel">
                <div class="vanity-panel-header">
                    <div style="display: flex; align-items: center; gap: var(--space-2);">
                        <span class="text-uppercase" style="font-size: var(--font-size-body-sm); letter-spacing: var(--letter-spacing-wide); font-weight: var(--font-weight-bold);">Vanity Address</span>
                        <span class="vanity-info-trigger" tabindex="0" aria-label="About vanity address mining">&#9432;
                            <span class="vanity-info-tooltip">
                                <strong>Browser mining</strong> mines salts locally in JS. Each extra hex character takes ~16× longer to find.<br><br>
                                For GPU-accelerated mining (thousands per second), use <strong>createxcrunch</strong> by HrikB on GitHub. Run it with:<br>
                                <code style="display:block;margin:4px 0;word-break:break-all;">--factory ${factoryAddress}</code>
                                <code style="display:block;margin:4px 0;word-break:break-all;">--deployer ${walletAddress}</code>
                                Once you have a salt, paste it as your identity salt before deploying. Lock it in below to save it to your draft.
                            </span>
                        </span>
                    </div>
                    <span class="text-secondary" style="font-size: var(--font-size-body-sm);">Mine a contract address that starts or ends with a custom pattern</span>
                </div>

                ${lockedSalt ? `
                    <div class="vanity-locked">
                        <span style="font-size: var(--font-size-body-xs); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Salt locked</span>
                        <code style="font-family: var(--font-mono); font-size: var(--font-size-body-xs); word-break: break-all; flex: 1;">${lockedSalt}</code>
                        <button class="btn btn-secondary btn-sm" data-action="unlock-salt">Clear</button>
                    </div>
                ` : ''}

                <div class="vanity-panel-controls">
                    <div style="display: flex; gap: var(--space-2); align-items: center;">
                        <input
                            type="text"
                            id="vanity-pattern"
                            name="vanity-pattern"
                            class="input"
                            placeholder="e.g. dead, cafe, 0000"
                            value="${miningPattern}"
                            data-action="mining-pattern"
                            style="flex: 1; font-family: var(--font-mono);"
                            ${miningActive ? 'disabled' : ''}
                        />
                        <label style="display: flex; align-items: center; gap: var(--space-1); cursor: pointer;">
                            <input type="radio" name="mining-mode" data-action="mining-mode" value="prefix"
                                   ${miningMode === 'prefix' ? 'checked' : ''} ${miningActive ? 'disabled' : ''} />
                            Prefix
                        </label>
                        <label style="display: flex; align-items: center; gap: var(--space-1); cursor: pointer;">
                            <input type="radio" name="mining-mode" data-action="mining-mode" value="suffix"
                                   ${miningMode === 'suffix' ? 'checked' : ''} ${miningActive ? 'disabled' : ''} />
                            Suffix
                        </label>
                    </div>

                    <div style="display: flex; gap: var(--space-2); align-items: center; margin-top: var(--space-2);">
                        ${miningActive ? `
                            <button class="btn btn-secondary" data-action="stop-mining">Stop</button>
                            <span class="text-secondary" data-mining-attempts style="font-size: var(--font-size-body-sm);">${miningAttempts.toLocaleString()} attempts...</span>
                        ` : `
                            <button class="btn btn-secondary" data-action="start-mining"
                                    ${miningPattern ? '' : 'disabled'}>Mine</button>
                            ${miningError ? `
                                <span style="color: var(--color-error, #e53e3e); font-size: var(--font-size-body-sm);">${miningError}</span>
                            ` : miningAttempts > 0 && !minedAddress ? `
                                <span class="text-secondary" style="font-size: var(--font-size-body-sm);">Stopped after ${miningAttempts.toLocaleString()} attempts</span>
                            ` : ''}
                        `}
                    </div>
                </div>

                ${minedAddress ? `
                    <div class="vanity-result">
                        <span class="text-secondary" style="font-size: var(--font-size-body-sm);">Found after ${miningAttempts.toLocaleString()} attempts:</span>
                        <code style="font-family: var(--font-mono); font-size: var(--font-size-body-sm); word-break: break-all;">${minedAddress}</code>
                        <div style="display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-1);">
                            ${lockedSalt === minedSalt ? `
                                <span style="font-size: var(--font-size-body-xs);">&#10003; Locked in — saved to draft</span>
                            ` : `
                                <button class="btn btn-primary btn-sm" data-action="lock-salt">Lock in &rarr;</button>
                                <span class="text-secondary" style="font-size: var(--font-size-body-xs);">Locks the salt to your draft so it survives page refresh.</span>
                            `}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

}
