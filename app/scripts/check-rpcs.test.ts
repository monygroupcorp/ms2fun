import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readNarrowLogRange, readPools, readRegistries } from './check-rpcs'

const here = dirname(fileURLToPath(import.meta.url))
const rpcSource = readFileSync(resolve(here, '../src/lib/rpc.ts'), 'utf-8')

describe('check-rpcs reads what the app ships', () => {
  it('finds a pool for mainnet and Sepolia in rpc.ts', () => {
    const pools = readPools(rpcSource)
    expect(pools.get(1)?.length).toBeGreaterThan(0)
    expect(pools.get(11155111)?.length).toBeGreaterThan(0)
  })

  it('reads NARROW_LOG_RANGE, and every entry in it is a pool entry', () => {
    const narrow = readNarrowLogRange(rpcSource)
    const pooled = [...readPools(rpcSource).values()].flat()
    expect(narrow.length).toBeGreaterThan(0)
    for (const url of narrow) expect(pooled).toContain(url)
  })

  it('lists each NARROW_LOG_RANGE entry once', () => {
    const narrow = readNarrowLogRange(rpcSource)
    expect(narrow).toEqual([...new Set(narrow)])
  })

  it('reads NARROW_LOG_RANGE entries across lines and past comments', () => {
    const source = `const NARROW_LOG_RANGE: string[] = [\n  // why\n  'https://a',\n  'https://b',\n]`
    expect(readNarrowLogRange(source)).toEqual(['https://a', 'https://b'])
  })

  it('takes each chain registry from its deployment file and skips the local ones', () => {
    const registries = readRegistries(resolve(here, '../src/config'))
    expect(registries.get(11155111)).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(registries.has(1337)).toBe(false)
  })
})
