import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { IPFS_GATEWAYS, gatewayUrl, resolveUri } from '@/lib/metadata'
import { ImageSourceInput, toPreviewCandidates } from './ImageSourceInput'

afterEach(cleanup)

// A CIDv1 in base32, so every roster entry can address it — path form and subdomain form alike.
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

describe('preview resolution goes through the shared gateway roster', () => {
  test('every ipfs:// candidate is one the shared roster produced', () => {
    const candidates = toPreviewCandidates(`ipfs://${CID}`)
    const fromRoster = IPFS_GATEWAYS.map((g) => gatewayUrl(g, CID)).filter(
      (url): url is string => url !== null,
    )
    expect(candidates.length).toBeGreaterThan(0)
    for (const url of candidates) expect(fromRoster).toContain(url)
  })

  test('an ipfs:// pointer yields more than one candidate, so a failing gateway can be rotated past', () => {
    expect(toPreviewCandidates(`ipfs://${CID}`).length).toBeGreaterThan(1)
  })

  test('ar:// resolves through the library rather than a host spelled out in this form', () => {
    expect(toPreviewCandidates(`ar://${CID}`)).toEqual([resolveUri(`ar://${CID}`)])
  })

  test('https:// and data: pointers pass through unchanged; unknown schemes resolve to nothing', () => {
    expect(toPreviewCandidates('https://example.test/art.png')).toEqual([
      'https://example.test/art.png',
    ])
    expect(toPreviewCandidates('data:image/gif;base64,R0lGOD')).toEqual([
      'data:image/gif;base64,R0lGOD',
    ])
    expect(toPreviewCandidates('javascript:alert(1)')).toEqual([])
    expect(toPreviewCandidates('   ')).toEqual([])
  })
})

// The acceptance criterion for noesis-378: the wizard carries no gateway host of its own, so the
// preview and the renderer can never disagree about which hosts to try. Asserted over the directory's
// source rather than over one file, because a second copy anywhere in the wizard is the same defect.
describe('no gateway host is hardcoded in the wizard', () => {
  // `import.meta.glob` resolves at transform time, so this sees the directory as it is on disk
  // rather than as this test imagines it.
  const sources = Object.entries(
    import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >,
  ).filter(([path]) => !/\.test\.tsx?$/.test(path))

  test('the directory has sources to check', () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  for (const [name, src] of sources) {
    test(`${name} names no gateway host`, () => {
      expect(src).not.toMatch(/ipfs\.io/)
      expect(src).not.toMatch(/arweave\.net/)
      expect(src).not.toMatch(/\/ipfs\//)
    })
  }
})

describe('the preview rotates to the next candidate on error', () => {
  test('an image error advances to the next roster URL', () => {
    const candidates = toPreviewCandidates(`ipfs://${CID}`)
    render(
      <ImageSourceInput id="cover" label="Cover" value={`ipfs://${CID}`} onChange={() => {}} />,
    )
    const img = screen.getByAltText('Cover preview')
    expect(img).toHaveAttribute('src', candidates[0])
    fireEvent.error(img)
    expect(screen.getByAltText('Cover preview')).toHaveAttribute('src', candidates[1])
  })

  test('the Remove control survives every candidate failing', () => {
    const candidates = toPreviewCandidates(`ipfs://${CID}`)
    render(
      <ImageSourceInput id="cover" label="Cover" value={`ipfs://${CID}`} onChange={() => {}} />,
    )
    for (let i = 0; i < candidates.length; i++) {
      fireEvent.error(screen.getByAltText('Cover preview'))
    }
    expect(screen.queryByAltText('Cover preview')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})
