/**
 * The resumable uploader against a scripted host: parts already held are skipped, a dropped part is
 * retried, an expired session is renewed, and a refusal stops the upload with the host's reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadResumable, type UploadProgress, type UploadSource } from './hostClient'

const HOST = 'https://art.example'
const PART = 10

function source(size: number): UploadSource {
  const bytes = Uint8Array.from({ length: size }, (_, i) => i & 0xff)
  return {
    imgCid: 'img',
    metaCid: 'meta',
    size,
    read: async (start, end) => bytes.slice(start, end),
  }
}

/** What the scripted host does with one PUT of a part: answer, or drop the connection. */
type PartAnswer = { status: number; error?: string } | 'drop'

let held: number[]
let partAnswers: Map<number, PartAnswer[]>
let received: Map<number, Uint8Array>
let tokensSeen: string[]
let duplicate: boolean

class FakeXhr {
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  status = 0
  responseText = ''
  private url = ''
  private headers: Record<string, string> = {}
  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: Uint8Array) {
    const n = Number(this.url.split('/').pop())
    tokensSeen.push(this.headers['authorization']!)
    const answer = partAnswers.get(n)?.shift() ?? { status: 200 }
    setTimeout(() => {
      this.upload.onprogress?.({ loaded: Math.floor(body.byteLength / 2) })
      if (answer === 'drop') return this.onerror?.()
      this.status = answer.status
      this.responseText = JSON.stringify(answer.error ? { error: answer.error } : { part: n })
      if (answer.status === 200) received.set(n, body)
      this.onload?.()
    }, 0)
  }
}

beforeEach(() => {
  held = []
  partAnswers = new Map()
  received = new Map()
  tokensSeen = []
  duplicate = false
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/upload/parts')) {
        if (duplicate) {
          return Response.json({ draft: { id: 'd', state: 'open' }, duplicate: true })
        }
        return Response.json({
          upload: {
            id: 'u1',
            bytes: 25,
            partSize: PART,
            parts: held,
            imgCid: 'img',
            metaCid: 'meta',
          },
        })
      }
      if (url.endsWith('/complete')) {
        return Response.json(
          { draft: { id: 'u1', state: 'open' }, duplicate: false },
          { status: 201 },
        )
      }
      return new Response('{}', { status: 404 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const token = vi.fn(async (fresh: boolean) => (fresh ? 'fresh' : 'first'))

describe('uploadResumable', () => {
  it('sends every part, retrying one the connection dropped', async () => {
    partAnswers.set(2, ['drop'])
    const progress: UploadProgress[] = []
    const result = await uploadResumable(HOST, token, source(25), (p) => progress.push(p), {
      retryDelayMs: 1,
    })
    expect(result.draft.state).toBe('open')
    expect([...received.keys()].sort()).toEqual([1, 2, 3])
    expect(received.get(3)).toEqual(Uint8Array.from([20, 21, 22, 23, 24]))
    expect(progress.some((p) => p.retrying === 'connection lost; retrying part 2 of 3')).toBe(true)
    expect(progress.at(-1)).toMatchObject({ stage: 'verifying', sent: 25, resumedFrom: 0 })
  })

  it('skips the parts the host already holds, and says how much was resumed', async () => {
    held = [1, 3]
    const progress: UploadProgress[] = []
    await uploadResumable(HOST, token, source(25), (p) => progress.push(p), { retryDelayMs: 1 })
    expect([...received.keys()]).toEqual([2])
    expect(progress[0]).toMatchObject({ stage: 'uploading', sent: 15, resumedFrom: 15 })
  })

  it('signs in again when the session expires mid-upload', async () => {
    partAnswers.set(2, [{ status: 401, error: 'sign in first' }])
    await uploadResumable(HOST, token, source(25), undefined, { retryDelayMs: 1 })
    expect(token).toHaveBeenCalledWith(true)
    expect(tokensSeen.at(-1)).toBe('Bearer fresh')
    expect([...received.keys()].sort()).toEqual([1, 2, 3])
  })

  it('sends nothing when the host already has these roots', async () => {
    duplicate = true
    const result = await uploadResumable(HOST, token, source(25), undefined, { retryDelayMs: 1 })
    expect(result.duplicate).toBe(true)
    expect(received.size).toBe(0)
  })

  it('stops on a refusal, with the host’s reason', async () => {
    partAnswers.set(1, [{ status: 400, error: 'the CAR does not carry the roots' }])
    await expect(
      uploadResumable(HOST, token, source(25), undefined, { retryDelayMs: 1 }),
    ).rejects.toThrow('the CAR does not carry the roots')
  })

  it('gives up after repeated drops, keeping what arrived for the next try', async () => {
    partAnswers.set(
      3,
      Array.from({ length: 6 }, () => 'drop' as const),
    )
    await expect(
      uploadResumable(HOST, token, source(25), undefined, { retryDelayMs: 1 }),
    ).rejects.toThrow(/connection to the art host dropped/)
    expect([...received.keys()].sort()).toEqual([1, 2])
  })
})
