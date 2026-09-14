# dev-chain

Local anvil mainnet-fork dev loop for the new platform contracts (registries, factories,
modules). This is the viem replacement for the retired ethers-v5 loop now in
`legacy/scripts/local-chain/`.

> Scope: the **new platform** only. The EXEC404 / Cult Executives fossil is already deployed
> elsewhere and is read directly at its mainnet address on the fork — it is not deployed here.

## Usage

```bash
# 1. Start the fork (reads MAINNET_RPC_URL from repo-root .env; never prints it).
pnpm chain:fork            # leave running in its own terminal

# 2. In another terminal: deploy + write src/config/local-deployment.json.
pnpm chain:deploy
```

### Running this channel on another port

`ANVIL_PORT` moves the whole mainnet channel. Export it once and `chain:fork`, `chain:deploy`,
`chain:check`, `chain:stop` and the dev server's `/__rpc/mainnet` proxy all follow it — no file is
edited to run a second channel:

```bash
ANVIL_PORT=8600 pnpm chain:fork     # terminal 1
ANVIL_PORT=8600 pnpm chain:deploy   # terminal 2
ANVIL_PORT=8600 pnpm dev            # the proxy target is read at dev-server startup
```

Unset, every path is the `:8545` loop exactly as documented above. A value that is not a port
number is refused up front rather than passed to anvil. Each port keeps its OWN ownership record —
`:8545` uses `/.anvil.pid` as it always has, any other port uses `.cache/anvil-<port>.pid` — so two
channels cannot overwrite each other's and orphan a fork.

> `:8546` already belongs to the **Sepolia** channel (`SEPOLIA-CHANNEL.md`), which is a different
> fork at a different chain id. Pointing the mainnet channel there while that one runs is refused
> by the port guard; pick another port.

## Notes

- **Addresses are non-deterministic.** `DeployAnvil.s.sol` derives CreateX salts from
  `block.timestamp`, so every deploy yields fresh addresses. `chain:deploy` rewrites
  `src/config/local-deployment.json` each time — never trust the committed snapshot.
- The committed `local-deployment.json` is a zero-address placeholder so typecheck/build pass
  without a live fork. To stop the regenerated file from showing as dirty in git:
  `git update-index --skip-worktree app/src/config/local-deployment.json`.
- **Seeding is intentionally not ported.** Task-zero ports only the deploy bridge. The demo
  collection world (the old `scenarios/*`) is rebuilt in Phase 3 on the typed viem domain layer
  - the real create flows.
- **Port-ownership guard needs one of `lsof`, `ss`, or `fuser`.** `fork.sh` and `stop.sh` probe
  the channel's port before starting or stopping the fork, so they never touch a process this repo
  did not start. `ss` ships with `iproute2` and is present on most Linux boxes; `lsof` and `fuser` also
  work if installed. With none of the three available, both scripts refuse to start or stop
  rather than guess at the port's state.
- **The app reaches this fork same-origin, through the dev server.** `pnpm dev`/`pnpm preview`
  proxy `/__rpc/mainnet` to `http://localhost:8545` — or to `ANVIL_PORT` where it is set
  (`vite.config.ts`); the app's own transport
  uses that path, never a plain loopback URL, so it clears the page's CSP and Chrome's Local
  Network Access gate. A **wallet** adding this network manually still needs the absolute RPC,
  `http://localhost:8545` (or the overridden port) — the wallet is a separate app, not the page, so
  neither the CSP nor the proxy applies to it.
