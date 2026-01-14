# Contract Size Refactor Task: MasterRegistryV1

## Problem

The `MasterRegistryV1` contract exceeds Ethereum's contract size limit:
- **Current size:** 60,096 bytes
- **Limit:** 24,576 bytes (EIP-170)
- **Overage:** 35,520 bytes (144% over limit)

While the contract deploys successfully on our Anvil local fork, it will **fail to deploy on mainnet** due to this size restriction.

## Contract Location

**File:** `src/master/MasterRegistryV1.sol`

## Current Functionality (Must Preserve)

The MasterRegistryV1 contract currently handles:
1. **Factory Registration** - Tracking approved factory contracts
2. **Vault Management** - Registry of vaults and their metadata
3. **Instance Tracking** - Recording all deployed instances (ERC404, ERC1155)
4. **Governance Integration** - Creates and manages FactoryApprovalGovernance and VaultApprovalGovernance
5. **Fee Management** - Protocol fee configuration
6. **Access Control** - Owner-based permissions using Solady's Ownable
7. **Upgradability** - Used with proxy pattern (MasterRegistry.sol)

## Required Outcome

Refactor MasterRegistryV1 to:
1. **Reduce size to under 24,576 bytes** (ideally under 23,000 bytes for safety margin)
2. **Preserve all existing functionality**
3. **Maintain interface compatibility** (don't break existing integrations)
4. **Keep upgradability via proxy pattern**

## Suggested Refactoring Strategies

### 1. Extract Governance Logic (Recommended)
The governance contract creation logic is large. Consider:
- Move governance deployment to a separate `GovernanceDeployer` helper contract
- MasterRegistry calls the helper during initialization
- Reduces complexity and size significantly

### 2. Split into Modules
Break MasterRegistryV1 into multiple contracts:
- `MasterRegistryCore` - Core registry functions
- `MasterRegistryFactory` - Factory-specific logic
- `MasterRegistryVault` - Vault-specific logic
- Use delegate calls or library pattern for modular functionality

### 3. Use Libraries
Extract complex logic into external libraries:
- Registration validation logic
- Fee calculation functions
- Query/getter functions that do complex operations

### 4. Optimize Storage Patterns
- Use tighter packing for storage variables
- Consider using mappings instead of arrays where possible
- Remove redundant storage if any exists

### 5. Remove or Simplify Features
Identify and potentially defer to later versions:
- Complex validation logic that could be done off-chain
- Redundant getter functions
- Overly detailed events

### 6. Optimize String Usage
- Use error codes instead of long error strings
- Consider using custom errors (more gas efficient, smaller size)
- Reduce event parameter descriptions

## Testing Requirements

After refactoring, ensure:
1. **All tests pass** - Run the full test suite
2. **Deployment succeeds** - Contract size under limit
3. **Proxy pattern works** - Initialize function works correctly
4. **Governance deploys** - FactoryApprovalGovernance and VaultApprovalGovernance created
5. **Frontend compatible** - ABI changes don't break frontend integration

## Current Integration Points

The frontend currently expects:
- Standard proxy pattern with `initialize(address execToken, address owner)`
- Governance contracts auto-deployed during initialization
- Events for tracking registrations

Any changes to public interfaces will require frontend updates.

## Deliverables

1. **Refactored MasterRegistryV1.sol** (or split contracts)
2. **Updated tests** (if test files need changes)
3. **Documentation** of changes made
4. **Size report** showing new contract size
5. **Migration notes** (if interface changed)

## Priority

**HIGH** - This blocks mainnet deployment. We can work on Anvil fork for now, but mainnet deployment will fail with current size.

## Additional Context

- We're using Solidity 0.8.24
- Foundry for compilation and testing
- Already using `via_ir = true` in foundry.toml (helps with optimization)
- Using Solady libraries (lightweight alternatives to OpenZeppelin)

## Success Criteria

Run this command and see success:
```bash
forge build
# Should NOT show: "Error: `MasterRegistryV1` is above the contract size limit"
```

Check the size:
```bash
forge build --sizes | grep MasterRegistry
# Should show: MasterRegistryV1: <24,576 bytes
```

## Questions to Consider

1. Which functions are called most frequently? (keep these in main contract)
2. Which logic could be moved to helper contracts/libraries?
3. Is all the initialization logic necessary in the main contract?
4. Can any getter functions be simplified or removed?
5. Are there any redundant state variables?

## Example: Governance Extraction Pattern

```solidity
// NEW: GovernanceDeployer.sol
contract GovernanceDeployer {
    function deployGovernance(
        address masterRegistry,
        address execToken,
        address owner
    ) external returns (address factoryGov, address vaultGov) {
        factoryGov = address(new FactoryApprovalGovernance());
        FactoryApprovalGovernance(factoryGov).initialize(execToken, masterRegistry, owner);

        vaultGov = address(new VaultApprovalGovernance());
        VaultApprovalGovernance(vaultGov).initialize(execToken, masterRegistry, owner);

        return (factoryGov, vaultGov);
    }
}

// UPDATED: MasterRegistryV1.sol
contract MasterRegistryV1 {
    function initialize(address execToken, address owner) external {
        // ... other initialization ...

        // Deploy governance via helper (reduces size)
        GovernanceDeployer deployer = new GovernanceDeployer();
        (factoryGovernance, vaultGovernance) = deployer.deployGovernance(
            address(this),
            execToken,
            owner
        );
    }
}
```

This pattern alone could save 5,000-10,000 bytes.

---

**Please analyze MasterRegistryV1.sol and propose a refactoring plan that achieves the size requirement while preserving all functionality.**
