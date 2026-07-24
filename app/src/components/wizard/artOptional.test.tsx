import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { getConcept } from '@/lib/learn/concepts'
import { LearnLink } from './LearnLink'
// Raw source of WizardPage, via Vite's `?raw` loader — lets us assert an invariant about the
// component-local `deployBlockers` IIFE without exporting it.
import wizardPageSource from '../../routes/WizardPage.tsx?raw'

afterEach(cleanup)

// The concepts wired onto the bespoke (non-SchemaForm) surfaces by noesis-044. Each must resolve to a
// real /learn concept (dead-link guard) and render as an anchor to its doc.
const WIRED_SLUGS = [
  'alignment-vault', // AlignmentTargetPicker
  'withholding-art', // CollectionMetaForm cover
  'onchain-image-cost', // CollectionMetaForm cover
  'cover-vs-banner', // CollectionMetaForm banner
] as const

describe('bespoke-surface LearnLinks', () => {
  for (const slug of WIRED_SLUGS) {
    test(`${slug} resolves to a concept`, () => {
      expect(getConcept(slug)).toBeDefined()
    })

    test(`${slug} renders an anchor to /learn/${slug}`, () => {
      render(<LearnLink slug={slug} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', `/learn/${slug}`)
      expect(link).toHaveAttribute('target', '_blank')
    })
  }
})

// noesis-044 HARD CONSTRAINT (folds 045): art must NEVER gate deploy. `deployBlockers` is the single
// list that governs whether the Deploy button fires, so proving `image` is absent from it proves an
// empty cover cannot block deploy. Asserted at source level because the block is a component-local IIFE
// (not exported) and the plan forbids refactoring it to expose it for a render test.
describe('empty cover image is not a deploy blocker', () => {
  const src = wizardPageSource

  test('the deployBlockers block never references image', () => {
    const start = src.indexOf('const deployBlockers')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('})()', start)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)
    expect(block).not.toMatch(/image/i)
  })
})
