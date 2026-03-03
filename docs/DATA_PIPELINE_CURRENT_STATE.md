# Data Pipeline - Current State (Pre-Contract Split)

**Date:** 2026-02-19
**Status:** Pre-Refactor Documentation
**Purpose:** Reference for updating pipeline after MasterRegistry split

---

## Overview

Current data pipeline relies on a **monolithic MasterRegistryV1** contract that serves as the central source of truth for all protocol data (instances, factories, vaults, featured queue, etc.).

**This document will become outdated** once contracts are updated. Use it as a reference to understand what needs to change.

---

## Contract Architecture (Current)

```
MasterRegistryV1 (Monolithic)
├── Instance registry
├── Factory registry
├── Vault registry
├── Featured queue
├── Global message registry reference
└── Alignment targets

Related Contracts:
├── FeaturedQueueManager (manages featured instances)
├── GlobalMessageRegistry (all protocol messages)
├── VaultRegistry (vault metadata)
└── Instance Contracts (ERC404, ERC1155, ERC721)
```

---

## Adapter Layer

### 1. MasterRegistryAdapter
**File:** `src/services/contracts/MasterRegistryAdapter.js`

**Purpose:** Wrapper for MasterRegistryV1 contract

**Key Methods:**
```javascript
// Get instance metadata
async getInstanceInfo(address) {
    return {
        creator: address,
        factory: address,
        vault: address,
        timestamp: number,
        // ... other fields
    };
}

// Check if instance is from approved factory
async isInstanceFromApprovedFactory(address) {
    return boolean;
}

// Get global message registry address
async getGlobalMessageRegistry() {
    return address;
}
```

**Used By:**
- DataAdapter (primary consumer)
- ActivityIndexer (instance validation)

**Contract Interface Used:**
```solidity
// MasterRegistryV1.sol
function getInstanceInfo(address instance) external view returns (InstanceInfo);
function isInstanceFromApprovedFactory(address instance) external view returns (bool);
function getGlobalMessageRegistry() external view returns (address);
```

---

### 2. FeaturedQueueManagerAdapter
**File:** `src/services/contracts/FeaturedQueueManagerAdapter.js`

**Purpose:** Query featured instances from queue

**Key Methods:**
```javascript
// Get queue length
async queueLength() {
    return number;
}

// Get featured instances (paginated)
async getFeaturedInstances(offset, limit) {
    return {
        instances: [address, address, ...],
        total: number
    };
}
```

**Used By:**
- DataAdapter (to get featured project for HomePage)

**Contract Interface Used:**
```solidity
// FeaturedQueueManager.sol
function queueLength() external view returns (uint256);
function getFeaturedInstances(uint256 offset, uint256 limit)
    external view returns (address[] memory);
```

**Current Flow:**
```javascript
// DataAdapter.js
const queueAdapter = new FeaturedQueueManagerAdapter(
    contracts.FeaturedQueueManager,
    'FeaturedQueueManager',
    provider
);
await queueAdapter.initialize();
const queueLen = await queueAdapter.queueLength();
if (queueLen > 0) {
    const { instances } = await queueAdapter.getFeaturedInstances(0, 1);
    const featuredAddress = instances[0];

    // Then get metadata from MasterRegistry
    const registryAdapter = new MasterRegistryAdapter(...);
    const instanceInfo = await registryAdapter.getInstanceInfo(featuredAddress);
}
```

---

### 3. ActivityIndexer
**File:** `src/services/ActivityIndexer.js`

**Purpose:** Index activity from GlobalMessageRegistry and instance events

**Data Sources:**
1. **GlobalMessageRegistry** - MessageAdded events
2. **ERC404 instances** - Transfer events
3. **ERC1155 instances** - TransferSingle events

**Key Methods:**
```javascript
// Index all recent activity
async indexRecentActivity() {
    const [messages, erc404Transfers, erc1155Transfers] = await Promise.all([
        this._indexMessages(fromBlock, currentBlock),
        this._indexERC404Transfers(fromBlock, currentBlock),
        this._indexERC1155Transfers(fromBlock, currentBlock)
    ]);

    // Merge and sort by timestamp
    return [...messages, ...erc404Transfers, ...erc1155Transfers]
        .sort((a, b) => b.timestamp - a.timestamp);
}
```

**Uses MasterRegistry For:**
- Getting GlobalMessageRegistry address
- Validating instance addresses
- Looking up project names

**Output Format:**
```javascript
{
    type: 'message' | 'transfer' | 'mint',
    text: "0xabc... bought 5.00 EARLY",
    user: "0xabc...",
    userAddress: "0xabc...def",
    timestamp: 1234567890,
    blockNumber: 12345,
    project: "Early-Launch",
    projectAddress: "0x...",
    content: "message text", // for messages only
    // ... type-specific fields
}
```

---

### 4. DataAdapter (Orchestrator)
**File:** `src/services/DataAdapter.js`

**Purpose:** Orchestrate all data queries, provide unified interface for components

**Environment Modes:**
- `LOCAL_BLOCKCHAIN` - Query local Anvil contracts
- `PLACEHOLDER_MOCK` - Return hardcoded demo data
- `PRODUCTION_DEPLOYED` - Query deployed contracts
- `COMING_SOON` - Return minimal/empty data

**Key Methods:**

#### `getCriticalData()` - Primary data for HomePage/Discovery
```javascript
async getCriticalData() {
    // 1. Query featured project from FeaturedQueueManager
    const queueAdapter = new FeaturedQueueManagerAdapter(...);
    const { instances } = await queueAdapter.getFeaturedInstances(0, 1);
    const featuredAddress = instances[0];

    // 2. Get featured project metadata from MasterRegistry
    const registryAdapter = new MasterRegistryAdapter(...);
    const instanceInfo = await registryAdapter.getInstanceInfo(featuredAddress);

    // 3. Build featured object
    const featured = {
        address: featuredAddress,
        name: projectData?.name || 'Featured Project',
        symbol: projectData?.symbol || '',
        type: projectType, // ERC404, ERC1155, etc.
        description: projectData?.description || '',
        creator: instanceInfo.creator,
        isFeatured: true
    };

    // 4. Get all projects from config
    const allProjects = [
        ...(instances?.erc404 || []).map(p => ({ ...p, type: 'ERC404' })),
        ...(instances?.erc1155 || []).map(p => ({ ...p, type: 'ERC1155' }))
    ];

    // 5. Format vault data
    const vaultData = (vaults || []).map(v => ({
        address: v.address,
        name: v.name || 'Alignment Vault',
        tvl: v.tvl || '0.00',
        type: 'vault'
    }));

    return {
        featured,       // Featured project object
        projects,       // All projects array
        vaults,         // All vaults array
        contracts: {    // Contract addresses
            masterRegistry: contracts?.MasterRegistryV1,
            featuredQueue: contracts?.FeaturedQueueManager,
            messageRegistry: contracts?.GlobalMessageRegistry
        }
    };
}
```

#### `getActivity(limit)` - Activity feed data
```javascript
async getActivity(limit = 0) {
    const indexer = new ActivityIndexer(this.config, this.provider);
    const allActivity = await indexer.indexRecentActivity();
    return limit > 0 ? allActivity.slice(0, limit) : allActivity;
}
```

**Used By:**
- HomePage (`getCriticalData()` + `getActivity(4)`)
- Discovery (`getCriticalData()`)
- Activity page (`getActivity()` - all)

---

## Component Data Requirements

### HomePage
**File:** `src/routes/HomePage.js`

**Data Needed:**
```javascript
{
    featured: {
        address, name, symbol, type, description, creator
    },
    projects: [
        { address, name, symbol, type, description, tvl, state, bondingProgress }
    ],
    vaults: [
        { address, name, tvl }
    ],
    activity: [
        { type, text, user, userAddress, timestamp, content, project }
    ]
}
```

**Current Load Flow:**
```javascript
const dataAdapter = new DataAdapter(mode, config, provider);
const criticalData = await dataAdapter.getCriticalData();
// → { featured, projects, vaults, contracts }

const activity = await dataAdapter.getActivity(4);
// → [activity items] (limited to 4)
```

---

### Discovery Page
**File:** `src/routes/ProjectDiscovery.js`

**Data Needed:**
```javascript
{
    projects: [
        {
            address, name, symbol, type, description,
            vault, state, bondingProgress, creator, tvl
        }
    ],
    vaults: [
        { address, name, tvl }
    ]
}
```

**Filtering Requirements:**
- By vault address
- By project type (bonding vs collection)
- By ERC standard (404, 1155, 721)
- By state (minting, bonding, deployed)
- Sort by newest, TVL, volume, recent activity

**Current Load Flow:**
```javascript
const dataAdapter = new DataAdapter(mode, config, provider);
const { projects, vaults } = await dataAdapter.getCriticalData();
// Then filter/sort in component
```

**Current Filtering (Client-Side):**
```javascript
// Vault filter
filtered = filtered.filter(p => p.vault === selectedVault);

// Type filter (bonding vs collection)
const isBonding = p.state?.includes('bonding') || p.bondingProgress;

// ERC filter
filtered = filtered.filter(p => p.type === 'ERC404');

// State filter
filtered = filtered.filter(p => {
    if (filters.state === 'bonding') return p.state?.includes('bonding');
    if (filters.state === 'deployed') return p.state === 'deployed' || p.state === 'graduated';
    // ...
});
```

---

### Activity Page
**File:** `src/routes/Activity.js`

**Data Needed:**
```javascript
{
    activity: [
        {
            type: 'message',
            messageId: number,
            text: string,
            content: string,
            user: string (truncated),
            userAddress: string (full),
            timestamp: number,
            project: string,
            projectAddress: string
        }
    ]
}
```

**Filtering Requirements:**
- By activity type (all, message, transfer, mint)
- Pagination (20 items at a time)

**Current Load Flow:**
```javascript
const dataAdapter = new DataAdapter(mode, config, provider);
const activity = await dataAdapter.getActivity(); // All items
// Then filter by type in component
```

---

## Data Flow Diagram (Current)

```
┌─────────────────────────────────────────────────────────────┐
│                     Contract Layer                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MasterRegistryV1          FeaturedQueueManager             │
│  ├── getInstanceInfo()     ├── queueLength()                │
│  ├── isFromFactory()       └── getFeaturedInstances()       │
│  └── getMessageRegistry()                                   │
│                                                             │
│  GlobalMessageRegistry     Instance Contracts               │
│  └── MessageAdded events   ├── ERC404 (Transfer events)    │
│                            └── ERC1155 (Transfer events)    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     Adapter Layer                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MasterRegistryAdapter     FeaturedQueueManagerAdapter      │
│  ActivityIndexer                                            │
│                            ↓                                │
│                      DataAdapter                            │
│                   (Orchestrates all)                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Component Layer                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HomePage                  Discovery                        │
│  ├── Featured project      ├── All projects                │
│  ├── Recent projects       ├── Filter/sort                 │
│  ├── Vaults                └── Pagination                  │
│  └── Activity (4 items)                                    │
│                                                             │
│  Activity                                                   │
│  ├── All activity          ┌──────────────────────┐       │
│  ├── Filter by type        │  Interaction Queue   │       │
│  └── Pagination            │  (reactions, replies) │       │
│                            └──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Dependencies

### DataAdapter depends on:
1. **MasterRegistryV1** - Instance metadata, factory validation
2. **FeaturedQueueManager** - Featured project selection
3. **Config file** (`contracts.local.json`) - Instance addresses, metadata
4. **Provider** - Web3 connection to blockchain

### ActivityIndexer depends on:
1. **GlobalMessageRegistry** - Message events
2. **MasterRegistryV1** - Instance validation, project names
3. **Instance contracts** - Transfer events
4. **Config file** - Instance addresses for event queries

### Components depend on:
1. **DataAdapter** - All data queries
2. **Mode detection** (EnvironmentDetector) - Which data source to use
3. **Provider** - Web3 connection

---

## Known Issues / Technical Debt

### 1. **Project metadata not on-chain**
Currently, project names/symbols/descriptions come from `contracts.local.json` config file, not from contracts.

**Why:** Instances don't store this metadata on-chain yet

**Workaround:** DataAdapter matches addresses from config file

**Future:** Metadata should be queryable from contracts

---

### 2. **State field inconsistency**
ERC404 instances have `state` field, ERC1155 instances don't.

**Why:** Different instance types have different data structures

**Workaround:** Discovery page checks if state exists before filtering

**Future:** StateChanged events will standardize this

---

### 3. **TVL/Volume not calculated**
Project cards show "N/A" for TVL/volume.

**Why:** No indexer or aggregator calculating these values

**Workaround:** Show placeholder

**Future:** Need indexer to calculate from events

---

### 4. **Activity indexing limited**
Only indexes recent blocks (last 100 blocks).

**Why:** Querying all events since genesis is too slow

**Workaround:** RECENT_BLOCKS = 100 constant

**Future:** Need persistent indexer/database

---

### 5. **No real-time updates**
Data only loads on page mount, doesn't update when new events occur.

**Why:** No event listeners or polling

**Workaround:** User must refresh page

**Future:** WebSocket listeners or polling for new events

---

## Contract Update Checklist

When MasterRegistry split lands, update:

### **Adapters:**
- [ ] Create new adapters for each new contract
- [ ] Update MasterRegistryAdapter to use new contract(s)
- [ ] Update FeaturedQueueManagerAdapter if queue changed
- [ ] Update ActivityIndexer for new event structure
- [ ] Update DataAdapter orchestration logic

### **Data Flow:**
- [ ] Map new contract → adapter relationships
- [ ] Update getCriticalData() query flow
- [ ] Update getActivity() query flow
- [ ] Verify data structures match component expectations

### **Components:**
- [ ] Test HomePage data loading
- [ ] Test Discovery filtering/sorting
- [ ] Test Activity feed indexing
- [ ] Verify featured project display

### **Config:**
- [ ] Update contracts.local.json with new addresses
- [ ] Update deployment scripts if needed
- [ ] Verify all contract references

### **Testing:**
- [ ] Test LOCAL_BLOCKCHAIN mode
- [ ] Test PLACEHOLDER_MOCK mode
- [ ] Verify error handling
- [ ] Check loading states

---

## Questions for Contract Team

When updates land, we need to know:

1. **What did MasterRegistry split into?**
   - Separate registry for instances?
   - Separate registry for factories?
   - Separate registry for vaults?
   - Query aggregator?

2. **How do we query featured project now?**
   - Same FeaturedQueueManager?
   - New interface?
   - Different data structure?

3. **How do we get project metadata?**
   - New query function signature?
   - Different contract?
   - On-chain metadata storage?

4. **What changed in StateChanged events?**
   - Event signature?
   - Which contracts emit it?
   - How to index it?

5. **How does GlobalMessageRegistry work now?**
   - Standalone messages supported?
   - Reaction/reply message types?
   - New addMessage() signature?

---

## Next Steps

1. **Wait for contract updates** to be pushed to submodule
2. **Analyze new contract architecture**
3. **Design new adapter layer** based on new contracts
4. **Update DataAdapter orchestration**
5. **Test entire pipeline** end-to-end
6. **Update this documentation** with new architecture

---

## Related Files

### Adapters:
- `src/services/DataAdapter.js`
- `src/services/ActivityIndexer.js`
- `src/services/contracts/MasterRegistryAdapter.js`
- `src/services/contracts/FeaturedQueueManagerAdapter.js`

### Components:
- `src/routes/HomePage.js`
- `src/routes/ProjectDiscovery.js`
- `src/routes/Activity.js`

### Config:
- `src/config/contracts.local.json`
- `src/services/EnvironmentDetector.js`

### Documentation:
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/CSS_ARCHITECTURE.md`
- `contracts/docs/ARCHITECTURE.md`

---

**Document Status:** Ready for Contract Updates
**Last Updated:** 2026-02-19
**Next Review:** After contract submodule update
