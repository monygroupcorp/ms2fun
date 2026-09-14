import { describe, expect, it } from 'vitest'
import { channelRef, messageVerb } from './messageMeta'

const WALLET = '0x1234567890abcdef1234567890abcdef12345678' as const
const COLLECTION = '0xaaaabbbbccccddddeeeeffff0000111122223333' as const
const VAULT = '0x9999888877776666555544443333222211110000' as const

describe('channelRef', () => {
  it('reads a post whose channel is the sender’s own address as the salon, linking to their wall', () => {
    // The general-board convention: you post to your own address. Before every surface shared this
    // rule, home linked these at /collection/<wallet> — a page that does not exist.
    const ref = channelRef({ instance: WALLET, sender: WALLET })
    expect(ref).toMatchObject({ isWall: true, isVault: false, label: 'the salon' })
    expect(ref.href).toBe(`/profile/${WALLET}`)
  })

  it('is case-insensitive about the wall — a checksummed channel still matches its sender', () => {
    const ref = channelRef({ instance: WALLET.toUpperCase() as `0x${string}`, sender: WALLET })
    expect(ref.isWall).toBe(true)
  })

  it('routes a known vault channel to the vault page and names it', () => {
    const ref = channelRef({ instance: VAULT, sender: WALLET }, new Set([VAULT.toLowerCase()]))
    expect(ref).toMatchObject({ isWall: false, isVault: true, label: 'vault 0x9999…0000' })
    expect(ref.href).toBe(`/vault/${VAULT}`)
  })

  it('falls back to a collection link when no vault set is supplied', () => {
    const ref = channelRef({ instance: VAULT, sender: WALLET })
    expect(ref.isVault).toBe(false)
    expect(ref.href).toBe(`/collection/${VAULT}`)
  })

  it('routes a collection channel to the collection page, labelled by its short address', () => {
    const ref = channelRef({ instance: COLLECTION, sender: WALLET })
    expect(ref).toMatchObject({ isWall: false, isVault: false, label: '0xaaaa…3333' })
    expect(ref.href).toBe(`/collection/${COLLECTION}`)
  })
})

describe('messageVerb', () => {
  it('states each on-chain message type plainly', () => {
    expect(messageVerb(0)).toBe('posted')
    expect(messageVerb(1)).toBe('replied')
    expect(messageVerb(2)).toBe('quoted')
    // The signature language admits one reaction, and it is an endorsement — never "REACT".
    expect(messageVerb(3)).toBe('endorsed')
  })

  it('reads an unrecognised type as a plain post', () => {
    expect(messageVerb(9)).toBe('posted')
  })
})
