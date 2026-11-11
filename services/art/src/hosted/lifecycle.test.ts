/**
 * A launched collection's hosted art, driven through the worker's own fetch handler and the ledger's
 * watcher: bind, graduate (recommended to move), move to IPFS (migrated) — and, for a collection that
 * never moves, nothing at all: it stays hosted however long passes.
 * The chain is a stub the test moves and the clock is faked; storage is in memory and the ledger runs
 * on a real SQLite. The README's local walkthrough covers the same path against `wrangler dev` and a
 * real chain.
 */
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import worker, { type Env } from '../worker'
import type { CollectionFacts } from './chain'
import { HostingLedger } from './ledgerObject'
import { migrationCidOf } from './migration'
import { DEFAULT_DEPS, handleUpload } from './routes'
import { forgetIndex } from './store'
import { buildUpload, memoryBucket, png, sqliteSql } from './testing'

const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const ORIGIN = 'https://art.example'
const INSTANCE = '0x1111111111111111111111111111111111111111'
const REGISTRY = '0x2222222222222222222222222222222222222222'
const HOUR = 3600_000
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 10, 1)

let env: Env & { hosted: ReturnType<typeof memoryBucket> }
let ledgerObject: HostingLedger
let chain: { graduated: boolean; metadataURI: string; failing: boolean }
let readFacts: ReturnType<typeof vi.fn>

function ctx() {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext
}

function setup(vars: Partial<Env> = {}) {
  const hosted = memoryBucket()
  const base = {
    ART_CACHE: memoryBucket() as unknown as R2Bucket,
    ART_HOSTED: hosted as unknown as R2Bucket,
    UPLOAD_SESSION_SECRET: 'test-secret',
    UPLOAD_SIWE_DOMAINS: 'launch.example',
    UPLOAD_CHAIN_ID: '1',
    UPLOAD_RPC_URL: 'http://rpc.invalid',
    UPLOAD_REGISTRY: REGISTRY,
    ...vars,
  }
  readFacts = vi.fn(async (): Promise<CollectionFacts> => {
    if (chain.failing) throw new Error('rpc down')
    return { graduated: chain.graduated, metadataURI: chain.metadataURI }
  })
  const state = {
    storage: { sql: sqliteSql(), getAlarm: async () => null, setAlarm: async () => {} },
  }
  ledgerObject = new HostingLedger(state as unknown as DurableObjectState, base, { readFacts })
  const namespace = {
    idFromName: () => 'ledger',
    get: () => ({
      fetch: (url: string, init: RequestInit) => ledgerObject.fetch(new Request(url, init)),
    }),
  }
  env = { ...base, HOSTING_LEDGER: namespace as unknown as DurableObjectNamespace, hosted }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date'] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nothing upstream', { status: 404 })),
  )
  chain = { graduated: false, metadataURI: '', failing: false }
  setup()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const at = (ms: number) => vi.setSystemTime(T0 + ms)

async function call(path: string, init: RequestInit = {}, over: Partial<Env> = {}) {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), { ...env, ...over }, ctx())
}

async function signIn(): Promise<string> {
  const { nonce } = (await (await call('/upload/nonce')).json()) as { nonce: string }
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'launch.example',
    nonce,
    uri: 'https://launch.example',
    version: '1',
    issuedAt: new Date(),
  })
  const signature = await account.signMessage({ message })
  const res = await call('/upload/session', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  })
  return ((await res.json()) as { token: string }).token
}

async function put(token: string, car: Uint8Array) {
  return call('/upload/car', {
    method: 'PUT',
    body: car,
    headers: { authorization: `Bearer ${token}`, 'content-length': String(car.byteLength) },
  })
}

const PIECES = [
  { name: '1.png', bytes: png(1) },
  { name: '2.png', bytes: png(2) },
  { name: '3.png', bytes: png(3) },
]

/** Upload, deploy (the chain now points at the hosted base), bind, and run the watcher once. */
async function launch() {
  const upload = await buildUpload(PIECES)
  // Each test uploads the same art into a fresh bucket; drop indexes an earlier test cached.
  forgetIndex(upload.imgCid)
  forgetIndex(upload.metaCid)
  expect((await put(await signIn(), upload.car)).status).toBe(201)
  chain.metadataURI = `${ORIGIN}/ipfs/${upload.metaCid}/`
  const deps = {
    ...DEFAULT_DEPS,
    readInstance: vi.fn(async () => ({ registered: true, metadataURI: chain.metadataURI })),
  }
  const bound = await handleUpload(
    new Request(`${ORIGIN}/upload/bind`, {
      method: 'POST',
      body: JSON.stringify({ instance: INSTANCE }),
    }),
    env,
    () => false,
    deps,
  )
  expect(bound.status).toBe(200)
  await ledgerObject.watch(Date.now())
  const migrationCid = await migrationCidOf(
    upload.imgCid,
    PIECES.map((p) => p.name),
  )
  return { upload, migrationCid }
}

async function status() {
  const res = await call(`/hosting/${INSTANCE}`)
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

describe('a launched collection’s hosted art', () => {
  it('starts hosted, with the pieces and the migrated root worked out', async () => {
    const { upload, migrationCid } = await launch()
    const record = await status()
    expect(record).toEqual({
      instance: INSTANCE,
      state: 'hosted',
      imgCid: upload.imgCid,
      metaCid: upload.metaCid,
      migrationCid,
      pieces: ['1.png', '2.png', '3.png'],
      migrated: false,
      boundAt: T0,
      graduatedAt: null,
      migratedAt: null,
    })
    expect(readFacts).toHaveBeenCalledWith('http://rpc.invalid', INSTANCE)
  })

  it('answers 404 for a collection that hosts nothing', async () => {
    expect((await call('/hosting/0x3333333333333333333333333333333333333333')).status).toBe(404)
    expect((await call('/hosting/not-an-address')).status).toBe(400)
  })

  it('reports graduation, then a move to the regenerated metadata as migrated', async () => {
    const { upload, migrationCid } = await launch()

    chain.graduated = true
    at(2 * HOUR)
    await ledgerObject.watch(Date.now())
    expect(await status()).toMatchObject({ state: 'graduated', graduatedAt: T0 + 2 * HOUR })

    // Something other than the expected root is not a migration.
    chain.metadataURI = `ipfs://${upload.metaCid}/`
    at(4 * HOUR)
    await ledgerObject.watch(Date.now())
    expect(await status()).toMatchObject({ state: 'graduated', migrated: false })

    chain.metadataURI = `ipfs://${migrationCid}/`
    at(6 * HOUR)
    await ledgerObject.watch(Date.now())
    expect(await status()).toMatchObject({
      state: 'migrated',
      migrated: true,
      migratedAt: T0 + 6 * HOUR,
    })
    // Recorded, not enforced: the hosted copy is still served.
    expect((await call(`/ipfs/${upload.imgCid}/1.png`)).status).toBe(200)
    expect((await call(`/car/${upload.imgCid}`)).status).toBe(200)
  })

  it('keeps serving a collection that never moves, however long passes', async () => {
    const { upload } = await launch()
    chain.graduated = true
    for (const days of [30, 180, 400, 1000]) {
      at(days * DAY)
      await ledgerObject.alarm()
    }
    expect(await status()).toMatchObject({ state: 'graduated', migrated: false })
    const image = await call(`/ipfs/${upload.imgCid}/1.png`)
    expect(image.status).toBe(200)
    expect(image.headers.get('x-art-cache')).toBe('hosted')
    expect((await call(`/ipfs/${upload.metaCid}/2`)).status).toBe(200)
    expect((await call(`/car/${upload.imgCid}`)).status).toBe(200)
    expect([...env.hosted.objects.keys()].filter((k) => k.endsWith('.car'))).toHaveLength(1)
    // The same art uploaded again is the same draft, not a refusal.
    const again = await put(await signIn(), upload.car)
    expect(again.status).toBe(200)
  })

  it('takes a failed chain read as no news', async () => {
    await launch()
    chain.failing = true
    chain.graduated = true
    at(10 * DAY)
    expect(await ledgerObject.watch(Date.now())).toBe(T0 + 10 * DAY + HOUR)
    expect(await status()).toMatchObject({ state: 'hosted', graduatedAt: null })
  })

  it('stops reading the chain for a collection once it has migrated', async () => {
    const { migrationCid } = await launch()
    chain.metadataURI = `ipfs://${migrationCid}/`
    at(HOUR)
    await ledgerObject.watch(Date.now())
    readFacts.mockClear()
    at(5 * HOUR)
    expect(await ledgerObject.watch(Date.now())).toBeNull()
    expect(readFacts).not.toHaveBeenCalled()
  })

  it('reads its check interval from the deployment’s vars', async () => {
    setup({ HOSTED_CHECK_MINUTES: '5' })
    await launch()
    expect(await ledgerObject.watch(Date.now())).toBe(T0 + 5 * 60_000)
  })

  it('lets the denylist stop serving as before', async () => {
    const { upload } = await launch()
    const over = { ART_DENYLIST: upload.imgCid }
    expect((await call(`/ipfs/${upload.imgCid}/1.png`, {}, over)).status).toBe(410)
    expect((await call(`/car/${upload.imgCid}`, {}, over)).status).toBe(410)
  })
})
