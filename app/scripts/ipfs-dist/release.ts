/**
 * One-command Sepolia release of the IPFS distribution: `pnpm release:sepolia`.
 *
 * Walks the release the runbook used to describe as separate steps, and refuses at the first one
 * that would make the pin wrong:
 *
 *   1. the tree is clean and HEAD is `origin/main` (a pin cannot be edited, so it must name a commit
 *      that is on main, not a local experiment);
 *   2. the chain is Sepolia — `VITE_CHAIN_ID` set to anything else, mainnet above all, is refused
 *      rather than overridden;
 *   3. `publish:preflight --probe`, then `build:ipfs` (which packs `dist/ipfs.car`);
 *   4. the CAR is copied to `releases/noesis_v<N>.car` beside a release record (commit, CID, art
 *      service, CAR sha256);
 *   5. with `PINATA_JWT` in the operator's shell, the CAR is pinned to Pinata under the same name,
 *      and the release fails unless Pinata reports the root CID the CAR was packed with.
 *
 * Pointing the names at the CID is the step left: one transaction from the operator's wallet. No
 * Pinata credential, endpoint secret or account id lives in this repository; the JWT is read from
 * the environment and never written anywhere.
 *
 * `<N>` is one more than the highest release seen, counting both the local `releases/` records and,
 * when a JWT is present, the `noesis_v<N>` pins already on Pinata — so a release run from a fresh
 * checkout does not reuse a number.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CarReader } from '@ipld/car'

/** The only chain this command releases for. */
export const RELEASE_CHAIN_ID = 11155111

const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files'
const PINATA_LIST_URL = 'https://api.pinata.cloud/v3/files/public'

const RELEASE_NAME = /^noesis_v(\d+)(?:\.car|\.json)?$/

export function releaseName(n: number): string {
  return `noesis_v${n}`
}

export interface TreeState {
  /** `VITE_CHAIN_ID` from the operator's environment, if set. */
  chainIdEnv: string | undefined
  /** `VITE_BUILD_COMMIT` from the operator's environment, if set. */
  buildCommitEnv: string | undefined
  /** `git status --porcelain` output. */
  porcelain: string
  head: string
  originMain: string
}

/** Every reason the tree is not releasable; empty when it is. */
export function assertReleasable(state: TreeState): string[] {
  const reasons: string[] = []
  if (state.chainIdEnv !== undefined && state.chainIdEnv !== String(RELEASE_CHAIN_ID)) {
    reasons.push(
      `VITE_CHAIN_ID is ${state.chainIdEnv}; this command releases chain ${RELEASE_CHAIN_ID} only` +
        (state.chainIdEnv === '1' ? ' and never mainnet' : ''),
    )
  }
  if (state.porcelain.trim() !== '') {
    reasons.push('the working tree has uncommitted changes; a pin must name a commit')
  }
  if (state.head !== state.originMain) {
    reasons.push(
      `HEAD ${state.head.slice(0, 8)} is not origin/main ${state.originMain.slice(0, 8)}`,
    )
  }
  // The footer stamp is the operator's way to read which commit a site serves; an override that
  // disagrees with HEAD would make it lie.
  if (
    state.buildCommitEnv !== undefined &&
    state.buildCommitEnv !== '' &&
    !state.head.startsWith(state.buildCommitEnv)
  ) {
    reasons.push(
      `VITE_BUILD_COMMIT ${state.buildCommitEnv} does not name HEAD ${state.head.slice(0, 8)}`,
    )
  }
  return reasons
}

/** One more than the highest `noesis_v<N>` among `names`; 1 when there is none. */
export function nextReleaseNumber(names: Iterable<string>): number {
  let highest = 0
  for (const name of names) {
    const match = RELEASE_NAME.exec(name)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return highest + 1
}

type Fetch = typeof fetch

/**
 * Names of every public Pinata file, across all pages; the caller picks out `noesis_v<N>`. The
 * listing is not filtered by name on the server: Pinata does not document whether that filter is
 * exact or a prefix, and an exact match would return nothing and let a fresh checkout reuse a number.
 * No `limit` either, for the same reason — the page size is Pinata's default, so it cannot be refused.
 */
export async function listPinnedReleases(jwt: string, fetchImpl: Fetch = fetch): Promise<string[]> {
  const names: string[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(PINATA_LIST_URL)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!response.ok) {
      throw new Error(`Pinata list answered ${response.status}: ${await response.text()}`)
    }
    const body = (await response.json()) as {
      data?: { files?: { name?: string | null }[]; next_page_token?: string | null }
    }
    for (const file of body.data?.files ?? []) {
      if (file.name) names.push(file.name)
    }
    pageToken = body.data?.next_page_token || undefined
  } while (pageToken)
  return names
}

export interface PinResult {
  id: string
  cid: string
  duplicate: boolean
}

/**
 * Upload a CAR to Pinata's public network as a raw CAR, named `name`. Throws unless Pinata reports
 * `expectedRoot` — a different CID means Pinata re-imported the files rather than taking the DAG
 * as packed, and the record would point at bytes this build did not produce.
 */
export async function pinCar(
  jwt: string,
  car: Uint8Array,
  name: string,
  expectedRoot: string,
  fetchImpl: Fetch = fetch,
): Promise<PinResult> {
  const form = new FormData()
  form.append('file', new Blob([car], { type: 'application/vnd.ipld.car' }), `${name}.car`)
  form.append('network', 'public')
  form.append('car', 'true')
  form.append('name', name)

  const response = await fetchImpl(PINATA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  })
  if (!response.ok) {
    throw new Error(`Pinata upload answered ${response.status}: ${await response.text()}`)
  }
  const body = (await response.json()) as {
    data?: { id?: string; cid?: string; is_duplicate?: boolean }
  }
  const cid = body.data?.cid
  if (cid !== expectedRoot) {
    throw new Error(`Pinata reports CID ${cid ?? '(none)'}, the CAR's root is ${expectedRoot}`)
  }
  return { id: body.data?.id ?? '', cid, duplicate: body.data?.is_duplicate === true }
}

export interface ReleaseRecord {
  release: number
  name: string
  chainId: number
  commit: string
  cid: string
  artService: string | null
  car: { file: string; bytes: number; sha256: string }
  builtAt: string
  pinata: PinResult | null
}

const APP_DIR = resolve(import.meta.dirname, '..', '..')
const RELEASES_DIR = resolve(APP_DIR, 'releases')
const BUILT_CAR = resolve(APP_DIR, 'dist', 'ipfs.car')

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: APP_DIR, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync('pnpm', ['run', '--silent', script, ...args], {
    cwd: APP_DIR,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0)
    throw new Error(`pnpm ${script} exited ${result.status ?? result.signal}`)
}

function localReleaseNames(): string[] {
  try {
    return readdirSync(RELEASES_DIR)
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  git('fetch', '--quiet', 'origin', 'main')
  const head = git('rev-parse', 'HEAD')
  const reasons = assertReleasable({
    chainIdEnv: process.env.VITE_CHAIN_ID,
    buildCommitEnv: process.env.VITE_BUILD_COMMIT,
    porcelain: git('status', '--porcelain'),
    head,
    originMain: git('rev-parse', 'origin/main'),
  })
  if (reasons.length > 0) {
    console.error('release refused:')
    for (const reason of reasons) console.error(`  - ${reason}`)
    process.exit(1)
  }

  const env = { ...process.env, VITE_CHAIN_ID: String(RELEASE_CHAIN_ID) }
  run('publish:preflight', ['--probe'], env)
  run('build:ipfs', [], env)

  const car = new Uint8Array(readFileSync(BUILT_CAR))
  const roots = await (await CarReader.fromBytes(car)).getRoots()
  if (roots.length !== 1) throw new Error(`${BUILT_CAR} has ${roots.length} roots, expected 1`)
  const cid = roots[0].toString()

  const jwt = process.env.PINATA_JWT || undefined
  const seen = [...localReleaseNames(), ...(jwt ? await listPinnedReleases(jwt) : [])]
  const release = nextReleaseNumber(seen)
  const name = releaseName(release)

  mkdirSync(RELEASES_DIR, { recursive: true })
  const carFile = `${name}.car`
  copyFileSync(BUILT_CAR, resolve(RELEASES_DIR, carFile))
  const record: ReleaseRecord = {
    release,
    name,
    chainId: RELEASE_CHAIN_ID,
    commit: head,
    cid,
    artService: process.env.VITE_ART_SERVICE || null,
    car: {
      file: carFile,
      bytes: car.byteLength,
      sha256: createHash('sha256').update(car).digest('hex'),
    },
    builtAt: new Date().toISOString(),
    pinata: null,
  }
  const recordPath = resolve(RELEASES_DIR, `${name}.json`)
  const save = () => writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  save()

  console.log(`release: ${name}  commit ${head.slice(0, 8)}  cid ${cid}`)
  console.log(`release: car    ${resolve(RELEASES_DIR, carFile)} sha256 ${record.car.sha256}`)
  console.log(`release: record ${recordPath}`)

  if (!jwt) {
    console.log(
      'release: PINATA_JWT not set — not pinned. Pin the CAR above, then point the names.',
    )
    return
  }
  record.pinata = await pinCar(jwt, car, name, cid)
  save()
  console.log(
    `release: pinned ${name} on Pinata as ${record.pinata.cid}` +
      (record.pinata.duplicate ? ' (already pinned)' : ''),
  )
  console.log(`release: next   point both names at ${cid}, then pnpm release:verify ${cid}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error('release: FAILED —', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
