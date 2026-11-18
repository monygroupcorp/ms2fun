import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  logScanPaths,
  readLastResort,
  readNarrowLogRange,
  readPools,
  readRegistries,
} from './check-rpcs'

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

  it('reads a last-resort log path for Sepolia, and it is a pool entry there', () => {
    const lastResort = readLastResort(rpcSource).get(11155111) ?? []
    expect(lastResort.length).toBeGreaterThan(0)
    for (const url of lastResort) expect(readPools(rpcSource).get(11155111)).toContain(url)
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

  it('skips a chain whose registry is still the zero address', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-rpcs-'))
    const zero = `0x${'0'.repeat(40)}`
    writeFileSync(
      join(dir, 'mainnet-deployment.json'),
      JSON.stringify({ chainId: 1, contracts: { MasterRegistryV1: zero } }),
    )
    expect(readRegistries(dir).has(1)).toBe(false)
  })

  it('finds no log path on a chain whose only serving entries are kept off log scans', () => {
    const ok = { app: 'ok (4 logs)' }
    expect(
      logScanPaths([
        { url: 'https://narrow', logs: ok, skipped: true },
        { url: 'https://refuses', logs: { app: 'refused: -32601' }, skipped: false },
      ]),
    ).toEqual([])
    expect(
      logScanPaths([
        { url: 'https://narrow', logs: ok, skipped: true },
        { url: 'https://wide', logs: ok, skipped: false },
      ]),
    ).toEqual(['https://wide'])
  })
})
