import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. Test tags:
 * - untagged: fork-independent (shell/navigation).
 * - `@fork`: needs the local anvil fork on :8545 with the platform contracts deployed. These read
 *   LOCALLY-DEPLOYED contracts (MasterRegistry, QueryAggregator), so any fork works.
 * - `@archive`: additionally reads FORKED-MAINNET state (the EXEC404 fossil). Requires an
 *   ARCHIVE-capable fork RPC — a non-archive public RPC 403s on cold mainnet storage as the fork
 *   ages (see docs/HUMAN_GATES.md G-A). Excluded by default; opt in with `--grep @archive`.
 */
export default defineConfig({
  testDir: './e2e',
  grepInvert: /@archive/,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
