/**
 * queryClient (noesis-371) — the persistence invariant, asserted rather than commented.
 *
 * A query is only persisted/restored while it is still in cache, so `gcTime` must be at least the
 * persistence maxAge (ADR-0010): a shorter one evicts entries before they can rehydrate, and the
 * persisted blob silently stops paying for itself. Raising the maxAge without raising `gcTime` is
 * exactly the way that invariant gets broken, so it is a test.
 */
import { describe, expect, it } from 'vitest'
import { queryClient } from './queryClient'
import { PERSIST_MAX_AGE } from './queryPersister'

describe('read-cache persistence', () => {
  it('keeps gcTime >= the persistence maxAge', () => {
    const gcTime = queryClient.getDefaultOptions().queries?.gcTime
    expect(typeof gcTime).toBe('number')
    expect(gcTime as number).toBeGreaterThanOrEqual(PERSIST_MAX_AGE)
  })

  it('retains persisted entries for days, not an hour', () => {
    expect(PERSIST_MAX_AGE).toBeGreaterThanOrEqual(1000 * 60 * 60 * 24)
  })
})
