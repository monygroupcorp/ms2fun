import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError, type Transport } from 'viem'
import { WALLET_HOP_TIMEOUT_MS, withRequestTimeout } from './rpc'

const chain = undefined
const stub = (request: () => Promise<unknown>): Transport =>
  (() => ({ config: {}, request, value: {} })) as unknown as Transport

describe('withRequestTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects with a TimeoutError when the wrapped transport never answers', async () => {
    vi.useFakeTimers()
    const t = withRequestTimeout(
      stub(() => new Promise(() => {})),
      WALLET_HOP_TIMEOUT_MS,
    )({ chain })
    const pending = t.request({ method: 'eth_blockNumber' })
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(WALLET_HOP_TIMEOUT_MS + 1)
    await assertion
  })

  it('passes a prompt answer through untouched', async () => {
    const t = withRequestTimeout(
      stub(async () => '0x10'),
      WALLET_HOP_TIMEOUT_MS,
    )({ chain })
    await expect(t.request({ method: 'eth_blockNumber' })).resolves.toBe('0x10')
  })

  it('passes the wrapped transport error through, not a timeout', async () => {
    const boom = new Error('boom')
    const t = withRequestTimeout(
      stub(() => Promise.reject(boom)),
      WALLET_HOP_TIMEOUT_MS,
    )({ chain })
    await expect(t.request({ method: 'eth_blockNumber' })).rejects.toBe(boom)
  })
})
