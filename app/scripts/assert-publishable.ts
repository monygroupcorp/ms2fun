/**
 * Publish preflight: refuses to let a build carrying the placeholder deployment config reach a
 * publish workflow.
 *
 * `src/config/local-deployment.json` is regenerated locally by `pnpm chain:deploy` against the dev
 * chain and is never committed with real values (see `src/lib/addresses.ts`). `pnpm build` reads it
 * as a build-time static and succeeds either way — a build of the committed placeholder is
 * indistinguishable, from `pnpm build`'s exit code alone, from a build of a real deployment. This
 * script is the loud check a publish step runs before shipping an artifact anywhere: it does not
 * change what `build` accepts, only what a human or CI decides to publish.
 *
 * `assertPublishable` is a pure function so it can be unit-tested without touching the filesystem;
 * the CLI below is the thin wrapper that reads the real config and exits non-zero on any reason.
 *
 * Run: `pnpm publish:preflight` (tsx). Exits 1 and prints every reason found; exits 0 (silently) when
 * the artifact is clear to publish.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The chain id the dev-chain bridge always writes; never a value to publish against. */
const LOCAL_CHAIN_ID = 1337

/** Sentinel `generatedAt` written into the committed placeholder config. */
const EPOCH_SENTINEL = '1970-01-01T00:00:00.000Z'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const appDir = resolve(here, '..')
  const configPath = resolve(appDir, 'src/config/local-deployment.json')

  const raw = readFileSync(configPath, 'utf-8')
  const deployment = JSON.parse(raw)

  const reasons = assertPublishable(deployment)
  if (reasons.length === 0) {
    process.exit(0)
  }

  console.error(`Refusing to publish ${configPath}:`)
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
