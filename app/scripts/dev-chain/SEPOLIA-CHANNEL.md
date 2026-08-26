# The Sepolia-fork dev channel

A second local chain, beside the mainnet-fork one, for seeing what the public testnet will hold
before it holds it. It forks **Sepolia** on **:8546**, runs the **real** deploy and seed pipeline
against that fork, and hands the app a config artifact of its own — so the showcase can be walked in
the browser rather than read out of a forge log.

The mainnet-fork channel is untouched. `pnpm chain:fork` / `chain:deploy` / `chain:check` /
`chain:stop` still drive anvil on **:8545** at chain id **1337**, still write
`src/config/local-deployment.json`, and behave exactly as before. The two channels run at the same
time and are told apart by **port**.

|            | mainnet channel                    | Sepolia channel                             |
| ---------- | ---------------------------------- | ------------------------------------------- |
| forks      | mainnet (`MAINNET_RPC_URL`)        | Sepolia (`SEPOLIA_RPC_URL`, archive)        |
| port       | 8545                               | 8546                                        |
| chain id   | 1337                               | 11155111                                    |
| deploy     | `DeployAnvil` + `SeedAnvil`        | `DeploySepolia` + the Sepolia showcase seed |
| app config | `src/config/local-deployment.json` | `src/config/local-deployment.sepolia.json`  |
| app flag   | none (the default)                 | `VITE_SEPOLIA_FORK=1`                       |

## Why the chain id is 11155111 and not something new

The Sepolia seed scripts require chain 11155111 on-chain (`SeedSepolia.s.sol`,
`SeedSepoliaShared.sol`), so a fork under any other id cannot run them. It is also the fidelity the
channel is for: the app talking to the fork behaves exactly as it will on the real testnet, wallet
prompts included. **Never pass `--chain-id` to the channel's anvil.** The channels are separated by
port, and by the app flag below.

## Running it

```sh
# 1. an ARCHIVE Sepolia endpoint, in the repo-root .env (the value is never printed):
#      SEPOLIA_RPC_URL=<archive sepolia rpc>
#    A non-archive, load-balanced public endpoint fails partway through the deploy.

cd app
pnpm chain:fork:sepolia      # anvil, :8546, forked chain id, --auto-impersonate
pnpm chain:deploy:sepolia    # Algebra standup -> DeploySepolia -> seed phase 1 -> phase 2
pnpm chain:check:sepolia     # asserts the fork holds what the seed claims

VITE_SEPOLIA_FORK=1 VITE_CHAIN_ID=11155111 pnpm dev

pnpm chain:stop:sepolia      # when you are done; `pnpm chain:stop` is still the other channel
```

`pnpm chain:deploy:sepolia --skip-algebra` reuses the newest Algebra standup record instead of
standing the rail up again — for a re-deploy against a fork that already carries one.

### Reaching it from a wallet

Add a custom network in the wallet, exactly as for the 1337 channel today:

- **Chain id** 11155111
- **RPC** `http://localhost:8546`
- **Currency** ETH

Use the **absolute** RPC above, not the app's `/__rpc/sepolia` proxy path — the wallet is a
separate app on your machine, not the page, so it isn't bound by the page's CSP or Chrome's Local
Network Access gate and can't reach anvil through the dev server. Chrome's "give this site
permission to access devices on your local network" prompt no longer appears for the PAGE (it now
reaches anvil same-origin); it's unrelated to the wallet either way.

The wallet will call it Sepolia, because it is Sepolia's chain id. Anvil funds its ten default
accounts with 10 000 ETH each; import one of those to have a balance to spend.

## What the channel actually runs

Three tools, in the order the live broadcast runs them, none of them written for the channel:

1. **`scripts/sepolia-algebra/`** — Sepolia carries no Algebra deployment, so the Cypher rail is
   stood up from mainnet bytecode (ten contracts and the mainnet fee regime). The three periphery
   addresses it produces are handed to the deploy through the `SEPOLIA_CYPHER_*` environment overlay
   `DeploySepolia` already reads.
2. **`contracts/script/DeploySepolia.s.sol`** — the protocol, with the zRouter self-deployed.
3. **`scripts/sepolia-seed/seed.ts`** — the two-phase showcase seed: create and arm, then buy,
   graduate and convert on every venue.

What lands: the four curve states (pre-open, mid-curve, ready-to-graduate, graduated), the four
alignment targets (MS2/UNI_V4, CULT/UNI_V4, MS2/ZAMM, CULT/ALGEBRA) with their vaults and pools, and
the breadth rows — editions, an allowlist, staking, tiers, the creator carve, auctions. The seed's
own runbook (`scripts/sepolia-seed/README.md`) is the inventory.

## How it differs from the real broadcast

Four differences, and they are the whole list.

- **The arm window is warped, not waited.** Between the seed's two phases the live run waits out a
  real arm window and the reference pools' TWAP window on the wall clock. A fork can be told to
  advance, so it is: `seed.ts` does that on its non-`--broadcast` branch and prints `[FORK ONLY]`
  at the moment it does. Everything else in both phases is genuinely executed. **The wall-clock path
  is what runs live and is not exercised here.**
- **The deployer is impersonated.** `DeploySepolia.run()` requires `msg.sender` to be the address
  the CreateX salt set is bound to, and nobody holds that key. The fork runs with
  `--auto-impersonate`, the orchestrator funds the address with `anvil_setBalance`, and forge signs
  `--unlocked`. The live run signs from a keystore.
- **The salt set is cleared first.** A CreateX CREATE3 salt is consumed by the deploy that used it,
  and this set is already spent on live Sepolia — a fork at latest would revert `CreateCollision`.
  The orchestrator re-derives the six CREATE2 proxies (and the addresses they produce) from
  `script/SepoliaSalts.sol` and clears code and nonce at each before deploying. Each derivation must
  reproduce the address the salt set documents, so a wrong constant fails loudly rather than
  clearing the wrong accounts. Live, the salts are mined fresh and nothing is cleared.
- **Addresses are fork-ephemeral.** The six CREATE3 registries land on their vanity addresses; every
  address below them comes out of a fresh nonce sequence on the fork and will differ on the real
  network. The channel's app config is regenerated every run, never committed with real values.

Every forge process the channel starts runs with `FOUNDRY_NO_STORAGE_CACHING=true`. The fork reports
chain 11155111, so forge would otherwise answer reads out of its own Sepolia cache — and the cleared
salt set would be invisible to it.

## The app seam

Two lines, both behind `VITE_SEPOLIA_FORK`, and both no-ops when it is unset:

- `src/lib/wagmi.ts` — chain 11155111's transport becomes `/__rpc/sepolia` (same-origin, proxied
  to `http://localhost:8546` by `vite.config.ts`'s dev-server proxy) instead of the health-ranked
  public pool.
- `src/lib/addresses.ts` — the channel's artifact `local-deployment.sepolia.json` is used **in place
  of** the committed `sepolia-deployment.json` placeholder. A substitution, not an addition: both
  files carry chain id 11155111, and two deployments at one key would silently keep the last.

No new supported chain, no second `defineChain`, no in-app switcher. `VITE_CHAIN_ID=11155111` selects
the chain the same way it already does for a real Sepolia build; the flag only decides which end of
the wire that chain id points at.

`src/config/sepolia-deployment.json` — the committed placeholder for the real network — is never
written by the channel.
