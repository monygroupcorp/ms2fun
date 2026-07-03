# Spec — make `deployLiquidity()` owner-only (contract change)

**Status:** contract change, NOT built. The UI half shipped (T3): "deploy liquidity (graduate)" is now
an action in the ERC404 creator admin menu (`Erc404AdminPanel`), and the old permissionless
`GraduateButton` on the trading surface was removed.

## Problem

`ERC404BondingInstance.deployLiquidity()` is currently **permissionless**:

```solidity
function deployLiquidity() external nonReentrant { ... }
```

The design decision (Mony, 2026-07-03) is that graduating a collection to the DEX is a **creator
action**, not something any passerby can trigger. The frontend now only surfaces it in the owner-gated
admin menu, but the contract still lets anyone call it — the UI restriction is cosmetic until the
contract is changed.

## Change

Add owner gating to `deployLiquidity()`:

```solidity
function deployLiquidity() external onlyOwner nonReentrant { ... }
```

(`onlyOwner` is already the modifier used by `activateStaking()` and the other creator actions in the
same contract, so the pattern + error type are established.)

## Consider

- **Agent delegation.** The contract has an `agentDelegationEnabled` flag + approved-agent pattern
  (see `setAgentDelegation`). If graduation should be delegable, gate on `onlyOwnerOrAgent` (whatever
  the established combined modifier is) rather than bare `onlyOwner`, matching how other delegable
  actions are gated. Check what modifier the other owner actions that support delegation use.
- **Maturity fallback.** If the intent ever becomes "owner OR anyone-after-a-grace-period" (so a
  matured curve can't be held hostage by an inactive creator), that's a richer gate — out of scope
  here unless Mony asks. Current decision is simply owner-only.

## Tests

- Existing graduation tests call `deployLiquidity()` as the owner/deployer — verify they still pass.
- Add a test asserting a non-owner call reverts with the ownable error.
- The frontend e2e (`graduated-swap.spec.ts`) graduates as the ADMIN/owner wallet — confirm it still
  graduates (it should, since it acts as owner).
