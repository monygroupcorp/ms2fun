# Local Chain Overhaul

**Date:** 2026-02-19
**Status:** Approved for implementation

## Goals

1. Fix broken `deploy-local.mjs` (contracts were overhauled)
2. Use foundry scripts for deployment to match production infrastructure
3. Modular scenario system for different seeded chain states

## Architecture

### Approach: Forge deploys, Node.js seeds

- `forge script` handles contract deployment (production parity)
- Node.js handles seeding (multi-account ETH transfers, buys, mints)
- Node.js orchestrates and writes `contracts.local.json`

### Scenario system: Tagged scenarios

Each scenario is a standalone module. No stacking at CLI level — composition happens at the code level via shared building blocks. Eye on refactoring to declarative config objects later.

## Directory Structure

```
scripts/
  local-chain/
    setup.sh                    # unchanged
    start-chain.sh              # updated: passes --scenario flag
    run-local.mjs               # new entrypoint, dispatches scenario
    deploy-contracts.mjs        # forge script runner → parses broadcast JSON
    seed-common.mjs             # shared seeding building blocks (extracted from deploy-local.mjs)
    scenarios/
      default.mjs               # current behavior
      busy.mjs                  # stub
      proposal.mjs              # stub
      empty.mjs                 # stub (deploy only, no seeding)
    lib/
      hookSaltMiner.mjs         # moved from scripts/lib/
      write-config.mjs          # extracted config writer

  verify-seed-data.mjs          # unchanged
  seed-governance.js            # unchanged
```

`scripts/deploy-local.mjs` is deleted. Its logic is split across:
- `deploy-contracts.mjs` — deployment
- `seed-common.mjs` — building blocks
- `scenarios/default.mjs` — orchestration

## CLI

```bash
npm run chain:start                        # default scenario
npm run chain:start -- --scenario busy
npm run chain:start -- --scenario proposal
npm run chain:start -- --scenario empty
```

`package.json` scripts:
```json
"chain:start": "bash scripts/local-chain/start-chain.sh",
"chain:reset": "bash scripts/local-chain/start-chain.sh"
```

`start-chain.sh` forwards `$@` to `run-local.mjs` so `--scenario` passes through.

## deploy-contracts.mjs

Shells out to `forge script` for each deployment script. Uses well-known Anvil account 0 private key locally. Production uses `--account keystore` — the forge scripts are keystore-agnostic.

```javascript
execSync(
  `forge script ${scriptPath} --rpc-url ${RPC} --private-key ${ANVIL_KEY} --broadcast`,
  { cwd: 'contracts', stdio: 'inherit' }
)
```

Reads deployed addresses from `contracts/broadcast/*/run-latest.json` (forge broadcast artifacts) — no manual address tracking.

## Forge Script Requirements

All `contracts/script/*.s.sol` files must:
- Use bare `vm.startBroadcast()` — no `vm.envUint("PRIVATE_KEY")`
- The caller provides key via `--private-key` or `--account`

**Action:** Audit and strip `PRIVATE_KEY` env reads from all deployment scripts.

## Scenario Interface

Every scenario exports a single `seed()` function:

```javascript
export async function seed(addresses, provider, deployer) {
  // use building blocks from seed-common.mjs
}
```

`seed-common.mjs` exports reusable functions:
- `fundAccounts(provider)` — give test accounts ETH
- `createERC1155(addresses, name, opts)`
- `createERC404(addresses, name, opts)`
- `seedBuys(instance, opts)`
- etc.

## Adding a New Scenario

1. Create `scripts/local-chain/scenarios/my-state.mjs`
2. Export `seed(addresses, provider, deployer)`
3. Run with `npm run chain:start -- --scenario my-state`

No other files change.

## What Doesn't Change

- Anvil startup flags (`--fork-url`, `--chain-id 1337`, `--code-size-limit 100000`)
- `USER_ADDRESS` env var requirement (developer's wallet, gets funded + ownership transfers)
- `MAINNET_RPC_URL` env var requirement
- `scripts/verify-seed-data.mjs`
- `scripts/seed-governance.js`
- `src/config/contracts.local.json` output format (frontend reads this)
