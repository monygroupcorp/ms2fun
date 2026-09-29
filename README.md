# noesis

**An onchain alignment launchpad.** Deploy a collection and it is bound to the work that inspired
it: every launch pays a fixed share of what it sells to the community it draws from, taken inside
the contract that moves the money.

**Live on Sepolia testnet → [noesis.gwei.domains](https://noesis.gwei.domains/)**

---

## The idea

Derivative work is the engine of the ecosystems it comes from, and it has never paid them anything.
A royalty written into NFT metadata does not change that — it is a request a marketplace is free to
decline, and most now do. It moves no money on its own.

So noesis does not ask. It takes the share where it cannot be declined — at **settlement**, inside
the transaction that is already moving the funds, out of the sale itself rather than as a fee added
on top of it.

```
1%   protocol
19%  the aligned community
80%  the artist
```

`RevenueSplitLib.split` hardcodes that ratio with **no setter**, and the vaults' own
`TARGET_CUT_BPS` is `constant` too. Nobody can change what a settlement pays out — not a creator,
not a deployer, not the protocol owner.

What the owner *can* do is curate: repoint a target's payout address, or retire a target. The ratio
is the promise; the payee is a listing you can read and leave over. If a target is retired after you
bind to it, the share taken at settlement is **returned to you**, never to the protocol.

The capital is not custodial to us. It lives in the vault contract.

## What you can launch

| standard | shape | where the 19% is taken |
|---|---|---|
| **ERC-404** | a bonding curve that graduates into a real pool and trades | at **graduation**, on the whole raise, before a wei reaches the pool — the curve itself is fee-free |
| **ERC-1155** | open or capped editions at a price you set | on every **withdrawal** of mint proceeds; nothing after that |
| **ERC-721** | one piece, one auction, your reserve | at **settlement** of each auction, on the winning bid, after your reserve returns to you |

A graduated ERC-404 pool on Uniswap V4 can additionally carry an **alignment hook** that taxes the
ETH side of every swap — buys and sells alike — into the vault, so the tithe does not stop when the
mint does. That is a protocol-level switch, not a creator setting. A pool on ZAMM graduates
untaxed, where the graduation share is the whole of it.

Alongside the standards: free-mint allocation, merkle allowlists, onchain token tiers, a metadata
overlay so you bring your own resolver (or launch with no art and add it later), an onchain message
board, profiles, and curations.

## On secondary royalties

**There are none, on any standard, and that is a position rather than a gap.** EIP-2981 is a
read-only lookup that a marketplace may honour or ignore; building one would let this project claim
a protection it cannot enforce. The perpetual earn, where a collection has one, is a pool charging
its own traders — not a marketplace being asked nicely.

## Status

Deployed to **Sepolia** (chain `11155111`) — the contract addresses are in
[`app/src/config/sepolia-deployment.json`](app/src/config/sepolia-deployment.json).

This is a testnet. Use testnet ETH; do not send anything real to it. It is up so that people find
where it is wrong before it holds real money.

## Stack

- **`app/`** — React 19 + TypeScript (strict) + Vite; **wagmi** + **viem** for all chain access,
  `@tanstack/react-query` as the read cache, `wouter` for routing, CSS Modules over CSS-variable
  design tokens (see [`docs/DESIGN_SYSTEM_V2.md`](docs/DESIGN_SYSTEM_V2.md) — "Gallery Brutalism").
  pnpm; Vitest + Playwright.
- **`contracts/`** — Solidity via Foundry; Solady (Ownable, UUPS), Uniswap V4, DN404. See
  [`contracts/README.md`](contracts/README.md) for the contract-side architecture and deploy flow.
- **`services/art/`** — an optional Cloudflare Worker that caches collection art. The app works
  without it; that is the point.

## Quickstart

From `app/`:

```bash
pnpm install
pnpm chain:fork        # a local anvil mainnet fork
pnpm chain:deploy      # contracts onto the fork
pnpm dev
```

Other scripts (see `app/package.json`): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`,
`pnpm build`, `pnpm chain:stop`.

## Layout

```
/app          Frontend — the only place new app code is written
/contracts    Foundry project — contracts, tests, deploy scripts
/services     Optional off-chain services (art caching)
/legacy       Retired original frontend — quarantined, never imported from app/
/docs         Architecture, design system, decisions (ADRs), reference specs
```

## Reporting a problem

Found a bug, or something in the app that does not match what the contracts do?
**DM [@miladystation](https://x.com/miladystation) on x.com.**

## License

VPL
