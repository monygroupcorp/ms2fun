import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertArtServicePublishable,
  assertPublishable,
  CONFIG_BY_CHAIN_ID,
  probeArtService,
  resolvePublishChainId,
} from './assert-publishable'

const here = dirname(fileURLToPath(import.meta.url))
const committedConfig = JSON.parse(
  readFileSync(resolve(here, '../src/config/local-deployment.json'), 'utf-8'),
)

function realFixture(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-08-18T12:00:00.000Z',
    chainId: 8453,
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226',
    contracts: {
      MasterRegistryV1: '0x1111111111111111111111111111111111111111',
      AlignmentRegistryV1: '0x2222222222222222222222222222222222222222',
    },
    ...overrides,
  }
}

describe('assertPublishable', () => {
  it('refuses the committed placeholder with all three reason classes', () => {
    const reasons = assertPublishable(committedConfig)
    expect(reasons.some((r) => r.includes('1337'))).toBe(true)
    expect(reasons.some((r) => r.includes('zero address'))).toBe(true)
    expect(reasons.some((r) => r.includes('epoch sentinel'))).toBe(true)
  })

  it('accepts a synthetic artifact with a real chain id, non-zero addresses and a real timestamp', () => {
    expect(assertPublishable(realFixture())).toEqual([])
  })

  it('refuses on chainId alone (1337, otherwise real)', () => {
    const reasons = assertPublishable(realFixture({ chainId: 1337 }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('1337')
  })

  it('refuses on a zero address alone (otherwise real)', () => {
    const reasons = assertPublishable(
      realFixture({
        contracts: {
          MasterRegistryV1: '0x1111111111111111111111111111111111111111',
          AlignmentRegistryV1: '0x0000000000000000000000000000000000000000',
        },
      }),
    )
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('AlignmentRegistryV1')
  })

  it('refuses on the epoch sentinel alone (otherwise real)', () => {
    const reasons = assertPublishable(realFixture({ generatedAt: '1970-01-01T00:00:00.000Z' }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('epoch sentinel')
  })

  it('honours an explicit allowChainIds list', () => {
    expect(assertPublishable(realFixture({ chainId: 84532 }), { allowChainIds: [84532] })).toEqual(
      [],
    )
    expect(assertPublishable(realFixture({ chainId: 1337 }), { allowChainIds: [1337] })).toEqual([])
  })
})

describe('resolvePublishChainId', () => {
  it('refuses an unset or empty VITE_CHAIN_ID, naming the fallback that makes it dangerous', () => {
    for (const value of [undefined, '', '   ']) {
      const result = resolvePublishChainId(value)
      expect(typeof result).toBe('string')
      expect(result).toContain('VITE_CHAIN_ID')
      expect(result).toContain('anvil')
    }
  })

  it('refuses a value that is not a chain id', () => {
    expect(resolvePublishChainId('mainnet')).toContain('not a chain id')
    expect(resolvePublishChainId('11155111.5')).toContain('not a chain id')
  })

  it('refuses a chain the app carries no config for, and lists the ones it does', () => {
    const result = resolvePublishChainId('8453')
    expect(result).toContain('8453')
    expect(result).toContain('11155111')
  })

  it('resolves the chains the app ships a config for', () => {
    expect(resolvePublishChainId('1337')).toBe(1337)
    expect(resolvePublishChainId('11155111')).toBe(11155111)
  })
})

describe('the shipped configs, read through the map the CLI uses', () => {
  function shipped(chainId: number) {
    return JSON.parse(readFileSync(resolve(here, '..', CONFIG_BY_CHAIN_ID[chainId]), 'utf-8'))
  }

  it('every mapped config describes the chain it is mapped under', () => {
    for (const key of Object.keys(CONFIG_BY_CHAIN_ID)) {
      const chainId = Number(key)
      expect(shipped(chainId).chainId).toBe(chainId)
    }
  })

  it('clears the committed Sepolia record for publishing', () => {
    expect(assertPublishable(shipped(11155111), { allowChainIds: [11155111] })).toEqual([])
  })

  it('still refuses the anvil placeholder, which is never committed with real values', () => {
    const reasons = assertPublishable(shipped(1337), { allowChainIds: [1337] })
    expect(reasons.some((r) => r.includes('zero address'))).toBe(true)
    expect(reasons.some((r) => r.includes('epoch sentinel'))).toBe(true)
  })
})

describe('assertArtServicePublishable', () => {
  it('refuses an unset value, naming the opt-out rather than just complaining', () => {
    const reasons = assertArtServicePublishable(undefined)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('PUBLISH_WITHOUT_ART_SERVICE=1')
  })

  it('refuses a blank value the same way', () => {
    expect(assertArtServicePublishable('   ')).toHaveLength(1)
  })

  it('allows unset when a roster-only publish is asked for out loud', () => {
    expect(assertArtServicePublishable(undefined, { allowNone: true })).toEqual([])
    expect(assertArtServicePublishable('', { allowNone: true })).toEqual([])
  })

  it('accepts an https origin, with or without a trailing slash', () => {
    expect(assertArtServicePublishable('https://art.example')).toEqual([])
    expect(assertArtServicePublishable('https://art.example/')).toEqual([])
  })

  // The value the app silently ignores is the dangerous one: a scheme-less hostname reads as "no
  // service" to artServiceBase(), so the build is roster-only and nothing says so.
  it('refuses a hostname with no scheme, which the app would read as no service at all', () => {
    const reasons = assertArtServicePublishable('art.example')
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('not an http(s) origin')
  })

  it('refuses http://, which a pinned bundle cannot load over https', () => {
    const reasons = assertArtServicePublishable('http://art.example')
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('mixed content')
  })

  it('refuses an address that only resolves on the build machine', () => {
    expect(assertArtServicePublishable('https://localhost:8787')).toHaveLength(1)
    expect(assertArtServicePublishable('https://127.0.0.1:8787')).toHaveLength(1)
    expect(assertArtServicePublishable('https://art.local')).toHaveLength(1)
  })

  it('allows the opt-out to be overtaken by a value that is present but wrong', () => {
    // allowNone is about publishing with NO service, not about publishing with a broken one.
    const reasons = assertArtServicePublishable('art.example', { allowNone: true })
    expect(reasons).toHaveLength(1)
  })
})

describe('probeArtService', () => {
  const ok = async () => new Response('unsupported width', { status: 400 })

  it('passes on the 400 only the worker gives a request with no width', async () => {
    expect(await probeArtService('https://art.example', ok as unknown as typeof fetch)).toEqual([])
  })

  it('asks for the width-less path, which reaches no gateway', async () => {
    let asked = ''
    const spy = (async (url: string | URL) => {
      asked = String(url)
      return new Response('unsupported width', { status: 400 })
    }) as unknown as typeof fetch
    await probeArtService('https://art.example', spy)
    expect(asked).toMatch(/^https:\/\/art\.example\/art\/[A-Za-z0-9]{46,}$/)
    expect(asked).not.toContain('?w=')
  })

  // The failure this exists to catch: a hostname on a CDN with no worker route bound. It answers,
  // it looks healthy, and it serves no art.
  it("refuses a CDN's own 404, which is what an unbound hostname returns", async () => {
    const cdn = (async () =>
      new Response('<html><title>Not Found</title></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch
    const reasons = await probeArtService('https://art.example', cdn)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('404')
    expect(reasons[0]).toContain('services/art')
  })

  it('reports a 410 as the route being proven and nothing else', async () => {
    const denied = (async () => new Response('gone', { status: 410 })) as unknown as typeof fetch
    const reasons = await probeArtService('https://art.example', denied)
    expect(reasons[0]).toContain('ART_DENYLIST')
  })

  it('reports an origin that cannot be reached at all', async () => {
    const dead = (async () => {
      throw new Error('getaddrinfo ENOTFOUND art.example')
    }) as unknown as typeof fetch
    const reasons = await probeArtService('https://art.example', dead)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('could not be reached')
  })

  it('gives up rather than hanging when an origin accepts and never answers', async () => {
    const silent = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch
    const reasons = await probeArtService('https://art.example', silent, 10)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('could not be reached')
  })
})
