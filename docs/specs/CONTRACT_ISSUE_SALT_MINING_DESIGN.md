# Contract Issue: createVaultWithHook Salt Mining Design

## Problem

`UltraAlignmentHookFactory.createVaultWithHook()` cannot work with off-chain salt mining because the hook's init code hash depends on the vault address, which isn't known until runtime.

## Root Cause

The function flow is:
```solidity
function createVaultWithHook(address alignmentToken, address creator, bytes32 hookSalt) {
    // Step 1: Deploy vault with regular `new` (non-deterministic address)
    vault = address(new UltraAlignmentVault(...));

    // Step 2: Deploy hook with CREATE2 using vault address
    hook = address(new UltraAlignmentV4Hook{salt: hookSalt}(
        poolManager,
        vault,      // <-- This affects init code hash!
        weth,
        creator
    ));
}
```

The salt mining requires computing:
```
initCodeHash = keccak256(creationCode + abi.encode(poolManager, vault, weth, creator))
```

But `vault` isn't known until Step 1 completes. Therefore, we cannot mine the correct salt off-chain.

## Why Tests Pass

The tests use `MockPoolManager` which doesn't call `Hooks.validateHookPermissions()`, so they pass with any salt (including `bytes32(0)`). Real Uniswap v4 PoolManager validates the hook address bits.

## Suggested Fixes

### Option A: On-Chain Salt Mining (Recommended)
Use the existing `HookAddressMiner` library to mine salt on-chain within `createVaultWithHook`:

```solidity
function createVaultWithHook(address alignmentToken, address creator) external payable {
    // Step 1: Deploy vault
    vault = address(new UltraAlignmentVault(...));

    // Step 2: Compute init code hash (now we know vault address)
    bytes32 initCodeHash = HookAddressMiner.computeInitCodeHash(
        type(UltraAlignmentV4Hook).creationCode,
        poolManager, vault, weth, creator
    );

    // Step 3: Mine salt on-chain
    (bytes32 salt, address predictedAddress) = HookAddressMiner.mineSaltForUltraAlignmentHook(
        address(this),
        initCodeHash
    );

    // Step 4: Deploy hook with mined salt
    hook = address(new UltraAlignmentV4Hook{salt: salt}(...));
}
```

**Pros:**
- Single atomic transaction
- Simple UX (no off-chain mining needed)

**Cons:**
- Gas cost for mining (typically 5,000-50,000 iterations)
- May need gas limit estimation

### Option B: Predictable Vault Address
Use CREATE2 for vault deployment so we can predict its address off-chain:

```solidity
function createVaultWithHook(
    address alignmentToken,
    address creator,
    bytes32 vaultSalt,    // For CREATE2 vault deployment
    bytes32 hookSalt      // For CREATE2 hook deployment
) external payable {
    // Step 1: Deploy vault with CREATE2 (predictable address)
    vault = address(new UltraAlignmentVault{salt: vaultSalt}(...));

    // Step 2: Deploy hook with CREATE2
    hook = address(new UltraAlignmentV4Hook{salt: hookSalt}(...));
}
```

**Pros:**
- Off-chain mining works
- Lower gas cost on-chain

**Cons:**
- Requires mining TWO salts off-chain
- More complex UX

### Option C: Two-Step Process
Split into separate functions:

```solidity
function createVault(address alignmentToken) returns (address vault);
function attachHookToVault(address vault, bytes32 hookSalt) returns (address hook);
```

**Pros:**
- Clear separation
- Off-chain mining works (vault address known after step 1)

**Cons:**
- Not atomic (vault can exist without hook)
- Two transactions required

## Recommendation

**Option A (On-Chain Mining)** is recommended because:
1. Single atomic transaction
2. Best UX (frontend just calls function, no salt computation needed)
3. Gas cost is acceptable (mining typically takes <100ms on modern hardware, <100k gas)
4. The `HookAddressMiner` library already exists in the codebase

## Implementation

To implement Option A, modify `createVaultWithHook` to:

1. Remove `hookSalt` parameter
2. Import `HookAddressMiner` library
3. Mine salt after vault deployment but before hook deployment

## Testing

After fix, run:
```bash
forge test --match-contract UltraAlignmentHookFactory --fork-url $ETH_RPC_URL -vvv
```

The test should deploy a real vault+hook with valid hook permissions.
