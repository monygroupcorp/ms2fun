# Contracts Agent Briefing: Bootstrap Mode Implementation

**Date:** 2026-01-12
**Context:** ms2fun frontend development
**Urgency:** HIGH - Blocking MVP

---

## Summary

We've successfully deployed the core contracts (MasterRegistry, GlobalMessageRegistry) to local Anvil and verified they work. Now we need to deploy factories and vaults to create test instances so we can implement real frontend services.

**Critical Blocker:** The governance system prevents us from registering factories and vaults during MVP testing. We need owner bypass during the bootstrap phase.

---

## What We Need

Add **bootstrap mode** to MasterRegistryV1 where the owner can bypass governance for factory/vault registration during the first ~100 days (or until manually transitioned).

**Detailed Specification:** See `contracts/BOOTSTRAP_MODE_REQUIREMENT.md`

---

## Key Questions for You

1. **Approach:** Time-based (100 days), manual flag, or hybrid?
2. **Timing:** Add to current MasterRegistryV1 or include in size refactor?
3. **Security:** Any concerns with owner bypass during bootstrap?
4. **Testing:** What edge cases should we test?

---

## Why This Matters

**Current State:**
- ✅ MasterRegistry deployed on local Anvil
- ✅ Frontend running with mock data
- ❌ Cannot deploy factories (need governance vote)
- ❌ Cannot deploy vaults (need governance vote)
- ❌ Cannot create test instances
- ❌ Cannot implement real services

**After Bootstrap Mode:**
- ✅ Owner registers ERC1155Factory instantly
- ✅ Owner registers UltraAlignmentVault instantly
- ✅ Create 1 test instance
- ✅ Implement real frontend services
- ✅ See actual on-chain data in UI

---

## Next Steps After Your Implementation

1. You update MasterRegistryV1 with bootstrap mode
2. We pull updated submodule: `cd contracts && git pull origin main`
3. We rebuild: `forge build`
4. We create `scripts/deploy-mvp.mjs` to deploy factories/vaults
5. We implement real frontend services
6. We remove `FORCE_MOCK_MODE_UNTIL_SERVICES_READY` flag
7. We see real data! 🎉

---

## Context: Contract Sizes

Note: MasterRegistryV1 is currently 60KB (over the 24KB mainnet limit). We're using Anvil with `--code-size-limit 100000` for local testing. The size refactor is tracked in `CONTRACT_SIZE_REFACTOR_TASK.md` but is separate from this bootstrap mode requirement.

Bootstrap mode is a small addition (~100-200 bytes) and won't significantly impact the size issue.

---

## Our MVP Strategy (For Context)

| Component | Strategy |
|-----------|----------|
| Factory | ERC1155Factory only (simpler than ERC404) |
| Instances | Just 1 test instance |
| Vault | Deploy 1 vault (necessary for full flow) |
| EXEC Token | Use deployer address placeholder |
| Seeding | Minimal - just creation + 1-2 mints |

---

## Files to Reference

- `contracts/BOOTSTRAP_MODE_REQUIREMENT.md` - Full specification
- `contracts/CONTRACT_SIZE_REFACTOR_TASK.md` - Separate refactor task
- `docs/plans/2026-01-08-local-development-system-design.md` - Full plan

---

## Thank You!

This is the last blocker before we can connect the frontend to real contracts. Really appreciate your help getting bootstrap mode implemented!

**Priority:** HIGH
**Estimated Impact:** Small code change, big unblock
