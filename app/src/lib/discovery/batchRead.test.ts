import { describe, expect, it, vi } from 'vitest'
import type { PublicClient } from 'viem'
import { chunk, fetchProjectCardsBatched, MAX_QUERY_LIMIT, QUERY_WINDOW } from './batchRead'
import type { ProjectCard } from './types'

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

describe('chunk', () => {
  it('splits into windows of at most the given width, preserving order', () => {
    const items = Array.from({ length: 7 }, (_, i) => i)
    expect(chunk(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]])
  })

  it('yields no windows for an empty list, so no zero-length read is issued', () => {
    expect(chunk([], 50)).toEqual([])
  })

  it('defaults to the measured window width, which stays inside the contract cap', () => {
    const items = Array.from({ length: QUERY_WINDOW + 1 }, (_, i) => i)
    const windows = chunk(items)
    expect(windows).toHaveLength(2)
    expect(windows[0]).toHaveLength(QUERY_WINDOW)
    // The ERC1155 worst case puts gas over a public eth_call ceiling well before the contract's
    // own bound does, so our width must sit strictly below it (see batchRead.ts).
    expect(QUERY_WINDOW).toBeLessThan(MAX_QUERY_LIMIT)
  })

  it('rejects a non-positive width rather than looping forever', () => {
    expect(() => chunk([1, 2], 0)).toThrow()
  })
})

describe('fetchProjectCardsBatched', () => {
  /**
   * A client whose `getProjectCardsBatch` mirrors the contract's own first statement:
   * `if (instances.length > MAX_QUERY_LIMIT) revert TooManyInstances()`. A caller that windows
   * correctly never sees it; the pre-noesis-335 whole-array call sees it at the 51st instance and
   * keeps seeing it, because the registry only grows.
   */
  function boundedClient() {
    const widths: number[] = []
    const readContract = vi.fn(async ({ args }: { args: readonly unknown[] }) => {
      const instances = args[0] as `0x${string}`[]
      widths.push(instances.length)
      if (instances.length > MAX_QUERY_LIMIT) throw new Error('TooManyInstances')
      return instances.map((instance) => ({ instance }) as unknown as ProjectCard)
    })
    return { client: { readContract } as unknown as PublicClient, widths, readContract }
  }

  it('returns every instance, in order, past the aggregator cap', async () => {
    const instances = Array.from({ length: 123 }, (_, i) => addr(i + 1))
    const { client, widths } = boundedClient()

    const cards = await fetchProjectCardsBatched(client, instances)

    expect(cards.map((c) => c.instance)).toEqual(instances)
    // Non-vacuity: the read really was split, at the measured window width, and no window came
    // near the contract's bound.
    expect(widths).toEqual([20, 20, 20, 20, 20, 20, 3])
    expect(Math.max(...widths)).toBeLessThanOrEqual(MAX_QUERY_LIMIT)
  })

  it('still returns every instance at a perturbed window width', async () => {
    // Non-vacuity for the assertion above: the RESULT is width-independent, the call pattern is not.
    const instances = Array.from({ length: 123 }, (_, i) => addr(i + 1))
    const { client, widths } = boundedClient()

    const cards = await fetchProjectCardsBatched(client, instances, 7)

    expect(cards.map((c) => c.instance)).toEqual(instances)
    expect(widths.every((w) => w <= 7)).toBe(true)
    expect(widths).toHaveLength(18)
  })

  it('reverts if a window exceeds the cap — the fake enforces the real bound', async () => {
    const instances = Array.from({ length: 51 }, (_, i) => addr(i + 1))
    const { client } = boundedClient()
    await expect(fetchProjectCardsBatched(client, instances, 51)).rejects.toThrow(
      'TooManyInstances',
    )
  })

  it('issues no read at all for an empty instance list', async () => {
    const { client, readContract } = boundedClient()
    expect(await fetchProjectCardsBatched(client, [])).toEqual([])
    expect(readContract).not.toHaveBeenCalled()
  })
})
