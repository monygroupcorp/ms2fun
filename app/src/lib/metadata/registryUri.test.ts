import { describe, expect, test } from 'vitest'
import { isRegistryMetadataURI, isStorableMetadataURI } from './registryUri'

describe('isRegistryMetadataURI', () => {
  test('accepts every scheme the on-chain allowlist admits', () => {
    expect(isRegistryMetadataURI('https://example.org/target.json')).toBe(true)
    expect(isRegistryMetadataURI('ipfs://bafyreigh2akiscaildc')).toBe(true)
    expect(isRegistryMetadataURI('ar://Ky1c1Kkt-jZ9sY1SAzp5aWZ5Q')).toBe(true)
    expect(isRegistryMetadataURI('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true)
    expect(isRegistryMetadataURI('data:application/json;base64,e30=')).toBe(true)
  })

  test('rejects the data media types the library excludes to close stored XSS', () => {
    expect(isRegistryMetadataURI('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isRegistryMetadataURI('data:,plain')).toBe(false)
    expect(isRegistryMetadataURI('data:image')).toBe(false)
  })

  test('rejects plain http, other schemes, bare text and the empty string', () => {
    expect(isRegistryMetadataURI('http://example.org/target.json')).toBe(false)
    expect(isRegistryMetadataURI('javascript:alert(1)')).toBe(false)
    expect(isRegistryMetadataURI('bafyreigh2akiscaildc')).toBe(false)
    expect(isRegistryMetadataURI('')).toBe(false)
  })

  test('is prefix-anchored — an accepted scheme later in the string does not qualify', () => {
    expect(isRegistryMetadataURI(' https://example.org')).toBe(false)
    expect(isRegistryMetadataURI('x-ipfs://bafy')).toBe(false)
  })
})

describe('isStorableMetadataURI', () => {
  test('admits the empty string, which the contract treats as clearing the pointer', () => {
    expect(isStorableMetadataURI('')).toBe(true)
  })

  test('otherwise agrees with the allowlist', () => {
    expect(isStorableMetadataURI('ipfs://bafyreigh2akiscaildc')).toBe(true)
    expect(isStorableMetadataURI('http://example.org')).toBe(false)
  })
})
