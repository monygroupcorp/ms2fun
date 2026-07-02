# Handoff — live design walk pass (take action on Mony's notes)

**For a fresh session.** The design-pass CODE is complete and on `main` (head at handoff time
`2da2e41`+). This handoff is for the NEXT step: **Mony walks every path in the running app and gives
notes; you act on each note** (reproduce → fix → verify → commit), the same loop that produced
B1–B18 + B19 + B6/B7/B11.

> **TESTNET IS A HUMAN GATE.** Testnet is NOT unblocked until Mony has personally walked every path
> AND approved the site design. Never frame testnet as "next" or "unblocked" on code-completeness.
> Your job here is to clear his design notes, not to declare readiness. (Memory: `testnet-human-gate`.)

## Running environment

A fresh pristine fork + seed was stood up at handoff. If it's stale/down, rebuild it:

```bash
# 1. Fresh mainnet fork (chain 1337, :8545). Reads MAINNET_RPC_URL from repo-root .env.
cd app
pkill -9 -x anvil            # NOTE: -x (exact name). NEVER `pkill -f anvil` — it matches its own
                             # command line and self-kills the shell. Wait ~3s for the port to free.
bash scripts/dev-chain/fork.sh   # run it directly / backgrounded; the `pnpm chain:fork` wrapper has flaked.
# 2. Deploy + seed (can take >2 min — give it a long timeout, don't let a 2-min tool cap kill it).
pnpm chain:deploy
# 3. Dev server (usually already up on :5173)
pnpm dev
```
App: **http://localhost:5173**. Wallet in E2E is anvil account #0 (`0xf39F…2266`, unlocked); the
protocol ADMIN is `0x54EfD4…9C86` (funded 1000 ETH, owns instances + registries → drives `/admin`).
Addresses regenerate every deploy into `app/src/config/local-deployment.json` (skip-worktree, not
committed).

## What the fresh seed contains (states are chain-anchored after a +2h advance)

- **ERC-1155:** neon-drift (Aave endowment vault), monolith, ghost-mint (free-claim pool).
- **ERC-721:** gallery (ended, settle-ready/no-bid), live-salon (active).
- **ERC-404 bonding:** `ember-preopen` (Cypher deployer, preopen), `vapor-mid` (Uni-V4, mid-curve +
  staking), `cinder-ready` (Uni-V4, **ready to graduate**), `molten-ready` (ZAMM, **ready to
  graduate**), `prism-stacked` (ZAMM, metadata overlay+tier).
- Seed spans all 3 AMMs + 4 vault flavors. `cinder-ready` + `molten-ready` are NOT pre-graduated —
  to see the **embedded graduated swap (B19)**, graduate one via its GRADUATE button (works now), then
  the in-site buy/sell panel replaces the link-out.

## Surfaces new/changed since the last walk (look here first)

- **Graduated ERC-404 swap (B19)** — `GraduatedSwapPanel`: after graduating `cinder-ready`
  (Uni-V4/`swapV4`) or `molten-ready` (ZAMM/`swapVZ`), the graduated page embeds a buy/sell panel
  (live sim quote, slippage, approve-then-swap for sells). Cypher (`ember-preopen`) stays link-out.
- **EXEC404 fossil** (`/exec404`) — embedded `swapV2` panel (`Exec404SwapPanel`) + **Legacy activity**
  feed of real on-chain chatter (`Exec404Activity`) + stats. Uniswap link kept as secondary.
- **Collection page** — post composer on each collection's activity (B6); cover captioned as a figure
  so it doesn't read as a mintable piece (B11).

## Working protocol for each note

1. Reproduce in the running app (ask Mony for the exact path/collection/state if unclear).
2. Fix minimally, matching surrounding code idiom. Frontend lives in `app/src`; contracts in
   `contracts/src` (changing a contract ⇒ rebuild + fresh redeploy to see it).
3. Verify before moving on: `cd app && pnpm tsc --noEmit && pnpm lint && pnpm exec vitest run`, plus a
   focused `@fork` e2e when a write path is touched (`pnpm exec playwright test <spec> --workers=1`;
   run SERIAL — parallel flakes on anvil). Add/extend an e2e for any newly-touched write path.
4. Commit per coherent note or small batch; end messages with the co-author trailer. Keep
   `docs/phases/design-pass-blockers.md` (append each note as an item with status) + memory
   (`MEMORY.md` RESUME HERE, `[[design-pass-blockers]]`) current.

## Gotchas (hard-won)

- `pkill -9 -x anvil`, never `-f`. Start the fork via `bash scripts/dev-chain/fork.sh` (wrapper flakes).
  `chain:deploy` can exceed a 2-min tool timeout — budget more.
- zRouter reads `deadline == type(uint256).max` as a **Sushi**-pool selector → always pass a FINITE
  deadline for swaps (the swap panels already do; the sims use a stable far-future finite constant).
- The dev-fork's zRouter + LP deployer modules are freshly deployed (NOT the mainnet singletons) —
  read them from `local-deployment.json` / `forkAddresses`, never hardcode.

## Pointers
- Status of every blocker: `docs/phases/design-pass-blockers.md`.
- B19 build + the Uni-V4 graduation 2-bug fix: same doc STEP 1 + `handoff-uniV4-settle-fix.md`.
- Memory index: `MEMORY.md` (RESUME HERE), `[[design-pass-blockers]]`, `[[testnet-human-gate]]`.
