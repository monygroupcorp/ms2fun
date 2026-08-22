import { describe, expect, test } from 'vitest'
import { ALLOW_REMOTE_HTTP_URIS, sanitizeImageUri } from '../metadata'
import { acceptedArtSchemes, artPointerError } from './artPointer'

// A CIDv1 in base32.
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

/** Every pointer shape worth deciding about, good and bad alike. */
const CASES = [
  `ipfs://${CID}`,
  `ipfs://${CID}/1`,
  `ar://${CID}`,
  'https://example.test/art.png',
  'http://example.test/art.png',
  'data:image/gif;base64,R0lGOD',
  'data:text/html,<script>x</script>',
  'javascript:alert(1)',
  'blob:https://example.test/1234',
  'file:///etc/passwd',
  'vbscript:msgbox(1)',
  '/art/local.png',
  'not-a-uri',
]

describe('artPointerError', () => {
  test('an absent pointer is not an error — art stays optional', () => {
    expect(artPointerError('')).toBeNull()
    expect(artPointerError('   ')).toBeNull()
    expect(artPointerError(undefined)).toBeNull()
    expect(artPointerError(null)).toBeNull()
  })

  test('a pointer the renderer would blank is refused, and the message names the accepted schemes', () => {
    for (const uri of [
      'javascript:alert(1)',
      'blob:https://example.test/1',
      'file:///etc/passwd',
    ]) {
      const message = artPointerError(uri)
      expect(message, uri).not.toBeNull()
      expect(message).toContain(acceptedArtSchemes())
    }
  })

  test('a data: URI carrying a document rather than an image is refused', () => {
    expect(artPointerError('data:text/html,<script>x</script>')).not.toBeNull()
    expect(artPointerError('data:image/gif;base64,R0lGOD')).toBeNull()
  })

  test('content-addressed pointers are accepted', () => {
    expect(artPointerError(`ipfs://${CID}`)).toBeNull()
    expect(artPointerError(`ar://${CID}`)).toBeNull()
  })

  // Asserted against the CONSTANT, not the literal `true`: `ALLOW_REMOTE_HTTP_URIS` is a product
  // ruling that can flip, and this test states the invariant (authoring agrees with the ruling)
  // rather than the ruling itself.
  test('remote http(s) art is accepted exactly when the product ruling allows it', () => {
    const refused = artPointerError('https://example.test/art.png') !== null
    expect(refused).toBe(!ALLOW_REMOTE_HTTP_URIS)
    expect(acceptedArtSchemes().includes('https://')).toBe(ALLOW_REMOTE_HTTP_URIS)
  })

  // THE regression that matters: divergence between what the wizard accepts and what the renderer
  // keeps is the whole defect, so the two verdicts are compared case by case.
  test('the wizard’s verdict and sanitizeImageUri’s agree for every case', () => {
    for (const uri of CASES) {
      const accepted = artPointerError(uri) === null
      expect(accepted, uri).toBe(sanitizeImageUri(uri) !== '')
    }
  })
})
