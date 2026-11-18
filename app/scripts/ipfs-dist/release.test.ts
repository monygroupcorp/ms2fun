/**
 * The release command's refusals and its Pinata contract. The build itself is covered where it
 * lives (pack.test.ts, assert-publishable.test.ts); what is new here is the gate in front of it and
 * the one network call after it, so both are tested without a tree or a network.
 */
import { expect, test } from 'vitest'
import {
  assertReleasable,
  listPinnedReleases,
  nextReleaseNumber,
  pinCar,
  releaseName,
  type TreeState,
} from './release'

const HEAD = 'a91d1847e4b0c2f1d3a5b7c9e1f3a5b7c9d1e3f5'
const CLEAN: TreeState = {
  chainIdEnv: undefined,
  buildCommitEnv: undefined,
  porcelain: '',
  head: HEAD,
  originMain: HEAD,
}
const ROOT = 'bafybeihugaojt3phztxwtjabp6rsi6wiuvg3lut2yfdgom33mqhl3vpvp4'

test('a clean tree at origin/main with no chain override is releasable', () => {
  expect(assertReleasable(CLEAN)).toEqual([])
  expect(
    assertReleasable({ ...CLEAN, chainIdEnv: '11155111', buildCommitEnv: 'a91d1847' }),
  ).toEqual([])
})

test('mainnet and every other chain are refused, not overridden', () => {
  const [mainnet] = assertReleasable({ ...CLEAN, chainIdEnv: '1' })
  expect(mainnet).toMatch(/VITE_CHAIN_ID is 1; .*never mainnet/)
  expect(assertReleasable({ ...CLEAN, chainIdEnv: '1337' })).toHaveLength(1)
})

test('a dirty tree is refused', () => {
  expect(assertReleasable({ ...CLEAN, porcelain: ' M app/src/App.tsx\n' })).toEqual([
    'the working tree has uncommitted changes; a pin must name a commit',
  ])
})

test('a HEAD that is not origin/main is refused', () => {
  const [reason] = assertReleasable({ ...CLEAN, originMain: 'ce191f31'.padEnd(40, '0') })
  expect(reason).toBe('HEAD a91d1847 is not origin/main ce191f31')
})

test('a build-commit override that does not name HEAD is refused', () => {
  expect(assertReleasable({ ...CLEAN, buildCommitEnv: 'deadbeef' })).toHaveLength(1)
})

test('the release number follows the highest one seen locally or on Pinata', () => {
  expect(nextReleaseNumber([])).toBe(1)
  expect(
    nextReleaseNumber(['noesis_v2.car', 'noesis_v2.json', 'noesis_v10', 'other', 'noesis_vX']),
  ).toBe(11)
  expect(releaseName(3)).toBe('noesis_v3')
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('the CAR is pinned as a raw public CAR under the release name', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init }
    return jsonResponse({ data: { id: 'f1', cid: ROOT, is_duplicate: false } })
  }) as typeof fetch

  const result = await pinCar('jwt-x', new Uint8Array([1, 2, 3]), 'noesis_v4', ROOT, fetchImpl)

  expect(result).toEqual({ id: 'f1', cid: ROOT, duplicate: false })
  expect(seen?.url).toBe('https://uploads.pinata.cloud/v3/files')
  expect(seen?.init.headers).toEqual({ Authorization: 'Bearer jwt-x' })
  const form = seen?.init.body as FormData
  expect(form.get('network')).toBe('public')
  expect(form.get('car')).toBe('true')
  expect(form.get('name')).toBe('noesis_v4')
  expect((form.get('file') as File).name).toBe('noesis_v4.car')
})

test('a pin Pinata reports under any other CID fails the release', async () => {
  const fetchImpl = (async () =>
    jsonResponse({ data: { id: 'f1', cid: 'bafkreiother' } })) as unknown as typeof fetch
  await expect(pinCar('jwt', new Uint8Array(), 'noesis_v1', ROOT, fetchImpl)).rejects.toThrow(
    `Pinata reports CID bafkreiother, the CAR's root is ${ROOT}`,
  )
})

test('a Pinata error fails the release with its status', async () => {
  const fetchImpl = (async () =>
    new Response('bad jwt', { status: 401 })) as unknown as typeof fetch
  await expect(pinCar('jwt', new Uint8Array(), 'noesis_v1', ROOT, fetchImpl)).rejects.toThrow(
    'Pinata upload answered 401: bad jwt',
  )
})

test('existing pins are listed across every page', async () => {
  const pages = [
    { data: { files: [{ name: 'noesis_v1' }, { name: null }], next_page_token: 'p2' } },
    { data: { files: [{ name: 'noesis_v7' }], next_page_token: '' } },
  ]
  const urls: string[] = []
  const fetchImpl = (async (url: URL) => {
    urls.push(url.toString())
    return jsonResponse(pages.shift())
  }) as unknown as typeof fetch

  expect(await listPinnedReleases('jwt', fetchImpl)).toEqual(['noesis_v1', 'noesis_v7'])
  expect(urls).toHaveLength(2)
  expect(urls[1]).toContain('pageToken=p2')
})
