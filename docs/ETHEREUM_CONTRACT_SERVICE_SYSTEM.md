# Ethereum Contract Service System Documentation

## Overview

This document provides an in-depth understanding of the Ethereum contract service system used in the MS2Fun project. The system has evolved from a single onchain implementation (CULT EXEC) to a comprehensive multi-project architecture that supports both mock and real contract interactions.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Services](#core-services)
3. [Contract Adapter System](#contract-adapter-system)
4. [Mock vs Real System](#mock-vs-real-system)
5. [CULT EXEC Implementation (Original)](#cult-exec-implementation-original)
6. [Project Service System (New)](#project-service-system-new)
7. [Contract Interaction Flow](#contract-interaction-flow)
8. [Migration Path](#migration-path)
9. [Key Concepts](#key-concepts)
10. [Best Practices](#best-practices)

---

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    UI Components Layer                       │
│  (CultExecsPage, TradingInterface, ERC404TradingInterface) │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  Service Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │WalletService │  │ProjectService│  │BlockchainService│  │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Adapter Layer                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ERC404Adapter │  │ERC1155Adapter │  │ContractAdapter│    │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Contract Layer                                  │
│         (Ethers.js Contract Instances)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Blockchain Layer                                │
│         (Ethereum Network via Web3 Provider)                │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Separation of Concerns**: Each layer has a specific responsibility
2. **Adapter Pattern**: Unified interface for different contract types
3. **Service Factory**: Centralized service access with mock/real switching
4. **Event-Driven**: Uses EventBus for loose coupling
5. **Caching**: ContractCache for performance optimization

---

## Core Services

### 1. WalletService (`src/services/WalletService.js`)

**Purpose**: Manages wallet connections, detection, and provider/signer management.

**Key Responsibilities**:
- Detect available wallet providers (MetaMask, Rabby, Rainbow, Phantom)
- Handle wallet selection and connection
- Manage ethers provider and signer instances
- Listen for account/network changes
- Provide wallet connection state

**Key Methods**:
```javascript
// Initialize wallet service
await walletService.initialize()

// Select a wallet type
await walletService.selectWallet('metamask')

// Connect to selected wallet
const address = await walletService.connect()

// Get provider and signer
const { provider, signer } = walletService.getProviderAndSigner()

// Check connection status
const isConnected = walletService.isConnected()
```

**Events Emitted**:
- `wallet:detected` - Wallet provider found
- `wallet:selected` - Wallet type selected
- `wallet:connecting` - Connection in progress
- `wallet:connected` - Successfully connected
- `wallet:disconnected` - Wallet disconnected
- `wallet:error` - Connection error

**Usage in CultExecsPage**:
```javascript
// Initialize wallet service
if (!walletService.isInitialized) {
    await walletService.initialize();
}

// Check for existing connection
if (walletService.isConnected()) {
    // Wallet already connected, use existing provider/signer
    const { provider, signer } = walletService.getProviderAndSigner();
}
```

---

### 2. BlockchainService (`src/services/BlockchainService.js`)

**Purpose**: Direct contract interaction service for CULT EXEC (legacy system).

**Key Responsibilities**:
- Initialize contract instances (main contract, mirror contract, swap router)
- Execute contract calls (read and write)
- Handle network switching
- Manage transaction lifecycle
- Cache contract data

**Key Methods**:
```javascript
// Initialize service
await blockchainService.initialize()

// Read operations
const balance = await blockchainService.getTokenBalance(address)
const price = await blockchainService.getCurrentPrice()
const nftBalance = await blockchainService.getNFTBalance(address)

// Write operations (require signer)
const receipt = await blockchainService.buyBonding(params, ethValue)
const receipt = await blockchainService.sellBonding(params)
const receipt = await blockchainService.balanceMint(amount)

// Generic contract call
const result = await blockchainService.executeContractCall(
    'methodName',
    [arg1, arg2],
    { requiresSigner: true, useContract: 'mirror' }
)
```

**Contract Instances**:
- `this.contract` - Main ERC404 contract
- `this.mirrorContract` - Mirror ERC721 contract
- `this.swapRouter` - Uniswap V2 router (for Phase 2 trading)
- `this.v2PoolContract` - Uniswap V2 liquidity pool

**Network Management**:
- Automatically switches to correct network on initialization
- Handles network change events
- Manages network switch state machine

**Events Emitted**:
- `blockchain:initialized` - Service initialized
- `contract:updated` - Contract state changed
- `network:switching` - Network switch in progress
- `network:switched` - Network switch complete
- `transaction:pending` - Transaction sent
- `transaction:success` - Transaction confirmed
- `transaction:error` - Transaction failed

**Usage**: Primarily used by CULT EXEC page via TradingInterface component.

---

### 3. ProjectService (`src/services/ProjectService.js`)

**Purpose**: Multi-project contract management system (new architecture).

**Key Responsibilities**:
- Load and manage multiple contract instances
- Auto-detect contract types (ERC404, ERC1155)
- Create appropriate adapters for each contract
- Manage active project switching
- Initialize projects in ProjectStore

**Key Methods**:
```javascript
// Load a project
const instance = await projectService.loadProject(
    projectId,
    contractAddress,
    contractType // optional, auto-detected if null
)

// Load CULT EXEC specifically
const instance = await projectService.loadCultExec()

// Switch active project
await projectService.switchProject(projectId)

// Get adapter for a project
const adapter = projectService.getAdapter(projectId)

// Get active adapter
const adapter = projectService.getActiveAdapter()
```

**Project Instance Structure**:
```javascript
{
    projectId: 'exec404',
    contractAddress: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
    contractType: 'ERC404',
    adapter: ERC404Adapter instance,
    metadata: {
        name: 'CULT EXEC',
        factoryAddress: null,
        isFactoryCreated: false,
        // ... other metadata
    },
    loadedAt: 1234567890
}
```

**Contract Type Detection**:
- Checks ABI for contract-specific functions
- ERC404: `buyBonding`, `sellBonding`, `getCurrentPrice`
- ERC1155: `balanceOfBatch`, `safeBatchTransferFrom`, `uri`

**Events Emitted**:
- `project:loaded` - Project loaded successfully
- `project:switched` - Active project changed
- `project:unloaded` - Project unloaded

**Usage**: Used by factory-created projects and ERC404TradingInterface.

---

### 4. ServiceFactory (`src/services/ServiceFactory.js`)

**Purpose**: Centralized service access with mock/real switching.

**Key Responsibilities**:
- Provide singleton service instances
- Switch between mock and real services via feature flag
- Manage service lifecycle

**Configuration** (`src/config.js`):
```javascript
export const USE_MOCK_SERVICES = true; // Set to false for real contracts
```

**Key Methods**:
```javascript
// Get ProjectService (always real, no mock)
const projectService = serviceFactory.getProjectService()

// Get BlockchainService (always real, no mock)
const blockchainService = serviceFactory.getBlockchainService()

// Get mock services (only when USE_MOCK_SERVICES = true)
const masterService = serviceFactory.getMasterService()
const factoryService = serviceFactory.getFactoryService()
const projectRegistry = serviceFactory.getProjectRegistry()

// Check if using mock
const isMock = serviceFactory.isUsingMock()
```

**Service Selection Logic**:
- CULT EXEC (`exec404`): Uses `BlockchainService`
- Factory-created projects: Use `ProjectService`
- Mock projects: Use mock services when `USE_MOCK_SERVICES = true`

---

## Contract Adapter System

### ContractAdapter Base Class (`src/services/contracts/ContractAdapter.js`)

**Purpose**: Base class providing unified interface for all contract types.

**Key Features**:
- Mock mode detection and handling
- Generic contract call execution
- Error handling and wrapping
- Caching integration
- Ownership checking

**Mock Detection**:
```javascript
// Detects mock contracts by:
// 1. Address pattern (starts with '0xMOCK' or contains 'mock')
// 2. Factory addresses (starts with '0xFACTORY')
// 3. localStorage mock data registry
```

**Key Methods**:
```javascript
// Execute contract call (handles mock automatically)
const result = await adapter.executeContractCall(
    'methodName',
    [arg1, arg2],
    {
        requiresSigner: true,  // Use signer for write operations
        txOptions: { value: ethAmount }  // For payable functions
    }
)

// Get cached or fetch value
const value = await adapter.getCachedOrFetch(
    'getBalance',
    [address],
    async () => {
        return await adapter.executeContractCall('balanceOf', [address])
    }
)

// Check ownership
const isOwner = await adapter.checkOwnership(userAddress)

// Get admin functions
const adminFunctions = await adapter.getAdminFunctions()
```

**Mock Value Handling**:
When in mock mode, `executeContractCall` returns mock values:
- `balanceOf`: Returns `BigNumber.from('0')`
- `calculateCost`: Returns `parseEther('0.1')`
- `totalSupply`: Returns `BigNumber.from('0')`
- Other methods: Return appropriate defaults

---

### ERC404Adapter (`src/services/contracts/ERC404Adapter.js`)

**Purpose**: ERC404-specific contract operations.

**Key Methods**:
```javascript
// Balance operations
const tokenBalance = await adapter.getTokenBalance(address)
const nftBalance = await adapter.getNFTBalance(address)
const ethBalance = await adapter.getEthBalance(address)

// Price operations
const price = await adapter.getCurrentPrice() // Price for 1M tokens
const cost = await adapter.calculateCost(tokenAmount)

// Trading operations
const receipt = await adapter.buyBonding(amount, maxCost, proof, message)
const receipt = await adapter.sellBonding(amount, minReturn, proof, message)

// NFT operations
const receipt = await adapter.mintNFT(amount)
const nftIds = await adapter.getUserNFTIds(address)
const uri = await adapter.getTokenUri(tokenId)

// Phase detection
const phase = await adapter.getPhase() // 0, 1, or 2
const isPhase2 = await adapter.isPhase2()
const liquidityPool = await adapter.getLiquidityPool()

// Free mint operations
const freeMint = await adapter.getFreeMint(address)
const freeSupply = await adapter.getFreeSupply()
const freeSituation = await adapter.getFreeSituation(address)
```

**Special Features**:
- **Mirror Contract**: Automatically initializes mirror ERC721 contract
- **Operator NFT**: Special handling for CULT EXEC operator NFT (token 598)
- **Ownership Check**: Overrides base class to check operator NFT ownership for CULT EXEC

**Initialization**:
```javascript
// Loads contract ABI from /EXEC404/abi.json
// Initializes main contract and mirror contract
// Sets up operator NFT contract for CULT EXEC
await adapter.initialize()
```

---

### ERC1155Adapter (`src/services/contracts/ERC1155Adapter.js`)

**Purpose**: ERC1155-specific contract operations (for multi-token projects).

**Key Methods**:
```javascript
// Balance operations
const balance = await adapter.getBalance(address, tokenId)
const balances = await adapter.getBalanceBatch(address, tokenIds)

// Transfer operations
const receipt = await adapter.safeTransferFrom(from, to, id, amount, data)
const receipt = await adapter.safeBatchTransferFrom(from, to, ids, amounts, data)

// Metadata operations
const uri = await adapter.uri(tokenId)
```

---

## Mock vs Real System

### Mock System Architecture

**Purpose**: Simulate contract interactions without real blockchain.

**Components**:
1. **MockServiceManager**: Manages all mock services
2. **MockMasterService**: Simulates master contract
3. **MockFactoryService**: Simulates factory contracts
4. **MockProjectRegistry**: Registry of mock projects
5. **MockAdminService**: Admin function simulation

**Mock Data Storage**:
- In-memory during session
- localStorage for persistence
- Key: `mockLaunchpadData`

**Mock Contract Detection**:
```javascript
// ContractAdapter detects mock contracts by:
1. Address pattern: starts with '0xMOCK' or contains 'mock'
2. Factory pattern: starts with '0xFACTORY'
3. localStorage registry check
```

**Mock Behavior**:
- Read operations return default/mock values
- Write operations simulate success (no actual transaction)
- Events are still emitted for UI consistency
- No gas costs or network calls

**Configuration**:
```javascript
// src/config.js
export const USE_MOCK_SERVICES = true; // Enable mock mode
```

---

### Real System Architecture

**Purpose**: Actual blockchain interactions via ethers.js.

**Components**:
1. **WalletService**: Real wallet connections
2. **BlockchainService**: Real contract calls
3. **ProjectService**: Real adapter instances
4. **ContractAdapter**: Real ethers contract instances

**Real Contract Flow**:
```
1. Wallet connects → WalletService
2. Provider/Signer created → Ethers Web3Provider
3. Contract initialized → Ethers Contract instance
4. Method called → Actual blockchain transaction
5. Transaction confirmed → Receipt returned
6. Events emitted → UI updates
```

**Network Requirements**:
- Must be on correct network (handled automatically)
- Requires wallet connection for write operations
- Gas fees apply for transactions

---

## CULT EXEC Implementation (Original)

### Overview

CULT EXEC was the original and only working onchain aspect of the project. It uses a direct service approach with `BlockchainService`.

### Architecture

```
CultExecsPage.js
    ↓
WalletConnector.js
    ↓
TradingInterface.js
    ↓
BlockchainService.js
    ↓
Ethers Contract Instances
    ↓
Ethereum Network
```

### Key Components

**1. CultExecsPage.js**:
- Renders CULT EXEC page UI
- Initializes wallet connection
- Shows/hides contract interface based on `switch.json`
- Manages tab navigation

**2. WalletConnector.js**:
- Handles wallet selection UI
- Manages wallet connection flow
- Initializes TradingInterface on connection
- Shows wallet status

**3. TradingInterface.js**:
- Main trading UI component
- Uses `BlockchainService` directly
- Manages swap interface and bonding curve
- Handles Phase 1 (bonding curve) and Phase 2 (Uniswap) trading

**4. BlockchainService.js**:
- Direct contract interaction
- Manages contract instances (main, mirror, router, pool)
- Handles network switching
- Executes transactions

### Contract Files

Located in `/EXEC404/`:
- `switch.json` - Contract configuration (address, network)
- `abi.json` - Main contract ABI
- `mirrorabi.json` - Mirror contract ABI

### Initialization Flow

```javascript
// 1. Page loads
renderCultExecsPage()

// 2. Check for switch.json
const switchExists = await checkAndHandleSwitch()

// 3. Initialize wallet service
await walletService.initialize()

// 4. Check for existing connection
if (walletService.isConnected()) {
    // Show contract interface
    showContractInterface()
}

// 5. Wallet connects
eventBus.on('wallet:connected', () => {
    // Initialize TradingInterface
    showTradingInterface(address, provider, signer)
})

// 6. TradingInterface initializes BlockchainService
await blockchainService.initialize()
```

### Contract Methods Used

**Read Operations**:
- `balanceOf(address)` - Token balance
- `getCurrentPrice()` - Current price
- `calculateCost(amount)` - Cost calculation
- `totalBondingSupply()` - Total supply
- `freeSupply()` - Free supply
- `getCurrentTier()` - Whitelist tier
- `liquidityPair()` - Liquidity pool address

**Write Operations**:
- `buyBonding(amount, maxCost, mintNFT, proof, message)` - Buy tokens
- `sellBonding(amount, minReturn, proof, message)` - Sell tokens
- `balanceMint(amount)` - Mint NFTs from balance
- `setSkipNFT(skip)` - Skip NFT minting

**Phase 2 Operations** (Uniswap):
- `swapExactETHForTokensSupportingFeeOnTransferTokens()` - Buy via Uniswap
- `swapExactTokensForETHSupportingFeeOnTransferTokens()` - Sell via Uniswap

---

## Project Service System (New)

### Overview

The new system supports multiple projects through a unified adapter interface. It's designed to work with both factory-created projects and CULT EXEC.

### Architecture

```
ProjectDetail.js / ERC404TradingInterface.js
    ↓
ProjectService.js
    ↓
ContractAdapter (ERC404Adapter / ERC1155Adapter)
    ↓
Ethers Contract Instances
    ↓
Ethereum Network
```

### Key Components

**1. ProjectService.js**:
- Manages multiple project instances
- Creates appropriate adapters
- Handles project switching
- Initializes projects in ProjectStore

**2. ContractAdapter**:
- Unified interface for contract operations
- Handles mock/real detection
- Provides caching
- Error handling

**3. ERC404TradingInterface.js**:
- Trading UI for ERC404 projects
- Uses ProjectService and adapters
- Works with projectStore (not tradingStore)

### Project Loading Flow

```javascript
// 1. Load project
const instance = await projectService.loadProject(
    projectId,
    contractAddress,
    'ERC404' // or auto-detected
)

// 2. Get adapter
const adapter = instance.adapter

// 3. Initialize adapter
await adapter.initialize()

// 4. Use adapter methods
const balance = await adapter.getTokenBalance(address)
const price = await adapter.getCurrentPrice()
```

### Contract Type Detection

```javascript
// ProjectService detects contract type by checking ABI:
const abi = await fetch('/EXEC404/abi.json')
const functions = abi.filter(f => f.type === 'function').map(f => f.name)

// ERC404 detection:
const isERC404 = functions.includes('buyBonding') &&
                 functions.includes('sellBonding') &&
                 (functions.includes('getCurrentPrice') || 
                  functions.includes('calculateCost'))

// ERC1155 detection:
const isERC1155 = functions.includes('balanceOfBatch') &&
                  functions.includes('safeBatchTransferFrom') &&
                  functions.includes('uri')
```

### Differences from CULT EXEC System

| Aspect | CULT EXEC (BlockchainService) | New System (ProjectService) |
|--------|-------------------------------|----------------------------|
| Service | BlockchainService | ProjectService |
| Store | tradingStore | projectStore |
| Component | TradingInterface | ERC404TradingInterface |
| Contract Access | Direct service methods | Adapter methods |
| Multi-project | No (single contract) | Yes (multiple instances) |
| Mock Support | No | Yes (via adapters) |

---

## Contract Interaction Flow

### Read Operation Flow

```
1. UI Component calls adapter method
   ↓
2. Adapter checks cache
   ↓
3. If cached: return cached value
   ↓
4. If not cached:
   a. Check if mock → return mock value
   b. If real → execute contract call
   c. Cache result
   d. Return value
   ↓
5. UI updates with result
```

### Write Operation Flow

```
1. User initiates transaction (e.g., buy)
   ↓
2. UI validates inputs
   ↓
3. Adapter method called (e.g., buyBonding)
   ↓
4. Check if mock:
   - Mock: Simulate success, emit events
   - Real: Continue to step 5
   ↓
5. Execute contract call with signer
   ↓
6. Emit 'transaction:pending' event
   ↓
7. Wait for transaction confirmation
   ↓
8. Emit 'transaction:success' event
   ↓
9. Invalidate cache
   ↓
10. UI updates with result
```

### Error Handling Flow

```
1. Contract call fails
   ↓
2. Adapter catches error
   ↓
3. Error wrapped with context:
   - Method name
   - Contract address
   - Original error
   ↓
4. Common errors handled:
   - INSUFFICIENT_FUNDS → User-friendly message
   - UNPREDICTABLE_GAS_LIMIT → Extract revert reason
   - ACTION_REJECTED → Transaction rejected message
   ↓
5. Emit 'transaction:error' event
   ↓
6. UI displays error message
```

---

## Migration Path

### Current State

- **CULT EXEC**: Uses BlockchainService (real contracts)
- **Factory Projects**: Use ProjectService with adapters (mock or real)
- **Mock System**: Fully functional for development

### Migration Steps

**Step 1: Refine Mock System**
- Ensure mock adapters match real contract interfaces
- Test all contract methods in mock mode
- Verify UI works correctly with mock data

**Step 2: Deploy Contracts**
- Deploy master contract
- Deploy factory contracts
- Deploy initial project instances

**Step 3: Update Configuration**
```javascript
// src/config.js
export const USE_MOCK_SERVICES = false; // Switch to real
```

**Step 4: Update Contract Addresses**
- Update factory addresses in mock data
- Update project registry with real addresses
- Update network configuration

**Step 5: Test Real Contracts**
- Test on testnet first
- Verify all operations work
- Check gas costs and performance

**Step 6: Deploy to Mainnet**
- Final testing on mainnet
- Monitor for issues
- Gradual rollout

### Key Considerations

1. **Contract Interface Compatibility**: Ensure real contracts match adapter expectations
2. **Error Handling**: Real contracts may have different error patterns
3. **Gas Optimization**: Real transactions cost gas - optimize where possible
4. **Network Management**: Ensure correct network handling
5. **Transaction Confirmation**: Real transactions take time - handle pending states

---

## Key Concepts

### 1. Provider vs Signer

**Provider**: Read-only access to blockchain
- Used for: Reading contract state, checking balances
- No wallet required

**Signer**: Write access to blockchain
- Used for: Sending transactions, modifying state
- Requires wallet connection

```javascript
// Provider (read-only)
const provider = new ethers.providers.Web3Provider(window.ethereum)
const balance = await provider.getBalance(address)

// Signer (write access)
const signer = provider.getSigner()
const contract = contract.connect(signer)
const tx = await contract.buyBonding(...)
```

### 2. Contract Instances

**Main Contract**: ERC404 token contract
- Handles token operations
- Manages bonding curve
- NFT minting logic

**Mirror Contract**: ERC721 NFT contract
- Represents NFTs
- NFT metadata and ownership
- Created automatically by ERC404

**Swap Router**: Uniswap V2 router
- Phase 2 trading
- Liquidity pool swaps
- Fee handling

### 3. Caching Strategy

**ContractCache**: Reduces redundant contract calls
- Caches read operations
- Invalidates on write operations
- TTL-based expiration

**Cache Keys**:
- Method name + arguments
- Pattern-based invalidation
- Automatic cleanup

### 4. Event System

**EventBus**: Centralized event system
- Loose coupling between components
- Standardized event names
- Event-driven updates

**Key Events**:
- `wallet:connected` - Wallet connected
- `contract:updated` - Contract state changed
- `transaction:pending` - Transaction sent
- `transaction:success` - Transaction confirmed
- `transaction:error` - Transaction failed
- `project:loaded` - Project loaded
- `network:switched` - Network changed

### 5. Phase System

**Phase 0**: Pre-launch (no switch.json)
- Shows GIF animation
- No contract interaction

**Phase 1**: Bonding Curve (switch.json exists)
- Direct contract trading
- Bonding curve pricing
- NFT minting from balance

**Phase 2**: Uniswap Trading (liquidity pool exists)
- Uniswap V2 swaps
- Liquidity pool trading
- Fee-on-transfer tokens

---

## Best Practices

### 1. Always Check Wallet Connection

```javascript
if (!walletService.isConnected()) {
    throw new Error('Wallet not connected')
}
```

### 2. Handle Errors Gracefully

```javascript
try {
    const result = await adapter.buyBonding(...)
} catch (error) {
    // Show user-friendly error message
    messagePopup.error(error.message, 'Transaction Failed')
}
```

### 3. Use Caching for Read Operations

```javascript
// Adapter automatically caches, but you can also:
const value = await adapter.getCachedOrFetch(
    'getBalance',
    [address],
    async () => await adapter.getTokenBalance(address)
)
```

### 4. Invalidate Cache After Writes

```javascript
// Adapters automatically invalidate, but you can manually:
contractCache.invalidateByPattern('balance', 'price')
```

### 5. Listen for Events

```javascript
eventBus.on('wallet:connected', (data) => {
    // Update UI with wallet address
})

eventBus.on('transaction:success', (data) => {
    // Show success message
    // Refresh balances
})
```

### 6. Check Network Before Transactions

```javascript
const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
    await walletService.switchNetwork(expectedChainId)
}
```

### 7. Use Appropriate Adapter Methods

```javascript
// For ERC404 projects
const adapter = await projectService.getAdapter('projectId')
const balance = await adapter.getTokenBalance(address)

// For ERC1155 projects
const balance = await adapter.getBalance(address, tokenId)
```

### 8. Handle Mock Mode

```javascript
if (adapter.isMock) {
    // Show mock indicator in UI
    // Adjust expectations for mock behavior
}
```

---

## Conclusion

The Ethereum contract service system provides a robust, flexible architecture for interacting with smart contracts. The separation between CULT EXEC (BlockchainService) and the new multi-project system (ProjectService) allows for gradual migration while maintaining backward compatibility.

Key takeaways:
1. **CULT EXEC** uses direct BlockchainService (original system)
2. **New projects** use ProjectService with adapters (new system)
3. **Mock system** allows development without contracts
4. **Adapters** provide unified interface for different contract types
5. **Event system** enables loose coupling between components
6. **Caching** optimizes performance
7. **Migration path** is clear and gradual

As you approach contract deployment, focus on:
- Ensuring contract interfaces match adapter expectations
- Testing thoroughly in mock mode first
- Gradually migrating to real contracts
- Monitoring gas costs and performance
- Handling edge cases and errors gracefully

