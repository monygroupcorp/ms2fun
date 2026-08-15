import { describe, expect, it } from 'vitest'
import { MONEY_SURFACES, UNCONVERTED, UNCONVERTED_BUDGET } from './moneySurfaces'

// Every path in the census is repo-root relative (`app/src/…`, matching the scope_dirs
// convention). Vite's `import.meta.glob` keys are project-root relative (`/src/…`, project root =
// `app/`) — read source via glob rather than node:fs so this stays in the app's browser-target
// tsconfig (no `node:fs`/`node:path`/`process` types configured there).
const SOURCE_FILES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function toGlobKey(repoRootRelativePath: string): string {
  return `/${repoRootRelativePath.replace(/^app\//, '')}`
}

// A bare `successLabel="…"` JSX prop with a plain string literal — the confirmation this item
// exists to eliminate from a converted money surface. Deliberately narrow (source-level scan, not
// an AST parse): a hand-rolled confirmation that never used TxButton's `successLabel` prop at all
// (e.g. AuctionCard's bid form) doesn't trip it, which is a known, accepted gap — see the module
// doc comment on moneySurfaces.ts.
const BARE_SUCCESS_LABEL = /successLabel\s*=\s*["'][^"'{}]*["']/

describe('MONEY_SURFACES ratchet', () => {
  it('UNCONVERTED never exceeds its budget — raising it needs a reviewed, visible diff', () => {
    expect(UNCONVERTED.length).toBeLessThanOrEqual(UNCONVERTED_BUDGET)
  })

  it('every censused surface exists on disk (a rename cannot silently drop one)', () => {
    for (const surface of MONEY_SURFACES) {
      expect(SOURCE_FILES[toGlobKey(surface)], `missing on disk: ${surface}`).toBeDefined()
    }
  })

  it('every UNCONVERTED surface is a MONEY_SURFACES member', () => {
    for (const surface of UNCONVERTED) {
      expect(MONEY_SURFACES, `${surface} is in UNCONVERTED but not MONEY_SURFACES`).toContain(
        surface,
      )
    }
  })

  it('every converted surface uses a receipt and carries no bare successLabel literal', () => {
    const converted = MONEY_SURFACES.filter((s) => !UNCONVERTED.includes(s))
    expect(converted.length).toBeGreaterThan(0)
    for (const surface of converted) {
      const source = SOURCE_FILES[toGlobKey(surface)]
      expect(source, `missing on disk: ${surface}`).toBeDefined()
      const usesReceipt =
        (source ?? '').includes('formatReceipt') || (source ?? '').includes('receipt=')
      expect(usesReceipt, `${surface} is marked converted but never builds a receipt`).toBe(true)
      const bareMatch = (source ?? '').match(BARE_SUCCESS_LABEL)
      expect(
        bareMatch,
        `${surface} is marked converted but still has a bare successLabel: ${bareMatch?.[0]}. ` +
          `Either convert it to a receipt, or move the path into UNCONVERTED.`,
      ).toBeNull()
    }
  })
})
