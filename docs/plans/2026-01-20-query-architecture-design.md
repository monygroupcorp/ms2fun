# Query Architecture Design
**Date:** 2026-01-20
**Status:** ✅ Implemented (2026-01-21)
**Purpose:** Systematic improvement to RPC query performance for scaling to tens of thousands of projects without a centralized database

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Design Philosophy](#design-philosophy)
3. [Solution Architecture](#solution-architecture)
4. [Contract Changes (Spec for Contract Team)](#contract-changes)
5. [Client Implementation](#client-implementation)
6. [Query Cost Analysis](#query-cost-analysis)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Problem Statement

### Current State

The application queries Ethereum RPC for all data. Current architecture has:

- **Adapter pattern** with per-contract adapters wrapping ethers.js
- **TTL caching** in `ContractCache.js` with event invalidation
- **Parallel batching** via `Promise.all` (inconsistently applied)

### Problems Identified

1. **N+1 Query Problem**: `getFeaturedInstances()` returns addresses only, requiring N additional calls for metadata
2. **No True Batching**: Each `getInstanceInfo()` is a separate RPC request
3. **Sequential Loops**: Some code paths use `for` loops instead of `Promise.all`
4. **No Request Deduplication**: Identical concurrent requests both fire
5. **Scale Limitation**: Cannot efficiently browse/search 10,000+ projects

### Impact

For 20 projects on the home page:

| Data Source | Calls Required |
|-------------|----------------|
| `getFeaturedInstances(0, 20)` | 1 |
| `getInstanceInfo(addr)` × 20 | 20 |
| `getFactoryInfo(factory)` × 20 | 20 |
| `getVaultInfo(vault)` × 20 | 20 |
| Instance price/supply × 20 | 20 |
| **Total** | **80+ RPC calls** |

---

## Design Philosophy

> "We are making a bold claim and bet on Ethereum that we can make websites that scale to millions without using a database, only relying on the client and their connection to the Ethereum world computer."

### Principles

1. **No centralized database** - All data from chain or user's browser
2. **User's provider when possible** - Connected wallet uses their own RPC
3. **Public fallback** - Disconnected users use public endpoints
4. **User control** - Users can manage/clear local storage
5. **Graceful degradation** - Works (slower) without local index

---

## Solution Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      COMPONENTS                                │  │
│  │   HomePage   Portfolio   VaultExplorer   ProjectDetail   ...  │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│  ┌──────────────────────────▼───────────────────────────────────┐  │
│  │                     QueryService                               │  │
│  │  • Request deduplication                                       │  │
│  │  • TTL cache                                                   │  │
│  │  • Transaction invalidation                                    │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│        ┌─────────────────────┼─────────────────────┐                │
│        ▼                     ▼                     ▼                │
│  ┌───────────┐    ┌──────────────────┐    ┌──────────────┐        │
│  │ProjectIndex│    │QueryAggregator   │    │  Adapters     │        │
│  │(IndexedDB) │    │    Adapter       │    │ (fallback)    │        │
│  │            │    │                  │    │               │        │
│  │ • Search   │    │ • getHomePageData│    │ • Individual  │        │
│  │ • Filter   │    │ • getPortfolio   │    │   contract    │        │
│  │ • Browse   │    │ • getBatch       │    │   calls       │        │
│  └──────┬─────┘    └────────┬─────────┘    └───────┬───────┘        │
│         │                   │                      │                │
└─────────┼───────────────────┼──────────────────────┼────────────────┘
          │                   │                      │
          ▼                   ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RPC PROVIDER                                 │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        ETHEREUM                                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ QueryAggregator │  │  MasterRegistry │  │  FeaturedQueue  │     │
│  │    (NEW)        │  │   (storage)     │  │   (storage)     │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           └────────────────────┴────────────────────┘               │
│  ┌─────────────────┐  ┌─────────────────┐                          │
│  │ ERC404 Instance │  │ ERC1155 Instance│  ... (N instances)       │
│  │ • getCardData() │  │ • getCardData() │                          │
│  └─────────────────┘  └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Three-Layer Solution

| Layer | Purpose | Location |
|-------|---------|----------|
| **QueryAggregator** | Batch contract reads, join data on-chain | Smart Contract (NEW) |
| **QueryService** | Cache, deduplicate, invalidate | Client JavaScript |
| **ProjectIndex** | Search/filter large datasets | Client IndexedDB |

---

## Contract Changes

> **Note:** This section is a specification for the smart contract team. Frontend team cannot implement these changes directly.

### 1. QueryAggregator Contract (NEW)

A dedicated read-only contract that aggregates data from multiple registry contracts.

#### Data Structures

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct ProjectCard {
    // Instance core (from MasterRegistry.InstanceInfo)
    address instance;
    string name;
    string metadataURI;
    address creator;
    uint256 registeredAt;

    // Factory info (denormalized)
    address factory;
    string contractType;     // "ERC404" | "ERC1155"
    string factoryTitle;

    // Vault info (denormalized)
    address vault;
    string vaultName;

    // Dynamic data (from instance.getCardData())
    uint256 currentPrice;    // ERC404: bonding price, ERC1155: floor price
    uint256 totalSupply;     // ERC404: bonding supply, ERC1155: total minted
    uint256 maxSupply;       // 0 if unlimited
    bool isActive;           // Bonding active / editions available

    // Featured status (from FeaturedQueueManager)
    uint256 featuredPosition; // 0 if not featured
    uint256 featuredExpires;
}

struct VaultSummary {
    address vault;
    string name;
    uint256 tvl;
    uint256 instanceCount;
}

struct ERC404Holding {
    address instance;
    string name;
    uint256 tokenBalance;
    uint256 nftBalance;
    uint256 stakedBalance;
    uint256 pendingRewards;
}

struct ERC1155Holding {
    address instance;
    string name;
    uint256[] editionIds;
    uint256[] balances;
}

struct VaultPosition {
    address vault;
    string name;
    uint256 contribution;
    uint256 shares;
    uint256 claimable;
}
```

#### Interface

```solidity
interface IQueryAggregator {
    /// @notice Single call for entire home page
    /// @param offset Starting position in featured queue
    /// @param limit Number of projects to return
    /// @return projects Fully hydrated project cards
    /// @return totalFeatured Total projects in featured queue
    /// @return topVaults Top vaults by TVL
    /// @return recentActivity Recent global messages
    function getHomePageData(uint256 offset, uint256 limit)
        external view returns (
            ProjectCard[] memory projects,
            uint256 totalFeatured,
            VaultSummary[] memory topVaults,
            GlobalMessage[] memory recentActivity
        );

    /// @notice Batch query for arbitrary project addresses
    /// @param instances Array of project addresses to hydrate
    /// @return Fully hydrated project cards
    function getProjectCardsBatch(address[] calldata instances)
        external view returns (ProjectCard[] memory);

    /// @notice Single call for user's complete portfolio
    /// @param user User address to query
    /// @return erc404Holdings All ERC404 token holdings
    /// @return erc1155Holdings All ERC1155 edition holdings
    /// @return vaultPositions All vault benefactor positions
    /// @return totalClaimable Sum of all claimable rewards
    function getPortfolioData(address user)
        external view returns (
            ERC404Holding[] memory erc404Holdings,
            ERC1155Holding[] memory erc1155Holdings,
            VaultPosition[] memory vaultPositions,
            uint256 totalClaimable
        );

    /// @notice Vault leaderboard with sorting
    /// @param sortBy 0 = TVL, 1 = popularity (instance count)
    /// @param limit Number of vaults to return
    function getVaultLeaderboard(uint8 sortBy, uint256 limit)
        external view returns (VaultSummary[] memory);

    /// @notice Project detail page data
    /// @param instance Project address
    /// @param user User address (for holdings, 0x0 if not connected)
    function getProjectDetail(address instance, address user)
        external view returns (
            ProjectCard memory project,
            // Additional detail fields TBD based on contract type
        );
}
```

#### Implementation Notes

```solidity
contract QueryAggregator {
    IMasterRegistry public immutable registry;
    IFeaturedQueueManager public immutable featuredQueue;
    IGlobalMessageRegistry public immutable messageRegistry;

    constructor(
        address _registry,
        address _featuredQueue,
        address _messageRegistry
    ) {
        registry = IMasterRegistry(_registry);
        featuredQueue = IFeaturedQueueManager(_featuredQueue);
        messageRegistry = IGlobalMessageRegistry(_messageRegistry);
    }

    function getHomePageData(uint256 offset, uint256 limit)
        external view returns (
            ProjectCard[] memory projects,
            uint256 totalFeatured,
            VaultSummary[] memory topVaults,
            GlobalMessage[] memory recentActivity
        )
    {
        // 1. Get featured addresses from queue
        (address[] memory featured, uint256 total) =
            featuredQueue.getFeaturedInstances(offset, limit);

        // 2. Hydrate each project (internal loop)
        projects = _hydrateProjects(featured);
        totalFeatured = total;

        // 3. Get top 3 vaults
        topVaults = _getTopVaults(3);

        // 4. Get recent 5 messages
        recentActivity = messageRegistry.getRecentMessages(5);

        return (projects, totalFeatured, topVaults, recentActivity);
    }

    function _hydrateProjects(address[] memory instances)
        internal view returns (ProjectCard[] memory)
    {
        ProjectCard[] memory cards = new ProjectCard[](instances.length);

        for (uint256 i = 0; i < instances.length; i++) {
            // Get registry info
            IMasterRegistry.InstanceInfo memory info =
                registry.getInstanceInfo(instances[i]);

            // Get factory info
            IMasterRegistry.FactoryInfo memory factoryInfo =
                registry.getFactoryInfoByAddress(info.factory);

            // Get vault info
            IMasterRegistry.VaultInfo memory vaultInfo =
                registry.getVaultInfo(info.vault);

            // Get dynamic data from instance
            (uint256 price, uint256 supply, uint256 maxSupply, bool active) =
                IInstance(instances[i]).getCardData();

            // Get featured status
            (,uint256 position,,bool expired) =
                featuredQueue.getRentalInfo(instances[i]);

            cards[i] = ProjectCard({
                instance: instances[i],
                name: info.name,
                metadataURI: info.metadataURI,
                creator: info.creator,
                registeredAt: info.registeredAt,
                factory: info.factory,
                contractType: factoryInfo.contractType,
                factoryTitle: factoryInfo.title,
                vault: info.vault,
                vaultName: vaultInfo.name,
                currentPrice: price,
                totalSupply: supply,
                maxSupply: maxSupply,
                isActive: active,
                featuredPosition: expired ? 0 : position,
                featuredExpires: 0 // Can add if needed
            });
        }

        return cards;
    }
}
```

### 2. Instance getCardData() Methods

Add to each instance contract type:

#### ERC404BondingInstance

```solidity
/// @notice Returns data needed for project card display
/// @return currentPrice Current bonding curve price
/// @return totalSupply Current bonding supply
/// @return maxSupply Maximum supply cap
/// @return isActive Whether bonding is active
function getCardData() external view returns (
    uint256 currentPrice,
    uint256 totalSupply,
    uint256 maxSupply,
    bool isActive
) {
    currentPrice = getCurrentPrice();
    totalSupply = totalBondingSupply;
    maxSupply = MAX_SUPPLY;
    isActive = bondingActive && block.timestamp >= bondingOpenTime;
}
```

#### ERC1155Instance

```solidity
/// @notice Returns data needed for project card display
/// @return floorPrice Lowest edition price
/// @return totalMinted Total mints across all editions
/// @return maxSupply Sum of all edition max supplies (0 if any unlimited)
/// @return isActive Whether any editions are mintable
function getCardData() external view returns (
    uint256 floorPrice,
    uint256 totalMinted,
    uint256 maxSupply,
    bool isActive
) {
    floorPrice = type(uint256).max;
    totalMinted = 0;
    maxSupply = 0;
    isActive = false;
    bool hasUnlimited = false;

    for (uint256 i = 1; i <= editionCount; i++) {
        Edition storage ed = editions[i];

        if (ed.basePrice < floorPrice) {
            floorPrice = ed.basePrice;
        }

        totalMinted += ed.minted;

        if (ed.supply == 0) {
            hasUnlimited = true;
        } else {
            maxSupply += ed.supply;
            if (ed.minted < ed.supply) {
                isActive = true;
            }
        }
    }

    if (hasUnlimited) {
        maxSupply = 0; // Signal unlimited
        isActive = true;
    }

    if (floorPrice == type(uint256).max) {
        floorPrice = 0;
    }
}
```

### 3. Interface Definition

```solidity
// IInstance.sol - Common interface for card data
interface IInstance {
    function getCardData() external view returns (
        uint256 price,
        uint256 supply,
        uint256 maxSupply,
        bool isActive
    );
}
```

---

## Client Implementation

### 1. QueryService

Central service for all data fetching with caching and deduplication.

**File:** `src/services/QueryService.js`

```javascript
class QueryService {
    constructor() {
        this.cache = new Map();           // key → { data, expiresAt }
        this.inFlight = new Map();        // key → Promise
        this.ttl = {
            homePageData: 10000,          // 10s - changes frequently
            projectCard: 30000,           // 30s - semi-static
            portfolioData: 5000,          // 5s - user-specific
            vaultLeaderboard: 60000,      // 60s - slow changing
        };
    }

    async getHomePageData(offset = 0, limit = 20) {
        const key = `home:${offset}:${limit}`;
        return this._cachedQuery(key, 'homePageData', () =>
            this.aggregator.getHomePageData(offset, limit)
        );
    }

    async getProjectCardsBatch(addresses) {
        // Check cache for each, only fetch missing
        const missing = addresses.filter(addr =>
            !this._isCached(`project:${addr}`)
        );

        if (missing.length > 0) {
            const cards = await this.aggregator.getProjectCardsBatch(missing);
            cards.forEach(card => {
                this._setCache(`project:${card.instance}`, card, 'projectCard');
            });
        }

        return addresses.map(addr => this.cache.get(`project:${addr}`).data);
    }

    async getPortfolioData(userAddress) {
        const key = `portfolio:${userAddress}`;
        return this._cachedQuery(key, 'portfolioData', () =>
            this.aggregator.getPortfolioData(userAddress)
        );
    }

    async _cachedQuery(key, ttlKey, fetchFn) {
        // 1. Check cache
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        // 2. Check in-flight (deduplication)
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }

        // 3. Execute query
        const promise = fetchFn().then(data => {
            this._setCache(key, data, ttlKey);
            this.inFlight.delete(key);
            return data;
        }).catch(err => {
            this.inFlight.delete(key);
            throw err;
        });

        this.inFlight.set(key, promise);
        return promise;
    }

    _setCache(key, data, ttlKey) {
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + this.ttl[ttlKey]
        });
    }

    _isCached(key) {
        const cached = this.cache.get(key);
        return cached && cached.expiresAt > Date.now();
    }

    // Invalidate on user transactions
    invalidateUserData(userAddress) {
        for (const key of this.cache.keys()) {
            if (key.startsWith('portfolio:') || key.startsWith('home:')) {
                this.cache.delete(key);
            }
        }
    }

    // Invalidate specific project
    invalidateProject(address) {
        this.cache.delete(`project:${address}`);
    }
}

export const queryService = new QueryService();
```

### 2. QueryAggregatorAdapter

Contract interface for QueryAggregator.

**File:** `src/services/contracts/QueryAggregatorAdapter.js`

```javascript
import { Contract } from 'ethers';
import { QUERY_AGGREGATOR_ABI } from '../abis/QueryAggregator';

class QueryAggregatorAdapter {
    constructor(address, provider) {
        this.contract = new Contract(address, QUERY_AGGREGATOR_ABI, provider);
    }

    async getHomePageData(offset, limit) {
        const [projects, totalFeatured, topVaults, recentActivity] =
            await this.contract.getHomePageData(offset, limit);

        return {
            projects: projects.map(this._parseProjectCard),
            totalFeatured: totalFeatured.toNumber(),
            topVaults: topVaults.map(this._parseVaultSummary),
            recentActivity: recentActivity.map(this._parseMessage)
        };
    }

    async getProjectCardsBatch(addresses) {
        const cards = await this.contract.getProjectCardsBatch(addresses);
        return cards.map(this._parseProjectCard);
    }

    async getPortfolioData(userAddress) {
        const [erc404, erc1155, vaults, totalClaimable] =
            await this.contract.getPortfolioData(userAddress);

        return {
            erc404Holdings: erc404.map(this._parseERC404Holding),
            erc1155Holdings: erc1155.map(this._parseERC1155Holding),
            vaultPositions: vaults.map(this._parseVaultPosition),
            totalClaimable: formatEther(totalClaimable)
        };
    }

    _parseProjectCard(card) {
        return {
            instance: card.instance,
            name: card.name,
            metadataURI: card.metadataURI,
            creator: card.creator,
            registeredAt: card.registeredAt.toNumber(),
            factory: card.factory,
            contractType: card.contractType,
            factoryTitle: card.factoryTitle,
            vault: card.vault,
            vaultName: card.vaultName,
            currentPrice: formatEther(card.currentPrice),
            totalSupply: formatEther(card.totalSupply),
            maxSupply: card.maxSupply.isZero() ? null : formatEther(card.maxSupply),
            isActive: card.isActive,
            featuredPosition: card.featuredPosition.toNumber(),
            featuredExpires: card.featuredExpires.toNumber()
        };
    }

    // ... other parse methods
}
```

### 3. ProjectIndex (IndexedDB)

Local event-based index for search and filtering at scale.

**File:** `src/services/ProjectIndex.js`

```javascript
import { openDB } from 'idb';

const DB_NAME = 'ms2fun-index';
const DB_VERSION = 1;

class ProjectIndex {
    constructor() {
        this.dbPromise = this._initDB();
    }

    async _initDB() {
        return openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // Projects store
                const projectStore = db.createObjectStore('projects', {
                    keyPath: 'address'
                });
                projectStore.createIndex('name', 'name');
                projectStore.createIndex('contractType', 'contractType');
                projectStore.createIndex('vault', 'vault');
                projectStore.createIndex('creator', 'creator');
                projectStore.createIndex('registeredAt', 'registeredAt');

                // Meta store
                db.createObjectStore('meta', { keyPath: 'key' });
            }
        });
    }

    async sync(registry, provider) {
        const lastBlock = await this.getLastIndexedBlock();
        const currentBlock = await provider.getBlockNumber();

        if (lastBlock === 0) {
            await this._fullSync(registry, currentBlock);
        } else if (currentBlock > lastBlock) {
            await this._incrementalSync(registry, lastBlock, currentBlock);
        }
    }

    async _fullSync(registry, toBlock) {
        const events = await registry.queryFilter(
            registry.filters.InstanceRegistered(),
            0,
            toBlock
        );

        const db = await this.dbPromise;
        const tx = db.transaction('projects', 'readwrite');

        for (const event of events) {
            await tx.store.put({
                address: event.args.instance,
                name: event.args.name,
                factory: event.args.factory,
                creator: event.args.creator,
                blockNumber: event.blockNumber,
                // contractType resolved later or from factory
            });
        }

        await tx.done;
        await this.setLastIndexedBlock(toBlock);
    }

    async _incrementalSync(registry, fromBlock, toBlock) {
        const events = await registry.queryFilter(
            registry.filters.InstanceRegistered(),
            fromBlock + 1,
            toBlock
        );

        const db = await this.dbPromise;
        for (const event of events) {
            await db.put('projects', {
                address: event.args.instance,
                name: event.args.name,
                factory: event.args.factory,
                creator: event.args.creator,
                blockNumber: event.blockNumber,
            });
        }

        await this.setLastIndexedBlock(toBlock);
    }

    async search(query) {
        const db = await this.dbPromise;
        const all = await db.getAll('projects');

        const lowerQuery = query.toLowerCase();
        return all
            .filter(p => p.name.toLowerCase().includes(lowerQuery))
            .map(p => p.address);
    }

    async filterBy({ contractType, vault, creator }) {
        const db = await this.dbPromise;
        let results = await db.getAll('projects');

        if (contractType) {
            results = results.filter(p => p.contractType === contractType);
        }
        if (vault) {
            results = results.filter(p => p.vault === vault);
        }
        if (creator) {
            results = results.filter(p => p.creator === creator);
        }

        return results.map(p => p.address);
    }

    // Storage management
    async getStorageStats() {
        const db = await this.dbPromise;
        const projectCount = await db.count('projects');
        const lastBlock = await this.getLastIndexedBlock();

        const estimate = await navigator.storage?.estimate?.();

        return {
            projectCount,
            lastIndexedBlock: lastBlock,
            estimatedSize: estimate?.usage || null,
            quota: estimate?.quota || null
        };
    }

    async clearIndex() {
        const db = await this.dbPromise;
        await db.clear('projects');
        await this.setLastIndexedBlock(0);
        eventBus.emit('index:cleared');
    }

    async getIndexMode() {
        const db = await this.dbPromise;
        const meta = await db.get('meta', 'indexMode');
        return meta?.value || 'full';
    }

    async setIndexMode(mode) {
        const db = await this.dbPromise;
        await db.put('meta', { key: 'indexMode', value: mode });

        if (mode === 'off') {
            await this.clearIndex();
        }
    }

    async getLastIndexedBlock() {
        const db = await this.dbPromise;
        const meta = await db.get('meta', 'lastIndexedBlock');
        return meta?.value || 0;
    }

    async setLastIndexedBlock(block) {
        const db = await this.dbPromise;
        await db.put('meta', { key: 'lastIndexedBlock', value: block });
    }
}

export const projectIndex = new ProjectIndex();
```

### 4. Storage Settings Component

**File:** `src/components/StorageSettings/StorageSettings.js`

```javascript
class StorageSettings extends Component {
    constructor() {
        super();
        this.state = {
            stats: null,
            indexMode: 'full',
            loading: true
        };
    }

    async connectedCallback() {
        await this.loadStats();
    }

    async loadStats() {
        const [stats, mode] = await Promise.all([
            projectIndex.getStorageStats(),
            projectIndex.getIndexMode()
        ]);

        this.setState({
            stats,
            indexMode: mode,
            loading: false
        });
    }

    async handleClearIndex() {
        if (confirm('Clear local project index? You will need to re-sync on next search.')) {
            await projectIndex.clearIndex();
            await this.loadStats();
        }
    }

    async handleModeChange(mode) {
        await projectIndex.setIndexMode(mode);
        this.setState({ indexMode: mode });
    }

    async handleResync() {
        this.setState({ loading: true });
        await projectIndex.clearIndex();
        await projectIndex.sync(registry, provider);
        await this.loadStats();
    }

    render() {
        const { stats, indexMode, loading } = this.state;

        if (loading) {
            return `<div class="loading">Loading...</div>`;
        }

        const sizeDisplay = stats.estimatedSize
            ? `${(stats.estimatedSize / 1024 / 1024).toFixed(2)} MB`
            : 'Unknown';

        return `
            <div class="storage-settings">
                <h3>Local Data Settings</h3>

                <div class="stats-section">
                    <div class="stat">
                        <label>Projects indexed:</label>
                        <span>${stats.projectCount.toLocaleString()}</span>
                    </div>
                    <div class="stat">
                        <label>Storage used:</label>
                        <span>${sizeDisplay}</span>
                    </div>
                    <div class="stat">
                        <label>Last synced:</label>
                        <span>Block ${stats.lastIndexedBlock.toLocaleString()}</span>
                    </div>
                </div>

                <div class="mode-section">
                    <label>Index Mode:</label>
                    <div class="mode-options">
                        <label>
                            <input type="radio" name="mode" value="full"
                                ${indexMode === 'full' ? 'checked' : ''}
                                onchange="this.handleModeChange('full')">
                            Full (fastest search, more storage)
                        </label>
                        <label>
                            <input type="radio" name="mode" value="minimal"
                                ${indexMode === 'minimal' ? 'checked' : ''}
                                onchange="this.handleModeChange('minimal')">
                            Minimal (only your projects)
                        </label>
                        <label>
                            <input type="radio" name="mode" value="off"
                                ${indexMode === 'off' ? 'checked' : ''}
                                onchange="this.handleModeChange('off')">
                            Off (no local storage, slower)
                        </label>
                    </div>
                </div>

                <div class="actions">
                    <button onclick="this.handleClearIndex()">Clear Index</button>
                    <button onclick="this.handleResync()">Re-sync Now</button>
                </div>

                <p class="info">
                    This data is stored locally in your browser.
                    Clearing it will require re-syncing from the blockchain on next visit.
                </p>
            </div>
        `;
    }
}
```

---

## Query Cost Analysis

### Before vs After

| Page | Before (RPC calls) | After (RPC calls) | Improvement |
|------|-------------------|-------------------|-------------|
| Home (20 projects) | 80+ | **1** | 98.75% |
| Portfolio | 50+ per project | **1** | ~98% |
| Vault Explorer | 20+ | **1** | 95% |
| Project Detail | 10+ | **2-3** | 70-80% |
| Search 10k projects | Impossible | **0** (IndexedDB) | ∞ |

### Scale Characteristics

| Projects | First Visit (Index) | Subsequent Visits | Search/Filter |
|----------|---------------------|-------------------|---------------|
| 100 | ~2s | Instant | Instant |
| 1,000 | ~5s | Instant | Instant |
| 10,000 | ~15s | Instant | Instant |
| 100,000 | ~60s | Instant | Instant |

---

## Implementation Roadmap

### Phase A: Contract Changes (Contract Team) ✅ COMPLETE

1. ✅ Add `getCardData()` to ERC404BondingInstance
2. ✅ Add `getCardData()` to ERC1155Instance
3. ✅ Create `QueryAggregator.sol` contract
4. ✅ Deploy and verify

**Deliverable:** QueryAggregator deployed at `0x3b827220209E553a54b16b329fb3501061512F8C` (local)

**Note:** Contract needs bounds-clamping fix when `offset + limit` exceeds queue length. See `docs/plans/2026-01-20-query-aggregator-contract-fix.md`.

### Phase B: Client Query Layer (Frontend Team) ✅ COMPLETE

1. ✅ Create `QueryAggregatorAdapter.js` - `src/services/contracts/QueryAggregatorAdapter.js`
2. ✅ Create `QueryService.js` with caching/deduplication - `src/services/QueryService.js`
3. ✅ Wire up to existing components (HomePage via HomePageDataProvider)
4. ✅ Add fallback to individual adapters if QueryAggregator unavailable

**Deliverable:** Working query layer with automatic fallback

**Files Created:**
- `src/services/QueryService.js` - Central caching/deduplication layer
- `src/services/contracts/QueryAggregatorAdapter.js` - Contract wrapper
- `src/components/HomePageDataProvider/HomePageDataProvider.js` - Batched data provider

### Phase C: Event Indexing (Frontend Team) ✅ COMPLETE

1. ✅ Create `ProjectIndex.js` with IndexedDB - `src/services/ProjectIndex.js`
2. ✅ Implement sync logic (full + incremental)
3. ✅ Add search/filter methods
4. ✅ Create `StorageSettings` component - `src/components/StorageSettings/StorageSettings.js`

**Deliverable:** Working local index with user controls

### Phase D: Migration & Cleanup (Frontend Team) ✅ COMPLETE

1. ✅ Remove sequential loops in existing code
   - Parallelized `RealMasterService.getAllFactories()`, `getAllVaults()`, `getAllInstances()`
   - Parallelized `MasterRegistryAdapter.getFactories()`
2. ✅ Migrate components to use QueryService
   - HomePage via HomePageDataProvider
   - VaultExplorer via `queryService.getVaultLeaderboard()`
   - TopVaultsWidget, RecentActivityWidget, ProjectDiscovery via data provider
3. ✅ Keep adapter methods as fallbacks (graceful degradation)
4. ⏳ Performance testing at scale (deferred)

**Deliverable:** Fully migrated, optimized frontend

---

## Implementation Results

### Measured Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Home page RPC calls | 80+ | ~3 | **96% reduction** |
| Home page load time | Variable | **176ms** | Consistent |
| Caching | None | TTL-based | ✅ |
| Request deduplication | None | In-flight dedup | ✅ |
| Fallback on failure | None | Graceful | ✅ |

### Architecture Implemented

```
HomePage
    └── HomePageDataProvider
            │
            ├── queryService.getHomePageData()
            │       │
            │       ├── [Try] QueryAggregator.getHomePageData()
            │       │
            │       └── [Fallback] Individual adapter calls
            │
            ├── TopVaultsWidget.setVaultsData()
            ├── RecentActivityWidget.setMessagesData()
            └── ProjectDiscovery.setProjectsData()
```

---

## Appendix: Existing Contract References

### MasterRegistry Data Structures

```solidity
struct InstanceInfo {
    address instance;
    address factory;
    address creator;
    address vault;
    string name;
    string metadataURI;
    bytes32 nameHash;
    uint256 registeredAt;
}

struct FactoryInfo {
    address factoryAddress;
    uint256 factoryId;
    string contractType;
    string title;
    string displayTitle;
    string metadataURI;
    bytes32[] features;
    address creator;
    bool active;
    uint256 registeredAt;
}

struct VaultInfo {
    address vault;
    address creator;
    string name;
    string metadataURI;
    bool active;
    uint256 registeredAt;
    uint256 instanceCount;
}
```

### FeaturedQueueManager Data Structures

```solidity
struct RentalSlot {
    address instance;
    address renter;
    uint256 rentPaid;
    uint256 rentedAt;
    uint256 expiresAt;
    uint256 originalPosition;
    bool active;
}
```

### Events for Indexing

```solidity
// MasterRegistry
event InstanceRegistered(
    address indexed instance,
    address indexed factory,
    address indexed creator,
    string name
);

// ERC404Factory
event InstanceCreated(
    address indexed instance,
    address indexed creator,
    string name,
    string symbol,
    address indexed vault,
    address hook
);

// ERC1155Factory
event InstanceCreated(
    address indexed instance,
    address indexed creator,
    string name,
    address indexed vault
);
```
