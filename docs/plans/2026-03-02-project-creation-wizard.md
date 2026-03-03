# Project Creation Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a data-driven project creation wizard that dynamically generates steps from on-chain registries (factories, components, vaults), following the Gallery Brutalism v2 design from `docs/examples/create-project-v2-demo.html`.

**Architecture:** Single `ProjectCreationPage` component extending `Component` from `src/core/Component.js`. The wizard queries `MasterRegistryV1` for factories and vaults, calls `features()` on the selected factory to discover which component tags it supports, then queries `ComponentRegistry` for approved components per tag. Steps are generated dynamically — new factories, components, and vaults appear automatically when registered on-chain. `requiredFeatures()` distinguishes mandatory selections (no "None" option) from optional ones.

**Tech Stack:** Microact Component pattern (extends `src/core/Component.js`), ethers v5 (CDN import), `ContractAdapter` base class, route CSS via `stylesheetLoader`, event-delegated DOM updates.

**Demo source of truth:** `docs/examples/create-project-v2-demo.html` — all CSS classes and HTML structure must match exactly.

---

## Task 1: Export ComponentRegistry ABI

The frontend needs ABIs for `ComponentRegistry` and `IFactory` (for calling `features()` / `requiredFeatures()` on arbitrary factory addresses). Local dev loads from Forge artifacts in `contracts/out/`, but we need entries in `contracts/abi/` for production parity.

**Files:**
- Create: `contracts/abi/ComponentRegistry.json`
- Create: `contracts/abi/IFactory.json`

**Step 1: Build contracts to generate artifacts**

```bash
cd contracts && forge build --skip "test/**" --skip "script/**"
```

Expected: Compiles successfully, artifacts in `contracts/out/`.

**Step 2: Extract ComponentRegistry ABI**

```bash
cd contracts && cat out/ComponentRegistry.sol/ComponentRegistry.json | jq '.abi' > abi/ComponentRegistry.json
```

Verify the file contains an array with functions: `isApprovedComponent`, `getApprovedComponents`, `getApprovedComponentsByTag`, `componentName`, `componentTag`, `isApproved`, `allComponents`.

**Step 3: Extract minimal IFactory ABI**

Create `contracts/abi/IFactory.json` manually (it's tiny):

```json
[
  {
    "inputs": [],
    "name": "features",
    "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "requiredFeatures",
    "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "protocol",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
]
```

**Step 4: Add ComponentRegistry to contracts.local.json**

Modify: `src/config/contracts.local.json`

Add `"ComponentRegistry": "0x..."` to the `contracts` object. The address comes from the local deploy script — check `scripts/local-chain/deploy-contracts.mjs` or run the deploy to get the address. If not yet deployed locally, use `"0x0000000000000000000000000000000000000000"` as placeholder and note it needs deploy script update.

**Step 5: Commit**

```bash
git add contracts/abi/ComponentRegistry.json contracts/abi/IFactory.json src/config/contracts.local.json
git commit -m "feat: export ComponentRegistry and IFactory ABIs for frontend"
```

---

## Task 2: Create ComponentRegistryAdapter

New adapter that wraps `ComponentRegistry.sol` view functions for the wizard.

**Files:**
- Create: `src/services/contracts/ComponentRegistryAdapter.js`
- Modify: `src/services/ServiceFactory.js` (add getter)

**Step 1: Create the adapter**

Create `src/services/contracts/ComponentRegistryAdapter.js`:

```javascript
/**
 * ComponentRegistry Adapter
 *
 * Wraps ComponentRegistry contract for querying DAO-approved components.
 * Used by the creation wizard to discover available gating modules,
 * liquidity deployers, and future component types.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';

const CACHE_TTL = {
    COMPONENTS: 5 * 60 * 1000, // 5 minutes — component approval changes are rare
};

// Tag constants matching FeatureUtils.sol
const TAGS = {
    GATING: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating')),
    LIQUIDITY_DEPLOYER: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity')),
};

class ComponentRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ComponentRegistry', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() {
        if (this.provider && this.provider.isMock === true) {
            this.initialized = true;
            this.isMock = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType,
                isMock: true
            });
            return true;
        }

        const abi = await loadABI('ComponentRegistry');
        this.contract = new this.ethers.Contract(
            this.contractAddress, abi, this.signer || this.provider
        );
        this.initialized = true;
        eventBus.emit('contract:adapter:initialized', {
            contractAddress: this.contractAddress,
            contractType: this.contractType
        });
        return true;
    }

    /**
     * Get all approved components for a given tag hash.
     * @param {string} tagHash - bytes32 keccak256 tag (use TAGS constant)
     * @returns {Promise<Array<{address: string, name: string, tag: string}>>}
     */
    async getComponentsByTag(tagHash) {
        return this.getCachedOrFetch('getComponentsByTag', [tagHash], async () => {
            if (this.isMock) return this._getMockComponentsByTag(tagHash);

            const addresses = await this.executeContractCall(
                'getApprovedComponentsByTag', [tagHash]
            );

            const components = [];
            for (const addr of addresses) {
                const name = await this.executeContractCall('componentName', [addr]);
                components.push({ address: addr, name, tag: tagHash });
            }
            return components;
        }, CACHE_TTL.COMPONENTS);
    }

    /**
     * Check if a specific component is approved.
     * @param {string} address - Component contract address
     * @returns {Promise<boolean>}
     */
    async isApproved(address) {
        if (this.isMock) return true;
        return this.executeContractCall('isApprovedComponent', [address]);
    }

    /**
     * Get all approved components (all tags).
     * @returns {Promise<Array<{address: string, name: string, tag: string}>>}
     */
    async getAllComponents() {
        return this.getCachedOrFetch('getAllComponents', [], async () => {
            if (this.isMock) return this._getMockAllComponents();

            const addresses = await this.executeContractCall('getApprovedComponents', []);
            const components = [];
            for (const addr of addresses) {
                const name = await this.executeContractCall('componentName', [addr]);
                const tag = await this.executeContractCall('componentTag', [addr]);
                components.push({ address: addr, name, tag });
            }
            return components;
        }, CACHE_TTL.COMPONENTS);
    }

    // ── Mock data for PLACEHOLDER_MOCK mode ──

    _getMockComponentsByTag(tagHash) {
        if (tagHash === TAGS.GATING) {
            return [
                { address: '0xMOCK_GATING_001', name: 'Password Tier Gating', tag: tagHash },
                { address: '0xMOCK_GATING_002', name: 'Merkle Allowlist Gating', tag: tagHash },
            ];
        }
        if (tagHash === TAGS.LIQUIDITY_DEPLOYER) {
            return [
                { address: '0xMOCK_LIQ_UNI', name: 'Uniswap V4 Deployer', tag: tagHash },
                { address: '0xMOCK_LIQ_ZAMM', name: 'ZAMM Deployer', tag: tagHash },
                { address: '0xMOCK_LIQ_CYPHER', name: 'Algebra V2 Deployer', tag: tagHash },
            ];
        }
        return [];
    }

    _getMockAllComponents() {
        return [
            ...this._getMockComponentsByTag(TAGS.GATING),
            ...this._getMockComponentsByTag(TAGS.LIQUIDITY_DEPLOYER),
        ];
    }
}

export { TAGS };
export default ComponentRegistryAdapter;
```

**Step 2: Wire into ServiceFactory**

Modify `src/services/ServiceFactory.js`:

Add to class properties (near other adapter caches):
```javascript
this.componentRegistryAdapter = null;
```

Add getter method (follow pattern of existing getters like `getMasterRegistryAdapter`):
```javascript
async getComponentRegistryAdapter() {
    if (this.componentRegistryAdapter) return this.componentRegistryAdapter;

    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
    const { default: ComponentRegistryAdapter } = await import('./contracts/ComponentRegistryAdapter.js');

    const address = this.getContractAddress('ComponentRegistry');
    if (!address || address === ethers.constants.AddressZero) {
        console.warn('[ServiceFactory] ComponentRegistry not configured');
        return null;
    }

    const { provider, signer } = await this._getProviderAndSigner();
    this.componentRegistryAdapter = new ComponentRegistryAdapter(address, 'ComponentRegistry', provider, signer);
    await this.componentRegistryAdapter.initialize();
    return this.componentRegistryAdapter;
}
```

Add to `clearCache()`:
```javascript
this.componentRegistryAdapter = null;
```

**Step 3: Commit**

```bash
git add src/services/contracts/ComponentRegistryAdapter.js src/services/ServiceFactory.js
git commit -m "feat: add ComponentRegistryAdapter for querying approved components"
```

---

## Task 3: Add Factory Feature Querying

The wizard needs to call `features()` and `requiredFeatures()` on individual factory contract addresses. This uses the `IFactory` ABI loaded against the factory address.

**Files:**
- Modify: `src/services/contracts/MasterRegistryAdapter.js`

**Step 1: Add factory feature methods to MasterRegistryAdapter**

Add these methods to the `MasterRegistryAdapter` class. They create a temporary ethers.Contract using the `IFactory` ABI to call `features()` / `requiredFeatures()` on a specific factory address:

```javascript
/**
 * Get features (component tags) supported by a factory.
 * @param {string} factoryAddress
 * @returns {Promise<string[]>} Array of bytes32 tag hashes
 */
async getFactoryFeatures(factoryAddress) {
    return this.getCachedOrFetch('getFactoryFeatures', [factoryAddress], async () => {
        if (this.isMock) return this._getMockFactoryFeatures(factoryAddress);

        const { loadABI } = await import('../../utils/abiLoader.js');
        const abi = await loadABI('IFactory');
        const factoryContract = new this.ethers.Contract(
            factoryAddress, abi, this.signer || this.provider
        );
        return await factoryContract.features();
    }, 60 * 60 * 1000); // 1 hour — features don't change after deploy
}

/**
 * Get required features (mandatory component tags) for a factory.
 * @param {string} factoryAddress
 * @returns {Promise<string[]>} Array of bytes32 tag hashes that are mandatory
 */
async getFactoryRequiredFeatures(factoryAddress) {
    return this.getCachedOrFetch('getFactoryRequiredFeatures', [factoryAddress], async () => {
        if (this.isMock) return this._getMockRequiredFeatures(factoryAddress);

        const { loadABI } = await import('../../utils/abiLoader.js');
        const abi = await loadABI('IFactory');
        const factoryContract = new this.ethers.Contract(
            factoryAddress, abi, this.signer || this.provider
        );
        return await factoryContract.requiredFeatures();
    }, 60 * 60 * 1000);
}

/**
 * Get active factories with their info from MasterRegistry.
 * @returns {Promise<Array<{address, factoryId, contractType, title, displayTitle, metadataURI, features, active}>>}
 */
async getActiveFactories() {
    return this.getCachedOrFetch('getActiveFactories', [], async () => {
        if (this.isMock) return this._getMockActiveFactories();

        const totalFactories = await this.executeContractCall('nextFactoryId', []);
        const count = Number(totalFactories);
        const factories = [];

        for (let i = 1; i < count; i++) {
            const address = await this.executeContractCall('factoryIdToAddress', [i]);
            if (address === this.ethers.constants.AddressZero) continue;

            const info = await this.executeContractCall('factoryInfo', [address]);
            if (!info.active) continue;

            factories.push({
                address: info.factoryAddress,
                factoryId: Number(info.factoryId),
                contractType: info.contractType,
                title: info.title,
                displayTitle: info.displayTitle,
                metadataURI: info.metadataURI,
                features: info.features,
                active: info.active,
            });
        }
        return factories;
    }, 5 * 60 * 1000);
}

/**
 * Get active vaults from MasterRegistry.
 * @returns {Promise<Array<{address, name, metadataURI, targetId, active}>>}
 */
async getActiveVaults() {
    return this.getCachedOrFetch('getActiveVaults', [], async () => {
        if (this.isMock) return this._getMockActiveVaults();

        // Query via registered vaults — iterate registeredVaults mapping
        // This is a simplification; may need QueryAggregator for production
        const vaultData = [];
        // TODO: MasterRegistryV1 doesn't have a vault enumeration function.
        // For now, use vaults from contracts.local.json config.
        // Future: add getRegisteredVaults() to MasterRegistryV1 or use QueryAggregator.
        return vaultData;
    }, 5 * 60 * 1000);
}

// ── Mock helpers ──

_getMockFactoryFeatures(factoryAddress) {
    // ERC404 factories have GATING + LIQUIDITY_DEPLOYER
    // ERC1155 factories have GATING only
    // ERC721 factories have none
    const { TAGS } = ComponentRegistryAdapter || {};
    const gatingTag = this.ethers.utils.keccak256(this.ethers.utils.toUtf8Bytes('gating'));
    const liqTag = this.ethers.utils.keccak256(this.ethers.utils.toUtf8Bytes('liquidity'));

    if (factoryAddress.includes('404')) return [gatingTag, liqTag];
    if (factoryAddress.includes('1155')) return [gatingTag];
    return [];
}

_getMockRequiredFeatures(factoryAddress) {
    const liqTag = this.ethers.utils.keccak256(this.ethers.utils.toUtf8Bytes('liquidity'));
    if (factoryAddress.includes('404')) return [liqTag];
    return [];
}

_getMockActiveFactories() {
    return [
        {
            address: '0xMOCK_FACTORY_404',
            factoryId: 1,
            contractType: 'ERC404',
            title: 'ERC404Factory',
            displayTitle: 'ERC404 Bonding Curve',
            metadataURI: '',
            features: [],
            active: true,
        },
        {
            address: '0xMOCK_FACTORY_1155',
            factoryId: 2,
            contractType: 'ERC1155',
            title: 'ERC1155Factory',
            displayTitle: 'ERC1155 Open Editions',
            metadataURI: '',
            features: [],
            active: true,
        },
        {
            address: '0xMOCK_FACTORY_721',
            factoryId: 3,
            contractType: 'ERC721',
            title: 'ERC721AuctionFactory',
            displayTitle: 'ERC721 Auctions',
            metadataURI: '',
            features: [],
            active: true,
        },
    ];
}

_getMockActiveVaults() {
    return [
        { address: '0xMOCK_VAULT_ALPHA', name: 'Alpha Vault', metadataURI: '', targetId: 1, active: true },
        { address: '0xMOCK_VAULT_BETA', name: 'Beta Vault', metadataURI: '', targetId: 1, active: true },
        { address: '0xMOCK_VAULT_GAMMA', name: 'Gamma Vault', metadataURI: '', targetId: 2, active: true },
    ];
}
```

**Step 2: Commit**

```bash
git add src/services/contracts/MasterRegistryAdapter.js
git commit -m "feat: add factory feature querying and vault enumeration to MasterRegistryAdapter"
```

---

## Task 4: Create Route CSS

Extract all wizard-specific CSS from the demo HTML into the route stylesheet.

**Files:**
- Create: `src/core/route-create-v2.css`

**Step 1: Create the stylesheet**

Copy the entire contents of the `<style>` block from `docs/examples/create-project-v2-demo.html` (lines 10-329) into `src/core/route-create-v2.css`. This includes all classes: `.create-page`, `.create-container`, `.create-header`, `.create-title`, `.breadcrumb`, `.breadcrumb-item`, `.step-content`, `.type-grid`, `.type-card`, `.form-section`, `.form-section-title`, `.form-row`, `.preview-tabs`, `.preview-tab`, `.preview-panel`, `.preview-featured-banner`, `.preview-featured-content`, `.preview-project-card`, `.preview-card-image`, `.preview-card-content`, `.preview-card-description`, `.preview-card-tvl`, `.preview-custom-page`, `.vault-grid`, `.vault-card`, `.vault-name`, `.vault-tvl`, `.step-nav`, `.success-state`, `.success-icon`, `.success-title`, `.success-address`.

Add these additional classes at the bottom for the dynamic component steps and governance footers:

```css
/* Component Selection (reuses type-card pattern) */
.component-card {
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    padding: var(--space-6);
    cursor: pointer;
    transition: var(--transition-base);
    display: flex;
    flex-direction: column;
}

.component-card:hover {
    background-color: var(--state-hover-bg);
}

.component-card.selected {
    border-color: var(--border-primary);
    border-width: 2px;
}

.component-card-title {
    font-size: var(--font-size-h4);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    margin-bottom: var(--space-2);
}

.component-card-address {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--text-tertiary);
}

/* Free Mint Section */
.free-mint-section {
    margin-top: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border-tertiary);
}

.free-mint-title {
    font-size: var(--font-size-body-sm);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: var(--letter-spacing-wide);
    margin-bottom: var(--space-3);
}

/* Governance / X Footer */
.step-footer {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-tertiary);
    display: flex;
    gap: var(--space-4);
    align-items: center;
    font-size: var(--font-size-body-sm);
    color: var(--text-tertiary);
}

.step-footer a {
    color: var(--text-secondary);
    text-decoration: underline;
}

.step-footer a:hover {
    color: var(--text-primary);
}

/* Deploy status */
.deploy-status {
    margin-top: var(--space-6);
    padding: var(--space-4);
    border: 1px solid var(--border-secondary);
}

.deploy-status.pending {
    border-color: var(--border-secondary);
}

.deploy-status.success {
    border-color: var(--border-primary);
}

.deploy-status.error {
    border-color: var(--text-primary);
}
```

**Step 2: Commit**

```bash
git add src/core/route-create-v2.css
git commit -m "feat: add route-create-v2.css from demo with component/governance additions"
```

---

## Task 5: ProjectCreationPage — Skeleton + Factory Selection (Step 1)

Build the wizard component skeleton with state management, breadcrumb, and the first step.

**Files:**
- Create: `src/routes/ProjectCreationPage.js`

**Step 1: Create the component**

Create `src/routes/ProjectCreationPage.js`. The component extends `Component`, manages wizard state, and renders steps conditionally. Event delegation via the `events()` method handles all clicks without per-render rebinding.

```javascript
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

import Component from '../core/Component.js';
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

    _buildSteps() {
        const steps = [{ type: STEP_FACTORY, label: '1. Factory' }];
        let num = 2;

        for (const cs of this.state.componentSteps) {
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
                        // Derive human-readable tag name from first component's tag or decode
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
        // Implemented in Task 10
    }

    // ── Event Delegation ──

    events() {
        return {
            'click [data-action="select-factory"]': (e) => {
                const address = e.currentTarget.dataset.address;
                this._selectFactory(address);
            },
            'click [data-action="select-component"]': (e) => {
                const tag = e.currentTarget.dataset.tag;
                const address = e.currentTarget.dataset.address;
                this._selectComponent(tag, address);
            },
            'click [data-action="select-vault"]': (e) => {
                const address = e.currentTarget.dataset.address;
                this._selectVault(address);
            },
            'click [data-action="next-step"]': () => this._goNext(),
            'click [data-action="prev-step"]': () => this._goBack(),
            'click [data-action="preview-tab"]': (e) => {
                this.setState({ activePreviewTab: e.currentTarget.dataset.tab });
            },
            'click [data-action="deploy"]': () => this._deploy(),
            'click [data-action="view-project"]': () => {
                window.location.href = `/project/${this.state.deployedAddress}`;
            },
            'input [data-field]': (e) => {
                this._updateFormData(e.target.dataset.field, e.target.value);
            },
            'input [data-freemint]': (e) => {
                this._updateFreeMint(e.target.dataset.freemint, e.target.value);
            },
            'change [data-freemint="scope"]': (e) => {
                this._updateFreeMint('scope', e.target.value);
            },
        };
    }

    // ── Render ──

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

        // Group factories by contractType
        const groups = {};
        for (const f of factories) {
            if (!groups[f.contractType]) groups[f.contractType] = [];
            groups[f.contractType].push(f);
        }

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
        // Fallback descriptions when metadataURI isn't parsed yet
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
```

**Step 2: Commit**

```bash
git add src/routes/ProjectCreationPage.js
git commit -m "feat: add ProjectCreationPage wizard with dynamic component steps"
```

---

## Task 6: Wire Deploy Logic

Implement the actual contract call that deploys the instance.

**Files:**
- Modify: `src/routes/ProjectCreationPage.js` (the `_deploy` method)

**Step 1: Implement _deploy**

Replace the empty `_deploy()` method in ProjectCreationPage with:

```javascript
async _deploy() {
    const {
        selectedFactory, componentSelections, formData,
        freeMint, selectedVault, componentSteps
    } = this.state;

    if (!selectedFactory || !selectedVault) return;

    this.setState({ deployStatus: 'pending' });

    try {
        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        const { provider, signer } = await walletService.getProviderAndSigner();
        if (!signer) throw new Error('Wallet not connected');

        const { loadABI } = await import('../utils/abiLoader.js');
        const abi = await loadABI(selectedFactory.title || 'ERC404Factory');
        const factoryContract = new ethers.Contract(selectedFactory.address, abi, signer);

        // Build call args based on factory type
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
```

**Step 2: Commit**

```bash
git add src/routes/ProjectCreationPage.js
git commit -m "feat: implement deploy logic for all factory types"
```

---

## Task 7: Wire Route in index.js

Replace the old `/create` route handler with the new v2 microact pattern.

**Files:**
- Modify: `src/index.js`

**Step 1: Find the existing `/create` route handler**

Search `src/index.js` for the line `router.on('/create'` — this is the old handler that imports and calls `renderProjectCreation`. Replace it with the v2 pattern matching how `/portfolio`, `/discover`, etc. are registered.

**Step 2: Replace with v2 handler**

```javascript
router.on('/create', async () => {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    document.body.classList.remove('marble-bg', 'obsidian-bg');
    document.body.classList.add('v2-route');

    const { default: ProjectCreationPage } = await import('./routes/ProjectCreationPage.js');
    const page = new ProjectCreationPage(appContainer);
    page.mount(appContainer);

    return {
        cleanup: () => {
            page.unmount();
            document.body.classList.remove('v2-route');
            document.body.classList.add('marble-bg');
            stylesheetLoader.unload('route:create');
        }
    };
});
```

Also remove the old `/:chainId/:factoryTitle/create` route if it exists and points to `renderProjectCreation` — the wizard now handles factory selection internally.

**Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: wire ProjectCreationPage into /create route"
```

---

## Task 8: Update Local Deploy Scripts

The local dev chain needs to deploy `ComponentRegistry` and seed it with test components for the wizard to query.

**Files:**
- Modify: `scripts/local-chain/deploy-contracts.mjs`
- Modify: `scripts/local-chain/seed-common.mjs`
- Modify: `src/config/contracts.local.json`

**Step 1: Check current deploy script**

Read `scripts/local-chain/deploy-contracts.mjs` to understand the deployment pattern. Add ComponentRegistry deployment after MasterRegistry, then call `masterRegistry.setComponentRegistry(componentRegistryAddress)`.

**Step 2: Add ComponentRegistry deploy**

After the MasterRegistry deploy block, add:

```javascript
// Deploy ComponentRegistry
const ComponentRegistry = await deployContract('ComponentRegistry', []);
await ComponentRegistry.initialize(deployer.address);
console.log('ComponentRegistry deployed:', ComponentRegistry.address);

// Wire into MasterRegistry
await masterRegistry.setComponentRegistry(ComponentRegistry.address);
```

**Step 3: Seed test components**

In `scripts/local-chain/seed-common.mjs` or a new seed function, add:

```javascript
// Register test gating module
const gatingTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating'));
await componentRegistry.approveComponent(tierGatingModule.address, gatingTag, 'Password Tier Gating');

// Register liquidity deployers
const liqTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity'));
await componentRegistry.approveComponent(liquidityDeployer.address, liqTag, 'Uniswap V4 Deployer');
// Add ZAMM/Cypher deployers if deployed
```

**Step 4: Update contracts.local.json**

After running the deploy, update `src/config/contracts.local.json` with the deployed ComponentRegistry address.

**Step 5: Commit**

```bash
git add scripts/local-chain/deploy-contracts.mjs scripts/local-chain/seed-common.mjs src/config/contracts.local.json
git commit -m "feat: deploy ComponentRegistry in local chain and seed test components"
```

---

## Task 9: Smoke Test

Verify the full wizard flow works end-to-end.

**Step 1: Start local chain**

```bash
npm run chain:start
```

**Step 2: Deploy contracts**

```bash
npm run chain:deploy
```

**Step 3: Start dev server**

```bash
npm run dev
```

**Step 4: Manual smoke test**

Navigate to `http://localhost:5173/create` and verify:
1. Factory cards appear (loaded from MasterRegistry)
2. Selecting ERC404 factory shows 2 component steps (Gating + Liquidity)
3. Selecting ERC1155 factory shows 1 component step (Gating)
4. Selecting ERC721 factory skips to Configure
5. Breadcrumb updates dynamically
6. Configure form shows factory-type-specific fields
7. Free mint section appears when gating is selected
8. Preview tab shows live project data
9. Vault step shows available vaults
10. Deploy button triggers wallet transaction

**Step 5: Fix any issues found, commit**

```bash
git add -A
git commit -m "fix: address smoke test issues in creation wizard"
```

---

## Notes for Future Work

1. **Vault enumeration** — `MasterRegistryV1` lacks a `getRegisteredVaults()` function. For now, mock data or config-based vaults work. Future: add enumeration to the contract or use `QueryAggregator`.

2. **MetadataURI parsing** — Factory and component descriptions come from `metadataURI`. Currently showing fallback text. Future: fetch and parse metadata JSON.

3. **`compose.js`** — The `html` tagged template utility referenced by `HomePage-v2.js` doesn't exist yet. This wizard uses the `template()` string return pattern from `Component` base class, which works. When `compose.js` is built, the wizard can optionally migrate.

4. **`requiredFeatures()` contract spec** — Sent to contracts team. Once shipped and submodule updated, replace the mock `getFactoryRequiredFeatures()` implementation with real contract calls.
