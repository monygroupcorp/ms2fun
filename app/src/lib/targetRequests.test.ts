import { describe, expect, it } from 'vitest'
import {
  RequestStatus,
  assetTokenValid,
  isNonzeroAddress,
  pickMyRequestIds,
  requestStatusLabel,
  titleValid,
  toContractAssets,
  validateRequestForm,
  type AssetInput,
} from './targetRequests'

const TOKEN_A = '0x1111111111111111111111111111111111111111'
const TOKEN_B = '0x2222222222222222222222222222222222222222'
const ZERO = '0x0000000000000000000000000000000000000000'

const asset = (over: Partial<AssetInput> = {}): AssetInput => ({
  token: TOKEN_A,
  symbol: 'AAA',
  info: 'the A community',
  metadataURI: '',
  ...over,
})

describe('requestStatusLabel', () => {
  it('maps every enum value to its label', () => {
    expect(requestStatusLabel(RequestStatus.None)).toBe('None')
    expect(requestStatusLabel(RequestStatus.Pending)).toBe('Pending')
    expect(requestStatusLabel(RequestStatus.Approved)).toBe('Approved')
    expect(requestStatusLabel(RequestStatus.Rejected)).toBe('Rejected')
    expect(requestStatusLabel(RequestStatus.Expired)).toBe('Expired')
  })
  it('falls back to None for an out-of-range status', () => {
    expect(requestStatusLabel(99)).toBe('None')
  })
})

describe('isNonzeroAddress', () => {
  it('accepts a well-formed nonzero address (trims + is case-insensitive)', () => {
    expect(isNonzeroAddress(TOKEN_A)).toBe(true)
    expect(isNonzeroAddress(`  ${TOKEN_A.toUpperCase().replace('0X', '0x')}  `)).toBe(true)
  })
  it('rejects the zero address, empty, and malformed input', () => {
    expect(isNonzeroAddress(ZERO)).toBe(false)
    expect(isNonzeroAddress('')).toBe(false)
    expect(isNonzeroAddress('0x123')).toBe(false)
    expect(isNonzeroAddress('not-an-address')).toBe(false)
  })
})

describe('titleValid', () => {
  it('accepts a non-empty title', () => {
    expect(titleValid('CULT')).toBe(true)
    expect(titleValid('  spaced  ')).toBe(true)
  })
  it('rejects blank/whitespace-only titles', () => {
    expect(titleValid('')).toBe(false)
    expect(titleValid('   ')).toBe(false)
  })
  it('rejects titles over 256 bytes (contract InvalidTitle bound)', () => {
    expect(titleValid('a'.repeat(256))).toBe(true)
    expect(titleValid('a'.repeat(257))).toBe(false)
    // multibyte: 128 × 2-byte chars = 256 bytes ok, 129 = 258 bytes rejected
    expect(titleValid('é'.repeat(128))).toBe(true)
    expect(titleValid('é'.repeat(129))).toBe(false)
  })
})

describe('assetTokenValid', () => {
  it('is valid iff the asset token is a nonzero address', () => {
    expect(assetTokenValid(asset())).toBe(true)
    expect(assetTokenValid(asset({ token: ZERO }))).toBe(false)
    expect(assetTokenValid(asset({ token: '' }))).toBe(false)
  })
})

describe('validateRequestForm', () => {
  const base = {
    token: TOKEN_A,
    title: 'CULT',
    assets: [asset()],
    requestDeposit: 50_000_000_000_000_000n,
  }
  it('passes a well-formed request', () => {
    expect(validateRequestForm(base)).toEqual({
      tokenOk: true,
      titleOk: true,
      assetsOk: true,
      depositReady: true,
      canSubmit: true,
    })
  })
  it('fails on a zero/blank token', () => {
    expect(validateRequestForm({ ...base, token: ZERO }).canSubmit).toBe(false)
    expect(validateRequestForm({ ...base, token: '' }).tokenOk).toBe(false)
  })
  it('fails on an empty title', () => {
    const v = validateRequestForm({ ...base, title: '  ' })
    expect(v.titleOk).toBe(false)
    expect(v.canSubmit).toBe(false)
  })
  it('requires at least one asset (contract reverts NoAssets on empty)', () => {
    const v = validateRequestForm({ ...base, assets: [] })
    expect(v.assetsOk).toBe(false)
    expect(v.canSubmit).toBe(false)
  })
  it('fails when any asset has a zero token', () => {
    const v = validateRequestForm({ ...base, assets: [asset(), asset({ token: ZERO })] })
    expect(v.assetsOk).toBe(false)
  })
  it('is not submittable until the deposit read resolves', () => {
    const v = validateRequestForm({ ...base, requestDeposit: undefined })
    expect(v.depositReady).toBe(false)
    expect(v.canSubmit).toBe(false)
  })
})

describe('toContractAssets', () => {
  it('trims strings and casts the token', () => {
    expect(
      toContractAssets([
        { token: `  ${TOKEN_A}  `, symbol: ' AAA ', info: ' hi ', metadataURI: ' ipfs://x ' },
      ]),
    ).toEqual([{ token: TOKEN_A, symbol: 'AAA', info: 'hi', metadataURI: 'ipfs://x' }])
  })
})

describe('pickMyRequestIds', () => {
  const entries = [
    { id: 1n, requester: TOKEN_A },
    { id: 2n, requester: TOKEN_B },
    { id: 3n, requester: TOKEN_A.toUpperCase().replace('0X', '0x') },
    { id: 3n, requester: TOKEN_A }, // duplicate id (e.g. re-scanned log)
  ]
  it('returns only my ids, deduped and newest-first, case-insensitively', () => {
    expect(pickMyRequestIds(entries, TOKEN_A)).toEqual([3n, 1n])
  })
  it('returns [] when disconnected', () => {
    expect(pickMyRequestIds(entries, undefined)).toEqual([])
  })
  it('returns [] when no entries match', () => {
    expect(pickMyRequestIds(entries, '0x9999999999999999999999999999999999999999')).toEqual([])
  })
})
