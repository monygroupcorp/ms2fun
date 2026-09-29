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
 * It guards `VITE_ART_SERVICE` on the same grounds. That variable is inlined at build time too, so
 * the pin CID is a function of the commit AND its value: a release built without it has art
 * delivery switched off, and a pin cannot be edited afterwards. Unset stays a supported way to
 * publish — `PUBLISH_WITHOUT_ART_SERVICE=1` says so deliberately — but forgetting no longer looks
 * like choosing. With `--probe` it also asks the configured origin whether the worker is actually
 * answering there, which DNS resolving cannot tell you.
 *
 * Run: `VITE_CHAIN_ID=<id> VITE_ART_SERVICE=<origin> pnpm publish:preflight [--probe]` (tsx). Exits
 * 1 and prints every reason found; exits 0 (silently) when the artifact is clear to publish.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normaliseArtServiceBase } from '../src/lib/metadata/artServiceBase'

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

/**
 * A well-formed CID used only to SHAPE a request. Nothing is fetched through it and nothing is
 * asserted about what it addresses — `src/lib/metadata/artService.contract.test.ts` uses the same
 * one for the same reason.
 */
const PROBE_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

/** How long the live probe waits before calling an origin unreachable. */
const PROBE_TIMEOUT_MS = 10_000

/**
 * Every reason `VITE_ART_SERVICE` must not be published as it stands.
 *
 * The variable is inlined into the bundle at build time (`src/lib/metadata/uri.ts`), so the pin CID
 * is a function of the commit AND this value. A pin cannot be edited: a release built without it
 * has art delivery switched off for as long as that CID is what the name resolves to, and the only
 * repair is another build, another pin and another name update.
 *
 * Unset is a SUPPORTED state for the app and stays one here — `allowNone` is how a fork, or a
 * deliberate roster-only release, says so out loud. What is refused is FORGETTING, which until now
 * was indistinguishable from choosing.
 */
export function assertArtServicePublishable(
  raw: string | undefined,
  opts: { allowNone?: boolean } = {},
): string[] {
  if (raw === undefined || raw.trim() === '') {
    if (opts.allowNone) return []
    return [
      "VITE_ART_SERVICE is unset, so the bundle ships with art delivery off and a visitor's first " +
        'view of a grid spends one metered third-party gateway request per card. Set it to the ' +
        "service's origin — the same value the build is given — or set " +
        'PUBLISH_WITHOUT_ART_SERVICE=1 to publish roster-only on purpose.',
    ]
  }

  const base = normaliseArtServiceBase(raw)
  if (base === null) {
    return [
      `VITE_ART_SERVICE is ${JSON.stringify(raw)}, which is not an http(s) origin. The app reads ` +
        'that as no service at all, so the bundle would be roster-only without ever saying so.',
    ]
  }

  const reasons: string[] = []
  if (base.startsWith('http://')) {
    reasons.push(
      `VITE_ART_SERVICE is ${JSON.stringify(base)}, which is http://. A pinned bundle is served ` +
        'to visitors over https, so every art request from it would be blocked as mixed content.',
    )
  }

  let hostname = ''
  try {
    hostname = new URL(base).hostname
  } catch {
    // Unreachable for anything normaliseArtServiceBase accepted; kept so a shape that slips
    // through is a printed reason rather than a stack trace out of a preflight.
  }
  if (hostname === '') {
    reasons.push(`VITE_ART_SERVICE is ${JSON.stringify(base)}, which names no host`)
  } else if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) {
    reasons.push(
      `VITE_ART_SERVICE is ${JSON.stringify(base)}, an address that resolves only on the machine ` +
        'that built the bundle. No visitor can reach it.',
    )
  }
  return reasons
}

/**
 * Asks a live art service the one question only it can answer correctly.
 *
 * `GET /art/<cid>` with NO `w` parses to NaN, which is in no deployment's rung list, so the worker
 * refuses it 400 `unsupported width` (`services/art/src/worker.ts`) whatever ART_WIDTHS it was
 * given. No gateway is asked and nothing is cached, so the probe is cheap and has no side effect.
 *
 * This is what separates "the hostname resolves" from "our code is answering on it". A hostname
 * pointed at a CDN with no worker route bound returns that provider's own 404 page, which looks
 * perfectly healthy to any check that only asks whether the host is up — and a bundle pinned
 * against it shows no art at all.
 */
export async function probeArtService(
  base: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<string[]> {
  const url = `${base}/art/${PROBE_CID}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(url, { signal: controller.signal })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [`${url} could not be reached (${detail})`]
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 400) return []
  if (response.status === 410) {
    return [
      `${url} answers 410, so the worker IS deployed here and holds the probe CID in its ` +
        'ART_DENYLIST. The route is proven; nothing else about this deployment is.',
    ]
  }
  return [
    `${url} answers ${response.status}. The art service answers 400 to a request with no width, ` +
      'so nothing at this origin is running the worker in services/art — check that a route is ' +
      'bound to this hostname, not only that DNS points at the provider.',
  ]
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const appDir = resolve(here, '..')
  const probe = process.argv.includes('--probe')

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
  const configReasons = assertPublishable(deployment, { allowChainIds: [chainId] })

  const artService = process.env.VITE_ART_SERVICE
  const artReasons = assertArtServicePublishable(artService, {
    allowNone: process.env.PUBLISH_WITHOUT_ART_SERVICE === '1',
  })

  // Only when the value is good enough to be worth asking about, and only when asked: the probe is
  // the one check here that reaches the network, so CI stays hermetic and a release walk opts in.
  if (probe && artReasons.length === 0) {
    const base = normaliseArtServiceBase(artService)
    if (base !== null) artReasons.push(...(await probeArtService(base)))
  }

  if (configReasons.length === 0 && artReasons.length === 0) {
    process.exit(0)
  }

  // Both groups print, so one run names everything wrong rather than one thing per attempt.
  if (configReasons.length > 0) {
    console.error(`Refusing to publish ${configPath} (chain ${chainId}):`)
    for (const reason of configReasons) {
      console.error(`  - ${reason}`)
    }
  }
  if (artReasons.length > 0) {
    console.error('Refusing to publish: art delivery would not work in this bundle.')
    for (const reason of artReasons) {
      console.error(`  - ${reason}`)
    }
  }
  process.exit(1)
}

// Only run the CLI when this file is invoked directly (`tsx scripts/assert-publishable.ts`), not
// when `assertPublishable` is imported for tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
