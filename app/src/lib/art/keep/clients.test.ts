/**
 * The small clients behind the panel: what a plan pins, the retrievability check that never counts
 * our host, the node RPC (detection, the CORS-refusal path, import, pin confirmation), and the
 * Pinning Service API (token handling, errors, endpoints).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IpfsGateway } from '../../metadata/gateways'
import {
  DEFAULT_NODE_API,
  detectNode,
  importCar,
  normaliseEndpoint,
  originsToAllow,
  pinType,
  setupCommands,
} from './kubo'
import { baseRootCid, imageRootOf, keepPlan, onChainRoots } from './plan'
import {
  PSA_PRESETS,
  PsaError,
  loadService,
  normaliseServiceEndpoint,
  pinStatus,
  requestPin,
  saveService,
} from './psa'
import { checkRoot, checkRoots, independentGateways } from './retrievable'

const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const META = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
const NEXT = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'
const HOST = 'https://art.example'

const status = (over: object = {}) => ({
  instance: '0x1',
  state: 'hosted' as const,
  imgCid: IMG,
  metaCid: META,
  migrationCid: NEXT,
  pieces: ['3.png', '1.png'],
  migrated: false,
  boundAt: 0,
  graduatedAt: null,
  migratedAt: null,
  ...over,
})

describe('keepPlan', () => {
  it('reads the metadata root from either kind of base', () => {
    expect(baseRootCid(`ipfs://${META}/`)).toBe(META)
    expect(baseRootCid(`https://gw.example/ipfs/${META}/`)).toBe(META)
    expect(baseRootCid('https://example.com/meta/')).toBeNull()
    expect(keepPlan('https://example.com/meta/', null, HOST)).toBeNull()
  })

  it('a hosted collection keeps its images, its hosted metadata, and samples piece 1', () => {
    const plan = keepPlan(`${HOST}/ipfs/${META}/`, status(), HOST)!
    expect(plan.kind).toBe('hosted')
    expect(plan.nextMetaCid).toBe(NEXT)
    expect(onChainRoots(plan)).toEqual([
      { role: 'images', cid: IMG, sample: '3.png' },
      { role: 'metadata', cid: META, sample: '1' },
    ])
  })

  it('a migrated collection keeps the root on chain, rebuilt from the hosted one', () => {
    const plan = keepPlan(`ipfs://${NEXT}/`, status({ state: 'migrated' }), HOST)!
    expect(plan).toMatchObject({
      kind: 'migrated',
      metaCid: NEXT,
      hostedMetaCid: META,
      imgCid: IMG,
    })
  })

  it('anything else content-addressed comes from the public roster', () => {
    const plan = keepPlan(`ipfs://${META}/`, null, HOST)!
    expect(plan).toMatchObject({ kind: 'ipfs', host: null, imgCid: null })
    // A record that does not match the base is not trusted to describe it.
    expect(keepPlan(`ipfs://${IMG}/`, status(), HOST)!.kind).toBe('ipfs')
  })

  it('finds an image root in either link shape', () => {
    expect(imageRootOf(`ipfs://${IMG}/7.png`)).toEqual({ cid: IMG, file: '7.png' })
    expect(imageRootOf(`https://x.example/ipfs/${IMG}/7.png`)).toEqual({ cid: IMG, file: '7.png' })
    expect(imageRootOf(`ipfs://${IMG}`)).toBeNull()
    expect(imageRootOf(42)).toBeNull()
  })
})

describe('retrievability', () => {
  const PUBLIC: IpfsGateway = { operator: 'Public', form: 'path', base: 'https://gw.example/ipfs/' }
  const OURS: IpfsGateway = { operator: 'Ours', form: 'path', base: `${HOST}/ipfs/` }

  it('never counts our own host', () => {
    expect(independentGateways([HOST, null], [OURS, PUBLIC])).toEqual([PUBLIC])
  })

  it('asks for a sampled file with HEAD, and the root block alone when there is none', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
    )
    const checks = await checkRoots(
      [
        { role: 'images', cid: IMG, sample: '1.png' },
        { role: 'metadata', cid: META },
      ],
      { gateways: [PUBLIC], fetcher: fetcher as unknown as typeof fetch },
    )
    expect(checks.map((c) => c.ok)).toEqual([true, true])
    expect(fetcher.mock.calls.map((c) => [String(c[0]), (c[1] as RequestInit).method])).toEqual([
      [`https://gw.example/ipfs/${IMG}/1.png`, 'HEAD'],
      [`https://gw.example/ipfs/${META}?format=raw`, 'HEAD'],
    ])
  })

  it('falls back to a one-byte range when HEAD is refused, and reports a miss', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 405 })
        : new Response('x', { status: 206 }),
    )
    const ok = await checkRoot(
      { role: 'images', cid: IMG, sample: '1.png' },
      {
        gateways: [PUBLIC],
        fetcher: fetcher as unknown as typeof fetch,
      },
    )
    expect(ok).toMatchObject({ ok: true, operator: 'Public' })
    expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get('range')).toBe('bytes=0-0')

    const missing = await checkRoot(
      { role: 'metadata', cid: META },
      {
        gateways: [PUBLIC],
        fetcher: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      },
    )
    expect(missing).toMatchObject({ ok: false, operator: null })
  })
})

describe('node RPC', () => {
  it('accepts only plain http(s) endpoints', () => {
    expect(normaliseEndpoint('http://127.0.0.1:5001/')).toBe(DEFAULT_NODE_API)
    expect(normaliseEndpoint('http://127.0.0.1:5001/api/v0')).toBe(DEFAULT_NODE_API)
    expect(normaliseEndpoint('https://node.example/ipfs')).toBe('https://node.example/ipfs')
    expect(normaliseEndpoint('javascript:alert(1)')).toBeNull()
    expect(normaliseEndpoint('file:///etc/passwd')).toBeNull()
    expect(normaliseEndpoint('http://user:pw@127.0.0.1:5001')).toBeNull()
    expect(normaliseEndpoint('http://127.0.0.1:5001/?x=1')).toBeNull()
    expect(normaliseEndpoint('')).toBeNull()
  })

  it('detects a node that answers, with a POST to /api/v0/id', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ID: '12D3KooW', AgentVersion: 'kubo/0.43.1' })),
    )
    const found = await detectNode(DEFAULT_NODE_API, fetcher as unknown as typeof fetch)
    expect(found).toEqual({ kind: 'ready', node: { id: '12D3KooW', agentVersion: 'kubo/0.43.1' } })
    expect(fetcher.mock.calls[0]![0]).toBe(`${DEFAULT_NODE_API}/api/v0/id`)
    expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'POST' })
  })

  it('tells a CORS refusal from a node that is not there', async () => {
    // The page cannot read the answer, but an opaque request completes: something is listening.
    const corsRefused = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 })
      throw new TypeError('Failed to fetch')
    })
    expect(await detectNode(DEFAULT_NODE_API, corsRefused as unknown as typeof fetch)).toEqual({
      kind: 'blocked',
    })
    // kubo refuses an origin it was not told about with a 403.
    const forbidden = async () => new Response('403 - Forbidden', { status: 403 })
    expect(await detectNode(DEFAULT_NODE_API, forbidden as unknown as typeof fetch)).toEqual({
      kind: 'blocked',
    })
    const nothing = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await detectNode(DEFAULT_NODE_API, nothing as unknown as typeof fetch)).toEqual({
      kind: 'unreachable',
    })
  })

  it('spells out the setup for this origin and the published ones, keeping the web UI', () => {
    const origins = originsToAllow('https://ms2.fun', [
      'https://ms2.fun',
      'https://noesis.gwei.domains',
    ])
    expect(origins).toEqual(['https://ms2.fun', 'https://noesis.gwei.domains'])
    const [allow, methods] = setupCommands(DEFAULT_NODE_API, origins)
    expect(allow).toBe(
      `ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["https://ms2.fun","https://noesis.gwei.domains","http://127.0.0.1:5001","https://webui.ipfs.io"]'`,
    )
    expect(methods).toBe(
      `ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["POST"]'`,
    )
  })

  it('imports a CAR with pin-roots and reads every root the node reports', async () => {
    const upload = vi.fn(
      async (_url: string, body: FormData, progress: (s: number, t: number) => void) => {
        progress(10, 10)
        expect(body.get('file')).toBeInstanceOf(Blob)
        return {
          status: 200,
          text: [
            `{"Root":{"Cid":{"/":"${IMG}"},"PinErrorMsg":""}}`,
            `{"Root":{"Cid":{"/":"${META}"},"PinErrorMsg":"blockstore full"}}`,
            '{"Stats":{"BlockCount":12,"BlockBytesCount":1234}}',
            '',
          ].join('\n'),
        }
      },
    )
    const result = await importCar(DEFAULT_NODE_API, new Blob(['car']), 'x.car', () => {}, upload)
    expect(upload.mock.calls[0]![0]).toBe(
      `${DEFAULT_NODE_API}/api/v0/dag/import?pin-roots=true&stats=true`,
    )
    expect(result.roots).toEqual([
      { cid: IMG, pinError: '' },
      { cid: META, pinError: 'blockstore full' },
    ])
  })

  it('reports the node’s own error message when an import fails', async () => {
    const upload = async () => ({ status: 500, text: '{"Message":"no space left on device"}' })
    await expect(
      importCar(DEFAULT_NODE_API, new Blob(['car']), 'x.car', () => {}, upload),
    ).rejects.toThrow('no space left on device')
  })

  it('confirms a pin with pin/ls, and reads "not pinned" as no pin', async () => {
    const pinned = async () =>
      new Response(JSON.stringify({ Keys: { [IMG]: { Type: 'recursive' } } }))
    expect(await pinType(DEFAULT_NODE_API, IMG, pinned as unknown as typeof fetch)).toBe(
      'recursive',
    )
    const notPinned = async () =>
      new Response(JSON.stringify({ Message: `path '${IMG}' is not pinned`, Code: 0 }), {
        status: 500,
      })
    expect(await pinType(DEFAULT_NODE_API, IMG, notPinned as unknown as typeof fetch)).toBeNull()
  })
})

describe('Pinning Service API', () => {
  const TOKEN = 'secret-token-1234567890'
  afterEach(() => sessionStorage.clear())

  it('ships standard endpoints for Pinata and Filebase', () => {
    expect(PSA_PRESETS.map((p) => [p.id, p.endpoint])).toEqual([
      ['pinata', 'https://api.pinata.cloud/psa'],
      ['filebase', 'https://api.filebase.io/v1/ipfs'],
    ])
  })

  it('accepts only http(s) endpoints, and never one of ours', () => {
    expect(normaliseServiceEndpoint('https://api.pinata.cloud/psa/')).toBe(
      'https://api.pinata.cloud/psa',
    )
    expect(normaliseServiceEndpoint('https://api.filebase.io/v1/ipfs/pins')).toBe(
      'https://api.filebase.io/v1/ipfs',
    )
    expect(normaliseServiceEndpoint('ftp://pins.example')).toBeNull()
    expect(normaliseServiceEndpoint('https://u:p@pins.example')).toBeNull()
    expect(normaliseServiceEndpoint(`${HOST}/psa`, [HOST])).toBeNull()
  })

  it('posts {cid, name} with the token as a bearer header, and follows the request', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const server = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return new Response(
        JSON.stringify({ requestid: 'r1', status: calls.length === 1 ? 'queued' : 'pinned' }),
        {
          status: calls.length === 1 ? 202 : 200,
        },
      )
    }) as typeof fetch
    const started = await requestPin(
      'https://pins.example',
      TOKEN,
      { cid: IMG, name: 'Sprites — images' },
      server,
    )
    expect(started).toEqual({ requestid: 'r1', status: 'queued' })
    expect(calls[0]!.url).toBe('https://pins.example/pins')
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ cid: IMG, name: 'Sprites — images' })
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]!.init.credentials).toBe('omit')
    expect(calls[0]!.url).not.toContain(TOKEN)

    expect(await pinStatus('https://pins.example', TOKEN, 'r1', server)).toEqual({
      requestid: 'r1',
      status: 'pinned',
    })
    expect(calls[1]!.url).toBe('https://pins.example/pins/r1')
  })

  it('never puts the token in an error, even when the service echoes it', async () => {
    const echo = (async () =>
      new Response(
        JSON.stringify({ error: { reason: 'UNAUTHORIZED', details: `bad token ${TOKEN}` } }),
        {
          status: 401,
        },
      )) as typeof fetch
    const error = await requestPin(
      'https://pins.example',
      TOKEN,
      { cid: IMG, name: 'x' },
      echo,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PsaError)
    expect((error as Error).message).toContain('did not accept the token')
    expect((error as Error).message).not.toContain(TOKEN)

    const down = (async () => {
      throw new TypeError(`network ${TOKEN}`)
    }) as typeof fetch
    const unreachable = await requestPin(
      'https://pins.example',
      TOKEN,
      { cid: IMG, name: 'x' },
      down,
    ).catch((e: unknown) => e as Error)
    expect((unreachable as Error).message).toMatch(/could not reach pins\.example/)
    expect((unreachable as Error).message).not.toContain(TOKEN)
  })

  it('keeps the token in session storage only', () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    saveService({ endpoint: 'https://pins.example', token: TOKEN })
    expect(loadService()).toEqual({ endpoint: 'https://pins.example', token: TOKEN })
    for (const call of local.mock.contexts) expect(call).toBe(sessionStorage)
    saveService(null)
    expect(loadService()).toBeNull()
    local.mockRestore()
  })
})
