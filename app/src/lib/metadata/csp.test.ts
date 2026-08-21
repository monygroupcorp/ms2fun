/**
 * The app shell's Content-Security-Policy. `index.html` is the shell vite emits (and mirrors to
 * 404.html), so asserting on its text asserts on what every route serves.
 */
import { describe, expect, it } from 'vitest'
import indexHtml from '../../../index.html?raw'
import { gatewayUrl, IPFS_GATEWAYS } from './uri'

/** base32 CIDv1 — survives a DNS label, so every roster form can build a URL for it. */
const PROBE_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

function policy(): Record<string, string[]> {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(indexHtml)
  expect(meta, 'index.html carries a Content-Security-Policy meta tag').not.toBeNull()
  const out: Record<string, string[]> = {}
  for (const directive of (meta?.[1] ?? '').split(';')) {
    const [name, ...values] = directive.trim().split(/\s+/)
    if (name) out[name] = values
  }
  return out
}

/** Whether `url`'s origin is permitted by a source list (either as `https:` or named outright). */
function permits(sources: string[], url: string): boolean {
  const { protocol, origin } = new URL(url)
  return sources.some((s) => s === protocol || s === origin || s === `${origin}/`)
}

describe('Content-Security-Policy', () => {
  const csp = policy()

  it('locks down the sinks gateway bytes must never reach', () => {
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
  })

  it('admits no third-party script origin', () => {
    expect(csp['script-src']).toBeDefined()
    for (const src of csp['script-src'] ?? []) {
      expect(["'self'", "'unsafe-inline'"]).toContain(src)
    }
  })

  it('permits every gateway in the roster to serve images and be fetched', () => {
    expect(csp['img-src']).toBeDefined()
    expect(csp['connect-src']).toBeDefined()
    for (const gateway of IPFS_GATEWAYS) {
      const url = gatewayUrl(gateway, PROBE_CID)
      expect(url, `${gateway.operator} builds a URL for a CIDv1`).not.toBeNull()
      expect(permits(csp['img-src'] ?? [], url ?? ''), `img-src permits ${gateway.base}`).toBe(true)
      expect(
        permits(csp['connect-src'] ?? [], url ?? ''),
        `connect-src permits ${gateway.base}`,
      ).toBe(true)
    }
    // Inline art (`data:`) renders; the ar:// resolver host is reached over https like the rest.
    expect(csp['img-src']).toContain('data:')
    expect(permits(csp['img-src'] ?? [], 'https://arweave.net/tx')).toBe(true)
  })

  it('does not permit plain-http subresources', () => {
    for (const name of ['img-src', 'connect-src', 'script-src', 'style-src', 'font-src']) {
      expect(csp[name] ?? []).not.toContain('http:')
    }
  })
})
