import { expect, test } from 'vitest'
import { mapWithConcurrency, METADATA_CONCURRENCY } from './pool'

/** A deferred promise, so a test can hold work open and inspect what is in flight. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('keeps at most `limit` calls in flight', async () => {
  const items = Array.from({ length: 50 }, (_, i) => i)
  let inFlight = 0
  let peak = 0

  const results = await mapWithConcurrency(items, 4, async (n) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await Promise.resolve()
    inFlight -= 1
    return n * 2
  })

  expect(peak).toBeLessThanOrEqual(4)
  expect(results).toEqual(items.map((n) => n * 2))
})

test('does not start work beyond the limit until a slot frees', async () => {
  const gate = deferred()
  const started: number[] = []
  const items = [0, 1, 2, 3, 4, 5]

  const run = mapWithConcurrency(items, 2, async (n) => {
    started.push(n)
    await gate.promise
    return n
  })

  await Promise.resolve()
  expect(started).toEqual([0, 1])

  gate.resolve()
  await expect(run).resolves.toEqual(items)
  expect(started).toEqual(items)
})

test('returns results in input order regardless of completion order', async () => {
  const items = [30, 10, 20]
  const results = await mapWithConcurrency(items, 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms / 10))
    return ms
  })
  expect(results).toEqual(items)
})

test('an empty list does no work', async () => {
  let calls = 0
  const results = await mapWithConcurrency([], 4, async () => {
    calls += 1
    return 1
  })
  expect(results).toEqual([])
  expect(calls).toBe(0)
})

test('a limit below one still makes progress', async () => {
  const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1)
  expect(results).toEqual([2, 3, 4])
})

test('the declared metadata budget is a small positive number', () => {
  expect(METADATA_CONCURRENCY).toBeGreaterThan(0)
  expect(METADATA_CONCURRENCY).toBeLessThanOrEqual(8)
})
