import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. The `@fork` test (G8) requires the local anvil fork running at localhost:8545
 * with the platform contracts deployed; the shell-loads test is fork-independent.
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
