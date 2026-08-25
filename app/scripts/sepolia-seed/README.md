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

…and the rest of what the product does, one collection per mechanism:

| row              | family   | what it demonstrates                                                              |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `atlas-editions` | ERC-1155 | the three edition pricing regimes: fixed, rising (dynamic), and a free claim      |
| `veil-list`      | ERC-1155 | Merkle allowlist gating — see the deviation noted below                           |
| `quarry-staking` | ERC-404  | the stake/unstake surface, activated, carrying a seeded position                  |
| `prism-tiers`    | ERC-404  | Token Tiers (mint up, mint down, an exhausted band) over a layered metadata stack |
| `carve-demo`     | ERC-404  | the creator carve and the allowance disclosure that governs it                    |
| `relic-line`     | ERC-721  | how a lot ENDS: one settled to its winner, one reclaimed unsold                   |
| `salon-line`     | ERC-721  | a live lot, still counting down                                                   |

Every row's on-chain description states the FEATURE it demonstrates rather than roleplaying a drop.
Curve rows are keyed by NAME in the hand-off file, so later waves add venues and project types by
adding names, never by position; the non-curve rows are addressed by field in the same file.

### Two states that are reached at a wave boundary, not here

Both are recorded in the seed's own on-chain copy rather than left for a visitor to discover.

- **The staking stream is armed, not flowing.** The module is funded only by a real LP-fee delta
  arriving through `claimAllFees`, which needs alignment-pool depth and swap volume. Pushing ETH at
  it from a fixture would fabricate the reward source, so the stake and unstake actions are live and
  the stream begins once the venue is carrying trades.
- **The allowlist is address-bound.** That is what a Merkle allowlist is: a leaf commits to a wallet
  and the cap it was listed with, so a cold visitor cannot enter it. A gated tier a stranger can
  satisfy would need a different gating module, which is its own decision and its own item.

## Cost

- **Phase 1** moves no ETH beyond the auction lots' queue deposits (returned at settle, less a 1%
  protocol cut at reclaim). Creating and arming is gas.
- **Phase 2** buys every curve, graduates two of them, walks the tier ladder and crosses the timed
  auction. It prints its projected curve spend at simulation time — i.e. **before** `--broadcast`
  sends anything, and split into the roster's share and the breadth rows' — and refuses to run if the
  sender's balance does not cover it.

Measured on a Sepolia-fork rehearsal at the defaults below: **0.558 ETH** of curve spend, of which
0.242 is the four-row curve roster and 0.316 the breadth rows. The single largest line is
`prism-tiers` (0.177): every tier operation is denominated in WHOLE units, and a whole unit is a
sixtieth of that row's supply, so the walk is necessarily a tenth of its curve. Lower it with
`SEPOLIA_TIER_UNITS` (at the cost of the mint-down half of the demonstration) or with the fill knobs.

Both figures are also reported per phase by the orchestrator, read from forge's own receipts.

## What a visitor could exhaust

Stated rather than assumed, because a showcase that runs out is worse than one that is smaller.

- **`prism-tiers`, the scarce rung** — seeded EXHAUSTED on purpose. That is the demonstration: the
  next `mintUp` into it reverts `BandExhausted`, and it reopens the moment any holder mints down.
- **`relic-line`** — both lots are consumed by the seed. It is a record of two endings, not a live
  house; `salon-line` is the one to bid in.
- **`veil-list`** — the seeded operator address is listed at a cap of 2, so `QtyCapExceeded` is two
  mints away. That is deliberate: it is the branch a mint UI most often gets wrong.
- **`atlas-editions` free claim** — 100 reservations, one per address.
- Every ERC-404 row is bought at single-digit-percent fills, so the curves themselves have room.

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

| variable                          | default | effect                                                                                                    |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `SEPOLIA_ARM_WINDOW_SECONDS`      | 1200    | how long after phase 1 the curves open, and how long the timed auction runs                               |
| `SEPOLIA_MATURITY_OFFSET_SECONDS` | 120     | maturity offset past the open time (ready + carve rows)                                                   |
| `SEPOLIA_PHASE2_SLACK_SECONDS`    | 120     | slack phase 2 waits past the last armed clock                                                             |
| `SEPOLIA_PREOPEN_DELAY_SECONDS`   | 2592000 | how long the pre-open row stays pre-open (30 days)                                                        |
| `SEPOLIA_MID_FILL_BPS`            | 400     | mid-curve fill, in bps of bondable supply                                                                 |
| `SEPOLIA_READY_FILL_BPS`          | 700     | ready-to-graduate fill                                                                                    |
| `SEPOLIA_GRADUATED_FILL_BPS`      | 700     | the raise the graduated row carries into its pool                                                         |
| `SEPOLIA_STAKING_FILL_BPS`        | 300     | the staking row's fill; the stake is taken out of it                                                      |
| `SEPOLIA_STAKE_SHARE_BPS`         | 5000    | share of that position actually staked (the rest stays liquid)                                            |
| `SEPOLIA_TIER_UNITS`              | 6       | WHOLE units bought on the tier row — 3 for the scarce band, 2 for the open one, 1 to carry the commission |
| `SEPOLIA_CARVE_FILL_BPS`          | 700     | the carve row's raise; see the pool-floor note below                                                      |
| `SEPOLIA_AUCTION_DEPOSIT_WEI`     | 1e15    | queue deposit per auction lot                                                                             |
| `SEPOLIA_AUCTION_BID_WEI`         | 1.5e15  | the bid placed on the lot that gets settled                                                               |
| `SEPOLIA_LIVE_AUCTION_SECONDS`    | 2592000 | how long the live lot keeps running (30 days)                                                             |
| `SEPOLIA_COMMISSION_PRICE_WEI`    | 5e14    | the overlay commission's price, paid once and left unpaid once                                            |

The arm window has a floor of 300 seconds now that the timed auction shares it: below that the
anti-snipe buffer would extend the bid lot past the instant phase 2 waits for.

### The carve, and the pool floor

`effectiveCarveEth` is the minimum of the request, the bracket allowance on the raise, and the
headroom the LP share has **above `minPoolEth`**. At faucet-sized fills the LP share does not clear
that floor, so the protocol clamps the carve to zero — the graduation still completes (the floor is a
clamp, never a gate) and the row still carries its declaration, which is the disclosure the row
exists to show. Phase 2 prints the protocol's own figure and the raise at which it stops clamping, so
raising `SEPOLIA_CARVE_FILL_BPS` until the carve pays is one environment variable.

## Re-running

The seed registers collection names in the master registry, and names are unique. Re-running phase 1
against a deployment that already holds the roster reverts on the first duplicate name rather than
producing a second copy. To reseed, deploy again.

## Post-conditions

Phase 2 asserts all four curve states AND every breadth mechanism on-chain before it reports success
— `require`s, not logs, so a failure leaves no partial seed.

Both sets are unit-tested against inputs the seed itself would never produce, which is what shows the
assertions can fail:

- `contracts/test/coverage/SepoliaShowcasePostConditions.t.sol` removes each curve row's defining
  property in turn (the graduation, the maturity, the raise) and requires the check to go red.
- `contracts/test/coverage/SepoliaShowcaseBreadth.t.sol` does the same for the breadth mechanisms:
  remove the gate, remove the settle, un-exhaust the scarce band, leave the dynamic price barely
  moving, pay a carve out of a raise under the pool floor.

### Re-running the fork rehearsal against a fresh deployment

The CREATE3 vanity salts `DeploySepolia` uses are already consumed on live Sepolia, so a fresh deploy
on a fork **at latest** reverts `CreateCollision` on the proxy and then on the vanity address itself.
Clear both on the local fork (`anvil_setCode <addr> 0x` plus `anvil_setNonce <addr> 0x0`) and retry
until the deploy runs clean — it takes a handful of rounds, one per salt. Pass `--no-storage-caching`
to every `forge script`, or forge answers those reads out of its own Sepolia RPC cache and the
collision never clears.
