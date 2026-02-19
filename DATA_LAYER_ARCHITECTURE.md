# Data Layer & Environment Architecture

**Date:** 2026-02-18
**Purpose:** Document the data fetching, routing, and environment handling for the v2 frontend rebuild

---

## Environment Modes

The app supports **3 modes** determined by network detection:

### 1. Local Development Mode (`mode: 'local'`)
- **RPC:** `http://localhost:8545` (Anvil fork of mainnet)
- **Config:** `src/config/contracts.local.json`
- **ChainId:** 1337
- **Contracts:** Deployed via `npm run chain:start`
- **Hot Reload:** `ContractReloadService` watches for contract updates

### 2. Production Mode (`mode: 'mainnet'`)
- **RPC:** User's wallet provider (MetaMask, etc.)
- **Config:** `src/config/contracts.mainnet.json`
- **ChainId:** 1 (Ethereum Mainnet)
- **Contracts:** Live deployed contracts

### 3. Static/Mock Mode (`mode: 'mock'`)
- **Trigger:** No RPC available OR no contracts deployed
- **Data:** Static mock data from `src/services/mock/mockData.js`
- **Use Case:** Development without Anvil, or when contracts aren't deployed

---

## Service Layer Architecture

### ServiceFactory (Singleton)

**Location:** `src/services/ServiceFactory.js`

**Responsibilities:**
- Detects environment mode on initialization
- Auto-falls back to mock mode if RPC unavailable
- Provides singleton service instances
- Clears caches on contract reload (dev only)

**Initialization Flow:**
```javascript
// On app startup (src/index.js)
await serviceFactory.initialize();

// ServiceFactory checks:
1. Is USE_MOCK_SERVICES = true? → Mock mode
2. Is RPC available at http://localhost:8545? → Check contract address
3. Is MasterRegistryV1 address !== 0x0000...? → Real mode
4. Otherwise → Mock mode
```

**Service Access Pattern:**
```javascript
import serviceFactory from './services/ServiceFactory.js';

// Get services
const masterService = serviceFactory.getMasterService();
const factoryService = serviceFactory.getFactoryService();
const projectRegistry = serviceFactory.getProjectRegistry();

// Check mode
if (serviceFactory.isUsingMock()) {
  // Static mode - data won't update
}
```

---

## Data Fetching Patterns

### 1. Contract Adapters

**Location:** `src/services/contracts/*Adapter.js`

**Examples:**
- `MasterRegistryAdapter` - Central registry
- `ERC404FactoryAdapter` - ERC404 instances
- `ERC1155FactoryAdapter` - ERC1155 instances
- `UltraAlignmentVaultAdapter` - Vault data
- `GlobalMessageRegistryAdapter` - Activity feed
- `GrandCentralAdapter` - DAO governance
- `QueryAggregatorAdapter` - Batch queries

**Pattern:**
```javascript
// Adapter wraps ethers.Contract
class ERC404FactoryAdapter {
  constructor(address, provider, signer) {
    this.contract = new ethers.Contract(address, ABI, provider);
  }

  async getInstancesByCreator(address) {
    return await this.contract.getCreatorInstances(address);
  }
}
```

### 2. Event Indexing (Lazy-Loaded)

**ProjectIndex** - `src/services/ProjectIndex.js`
- Indexes ERC404/ERC1155 instance creation events
- Stores in IndexedDB for persistence
- Lazy-loaded: Only syncs when needed
- Caches results to avoid re-indexing

**GovernanceEventIndexer** - `src/services/GovernanceEventIndexer.js`
- Indexes DAO proposal events from GrandCentral
- Uses micro-web3's EventIndexer under the hood
- Lazy initialization on first governance page visit

**Pattern:**
```javascript
// Route component fetches data on mount
class ProjectListRoute extends Component {
  async didMount() {
    this.setState({ loading: true });

    // Get index (lazy-initializes if needed)
    const index = serviceFactory.getProjectIndex();
    await index.ensureSynced(); // Syncs if stale

    // Query indexed data
    const projects = await index.getAllProjects();

    this.setState({ loading: false, projects });
  }
}
```

### 3. QueryService (Batch Fetching)

**Location:** `src/services/QueryService.js`

**Purpose:** Batch multiple contract calls to reduce RPC requests

**Pattern:**
```javascript
import queryService from './services/QueryService.js';

// Batch fetch project details
const projectData = await queryService.getProjectData(instanceAddress);
// Returns: { name, symbol, totalSupply, owner, vault, etc. }
```

---

## Routing & Data Loading

### Current Router Pattern

**Hash-based routing** (`#/portfolio`, `#/project/0x...`)

**Route → Component Pattern:**
```javascript
// src/index.js
router.on('/portfolio', async () => {
  const { renderPortfolio } = await import('./routes/Portfolio.js');
  return renderPortfolio();
});

router.on('/project/:id', async (params) => {
  const { renderProjectDetail } = await import('./routes/ProjectDetail.js');
  return renderProjectDetail(params);
});
```

**Route Function Pattern:**
```javascript
// src/routes/ProjectDetail.js
export async function renderProjectDetail(params) {
  const container = document.getElementById('app-container');

  // Show loading state
  container.innerHTML = '<div class="spinner"></div>';

  // Fetch data
  const projectService = serviceFactory.getProjectService();
  const project = await projectService.getProjectById(params.id);

  // Render with data
  container.innerHTML = `
    <h1>${project.name}</h1>
    <p>${project.description}</p>
  `;
}
```

### New Router Pattern (with Microact Router)

**Path-based routing** (`/portfolio`, `/project/:id`)

**Component-based Pattern:**
```javascript
import { Router } from 'microact';

const router = new Router();

// Route → Component
router.on('/portfolio', async () => {
  const container = document.getElementById('app');
  render(h(PortfolioRoute), container);
});

router.on('/project/:id', async (params) => {
  const container = document.getElementById('app');
  render(h(ProjectDetailRoute, { projectId: params.id }), container);
});

router.start();
```

**Route Component Pattern:**
```javascript
import { h, Component } from 'microact';
import { Spinner } from '../components/Loading';

class ProjectDetailRoute extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      project: null
    };
  }

  async didMount() {
    const projectService = serviceFactory.getProjectService();
    const project = await projectService.getProjectById(this.props.projectId);
    this.setState({ loading: false, project });
  }

  render() {
    if (this.state.loading) {
      return h(Spinner, { text: 'Loading project...' });
    }

    return h('div', { className: 'project-detail' },
      h('h1', null, this.state.project.name),
      h('p', null, this.state.project.description)
    );
  }
}
```

---

## Key Differences: Old vs. New

### Old (Current)
- Hash routing (`#/portfolio`)
- Route functions render HTML strings to `innerHTML`
- No component lifecycle
- Manual loading state management
- Services accessed globally

### New (Microact v2)
- Path routing (`/portfolio`)
- Route components with `h()` VNodes
- Lifecycle methods (`didMount`, `willUnmount`)
- Skeleton components for loading
- Services via `serviceFactory` singleton

---

## Data Flow Example: Portfolio Page

### Step-by-Step

1. **User navigates to `/portfolio`**
2. **Router matches route** → Loads `PortfolioRoute` component
3. **Component mounts** → `didMount()` called
4. **Fetch user holdings:**
   ```javascript
   async didMount() {
     const userAddress = walletService.getAddress();
     const holdingsIndex = serviceFactory.getUserHoldingsIndex();
     await holdingsIndex.ensureSynced(userAddress);
     const holdings = await holdingsIndex.getHoldings(userAddress);
     this.setState({ loading: false, holdings });
   }
   ```
5. **Re-render with data** → Shows holdings in grid

---

## Environment Configuration Files

### contracts.local.json (Anvil)
```json
{
  "chainId": 1337,
  "mode": "local-fork",
  "contracts": {
    "MasterRegistryV1": "0x1Bc0b43638985b57A31121E93078bCfcdaeE8F6E",
    "GlobalMessageRegistry": "0x68B5f6a7ccD9EA0642d7B069135d84AD2CC26232",
    ...
  },
  "factories": [ ... ],
  "vaults": [ ... ],
  "instances": { "erc404": [...], "erc1155": [...] }
}
```

### contracts.mainnet.json (Production)
```json
{
  "chainId": 1,
  "mode": "mainnet",
  "contracts": {
    "MasterRegistryV1": "0x...",  // Real mainnet addresses
    ...
  }
}
```

---

## Critical Services Reference

| Service | Purpose | Lazy? |
|---------|---------|-------|
| `ServiceFactory` | Service provider, mode detection | No - init on startup |
| `WalletService` | Wallet connection, signing | No - init on startup |
| `MasterService` | Central registry queries | No - accessed immediately |
| `FactoryService` | Factory instance queries | No - accessed immediately |
| `ProjectIndex` | Event indexing (ERC404/1155) | Yes - sync on demand |
| `GovernanceEventIndexer` | DAO event indexing | Yes - init on governance page |
| `QueryService` | Batch contract queries | No - accessed immediately |
| `QueryAggregatorAdapter` | On-chain batch queries | No - accessed immediately |
| `MessageRegistryAdapter` | Activity feed | Yes - init on activity page |
| `VaultAdapter` | Vault-specific queries | Yes - created per vault |

---

## Next Steps for Phase 5

Now that we understand the data layer, we can design the project structure around:

1. **Route components** that fetch data in `didMount()`
2. **Service access** via `serviceFactory` singleton
3. **Loading states** with skeleton components
4. **Environment-aware** initialization
5. **Lazy-loaded indexes** for performance

Ready to proceed to Phase 5: Project Structure Design?
