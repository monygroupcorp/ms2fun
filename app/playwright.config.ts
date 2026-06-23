import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. Test tags:
 * - untagged: fork-independent (shell/navigation).
 * - `@fork`: needs the local anvil fork on :8545 with the platform contracts deployed. These read
 *   LOCALLY-DEPLOYED contracts (MasterRegistry, QueryAggregator), so any fork works.
 * - `@archive`: additionally reads FORKED-MAINNET state (the EXEC404 fossil + its V2 pool). Requires
 *   an ARCHIVE-capable fork RPC — a non-archive public RPC 403s on cold mainnet storage as the fork
 *   ages (see docs/HUMAN_GATES.md). Run it with `pnpm test:e2e:archive`; the default `pnpm test:e2e`
 *   excludes it via `--grep-invert @archive` (set in package.json so opt-in isn't blocked here).
 */
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
