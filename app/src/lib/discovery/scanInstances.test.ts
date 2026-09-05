import { describe, expect, it, vi } from 'vitest'
import type { PublicClient } from 'viem'
import { deployBlock } from '../addresses'
import { scanAllInstances } from './scanInstances'

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

interface FakeLog {
  args: { instance: `0x${string}` }
  blockNumber: bigint
  logIndex: number
}

const log = (instance: `0x${string}`, blockNumber: bigint, logIndex = 0): FakeLog => ({
  args: { instance },
  blockNumber,
  logIndex,
})

/**
 * A client that answers `getContractEvents` per event name, returning only the logs whose block
 * falls inside the requested window — so the scanner's reverse windowing is exercised for real
 * rather than short-circuited by a single all-logs response.
 */
function clientWith(added: FakeLog[], revoked: FakeLog[], latest: bigint) {
  const calls: string[] = []
  const getContractEvents = vi.fn(
    async ({
      eventName,
      fromBlock,
      toBlock,
    }: {
      eventName: string
      fromBlock: bigint
      toBlock: bigint
    }) => {
      calls.push(eventName)
      const source = eventName === 'InstanceRevoked' ? revoked : added
      return source.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
    },
  )
  const client = {
    getBlockNumber: async () => latest,
    getContractEvents,
  } as unknown as PublicClient
  return { client, calls }
}

describe('scanAllInstances', () => {
  const latest = deployBlock + 10n

  it('returns instances in discovery order, deduped', async () => {
    const { client } = clientWith(
      [
        log(addr(1), deployBlock + 1n),
        log(addr(2), deployBlock + 2n),
        log(addr(1), deployBlock + 3n), // duplicate add
        log(addr(3), deployBlock + 4n),
      ],
      [],
      latest,
    )
    expect(await scanAllInstances(client)).toEqual([addr(1), addr(2), addr(3)])
  })

  it('subtracts a revoked instance from the listing', async () => {
    // The chain honours revocation; before noesis-336 the app never asked, so the revoked
    // collection stayed browsable while shedding the creator attribution that identified it.
    const { client } = clientWith(
      [
        log(addr(1), deployBlock + 1n),
        log(addr(2), deployBlock + 2n),
        log(addr(3), deployBlock + 3n),
      ],
      [log(addr(2), deployBlock + 4n)],
      latest,
    )
    expect(await scanAllInstances(client)).toEqual([addr(1), addr(3)])
  })

  it('revokes regardless of log interleaving — revocation is terminal on-chain', async () => {
    // `revokeInstance` only ever sets the flag; the registry exposes no un-revoke, so a later
    // `CreatorInstanceAdded` for the same address must not resurrect it in the index.
    const { client } = clientWith(
      [log(addr(1), deployBlock + 1n), log(addr(2), deployBlock + 5n)],
      [log(addr(2), deployBlock + 3n)],
      latest,
    )
    expect(await scanAllInstances(client)).toEqual([addr(1)])
  })

  it('reads both events in one walk of the range', async () => {
    const { client, calls } = clientWith([log(addr(1), deployBlock + 1n)], [], latest)
    await scanAllInstances(client)
    // One window over this range, two event reads inside it — not two separate range traversals.
    expect(calls).toEqual(['CreatorInstanceAdded', 'InstanceRevoked'])
  })

  it('returns an empty list when nothing was ever registered', async () => {
    const { client } = clientWith([], [], latest)
    expect(await scanAllInstances(client)).toEqual([])
  })
})
