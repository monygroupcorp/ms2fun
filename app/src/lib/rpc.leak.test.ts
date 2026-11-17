/**
 * The read transport's request budget, measured on the wire: every public-pool POST and every
 * wallet request is counted while a real wagmi config reads through `decentralizedTransport`.
 *
 * Two leaks are pinned here. A wallet hop that resolves the injected provider without asking
 * whether the site is connected sends a visitor's log scans to their wallet. And a ranked pool
 * nested in a `fallback` starts a fresh, never-ending ranking loop each time the outer `fallback`
 * reaches it, so request count turned into idle ping load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import * as rpc from './rpc'

const SEPOLIA_HEX = `0x${sepolia.id.toString(16)}`

type Rpc = { id: number; method: string }

let pool: string[]
let wallet: string[]

function answer(method: string): unknown {
  if (method === 'eth_chainId') return SEPOLIA_HEX
  if (method === 'eth_blockNumber') return '0x100'
  if (method === 'eth_getLogs') return []
  if (method === 'eth_call') return '0x'
  return null
}

/** A wallet that answers nothing a disconnected site asks, the way the leak was seen live. */
function countingWallet() {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      wallet.push(method)
      if (method === 'eth_chainId') return SEPOLIA_HEX
      if (method === 'eth_accounts') return []
      if (method === 'eth_call') return '0x'
      throw Object.assign(new Error('Internal JSON-RPC error.'), { code: -32603 })
    }),
    on: () => {},
    removeListener: () => {},
  }
}

beforeEach(() => {
  pool = []
  wallet = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Rpc | Rpc[]
    const rows = Array.isArray(body) ? body : [body]
    for (const row of rows) pool.push(row.method)
    const out = rows.map((r) => ({ jsonrpc: '2.0', id: r.id, result: answer(r.method) }))
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), {
      headers: { 'content-type': 'application/json' },
    })
  })
  ;(window as unknown as { ethereum: unknown }).ethereum = countingWallet()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { ethereum?: unknown }).ethereum
  rpc.bindWalletConnection?.(() => undefined)
})

function readClient() {
  const config = createConfig({
    chains: [sepolia],
    connectors: [injected()],
    multiInjectedProviderDiscovery: false,
    transports: { [sepolia.id]: rpc.decentralizedTransport(sepolia.id)! },
  })
  return { config, client: getPublicClient(config)! }
}

const TO = '0x1111111111111111111111111111111111111111' as const
const getLogs = { method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x2' }] } as const
const count = (log: string[], method: string) => log.filter((m) => m === method).length
/** Let ranking loops started during the requests send their first round of pings. */
const settle = () => new Promise((r) => setTimeout(r, 50))

describe('decentralizedTransport request budget', () => {
  it('20 reads from a disconnected visitor start one ranker and never reach the wallet', async () => {
    const { config, client } = readClient()
    rpc.bindWalletConnection?.(() => {
      const { current, connections } = config.state
      return current === null ? undefined : connections.get(current)
    })

    for (let i = 0; i < 20; i += 1) {
      await client.request(getLogs as never)
    }
    await settle()

    expect.soft(wallet).toEqual([])
    expect.soft(count(pool, 'eth_getLogs')).toBe(20)
    // One ranking loop sends one `eth_blockNumber` per pool entry per round, and the first round
    // is all that fits in this test; a loop per request would send that many times over.
    expect.soft(count(pool, 'eth_blockNumber')).toBeLessThanOrEqual(4)
  })

  it('a connected wallet carries eth_call and none of the log scans', async () => {
    const { client } = readClient()
    const provider = countingWallet()
    rpc.bindWalletConnection?.(() => ({
      chainId: sepolia.id,
      connector: { getProvider: async () => provider },
    }))

    await client.request({ method: 'eth_call', params: [{ to: TO }, 'latest'] })
    await client.request(getLogs as never)

    expect(wallet).toEqual(['eth_call'])
    expect(count(pool, 'eth_call')).toBe(0)
    expect(count(pool, 'eth_getLogs')).toBe(1)
  })

  it('a wallet connected on another chain is not asked', async () => {
    const { client } = readClient()
    const provider = countingWallet()
    rpc.bindWalletConnection?.(() => ({
      chainId: 1,
      connector: { getProvider: async () => provider },
    }))

    await client.request({ method: 'eth_call', params: [{ to: TO }, 'latest'] })

    expect(wallet).toEqual([])
    expect(count(pool, 'eth_call')).toBe(1)
  })
})
