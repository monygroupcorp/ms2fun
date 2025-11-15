# Contract Constraints & Refinement Guide

## Overview

This document outlines the contract constraints and refinement requirements needed to transition from the mock system to real onchain contracts. It identifies what needs to be aligned between the frontend expectations and actual contract implementations.

## Table of Contents

1. [Current Mock vs Real Gaps](#current-mock-vs-real-gaps)
2. [Contract Interface Requirements](#contract-interface-requirements)
3. [ERC404 Contract Constraints](#erc404-contract-constraints)
4. [ERC1155 Contract Constraints](#erc1155-contract-constraints)
5. [Refinement Checklist](#refinement-checklist)
6. [Testing Requirements](#testing-requirements)
7. [Migration Validation](#migration-validation)

---

## Current Mock vs Real Gaps

### 1. Mock Behavior Assumptions

**Current Mock Behavior**:
- Transactions always succeed
- No gas costs
- Instant confirmation
- No revert reasons
- Default values for all reads

**Real Contract Requirements**:
- Transactions can fail (insufficient funds, slippage, etc.)
- Gas costs apply
- Confirmation time varies (network dependent)
- Revert reasons must be handled
- Real-time data from blockchain

### 2. Error Handling Gaps

**Mock System**:
```javascript
// Mock always succeeds
const receipt = await adapter.buyBonding(...)
// No error handling needed
```

**Real System Needs**:
```javascript
try {
    const receipt = await adapter.buyBonding(...)
} catch (error) {
    // Handle: insufficient funds, slippage exceeded, user rejection, etc.
    if (error.code === 'INSUFFICIENT_FUNDS') {
        // Show specific message
    } else if (error.message.includes('slippage')) {
        // Adjust slippage tolerance
    }
}
```

### 3. State Management Gaps

**Mock System**:
- State persists in localStorage
- Can be reset easily
- No network delays

**Real System Needs**:
- State comes from blockchain
- Network delays affect updates
- Cache invalidation critical
- Real-time updates via events

---

## Contract Interface Requirements

### ERC404 Contract Interface

Based on `ERC404Adapter.js`, the contract must implement:

#### Required Read Functions

```solidity
// Balance operations
function balanceOf(address account) external view returns (uint256);
function freeSupply() external view returns (uint256);

// Price operations
function getCurrentPrice() external view returns (uint256);
function calculateCost(uint256 execAmount) external view returns (uint256);
function getExecForEth(uint256 ethAmount) external view returns (uint256);
function getEthForExec(uint256 execAmount) external view returns (uint256);

// Supply operations
function totalBondingSupply() external view returns (uint256);

// Phase operations
function liquidityPair() external view returns (address);
function getCurrentTier() external view returns (uint256);

// Free mint operations
function freeMint(address account) external view returns (bool);

// Mirror contract
function mirrorERC721() external view returns (address);
```

#### Required Write Functions

```solidity
// Trading operations
function buyBonding(
    uint256 amount,
    uint256 maxCost,
    bool mintNFT,
    bytes32[] calldata proof,
    string memory message
) external payable;

function sellBonding(
    uint256 amount,
    uint256 minReturn,
    bytes32[] calldata proof,
    string memory message
) external;

// NFT operations
function balanceMint(uint256 amount) external;

// Settings
function setSkipNFT(bool skip) external;
```

#### Mirror Contract (ERC721) Requirements

```solidity
// Required for ERC404 mirror
function balanceOf(address owner) external view returns (uint256);
function ownerOf(uint256 tokenId) external view returns (address);
function getOwnerTokens(address owner) external view returns (uint256[] memory);
function tokenURI(uint256 tokenId) external view returns (string memory);
function transferFrom(address from, address to, uint256 tokenId) external;
```

### ERC1155 Contract Interface

Based on `ERC1155Adapter.js`, the contract must implement:

#### Required Functions

```solidity
// Balance operations
function balanceOf(address account, uint256 id) external view returns (uint256);
function balanceOfBatch(
    address[] calldata accounts,
    uint256[] calldata ids
) external view returns (uint256[] memory);

// Transfer operations
function safeTransferFrom(
    address from,
    address to,
    uint256 id,
    uint256 amount,
    bytes calldata data
) external;

function safeBatchTransferFrom(
    address from,
    address to,
    uint256[] calldata ids,
    uint256[] calldata amounts,
    bytes calldata data
) external;

// Metadata
function uri(uint256 id) external view returns (string memory);
```

---

## ERC404 Contract Constraints

### 1. Bonding Curve Constraints

**Current Implementation** (`ERC404Adapter.buyBonding`):
```javascript
await adapter.buyBonding(
    amount,        // Token amount in wei (18 decimals)
    maxCost,       // Max ETH cost in wei
    false,         // mintNFT flag
    proof || [],   // Merkle proof (can be empty)
    ''             // Message
)
```

**Contract Requirements**:
- Must accept ETH payment (`payable`)
- Must validate `maxCost >= actual cost`
- Must handle slippage protection
- Must mint tokens correctly
- Must handle NFT minting if `mintNFT = true`

**Refinement Needed**:
- [ ] Verify slippage tolerance is appropriate
- [ ] Ensure `maxCost` validation works correctly
- [ ] Test edge cases (zero amount, max amount, etc.)
- [ ] Verify NFT minting logic

### 2. Price Calculation Constraints

**Current Implementation** (`ERC404Adapter.getCurrentPrice`):
```javascript
// Gets price for 1M tokens
const amount = ethers.utils.parseEther('1000000')
const price = await contract.calculateCost(amount)
```

**Contract Requirements**:
- `calculateCost` must return accurate price in wei
- Price must account for bonding curve formula
- Must handle large amounts without overflow

**Refinement Needed**:
- [ ] Verify price calculation formula matches frontend expectations
- [ ] Test with various amounts (small, medium, large)
- [ ] Ensure no overflow issues
- [ ] Verify price updates correctly as supply changes

### 3. NFT Minting Constraints

**Current Implementation** (`ERC404Adapter.mintNFT`):
```javascript
await adapter.mintNFT(amount) // Amount of NFTs to mint
```

**Contract Requirements**:
- Must check sufficient token balance
- Must convert tokens to NFTs correctly
- Must handle ERC404 token-to-NFT conversion
- Must emit appropriate events

**Refinement Needed**:
- [ ] Verify conversion rate (tokens per NFT)
- [ ] Test minimum balance requirements
- [ ] Ensure NFT metadata is correct
- [ ] Verify events are emitted

### 4. Phase Detection Constraints

**Current Implementation** (`ERC404Adapter.getPhase`):
```javascript
// Phase 0: No switch.json
// Phase 1: switch.json exists, no liquidity pool
// Phase 2: Liquidity pool exists
const liquidityPool = await contract.liquidityPair()
```

**Contract Requirements**:
- `liquidityPair()` must return zero address when no pool exists
- Must return actual pool address when pool exists
- Pool address must be valid Uniswap V2 pair

**Refinement Needed**:
- [ ] Verify phase detection logic
- [ ] Ensure pool address format is correct
- [ ] Test phase transitions

### 5. Free Mint Constraints

**Current Implementation** (`ERC404Adapter.getFreeMint`):
```javascript
const freeMint = await adapter.getFreeMint(address)
```

**Contract Requirements**:
- Must track which addresses have claimed free mint
- Must check free supply availability
- Must prevent double claiming

**Refinement Needed**:
- [ ] Verify free mint eligibility logic
- [ ] Test free supply limits
- [ ] Ensure no double claiming possible

---

## ERC1155 Contract Constraints

### 1. Batch Operations Constraints

**Current Implementation** (`ERC1155Adapter.getBalanceBatch`):
```javascript
const balances = await adapter.getBalanceBatch(address, tokenIds)
```

**Contract Requirements**:
- Must handle arrays of same length
- Must return balances in correct order
- Must handle non-existent token IDs

**Refinement Needed**:
- [ ] Verify array length validation
- [ ] Test with various token ID combinations
- [ ] Ensure error handling for invalid IDs

### 2. Transfer Constraints

**Current Implementation** (`ERC1155Adapter.safeBatchTransferFrom`):
```javascript
await adapter.safeBatchTransferFrom(from, to, ids, amounts, data)
```

**Contract Requirements**:
- Must validate sender has sufficient balance
- Must handle approval checks
- Must emit TransferBatch event
- Must call receiver's `onERC1155BatchReceived` if contract

**Refinement Needed**:
- [ ] Verify approval mechanism
- [ ] Test with contract receivers
- [ ] Ensure event emission
- [ ] Test edge cases (zero amounts, etc.)

---

## Refinement Checklist

### Pre-Deployment Checklist

#### Contract Interface Verification
- [ ] All required functions exist in contract
- [ ] Function signatures match adapter expectations
- [ ] Return types are correct
- [ ] Parameter types match (uint256, address, etc.)
- [ ] Events are defined and emitted correctly

#### ERC404 Specific
- [ ] `buyBonding` accepts correct parameters
- [ ] `sellBonding` validates minimum return
- [ ] `calculateCost` returns accurate prices
- [ ] `balanceMint` converts tokens to NFTs correctly
- [ ] `mirrorERC721` returns valid address
- [ ] `liquidityPair` returns correct format
- [ ] `freeMint` and `freeSupply` work correctly

#### ERC1155 Specific
- [ ] `balanceOfBatch` handles arrays correctly
- [ ] `safeBatchTransferFrom` validates inputs
- [ ] `uri` returns valid metadata URIs
- [ ] Batch operations are gas efficient

#### Error Handling
- [ ] Revert reasons are descriptive
- [ ] Error codes are consistent
- [ ] User-friendly error messages possible
- [ ] Edge cases handled (zero amounts, max amounts, etc.)

#### Gas Optimization
- [ ] Read operations are view functions
- [ ] Write operations minimize gas usage
- [ ] Batch operations are efficient
- [ ] Storage is optimized

#### Security
- [ ] Access control is correct
- [ ] Reentrancy protection in place
- [ ] Overflow/underflow protection
- [ ] Input validation on all functions

### Frontend Refinement Checklist

#### Adapter Updates
- [ ] Mock detection logic works correctly
- [ ] Error handling covers all contract errors
- [ ] Cache invalidation is correct
- [ ] Event handling is complete

#### UI Updates
- [ ] Loading states for transactions
- [ ] Error messages are user-friendly
- [ ] Transaction status updates correctly
- [ ] Gas estimation display (if needed)
- [ ] Slippage tolerance UI

#### Testing
- [ ] Unit tests for adapters
- [ ] Integration tests with mock contracts
- [ ] End-to-end tests with testnet
- [ ] Error scenario testing

---

## Testing Requirements

### 1. Unit Tests

**Adapter Tests**:
```javascript
// Test each adapter method
describe('ERC404Adapter', () => {
    it('should get token balance', async () => {
        const balance = await adapter.getTokenBalance(address)
        expect(balance).toBeDefined()
    })
    
    it('should handle buyBonding', async () => {
        const receipt = await adapter.buyBonding(...)
        expect(receipt).toBeDefined()
    })
    
    // ... more tests
})
```

### 2. Integration Tests

**Contract Integration**:
```javascript
// Test with actual contract on testnet
describe('Contract Integration', () => {
    it('should interact with real contract', async () => {
        const adapter = await createRealAdapter()
        const balance = await adapter.getTokenBalance(address)
        // Verify balance is correct
    })
})
```

### 3. End-to-End Tests

**Full Flow Tests**:
```javascript
// Test complete user flows
describe('Trading Flow', () => {
    it('should complete buy flow', async () => {
        // 1. Connect wallet
        // 2. Enter amount
        // 3. Execute buy
        // 4. Verify balance update
        // 5. Verify UI update
    })
})
```

### 4. Error Scenario Tests

**Error Handling**:
```javascript
describe('Error Handling', () => {
    it('should handle insufficient funds', async () => {
        // Test with insufficient balance
        await expect(adapter.buyBonding(...)).rejects.toThrow()
    })
    
    it('should handle slippage exceeded', async () => {
        // Test with too low minReturn
        await expect(adapter.sellBonding(...)).rejects.toThrow()
    })
})
```

---

## Migration Validation

### Step 1: Mock System Validation

**Before migrating, ensure**:
- [ ] All mock operations work correctly
- [ ] UI displays correctly with mock data
- [ ] All user flows work end-to-end
- [ ] Error handling is tested
- [ ] Performance is acceptable

### Step 2: Contract Interface Validation

**Verify contract matches adapter expectations**:
- [ ] Deploy test contract on testnet
- [ ] Test all adapter methods with real contract
- [ ] Verify return values are correct
- [ ] Test error scenarios
- [ ] Verify gas costs are acceptable

### Step 3: Gradual Migration

**Migrate one feature at a time**:
1. Start with read operations
2. Then write operations
3. Finally complex operations (swaps, etc.)

### Step 4: Production Validation

**Before mainnet deployment**:
- [ ] Test on testnet thoroughly
- [ ] Verify all edge cases
- [ ] Check gas costs
- [ ] Monitor for errors
- [ ] Have rollback plan

---

## Key Refinement Areas

### 1. Slippage Protection

**Current**: Mock system doesn't validate slippage
**Needed**: Real contracts must handle slippage

**Refinement**:
- Add slippage tolerance UI
- Validate `maxCost` and `minReturn` parameters
- Show slippage warnings
- Allow user to adjust tolerance

### 2. Gas Estimation

**Current**: Mock system has no gas costs
**Needed**: Real transactions cost gas

**Refinement**:
- Estimate gas before transactions
- Show gas cost to user
- Handle gas estimation failures
- Optimize gas usage where possible

### 3. Transaction Confirmation

**Current**: Mock transactions are instant
**Needed**: Real transactions take time

**Refinement**:
- Show pending state
- Poll for confirmation
- Handle timeout scenarios
- Show transaction hash for tracking

### 4. Error Messages

**Current**: Mock errors are generic
**Needed**: Real errors are specific

**Refinement**:
- Parse revert reasons
- Show user-friendly messages
- Handle common errors (insufficient funds, slippage, etc.)
- Provide actionable error messages

### 5. State Updates

**Current**: Mock state is immediate
**Needed**: Real state updates after confirmation

**Refinement**:
- Invalidate cache after transactions
- Poll for balance updates
- Handle stale data
- Show loading states during updates

---

## Conclusion

The refinement process involves:

1. **Verifying contract interfaces** match adapter expectations
2. **Testing thoroughly** in mock mode first
3. **Gradually migrating** to real contracts
4. **Handling edge cases** and errors
5. **Optimizing** gas usage and performance

Key focus areas:
- **Slippage protection** for trading operations
- **Gas estimation** and cost display
- **Transaction confirmation** handling
- **Error message** refinement
- **State update** management

As you approach contract deployment, use this guide to ensure smooth transition from mock to real contracts.

