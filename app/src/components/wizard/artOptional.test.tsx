import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { getConcept } from '@/lib/learn/concepts'
import { LearnLink } from './LearnLink'
import { buildDeployBlockers } from '../../routes/WizardPage'

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

// noesis-044 HARD CONSTRAINT (folds 045): art must NEVER gate deploy. `buildDeployBlockers` is the
// single source of truth for whether the Deploy button fires (noesis-132 lifted it out of the
// component as a pure, exported function), so proving no blocker ever references the cover image proves
// an empty cover cannot block deploy — even with everything else broken.
describe('empty cover image is not a deploy blocker', () => {
  test('no blocker references the cover image, even in a maximally-invalid state', () => {
    const blockers = buildDeployBlockers({
      metadataName: '', // no name/cover set at all
      nameError: null,
      nameTaken: false,
      walletConnected: false,
      ownerNeedsAgent: true,
      vaultSelected: false,
      coreErrors: { nftCount: 'Supply is required' },
      metaErrors: { tierWeights: 'Tier module selected — add at least one tier row' },
    })
    expect(blockers.length).toBeGreaterThan(0)
    for (const b of blockers) expect(b.message).not.toMatch(/image/i)
  })
})
