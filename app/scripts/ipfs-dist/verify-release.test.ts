/**
 * `release:verify` against a fake network: every check it makes has a case where that check alone
 * fails, so a regression in any one of them is caught rather than masked by the others passing.
 */
import { expect, test } from 'vitest'
import { bundleReasons, pollForCid, scriptRefs, verifyRelease } from './verify-release'

const CID = 'bafybeihugaojt3phztxwtjabp6rsi6wiuvg3lut2yfdgom33mqhl3vpvp4'
const OLD = 'bafybeibdt5gqchyxc5qippwdoiz7k2e3y6rwrynvgz7goyydkomutxyns4'
const REGISTRY = '0x0000000000666868b0a9eC07fa495Da351718BcE'
const INDEX =
  '<!doctype html><script type="module" crossorigin src="./assets/index-abc.js"></script>' +
  '<link rel="modulepreload" crossorigin href="./assets/vendor-def.js">'
const SEPOLIA_BUNDLE = `const e={VITE_CHAIN_ID:\`11155111\`};const r="${REGISTRY.toLowerCase()}"`

const ORIGINS = ['https://a.example/', 'https://b.example/']
const GATEWAY = 'https://gw.example/ipfs/'

interface Site {
  cid: string | null
  index?: string
  bundle?: string
}

function network(sites: Record<string, Site>, gatewayIndex: string | null = INDEX) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(GATEWAY)) {
      return gatewayIndex === null ? new Response('', { status: 504 }) : new Response(gatewayIndex)
    }
    const origin = ORIGINS.find((o) => url.startsWith(o))
    const site = origin ? sites[origin] : undefined
    if (!site) return new Response('', { status: 404 })
    const headers = site.cid ? { 'x-ipfs-cid': site.cid } : undefined
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (url === origin) return new Response(site.index ?? INDEX, { headers })
    if (url.endsWith('.js')) return new Response(site.bundle ?? SEPOLIA_BUNDLE)
    return new Response('', { status: 404 })
  }) as typeof fetch
}

const live = (overrides: Partial<Site> = {}): Site => ({ cid: CID, ...overrides })
const fast = { intervalMs: 1, timeoutMs: 0, sleep: async () => {} }

function verify(sites: Record<string, Site>, gatewayIndex?: string | null) {
  return verifyRelease({
    cid: CID,
    localIndex: INDEX,
    registry: REGISTRY,
    origins: ORIGINS,
    gateway: GATEWAY,
    poll: fast,
    fetchImpl: network(sites, gatewayIndex),
  })
}

test('index.html script and modulepreload refs are the bundle', () => {
  expect(scriptRefs(INDEX)).toEqual(['assets/index-abc.js', 'assets/vendor-def.js'])
})

test('a Sepolia bundle passes; a mainnet one or one without the registry does not', () => {
  expect(bundleReasons(SEPOLIA_BUNDLE, REGISTRY)).toEqual([])
  expect(bundleReasons('VITE_CHAIN_ID:"1"', REGISTRY)).toHaveLength(2)
  expect(bundleReasons('VITE_CHAIN_ID:"11155111"', REGISTRY)).toEqual([
    `the bundle does not carry the Sepolia master registry ${REGISTRY}`,
  ])
})

test('polling waits until the name serves the CID', async () => {
  const seen = [OLD, OLD, CID]
  let clock = 0
  const fetchImpl = (async () =>
    new Response(null, {
      headers: { 'x-ipfs-cid': seen.shift() ?? CID },
    })) as unknown as typeof fetch
  const result = await pollForCid('https://a.example/', CID, {
    fetchImpl,
    intervalMs: 10,
    timeoutMs: 1000,
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
  })
  expect(result).toBe(CID)
  expect(clock).toBe(20)
})

test('both names serving the release, matching, Sepolia, and on IPFS verifies', async () => {
  expect(await verify({ [ORIGINS[0]]: live(), [ORIGINS[1]]: live() })).toEqual([])
})

test('a name still on the old CID fails', async () => {
  expect(await verify({ [ORIGINS[0]]: live(), [ORIGINS[1]]: live({ cid: OLD }) })).toEqual([
    `https://b.example/ still serves ${OLD}, not ${CID}`,
  ])
})

test('a served index.html that differs from the local build fails', async () => {
  const reasons = await verify({
    [ORIGINS[0]]: live({ index: `${INDEX}<!-- x -->` }),
    [ORIGINS[1]]: live(),
  })
  expect(reasons).toEqual([
    'https://a.example/ serves an index.html that differs from the local build',
  ])
})

test('a served bundle that is not Sepolia fails', async () => {
  const reasons = await verify({
    [ORIGINS[0]]: live(),
    [ORIGINS[1]]: live({ bundle: `const e={VITE_CHAIN_ID:"1"};"${REGISTRY}"` }),
  })
  expect(reasons).toEqual([`https://b.example/: the bundle does not bake VITE_CHAIN_ID 11155111`])
})

test('a CID the independent gateway cannot retrieve fails', async () => {
  const reasons = await verify({ [ORIGINS[0]]: live(), [ORIGINS[1]]: live() }, null)
  expect(reasons).toEqual([`${GATEWAY}${CID}/: ${GATEWAY}${CID}/ answered 504`])
})
