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

The set is ten contracts, not six.

Six are the published Algebra/Cypher set. The token-descriptor proxy needs its implementation, and
that implementation is linked against an `NFTDescriptor` library; both are resolved at fetch time
(proxy ERC-1967 slot, then linked-library metadata) and both are deployed, because a transparent
proxy constructor reverts when there is no code at the implementation address — the proxy cannot be
stood up alone.

The remaining two are the community-fee pair, and they are here because of the fee regime rather
than because of the rail. Mainnet runs a non-zero default community fee, and `AlgebraFactory.
setDefaultCommunityFee` reverts while `vaultFactory` is the zero address, so a standup that omits
the vault factory cannot carry the mainnet fee at all. `AlgebraVaultFactoryStub` is constructed
against `AlgebraCommunityVault`, and the vault against the factory plus a fee-manager account —
that is the whole closure, and `fetch.ts` asserts both links so a change in the mainnet topology
surfaces as a fetch failure rather than a silently narrower standup.

The tool also records the configuration a standup has to reproduce: on the factory, the default
plugin factory, fee, tick spacing, community fee, vault factory, owner and pool init-code hash; on
the vault, the Algebra fee share and the accounts holding the fee-manager and receiver roles.

## 2. Deploy

```sh
cd app
PRIVATE_KEY=0x... pnpm exec tsx scripts/sepolia-algebra/deploy.ts \
  --rpc <target rpc> \
  --wnative <wrapped native token on the target chain> \
  [--proxy-admin <address>] \
  [--algebra-fee-manager <address>] \
  [--community-fee-receiver <address>] \
  [--algebra-fee-receiver <address>]
```

The key is read from the environment, never from the command line (`--private-key-env <NAME>`
changes which variable). The tool does not pick a network: it deploys to whatever `--rpc` points at.

`--wnative` is required and has no default. Which wrapped-native token the Sepolia showcase uses is
an open decision, so the tooling stays parameterized on it.

What the runner does:

- Predicts all ten addresses up front from the deployer's nonce (every contract is a plain CREATE
  from one sequential account), then asserts each receipt against its prediction and refuses to
  continue if the nonce moves under the run.
- Broadcasts the fetched creation input unchanged except for address substitution: the mainnet
  wrapped-native token becomes `--wnative`, and every cross-reference inside the set (factory, pool
  deployer, descriptor proxy, descriptor implementation, linked library, proxy admin, community
  vault, vault factory) becomes the corresponding address on the target chain. Substitution counts
  are printed per contract.
- Wires the factory afterwards: `setDefaultPluginFactory`, `setVaultFactory` at the deployed stub,
  then any of `setDefaultFee`, `setDefaultTickspacing`, `setDefaultCommunityFee` whose fresh value
  differs from mainnet. The vault factory is pointed at before the community fee is set, because
  the factory rejects a non-zero community fee while `vaultFactory` is unset.
- Wires the community vault: `changeCommunityFeeReceiver`, `changeAlgebraFeeReceiver`, then the
  two-step `proposeAlgebraFeeChange` / `acceptAlgebraFeeChangeProposal` that brings the Algebra fee
  share to the mainnet value.
- Writes `artifacts/deployments/<chainId>-<timestamp>.json`: addresses, transaction hashes, the
  keccak of each creation input actually broadcast, the operator role addresses, the wiring calls,
  and any deviations.

### The vault's three roles

The community vault has three role accounts, and all three are **operator addresses defaulting to
the deployer**. Mainnet's are third-party accounts with no test-network counterpart, so a standup
reproduces the fee MECHANISM — a wired vault factory, the mainnet default community fee, the
mainnet Algebra fee share, and the same role separation — rather than the mainnet accounts. The
addresses actually used are printed at the start of the run and recorded in the deployment record.

Two of them are load-bearing for the runner:

- `--algebra-fee-manager` owns `changeAlgebraFeeReceiver` and `proposeAlgebraFeeChange`. Handing it
  to an account the runner does not hold is supported, and the calls that role owns are then
  recorded as deviations instead of attempted; finish them from that account afterwards.
- `--proxy-admin` and `--algebra-fee-manager` are separate roles here that happen to be held by one
  account on mainnet. Address substitution is therefore scoped per contract — the proxy admin is
  rewritten only in the descriptor proxy's creation input and the fee manager only in the vault's —
  so passing different addresses gives each role the address you asked for.

### Deviations it will report

- **`algebraFeeReceiver` is unset** and **`algebraFee` stays 0**, when `--algebra-fee-manager`
  points at an account the runner does not hold. Both calls belong to that role.
- **`vaultFactory` is left unset**, only if mainnet itself has none wired.

Deviations are printed at the end of the run and stored in the deployment record, and the verifier
prints them again — a standup that silently differs from mainnet is the thing this tooling exists
to prevent.

### Gas

A full ten-contract standup on a local node costs roughly **28.1M gas** for the creations and
**0.29M** for the eleven wiring calls, ~28.4M in total. The two additions are cheap relative to the
set: the vault is ~1.03M and the stub ~0.11M. The three largest creations are the pool deployer,
the plugin factory and the position manager, at ~5.3M, ~5.0M and ~4.9M.

## 3. Verify

```sh
cd app
pnpm exec tsx scripts/sepolia-algebra/verify.ts --rpc <target rpc> [--deployment <path>]
```

Read-only. For each contract it fetches the runtime code at the deployed address and byte-compares
it against the mainnet runtime, masking only the ranges that are allowed to differ. It then asserts
the fee regime, which lives in storage and so is invisible to a byte comparison. Exit 0 = both hold.
Exit 1 = a hex diff summary and/or the failing configuration reads.

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

The fee-regime assertions, all against values read from mainnet at fetch time rather than numbers
written into this repository:

- the factory points at the deployed vault factory, and it is not the zero address;
- the stub points back at the deployed community vault;
- `factory.defaultCommunityFee()` equals the mainnet value;
- `vault.algebraFee()` equals the mainnet value.

The three vault role holders are printed and compared against what the run requested, but not
asserted against mainnet — they are operator addresses by design.

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
