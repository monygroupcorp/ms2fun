# app

The noesis frontend: a static single-page app that talks to the contracts directly from the browser.

There is no backend. Every read resolves on-chain — see
`docs/decisions/0010-serverless-read-path-performance.md` for why that constraint exists and what it
costs, and `docs/ARCHITECTURE.md` for how the pieces fit together.

Stack: React 19, Vite 8, TypeScript, wagmi 3 + viem 2, wouter for routing, `vite-plugin-pwa` for
offline caching and install.

## Requirements

- Node 22 (`.nvmrc`)
- pnpm 10 (the version CI installs; the lockfile is `app/pnpm-lock.yaml`)

```sh
pnpm install
```

## Commands

Run from `app/`.

| command                                                     | what it does                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                                                  | Vite dev server                                                            |
| `pnpm build`                                                | `tsc -b` then `vite build` into `dist/`                                    |
| `pnpm preview`                                              | serve a built `dist/`                                                      |
| `pnpm typecheck`                                            | `tsc -b`                                                                   |
| `pnpm lint`                                                 | ESLint over the package, stylelint over `src/**/*.css`                     |
| `pnpm format` / `pnpm format:check`                         | Prettier write / check                                                     |
| `pnpm test` / `pnpm test:watch`                             | Vitest, single run / watch                                                 |
| `pnpm test:e2e`                                             | Playwright, excluding `@archive`                                           |
| `pnpm test:e2e:archive`                                     | only the `@archive` specs                                                  |
| `pnpm wagmi:generate`                                       | regenerate the contract bindings in `src/generated/`                       |
| `pnpm chain:fork` / `pnpm chain:deploy` / `pnpm chain:stop` | local dev chain: start an anvil fork, deploy the platform onto it, stop it |
| `pnpm tithe:report`                                         | per-target alignment contribution report, read off `MasterRegistry`        |

## End-to-end tests

`e2e/` is tagged in three tiers, described in full at the top of `playwright.config.ts`:

- **untagged** — fork-independent, shell and navigation only.
- **`@fork`** — needs the local anvil fork on `:8545` with the platform contracts deployed. Start it
  with `pnpm chain:fork && pnpm chain:deploy`.
- **`@archive`** — additionally reads forked-mainnet state, so it needs an archive-capable fork RPC.
  Excluded from `pnpm test:e2e`; run it with `pnpm test:e2e:archive`.

CI runs the unit suite and the build. It does not stand up a fork, so `@fork` and `@archive` are
local.
