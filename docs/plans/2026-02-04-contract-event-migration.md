# Contract Event Migration Report

> **Living Document** - Findings logged during microact migration.
> When we encounter contract getter patterns that could be replaced by indexed event queries, we document them here for the contract team.

---

## Background

During the microact/micro-web3 migration, we discovered that indexed events can reliably reconstruct on-chain state. This obsoletes many contract patterns that were designed assuming indexed events weren't feasible:

- Storing arrays/mappings with getter functions
- Maintaining counter variables for enumeration
- Complex struct storage for data that could be derived from events

The micro-web3 `EventIndexer` provides:
- **Level 1 (Events)**: Raw indexed event queries with filtering
- **Level 2 (Entities)**: Domain objects derived from events
- **Level 3 (Patterns)**: Pre-built activity feeds, leaderboards

---

## How to Use This Document

When migrating a component and encountering a clunky getter pattern:

1. **STOP** - Don't migrate that data-fetching code
2. **Document** the pattern below with:
   - Current contract getter/storage pattern
   - Which events could replace it
   - Proposed event-based approach
3. **Create stub** in the migrated component that assumes improvement
4. **Continue** with the rest of the migration

---

## Findings

### Template

```markdown
### [Finding Title]

**Component**: `ComponentName.js`
**Contract**: `ContractName.sol`
**Severity**: High/Medium/Low (impact on gas/complexity)

**Current Pattern**:
```solidity
// Current contract code
```

**Current Frontend Usage**:
```javascript
// How it's currently queried
```

**Events Available**:
```solidity
// Existing events that could be used
```

**Proposed Change**:
- Contract: [what to change/add]
- Frontend: [how to query via EventIndexer]

**Migration Status**: Stubbed / Blocked / Completed
```

---

## Active Findings

### 1. GlobalMessageRegistry - Messages Storage

**Component**: `RecentActivityWidget.js`
**Contract**: `GlobalMessageRegistry.sol`
**Severity**: Medium (storage cost, complexity)

**Current Pattern**:
The GlobalMessageRegistry stores messages in an array with a `getRecentMessages(count)` function that returns the last N messages from storage.

**Current Frontend Usage**:
```javascript
const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
const rawMessages = await messageAdapter.getRecentMessages(5);
```

**Events Available**:
The contract likely emits events when messages are posted. These could be:
```solidity
event MessagePosted(
    uint256 indexed id,
    address indexed instance,
    address indexed sender,
    uint256 packedData,
    string message
);
```

**Proposed Change**:
- Contract: Ensure `MessagePosted` event has indexed fields for `instance` and `sender`
- Frontend: Use EventIndexer to query recent messages:
```javascript
const messages = await indexer.events.query('MessagePosted', {
    orderBy: 'blockNumber',
    order: 'desc',
    limit: 5
});
```

**Benefits**:
- No storage array needed in contract (saves gas on writes)
- Frontend can filter by instance, sender, etc.
- Historical messages always available via events

**Migration Status**: Documented - Pending contract team review

---

### 2. MasterRegistry - Vault Leaderboards

**Component**: `VaultExplorer.js`, `TopVaultsWidget.js`
**Contract**: `MasterRegistryV1.sol`
**Severity**: High (complex storage, gas-heavy enumeration)

**Current Pattern**:
The MasterRegistry stores vault data in arrays and provides `getVaultsByTVL(limit)` and `getVaultsByPopularity(limit)` functions that enumerate and sort vaults on-chain.

**Current Frontend Usage**:
```javascript
// Via QueryService fallback
const rawVaults = await masterService.getVaultsByTVL(limit);
const rawVaults = await masterService.getVaultsByPopularity(limit);
```

**Events Available**:
Vaults should emit events when registered and when their stats change:
```solidity
event VaultRegistered(
    address indexed vault,
    address indexed alignmentToken,
    string name,
    uint256 timestamp
);

event VaultStatsUpdated(
    address indexed vault,
    uint256 tvl,
    uint256 instanceCount,
    uint256 timestamp
);
```

**Proposed Change**:
- Contract: Remove vault enumeration arrays; emit indexed events on vault registration and stat changes
- Frontend: Use EventIndexer with entity definitions:
```javascript
const indexer = createEventIndexer({
    contract: { address: masterRegistry, abi: MASTER_ABI },
    entities: {
        Vault: {
            idField: 'vault',
            events: ['VaultRegistered', 'VaultStatsUpdated'],
            reduce: (prev, event) => ({
                ...prev,
                vault: event.vault,
                tvl: event.tvl || prev?.tvl || 0,
                instanceCount: event.instanceCount || prev?.instanceCount || 0
            })
        }
    }
});

// Query with sorting
const topByTVL = await indexer.entities.Vault.query({
    orderBy: 'tvl',
    order: 'desc',
    limit: 10
});
```

**Benefits**:
- Removes O(n) enumeration from contract
- No storage arrays needed
- Frontend can sort/filter flexibly
- Historical rankings available via events

**Migration Status**: Documented - Pending contract team review

---

### 3. MasterRegistry - Project/Instance Enumeration

**Component**: `ProjectDiscovery.js`, `ProjectService.js`
**Contract**: `MasterRegistryV1.sol`
**Severity**: High (storage arrays, O(n) operations)

**Current Pattern**:
```solidity
// Contract stores instances in arrays
Instance[] public instances;
address[] public authorizedFactories;

function getAllInstances() external view returns (Instance[] memory);
function getAuthorizedFactories() external view returns (address[] memory);
```

**Current Frontend Usage**:
```javascript
const allProjects = await projectRegistry.getAllProjects();
const factoryAddresses = await masterService.getAuthorizedFactories();
```

**Events Available**:
```solidity
event InstanceRegistered(
    address indexed instance,
    address indexed factory,
    address indexed vault,
    address creator,
    string name,
    uint256 timestamp
);

event FactoryAuthorized(address indexed factory, string contractType);
event FactoryDeauthorized(address indexed factory);
```

**Proposed Change**:
- Contract: Emit indexed events on registration, remove `getAllInstances()` getter
- Frontend: Use EventIndexer to build project list:
```javascript
const projects = await indexer.events.query('InstanceRegistered', {
    orderBy: 'timestamp',
    order: 'desc',
    limit: 50
});
```

**Benefits**:
- Removes unbounded array storage
- Gas savings on contract deployment
- Frontend can filter by factory, vault, creator
- Pagination via event cursor

**Migration Status**: Documented - Pending contract team review

---

### 4. ERC404 NFT Enumeration

**Component**: `NFTGalleryPreview.js`
**Contract**: `ERC404BondingInstance.sol`, Mirror contracts
**Severity**: Medium (complex enumeration, multiple fallback methods)

**Current Pattern**:
The NFT gallery requires multiple fallback methods to enumerate NFTs:
```solidity
// Multiple methods tried in sequence:
totalNFTSupply()
getTotalNFTsMinted()
mirrorContract.totalSupply()

// For individual tokens:
tokenByIndex(i)
nftTokenByIndex(i)
mirrorContract.tokenByIndex(i)
```

**Current Frontend Usage**:
```javascript
// Component tries multiple methods in fallback chain
if (typeof this.adapter.totalNFTSupply === 'function') { ... }
if (typeof this.adapter.tokenByIndex === 'function') { ... }
// Plus mirror contract fallbacks for each method
```

**Events Available**:
ERC721 Transfer events provide all needed data:
```solidity
event Transfer(
    address indexed from,
    address indexed to,
    uint256 indexed tokenId
);
```

**Proposed Change**:
- Contract: Ensure mirror contract emits standard ERC721 Transfer events with indexed tokenId
- Frontend: Use EventIndexer to track NFT ownership:
```javascript
const indexer = createEventIndexer({
    contract: { address: mirrorAddress, abi: ERC721_ABI },
    entities: {
        NFT: {
            idField: 'tokenId',
            events: ['Transfer'],
            reduce: (prev, event) => ({
                tokenId: event.tokenId,
                owner: event.to,
                mintedAt: event.blockNumber
            })
        }
    }
});

// Query all NFTs, sorted by mint order
const nfts = await indexer.entities.NFT.query({
    where: { owner: { ne: '0x0000000000000000000000000000000000000000' } },
    orderBy: 'mintedAt',
    limit: 12
});
```

**Benefits**:
- Eliminates multiple enumeration method fallbacks
- Standard ERC721 events work across all implementations
- No custom totalSupply/tokenByIndex methods needed
- Filter by owner, token range, time period

**Migration Status**: Documented - Pending contract team review

---

## Summary Table

| # | Component | Contract | Pattern | Status |
|---|-----------|----------|---------|--------|
| 1 | RecentActivityWidget | GlobalMessageRegistry | Message array storage | Documented |
| 2 | VaultExplorer, TopVaultsWidget | MasterRegistryV1 | Vault enumeration/sorting | Documented |
| 3 | ProjectDiscovery, ProjectService | MasterRegistryV1 | Instance/Factory enumeration | Documented |
| 4 | NFTGalleryPreview | ERC404/Mirror | NFT enumeration (tokenByIndex) | Documented |
| 5 | ChatPanel | ERC404BondingInstance | Transaction message storage | Documented |
| 6 | UserPortfolio | ERC404/ERC1155/Vaults | Full instance scan for holdings | Documented |

---

### 5. Transaction Message Storage

**Component**: `ChatPanel.js`
**Contract**: `ERC404BondingInstance.sol` (or similar bonding contract)
**Severity**: High (unbounded array storage, complex batch retrieval)

**Current Pattern**:
The contract stores transaction messages in arrays and provides batch retrieval:
```solidity
// Messages stored in contract state
Message[] public messages;
uint256 public totalMessages;

// Batch retrieval returns comma-separated strings
function getMessagesBatch(uint256 startIndex, uint256 endIndex)
    external view returns (string[5] memory);
// Returns: [senders, timestamps, amounts, isBuys, messages]
```

**Current Frontend Usage**:
```javascript
// Initial load from contract data
const senders = this.parseMessageData(contractData.recentMessages[0]);
const timestamps = this.parseMessageData(contractData.recentMessages[1]);
// ... parse comma-separated strings

// Load more via batch getter
const newBatch = await blockchainService.getMessagesBatch(startIndex, endIndex);
```

**Events Available**:
Transaction events with message data:
```solidity
event TransactionWithMessage(
    address indexed sender,
    uint256 amount,
    bool indexed isBuy,
    string message,
    uint256 timestamp
);
```

**Proposed Change**:
- Contract: Remove message array storage; emit indexed event on each transaction with message
- Frontend: Use EventIndexer to query transaction messages:
```javascript
const indexer = createEventIndexer({
    contract: { address: instanceAddress, abi: BONDING_ABI },
    entities: {
        Message: {
            idField: (e) => `${e.sender}-${e.blockTimestamp}`,
            events: ['TransactionWithMessage'],
            reduce: (prev, event) => ({
                address: event.sender,
                timestamp: event.timestamp || event.blockTimestamp,
                amount: event.amount.toString(),
                isBuy: event.isBuy,
                content: event.message
            })
        }
    }
});

// Query messages sorted by timestamp
const messages = await indexer.entities.Message.query({
    orderBy: 'timestamp',
    order: 'asc',
    limit: 50
});
```

**Benefits**:
- Eliminates unbounded array storage (major gas savings)
- No comma-separated string parsing needed
- Frontend can paginate via event cursor
- Messages if they contain commas won't break parsing
- Historical messages always available

**Migration Status**: Documented - Pending contract team review

---

### 6. User Holdings Discovery - Full Instance Scanning

**Component**: `UserPortfolio.js`
**Contract**: All ERC404/ERC1155/Vault instances
**Severity**: High (O(n) RPC calls, poor UX on large registries)

**Current Pattern**:
The UserPortfolio component needs to discover which instances a user has holdings in. It currently performs a "full scan" of all registered instances:

```javascript
// Current approach: Query ALL instances to find user holdings
async _performFullScan(userAddress) {
    // Get ALL instance addresses from registry
    const allProjects = await projectIndex.getAllProjects(1000, 0);
    allInstances = allProjects.map(p => p.address);

    // Fallback to MasterRegistry
    const instances = await masterService.getAllInstances();

    // Batch check each instance for holdings (20 at a time)
    for (let i = 0; i < allInstances.length; i += batchSize) {
        const batchData = await queryService.getPortfolioData(userAddress, batch);
        // Check if user has holdings in each...
    }
}
```

**Current Frontend Usage**:
```javascript
// UserHoldingsIndex caches which instances user has holdings in
instanceAddresses = await userHoldingsIndex.getHoldingInstances(userAddress);

// If no cache, full scan required
if (instanceAddresses.length === 0) {
    await this._performFullScan(userAddress);
}
```

**Events Available**:
ERC20/ERC721 Transfer events contain all data needed:
```solidity
// ERC20 Transfer (from ERC404 fungible side)
event Transfer(address indexed from, address indexed to, uint256 value);

// ERC721 Transfer (from ERC404 NFT side or ERC1155)
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

// ERC1155 TransferSingle/TransferBatch
event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
```

**Proposed Change**:
- Contract: No changes needed - Transfer events already exist
- Infrastructure: Deploy an event indexer that watches Transfer events across all instances
- Frontend: Query user's holdings from event-derived index:

```javascript
const indexer = createEventIndexer({
    contracts: instances.map(addr => ({ address: addr, abi: ERC404_ABI })),
    entities: {
        UserHolding: {
            idField: (e) => `${e.to}-${e.address}`, // user-instance pair
            events: ['Transfer'],
            reduce: (prev, event) => {
                // Track if user has any balance in this instance
                const isReceive = event.to.toLowerCase() === userAddress.toLowerCase();
                const isSend = event.from.toLowerCase() === userAddress.toLowerCase();

                return {
                    user: userAddress,
                    instance: event.address,
                    hasHoldings: isReceive || (prev?.hasHoldings && !isSend)
                };
            }
        }
    }
});

// Query all instances where user has holdings
const holdings = await indexer.entities.UserHolding.query({
    where: { user: userAddress, hasHoldings: true }
});
```

**Benefits**:
- Eliminates O(n) full scan of all instances
- No local storage/caching needed (UserHoldingsIndex)
- Real-time updates as transfers occur
- Works across all contract types (ERC404, ERC1155, Vaults)
- Historical holdings always derivable from events

**Migration Status**: Documented - Pending contract team review

---

## Notes for Contract Team

- All proposed event indexes should be `indexed` in Solidity for efficient filtering
- Consider deploy block for historical sync (EventIndexer needs this)
- Events are cheaper than storage for data that's primarily read off-chain
- Frontend can reconstruct state from events + current chain state

---

## Related Documents

- `docs/plans/MICROACT_IMPROVEMENTS.md` - Component system friction
- `docs/plans/2026-01-20-query-architecture-design.md` - Query architecture
