/**
 * Sepolia's log scans have a second path: with every pool entry that serves `eth_getLogs` failing,
 * a log request still reaches the chain's last-resort entry, and nothing else does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { sepolia } from 'wagmi/chains'
import * as rpc from './rpc'

type Rpc = { id: number; method: string }

const LAST_RESORT = 'https://0xrpc.io/sep'
let asked: Array<{ url: string; method: string }>

beforeEach(() => {
  asked = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Rpc | Rpc[]
    const rows = Array.isArray(body) ? body : [body]
    const out = rows.map((r) => {
      asked.push({ url, method: r.method })
      if (r.method === 'eth_chainId') return { jsonrpc: '2.0', id: r.id, result: '0xaa36a7' }
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x100' }
      if (r.method === 'eth_getLogs' && url === LAST_RESORT) {
        return { jsonrpc: '2.0', id: r.id, result: [] }
      }
      return { jsonrpc: '2.0', id: r.id, error: { code: 4444, message: 'unavailable' } }
    })
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), {
      headers: { 'content-type': 'application/json' },
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sepolia log-scan path', () => {
  it('reaches the last-resort entry when the pool cannot serve eth_getLogs', async () => {
    const config = createConfig({
      chains: [sepolia],
      multiInjectedProviderDiscovery: false,
      transports: { [sepolia.id]: rpc.decentralizedTransport(sepolia.id)! },
    })
    const client = getPublicClient(config)!

    const logs = await client.request({
      method: 'eth_getLogs',
      params: [{ fromBlock: '0x1', toBlock: '0x2' }],
    } as never)

    expect(logs).toEqual([])
    const logRequests = asked.filter((a) => a.method === 'eth_getLogs').map((a) => a.url)
    expect(logRequests.at(-1)).toBe(LAST_RESORT)
  })
})
