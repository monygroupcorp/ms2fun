/**
 * The "keep this collection alive" panel: the readout asks public gateways (never our host), the
 * options open and close on what it found, nothing goes to the holder's node before a click, a node
 * that refuses this page gets the setup, and a pinning-service request is followed to the end.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { HostingStatus } from '../../../lib/art/hostClient'
import KeepAlivePanel from './KeepAlivePanel'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const HOST = 'https://art.example'
const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const META = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
const NEXT = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'

const mocks = vi.hoisted(() => ({
  host: 'https://art.example' as string | null,
  base: '' as string,
  status: null as HostingStatus | null,
  /** Whether public gateways serve each CID. */
  onIpfs: new Set<string>(),
  node: 'down' as 'down' | 'cors' | 'ready',
  build: vi.fn(),
  importCar: vi.fn(),
  calls: [] as { url: string; init: RequestInit | undefined }[],
  psa: vi.fn(),
}))

vi.mock('../../../generated/contracts', () => ({
  useReadErc404BondingInstanceMetadataUri: () => ({ data: mocks.base }),
}))
vi.mock('../../../lib/art/hostClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/art/hostClient')>()),
  artHostBase: () => mocks.host,
  fetchHostingStatus: async () => mocks.status,
}))
vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1,
  useCollectionAddresses: () => ({}),
}))
vi.mock('../../useCollection', () => ({ useCollection: () => ({ data: { name: 'Sprites' } }) }))
vi.mock('../../../lib/metadata/uri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/metadata/uri')>()),
  fetchJson: async () => ({ status: 'found', data: { image: `ipfs://${IMG}/1.png` } }),
}))
vi.mock('../../../lib/art/keep/build', () => ({
  buildKeepCar: (...args: unknown[]) => mocks.build(...args),
  checkKeepCar: async () => undefined,
}))
vi.mock('../../../lib/art/keep/kubo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/art/keep/kubo')>()),
  importCar: (...args: unknown[]) => mocks.importCar(...args),
}))

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  mocks.calls.push({ url, init })
  if (url.startsWith('http://127.0.0.1:5001/')) {
    if (mocks.node === 'down') throw new TypeError('Failed to fetch')
    if (mocks.node === 'cors') {
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 })
      throw new TypeError('Failed to fetch')
    }
    if (url.includes('/api/v0/id')) {
      return new Response(JSON.stringify({ ID: '12D3KooWNode', AgentVersion: 'kubo/0.43.1' }))
    }
    if (url.includes('/api/v0/pin/ls')) {
      return new Response(JSON.stringify({ Keys: { x: { Type: 'recursive' } } }))
    }
  }
  if (url.startsWith('https://pins.example/')) return mocks.psa(url, init) as Response
  const cid = /\/ipfs\/([a-z0-9]+)/.exec(url)?.[1]
  return new Response(null, { status: cid !== undefined && mocks.onIpfs.has(cid) ? 200 : 404 })
}

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function hosted(): HostingStatus {
  return {
    instance: INSTANCE,
    state: 'hosted',
    imgCid: IMG,
    metaCid: META,
    migrationCid: NEXT,
    pieces: ['1.png', '2.png'],
    migrated: false,
    boundAt: 0,
    graduatedAt: null,
    migratedAt: null,
  }
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.host = HOST
  mocks.base = ''
  mocks.status = null
  mocks.onIpfs = new Set()
  mocks.node = 'down'
  mocks.calls = []
  mocks.build.mockReset()
  mocks.importCar.mockReset()
  mocks.psa.mockReset()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const nodeCalls = () => mocks.calls.filter((c) => c.url.startsWith('http://127.0.0.1'))

test('renders nothing for a base that is not content-addressed', async () => {
  mocks.base = 'https://example.com/meta/'
  const { container } = render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(mocks.calls.length).toBe(0))
  expect(container.innerHTML).toBe('')
})

test('a hosted collection: ✗ on public IPFS, the node and download open, the service closed', async () => {
  mocks.base = `${HOST}/ipfs/${META}/`
  mocks.status = hosted()
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })

  await waitFor(() =>
    expect(screen.getByTestId('keep-status-images').textContent).toContain('not found on public'),
  )
  expect(screen.getByTestId('keep-status-metadata').textContent).toContain('not found on public')
  // The readout never asks our own host.
  expect(mocks.calls.some((c) => c.url.startsWith(HOST))).toBe(false)
  expect(mocks.calls.every((c) => c.init?.method === 'HEAD')).toBe(true)

  expect(screen.getByTestId('keep-node-pin')).not.toBeDisabled()
  expect(screen.getByTestId('keep-download-car')).not.toBeDisabled()
  expect(screen.getByTestId('keep-service-disabled').textContent).toMatch(/fetches by CID/)
  expect(screen.queryByTestId('keep-service-pin')).toBeNull()
  // The CIDs to copy include the metadata the creator's move will point at.
  const cids = screen.getAllByTestId('keep-cid').map((c) => c.textContent)
  expect(cids).toEqual([IMG, META, NEXT])

  // Nothing went to localhost, and no CAR was built, without a click.
  expect(nodeCalls()).toHaveLength(0)
  expect(mocks.build).not.toHaveBeenCalled()
})

test('a collection nobody serves and nobody hosts: nothing to copy from', async () => {
  mocks.host = null
  mocks.base = `ipfs://${META}/`
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() =>
    expect(screen.getByTestId('keep-status-metadata').textContent).toContain('not found'),
  )
  expect(screen.getByTestId('keep-node-pin')).toBeDisabled()
  expect(screen.getByTestId('keep-download-car')).toBeDisabled()
  expect(screen.getAllByText(/nothing to copy from/).length).toBeGreaterThan(0)
})

test('a node that refuses this page gets the one-time setup, for this origin', async () => {
  mocks.host = null
  mocks.base = `ipfs://${META}/`
  mocks.onIpfs = new Set([META, IMG])
  mocks.node = 'cors'
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('keep-node-pin')).not.toBeDisabled())
  expect(nodeCalls()).toHaveLength(0)

  fireEvent.click(screen.getByTestId('keep-node-pin'))
  const setup = await screen.findByTestId('keep-node-setup')
  expect(setup.textContent).toMatch(/one-time setup/)
  const commands = screen.getByTestId('keep-node-commands').textContent ?? ''
  expect(commands).toContain('API.HTTPHeaders.Access-Control-Allow-Origin')
  expect(commands).toContain(window.location.origin)
  expect(commands).toContain('https://ms2.fun')
  expect(commands).toContain('https://noesis.gwei.domains')
  expect(commands).toContain(`Access-Control-Allow-Methods '["POST"]'`)
  // Detection used POST, then an opaque probe; no CAR was built for a node that cannot take it.
  expect(nodeCalls()[0]!.init?.method).toBe('POST')
  expect(nodeCalls()[1]!.init?.mode).toBe('no-cors')
  expect(mocks.build).not.toHaveBeenCalled()
})

test('a node that is not running is told apart from one that refuses', async () => {
  mocks.host = null
  mocks.base = `ipfs://${META}/`
  mocks.onIpfs = new Set([META, IMG])
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('keep-node-pin')).not.toBeDisabled())
  fireEvent.click(screen.getByTestId('keep-node-pin'))
  const setup = await screen.findByTestId('keep-node-setup')
  expect(setup.textContent).toMatch(/Nothing answered/)
})

test('pins on a node that answers, and confirms every root with pin/ls', async () => {
  mocks.base = `${HOST}/ipfs/${META}/`
  mocks.status = hosted()
  mocks.node = 'ready'
  const car = new Blob(['car bytes'])
  mocks.build.mockResolvedValue({
    car,
    roots: [
      { role: 'images', cid: IMG },
      { role: 'metadata', cid: META },
      { role: 'next-metadata', cid: NEXT },
    ],
    source: 'art.example',
  })
  mocks.importCar.mockImplementation(
    async (
      _endpoint: string,
      _car: Blob,
      _name: string,
      progress: (s: number, t: number) => void,
    ) => {
      progress(9, 9)
      return { roots: [IMG, META, NEXT].map((cid) => ({ cid, pinError: '' })) }
    },
  )
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('keep-node-pin')).not.toBeDisabled())
  fireEvent.click(screen.getByTestId('keep-node-pin'))

  const done = await screen.findByTestId('keep-node-done')
  expect(done.textContent).toContain('12D3KooWNode'.slice(0, 16))
  for (const cid of [IMG, META, NEXT]) expect(done.textContent).toContain(cid)
  expect(mocks.importCar.mock.calls[0]![0]).toBe('http://127.0.0.1:5001')
  expect(mocks.importCar.mock.calls[0]![1]).toBe(car)
  expect(mocks.importCar.mock.calls[0]![2]).toMatch(/^sprites-.*\.car$/)
  const confirmed = nodeCalls()
    .filter((c) => c.url.includes('/api/v0/pin/ls'))
    .map((c) => new URL(c.url).searchParams.get('arg'))
  expect(confirmed).toEqual([IMG, META, NEXT])
})

test('refuses a node address that is not http(s)', async () => {
  mocks.host = null
  mocks.base = `ipfs://${META}/`
  mocks.onIpfs = new Set([META, IMG])
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('keep-node-pin')).not.toBeDisabled())
  fireEvent.change(screen.getByTestId('keep-node-endpoint'), {
    target: { value: 'javascript:alert(1)' },
  })
  expect(screen.getByTestId('keep-node-pin')).toBeDisabled()
})

test('on public IPFS, a pinning service pins each root by CID and is followed to pinned', async () => {
  mocks.base = `ipfs://${META}/`
  mocks.onIpfs = new Set([META, IMG])
  const TOKEN = 'tok-abcdef-123456'
  const statuses = new Map<string, string>()
  mocks.psa.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { cid } = JSON.parse(String(init.body)) as { cid: string }
      statuses.set(`r-${cid}`, 'queued')
      return new Response(JSON.stringify({ requestid: `r-${cid}`, status: 'queued' }), {
        status: 202,
      })
    }
    const id = url.slice(url.lastIndexOf('/') + 1)
    statuses.set(id, 'pinned')
    return new Response(JSON.stringify({ requestid: id, status: 'pinned' }))
  })
  render(<KeepAlivePanel instance={INSTANCE} />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('keep-service-pin')).toBeInTheDocument())
  expect(screen.getByText(/forgotten when you close it/)).toBeInTheDocument()

  // Our own host is refused as a service endpoint, so a token cannot be sent there.
  fireEvent.change(screen.getByTestId('keep-service-endpoint'), {
    target: { value: `${HOST}/psa` },
  })
  fireEvent.change(screen.getByTestId('keep-service-token'), { target: { value: TOKEN } })
  expect(screen.getByTestId('keep-service-pin')).toBeDisabled()

  fireEvent.change(screen.getByTestId('keep-service-endpoint'), {
    target: { value: 'https://pins.example' },
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByTestId('keep-service-pin'))

  const list = await screen.findByTestId('keep-service-status')
  expect(within(list).getAllByText(/queued/)).toHaveLength(2)
  const posts = mocks.psa.mock.calls.filter((c) => (c[1] as RequestInit).method === 'POST')
  expect(posts.map((c) => JSON.parse(String((c[1] as RequestInit).body)))).toEqual([
    { cid: IMG, name: 'Sprites — images' },
    { cid: META, name: 'Sprites — metadata' },
  ])
  for (const [, init] of posts) {
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
  }

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_100)
  })
  await waitFor(() => expect(within(list).getAllByText(/pinned/)).toHaveLength(2))
  // The token never went anywhere but the service.
  for (const call of mocks.calls) {
    if (call.url.startsWith('https://pins.example/')) continue
    expect(JSON.stringify(call)).not.toContain(TOKEN)
  }
  expect(JSON.parse(sessionStorage.getItem('ms2fun:session:pinningService')!)).toEqual({
    endpoint: 'https://pins.example',
    token: TOKEN,
  })
})
