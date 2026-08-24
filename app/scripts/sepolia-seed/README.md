# Sepolia showcase seed — runbook

Two `forge script` runs with a **real wall-clock wait** between them, driven by `seed.ts`.

## Why two phases and a wait

`setBondingOpenTime` rejects a non-future timestamp; `buyBonding` reverts `TooEarly` before the open
time; and forge simulates an entire script at ONE timestamp before broadcasting any of it. So a
single script cannot both arm a curve and buy into it.

The local dev chain closes that gap by telling anvil to advance (`scripts/dev-chain/deploy.ts`). A
public testnet cannot be told anything, so the gap here is time somebody waits out. The orchestrator
polls the chain's own block timestamp — not the local clock — until the instant phase 1 recorded as
`phase2NotBefore` in `contracts/deployments/sepolia-seed.json`.

The window is short and configurable. Default 20 minutes.

## What gets seeded

Four ERC-404 collections, one per curve state, plus the alignment targets and vaults they bind to:

| row               | state             | what it demonstrates                                        |
| ----------------- | ----------------- | ----------------------------------------------------------- |
| `ember-preopen`   | pre-open          | armed, counting down, buys rejected on-chain                |
| `vapor-mid`       | mid-curve         | a live curve part-way through its sale, with pieces minted  |
| `cinder-ready`    | ready-to-graduate | open + matured + holding a raise, graduation left uncrossed |
| `flare-graduated` | graduated         | curve closed, raise moved into a live Uniswap V4 pool       |

Every row's on-chain description states the FEATURE it demonstrates rather than roleplaying a drop.
Rows are keyed by NAME in the hand-off file, so later waves add venues and project types by adding
names, never by position.

## Cost

- **Phase 1** moves no ETH. Creating and arming is gas only.
- **Phase 2** buys the curves and graduates one of them. It prints its projected curve spend at
  simulation time — i.e. **before** `--broadcast` sends anything — and refuses to run if the sender's
  balance does not cover it.

Both figures are also reported per phase by the orchestrator, read from forge's own receipts.

## Rehearsal (no real transactions)

```bash
anvil --fork-url <sepolia-rpc> --port 8545 --auto-impersonate &
# fund the deployment owner on the fork (its key is nobody's to hold):
cast rpc anvil_setBalance <deployer> 0x21e19e0c9bab2400000 --rpc-url http://127.0.0.1:8545
cd contracts && forge script script/DeploySepolia.s.sol --rpc-url http://127.0.0.1:8545 \
  --broadcast --unlocked --sender <deployer> --code-size-limit 30000
# the CREATE3 salts are permissioned to the deployer address, so <deployer> is not a free choice
cd ../app && pnpm exec tsx scripts/sepolia-seed/seed.ts --dry --yes --sender <deployer>
```

In `--dry` the wait is replaced by `evm_increaseTime` on the forked chain. That is a **fork-only
affordance** and it is the one step of the rehearsal that does not exercise the real path — the
wall-clock poll is what runs under `--broadcast`.

## The real run

```bash
cd app
pnpm exec tsx scripts/sepolia-seed/seed.ts --broadcast --rpc-url <sepolia-rpc> \
  --sender <deployment-owner> --account <keystore>
```

No key material passes through the orchestrator: it hands forge a `--sender` plus a keystore
`--account`, and the seed scripts take their sender from `msg.sender`. A rehearsal signs with
`--unlocked` instead, which is why the fork must be started with `--auto-impersonate`.

It prompts before each broadcast leg. `--yes` skips the prompts and exists for the rehearsal; do not
use it on a live run.

## Knobs

All optional; all read by the seed scripts from the environment.

| variable                          | default | effect                                             |
| --------------------------------- | ------- | -------------------------------------------------- |
| `SEPOLIA_ARM_WINDOW_SECONDS`      | 1200    | how long after phase 1 the curves open             |
| `SEPOLIA_MATURITY_OFFSET_SECONDS` | 120     | maturity offset past the open time (ready row)     |
| `SEPOLIA_PHASE2_SLACK_SECONDS`    | 120     | slack phase 2 waits past the last armed clock      |
| `SEPOLIA_PREOPEN_DELAY_SECONDS`   | 2592000 | how long the pre-open row stays pre-open (30 days) |
| `SEPOLIA_MID_FILL_BPS`            | 1200    | mid-curve fill, in bps of bondable supply          |
| `SEPOLIA_READY_FILL_BPS`          | 2000    | ready-to-graduate fill                             |
| `SEPOLIA_GRADUATED_FILL_BPS`      | 2000    | the raise the graduated row carries into its pool  |

## Re-running

The seed registers collection names in the master registry, and names are unique. Re-running phase 1
against a deployment that already holds the roster reverts on the first duplicate name rather than
producing a second copy. To reseed, deploy again.

## Post-conditions

Phase 2 asserts all four states on-chain before it reports success — `require`s, not logs, so a
failure leaves no partial seed. The same assertions are unit-tested against a settable stub in
`contracts/test/coverage/SepoliaShowcasePostConditions.t.sol`, which removes each row's defining
property in turn and requires the check to go red.
