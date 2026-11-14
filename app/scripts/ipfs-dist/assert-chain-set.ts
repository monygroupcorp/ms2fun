/**
 * `build:ipfs` guard, run before the vite build: refuses to package a bundle whose `VITE_CHAIN_ID`
 * is unset, unknown, or resolves to a placeholder (un-deployed) config.
 *
 * This is the exact failure noesis.gwei.domains shipped: a release build run without
 * `VITE_CHAIN_ID` set resolves silently to the local anvil fork, gets pinned, and every visitor's
 * wallet is then prompted to add "Anvil Fork" as a custom network. `publish:preflight` already
 * catches this, but as a separate command a release walk can skip; this runs the same check
 * unconditionally, inside the one script that actually produces the bundle that gets pinned.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { assertPublishable, CONFIG_BY_CHAIN_ID, resolvePublishChainId } from '../assert-publishable'

const appDir = resolve(import.meta.dirname, '..', '..')

const chainId = resolvePublishChainId(process.env.VITE_CHAIN_ID)
if (typeof chainId === 'string') {
  console.error(`ipfs build refused: ${chainId}`)
  process.exit(1)
}

const configPath = resolve(appDir, CONFIG_BY_CHAIN_ID[chainId])
const deployment = JSON.parse(readFileSync(configPath, 'utf-8'))

// The requested chain is the only allowed id here too — see assert-publishable.ts.
const reasons = assertPublishable(deployment, { allowChainIds: [chainId] })
if (reasons.length > 0) {
  console.error(`ipfs build refused (chain ${chainId}, ${configPath}):`)
  for (const reason of reasons) {
    console.error(`  - ${reason}`)
  }
  process.exit(1)
}
