# ms2.fun

An onchain alignment launchpad. Artists create projects (ERC404 bonding curves, ERC1155 editions,
ERC721 auctions) bound to an alignment vault; fees split **1% protocol treasury / 19% alignment
vault / 80% artist**. The alignment vault converts its share into the aligned community's token and
deposits it as liquidity (or, for the Yield vault family, into an Aave endowment), creating durable
buying pressure for the community the project is built around.

This repo is a monorepo rebuild in progress. `app/` is the live frontend under active development;
`legacy/` is the retired original frontend, quarantined and never imported from `app/`.

## Stack

- **Frontend (`app/`):** React 19 + TypeScript (strict) + Vite, **wagmi** + **viem** for all chain
  access, `@tanstack/react-query` as the read-cache layer, `wouter` for routing, CSS Modules with
  CSS-variable design tokens (see `docs/DESIGN_SYSTEM_V2.md` — "Gallery Brutalism"). Package manager
  is **pnpm**. Tests via Vitest + Playwright.
- **Contracts (`contracts/`):** Solidity (Foundry), Solady (Ownable, UUPS), Uniswap V4, DN404. See
  `contracts/README.md` for the contract-side architecture and deploy flow.

## Quickstart

From `app/`:

```bash
pnpm install
pnpm chain:fork      # start a local anvil mainnet fork
pnpm chain:deploy     # deploy contracts to the fork
pnpm dev              # start the frontend dev server
```

Other useful scripts (see `app/package.json` for the full list): `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm chain:stop`.

## Layout

```
/app          Frontend — React 19 + TS + Vite + wagmi/viem (the only place new app code is written)
/contracts    Foundry project — Solidity contracts, tests, deploy scripts
/legacy       Retired original frontend — quarantined, never imported from app/
/docs         Architecture, design system, phase plans, decisions
```

## Status

For current development status, what's shipped, and what's next, see
[`docs/phases/PROJECT_STATUS.md`](./docs/phases/PROJECT_STATUS.md).

## License

VPL
