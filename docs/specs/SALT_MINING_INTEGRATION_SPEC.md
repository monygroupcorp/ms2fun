# Salt Mining Integration Specification

## Overview

Integrate CREATE2 salt mining for Uniswap v4 hook deployment into:
1. Local development deployment script (`scripts/deploy-local.mjs`)
2. Frontend hook creation flow (for production use)

## Background

**Problem**: Uniswap v4 hooks must be deployed at addresses where the address bits encode which hook functions are enabled. Our `UltraAlignmentV4Hook` requires `afterSwap: true` permission, which means the deployed address must have specific bits set.

**Solution**: Use CREATE2 with computed salts to deploy hooks at valid addresses. The contracts now accept a `bytes32 salt` parameter in `UltraAlignmentHookFactory.createHook()`.

**Existing Asset**: User has an existing salt mining system that can be adapted for this purpose.

## Technical Requirements

### Hook Permission Requirements

**Required permission**: `afterSwap: true`
**All other permissions**: `false`

The deployed hook address must have bits that match this exact permission set. Reference Uniswap v4's `Hooks.validateHookPermissions()` for the specific bit positions.

### Salt Mining Algorithm

**Inputs**:
- Factory address: `UltraAlignmentHookFactory` contract address
- Constructor bytecode: `UltraAlignmentV4Hook` initialization code
- Constructor parameters: `(poolManager, vault, weth, creator)`
- Target permission bits: Address bits for `afterSwap: true`

**Output**:
- `bytes32 salt` value that produces a valid hook address when used with CREATE2

**Process**:
1. Compute CREATE2 address: `keccak256(0xff ++ factory ++ salt ++ keccak256(bytecode))`
2. Check if address bits match required permissions
3. If not, increment salt and try again
4. Return first valid salt found

### Performance Considerations

- Salt mining can be CPU-intensive (may need to try thousands of salts)
- For local deployment: Mine salt once, cache result in config
- For frontend: Consider mining in Web Worker to avoid UI blocking
- Estimated search time: Seconds to minutes depending on difficulty

## Integration Points

### 1. Local Development Script (`scripts/deploy-local.mjs`)

**Location**: `createERC404Instance()` helper function where hooks are created

**Requirements**:
- Import/implement salt mining function
- Compute valid salt before calling `hookFactory.createHook()`
- Pass salt as 6th parameter to `createHook()`
- Cache computed salts in deployment config for reuse

**Example pseudocode**:
```javascript
// Before creating hook
const salt = await mineHookSalt({
    factoryAddress: hookFactory.address,
    poolManager: MAINNET_ADDRESSES.uniswapV4PoolManager,
    vault: vaultAddress,
    weth: MAINNET_ADDRESSES.weth,
    creator: deployer.address,
    permissions: { afterSwap: true }
});

// Use salt in hook creation
const hookTx = await hookFactory.createHook(
    poolManager,
    vault,
    weth,
    creator,
    isCanonical,
    salt  // <-- Pass computed salt
);
```

**Config caching**:
```json
{
  "hookSalts": {
    "ActiveVault": "0x...",
    "SimpleVault": "0x..."
  }
}
```

### 2. Frontend Hook Creation

**Location**: Service layer that handles ERC404 instance creation with hooks

**Requirements**:
- Add salt mining module (Web Worker or async function)
- Compute salt before calling contract's `createInstance()`
- Show loading UI during salt computation ("Computing hook address...")
- Handle mining failures gracefully

**User experience**:
1. User fills out project creation form
2. Clicks "Create Project"
3. UI shows: "Computing hook address..." (during salt mining)
4. UI shows: "Deploying contracts..." (after salt found)
5. Transaction proceeds with valid salt

**Frontend architecture**:
```
src/services/
  ├── HookSaltMiner.js          // Salt mining logic
  └── contracts/
      └── ERC404FactoryAdapter.js  // Updated to mine salt before createInstance
```

## Implementation Tasks

### Task 1: Port Existing Salt System
- Review user's existing salt mining code
- Adapt for Uniswap v4 hook permission requirements
- Create standalone module that works in both Node.js and browser

### Task 2: Local Deployment Integration
- Update `scripts/deploy-local.mjs`
- Import salt mining module
- Compute salts for ActiveVault and SimpleVault hooks
- Cache salts in `src/config/contracts.local.json`
- Add console logging for mining progress

### Task 3: Frontend Integration
- Create `src/services/HookSaltMiner.js`
- Implement Web Worker wrapper (optional, for better UX)
- Update `ERC404FactoryAdapter.createInstance()` to mine salt
- Add loading states to project creation UI
- Handle edge cases (mining timeout, failure)

### Task 4: Testing & Validation
- Verify mined salts produce valid addresses locally
- Test full deployment flow with salted hooks
- Verify hooks pass `validateHookPermissions()` check
- Test frontend UX with salt mining delays

## Acceptance Criteria

### Local Deployment
- [ ] `npm run chain:start` successfully creates all 3 ERC404 instances with hooks
- [ ] Hooks are deployed at addresses that pass validation
- [ ] Hook salts are cached in config file for reuse
- [ ] Console shows salt mining progress/results

### Frontend
- [ ] Project creation with vault/hook works end-to-end
- [ ] User sees clear loading state during salt computation
- [ ] Mined hook addresses pass on-chain validation
- [ ] Error handling for mining failures is graceful

## Technical Notes

**CREATE2 Address Calculation** (JavaScript):
```javascript
const create2Address = ethers.utils.getCreate2Address(
    factoryAddress,
    salt,
    ethers.utils.keccak256(initCode)
);
```

**Uniswap v4 Hook Address Bits**:
- Different hook permissions map to different bit positions in the address
- The `Hooks` library checks these bits in `validateHookPermissions()`
- Consult Uniswap v4 documentation for exact bit mappings

**Performance Targets**:
- Local deployment: <30 seconds per salt
- Frontend: <60 seconds per salt (with progress indication)

## Dependencies

- User's existing salt mining implementation
- ethers.js for CREATE2 address computation
- Uniswap v4 Hooks library for permission bit reference

## Open Questions

1. What is the structure/API of the user's existing salt system?
2. Should we pre-compute and hardcode salts for known vault addresses, or always compute dynamically?
3. Do we need parallel salt mining (multiple workers) for performance?
4. Should frontend fall back to a salt mining service if client-side is too slow?

## References

- Uniswap v4 Hooks documentation
- CREATE2 specification (EIP-1014)
- User's existing salt mining code (location TBD)
