/**
 * Publish preflight: refuses to let a build carrying a placeholder deployment config reach a
 * publish workflow.
 *
 * A deployment config is a build-time static, so `pnpm build` succeeds whatever it holds — a build
 * of a committed placeholder is indistinguishable, from `pnpm build`'s exit code alone, from a build
 * of a real deployment. This script is the loud check a publish step runs before shipping an
 * artifact anywhere: it does not change what `build` accepts, only what a human or CI decides to
 * publish.
 *
 * WHICH config it checks is the whole question, because the app carries one per chain and
 * `VITE_CHAIN_ID` is what selects between them at build time. This reads the same variable, so the
 * config it judges is the config the bundle was built against. Unset is itself a refusal: an unset
 * `VITE_CHAIN_ID` falls back to the local anvil deployment, which is the placeholder publish this
 * script exists to stop.
 *
 * `assertPublishable` is a pure function so it can be unit-tested without touching the filesystem;
 * the CLI below is the thin wrapper that reads the real config and exits non-zero on any reason.
 *
 * Run: `VITE_CHAIN_ID=<id> pnpm publish:preflight` (tsx). Exits 1 and prints every reason found;
 * exits 0 (silently) when the artifact is clear to publish.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The chain id the dev-chain bridge always writes; never a value to publish against. */
const LOCAL_CHAIN_ID = 1337

/** Sentinel `generatedAt` written into the committed placeholder config. */
const EPOCH_SENTINEL = '1970-01-01T00:00:00.000Z'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Chain id -> the config `src/lib/addresses.ts` imports for that chain, relative to the app root.
 *
 * This repeats that module's import list, which is the one way it can drift. It cannot drift
 * SILENTLY: the CLI passes the requested chain as the only allowed id, so a config reached through a
 * wrong entry here is refused for carrying the wrong `chainId` rather than published against another
 * chain's addresses.
 */
export const CONFIG_BY_CHAIN_ID: Readonly<Record<number, string>> = {
  1337: 'src/config/local-deployment.json',
  11155111: 'src/config/sepolia-deployment.json',
}

export interface AssertPublishableOptions {
  /** Chain ids treated as legitimate publish targets. `chainId` must be one of these. */
  allowChainIds?: number[]
}

/**
 * Returns every reason `deployment` must not be published. An empty array means the artifact is
 * clear. Never throws on a malformed shape — an unexpected value is itself a reason.
 */
export function assertPublishable(
  deployment: unknown,
  opts: AssertPublishableOptions = {},
): string[] {
  const reasons: string[] = []

  if (typeof deployment !== 'object' || deployment === null) {
    return [`deployment config is not an object (got ${JSON.stringify(deployment)})`]
  }
  const d = deployment as Record<string, unknown>

  const allowChainIds = opts.allowChainIds
  const chainId = d.chainId
  if (typeof chainId !== 'number' || !Number.isFinite(chainId)) {
    reasons.push(`chainId is missing or not a number (got ${JSON.stringify(chainId)})`)
  } else if (allowChainIds && allowChainIds.length > 0) {
    if (!allowChainIds.includes(chainId)) {
      reasons.push(`chainId ${chainId} is not in the allowed list [${allowChainIds.join(', ')}]`)
    }
  } else if (chainId === LOCAL_CHAIN_ID) {
    reasons.push(`chainId is ${LOCAL_CHAIN_ID}, the local dev-chain placeholder`)
  }

  const contracts = d.contracts
  if (typeof contracts !== 'object' || contracts === null) {
    reasons.push(`contracts is missing or not an object (got ${JSON.stringify(contracts)})`)
  } else {
    const zeroKeys = Object.entries(contracts as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.toLowerCase() === ZERO_ADDRESS)
      .map(([key]) => key)
    if (zeroKeys.length > 0) {
      reasons.push(`contracts carry the zero address: ${zeroKeys.join(', ')}`)
    }
  }

  if (d.generatedAt === EPOCH_SENTINEL) {
    reasons.push(`generatedAt is the epoch sentinel (${EPOCH_SENTINEL})`)
  }

  return reasons
}

/**
 * Resolves `VITE_CHAIN_ID` to the chain whose config a publish would ship. Returns a reason string
 * instead of a chain id when the variable cannot name one, so the CLI reports it the same way it
 * reports every other refusal.
 */
export function resolvePublishChainId(value: string | undefined): number | string {
  if (value === undefined || value.trim() === '') {
    return (
      'VITE_CHAIN_ID is unset, so a build falls back to the local anvil deployment. Set it to the ' +
      'chain being published — the same value the build is given.'
    )
  }
  const chainId = Number(value)
  if (!Number.isInteger(chainId)) {
    return `VITE_CHAIN_ID is ${JSON.stringify(value)}, which is not a chain id`
  }
  if (CONFIG_BY_CHAIN_ID[chainId] === undefined) {
    const known = Object.keys(CONFIG_BY_CHAIN_ID).join(', ')
    return `VITE_CHAIN_ID is ${chainId}, which the app carries no deployment config for (has: ${known})`
  }
  return chainId
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const appDir = resolve(here, '..')

  const chainId = resolvePublishChainId(process.env.VITE_CHAIN_ID)
  if (typeof chainId === 'string') {
    console.error(`Refusing to publish: ${chainId}`)
    process.exit(1)
  }

  const configPath = resolve(appDir, CONFIG_BY_CHAIN_ID[chainId])
  const raw = readFileSync(configPath, 'utf-8')
  const deployment = JSON.parse(raw)

  // The requested chain is the ONLY allowed id: a config reached for chain X that describes chain Y
  // is a mis-wired map or a mis-copied file, and either way not a thing to publish.
  const reasons = assertPublishable(deployment, { allowChainIds: [chainId] })
  if (reasons.length === 0) {
    process.exit(0)
  }

  console.error(`Refusing to publish ${configPath} (chain ${chainId}):`)
  for (const reason of reasons) {
    console.error(`  - ${reason}`)
  }
  process.exit(1)
}

// Only run the CLI when this file is invoked directly (`tsx scripts/assert-publishable.ts`), not
// when `assertPublishable` is imported for tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
