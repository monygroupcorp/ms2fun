/**
 * The art service's own tests.
 *
 * This worker had none, and nothing in CI read it as anything but text: the app's
 * `artService.contract.test.ts` greps it for the width rungs and the route prefix, which catches a
 * drift between the two packages and nothing about whether the thing works. It is the piece that
 * answers a stranger's first request, so the properties that cost money or cost a takedown are
 * asserted here rather than inferred from the source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import worker, { leadGateway, type Env } from './worker'

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const OTHER = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'

/** An R2 stand-in that records what was asked of it. */
function bucket(seed: Record<string, string> = {}) {
  const objects = new Map<string, string>(Object.entries(seed))
  // Named apart from the methods on purpose: a recorder called `put` beside a method called `put`
  // is shadowed by it in the returned object, and the assertion then compares against a function.
  const deletedKeys: string[] = []
  const putKeys: string[] = []
  return {
    deletedKeys,
    putKeys,
    objects,
    async get(key: string) {
      const body = objects.get(key)
      if (body === undefined) return null
      // `text()` as well as `body`: the art path streams the body through, the metadata path reads
      // it, and a stub that offers only one of those passes the wrong half of the worker.
      return {
        body,
        httpMetadata: { contentType: 'image/png' },
        text: async () => body,
      }
    },
    async put(key: string, _body: unknown, _opts?: unknown) {
      putKeys.push(key)
      objects.set(key, 'stored')
    },
    async delete(key: string) {
      deletedKeys.push(key)
      objects.delete(key)
    },
  }
}

// `Omit` first: intersecting `Partial<Env>` with a looser ART_CACHE keeps the stricter R2Bucket,
// so the stub would not be assignable at any call site.
function env(over: Omit<Partial<Env>, 'ART_CACHE'> & { ART_CACHE?: unknown } = {}): Env {
  return {
    ART_CACHE: (over.ART_CACHE ?? bucket()) as Env['ART_CACHE'],
    ...(over.ART_WIDTHS === undefined ? {} : { ART_WIDTHS: over.ART_WIDTHS }),
    ...(over.ART_DENYLIST === undefined ? {} : { ART_DENYLIST: over.ART_DENYLIST }),
    ...(over.ART_GATEWAY_LEAD === undefined
      ? {}
      : { ART_GATEWAY_LEAD: over.ART_GATEWAY_LEAD }),
  }
}

/** Collects `waitUntil` work so a test can await the writes a response did not wait for. */
function ctx() {
  const pending: Promise<unknown>[] = []
  return {
    pending,
    settle: () => Promise.allSettled(pending),
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext & { settle: () => Promise<unknown>; pending: Promise<unknown>[] }
}

function req(path: string, width = 320, method = 'GET'): Request {
  return new Request(`https://art.example/art/${path}?w=${width}`, { method })
}

const fetchMock = vi.fn()

/**
 * A FRESH Response per call, always. A `Response` carries a single-use body stream, so handing the
 * same instance to two calls fails with "ReadableStream is locked" — which looks exactly like a bug
 * in the worker's tee and is a bug in the harness.
 */
function art(headers: Record<string, string> = {}): Response {
  return new Response('bytes', {
    status: 200,
    headers: { 'content-type': 'image/png', ...headers },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => art())
})

describe('the request it answers', () => {
  it('serves a miss from the roster and stores it', async () => {
    const b = bucket()
    const c = ctx()
    const res = await worker.fetch(req(CID), env({ ART_CACHE: b }), c)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-art-cache')).toBe('miss')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await c.settle()
    expect(b.putKeys).toEqual([`${CID}@w320`])
  })

  it('serves a hit without asking any gateway', async () => {
    const b = bucket({ [`${CID}@w320`]: 'cached' })
    const res = await worker.fetch(req(CID), env({ ART_CACHE: b }), ctx())

    expect(res.status).toBe(200)
    expect(res.headers.get('x-art-cache')).toBe('hit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks gateways ONE AT A TIME, stopping at the first that answers', async () => {
    fetchMock.mockReset()
    fetchMock
      .mockImplementationOnce(async () => new Response('no', { status: 504 }))
      .mockImplementationOnce(async () => art())

    const res = await worker.fetch(req(CID), env(), ctx())

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('answers 502 when every operator fails, so the app cools it and falls back', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response('no', { status: 504 }))

    const res = await worker.fetch(req(CID), env(), ctx())

    expect(res.status).toBe(502)
  })

  it('refuses an unrecognised width instead of snapping it to a rung', async () => {
    const res = await worker.fetch(req(CID, 321), env(), ctx())

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a path that could climb out of its CID', async () => {
    const res = await worker.fetch(req(`${CID}/../secret`), env(), ctx())

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a method that is not a read', async () => {
    const res = await worker.fetch(req(CID, 320, 'DELETE'), env(), ctx())

    expect(res.status).toBe(405)
  })

  it('proxies an object too large to cache without storing it', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => art({ 'content-length': String(64 * 1024 * 1024) }))
    const b = bucket()
    const c = ctx()

    const res = await worker.fetch(req(CID), env({ ART_CACHE: b }), c)

    expect(res.status).toBe(200)
    await c.settle()
    expect(b.putKeys).toEqual([])
  })
})

/**
 * The denylist is the takedown path, and its whole value is that it holds. A list that only took
 * effect after the next eviction would be a pause, and a 410 cached at the edge would outlive the
 * decision that produced it.
 */
describe('the denylist', () => {
  it('refuses a denied CID with 410, before spending a request on it', async () => {
    const res = await worker.fetch(req(CID), env({ ART_DENYLIST: CID }), ctx())

    expect(res.status).toBe(410)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops what it had already cached, at every rung and not just the one asked for', async () => {
    const b = bucket({ [`${CID}@w320`]: 'cached', [`${CID}@w1024`]: 'cached' })
    const c = ctx()

    await worker.fetch(req(CID), env({ ART_CACHE: b, ART_DENYLIST: CID }), c)
    await c.settle()

    // The metadata document goes too: a takedown is about the work, not one representation of it.
    expect(b.deletedKeys.sort()).toEqual(
      [`${CID}@w1024`, `${CID}@w320`, `${CID}@w640`, `meta/${CID}`].sort(),
    )
    expect(b.objects.size).toBe(0)
  })

  it('serves a cached copy to NOBODY once denied — the deny beats the hit', async () => {
    const b = bucket({ [`${CID}@w320`]: 'cached' })

    const res = await worker.fetch(req(CID), env({ ART_CACHE: b, ART_DENYLIST: CID }), ctx())

    expect(res.status).toBe(410)
  })

  it('is never cached at the edge, so removing an entry takes effect at once', async () => {
    const res = await worker.fetch(req(CID), env({ ART_DENYLIST: CID }), ctx())

    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('denies every path under a denied CID — a takedown is about the work', async () => {
    const res = await worker.fetch(req(`${CID}/1.png`), env({ ART_DENYLIST: CID }), ctx())

    expect(res.status).toBe(410)
  })

  it('accepts an entry pasted as a full pointer or a path', async () => {
    for (const entry of [`ipfs://${CID}`, `ipfs/${CID}`, `${CID}/1.png`]) {
      const res = await worker.fetch(req(CID), env({ ART_DENYLIST: entry }), ctx())
      expect(res.status, `entry ${entry} denied nothing`).toBe(410)
    }
  })

  it('accepts a list separated by commas, spaces or newlines', async () => {
    const list = `${OTHER},\n  ${CID}  `
    const res = await worker.fetch(req(CID), env({ ART_DENYLIST: list }), ctx())

    expect(res.status).toBe(410)
  })

  it('leaves everything not on the list alone', async () => {
    const res = await worker.fetch(req(CID), env({ ART_DENYLIST: OTHER }), ctx())

    expect(res.status).toBe(200)
  })

  it('an empty or absent list denies nothing', async () => {
    for (const ART_DENYLIST of [undefined, '', '   ', ',,']) {
      const res = await worker.fetch(req(CID), env({ ART_DENYLIST }), ctx())
      expect(res.status, `list ${JSON.stringify(ART_DENYLIST)} refused a request`).toBe(200)
    }
  })
})

/**
 * The metadata half. A card cannot render art until it has read the JSON naming the art's CID, so a
 * grid served art from here and JSON from a public gateway still spends one metered third-party
 * request per card — and spends it FIRST, before anything appears. These assert the document path
 * carries the same protections as the art path, plus the one it needs that art does not: a gateway
 * that answers 200 with an HTML error page must never be stored as somebody's metadata.
 */
describe('the metadata route', () => {
  const DOC = '{"name":"A collection","image":"ipfs://QmArt"}'

  function metaReq(path: string, method = 'GET'): Request {
    return new Request(`https://art.example/meta/${path}`, { method })
  }

  function jsonAnswer(body = DOC, headers: Record<string, string> = {}): Response {
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }

  it('serves a miss from the roster and stores it under its own key', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonAnswer())
    const b = bucket()
    const c = ctx()

    const res = await worker.fetch(metaReq(CID), env({ ART_CACHE: b }), c)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-art-cache')).toBe('miss')
    expect(await res.text()).toBe(DOC)
    await c.settle()
    expect(b.putKeys).toEqual([`meta/${CID}`])
  })

  it('serves it as JSON whatever the gateway called it', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () =>
      jsonAnswer(DOC, { 'content-type': 'application/octet-stream' }),
    )

    const res = await worker.fetch(metaReq(CID), env(), ctx())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('serves a hit without asking any gateway', async () => {
    const b = bucket({ [`meta/${CID}`]: DOC })

    const res = await worker.fetch(metaReq(CID), env({ ART_CACHE: b }), ctx())

    expect(res.headers.get('x-art-cache')).toBe('hit')
    expect(await res.text()).toBe(DOC)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never collides with an art key for the same CID', async () => {
    const b = bucket({ [`${CID}@w320`]: 'the-image-bytes' })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonAnswer())

    const res = await worker.fetch(metaReq(CID), env({ ART_CACHE: b }), ctx())

    expect(await res.text()).toBe(DOC)
  })

  it('REFUSES an HTML error page a gateway answered 200 with', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(
      async () =>
        new Response('<html><body>not found</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const b = bucket()
    const c = ctx()

    const res = await worker.fetch(metaReq(CID), env({ ART_CACHE: b }), c)

    expect(res.status).toBe(502)
    await c.settle()
    expect(b.putKeys).toEqual([])
  })

  it('refuses a body that does not parse, however it is labelled', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonAnswer('{"truncated":'))

    const res = await worker.fetch(metaReq(CID), env(), ctx())

    expect(res.status).toBe(502)
  })

  it('refuses a document far too large to be metadata', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonAnswer(`{"x":"${'a'.repeat(600 * 1024)}"}`))

    const res = await worker.fetch(metaReq(CID), env(), ctx())

    expect(res.status).toBe(502)
  })

  it('moves to the next operator when one answers badly', async () => {
    fetchMock.mockReset()
    fetchMock
      .mockImplementationOnce(async () => new Response('no', { status: 504 }))
      .mockImplementationOnce(async () => jsonAnswer())

    const res = await worker.fetch(metaReq(CID), env(), ctx())

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('answers 502 when every operator fails, so the app falls back to the roster', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response('no', { status: 504 }))

    expect((await worker.fetch(metaReq(CID), env(), ctx())).status).toBe(502)
  })

  it('honours the denylist, and does not spend a request on a denied CID', async () => {
    const res = await worker.fetch(metaReq(CID), env({ ART_DENYLIST: CID }), ctx())

    expect(res.status).toBe(410)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a path that could climb out of its CID', async () => {
    expect((await worker.fetch(metaReq(`${CID}/../x`), env(), ctx())).status).toBe(400)
  })

  it('refuses a method that is not a read', async () => {
    expect((await worker.fetch(metaReq(CID, 'POST'), env(), ctx())).status).toBe(405)
  })

  it('leaves an unknown route alone', async () => {
    const res = await worker.fetch(new Request('https://art.example/nope'), env(), ctx())
    expect(res.status).toBe(404)
  })
})

describe('leadGateway', () => {
  it('accepts an origin and supplies the /ipfs/ path itself', () => {
    expect(leadGateway('https://x.mypinata.cloud')).toEqual({
      operator: 'lead',
      form: 'path',
      base: 'https://x.mypinata.cloud/ipfs/',
    })
  })

  it('accepts the same value written as a full base, however it is punctuated', () => {
    const want = 'https://x.mypinata.cloud/ipfs/'
    expect(leadGateway('https://x.mypinata.cloud/ipfs')?.base).toBe(want)
    expect(leadGateway('https://x.mypinata.cloud/ipfs/')?.base).toBe(want)
    expect(leadGateway('  https://x.mypinata.cloud//  ')?.base).toBe(want)
  })

  it('names no gateway when unset, which is the supported default', () => {
    expect(leadGateway(undefined)).toBeNull()
    expect(leadGateway('')).toBeNull()
    expect(leadGateway('   ')).toBeNull()
  })

  // A broken lead kept in the list would be a guaranteed timeout at the head of every fetch, which
  // is strictly worse than having no lead at all.
  it('ignores a value that is not an https origin rather than prepending a broken entry', () => {
    expect(leadGateway('x.mypinata.cloud')).toBeNull()
    expect(leadGateway('http://x.mypinata.cloud')).toBeNull()
    expect(leadGateway('javascript:alert(1)')).toBeNull()
  })
})

describe('the lead gateway in the roster', () => {
  const LEAD = 'https://x.mypinata.cloud'

  it('is asked before any public gateway', async () => {
    await worker.fetch(req(CID), env({ ART_GATEWAY_LEAD: LEAD }), ctx())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${LEAD}/ipfs/${CID}`)
  })

  it('is asked first on the metadata path too, which is the request a card makes FIRST', async () => {
    fetchMock.mockImplementation(async () => new Response('{"name":"x"}', { status: 200 }))
    const r = new Request(`https://art.example/meta/${CID}`)
    await worker.fetch(r, env({ ART_GATEWAY_LEAD: LEAD }), ctx())
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${LEAD}/ipfs/${CID}`)
  })

  // It LEADS the roster, it does not replace it.
  it('falls through to the public roster when the lead does not answer', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 504 }))
    const res = await worker.fetch(req(CID), env({ ART_GATEWAY_LEAD: LEAD }), ctx())

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('mypinata.cloud')
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('mypinata.cloud')
  })

  it('asks only the public roster when no lead is configured, exactly as before', async () => {
    await worker.fetch(req(CID), env(), ctx())
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('mypinata.cloud')
  })

  it('does not let a malformed lead cost a request', async () => {
    await worker.fetch(req(CID), env({ ART_GATEWAY_LEAD: 'x.mypinata.cloud' }), ctx())
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('mypinata.cloud')
  })
})
