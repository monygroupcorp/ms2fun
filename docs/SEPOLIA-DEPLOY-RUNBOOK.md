# Sepolia testnet deployment — runbook

The order of operations for putting the protocol on the Sepolia public testnet, and the parameters
it will be put there with. One document, written to be followed top to bottom on the day.

It is a **sequencing** document. Each step it names has its own reference already in this repo, and
this runbook links to it rather than restating it:

| step               | reference                                  |
| ------------------ | ------------------------------------------ |
| fork rehearsal     | `app/scripts/dev-chain/SEPOLIA-CHANNEL.md` |
| the showcase seed  | `app/scripts/sepolia-seed/README.md`       |
| the Cypher rail    | `app/scripts/sepolia-algebra/RUNBOOK.md`   |
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
| deploy-time targets    | none — the roster is minted by the seed      |

Two peripherals are **self-deployed** rather than pointed at something already on the chain, and
both are deliberate: neither pre-existing Sepolia zRouter is this repo's router (one predates
`swapVZ`, the other binds the mainnet V4 PoolManager), and Sepolia has no canonical quoter at all.
The reasoning is written out at the `cfg.zrouter` and `cfg.zQuoter` comments in the deploy script.

Three addresses are **supplied by environment**, because they do not exist until the Cypher rail has
been stood up and they differ between a rehearsal and the live chain:

```
SEPOLIA_CYPHER_POSITION_MANAGER
SEPOLIA_CYPHER_ROUTER
SEPOLIA_CYPHER_ALGEBRA_FACTORY
```

All three unset is a valid shape — `DeployCore` reads it as "this network has no Cypher rail" and
leaves the family unwired, rather than reusing mainnet Algebra addresses. **For this deployment they
are set**, from the standup in `app/scripts/sepolia-algebra/`; a Sepolia showcase without the Cypher
venue is a fourth of the alignment story missing.

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

The rehearsal runs the same three tools in the same order the live broadcast will, none of them
written for the fork: the Algebra standup, `DeploySepolia`, and both phases of the showcase seed.

```
cd app
pnpm chain:fork:sepolia      # anvil, :8546, forked chain id 11155111, --auto-impersonate
pnpm chain:deploy:sepolia    # Algebra standup -> DeploySepolia -> seed phase 1 -> phase 2
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

Stand the Cypher rail up first (`app/scripts/sepolia-algebra/RUNBOOK.md`), keep its three periphery
addresses, and pass them in the environment.

```
cd contracts
SEPOLIA_CYPHER_POSITION_MANAGER=<addr> \
SEPOLIA_CYPHER_ROUTER=<addr> \
SEPOLIA_CYPHER_ALGEBRA_FACTORY=<addr> \
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
- `contracts/deployments/sepolia-venues.json` — the ZAMM and Cypher vault factories plus the venue
  addresses, which the seed needs and the core record does not carry.

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
# a. wired: non-zero on every vault factory that takes one (Uni, ZAMM, Cypher)
cast call <UniAlignmentVaultFactory>    "zQuoter()(address)" --rpc-url <sepolia-rpc>
cast call <ZAMMAlignmentVaultFactory>   "zQuoter()(address)" --rpc-url <sepolia-rpc>
cast call <CypherAlignmentVaultFactory> "zQuoter()(address)" --rpc-url <sepolia-rpc>

# b. truthful: the seed registered a route for each roster token
cast call <SepoliaRouteQuoter> "routeOf(address,address)(uint8,uint256,bool)" <vault> <token> \
  --rpc-url <sepolia-rpc>
```

The third field is `set`, and it is what a registered row is read by: every other field has a
legitimate zero — `UNI_V2` is source `0`, and a ZAMM pool may genuinely run `feeOrHook == 0` — so
`set == false` is the only reading of "no route here", and it routes that vault to its own fixed leg.

**A zero on a factory is not a configuration to fix; it is a redeploy.** The field is `immutable` on
all three factories, so every vault they deploy afterwards is born without a quoter. Nor can the
vaults already standing be repointed: the Uni and ZAMM vaults do carry an `onlyOwner setZQuoter`, but
their **owner is the factory**, and no factory exposes a passthrough to it — and the Cypher vault
takes its quoter in the constructor and has no setter at all. This is the reason §5.1 says to stop on
the `cfg.zQuoter == 0` warning rather than seed on top of it.

The Uni and Aave factories are in the deployment record under `factories.UNI` and `factories.AAVE`;
the ZAMM and Cypher factories are in `sepolia-venues.json`.

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
- **The published CID.** Repointing the name is a new transaction, but the old CID stays retrievable
  for as long as anyone pins it.

---

## 9. Out of scope here

- **Standing up the Cypher rail.** `app/scripts/sepolia-algebra/RUNBOOK.md` is its runbook; this one
  consumes its three output addresses.
- **The security review.** Its scope is a separate sign-off and is not a step in this sequence.
- **Announcement and tester recruitment.** Downstream of §6.5.
- **Mainnet.** `script/DeployMainnet.s.sol` is a different script with a different config, a
  canonical quoter to point at, and no showcase seed.
