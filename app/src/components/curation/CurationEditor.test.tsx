/**
 * CurationEditor — assembling a set. The chain is not in scope here: what is under test is that a
 * visitor can name a set, put collections and pieces in it in the order they choose, and hand the
 * result to one save. The registry write is the page's job, not the form's.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectCard } from '../../lib/discovery'
import type { CurationMetadata } from '../../lib/metadata'
import { CurationEditor } from './CurationEditor'

const ALPHA = '0x1111111111111111111111111111111111111111' as const
const BETA = '0x2222222222222222222222222222222222222222' as const

function card(instance: `0x${string}`, name: string): ProjectCard {
  return {
    instance,
    name,
    metadataURI: '',
    creator: instance,
    registeredAt: 0n,
    factory: instance,
    contractType: 'ERC1155',
    factoryTitle: '',
    vault: instance,
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: false,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
  }
}

vi.mock('../../lib/discovery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAllCollections: () => ({
    data: [card(ALPHA, 'Alpha'), card(BETA, 'Beta')],
    isPending: false,
    isError: false,
    total: 2,
  }),
}))

afterEach(cleanup)

function mount(initial?: CurationMetadata) {
  const onSave = vi.fn()
  render(<CurationEditor {...(initial ? { initial } : {})} onSave={onSave} />)
  return { onSave }
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

const pickField = () => screen.getByLabelText('Collection name or address')
const pieceField = () => screen.getByLabelText('Piece number (optional)')
const addButton = () => screen.getByRole('button', { name: 'Add' })
const picks = () => screen.getByRole('list')

describe('CurationEditor', () => {
  it('publishes a named set with a collection picked by name', () => {
    const { onSave } = mount()

    type(screen.getByLabelText('Title'), 'Blues')
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())
    click('Publish curation')

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0]?.[0] as CurationMetadata
    expect(saved.name).toBe('Blues')
    expect(saved.items).toEqual([{ instance: ALPHA, tokenId: '', note: '' }])
  })

  it('accepts a pasted address for a collection the scan has not reached', () => {
    const unknown = '0x3333333333333333333333333333333333333333'
    const { onSave } = mount()

    type(screen.getByLabelText('Title'), 'Elsewhere')
    type(pickField(), unknown)
    fireEvent.click(addButton())
    click('Publish curation')

    const saved = onSave.mock.calls[0]?.[0] as CurationMetadata
    expect(saved.items).toEqual([{ instance: unknown, tokenId: '', note: '' }])
  })

  it('picks one piece when a number is given', () => {
    const { onSave } = mount()

    type(screen.getByLabelText('Title'), 'One thing')
    type(pickField(), 'Alpha')
    type(pieceField(), '12')
    fireEvent.click(addButton())
    click('Publish curation')

    const saved = onSave.mock.calls[0]?.[0] as CurationMetadata
    expect(saved.items).toEqual([{ instance: ALPHA, tokenId: '12', note: '' }])
  })

  it('refuses a name no collection answers to, and says which name', () => {
    mount()
    type(pickField(), 'Gamma')
    fireEvent.click(addButton())

    expect(screen.getByRole('alert')).toHaveTextContent('no collection called “Gamma”')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('refuses a piece number that is not a number', () => {
    mount()
    type(pickField(), 'Alpha')
    type(pieceField(), 'first')
    fireEvent.click(addButton())

    expect(screen.getByRole('alert')).toHaveTextContent('a piece is numbered')
  })

  it('refuses the same pick twice', () => {
    mount()
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())

    expect(screen.getByRole('alert')).toHaveTextContent('already in this curation')
    expect(within(picks()).getAllByRole('listitem')).toHaveLength(1)
  })

  /** The same collection at two different pieces is two picks, not a duplicate. */
  it('allows two pieces from one collection', () => {
    mount()
    type(pickField(), 'Alpha')
    type(pieceField(), '1')
    fireEvent.click(addButton())
    type(pickField(), 'Alpha')
    type(pieceField(), '2')
    fireEvent.click(addButton())

    expect(within(picks()).getAllByRole('listitem')).toHaveLength(2)
  })

  it('keeps the curator’s order, and lets them change it', () => {
    const { onSave } = mount()

    type(screen.getByLabelText('Title'), 'Ordered')
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())
    type(pickField(), 'Beta')
    fireEvent.click(addButton())
    click('Move Beta up')
    click('Publish curation')

    const saved = onSave.mock.calls[0]?.[0] as CurationMetadata
    expect(saved.items.map((i) => i.instance)).toEqual([BETA, ALPHA])
  })

  it('removes a pick', () => {
    mount()
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())
    click('Remove Alpha')

    expect(screen.queryByRole('list')).toBeNull()
  })

  it('carries a note per pick', () => {
    const { onSave } = mount()

    type(screen.getByLabelText('Title'), 'Noted')
    type(pickField(), 'Alpha')
    fireEvent.click(addButton())
    type(screen.getByLabelText('Note on Alpha'), '  the reason  ')
    click('Publish curation')

    const saved = onSave.mock.calls[0]?.[0] as CurationMetadata
    expect(saved.items[0]?.note).toBe('the reason')
  })

  /** Naming a set before filling it is a real state; the contract and the JSON both allow it. */
  it('publishes an empty set', () => {
    const { onSave } = mount()
    type(screen.getByLabelText('Title'), 'Soon')
    click('Publish curation')

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ name: 'Soon', items: [] })
  })

  it('will not publish an unnamed set', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Publish curation' })).toBeDisabled()
  })

  it('opens on an existing curation without losing its picks', () => {
    const { onSave } = mount({
      schemaVersion: 1,
      name: 'Existing',
      description: 'why',
      image: 'ipfs://cover',
      items: [{ instance: BETA, tokenId: '9', note: 'kept' }],
    })

    expect(screen.getByLabelText('Title')).toHaveValue('Existing')
    click('Publish curation')
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      items: [{ instance: BETA, tokenId: '9', note: 'kept' }],
    })
  })
})
