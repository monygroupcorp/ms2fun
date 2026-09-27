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

import { describe, expect, it, vi } from 'vitest'

import {
  ART_SERVICE_KEY,
  ART_WIDTHS,
  artServiceUrl,
  metaServiceUrl,
  resolveMetaCandidates,
  snapArtWidth,
} from './uri'

/** Any well-formed CID; these assertions are about routing and never about what is behind one. */
const PROBE_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

const SERVICE = import.meta.glob(
  '../../../../services/art/{wrangler.toml,README.md,src/worker.ts}',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

/**
 * EVERY hand-written file in the service, for the identifier guard.
 *
 * Named apart from `SERVICE` above, which is a fixed list the rung assertions read by name. The
 * guard must not be a fixed list: it existed while `scripts/spend.ts` was added — a file whose whole
 * job is to hold an account id and an API token in variables — and would have gone on passing
 * because that path was not one of the three it named.
 */
const SERVICE_TREE = import.meta.glob('../../../../services/art/**/*.{ts,toml,md,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Every component and route in the app, read as source, for the render-site guard below. */
const APP_SOURCES = import.meta.glob('../../{components,routes}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

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

  it('answers both paths the app actually builds', () => {
    // `artServiceUrl` and `metaServiceUrl` are the only things that construct these, so their output
    // is the specification. Unset is supported and is what this test environment runs in.
    expect(artServiceUrl('bafyreiabc123', snapArtWidth(300))).toBeNull()
    expect(metaServiceUrl('bafyreiabc123')).toBeNull()

    const worker = read('worker.ts')
    for (const [name, expected] of [
      ['ART', '/art/'],
      ['META', '/meta/'],
    ] as const) {
      const declared = worker.match(new RegExp(`const ${name} = '([^']+)'`))
      expect(declared, `worker.ts declares no ${name} route`).not.toBeNull()
      expect(declared![1]).toBe(expected)
    }
  })

  it('asks the SERVICE for metadata before any public gateway, when one is configured', () => {
    // The art half of this shipped first and on its own, which left the JSON that names the art's
    // CID still coming from a metered third-party gateway — one request per card, before anything
    // rendered. Asserted here rather than in a comment because it is the half that is easy to forget.
    vi.stubEnv('VITE_ART_SERVICE', 'https://art.example')
    try {
      const candidates = resolveMetaCandidates(`ipfs://${PROBE_CID}`)
      expect(candidates[0]).toEqual({
        url: `https://art.example/meta/${PROBE_CID}`,
        gatewayKey: ART_SERVICE_KEY,
      })
      expect(candidates.length).toBeGreaterThan(1) // the roster stays behind it
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('falls back to the roster alone when no service is configured', () => {
    const candidates = resolveMetaCandidates(`ipfs://${PROBE_CID}`)
    expect(candidates.every((c) => c.gatewayKey !== ART_SERVICE_KEY)).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
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
    for (const [path, source] of Object.entries(SERVICE_TREE)) {
      if (path.includes('/node_modules/') || path.endsWith('pnpm-lock.yaml')) continue
      const offenders = source.split('\n').filter((line: string) => SECRET.test(line))
      expect(
        offenders,
        `${path.replace(/^.*\/services\//, 'services/')} names an identifier`,
      ).toEqual([])
    }
  })

  it('reads the whole service tree, so the guard above cannot go vacuous', () => {
    // A glob that stopped matching — a rename, a moved directory — would make every assertion in
    // that loop pass by having nothing to loop over.
    const paths = Object.keys(SERVICE_TREE).map((p) => p.replace(/^.*\/services\/art\//, ''))
    expect(paths).toContain('src/worker.ts')
    expect(paths).toContain('scripts/spend.ts')
    expect(paths).toContain('wrangler.toml')
    expect(paths).toContain('README.md')
  })

  /**
   * THE GUARD THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. The service, its worker, its R2 cache and
   * this whole width ladder shipped and then sat unused for a fortnight, because `IpfsImage`'s
   * `width` prop is what puts the service in front of the roster and not one render site passed it.
   * Nothing looked broken — every card still rendered, just at full size and on the viewer's quota,
   * which is the exact bill this service exists to stop paying.
   *
   * So a render site that asks for no width is a DECISION and has to be written down here. The list
   * being empty is the point; a new grid added without a width fails this test by default.
   */
  it('every art render site declares the size it needs', () => {
    /** Sites that deliberately want the original. Add with a reason, not to make this pass. */
    const ORIGINAL_ON_PURPOSE: readonly string[] = []

    const offenders: string[] = []
    for (const [path, source] of Object.entries(APP_SOURCES)) {
      const file = path.replace(/^.*\/src\//, 'src/')
      if (file.endsWith('.test.tsx') || file.endsWith('/IpfsImage.tsx')) continue
      if (ORIGINAL_ON_PURPOSE.includes(file)) continue
      // Each element from its opening tag to the closing `/>` or `>`, whichever ends the props.
      for (const element of source.match(/<IpfsImage\b[\s\S]*?\/>/g) ?? []) {
        if (!/\bwidth=\{/.test(element)) offenders.push(file)
      }
    }

    expect(offenders, 'these render art with no width, so the art service is never asked').toEqual(
      [],
    )
  })

  it('reads enough source for that guard to mean anything', () => {
    // A glob that matched nothing would make the guard above pass vacuously forever.
    const withArt = Object.values(APP_SOURCES).filter((src) => src.includes('<IpfsImage'))
    expect(withArt.length).toBeGreaterThan(15)
  })
})
