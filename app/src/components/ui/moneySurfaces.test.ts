import { describe, expect, it } from 'vitest'
import {
  blockHasMoneyReceipt,
  CONVERTED_ACTIONS,
  findActionBlock,
  MONEY_SURFACES,
  MONEY_SURFACES_FLOOR,
  UNCONVERTED,
  UNCONVERTED_BUDGET,
} from './moneySurfaces'

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

describe('MONEY_SURFACES ratchet', () => {
  it('UNCONVERTED never exceeds its budget — raising it needs a reviewed, visible diff', () => {
    expect(UNCONVERTED.length).toBeLessThanOrEqual(UNCONVERTED_BUDGET)
  })

  it('MONEY_SURFACES never shrinks below its floor — deleting a censused path is a visible diff too', () => {
    // Deleting a path from BOTH MONEY_SURFACES and UNCONVERTED used to pass every other assertion
    // here and *shrink* UNCONVERTED for free — a two-line diff that reads as cleanup and burying an
    // inconvenient surface look identical without this floor (noesis-215 Step 5).
    expect(MONEY_SURFACES.length).toBeGreaterThanOrEqual(MONEY_SURFACES_FLOOR)
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

  it('every CONVERTED_ACTIONS entry belongs to a converted (non-UNCONVERTED) MONEY_SURFACES file', () => {
    for (const action of CONVERTED_ACTIONS) {
      expect(
        MONEY_SURFACES,
        `${action.file} (action ${action.testId}) is not in MONEY_SURFACES`,
      ).toContain(action.file)
      expect(
        UNCONVERTED,
        `${action.file} (action ${action.testId}) is in CONVERTED_ACTIONS but also still in UNCONVERTED`,
      ).not.toContain(action.file)
    }
  })

  it('every converted file has at least one registered money action', () => {
    const converted = MONEY_SURFACES.filter((s) => !UNCONVERTED.includes(s))
    expect(converted.length).toBeGreaterThan(0)
    for (const surface of converted) {
      const actions = CONVERTED_ACTIONS.filter((a) => a.file === surface)
      expect(
        actions.length,
        `${surface} is converted but has no CONVERTED_ACTIONS entries`,
      ).toBeGreaterThan(0)
    }
  })

  it('every money action carries a receipt — per action, not per file', () => {
    for (const action of CONVERTED_ACTIONS) {
      const source = SOURCE_FILES[toGlobKey(action.file)]
      expect(source, `missing on disk: ${action.file}`).toBeDefined()
      const block = findActionBlock(source ?? '', action.testId)
      expect(
        block,
        `${action.file}: no TxButton/testId or data-testid="${action.testId}-success" anchor found ` +
          `for action "${action.testId}" — it moved or was deleted`,
      ).toBeDefined()
      expect(
        blockHasMoneyReceipt(block ?? ''),
        `${action.file}: action "${action.testId}" confirms with a bare, amountless successLabel — ` +
          `give it a receipt= (or a formatReceipt() call for a hand-rolled confirmation)`,
      ).toBe(true)
    }
  })
})

describe('blockHasMoneyReceipt — observed failing (noesis-215 Step 2 acceptance)', () => {
  // A ratchet that has never been observed failing is not known to work. This block deliberately
  // feeds the checker the EXACT evasion noesis-212's first pass produced: ten money labels
  // mechanically rewritten from `successLabel="…"` to `successLabel={'…'}` to dodge the old regex
  // (`/successLabel\s*=\s*["'][^"'{}]*["']/`, which required the quote directly after `=` and so
  // never matched the brace-wrapped spelling), reported as a no-op syntactic change.
  it('fails on the braces-wrapped bare-literal evasion the old regex missed', () => {
    const evasion = `
      <TxButton
        state={tx.state}
        onClick={() => tx.send({ functionName: 'deployLiquidity' })}
        label="deploy liquidity"
        successLabel={'liquidity deployed'}
        onReset={tx.reset}
        testId="fixture-deploy-liquidity"
      />
    `
    expect(blockHasMoneyReceipt(evasion)).toBe(false)
  })

  it('still fails on the original unwrapped bare-literal form', () => {
    const bare = `
      <TxButton
        state={tx.state}
        onClick={onClick}
        label="claim"
        successLabel="fees claimed"
        testId="fixture-claim"
      />
    `
    expect(blockHasMoneyReceipt(bare)).toBe(false)
  })

  it('passes when a receipt= prop is present, even alongside a bare successLabel fallback', () => {
    const withReceipt = `
      <TxButton
        state={tx.state}
        onClick={onClick}
        label="deploy liquidity"
        receipt={carveReceipt}
        successLabel={carveReceipt !== undefined ? undefined : 'graduated — carve details unavailable'}
        testId="fixture-with-receipt"
      />
    `
    expect(blockHasMoneyReceipt(withReceipt)).toBe(true)
  })

  it('passes on a hand-rolled confirmation built with formatReceipt()', () => {
    const handRolled = `
      <p className={styles.txStatus} data-testid="fixture-bid-success">
        {formatReceipt({ verb: 'bid placed', net: { label: 'bid', wei: amountWei } })}
      </p>
    `
    expect(blockHasMoneyReceipt(handRolled)).toBe(true)
  })

  it('passes on a dynamic (interpolated) successLabel even with no digit in the source literal', () => {
    const interpolated = `
      <TxButton
        state={tx.state}
        onClick={onClick}
        label="withdraw ERC20"
        successLabel={\`withdrawn \${amt.toString()} base units to \${to}\`}
        testId="fixture-withdraw-erc20"
      />
    `
    expect(blockHasMoneyReceipt(interpolated)).toBe(true)
  })
})
