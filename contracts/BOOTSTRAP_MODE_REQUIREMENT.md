# Bootstrap Mode Requirement for MasterRegistryV1

**Date:** 2026-01-12
**Priority:** CRITICAL - Blocks MVP deployment
**Related:** CONTRACT_SIZE_REFACTOR_TASK.md

---

## Problem Statement

The current MasterRegistryV1 contract requires governance voting to register new factories and vaults. During the bootstrap phase (MVP testing and early launch), this creates an operational deadlock:

1. **Cannot register factories** - Required to create test instances
2. **Cannot register vaults** - Required for fee distribution testing
3. **Governance overhead** - Would need to fake votes, wait for timelock, etc.
4. **Slows development** - Can't iterate quickly on local testing

## Required Solution

Add **authoritarian control** mode where the contract owner can bypass governance during the bootstrap period.

### Specific Requirements

**1. Owner Bypass for Factory Registration**

```solidity
// Current: Only governance can register factories
function registerFactory(...) external onlyGovernance { ... }

// Needed: Owner can bypass during bootstrap
function registerFactory(...) external {
    require(
        msg.sender == governance ||
        (msg.sender == owner() && !bootstrapComplete),
        "Not authorized"
    );
    // ... registration logic
}
```

**2. Owner Bypass for Vault Registration**

```solidity
// Current: Only governance can register vaults
function registerVault(...) external onlyGovernance { ... }

// Needed: Owner can bypass during bootstrap
function registerVault(...) external {
    require(
        msg.sender == vaultGovernance ||
        (msg.sender == owner() && !bootstrapComplete),
        "Not authorized"
    );
    // ... registration logic
}
```

**3. Bootstrap Completion Mechanism**

One of these approaches (your choice):

**Option A: Time-based (Recommended)**
```solidity
uint256 public immutable bootstrapEndTime;

constructor() {
    bootstrapEndTime = block.timestamp + 100 days; // "First 100 days"
}

function bootstrapComplete() public view returns (bool) {
    return block.timestamp >= bootstrapEndTime;
}
```

**Option B: Manual flag (More flexible)**
```solidity
bool public bootstrapComplete;

function completeBootstrap() external onlyOwner {
    require(!bootstrapComplete, "Already completed");
    bootstrapComplete = true;
    emit BootstrapCompleted(block.timestamp);
}
```

**Option C: Hybrid**
```solidity
uint256 public bootstrapEndTime;
bool public bootstrapCompletedEarly;

function completeBootstrap() external onlyOwner {
    require(block.timestamp < bootstrapEndTime, "Already passed");
    bootstrapCompletedEarly = true;
}

function bootstrapComplete() public view returns (bool) {
    return bootstrapCompletedEarly || block.timestamp >= bootstrapEndTime;
}
```

### Additional Considerations

**Event Logging:**
```solidity
event BootstrapFactoryRegistered(address indexed factory);
event BootstrapVaultRegistered(address indexed vault);
event BootstrapCompleted(uint256 timestamp);
```

**View Function:**
```solidity
function isBootstrapMode() external view returns (bool) {
    return !bootstrapComplete;
}
```

**Documentation:**
- Add comments explaining bootstrap mode
- Document owner responsibilities during bootstrap
- Add migration guide for transitioning to governance

---

## Implementation Phases

### Phase 1: Bootstrap Mode (0-100 days)
- Owner has full control
- Can register factories instantly
- Can register vaults instantly
- Quick iteration for testing
- Manual quality control

### Phase 2: Governance Mode (100+ days)
- Bootstrap period ends
- Only governance can register factories
- Only governance can register vaults
- Community-driven additions
- Timelock protection

---

## Testing Requirements

After implementation, verify:

1. ✅ Owner can register factory during bootstrap
2. ✅ Owner can register vault during bootstrap
3. ✅ Owner CANNOT register after bootstrap complete
4. ✅ Governance can ALWAYS register (before and after)
5. ✅ Random address CANNOT register
6. ✅ `isBootstrapMode()` returns correct state
7. ✅ Events emitted correctly

---

## Impact on Size Refactor

This is a **small addition** (~100-200 bytes) and should NOT significantly impact the contract size refactor task. However:

- Consider including this in the refactor PR
- If adding to current contract, keep changes minimal
- Document that full size refactor is still needed

---

## Example Test Scenario (Local Development)

```javascript
// In deploy-mvp.mjs
const masterRegistry = await MasterRegistry.attach(proxyAddress);

// Check we're in bootstrap mode
const isBootstrap = await masterRegistry.isBootstrapMode();
console.log("Bootstrap mode:", isBootstrap); // Should be true

// Owner deploys factory
const factory = await ERC1155Factory.deploy(...);

// Owner registers factory (no governance vote needed!)
await masterRegistry.registerFactory(
    factory.address,
    "ERC1155Factory",
    "Genesis Edition Factory"
);

console.log("✅ Factory registered during bootstrap");
```

---

## Questions for Contracts Agent

1. Which bootstrap completion mechanism do you recommend? (Time-based, manual, or hybrid)
2. Should we add this to MasterRegistryV1 now or wait for size refactor?
3. Any security concerns with owner bypass during bootstrap?
4. Should there be a maximum bootstrap period? (e.g., cannot exceed 365 days)

---

## Success Criteria

This blocker is resolved when:

- ✅ Owner can register factories without governance vote during bootstrap
- ✅ Owner can register vaults without governance vote during bootstrap
- ✅ Bootstrap mode can transition to governance mode
- ✅ Tests verify authorization logic
- ✅ Events and view functions work correctly

**Urgency:** HIGH - Blocks local development MVP deployment
