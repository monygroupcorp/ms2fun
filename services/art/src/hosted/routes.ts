/**
 * The hosting routes: sign-in, upload, bind, and reading hosted bytes back out.
 *
 *   GET    /upload/nonce          a fresh sign-in nonce
 *   POST   /upload/session        { message, signature } -> { token, address, expiresAt }
 *   PUT    /upload/car            the CAR in one request (up to ~95 MiB) -> the draft
 *   POST   /upload/parts          { bytes, imgCid, metaCid } -> an upload in parts, new or resumed
 *   GET    /upload/parts/<id>     which parts the host holds
 *   PUT    /upload/parts/<id>/<n> part n (from 1) of the CAR
 *   POST   /upload/parts/<id>/complete   assemble, verify the whole CAR, index -> the draft
 *   GET    /upload/drafts         the signed-in wallet's drafts
 *   DELETE /upload/drafts/<id>    delete one of them, if no collection uses it yet
 *   POST   /upload/bind           { instance } -> the draft that instance's metadata points at
 *   GET    /hosting/<instance>    whether that collection graduated or moved to IPFS — public
 *
 * Reads (`/ipfs/`, `/art/`, `/meta/`, `/car/`) live in `worker.ts`, which calls
 * {@link serveHostedFile} first and falls through to the cache and the roster when it answers null.
 */
import * as dagCbor from '@ipld/dag-cbor'
import { CID as CIDClass } from 'multiformats/cid'
import type { CID } from 'multiformats/cid'

import { bearerOf, issueSession, readSession, verifySignIn as realVerifySignIn } from './auth'
import {
  CarRejected,
  indexCar,
  readVarint,
  verifyingStream,
  type HostedIndex,
  type RootIndex,
  type VerifiedCar,
} from './car'
import { baseCid, readInstance as realReadInstance, type ReadInstance } from './chain'
import { SESSION_TTL_MS, hostingConfig, uploadsUnavailable, type HostingEnv } from './config'
import type { CommitResult, Draft, Part, PartsUpload, Refusal } from './ledger'
import { checkMetadata } from './metadata'
import { callLedger } from './ledgerObject'
import { carKey, forgetIndex, indexKey, loadIndex, metaCarKey, readHostedFile } from './store'

export interface HostingDeps {
  now: () => number
  verifySignIn: typeof realVerifySignIn
  readInstance: ReadInstance
}

export const DEFAULT_DEPS: HostingDeps = {
  now: () => Date.now(),
  verifySignIn: realVerifySignIn,
  readInstance: realReadInstance,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function refuse(status: number, reason: string): Response {
  return json({ error: reason }, status)
}

/** What a creator is shown about one draft. */
function publicDraft(draft: Draft) {
  return {
    id: draft.id,
    state: draft.state,
    imgCid: draft.imgCid ?? draft.wantImg,
    metaCid: draft.metaCid ?? draft.wantMeta,
    /** An upload in parts that has not finished arriving. */
    unfinished: draft.state === 'reserved' && draft.uploadId !== null,
    bytes: draft.bytes,
    files: draft.files,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt,
    instance: draft.instance,
  }
}

export async function handleUpload(
  request: Request,
  env: HostingEnv,
  deny: (cid: string) => boolean,
  deps: HostingDeps = DEFAULT_DEPS,
  /** Runs once a new upload is indexed and servable, with its images root. */
  onCommitted?: (images: RootIndex) => void,
): Promise<Response> {
  const unavailable = uploadsUnavailable(env)
  if (unavailable !== null) return refuse(503, unavailable)
  const config = hostingConfig(env)
  const path = new URL(request.url).pathname
  const method = request.method

  if (path === '/upload/nonce' && method === 'GET') {
    return json(await callLedger(env, { op: 'nonce', now: deps.now() }))
  }

  if (path === '/upload/session' && method === 'POST') {
    let body: { message?: unknown; signature?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return refuse(400, 'expected JSON')
    }
    if (typeof body.message !== 'string' || typeof body.signature !== 'string') {
      return refuse(400, 'expected { message, signature }')
    }
    if (!/^0x[0-9a-fA-F]+$/.test(body.signature) || body.message.length > 4096) {
      return refuse(400, 'malformed sign-in')
    }
    const now = deps.now()
    const result = await deps.verifySignIn(body.message, body.signature as `0x${string}`, {
      domains: config.domains,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      now,
      consumeNonce: (nonce) => callLedger<boolean>(env, { op: 'consume', nonce, now }),
    })
    if (!result.ok) return refuse(401, result.reason)
    const expiresAt = now + SESSION_TTL_MS
    const token = await issueSession(env.UPLOAD_SESSION_SECRET!, result.address, expiresAt)
    return json({ token, address: result.address.toLowerCase(), expiresAt })
  }

  if (path === '/upload/bind' && method === 'POST') return bind(request, env, config, deps)

  // Everything below acts for a wallet.
  const token = bearerOf(request)
  const wallet =
    token === null ? null : await readSession(env.UPLOAD_SESSION_SECRET!, token, deps.now())
  if (wallet === null) return refuse(401, 'sign in first')

  if (path === '/upload/car' && method === 'PUT') {
    return upload(request, env, config, wallet, deny, deps, onCommitted)
  }
  if (path === '/upload/parts' && method === 'POST') {
    return beginParts(request, env, config, wallet, deny, deps)
  }
  const parts = /^\/upload\/parts\/([a-z0-9]{8,64})(?:\/(\d{1,5}|complete))?$/.exec(path)
  if (parts !== null) {
    const id = parts[1]!
    const upload = await callLedger<(PartsUpload & { uploadId: string }) | null>(env, {
      op: 'upload',
      wallet,
      id,
    })
    if (upload === null) {
      // Completed already, and the answer was lost on its way back: the same answer again.
      if (parts[2] === 'complete' && method === 'POST') {
        const drafts = await callLedger<Draft[]>(env, { op: 'drafts', wallet })
        const finished = drafts.find((d) => d.id === id && d.state !== 'reserved')
        if (finished !== undefined) return json({ draft: publicDraft(finished), duplicate: false })
      }
      return refuse(404, 'no such unfinished upload')
    }
    if (parts[2] === undefined && method === 'GET') return json({ upload: publicUpload(upload) })
    if (parts[2] === 'complete' && method === 'POST') {
      return completeParts(env, wallet, upload, deny, deps, onCommitted)
    }
    if (parts[2] !== undefined && parts[2] !== 'complete' && method === 'PUT') {
      return putPart(request, env, config, upload, Number(parts[2]), deny)
    }
    return refuse(405, 'method not allowed')
  }
  if (path === '/upload/drafts' && method === 'GET') {
    const drafts = await callLedger<Draft[]>(env, { op: 'drafts', wallet })
    return json({ drafts: drafts.map(publicDraft) })
  }
  const remove = /^\/upload\/drafts\/([a-z0-9]{8,64})$/.exec(path)
  if (remove !== null && method === 'DELETE') {
    const removed = await callLedger<unknown>(env, { op: 'remove', wallet, id: remove[1]! })
    return removed === null
      ? refuse(404, 'no such unlaunched upload')
      : json({ deleted: remove[1] })
  }
  return refuse(404, 'not found')
}

async function upload(
  request: Request,
  env: HostingEnv,
  config: ReturnType<typeof hostingConfig>,
  wallet: string,
  deny: (cid: string) => boolean,
  deps: HostingDeps,
  onCommitted: ((images: RootIndex) => void) | undefined,
): Promise<Response> {
  if (config.paused) return refuse(503, 'uploads are paused')
  const length = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (!Number.isSafeInteger(length) || length <= 0)
    return refuse(411, 'a content-length is required')
  if (length > config.maxCarBytes) {
    return refuse(413, `an upload may be at most ${config.maxCarBytes} bytes`)
  }
  if (request.body === null) return refuse(400, 'the upload is empty')

  const reserved = await callLedger<{ ok: true; id: string } | Refusal>(env, {
    op: 'reserve',
    wallet,
    bytes: length,
    now: deps.now(),
  })
  if (!reserved.ok) return refuse(reserved.status, reserved.reason)
  const id = reserved.id
  const bucket = env.ART_HOSTED!
  const key = carKey(id)

  const abandon = async () => {
    await Promise.allSettled([bucket.delete(key), callLedger(env, { op: 'release', id })])
  }

  // The bytes go to storage AS they are verified. A block that does not match its CID errors the
  // stream, which fails the write; nothing unverified is ever indexed, so nothing unverified is
  // ever served, even in the moment before the failed object is deleted.
  const { stream, result, refusal } = verifyingStream((roots: CID[]) => {
    const denied = roots.find((root) => deny(root.toString()))
    if (denied !== undefined) throw new CarRejected(`${denied} is not accepted here`)
  })
  let verified: VerifiedCar
  try {
    const sized = sizedStream(length)
    const piping = request.body.pipeThrough(stream).pipeTo(sized.writable)
    await Promise.all([bucket.put(key, sized.readable), piping])
    verified = await result
  } catch (error) {
    await abandon()
    const refused = refusal() ?? (error instanceof CarRejected ? error : null)
    return refused === null
      ? refuse(500, 'the upload could not be stored')
      : refuse(400, refused.message)
  }
  return commitVerified(env, wallet, id, verified, null, deps, onCommitted)
}

/**
 * Index a stored, block-verified CAR and make it servable: shape and metadata checks, the ledger's
 * commit, then the indexes. Whatever refuses it deletes the stored bytes and gives the space back.
 * `want` is the roots an upload in parts was started for; the CAR must carry exactly those.
 */
async function commitVerified(
  env: HostingEnv,
  wallet: string,
  id: string,
  verified: VerifiedCar,
  want: { imgCid: string; metaCid: string } | null,
  deps: HostingDeps,
  onCommitted: ((images: RootIndex) => void) | undefined,
): Promise<Response> {
  const bucket = env.ART_HOSTED!
  const key = carKey(id)
  const abandon = async () => {
    await Promise.allSettled([
      bucket.delete([key, metaCarKey(id)]),
      callLedger(env, { op: 'release', id }),
    ])
  }

  let indexes: ReturnType<typeof indexCar>
  let metaCar: Blob
  try {
    indexes = indexCar(verified)
    if (
      want !== null &&
      (indexes.images.root !== want.imgCid || indexes.metadata.root !== want.metaCid)
    ) {
      throw new CarRejected('the CAR does not carry the roots this upload was started for')
    }
    metaCar = (await checkMetadata(bucket, key, verified, indexes)).metaCar
  } catch (error) {
    await abandon()
    return error instanceof CarRejected
      ? refuse(400, error.message)
      : refuse(500, 'the upload could not be stored')
  }

  const files =
    Object.keys(indexes.metadata.files).length + Object.keys(indexes.images.files).length
  const committed = await callLedger<CommitResult>(env, {
    op: 'commit',
    id,
    roots: { imgCid: indexes.images.root, metaCid: indexes.metadata.root, files },
    now: deps.now(),
  })
  if (committed.status === 'duplicate') {
    await bucket.delete([key, metaCarKey(id)])
    return json({ draft: publicDraft(committed.draft), duplicate: true })
  }
  if (committed.status === 'conflict') {
    await bucket.delete([key, metaCarKey(id)])
    return refuse(409, 'these images are already hosted under different metadata')
  }
  if (committed.status === 'missing') {
    await abandon()
    return refuse(408, 'the upload took too long; try again')
  }

  try {
    await bucket.put(metaCarKey(id), metaCar, {
      httpMetadata: { contentType: 'application/vnd.ipld.car' },
    })
    const roots: HostedIndex[] = [
      { ...indexes.images, car: key },
      { ...indexes.metadata, car: key, metaCar: metaCarKey(id) },
    ]
    for (const index of roots) {
      await bucket.put(indexKey(index.root), JSON.stringify(index), {
        httpMetadata: { contentType: 'application/json' },
      })
    }
  } catch {
    await Promise.allSettled([
      callLedger(env, { op: 'remove', wallet, id }),
      bucket.delete([
        key,
        metaCarKey(id),
        indexKey(indexes.images.root),
        indexKey(indexes.metadata.root),
      ]),
    ])
    return refuse(500, 'the upload could not be stored')
  }

  onCommitted?.(indexes.images)
  return json({ draft: publicDraft(committed.draft), duplicate: false }, 201)
}

/** What the uploader is told about an upload in parts. */
function publicUpload(upload: PartsUpload) {
  return {
    id: upload.id,
    bytes: upload.bytes,
    partSize: upload.partSize,
    parts: upload.parts,
    imgCid: upload.imgCid,
    metaCid: upload.metaCid,
    expiresAt: upload.expiresAt,
  }
}

const CID_TEXT = /^[a-z2-7]{50,100}$/

/** `POST /upload/parts`: start an upload in parts, or answer with the one already started. */
async function beginParts(
  request: Request,
  env: HostingEnv,
  config: ReturnType<typeof hostingConfig>,
  wallet: string,
  deny: (cid: string) => boolean,
  deps: HostingDeps,
): Promise<Response> {
  if (config.paused) return refuse(503, 'uploads are paused')
  let body: { bytes?: unknown; imgCid?: unknown; metaCid?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return refuse(400, 'expected JSON')
  }
  const { bytes, imgCid, metaCid } = body
  if (
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    typeof imgCid !== 'string' ||
    typeof metaCid !== 'string' ||
    !CID_TEXT.test(imgCid) ||
    !CID_TEXT.test(metaCid)
  ) {
    return refuse(400, 'expected { bytes, imgCid, metaCid }')
  }
  if (bytes > config.maxUploadBytes) {
    return refuse(413, `an upload may be at most ${config.maxUploadBytes} bytes`)
  }
  const denied = [imgCid, metaCid].find(deny)
  if (denied !== undefined) return refuse(400, `${denied} is not accepted here`)

  const partSize = Math.min(config.partBytes, config.maxCarBytes)
  const begun = await callLedger<
    | { ok: true; upload: PartsUpload; fresh: boolean }
    | { ok: true; duplicate: Draft }
    | Refusal
  >(env, { op: 'begin', wallet, want: { bytes, imgCid, metaCid, partSize }, now: deps.now() })
  if (!begun.ok) return refuse(begun.status, begun.reason)
  if ('duplicate' in begun) return json({ draft: publicDraft(begun.duplicate), duplicate: true })
  if (!begun.fresh) return json({ upload: publicUpload(begun.upload) })

  try {
    const multipart = await env.ART_HOSTED!.createMultipartUpload(carKey(begun.upload.id), {
      httpMetadata: { contentType: 'application/vnd.ipld.car' },
    })
    await callLedger(env, { op: 'attach', id: begun.upload.id, uploadId: multipart.uploadId })
  } catch {
    await callLedger(env, { op: 'release', id: begun.upload.id })
    return refuse(500, 'the upload could not be started')
  }
  return json({ upload: publicUpload(begun.upload) }, 201)
}

/**
 * The first part's CAR header, checked as it streams past: it must name exactly the roots the
 * upload was started for, none of them denied. Everything else is checked once the CAR is whole.
 */
function headerCheck(
  want: { imgCid: string; metaCid: string },
  deny: (cid: string) => boolean,
): TransformStream<Uint8Array, Uint8Array> {
  let seen = new Uint8Array(0)
  let done = false
  return new TransformStream({
    transform(chunk, controller) {
      if (!done) {
        const joined = new Uint8Array(seen.byteLength + chunk.byteLength)
        joined.set(seen)
        joined.set(chunk, seen.byteLength)
        seen = joined
        const prefix = readVarint(seen.subarray(0, 8))
        if (prefix !== null && seen.byteLength >= prefix[0] + prefix[1]) {
          done = true
          let roots: string[] = []
          try {
            const header = dagCbor.decode(seen.subarray(prefix[1], prefix[1] + prefix[0])) as {
              roots?: unknown[]
            }
            roots = (header.roots ?? []).map((root) => CIDClass.asCID(root)?.toString() ?? '')
          } catch {
            throw new CarRejected('malformed CAR: the header does not decode')
          }
          const denied = roots.find(deny)
          if (denied !== undefined) throw new CarRejected(`${denied} is not accepted here`)
          if (roots.length !== 2 || roots[0] !== want.imgCid || roots[1] !== want.metaCid) {
            throw new CarRejected('the CAR does not carry the roots this upload was started for')
          }
        } else if (seen.byteLength > 4096) {
          throw new CarRejected('malformed CAR: the header is too long')
        }
      }
      controller.enqueue(chunk)
    },
  })
}

/** `PUT /upload/parts/<id>/<n>`: one part, exactly the size its place in the CAR says. */
async function putPart(
  request: Request,
  env: HostingEnv,
  config: ReturnType<typeof hostingConfig>,
  upload: PartsUpload & { uploadId: string },
  n: number,
  deny: (cid: string) => boolean,
): Promise<Response> {
  if (config.paused) return refuse(503, 'uploads are paused')
  const count = Math.ceil(upload.bytes / upload.partSize)
  if (!Number.isInteger(n) || n < 1 || n > count) {
    return refuse(400, `this upload has parts 1 to ${count}`)
  }
  const expected = n < count ? upload.partSize : upload.bytes - (count - 1) * upload.partSize
  const length = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (length !== expected) return refuse(400, `part ${n} must be exactly ${expected} bytes`)
  if (request.body === null) return refuse(400, 'the part is empty')

  const multipart = env.ART_HOSTED!.resumeMultipartUpload(carKey(upload.id), upload.uploadId)
  let body = request.body
  let check: TransformStream<Uint8Array, Uint8Array> | null = null
  if (n === 1) {
    check = headerCheck(upload, deny)
    body = body.pipeThrough(check)
  }
  const sized = sizedStream(expected)
  try {
    const piping = body.pipeTo(sized.writable)
    const [uploaded] = await Promise.all([multipart.uploadPart(n, sized.readable), piping])
    const part: Part = { n, etag: uploaded.etag, bytes: expected }
    await callLedger(env, { op: 'part', id: upload.id, part })
  } catch (error) {
    if (error instanceof CarRejected) return refuse(400, error.message)
    return refuse(500, `part ${n} could not be stored; send it again`)
  }
  return json({ part: n })
}

/** Stream a stored object through the verifier, keeping nothing but what the verifier keeps. */
async function verifyStored(
  bucket: R2Bucket,
  key: string,
  deny: (cid: string) => boolean,
): Promise<VerifiedCar> {
  const object = await bucket.get(key)
  if (object === null) throw new Error('the assembled upload is missing')
  const { stream, result } = verifyingStream((roots: CID[]) => {
    const denied = roots.find((root) => deny(root.toString()))
    if (denied !== undefined) throw new CarRejected(`${denied} is not accepted here`)
  })
  await object.body.pipeThrough(stream).pipeTo(new WritableStream())
  return result
}

/**
 * `POST /upload/parts/<id>/complete`: assemble the parts, then verify the WHOLE CAR — every block
 * against its CID, the shape, the metadata — before anything is indexed or served.
 *
 * Safe to call again: if the parts were already assembled (the answer to an earlier call was lost),
 * the stored CAR is verified as it stands.
 */
async function completeParts(
  env: HostingEnv,
  wallet: string,
  upload: PartsUpload & { uploadId: string },
  deny: (cid: string) => boolean,
  deps: HostingDeps,
  onCommitted: ((images: RootIndex) => void) | undefined,
): Promise<Response> {
  const bucket = env.ART_HOSTED!
  const key = carKey(upload.id)
  const count = Math.ceil(upload.bytes / upload.partSize)
  const parts = await callLedger<Part[]>(env, { op: 'parts', id: upload.id })
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => !parts.some((p) => p.n === n),
  )
  if (missing.length > 0) {
    return refuse(409, `parts ${missing.slice(0, 10).join(', ')} have not arrived yet`)
  }

  const stored = await bucket.head(key)
  if (stored === null) {
    try {
      await bucket
        .resumeMultipartUpload(key, upload.uploadId)
        .complete(parts.map((p) => ({ partNumber: p.n, etag: p.etag })))
    } catch {
      return refuse(500, 'the parts could not be assembled; try completing again')
    }
  } else if (stored.size !== upload.bytes) {
    await Promise.allSettled([bucket.delete(key), callLedger(env, { op: 'release', id: upload.id })])
    return refuse(400, 'the assembled upload is not the size it was started with')
  }

  let verified: VerifiedCar
  try {
    verified = await verifyStored(bucket, key, deny)
  } catch (error) {
    await Promise.allSettled([
      bucket.delete([key, metaCarKey(upload.id)]),
      callLedger(env, { op: 'release', id: upload.id }),
    ])
    return error instanceof CarRejected
      ? refuse(400, error.message)
      : refuse(500, 'the upload could not be checked')
  }
  return commitVerified(env, wallet, upload.id, verified, upload, deps, onCommitted)
}

/**
 * A writable/readable pair that tells storage the length up front.
 *
 * R2 needs to know a streamed body's length before it starts. `FixedLengthStream` is the runtime's
 * way of saying so, and it also errors if the body turns out to be a different length from the one
 * declared — a second check on the Content-Length the caps were reserved against. Outside the
 * runtime (tests) a plain TransformStream stands in.
 */
function sizedStream(length: number): TransformStream<Uint8Array, Uint8Array> {
  const Fixed = (globalThis as { FixedLengthStream?: typeof FixedLengthStream }).FixedLengthStream
  return Fixed === undefined ? new TransformStream() : new Fixed(length)
}

async function bind(
  request: Request,
  env: HostingEnv,
  config: ReturnType<typeof hostingConfig>,
  deps: HostingDeps,
): Promise<Response> {
  if (config.rpcUrl === null || config.registry === null) {
    return refuse(503, 'binding is not configured on this deployment')
  }
  let body: { instance?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return refuse(400, 'expected JSON')
  }
  if (typeof body.instance !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.instance)) {
    return refuse(400, 'expected { instance: <address> }')
  }
  const instance = body.instance as `0x${string}`
  let facts: Awaited<ReturnType<ReadInstance>>
  try {
    facts = await deps.readInstance(config.rpcUrl, config.registry, instance)
  } catch {
    return refuse(502, 'the chain could not be read; try again')
  }
  if (!facts.registered) return refuse(404, 'that is not a registered collection')
  const cid = baseCid(facts.metadataURI)
  if (cid === null) return refuse(404, 'that collection does not point at hosted art')
  const draft = await callLedger<Draft | null>(env, {
    op: 'bind',
    metaCid: cid,
    instance,
    now: deps.now(),
  })
  if (draft === null) return refuse(404, 'no hosted upload matches that collection')
  return json({ draft: publicDraft(draft) })
}

/** Headers every hosted byte is served with. Our content type, never sniffed, never a document. */
function hostedHeaders(type: string, length: number): Headers {
  return new Headers({
    'content-type': type,
    'content-length': String(length),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-art-cache': 'hosted',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
  })
}

/** The hosted file for `<cid>/<name>`, its index and its bytes, or null when it is not hosted. */
export async function readHosted(
  env: HostingEnv,
  cid: string,
  name: string,
): Promise<{ index: HostedIndex; type: string; bytes: Uint8Array } | null> {
  if (env.ART_HOSTED === undefined || name === '') return null
  const index = await loadIndex(env.ART_HOSTED, cid)
  if (index === null) return null
  const file = Object.prototype.hasOwnProperty.call(index.files, name)
    ? index.files[name]
    : undefined
  if (file === undefined) return null
  const bytes = await readHostedFile(env.ART_HOSTED, index, file)
  if (bytes === null) {
    // The CAR went (hosting ended) while this isolate still remembered its index.
    forgetIndex(cid)
    return null
  }
  return { index, type: file.type, bytes }
}

/**
 * `GET /hosting/<instance>`: the record for a launched collection — whether it has graduated or
 * moved to IPFS, its roots, and the piece names the migrated metadata is built from. Public: it is a fact about a public
 * collection, and the app shows it to every visitor. 404 when nothing is hosted for it.
 */
export async function handleHostingStatus(
  env: HostingEnv,
  instance: string,
  deps: Pick<HostingDeps, 'now'> = DEFAULT_DEPS,
): Promise<Response> {
  if (env.HOSTING_LEDGER === undefined) return refuse(404, 'this deployment hosts nothing')
  if (!/^0x[0-9a-fA-F]{40}$/.test(instance)) return refuse(400, 'expected /hosting/<address>')
  const status = await callLedger<unknown>(env, {
    op: 'hosting',
    instance: instance.toLowerCase(),
    now: deps.now(),
  })
  if (status === null) return refuse(404, 'nothing is hosted for that collection')
  return new Response(JSON.stringify(status), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short: the state moves on the watcher's schedule.
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** A hosted file as a response, or null so the caller falls through to the cache and the roster. */
export async function serveHostedFile(
  env: HostingEnv,
  cid: string,
  name: string,
  method: string,
): Promise<Response | null> {
  const hosted = await readHosted(env, cid, name)
  if (hosted === null) return null
  const headers = hostedHeaders(hosted.type, hosted.bytes.byteLength)
  return new Response(method === 'HEAD' ? null : hosted.bytes, { headers })
}

/**
 * The CAR for a hosted root. For the images root, the whole upload — what a creator imports into
 * IPFS to move the art. For the metadata root, just the metadata when it was kept on its own, which
 * is what a visitor's browser checks a move against; the whole upload for older ones.
 */
export async function serveCar(env: HostingEnv, cid: string, method: string): Promise<Response> {
  const bucket = env.ART_HOSTED
  const index = bucket === undefined ? null : await loadIndex(bucket, cid)
  const object =
    index === null
      ? null
      : ((index.metaCar === undefined ? null : await bucket!.get(index.metaCar)) ??
        (await bucket!.get(index.car)))
  if (object === null) return new Response('not hosted here', { status: 404 })
  return new Response(method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': 'application/vnd.ipld.car; version=1',
      'content-length': String(object.size),
      'content-disposition': `attachment; filename="${cid}.car"`,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  })
}
