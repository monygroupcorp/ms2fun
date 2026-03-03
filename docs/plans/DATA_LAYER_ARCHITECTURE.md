# Data Layer Architecture - Contract-Config-Driven State System

## Overview

Handles the trilemma of application states based on environment and contract deployment.

## The 4 States

### 1. Dev + Local Contracts (Anvil)
- **Check**: `localhost:8545` available
- **Config**: `contracts.local.json` has addresses
- **Mode**: `LOCAL_BLOCKCHAIN`
- **Data Source**: Local Anvil fork with deployed contracts
- **UI**: Real data from local contracts

### 2. Dev + No Local Contracts
- **Check**: `localhost:8545` unavailable
- **Mode**: `PLACEHOLDER_MOCK`
- **Data Source**: Hardcoded placeholder data (current HomePage state)
- **UI**: Placeholder projects, "Demo Project Alpha", mock data

### 3. Production + Deployed
- **Check**: Production build
- **Config**: `contracts.mainnet.json` OR `contracts.sepolia.json` has addresses
- **Mode**: `PRODUCTION_DEPLOYED`
- **Data Source**: Real contracts on mainnet/testnet
- **UI**: Real data from deployed contracts

### 4. Production + Not Deployed
- **Check**: Production build
- **Config**: Empty or missing contract addresses
- **Mode**: `COMING_SOON`
- **Data Source**: Minimal static content
- **UI**: "Coming Soon" messaging, no projects, minimal content

---

## Architecture Components

### A. Environment Detector (`src/services/EnvironmentDetector.js`)

```javascript
class EnvironmentDetector {
    async detect() {
        const isDev = import.meta.env.DEV;
        const hasAnvil = await this.checkLocalRPC();
        const config = await this.loadContractConfig();

        if (isDev && hasAnvil && config.hasContracts) {
            return { mode: 'LOCAL_BLOCKCHAIN', config };
        }

        if (isDev && !hasAnvil) {
            return { mode: 'PLACEHOLDER_MOCK', config: null };
        }

        if (!isDev && config.hasContracts) {
            return { mode: 'PRODUCTION_DEPLOYED', config };
        }

        return { mode: 'COMING_SOON', config: null };
    }

    async checkLocalRPC() {
        try {
            const response = await fetch('http://localhost:8545', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', id: 1 })
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async loadContractConfig() {
        const isDev = import.meta.env.DEV;
        const configPath = isDev
            ? '/src/config/contracts.local.json'
            : '/src/config/contracts.mainnet.json';

        try {
            const response = await fetch(configPath);
            const config = await response.json();
            return {
                hasContracts: !!config.contracts?.MasterRegistryV1,
                data: config
            };
        } catch {
            return { hasContracts: false, data: null };
        }
    }
}
```

### B. Data Adapter (`src/services/DataAdapter.js`)

```javascript
class DataAdapter {
    constructor(mode, config) {
        this.mode = mode;
        this.config = config;
    }

    async getHomePageData() {
        switch (this.mode) {
            case 'LOCAL_BLOCKCHAIN':
            case 'PRODUCTION_DEPLOYED':
                return this.getBlockchainData();

            case 'PLACEHOLDER_MOCK':
                return this.getPlaceholderData();

            case 'COMING_SOON':
                return this.getComingSoonData();
        }
    }

    async getBlockchainData() {
        // Use micro-web3 to index events and query contracts
        const { instances, vaults } = this.config.data;

        return {
            featured: instances.erc404[0], // First project
            projects: [...instances.erc404, ...instances.erc1155],
            vaults: vaults.map(v => ({
                address: v.address,
                name: v.name,
                tvl: v.tvl
            })),
            activity: await this.indexRecentActivity()
        };
    }

    getPlaceholderData() {
        // Current hardcoded data from HomePage
        return {
            featured: {
                address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
                name: 'Art Collection Alpha',
                type: 'ERC404',
                description: 'Test featured project'
            },
            projects: [
                { address: '0x1111', name: 'Project Alpha', type: 'ERC404', ... },
                // ... rest of placeholder data
            ],
            vaults: [...],
            activity: [...]
        };
    }

    getComingSoonData() {
        return {
            featured: null,
            projects: [],
            vaults: [],
            activity: [],
            message: 'MS2 is launching soon. Stay tuned!'
        };
    }

    async indexRecentActivity() {
        // Use micro-web3 event indexing
        // Query GlobalMessageRegistry for recent messages
        // Return formatted activity items
    }
}
```

### C. Updated HomePage Integration

```javascript
export class HomePage extends Component {
    constructor(props) {
        super(props);
        this.state = {
            mode: null,
            loading: true,
            featured: null,
            projects: [],
            vaults: [],
            activity: [],
            error: null
        };
    }

    async didMount() {
        try {
            // Detect environment
            const detector = new EnvironmentDetector();
            const { mode, config } = await detector.detect();

            // Create adapter
            const adapter = new DataAdapter(mode, config);
            const data = await adapter.getHomePageData();

            this.setState({
                mode,
                loading: false,
                ...data
            });
        } catch (error) {
            console.error('[HomePage] Failed to load data:', error);
            this.setState({
                loading: false,
                error: error.message
            });
        }
    }

    render() {
        const { mode, loading, featured, projects, vaults, activity, message } = this.state;

        if (loading) {
            return h(Layout, { currentPath: '/', children: h('div', { className: 'loading-state' }, 'Loading...') });
        }

        if (mode === 'COMING_SOON') {
            return h(Layout, { currentPath: '/', children: h(ComingSoonView, { message }) });
        }

        // Regular render with data
        return h(Layout, { /* ... */ });
    }
}
```

---

## Implementation Phases

### Phase 1: Environment Detection (1-2 hours)
- [ ] Create `EnvironmentDetector.js`
- [ ] Test local RPC detection
- [ ] Test config loading

### Phase 2: Data Adapter (2-3 hours)
- [ ] Create `DataAdapter.js`
- [ ] Implement placeholder mode
- [ ] Implement coming-soon mode
- [ ] Implement blockchain mode (basic)

### Phase 3: micro-web3 Integration (3-4 hours)
- [ ] Event indexing for activity feed
- [ ] Contract queries for instance data
- [ ] Vault TVL queries
- [ ] Featured project selection logic

### Phase 4: HomePage Integration (1 hour)
- [ ] Update HomePage to use new system
- [ ] Add loading states
- [ ] Add error handling
- [ ] Test all 4 modes

---

## Benefits

✅ **Clear separation of concerns** - detection, adaptation, presentation
✅ **Config-driven** - no hardcoded contract addresses
✅ **Graceful degradation** - works in all environments
✅ **Future-proof** - easy to add new data sources
✅ **Testable** - each component can be tested independently

---

## Next Steps

**Should we:**
1. Build this architecture now (2-3 hours total)
2. Keep placeholder data for now and build other pages first
3. Hybrid: build detection but keep placeholder for data

**Your call!**
