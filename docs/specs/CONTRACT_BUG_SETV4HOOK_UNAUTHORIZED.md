# Contract Bug: ERC404Factory Cannot Set V4 Hook

## Problem

`ERC404Factory.createInstance()` fails with `Unauthorized()` error when trying to set the V4 hook on a newly created instance.

## Root Cause

1. `ERC404Factory.createInstance()` deploys `ERC404BondingInstance` with `creator` as the owner (line 113)
2. Factory then tries to call `instance.setV4Hook(hook)` (line 130)
3. `setV4Hook()` has `onlyOwner` modifier
4. Factory is NOT the owner - `creator` is
5. Call reverts with `Unauthorized()`

## Code References

**ERC404Factory.sol lines 100-131:**
```solidity
// Deploy new bonding instance (hook can be set later)
instance = address(new ERC404BondingInstance(
    name,
    symbol,
    ...
    creator,  // <-- creator becomes owner
    styleUri
));

// Create hook after instance if vault provided
if (vault != address(0)) {
    hook = hookFactory.createHook{value: hookFee}(..., hookSalt);
    instanceToHook[instance] = hook;

    // THIS FAILS - factory is not the owner
    ERC404BondingInstance(payable(instance)).setV4Hook(address(hook));
}
```

**ERC404BondingInstance.sol line 254:**
```solidity
function setV4Hook(address _hook) external onlyOwner {
    // Factory can't call this - creator is owner
}
```

## Suggested Fixes

### Option A: Factory as Initial Owner (Recommended)
Make factory the initial owner, set hook, then transfer to creator:

```solidity
// In ERC404Factory.createInstance():
instance = address(new ERC404BondingInstance(
    ...
    address(this),  // Factory is initial owner
    styleUri
));

if (vault != address(0)) {
    hook = hookFactory.createHook{value: hookFee}(...);
    ERC404BondingInstance(payable(instance)).setV4Hook(address(hook));
}

// Transfer ownership to creator
Ownable(instance).transferOwnership(creator);
```

### Option B: Add Factory Authorization to setV4Hook
Allow factory to call setV4Hook once:

```solidity
// In ERC404BondingInstance:
function setV4Hook(address _hook) external {
    require(msg.sender == owner() || msg.sender == factory, "Unauthorized");
    require(_hook != address(0), "Invalid hook");
    require(address(v4Hook) == address(0), "Hook already set");
    v4Hook = UltraAlignmentV4Hook(_hook);
}
```

### Option C: Pass Salt to Constructor, Deploy Hook Inside
Have the instance deploy its own hook (more complex refactor).

## Impact

- **Severity: High** - ERC404 instances with vaults cannot be created
- **Affected Functions**: `ERC404Factory.createInstance()` when vault is provided
- **Workaround**: None currently - hooks cannot be attached to instances

## Testing

After fix, run:
```bash
cd contracts && forge test --match-contract ERC404Factory -vvv
```

The existing test `test/factories/erc404/ERC404Factory.t.sol` should cover this if it creates instances with vaults.
