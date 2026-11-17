import { describe, expect, it, vi } from 'vitest'
import type { PublicClient } from 'viem'
import { deployBlock, forkChainId } from '../addresses'
import { findInstanceCreatedBlock, rememberInstanceCreatedBlock } from './instanceCreatedBlock'

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

/** A registry holding one registration, answering only the windows that contain it. */
function registryWith(instance: `0x${string}`, block: bigint, latest: bigint) {
  const getContractEvents = vi.fn(
    async ({
      args,
      fromBlock,
      toBlock,
    }: {
      args: { instance: `0x${string}` }
      fromBlock: bigint
      toBlock: bigint
    }) =>
      args.instance === instance && block >= fromBlock && block <= toBlock
        ? [{ args: { instance }, blockNumber: block }]
        : [],
  )
  const client = {
    getBlockNumber: vi.fn(async () => latest),
    getContractEvents,
  } as unknown as PublicClient
  return { client, getContractEvents }
}

describe('findInstanceCreatedBlock', () => {
  it('answers a new collection from one window and asks no more after that', async () => {
    const instance = addr(0xa1)
    const latest = deployBlock + 1_000_000n
    const { client, getContractEvents } = registryWith(instance, latest - 10n, latest)

    expect(await findInstanceCreatedBlock(client, forkChainId, instance)).toBe(latest - 10n)
    expect(getContractEvents).toHaveBeenCalledTimes(1)

    expect(await findInstanceCreatedBlock(client, forkChainId, instance)).toBe(latest - 10n)
    expect(getContractEvents).toHaveBeenCalledTimes(1)
  })

  it('uses what discovery already read without a request', async () => {
    const instance = addr(0xa2)
    rememberInstanceCreatedBlock(forkChainId, instance, deployBlock + 5n)
    const { client, getContractEvents } = registryWith(instance, 0n, deployBlock + 10n)

    expect(await findInstanceCreatedBlock(client, forkChainId, instance)).toBe(deployBlock + 5n)
    expect(getContractEvents).not.toHaveBeenCalled()
  })

  it('falls back to the deploy block for an unregistered address and does not keep it', async () => {
    const instance = addr(0xa3)
    const latest = deployBlock + 10n
    const { client, getContractEvents } = registryWith(addr(0xff), latest, latest)

    expect(await findInstanceCreatedBlock(client, forkChainId, instance)).toBe(deployBlock)
    const calls = getContractEvents.mock.calls.length
    await findInstanceCreatedBlock(client, forkChainId, instance)
    expect(getContractEvents.mock.calls.length).toBeGreaterThan(calls)
  })
})
