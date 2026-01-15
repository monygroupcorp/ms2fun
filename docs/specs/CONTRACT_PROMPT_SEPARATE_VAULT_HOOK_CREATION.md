# Contract Change Request: Separate Vault and Hook Creation

## Summary

Remove `createVaultWithHook` and revert to separate vault + hook creation to support off-chain salt mining.

## Problem

`createVaultWithHook(alignmentToken, creator, hookSalt)` cannot work with off-chain salt mining because:

1. The hook's init code hash depends on the vault address
2. Vault is deployed with regular `new` (non-deterministic address)
3. Salt cannot be computed until vault address is known
4. But `createVaultWithHook` expects salt BEFORE vault deployment

On-chain mining would cost 500k-5M gas which is unacceptable.

## Solution

Revert to two-transaction flow:

**Transaction 1: Create Vault**
```solidity
// User or frontend calls:
vault = new UltraAlignmentVault(weth, poolManager, v3Router, v2Router, v2Factory, v3Factory, alignmentToken);
```

**Off-chain: Mine Salt**
```javascript
// Frontend computes salt using known vault address
const salt = await mineHookSalt({
    hookFactoryAddress,
    poolManager,
    vault: vaultAddress,  // Now known!
    weth,
    creator
});
```

**Transaction 2: Create Hook and Link**
```solidity
// User calls hookFactory.createHook with mined salt
hook = hookFactory.createHook(poolManager, vault, weth, creator, isCanonical, salt);

// Then links hook to vault
vault.setHook(hook);
```

## Required Changes

### 1. UltraAlignmentHookFactory.sol

**Remove:**
- `createVaultWithHook()` function
- `vaultToHook` mapping
- `hookToVault` mapping
- `getHookForVault()` function
- `getVaultForHook()` function
- `getVaultWithHookFee()` function
- `vaultCreationFee` state variable
- `VaultWithHookCreated` event

**Keep:**
- `createHook()` - unchanged, this is the primary hook creation method
- All other existing functionality

### 2. UltraAlignmentVault.sol

**Ensure `setHook()` exists and is callable by owner:**
```solidity
function setHook(address _hook) external onlyOwner {
    require(_hook != address(0), "Invalid hook");
    require(hook == address(0), "Hook already set");
    hook = _hook;
}
```

### 3. ERC404Factory.sol

**No changes needed** - it already expects vault to have hook pre-configured via `vault.hook()`.

## Production Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend/User Flow                                          │
├─────────────────────────────────────────────────────────────┤
│ 1. User clicks "Create Vault"                               │
│    └─> TX1: Deploy UltraAlignmentVault                      │
│    └─> Wait for confirmation, get vault address             │
│                                                             │
│ 2. Frontend mines salt (off-chain, ~1-5 seconds)            │
│    └─> Uses vault address in init code hash                 │
│    └─> Finds salt producing valid hook address (0x...44)    │
│                                                             │
│ 3. User clicks "Create Hook" (or auto-prompted)             │
│    └─> TX2: hookFactory.createHook(..., salt)               │
│    └─> TX3: vault.setHook(hookAddress)                      │
│    (TX2 and TX3 can be batched if using multicall)          │
│                                                             │
│ 4. Vault + Hook ready for ERC404 instance creation          │
└─────────────────────────────────────────────────────────────┘
```

## UX Considerations

- Frontend should show "Creating vault..." → "Computing hook address..." → "Creating hook..."
- Salt mining takes 1-5 seconds, show progress indicator
- Consider batching TX2 + TX3 via multicall contract to reduce user clicks

## Testing

After changes:
```bash
# Unit tests
forge test --match-contract UltraAlignmentHookFactory -vvv

# Fork tests (validates real hook permissions)
forge test --match-path "test/fork/v4/V4HookDeployment.t.sol" --fork-url $ETH_RPC_URL -vvv
```

## Migration

If `createVaultWithHook` was already deployed:
- It can remain but mark as deprecated
- Frontend should use new two-step flow
- No breaking changes to existing vaults/hooks
