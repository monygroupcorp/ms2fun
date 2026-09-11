/**
 * The two things the commission unlock has to get right off chain.
 *
 * `unlock` takes the hash of the art the buyer is paying for, so the buyer signs for the art and not
 * only for the price. If the app hashes it differently from the contract, nothing degrades — every
 * unlock reverts `CommissionUriChanged` and the feature is simply gone. The vectors below are the
 * contract's own `keccak256(bytes(uri))`, taken from `cast keccak`, including one URI with multi-byte
 * characters: that is where a `toHex`-shaped mistake would show and a plain-ASCII pin would not.
 */
import { describe, it, expect } from 'vitest'
import { commissionUriHash, unlockErrorText } from './MetadataHolderPanel'

describe('commissionUriHash', () => {
  it('matches the contract keccak256(bytes(uri)) on an ordinary URI', () => {
    expect(commissionUriHash('ipfs://GOOD')).toBe(
      '0xd46b8918b2974d399d2dd78ff573b3bb657dc4f9dae854628b53ba7d90ba47c9',
    )
  })

  it('matches it on a URI carrying multi-byte characters', () => {
    expect(commissionUriHash('ipfs://bafy-ünïcode/42')).toBe(
      '0x1a2e244aa54ef32afb8836b86cd1b4d1d5083bfc6d12cd872dbc66db76fdaccf',
    )
  })

  it('separates two URIs that differ by one character', () => {
    expect(commissionUriHash('ipfs://GOOD')).not.toBe(commissionUriHash('ipfs://GOOE'))
  })
})

describe('unlockErrorText', () => {
  it('names the cause when the artist swapped the art', () => {
    // What `txErrorReason` hands back for a decoded custom error.
    const text = unlockErrorText('Execution reverted. (CommissionUriChanged())')
    expect(text).toContain('the artist changed')
    expect(text).toContain('reload')
  })

  it('passes any other revert through, because a decoded reason beats a generic retry', () => {
    expect(unlockErrorText('Execution reverted. (WrongPayment())')).toBe(
      'Execution reverted. (WrongPayment())',
    )
  })

  it('falls back to the generic line when there is no reason at all', () => {
    expect(unlockErrorText(undefined)).toBe('unlock failed — try again')
  })
})
