# Standing up Algebra Integral 1.2.1 on a test network

Sepolia has no Algebra deployment, so `contracts/script/DeploySepolia.s.sol` leaves the Cypher rail
unwired. This directory stands the rail up from the **exact mainnet bytecode** rather than
rebuilding it from source: the published set spans three different optimizer profiles, so no single
build profile reproduces it, and replaying the creation inputs makes the result byte-checkable.

Three tools, run in order:

| step | tool        | who runs it                     | writes                    |
| ---- | ----------- | ------------------------------- | ------------------------- |
| 1    | `fetch.ts`  | anyone                          | `artifacts/` (gitignored) |
| 2    | `deploy.ts` | the operator, with a funded key | `artifacts/deployments/`  |
| 3    | `verify.ts` | anyone                          | nothing — read-only       |

## What is and is not in this repository

Committed: these tools, this runbook, and the gitignore entry. Everything the fetch tool pulls —
bytecode, ABIs, constructor arguments, deployment records — stays under `artifacts/`, which is
gitignored. The repository carries third-party **addresses** and its own MIT interfaces
(`contracts/src/interfaces/algebra/IAlgebra.sol`), exactly as it already does for mainnet, and no
vendored third-party source or artifacts. Re-run step 1 to reproduce the inputs at any time.

## 1. Fetch

```sh
cd app
pnpm exec tsx scripts/sepolia-algebra/fetch.ts
# optional: --explorer <blockscout url> --rpc <mainnet rpc>
```

Pulls, for each contract: the creation input, the runtime code, the constructor arguments, the
compiler profile, and any linked-library metadata. The runtime code is taken from the explorer and
independently from `eth_getCode`, and the two must agree.

The set is eight contracts, not six. Six are the published Algebra/Cypher set. The token-descriptor
proxy needs its implementation, and that implementation is linked against an `NFTDescriptor`
library; both are resolved at fetch time (proxy ERC-1967 slot, then linked-library metadata) and
both are deployed, because a transparent proxy constructor reverts when there is no code at the
implementation address — the proxy cannot be stood up alone.

The tool also records the factory configuration a standup has to reproduce: default plugin factory,
default fee, default tick spacing, default community fee, vault factory, owner, and the pool
init-code hash.

## 2. Deploy

```sh
cd app
PRIVATE_KEY=0x... pnpm exec tsx scripts/sepolia-algebra/deploy.ts \
  --rpc <target rpc> \
  --wnative <wrapped native token on the target chain> \
  [--proxy-admin <address>] \
  [--vault-factory <address>]
```

The key is read from the environment, never from the command line (`--private-key-env <NAME>`
changes which variable). The tool does not pick a network: it deploys to whatever `--rpc` points at.

`--wnative` is required and has no default. Which wrapped-native token the Sepolia showcase uses is
an open decision, so the tooling stays parameterized on it.

What the runner does:

- Predicts all eight addresses up front from the deployer's nonce (every contract is a plain CREATE
  from one sequential account), then asserts each receipt against its prediction and refuses to
  continue if the nonce moves under the run.
- Broadcasts the fetched creation input unchanged except for address substitution: the mainnet
  wrapped-native token becomes `--wnative`, and every cross-reference inside the set (factory, pool
  deployer, descriptor proxy, descriptor implementation, linked library, proxy admin) becomes the
  corresponding address on the target chain. Substitution counts are printed per contract.
- Wires the factory afterwards: `setDefaultPluginFactory`, then any of `setDefaultFee`,
  `setDefaultTickspacing`, `setDefaultCommunityFee` whose fresh value differs from mainnet.
- Writes `artifacts/deployments/<chainId>-<timestamp>.json`: addresses, transaction hashes, the
  keccak of each creation input actually broadcast, the wiring calls, and any deviations.

### Deviations it will report

- **`vaultFactory` is not wired.** Mainnet points the factory at a vault factory that sits outside
  the published set, so the runner does not deploy one. Pass `--vault-factory <address>` to wire an
  existing one.
- **`defaultCommunityFee` stays 0.** The factory rejects a non-zero community fee while no vault
  factory is wired. With `--vault-factory` supplied, the mainnet value is applied.

Both are printed at the end of the run and stored in the deployment record, and the verifier prints
them again — a standup that silently differs from mainnet is the thing this tooling exists to
prevent.

## 3. Verify

```sh
cd app
pnpm exec tsx scripts/sepolia-algebra/verify.ts --rpc <target rpc> [--deployment <path>]
```

Read-only. For each contract it fetches the runtime code at the deployed address and byte-compares
it against the mainnet runtime, masking only the ranges that are allowed to differ. Exit 0 =
byte-identical outside the masked ranges, which are printed. Exit 1 = a hex diff summary.

The masks are derived, not hand-written:

- Solidity carries the runtime code verbatim inside the creation input with every immutable slot
  left as a `PUSH32` with a zero operand. Locating that window gives the immutable slots exactly.
  The window is accepted only if every byte that differs from the deployed runtime is zero in the
  template, so a template that does not correspond to the code fails rather than masking a real
  difference.
- A `PUSH32` zero operand is also how a plain zero constant compiles, so slots where mainnet holds
  zero are left **unmasked** — the standup has to hold zero there too, and a code constant cannot
  become a blind spot.
- Addresses the runner substituted are additionally located by searching the mainnet runtime for
  the mainnet address, which covers linked-library references that are not immutables.

Where a masked range holds one of the substituted addresses on mainnet, the check is positive: the
deployment must hold the substituted address, not merely something different. Ranges that cannot be
pinned that way — a cached chain id, a cached domain separator — are printed as `unconstrained` so
the strength of the claim is visible rather than implied.

## 4. Wire the addresses in

Once a standup is verified, `contracts/script/DeploySepolia.s.sol:36-38` takes the deployed
addresses:

```solidity
cfg.cypherPositionManager = <positionManager>;
cfg.cypherRouter = <swapRouter>;
cfg.cypherAlgebraFactory = <algebraFactory>;
```

That edit is deliberately not part of this change: the addresses do not exist until the runner has
been executed against the target network.
