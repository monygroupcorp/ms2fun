import { describe, expect, it } from 'vitest'
import type { ProjectCard } from '../discovery'
import type { CurationItem } from '../metadata'
import { cardsByInstance, collectionHref, curationItemHref, pieceHref } from './itemRoute'

const A = '0x111111111111111111111111111111111111aAaA' as const
const B = '0x222222222222222222222222222222222222BbBb' as const

function card(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    instance: A,
    name: 'Specimen',
    metadataURI: '',
    creator: A,
    registeredAt: 0n,
    factory: A,
    contractType: 'ERC404',
    factoryTitle: '',
    vault: A,
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: false,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
    ...overrides,
  }
}

const item = (o: Partial<CurationItem>): CurationItem => ({
  instance: A.toLowerCase() as `0x${string}`,
  tokenId: '',
  note: '',
  ...o,
})

describe('cardsByInstance', () => {
  it('keys on the lowercased address, so a checksummed card matches a lowercased pick', () => {
    const map = cardsByInstance([card({ instance: A })])
    expect(map.get(A.toLowerCase())?.name).toBe('Specimen')
  })

  it('is empty for an absent card list', () => {
    expect(cardsByInstance(undefined).size).toBe(0)
  })
})

describe('collectionHref', () => {
  it('is the chain-scoped slug route, slug being the lowercased name', () => {
    expect(collectionHref(1337, card({ name: 'BlueChips' }))).toBe('/1337/bluechips')
  })
})

describe('pieceHref', () => {
  it('routes ERC-1155 picks to the edition page', () => {
    expect(pieceHref(1337, card({ name: 'Zine', contractType: 'ERC1155' }), '4')).toBe(
      '/1337/zine/edition/4',
    )
  })

  it.each(['ERC721', 'ERC404'])('routes %s picks to the token page', (contractType) => {
    expect(pieceHref(1337, card({ name: 'Zine', contractType }), '4')).toBe('/1337/zine/token/4')
  })
})

describe('curationItemHref', () => {
  const cards = cardsByInstance([
    card({ instance: A, name: 'Alpha', contractType: 'ERC1155' }),
    card({ instance: B, name: 'Beta', contractType: 'ERC721' }),
  ])

  it('sends a whole-collection pick to the collection page', () => {
    expect(curationItemHref(1337, item({}), cards)).toBe('/1337/alpha')
  })

  it('sends a piece pick to that piece, typed by its collection', () => {
    expect(curationItemHref(1337, item({ tokenId: '12' }), cards)).toBe('/1337/alpha/edition/12')
    expect(
      curationItemHref(
        1337,
        item({ instance: B.toLowerCase() as `0x${string}`, tokenId: '3' }),
        cards,
      ),
    ).toBe('/1337/beta/token/3')
  })

  /** A pick the registry cannot answer for links nowhere rather than to a 404. */
  it('returns null for an address no known collection answers to', () => {
    const unknown = item({ instance: '0x3333333333333333333333333333333333333333' })
    expect(curationItemHref(1337, unknown, cards)).toBeNull()
  })
})
