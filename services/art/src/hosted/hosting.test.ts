/**
 * Hosting end to end through the worker's own fetch handler: sign in, upload, read back through
 * every route, download the CAR, bind, expire, deny. Storage is in memory and the ledger runs on a
 * real SQLite; the signature is a real one. What this cannot reach is the Cloudflare runtime itself
 * — the README's local walkthrough covers that against `wrangler dev`.
 */
import { CarBlockIterator } from '@ipld/car'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import worker, { type Env } from '../worker'
import { HostingLedger } from './ledgerObject'
import { DEFAULT_DEPS, handleUpload } from './routes'
import { buildUpload, memoryBucket, png, sqliteSql } from './testing'

const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const ORIGIN = 'https://art.example'
const INSTANCE = '0x1111111111111111111111111111111111111111'
const REGISTRY = '0x2222222222222222222222222222222222222222'

function ctx() {
  const pending: Promise<unknown>[] = []
  return {
    settle: () => Promise.allSettled(pending),
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext & { settle: () => Promise<unknown> }
}

let env: Env & { hosted: ReturnType<typeof memoryBucket>; alarm: () => number | null }
let ledgerObject: HostingLedger

beforeEach(() => {
  const hosted = memoryBucket()
  let alarm: number | null = null
  const base = {
    ART_CACHE: memoryBucket() as unknown as R2Bucket,
    ART_HOSTED: hosted as unknown as R2Bucket,
    UPLOAD_SESSION_SECRET: 'test-secret',
    UPLOAD_SIWE_DOMAINS: 'launch.example, localhost:5173',
    UPLOAD_CHAIN_ID: '1',
    UPLOAD_RPC_URL: 'http://rpc.invalid',
    UPLOAD_REGISTRY: REGISTRY,
  }
  const state = {
    storage: {
      sql: sqliteSql(),
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => void (alarm = at),
    },
  }
  ledgerObject = new HostingLedger(state as unknown as DurableObjectState, base)
  const namespace = {
    idFromName: () => 'ledger',
    get: () => ({
      fetch: (url: string, init: RequestInit) => ledgerObject.fetch(new Request(url, init)),
    }),
  }
  env = {
    ...base,
    HOSTING_LEDGER: namespace as unknown as DurableObjectNamespace,
    hosted,
    alarm: () => alarm,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nothing upstream', { status: 404 })),
  )
})

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
  expect(res.status).toBe(200)
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
  { name: '2.png', bytes: png(2, 300_000) },
]

describe('hosting, end to end', () => {
  it('signs in, uploads, and serves every file back under its CID', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    const res = await put(token, upload.car)
    expect(res.status).toBe(201)
    const { draft } = (await res.json()) as { draft: Record<string, unknown> }
    expect(draft).toMatchObject({
      state: 'open',
      imgCid: upload.imgCid,
      metaCid: upload.metaCid,
      bytes: upload.car.byteLength,
    })

    const image = await call(`/ipfs/${upload.imgCid}/2.png`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(image.headers.get('x-art-cache')).toBe('hosted')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PIECES[1]!.bytes)

    const meta = await call(`/ipfs/${upload.metaCid}/1`)
    expect(meta.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await meta.json()).toEqual({
      name: '#1',
      image: `https://art.example/ipfs/${upload.imgCid}/1.png`,
    })

    // The app's own routes take the hosted fast path too, before any gateway.
    const viaMeta = await call(`/meta/${upload.metaCid}/1`)
    expect(viaMeta.headers.get('x-art-cache')).toBe('hosted')
    const viaArt = await call(`/art/${upload.imgCid}/1.png?w=320`)
    expect(viaArt.status).toBe(200)
    expect(new Uint8Array(await viaArt.arrayBuffer())).toEqual(PIECES[0]!.bytes)
    expect(fetch).not.toHaveBeenCalled()

    const head = await call(`/ipfs/${upload.imgCid}/1.png`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(PIECES[0]!.bytes.byteLength))

    const car = await call(`/car/${upload.imgCid}`)
    expect(car.headers.get('content-type')).toMatch(/^application\/vnd\.ipld\.car/)
    expect(new Uint8Array(await car.arrayBuffer())).toEqual(upload.car)

    // The metadata root's CAR carries the metadata and nothing else: no image bytes.
    const metaCar = await call(`/car/${upload.metaCid}`)
    const blocks = await CarBlockIterator.fromBytes(new Uint8Array(await metaCar.arrayBuffer()))
    expect((await blocks.getRoots()).map(String)).toEqual([upload.metaCid])
    const carried: string[] = []
    for await (const block of blocks) carried.push(block.cid.toString())
    expect(carried.sort()).toEqual([...upload.metadata.blocks.keys()].sort())
  })

  it('refuses an upload without a session, or with a forged one', async () => {
    const upload = await buildUpload(PIECES)
    expect((await put('', upload.car)).status).toBe(401)
    expect((await put('forged.token', upload.car)).status).toBe(401)
  })

  it('refuses a tampered CAR, stores nothing, and gives the space back', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    const tampered = upload.car.slice()
    tampered[tampered.byteLength - 2]! ^= 1
    const res = await put(token, tampered)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/does not match/)
    expect(env.hosted.objects.size).toBe(0)
    const drafts = await call('/upload/drafts', { headers: { authorization: `Bearer ${token}` } })
    expect(((await drafts.json()) as { drafts: unknown[] }).drafts).toEqual([])
    expect((await call(`/ipfs/${upload.imgCid}/1.png`)).status).not.toBe(200)
  })

  it('refuses an upload past the size cap before reading it, and when paused', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    const capped = await call(
      '/upload/car',
      {
        method: 'PUT',
        body: upload.car,
        headers: {
          authorization: `Bearer ${token}`,
          'content-length': String(upload.car.byteLength),
        },
      },
      { UPLOAD_MAX_CAR_BYTES: '100' },
    )
    expect(capped.status).toBe(413)
    const paused = await call(
      '/upload/car',
      {
        method: 'PUT',
        body: upload.car,
        headers: {
          authorization: `Bearer ${token}`,
          'content-length': String(upload.car.byteLength),
        },
      },
      { UPLOADS_PAUSED: '1' },
    )
    expect(paused.status).toBe(503)
  })

  it('answers the same draft for the same art uploaded twice', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    const first = (await (await put(token, upload.car)).json()) as { draft: { id: string } }
    const second = await put(token, upload.car)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ duplicate: true, draft: { id: first.draft.id } })
    // One CAR and two indexes — the duplicate's copy was dropped.
    expect([...env.hosted.objects.keys()].filter((k) => k.startsWith('hosted/car/'))).toHaveLength(1)
  })

  it('refuses a denied CID at upload, and stops serving a hosted one once denied', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    const denied = await call(
      '/upload/car',
      {
        method: 'PUT',
        body: upload.car,
        headers: {
          authorization: `Bearer ${token}`,
          'content-length': String(upload.car.byteLength),
        },
      },
      { ART_DENYLIST: upload.imgCid },
    )
    expect(denied.status).toBe(400)

    expect((await put(token, upload.car)).status).toBe(201)
    const over = { ART_DENYLIST: upload.imgCid }
    expect((await call(`/ipfs/${upload.imgCid}/1.png`, {}, over)).status).toBe(410)
    expect((await call(`/art/${upload.imgCid}/1.png?w=320`, {}, over)).status).toBe(410)
    expect((await call(`/car/${upload.imgCid}`, {}, over)).status).toBe(410)
  })

  it('deletes an unlaunched draft when it expires, and its bytes with it', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    expect((await put(token, upload.car)).status).toBe(201)
    expect(env.alarm()).not.toBeNull()

    vi.useFakeTimers({ now: Date.now() + 8 * 24 * 3600_000, toFake: ['Date'] })
    try {
      await ledgerObject.alarm()
    } finally {
      vi.useRealTimers()
    }
    expect(env.hosted.objects.size).toBe(0)
    const gone = await call(`/ipfs/${upload.imgCid}/1.png`)
    expect(gone.headers.get('x-art-cache')).not.toBe('hosted')
  })

  it('answers 503 on every upload route when hosting is not configured', async () => {
    const res = await call('/upload/nonce', {}, { UPLOAD_SESSION_SECRET: '' })
    expect(res.status).toBe(503)
  })

  it('answers a CORS preflight for the upload routes', async () => {
    const res = await call('/upload/car', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toMatch(/authorization/)
  })
})

describe('bind', () => {
  async function bind(facts: { registered: boolean; metadataURI: string }) {
    const deps = { ...DEFAULT_DEPS, readInstance: vi.fn(async () => facts) }
    const res = await handleUpload(
      new Request(`${ORIGIN}/upload/bind`, {
        method: 'POST',
        body: JSON.stringify({ instance: INSTANCE }),
      }),
      env,
      () => false,
      deps,
    )
    return { res, deps }
  }

  it('binds the draft a registered instance’s on-chain base points at, ending its expiry', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    await put(token, upload.car)
    const { res, deps } = await bind({
      registered: true,
      metadataURI: `https://art.example/ipfs/${upload.metaCid}/`,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      draft: { state: 'bound', expiresAt: null, instance: INSTANCE },
    })
    expect(deps.readInstance).toHaveBeenCalledWith('http://rpc.invalid', REGISTRY, INSTANCE)
  })

  it('refuses an instance the registry does not know, or one pointing elsewhere', async () => {
    const token = await signIn()
    const upload = await buildUpload(PIECES)
    await put(token, upload.car)
    const unknown = await bind({ registered: false, metadataURI: `ipfs://${upload.metaCid}/` })
    expect(unknown.res.status).toBe(404)
    const elsewhere = await bind({ registered: true, metadataURI: 'https://elsewhere.example/1/' })
    expect(elsewhere.res.status).toBe(404)
  })
})
