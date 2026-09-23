# Sepolia testnet deployment — runbook

The order of operations for putting the protocol on the Sepolia public testnet, and the parameters
it will be put there with. One document, written to be followed top to bottom on the day.

It is a **sequencing** document. Each step it names has its own reference already in this repo, and
this runbook links to it rather than restating it:

| step               | reference                                  |
| ------------------ | ------------------------------------------ |
| fork rehearsal     | `app/scripts/dev-chain/SEPOLIA-CHANNEL.md` |
| the showcase seed  | `app/scripts/sepolia-seed/README.md`       |
| publishing the app | `app/scripts/ipfs-dist/RUNBOOK.md`         |

---

## 0. The decision this runbook implements

**A full fresh deployment.** The protocol is deployed again from `script/DeploySepolia.s.sol`, onto
fresh addresses, and the network's pointer moves to it.

**The 2026-03-26 deployment is abandoned, not retuned.** Its `LaunchManager` is
`0x354768153a0d3edC314D9f6baa2fd56a6961B449` and its `ERC404Factory` is
`0xd84f755AdFac9408ADbde65832F8A1BFf5179bF8`; the full address table is kept at
`contracts/deployments/superseded/2026-03-26/`. Read on chain on 2026-09-15 it still carries the old
launch-preset ladder — `unitPerNFT` 1 000 000 000 / 1 000 000 / 1 000, under which NICHE admits a
collection of 79 pieces. Retuning it in place is possible — that is what
`script/ApplyLaunchPresets.s.sol` exists for — and it is **not what is happening here**.

> **Do not run `ApplyLaunchPresets` as part of this deployment.** A fresh deploy is born with the
> ladder `script/LaunchPresets.sol` ships, written by `DeployCore` at deploy time. The apply script
> is the tool for a chain that is already standing; running it here at best broadcasts nothing and
> at worst points an owner call at the abandoned protocol.

The abandoned deployment is left exactly where it is. Nothing is migrated off it, and it has no
collections to migrate: its factory has emitted no `InstanceCreated`.

---

## 1. Parameters

### 1.1 Fixed for this network

Stated once in `contracts/script/DeploySepolia.s.sol` (`_sepoliaConfig`). This table is a reading
aid; that function is the source.

| parameter              | value                                        |
| ---------------------- | -------------------------------------------- |
| chain id               | `11155111`                                   |
| WETH                   | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| Uniswap V4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Uniswap V3 factory     | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| Uniswap V2 factory     | `0xF62c03E08ada871A0bEb309762E260a7a6a880E6` |
| ZAMM V1                | `0x000000000000040470635EB91b7CE4D132D616eD` |
| Permit2                | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Aave stataEthWETH      | `0x162B500569F42D9eCe937e6a61EDfef660A12E98` |
| Aave test WETH         | `0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c` |
| price deviation        | 1000 bps                                     |
| TWAP window            | 1800 s                                       |
| zRouter fee / spacing  | 3000 / 60                                    |
| ZAMM feeOrHook         | 30 (0.3%)                                    |
| alignment tithe rate   | 100 bps (1% of the ETH leg) — **inert until §5.6** |
| hooked-pool LP fee     | 3000 (0.3%) — the same tier an untaxed pool trades on |
| deploy-time targets    | none — the roster is minted by the seed      |

The last two rows are the **rate** of the perpetual post-graduation swap tithe, not a decision to
charge it. `DeployCore` copies both onto the liquidity deployer module and leaves the module's
`alignmentHookFactory` at `address(0)`, which is its OFF position: until §5.6 every graduation
opens a plain static-fee pool with no hook and no tithe. The pair is set here because a switch
thrown over a zero rate mints hooks that take nothing, immutably and silently, and that is not a
thing a rehearsal should be able to discover on mainnet.

Two peripherals are **self-deployed** rather than pointed at something already on the chain, and
both are deliberate: neither pre-existing Sepolia zRouter is this repo's router (one predates
`swapVZ`, the other binds the mainnet V4 PoolManager), and Sepolia has no canonical quoter at all.
The reasoning is written out at the `cfg.zrouter` and `cfg.zQuoter` comments in the deploy script.

No address is supplied by environment. Every address this deployment needs is either a constant in
`DeploySepolia` or produced by the run itself.

### 1.2 The launch-preset ladder

Stated once in `contracts/script/LaunchPresets.sol` and written by `DeployCore` at deploy time.

| preset   | id  | targetETH | unitPerNFT | hard ceiling on pieces |
| -------- | --- | --------- | ---------- | ---------------------- |
| NICHE    | 0   | 5 ETH     | 1 000 000  | 79 228                 |
| STANDARD | 1   | 25 ETH    | 100 000    | 792 281                |
| HYPE     | 2   | 50 ETH    | 1 000      | 79 228 162             |

`liquidityReserveBps` is 1000 on all three. `curveComputer` is the `CurveParamsComputer` this run
deploys, so it differs per deployment and is not a constant.

A preset is read **once, at create**, and copied into the instance. A collection launched under a
rung keeps that rung's ceiling forever. That is why the ladder is checked as part of verification
(§6) and not taken on trust.

### 1.3 The CREATE3 salt set

The six registry proxies land on vanity addresses through CreateX, under the salt set in
`contracts/script/SepoliaSalts.sol`:

| proxy                 | address                                      |
| --------------------- | -------------------------------------------- |
| MasterRegistry        | `0x0000000000564ad22a8d86622a869b166a1ed2d2` |
| Treasury              | `0x0000000000e0c98e51036bdb2fdd232891fb9585` |
| QueueManager          | `0x00000000002c9176071e23396e10f124a2c48517` |
| GlobalMessageRegistry | `0x00000000003aec021b3aa39e096c5bce2886a014` |
| AlignmentRegistry     | `0x00000000005e8b175d22400baf60a457fb6328f2` |
| ComponentRegistry     | `0x000000000083a32325c0eee5ad21d093d8052ea0` |

Everything below them is nonce-derived and cannot be predicted before the run.

**A salt is single-use per deployer.** CreateX deploys a CREATE2 proxy under the guarded salt and
takes the address that proxy's first `CREATE` produces; once the proxy carries code, the same salt
reverts `CreateCollision`. The salt set that produced the 2026-03-26 addresses is therefore spent
for good, and this set is what replaces it. **The preflight in §3 is what establishes that this set
is still unspent** — a claim in a document is not evidence about chain state, and this set has one
live broadcast in it and no more.

### 1.4 The deployer

`SepoliaSalts.DEPLOYER` is `0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6`. The address is embedded in
every salt as CreateX's permissioned-deploy guard, so **this address and no other can broadcast the
deploy**; CreateX reverts `InvalidSalt` for anyone else, and `DeploySepolia.run()` asserts the match
up front so the mismatch surfaces in simulation rather than on chain.

It is also the operator of the route quoter and the owner of the deployed protocol.

---

## 2. Funding

The deployer must be funded before anything is broadcast, and it is the one prerequisite with a lead
time — Sepolia ETH is faucet-rationed.

| figure                         | amount         |
| ------------------------------ | -------------- |
| deploy cost, measured @15 gwei | **3.78 ETH**   |
| deployer balance, 2026-09-15   | **0.5849 ETH** |
| **shortfall**                  | **≈3.20 ETH**  |

Both figures are measurements taken before this runbook was written, not estimates derived here, and
both go stale. Re-read the balance on the day:

```
cast balance 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6 --rpc-url <sepolia-rpc> --ether
```

The deploy cost scales linearly with gas price, and 15 gwei is a Sepolia figure that moves. Check the
prevailing price and rescale before deciding the funding is sufficient:

```
cast gas-price --rpc-url <sepolia-rpc>
```

**The showcase seed is a separate spend on top of this.** Phase 2 of the seed was measured at
**0.558 ETH** of curve spend on a fork rehearsal at default knobs (0.242 the four-row curve roster,
0.316 the breadth rows) — see `app/scripts/sepolia-seed/README.md` for the per-row breakdown and the
knobs that move it. The seed prints its projected spend at simulation time and refuses to run if the
sender's balance does not cover it, so under-funding it fails before it sends rather than halfway
through. Budget the deploy and the seed together.

Fund to a round figure above the sum with headroom for a retry — a deploy that runs out of gas
partway leaves a half-built protocol on spent salts, which is the one failure in this runbook that
cannot be retried onto the same addresses.

---

## 3. Preflight

Everything here is read-only. None of it sends a transaction.

1. **The tree is green.** The live broadcast must be from a commit that passes CI, because two of the
   gates are load-bearing for the deploy itself:
   - the **EIP-170 diet gate** (`contracts/test/factories/erc404/eip170-diet-gate.sh`) is what
     guarantees the deployable contracts fit under the chain's 24 576-byte limit. `forge script` is
     run with `--code-size-limit 30000`, which raises the limit of forge's **simulation** EVM so the
     large script contract can be simulated — it has no effect on the chain, which enforces EIP-170
     itself. A contract over the limit therefore simulates clean and reverts on broadcast. The diet
     gate is the only thing standing between those two facts.
   - the **bindings drift gate** (`app-ci.yml`) is what guarantees the committed ABI bindings match
     the contracts about to be deployed. See §5.4.

2. **The salt set is unspent.** A salt is consumed by *two* addresses: the CREATE2 proxy CreateX
   deploys under the guarded salt, and the address that proxy's first `CREATE` produces — the one
   in §1.3. The proxy is the one that collides, so both must be checked, and the proxy addresses
   are written down nowhere: they are derived. The derivation is the one documented at the head of
   `contracts/script/SepoliaSalts.sol`, and this loop performs it against the salt constants
   themselves, so it stays right across a re-mine:

   ```sh
   cd contracts
   RPC=<sepolia-rpc>
   CREATEX=0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed
   # keccak256 of CreateX's CREATE3 proxy initcode — the only bytecode a salt commits to.
   PROXY_INITCODE_HASH=$(cast keccak 0x67363d3d37363d34f03d5260086018f3)
   DEPLOYER=$(sed -n 's/.*constant DEPLOYER = \(0x[0-9a-fA-F]\{40\}\);.*/\1/p' script/SepoliaSalts.sol)

   sed -n 's/.*bytes32 internal constant \([A-Z_]*\) = \(0x[0-9a-f]\{64\}\);.*/\1 \2/p' script/SepoliaSalts.sol |
   while read -r NAME SALT; do
     GUARDED=$(cast keccak "$(cast concat-hex "$(cast to-uint256 "$DEPLOYER")" "$SALT")")
     PROXY=$(cast create2 --deployer "$CREATEX" --salt "$GUARDED" --init-code-hash "$PROXY_INITCODE_HASH")
     ADDR=$(cast compute-address --nonce 1 "$PROXY" | cut -d' ' -f3)
     printf '%-21s proxy %s %s  address %s %s\n' "$NAME" \
       "$PROXY" "$(cast code "$PROXY" --rpc-url "$RPC")" \
       "$ADDR"  "$(cast code "$ADDR"  --rpc-url "$RPC")"
   done
   ```

   Twelve addresses, each printed with its code. **Every code field must read `0x`**, and the six
   `address` fields must be the six in §1.3 — a mismatch there means that table has gone stale
   against the constants, and §6 would be verifying the wrong chain state. Either failure stops
   the deployment: the set needs re-mining (`contracts/script/salt-miner/`) before anything is
   broadcast.

   `contracts/test/coverage/SepoliaSaltSet.t.sol` is the CI-side guard on the same constants — the
   deployer binding, the protection flag, the zero-byte prefix, distinctness. It asserts rather
   than prints, and it derives only the six §1.3 addresses and not the proxies, so it is not a
   substitute for the loop above.

3. **The RPC endpoint is an archive endpoint.** The deploy and seed read historical state. A
   non-archive, load-balanced public endpoint fails partway through with missing-trie-node errors —
   partway through a broadcast, which is the expensive place to discover it.

4. **The keystore is the deployer.** `cast wallet address --account <keystore>` must print
   `0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6`.

---

## 4. Rehearse the whole thing on a Sepolia fork

**This step is mandatory and it happens before any broadcast.** Not a smoke test — the full
pipeline, fully seeded, walked in a browser.

The rehearsal runs the same two tools in the same order the live broadcast will, neither of them
written for the fork: `DeploySepolia`, and both phases of the showcase seed.

```
cd app
pnpm chain:fork:sepolia      # anvil, :8546, forked chain id 11155111, --auto-impersonate
pnpm chain:deploy:sepolia    # DeploySepolia -> seed phase 1 -> seed phase 2
pnpm chain:check:sepolia     # asserts the fork holds what the seed claims
```

Then walk it:

```
VITE_SEPOLIA_FORK=1 VITE_CHAIN_ID=11155111 pnpm dev
```

`app/scripts/dev-chain/SEPOLIA-CHANNEL.md` has the wallet setup and the full channel description.
`pnpm chain:stop:sepolia` when done; it is a different channel from `pnpm chain:stop`.

### What the rehearsal does not prove

Four differences from the live run, and they are the whole list. They are worth knowing because each
is a place the live run can fail after a clean rehearsal.

- **The arm window is warped, not waited.** Between the seed's two phases the live run waits out a
  real arm window and the reference pools' TWAP window on the wall clock; the fork is told to
  advance instead, and `seed.ts` prints `[FORK ONLY]` at that moment. **The wall-clock path is what
  runs live and is not exercised here.**
- **The deployer is impersonated.** The fork runs `--auto-impersonate`, funds the deployer with
  `anvil_setBalance`, and signs `--unlocked`. The live run signs from a keystore.
- **The salt set is cleared first.** The fork orchestrator clears the six proxies before deploying,
  so that a rehearsal can be repeated. While the set is unspent this clears six empty accounts, and
  it passing is evidence of nothing.
- **Addresses below the six registries are fork-ephemeral.** They come out of a fresh nonce sequence
  and will differ live. The channel's app config is regenerated per run and never committed.

### The walk

The rehearsal is where the testnet walk is exercised end to end, against a deployment that holds the
whole showcase. `data/walk/manifest.json` is the numbered walk, and CI already asserts it still
describes the app; this is the run that asserts a person can follow it. Anything found here is fixed
before the broadcast, not after — after, a fix that touches a deployed contract is another deploy.

---

## 5. The live deployment

### 5.1 Broadcast

```
cd contracts
forge script script/DeploySepolia.s.sol \
  --rpc-url <sepolia-rpc> \
  --account <keystore> \
  --sender 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6 \
  --broadcast --slow --verify \
  --code-size-limit 30000
```

`--verify` needs an `ETHERSCAN_API_KEY` in the environment: `foundry.toml` carries no `[etherscan]`
section, so nothing supplies one by default and the flag fails at the verification step — after the
contracts are already on chain. Either export the key or drop the flag and verify afterwards with
`forge verify-contract`; do not discover which halfway through the run.

**Record the block number immediately before the first protocol transaction.** It becomes the
log-scan floor in §5.3, and without it the app scans Sepolia from genesis. `cast block-number` before
the run is the cheap way; forge's broadcast receipts carry it after the fact.

The run writes two files:

- `contracts/deployments/sepolia.json` — the full deployment record (registries, factories, vaults,
  the deployed quoter under `contracts.zQuoter`).
- `contracts/deployments/sepolia-venues.json` — the ZAMM vault factory plus the venue addresses,
  which the seed needs and the core record does not carry.

The one thing worth watching in the log: `DeployCore` prints a **WARNING** if `cfg.zQuoter` is zero.
On this network it must not — `DeploySepolia` mints a `SepoliaRouteQuoter` and passes it in. That
warning appearing means the quoter did not deploy and best-route acquisition is off protocol-wide,
on immutable factory fields with no setter. Stop and investigate rather than seeding on top of it.

### 5.2 Seed the showcase

Two phases with a real wall-clock wait between them — 20 minutes at the default arm window. The
orchestrator polls the chain's own block timestamp, not the local clock, and prompts before each
broadcast leg.

```
cd app
pnpm exec tsx scripts/sepolia-seed/seed.ts --broadcast --rpc-url <sepolia-rpc> \
  --sender 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6 --account <keystore>
```

Do **not** pass `--yes`; it exists for the rehearsal and skips the prompts.

The seed is what makes the deployed quoter truthful: `SepoliaRouteQuoter` ships with an **empty**
route table, so between §5.1 and here every vault behaves exactly as it would with no quoter wired.
The seed registers a route per roster token once that token exists and its pool has depth, which is
the first moment a route could be anything but a guess.

Phase 2 asserts all four curve states and every breadth mechanism on chain before reporting success —
`require`s, not log lines — so a failure leaves no partial seed.

**The seed's collection names are unique in the master registry.** Re-running phase 1 against a
deployment that already holds the roster reverts on the first duplicate name. There is no reseed;
there is only deploying again, onto a salt set that would have to be re-mined.

### 5.3 Address record

The deployment record is forge's; the app reads a slimmer per-chain config projected from it.

```
cd app
SEPOLIA_RPC_URL=<sepolia-rpc> pnpm exec tsx scripts/dev-chain/sepolia-config.ts \
  --deploy-block <block from 5.1>
```

This writes `app/src/config/sepolia-deployment.json`, which **is committed** — a Sepolia deploy is
broadcast once and its addresses are then a fact about the network, so the build carries them rather
than regenerating them. Until this runs, the committed file is all-zero.

The script refuses to run blind, and neither guard can be waived: a record stamped `forkRehearsal`
is refused without `--fork`, and every address about to be written must hold code at the live RPC.
A fork record and a live record are the same shape, at the same path, under the same chain id, so
the `eth_getCode` check is the only decisive test of which network a record describes.

Commit the record and the forge deployment JSONs together, in one commit, naming the block.

### 5.4 Bindings

`pnpm wagmi:generate` reads `contracts/out` and writes `app/src/generated/contracts.ts`. The
bindings are **ABI-only** — no address is baked into them — so a deploy that changes no Solidity
produces no diff here, and a diff appearing at this point means the deployed contracts differ from
the committed bindings. That is a stop, not a commit.

```
cd contracts && forge build --skip "*/test/**" "*/script/**" "src/vaults/zamm/**"
cd ../app && pnpm wagmi:generate
git diff --exit-code app/src/generated/contracts.ts    # must be clean
```

This is the same sequence `app-ci.yml`'s drift gate runs; running it here is confirming the gate's
answer against the tree actually being deployed, on the day.

### 5.5 Hand ownership to the Timelock

**This step is the rehearsal.** Everything above it this network has done before; this it has not.
`MigrateOwnership.s.sol` has existed and been tested since noesis-093 and **no deploy path has ever
called it**, so without this section the first two-phase ownership handover this protocol performs
would be the one on mainnet, with real money behind it and no dry run. That is the whole reason
Sepolia is run as a dress rehearsal rather than a smoke test.

**Both steps below are REQUIRED and neither is same-day.** They are written out because
`SAFE_ADDRESS` appears in exactly one line of one script and in no document — there was nowhere to
tick it before this section existed.

**5.5.1 — a Safe.** The Timelock's admin, proposer and canceller is a Safe, and `DeployTimelock`
will not run without one. Create it on Sepolia (`app.safe.global`, Sepolia network) and keep the
address. This is NOT `cfg.safe` in `DeployCore` — that field is read by nothing (see §9) and wiring
a real Safe into it installs no governance at all.

**5.5.2 — the Timelock.** `SAFE_ADDRESS` is the Safe from 5.5.1; the deployer key is the same one
§5.1 broadcast with.

```
cd contracts
export PRIVATE_KEY=<deployer>
export SAFE_ADDRESS=<the Safe from 5.5.1>
export TIMELOCK_MIN_DELAY=3600        # testnet only; unset is the 24h mainnet default
forge script script/DeployTimelock.s.sol --rpc-url <sepolia-rpc> --broadcast
export TIMELOCK_ADDRESS=<the address it printed>
```

`TIMELOCK_MIN_DELAY` is the one place this runbook deliberately differs from what mainnet will do,
and the reason is that the delay buys nothing here: it is the window in which a proposal that should
not land can be seen and cancelled, and nothing on Sepolia is worth cancelling. Left unset it is the
24h mainnet value, so a mainnet deploy that forgets the variable gets the safe number rather than
whatever the last testnet run used. **On mainnet, do not set it.**

Mind the clock either way. Phase 1 below is executed BY the Timelock, so it is proposed through the
Safe and waits out the delay — 24h on mainnet, whatever you set here on Sepolia. And
`requestOwnershipHandover()` is valid for **48h**, so once the requests land, phase 2 must run inside
that window or they expire and phase 1 is done again.

The handover is **two-phase and non-atomic**, and the roles are the reverse of a naive transfer: for
the `SafeOwnableUUPS` contracts the NEW owner requests and the CURRENT owner completes.

```
# Phase 1 — from the Timelock. Print the batch it must execute:
forge script script/MigrateOwnership.s.sol --sig "printRequestBatch()" --rpc-url <sepolia-rpc>
# Execute that batch as the Timelock. Each request is valid for 48h.

# Phase 2 — from the deployer. Completes the handovers, moves PROTOCOL_ROLE,
# re-points the emergency revoker, and asserts the result before it lands.
forge script script/MigrateOwnership.s.sol --rpc-url <sepolia-rpc> --broadcast
```

Phase 2 ends by reading the handover back and reverting if any part of it did not land, so a partial
migration fails in simulation rather than leaving the protocol half-moved. Tick §6.6 anyway: that
assertion ran against the simulated state, and §6.6 runs against the chain.

### 5.6 Turn the perpetual alignment tithe on

**This step is the other rehearsal**, and it is here for the same reason §5.5 is: the call has never
been made on any network, and without this section the first time it is made would be on mainnet.

**What it turns on.** A graduated Uniswap-V4 pool can carry an alignment hook that takes
`hookFeeBips` — 1% here, §1.1 — of the ETH side of every swap and forwards it to that collection's
alignment vault, credited to the collection. That is the community's perpetual earnings on secondary
trading, as distinct from the one-time 19% they receive at graduation. `DeployCore` deploys the hook
factory, registers it under the `alignment_hook` component tag, and stops. The module ships with
`alignmentHookFactory == address(0)`, so **everything graduated before this step is untaxed and stays
untaxed**, and one owner call is the entire difference.

**Where it is not.** It is not in `DeploySepolia`, not in `DeployCore`, and not a flag. The owner
call is a parameter change, and by this point the owner is the Timelock — so on this network it is
proposed through the Safe and executed by governance, which is exactly the shape mainnet will have to
use. Enabling it as a deploy-time EOA write would rehearse a call mainnet cannot make.

**ORDER MATTERS, IN BOTH DIRECTIONS.**

- **After §5.2.** The showcase seed graduates one row and then reads that pool's liquidity back off a
  key it rebuilds from the module's parameters; it `require`s the hook is off, because a hooked pool
  is a different key and the seed does not guess. Enabling before the seed fails the seed.
- **After §5.5.** Ownership has moved, so this is a governed call and not a broadcast. Doing it
  before the handover is *possible* — `--sig "run()"` broadcast by the deployer does it — but then
  the governed form is never exercised, which is the thing this step exists to exercise.

```
cd contracts
export MODULE_UNIV4_DEPLOYER=<ModuleUniV4Deployer from deployments/sepolia.json>
export COMPONENT_REGISTRY=<ComponentRegistry from deployments/sepolia.json>

# Print the one call the Timelock must execute.
forge script script/EnableAlignmentTithe.s.sol --sig "printEnableBatch()" --rpc-url <sepolia-rpc>
```

It resolves the hook factory from the component registry rather than taking an address on trust, and
refuses to print anything unless the rate under the switch is non-zero and the factory binds the same
PoolManager and WETH as the module. A governance proposal is an expensive place to find out the rate
was zero.

Propose that call through the Safe, wait out `TIMELOCK_MIN_DELAY`, execute it, then read it back:

```
forge script script/EnableAlignmentTithe.s.sol --sig "verify()" --rpc-url <sepolia-rpc>
```

**Two things to know before you throw it, because neither is reversible for a pool that has already
graduated.**

1. **The rate is immutable per hook.** It is baked into the hook's init code at graduation, so
   changing `hookFeeBips` later changes only pools that graduate after the change.
2. **The in-app swap panel cannot trade a hooked pool.** `zRouter.swapV4` builds its pool key with
   `hooks: address(0)` — the router is hookless by construction — and the panel passes the module's
   *static* fee tier, so for a collection graduated after this step the app would name a pool that
   does not exist. Trading such a collection needs a router that carries the hook and the dynamic-fee
   flag in its key. That is a real limitation of this deployment and not a misconfiguration; it is why
   §6.7 observes the tithe with `cast` against the PoolManager rather than through the app.

**Turning it back off** is the same call with `address(0)`, and it is not a rollback: pools that
graduated while it was on keep their hooks and keep tithing. It stops the next graduation from
minting one.

---

---

## 6. Verify

Every check below is against the **live chain**, by address, from the record written in §5.1. A file
read is not verification: the fork rehearsal writes files of the same shape, at the same paths, under
the same chain id.

### 6.1 The preset ladder

The ladder in §1.2, read back off the deployed `LaunchManager`:

```
for i in 0 1 2; do
  cast call <LaunchManager> "getPreset(uint256)((uint256,uint256,uint256,address,bool))" $i \
    --rpc-url <sepolia-rpc>
done
```

`unitPerNFT` — the second field — must read **1000000 / 100000 / 1000**. If it reads
1000000000 / 1000000 / 1000, the address being queried is the abandoned 2026-03-26 deployment and
not this one.

### 6.2 The quoter

Two parts, and the first passing does not imply the second.

```
# a. wired: non-zero on every vault factory that takes one (Uni, ZAMM)
cast call <UniAlignmentVaultFactory>  "zQuoter()(address)" --rpc-url <sepolia-rpc>
cast call <ZAMMAlignmentVaultFactory> "zQuoter()(address)" --rpc-url <sepolia-rpc>

# b. truthful: the seed registered a route for each roster token
cast call <SepoliaRouteQuoter> "routeOf(address,address)(uint8,uint256,bool)" <vault> <token> \
  --rpc-url <sepolia-rpc>
```

The third field is `set`, and it is what a registered row is read by: every other field has a
legitimate zero — `UNI_V2` is source `0`, and a ZAMM pool may genuinely run `feeOrHook == 0` — so
`set == false` is the only reading of "no route here", and it routes that vault to its own fixed leg.

**A zero on a factory is not a configuration to fix; it is a redeploy.** The field is `immutable` on
both factories, so every vault they deploy afterwards is born without a quoter. Nor can the vaults
already standing be repointed: the Uni and ZAMM vaults do carry an `onlyOwner setZQuoter`, but their
**owner is the factory**, and no factory exposes a passthrough to it. This is the reason §5.1 says to
stop on the `cfg.zQuoter == 0` warning rather than seed on top of it.

The Uni and Aave factories are in the deployment record under `factories.UNI` and `factories.AAVE`;
the ZAMM factory is in `sepolia-venues.json`.

### 6.3 The whole configuration

```
cd contracts
forge script script/ValidateSepolia.s.sol --rpc-url <sepolia-rpc>
```

Read-only, and every check that gates `ERC404Factory.createInstance` is an assertion rather than a
log line, so a misconfigured deployment exits non-zero. It reads every address from the deployment
record, pins none, and asserts the preset ladder against `LaunchPresets` — the same statement the
deploy wrote — so §6.1 and this agree by construction rather than by two people reading a table.

### 6.4 CI, on the commit that carries the record

The §5.3 commit changes committed config, so the full suite runs against it. It must be green before
the site is built from it. `contracts-ci.yml` carries the EIP-170 gate; `app-ci.yml` carries the
bindings drift gate and the walk validator.

### 6.6 Ownership actually moved

The one check on this page whose absence is invisible: a deployment that never ran §5.5 and one that
completed it look identical from outside. Every registry answers, every factory creates, every
surface works — and one EOA still holds all of it.

```
cd contracts
TIMELOCK_ADDRESS=<timelock> forge script script/MigrateOwnership.s.sol --sig "verify()" \
  --rpc-url <sepolia-rpc>
```

Read-only. It asserts that every `SafeOwnableUUPS` and every plain-`Ownable` contract in the
migration set reads `owner() == TIMELOCK_ADDRESS`; that `MasterRegistryV1.emergencyRevoker()` is the
Timelock, because the no-delay kill switch is the one capability every `owner()` check would miss;
that the Timelock holds `PROTOCOL_ROLE` on `ERC404Factory`, which `transferOwnership` does not move;
and that `TIMELOCK_ADDRESS` has code at all, since an EOA there satisfies every other assertion while
leaving the protocol under one key.

A non-zero exit names the contract that failed, so a partial migration says which step to re-run.

### 6.7 The tithe actually moves

§5.6 turned a switch on; this is where somebody watches money cross. Nothing above it does: the
switch reads on whether or not a single wei has ever reached a vault, and a hook minted at a zero
rate, or bound to a pool nobody trades, looks identical from every read in §6.

**Only Uniswap V4 tithes.** The perpetual post-graduation swap tithe exists on the Uni-V4 venue and
on no other venue this protocol graduates to. A collection that graduates to **ZAMM**, or to any
alternative venue, gets the one-time cut at graduation and **nothing** on the trading that follows —
those pools carry no hook, and that is a decision rather than a gap
(`docs/phases/vault-flavors.md`, "Per-venue economics"; `ZAMMLiquidityDeployerModule`'s own NatSpec
says it again at the code). Extending the tithe to the alternative venues was considered and
rejected: seeding depth away from Uniswap is itself the greater alignment service, so taxing it would
discourage the more valuable action. **Do not check this section against a non-Uniswap graduation,
and do not let a creator on one of those venues believe the tithe applies to them** — for them the
alignment vault is funded at graduation and by contributions, and never by their traders.

**Graduate something after §5.6.** Only pools graduated after the switch carry a hook, and the
showcase's graduated row was graduated by the seed, before it. The seed deliberately leaves a READY
row uncrossed for a visitor to graduate — that is the one to use, or launch a fresh collection.

**1. Find the hook.** The graduation transaction emits `AlignmentHookDeployed(hook, vault, benefactor,
hookFeeBips, lpFeeRate)` from the tithe hook factory — the `ALIGNMENT_HOOK` component, the address
§5.6 pointed the module at. The first indexed topic is the hook.

```
cast logs --from-block <graduation block> --to-block <graduation block> \
  --address <hook factory> \
  "AlignmentHookDeployed(address,address,address,uint256,uint24)" --rpc-url <sepolia-rpc>
```

**2. Read the vault before the swap.** The vault is the collection's alignment vault; the benefactor
credited is the collection's instance address.

```
cast call <vault> "totalPendingETH()(uint256)"               --rpc-url <sepolia-rpc>
cast call <vault> "benefactorTotalETH(address)(uint256)" <instance> --rpc-url <sepolia-rpc>
cast call <hook>  "queuedFees()(uint256)"                    --rpc-url <sepolia-rpc>
```

**3. Swap at least 0.1 ETH, and swap it through the PoolManager.** Two traps here, and both look like
the tithe is broken when it is working:

- **Size.** `UniAlignmentVault.MIN_CONTRIBUTION` is 0.001 ETH, and the hook does not revert a swap
  whose take the vault rejects — it adds it to its own `queuedFees` and emits `AlignmentFeeQueued`
  instead of `AlignmentFeeCollected`. At 1%, 0.1 ETH is the smallest swap whose tithe lands in the
  vault in its own transaction. A 0.01 ETH test swap works, tithes, and credits the vault nothing
  visible. Once `queuedFees` clears 0.001 ETH, anyone may call `flushQueuedFees()` on the hook to
  push it through.
- **Route.** The pool is a *dynamic-fee* pool whose key names the hook, and `zRouter.swapV4` — what
  the app's trading panel uses — builds its key with `hooks: address(0)` and the module's static fee.
  It cannot reach this pool. Swap against the V4 PoolManager directly, with
  `fee = 0x800000` (the dynamic-fee flag), `tickSpacing = 60` and `hooks = <hook>`.
- Buy direction, or an exact-input sell, is what you want. An **exact-output ETH-out sell is untaxed
  by design** — it is not a frontend path — so it is the one shape that legitimately moves nothing.

**4. Read it back.** `totalPendingETH` and `benefactorTotalETH(<instance>)` each rise by 1% of the ETH
leg, and the swap transaction carries two logs that name it outright:

| event | emitted by | means |
| --- | --- | --- |
| `AlignmentFeeCollected(uint256 ethAmount, address indexed benefactor)` | the hook | the tithe reached the vault |
| `ContributionReceived(address indexed benefactor, uint256 amount)` | the vault | and was credited to the collection |
| `AlignmentFeeQueued(uint256 ethAmount, address indexed benefactor)` | the hook | the vault declined it — almost always the 0.001 ETH minimum; it is held, not lost |

```
cast receipt <swap tx> --rpc-url <sepolia-rpc>
cast call <vault> "totalPendingETH()(uint256)" --rpc-url <sepolia-rpc>   # up by 1% of the ETH leg
```

A rise here is the whole claim the alignment story makes about secondary trading, observed once on a
real network. The mechanism behind it is pinned by
`contracts/test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol` (all four swap shapes, the queue and
the flush) and the deployed configuration by
`contracts/test/script/SepoliaAlignmentTithe.t.sol`; this step is the one that runs on the chain.

### 6.5 The walk, live

The same numbered walk from §4, followed against the public testnet, in a browser, with a wallet.
This is the acceptance test for the deployment as a whole, and it is the last step before anyone
outside is pointed at it.

---

## 7. Publish the app

Full detail in `app/scripts/ipfs-dist/RUNBOOK.md`. The deployment-specific parts:

### 7.1 Build

```
cd app
VITE_CHAIN_ID=11155111 pnpm build        # ms2.fun target
VITE_CHAIN_ID=11155111 pnpm build:ipfs   # noesis.gwei.domains target, prints the release CID
```

`VITE_CHAIN_ID` is what selects the chain, and it is needed on **both** builds: unset, the bundle
falls back to the local anvil deployment. It is read from the environment the bundle is built with,
and an id with no deployment config throws at app load rather than at build — so an omission here
surfaces as a dead site, not as a failed build.

Build from the commit that carries the §5.3 address record. Both targets stamp their commit into the
footer, so the running site names the build a bug report was found on. Record the CID next to the
commit.

**The app and `LiquidityDeployerModule` ship together, and the direction that breaks is the app
going first.** The module is a plain non-upgradeable `Ownable` singleton, so any change to its
storage — `graduationHook`, which records the alignment hook a graduation minted, is one — is a new
module address and a fresh broadcast, not a patch to the live one. The app resolves a graduated
Uni-V4 collection's pool key by calling the module the instance names, so a bundle that expects a
getter the deployed module does not declare reads the revert as "cannot say" and renders **every**
graduated Uni-V4 collection as an unresolved venue. The site is up, the collections load, and only
their trade panel is gone — which is why this is worth a line here rather than being left to show
up in §6.5. Publish the bundle only after the module it reads from is the one in the §5.3 record.

### 7.2 Pin — **Pinata**

The pin host is **Pinata**, and rth holds the account. This supersedes the self-pinning note in
`app/scripts/ipfs-dist/RUNBOOK.md` §2: standing up and operating our own node is not a prerequisite
for this deployment.

No credential, endpoint or account identifier belonging to the pinning account appears anywhere in
this repository, and none should. The packer reaches no network; it produces `app/dist/ipfs.car`
and a root CID, and pinning is uploading that CAR to the account.

Whatever the upload path, **the two checks either side of it do not change**:

```
# the root the pinning service reports must equal the CID the packer printed
# then, before touching the chain:
curl -sI "https://ipfs.io/ipfs/<cid>/"      # an INDEPENDENT public gateway can fetch it
```

The second is the one not to skip. The gwei gateway resolves the on-chain record and proxies the CID
from public gateways, so content only the pinning service can serve makes a dead site the moment the
record points at it.

### 7.3 Point the name

This is rth's wallet transaction, from the address that holds the name. Set the `contenthash` record
to the CID, then load `https://noesis.gwei.domains/`, confirm the footer shows the expected commit,
and walk one deep link (`#/collections`).

---

## 8. What cannot be taken back

Stated plainly, because everything else in this runbook is retryable and these are not.

- **The salt set.** It has one broadcast in it. A deploy that fails partway consumes the salts it
  reached; the remainder of that protocol cannot be stood up on the intended addresses, and the next
  attempt needs a re-mined set and a new address table.
- **The seed's names.** Registered once. There is no reseed of an existing deployment.
- **A preset at create.** Every collection launched on this deployment carries the rung it was
  created under, permanently. This is why §6.1 runs before anyone is invited.
- **Immutable factory fields.** `zQuoter`, the pool tier, the fee — set at deploy, no setters.
- **A graduated pool's alignment hook.** The tithe rate is baked into the hook's init code at
  graduation. Turning the switch off (§5.6) stops the next graduation from minting a hook; it does
  not remove or retune the hook on a pool that already has one.
- **The published CID.** Repointing the name is a new transaction, but the old CID stays retrievable
  for as long as anyone pins it.

---

## 9. Out of scope here

- **The security review.** Its scope is a separate sign-off and is not a step in this sequence.
- **Announcement and tester recruitment.** Downstream of §6.5.
- **Mainnet.** `script/DeployMainnet.s.sol` is a different script with a different config, a
  canonical quoter to point at, and no showcase seed.
- **`cfg.safe`, which is not governance and is not a step here.** Named because the field invites
  exactly one mistake. `DeployCore.sol` assigns `cfg.safe`, or a `MockSafe` when it is unset, into a
  public `safe` variable that nothing in `src/` or `script/` ever reads; the only consumer in the
  repo is a test asserting the variable is non-zero. `DeploySepolia` leaves it unset and
  `DeployMainnet` carries `// TODO: real Safe address`, so an operator who wires a real Safe there
  will have installed nothing and have no error to tell them. Governance is `TIMELOCK_ADDRESS` plus
  the §5.5 handover, and the Safe belongs in `SAFE_ADDRESS` at 5.5.2. The disposition of the dead
  field is open (noesis/testnet-deploy clause 49) and does not block this deploy.
