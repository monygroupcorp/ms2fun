/**
 * `release:point`: the contenthash it hands the forge script, and what it refuses before forge runs.
 */
import { expect, test } from 'vitest'
import { contenthashFor, forgeArgs, recordReasons, usageReasons } from './release-point'

// A record both names carried on mainnet, read back with `contenthash(tokenId)`, and its CID.
const LIVE_CID = 'bafybeibdt5gqchyxc5qippwdoiz7k2e3y6rwrynvgz7goyydkomutxyns4'
const LIVE_RECORD = '0xe30101701220239f4d011f17176087bec37233f5689bc7a368e1b5367e676303539949df0d97'

const ENV = { MAINNET_RPC_URL: 'https://rpc.example', NOESIS_NAMES_ACCOUNT: 'names' }

test('encodes a CID as the record the names already carry for it', () => {
  expect(contenthashFor(LIVE_CID)).toBe(LIVE_RECORD)
})

test('refuses a CIDv0', () => {
  expect(() => contenthashFor('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toThrow(
    /not CIDv1/,
  )
})

test('refuses a CID whose codec is not dag-pb', () => {
  // The raw-codec CID of the same digest as LIVE_CID.
  expect(() =>
    contenthashFor('bafkreibdt5gqchyxc5qippwdoiz7k2e3y6rwrynvgz7goyydkomutxyns4'),
  ).toThrow(/not dag-pb/)
})

test('refuses what is not a CID', () => {
  expect(() => contenthashFor('noesis.gwei.domains')).toThrow(/not a CID/)
})

test('simulates unless --broadcast is given', () => {
  const options = { contenthash: LIVE_RECORD, rpcUrl: 'https://rpc.example', account: 'names' }
  expect(forgeArgs({ ...options, broadcast: false })).not.toContain('--broadcast')
  expect(forgeArgs({ ...options, broadcast: true })).toContain('--broadcast')
  expect(forgeArgs({ ...options, broadcast: false })).toEqual(
    expect.arrayContaining(['--sig', 'run(bytes)', LIVE_RECORD, '--account', 'names']),
  )
})

test('asks for one CID, a mainnet RPC and a keystore account', () => {
  expect(usageReasons([LIVE_CID], ENV)).toEqual([])
  expect(usageReasons([LIVE_CID, '--broadcast'], ENV)).toEqual([])
  expect(usageReasons([], ENV)).toEqual(['give exactly one CID'])
  expect(usageReasons([LIVE_CID, '--yes'], ENV)).toEqual(['unknown option --yes'])
  expect(usageReasons([LIVE_CID], {})).toEqual([
    'MAINNET_RPC_URL is not set',
    'NOESIS_NAMES_ACCOUNT is not set',
  ])
})

test('after a broadcast, passes only when both names carry the new record', () => {
  const both = {
    'noesis.gwei': LIVE_RECORD,
    'noesis.wei': LIVE_RECORD.toUpperCase().replace('0X', '0x'),
  }
  expect(recordReasons(both, LIVE_RECORD)).toEqual([])
  expect(recordReasons({ ...both, 'noesis.wei': '0x' }, LIVE_RECORD)).toEqual([
    `noesis.wei carries 0x, not ${LIVE_RECORD}`,
  ])
  expect(recordReasons({ 'noesis.wei': LIVE_RECORD }, LIVE_RECORD)).toEqual([
    `noesis.gwei carries nothing readable, not ${LIVE_RECORD}`,
  ])
})
