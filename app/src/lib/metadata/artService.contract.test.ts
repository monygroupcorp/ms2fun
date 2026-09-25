/**
 * The art service and the app agree about two things, and neither is enforced by types.
 *
 * The service lives in `services/art/` and cannot import this package — it is deployed on its own,
 * and the only shared code is the dependency-free `gateways.ts`. So the width rungs exist in three
 * places: `ART_WIDTHS` here, `DEFAULT_WIDTHS` in the worker, and `ART_WIDTHS` in its wrangler vars.
 *
 * A drift between them is silent and one-directional: the app asks for a width, the service refuses
 * it as unsupported, every card falls back to a public gateway, and the service looks like it is
 * working because it is answering — with a 400. That is the whole failure this file exists to catch,
 * and it is why the rungs are READ from those files rather than repeated here.
 */

import { describe, expect, it } from 'vitest'

import { ART_WIDTHS, artServiceUrl, snapArtWidth } from './uri'

const SERVICE = import.meta.glob(
  '../../../../services/art/{wrangler.toml,README.md,src/worker.ts}',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

function read(name: string): string {
  const key = Object.keys(SERVICE).find((path) => path.endsWith(`/${name}`))
  if (key === undefined) throw new Error(`services/art/${name} was not readable from this test`)
  return SERVICE[key]!
}

describe('the art service contract', () => {
  it('serves exactly the width rungs the app asks for', () => {
    const declared = read('wrangler.toml').match(/^ART_WIDTHS\s*=\s*"([^"]+)"/m)
    expect(declared, 'wrangler.toml declares no ART_WIDTHS').not.toBeNull()
    const configured = declared![1]!.split(',').map((w: string) => Number.parseInt(w.trim(), 10))
    expect(configured).toEqual([...ART_WIDTHS])
  })

  it("the worker's own fallback rungs match too, for a deployment that sets no vars", () => {
    const declared = read('worker.ts').match(/const DEFAULT_WIDTHS = \[([^\]]+)\]/)
    expect(declared, 'worker.ts declares no DEFAULT_WIDTHS').not.toBeNull()
    const fallback = declared![1]!.split(',').map((w: string) => Number.parseInt(w.trim(), 10))
    expect(fallback).toEqual([...ART_WIDTHS])
  })

  it('answers the path the app actually builds', () => {
    // `artServiceUrl` is the only thing that constructs these, so its output is the specification.
    expect(artServiceUrl('bafyreiabc123', snapArtWidth(300))).toBeNull() // unset is supported

    const prefix = read('worker.ts').match(/const prefix = '([^']+)'/)
    expect(prefix, 'worker.ts declares no route prefix').not.toBeNull()
    expect(prefix![1]).toBe('/art/')
  })

  it('carries no account identifier, credential or deployment hostname', () => {
    // rth 2026-09-25: open source, and lean. A fork stands up its own service; this repository
    // never learns ours. Asserted rather than trusted, because a deploy is one paste away from
    // putting an account id in the file that configures it.
    //
    // Matches a VALUE and never a mention. Documentation has to be able to say
    // `export CLOUDFLARE_API_TOKEN=...` in order to tell a fork to set it somewhere else, and an
    // earlier version of this excluded lines by phrase instead — which let any line carrying the
    // right words through, a hole exactly where the guard is supposed to be solid.
    const SECRET =
      /\b[0-9a-f]{32,}\b|\b[a-z0-9-]+\.workers\.dev\b|(?:account_id|api[_-]?token)\s*[=:]\s*["']?[A-Za-z0-9_-]{8,}/i
    for (const file of ['wrangler.toml', 'worker.ts', 'README.md']) {
      const offenders = read(file)
        .split('\n')
        .filter((line: string) => SECRET.test(line))
      expect(offenders, `services/art/${file} names a deployment identifier`).toEqual([])
    }
  })
})
