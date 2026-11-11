/**
 * Uploads in parts, through the worker's own fetch handler: start, send parts, lose the connection,
 * pick up where it stopped, complete — and every way that can go wrong. Also the metadata a creator
 * brings: any JSON object is hosted as written, provided its `image` links this upload's art.
 */
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import worker, { type Env } from '../worker'
import { HostingLedger } from './ledgerObject'
import { forgetIndex } from './store'
import { buildUpload, HOST, memoryBucket, png, sqliteSql } from './testing'

const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const PART = 64 * 1024

function ctx() {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

let env: Env & { hosted: ReturnType<typeof memoryBucket> }
let ledgerObject: HostingLedger
let now = 0

beforeEach(() => {
  // The routes read the real clock; the ledger's alarm reads this one, moved on by the tests.
  now = Date.now()
  const hosted = memoryBucket()
  let alarm: number | null = null
  const base = {
    ART_CACHE: memoryBucket() as unknown as R2Bucket,
    ART_HOSTED: hosted as unknown as R2Bucket,
    UPLOAD_SESSION_SECRET: 'test-secret',
    UPLOAD_SIWE_DOMAINS: 'launch.example',
    UPLOAD_CHAIN_ID: '1',
    UPLOAD_PART_BYTES: String(PART),
  }
  const state = {
    storage: {
      sql: sqliteSql(),
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => void (alarm = at),
    },
  }
  ledgerObject = new HostingLedger(state as unknown as DurableObjectState, base, {
    now: () => now,
  })
  const namespace = {
    idFromName: () => 'ledger',
    get: () => ({
      fetch: (url: string, init: RequestInit) => ledgerObject.fetch(new Request(url, init)),
    }),
  }
  env = { ...base, HOSTING_LEDGER: namespace as unknown as DurableObjectNamespace, hosted }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nothing upstream', { status: 404 })),
  )
})

async function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${HOST}${path}`, init), env, ctx())
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

interface Upload {
  id: string
  bytes: number
  partSize: number
  parts: number[]
}

async function begin(token: string, car: { car: Uint8Array; imgCid: string; metaCid: string }) {
  return call('/upload/parts', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ bytes: car.car.byteLength, imgCid: car.imgCid, metaCid: car.metaCid }),
  })
}

async function sendPart(token: string, id: string, n: number, bytes: Uint8Array) {
  return call(`/upload/parts/${id}/${n}`, {
    method: 'PUT',
    body: bytes,
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.byteLength) },
  })
}

const partOf = (car: Uint8Array, n: number) => car.slice((n - 1) * PART, n * PART)

async function complete(token: string, id: string) {
  return call(`/upload/parts/${id}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
}

/** A collection big enough to need several parts, with the creator's own metadata. */
async function collection(metadata?: (piece: string, image: string) => string) {
  const built = await buildUpload(
    [1, 2, 3, 4].map((n) => ({ name: `${n}.png`, bytes: png(n, 70_000) })),
    {
      metadata:
        metadata ??
        ((piece, image) =>
          `{"name":"Sprite #${piece}","description":"A sprite.","image":"${image}","edition":${piece},` +
          `"attributes":[{"trait_type":"Eyes","value":"Laser"}],"animation_url":"https://elsewhere.example/${piece}.mp4"}`),
    },
  )
  forgetIndex(built.imgCid)
  forgetIndex(built.metaCid)
  return built
}

describe('an upload in parts', () => {
  it('survives a dropped connection: resumes with the parts already sent, then verifies', async () => {
    const built = await collection()
    const count = Math.ceil(built.car.byteLength / PART)
    expect(count).toBeGreaterThan(3)
    const token = await signIn()

    const started = await begin(token, built)
    expect(started.status).toBe(201)
    const { upload } = (await started.json()) as { upload: Upload }
    expect(upload).toMatchObject({ bytes: built.car.byteLength, partSize: PART, parts: [] })

    // Two parts arrive; the third is cut off mid-body (the request errors and nothing is stored).
    expect((await sendPart(token, upload.id, 1, partOf(built.car, 1))).status).toBe(200)
    expect((await sendPart(token, upload.id, 2, partOf(built.car, 2))).status).toBe(200)
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(partOf(built.car, 3).slice(0, 1000))
        controller.error(new Error('connection reset'))
      },
    })
    const dropped = await call(`/upload/parts/${upload.id}/3`, {
      method: 'PUT',
      body: cut,
      headers: { authorization: `Bearer ${token}`, 'content-length': String(PART) },
      duplex: 'half',
    } as RequestInit)
    expect(dropped.status).toBe(500)

    // The page reloads: a new session asks again for the same roots and size, and is told what the
    // host already holds.
    const again = await signIn()
    const resumed = await begin(again, built)
    expect(resumed.status).toBe(200)
    const { upload: same } = (await resumed.json()) as { upload: Upload }
    expect(same.id).toBe(upload.id)
    expect(same.parts).toEqual([1, 2])

    // Completing before the rest arrives says which parts are missing.
    const early = await complete(again, upload.id)
    expect(early.status).toBe(409)
    expect(((await early.json()) as { error: string }).error).toMatch(/parts 3, 4/)

    for (let n = 3; n <= count; n++) {
      expect((await sendPart(again, upload.id, n, partOf(built.car, n))).status).toBe(200)
    }
    const status = await call(`/upload/parts/${upload.id}`, {
      headers: { authorization: `Bearer ${again}` },
    })
    expect(((await status.json()) as { upload: Upload }).upload.parts).toHaveLength(count)

    const done = await complete(again, upload.id)
    expect(done.status).toBe(201)
    const { draft } = (await done.json()) as { draft: { state: string; metaCid: string } }
    expect(draft).toMatchObject({ state: 'open', metaCid: built.metaCid })

    // The creator's JSON is served as written, as JSON.
    const piece = await call(`/ipfs/${built.metaCid}/2`)
    expect(piece.headers.get('content-type')).toMatch(/^application\/json/)
    const text = await piece.text()
    expect(text).toContain('"animation_url":"https://elsewhere.example/2.mp4"')
    expect(text).toContain(`"image":"${HOST}/ipfs/${built.imgCid}/2.png"`)
    expect(env.hosted.uploads.size).toBe(0)

    // Completing again (an answer lost on the way back) gives the same draft.
    const twice = await complete(again, upload.id)
    expect(twice.status).toBe(200)
    expect(await twice.json()).toMatchObject({ draft: { id: upload.id, state: 'open' } })
  })

  it('answers with the hosted draft when the same art is already up, without sending anything', async () => {
    const built = await collection()
    const token = await signIn()
    const { upload } = (await (await begin(token, built)).json()) as { upload: Upload }
    for (let n = 1; n <= Math.ceil(built.car.byteLength / PART); n++) {
      await sendPart(token, upload.id, n, partOf(built.car, n))
    }
    expect((await complete(token, upload.id)).status).toBe(201)
    const again = await begin(token, built)
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ duplicate: true, draft: { metaCid: built.metaCid } })
  })

  it('counts an unfinished upload against the wallet at its full size', async () => {
    const token = await signIn()
    const big = (n: number) => ({
      car: { byteLength: 1024 * 1024 * 1024 } as Uint8Array,
      imgCid: `bafybei${String(n).repeat(52).slice(0, 52)}`,
      metaCid: `bafybei${String(n + 1).repeat(52).slice(0, 52)}`,
    })
    expect((await begin(token, big(2))).status).toBe(201)
    expect((await begin(token, big(4))).status).toBe(201)
    const third = await begin(token, big(6))
    expect(third.status).toBe(413)
    const drafts = await call('/upload/drafts', { headers: { authorization: `Bearer ${token}` } })
    const listed = ((await drafts.json()) as { drafts: Array<{ unfinished: boolean }> }).drafts
    expect(listed.map((d) => d.unfinished)).toEqual([true, true])
  })

  it('refuses an upload past 2 GiB before anything is sent', async () => {
    const token = await signIn()
    const res = await begin(token, {
      car: { byteLength: 2 * 1024 * 1024 * 1024 + 1 } as Uint8Array,
      imgCid: `bafybei${'a'.repeat(52)}`,
      metaCid: `bafybei${'b'.repeat(52)}`,
    })
    expect(res.status).toBe(413)
  })

  it('refuses a part of the wrong size, and a first part naming other roots', async () => {
    const built = await collection()
    const token = await signIn()
    const { upload } = (await (await begin(token, built)).json()) as { upload: Upload }
    expect((await sendPart(token, upload.id, 2, partOf(built.car, 2).slice(1))).status).toBe(400)
    const other = await collection((piece, image) => `{"name":"Other ${piece}","image":"${image}"}`)
    const wrong = await sendPart(token, upload.id, 1, partOf(other.car, 1))
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { error: string }).error).toMatch(/roots this upload was started for/)
  })

  it('refuses a tampered part at completion, stores nothing, and gives the space back', async () => {
    const built = await collection()
    const token = await signIn()
    const { upload } = (await (await begin(token, built)).json()) as { upload: Upload }
    const count = Math.ceil(built.car.byteLength / PART)
    for (let n = 1; n <= count; n++) {
      const part = partOf(built.car, n)
      if (n === 2) part[500]! ^= 0xff
      await sendPart(token, upload.id, n, part)
    }
    const res = await complete(token, upload.id)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/does not match its bytes/)
    expect(env.hosted.objects.size).toBe(0)
    const drafts = await call('/upload/drafts', { headers: { authorization: `Bearer ${token}` } })
    expect(((await drafts.json()) as { drafts: unknown[] }).drafts).toEqual([])
  })

  it('deletes an abandoned upload, parts and all, when the draft clock runs out', async () => {
    const built = await collection()
    const token = await signIn()
    const { upload } = (await (await begin(token, built)).json()) as { upload: Upload }
    await sendPart(token, upload.id, 1, partOf(built.car, 1))
    expect(env.hosted.uploads.size).toBe(1)
    now += 6 * 24 * 60 * 60 * 1000
    await ledgerObject.alarm()
    expect(env.hosted.uploads.size).toBe(1)
    now += 2 * 24 * 60 * 60 * 1000
    await ledgerObject.alarm()
    expect(env.hosted.uploads.size).toBe(0)
  })

  it('lets the uploader delete an unfinished upload', async () => {
    const built = await collection()
    const token = await signIn()
    const { upload } = (await (await begin(token, built)).json()) as { upload: Upload }
    await sendPart(token, upload.id, 1, partOf(built.car, 1))
    const res = await call(`/upload/drafts/${upload.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(env.hosted.uploads.size).toBe(0)
  })
})

describe("the creator's metadata", () => {
  async function putWhole(metadata: (piece: string, image: string) => string) {
    const built = await collection(metadata)
    const token = await signIn()
    const res = await call('/upload/car', {
      method: 'PUT',
      body: built.car,
      headers: {
        authorization: `Bearer ${token}`,
        'content-length': String(built.car.byteLength),
      },
    })
    return { res, built }
  }

  it('is refused when a piece does not link one of the uploaded images', async () => {
    const { res } = await putWhole((piece, image) =>
      piece === '3' ? '{"name":"x","image":"https://elsewhere.example/3.png"}' : `{"image":"${image}"}`,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe(
      "metadata 3 does not link one of this upload's images",
    )
    expect(env.hosted.objects.size).toBe(0)
  })

  it('is refused when a piece is not valid JSON, naming where', async () => {
    const { res } = await putWhole((piece, image) =>
      piece === '2' ? `{"image":"${image}",}` : `{"image":"${image}"}`,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(
      /^metadata 2, line 1, column \d+: expected a string$/,
    )
  })

  it('accepts a piece far larger than a name and a link, within the per-piece cap', async () => {
    const long = 'x'.repeat(300_000)
    const { res, built } = await putWhole(
      (piece, image) => `{"name":"#${piece}","description":"${long}","image":"${image}"}`,
    )
    expect(res.status).toBe(201)
    const served = await call(`/ipfs/${built.metaCid}/1`)
    expect((await served.text()).length).toBeGreaterThan(300_000)
  })
})
