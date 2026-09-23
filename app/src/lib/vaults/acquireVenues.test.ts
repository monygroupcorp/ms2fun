/**
 * `VENUE_LABELS` is a MIRROR of `IAlignmentRegistry.Venue`, and a mirror is only as good as the
 * thing that holds it against its original. Nothing did: the array is indexed by a raw `uint8` read
 * off `getAcquireRoute`, so a member added, removed or reordered on the Solidity side silently
 * re-points every label by one — a target curated on ZAMM rendering as "Uniswap V4" is a wrong
 * answer with no error anywhere, and it renders identically to a right one.
 *
 * That is not hypothetical here: a member WAS removed from the middle of this protocol's venue set
 * when the CYPHER venue wound down. So the enum is read out of the contract source and the pairing
 * is stated once, below: changing either side alone fails, and the fix is to change both here.
 *
 * The enum is parsed rather than imported because Solidity enums do not survive into an ABI — a
 * venue is a bare `uint8` on the wire, which is exactly why the mirror exists and exactly why it
 * cannot be derived.
 */
import { describe, expect, it } from 'vitest'
import { VENUE_LABELS, venueLabel } from './acquireVenues'

const REGISTRY_INTERFACE = '../../../../contracts/src/master/interfaces/IAlignmentRegistry.sol'

const SOURCES = import.meta.glob(
  '../../../../contracts/src/master/interfaces/IAlignmentRegistry.sol',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** The enum members, in declaration order — which IS their ordinal order. */
function venueMembers(): string[] {
  const source = Object.values(SOURCES)[0]
  if (source === undefined) throw new Error(`could not read ${REGISTRY_INTERFACE}`)
  const body = source.match(/enum Venue\s*\{([^}]*)\}/)?.[1]
  if (body === undefined) throw new Error(`no \`enum Venue\` in ${REGISTRY_INTERFACE}`)
  return body
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((member) => member.trim())
    .filter(Boolean)
}

/** Ordinal → (enum member, label). Both columns are the claim; neither may move without the other. */
const PAIRING: ReadonlyArray<readonly [string, string]> = [
  ['NONE', 'not curated'],
  ['UNI_V4', 'Uniswap V4'],
  ['ZAMM', 'ZAMM'],
]

describe('VENUE_LABELS mirrors IAlignmentRegistry.Venue', () => {
  it('names every member of the enum, and no more', () => {
    expect(venueMembers()).toEqual(PAIRING.map(([member]) => member))
  })

  it('labels each ordinal with the label that member is meant to carry', () => {
    expect([...VENUE_LABELS]).toEqual(PAIRING.map(([, label]) => label))
    PAIRING.forEach(([, label], ordinal) => {
      expect(venueLabel(ordinal)).toBe(label)
    })
  })

  it('states an ordinal it does not know rather than inventing a venue for it', () => {
    // The backstop for the case this test exists to catch: a chain answering with a member this
    // build predates must read as unknown, never as the last label in the array.
    expect(venueLabel(PAIRING.length)).toBe(`venue ${PAIRING.length}`)
  })

  it('distinguishes an unread route from an uncurated one', () => {
    // `undefined` is "the read has not landed", which is not the same claim as ordinal 0.
    expect(venueLabel(undefined)).toBe('venue unread')
    expect(venueLabel(0)).toBe('not curated')
  })
})
