/**
 * `vaultFamilyLabel` is the badge on `/vault/:address` and on every vault row of `/target/:id`, and
 * its input is a string the VAULT chooses: `vaultType()` is answered by the deployed bytecode, not
 * by anything this app controls. So a family the protocol has retired can still answer with its own
 * name, and echoing that name back would render a family that is no longer on the menu — beside a
 * split the protocol's own library now reverts on.
 *
 * Hence the rule these cases pin, which is the same one `lib/wizard/vaultFlavor.venueLabel` follows
 * for venues: a known type gets its label, an unknown type is NAMED as unknown, and `undefined` —
 * the read has not landed — stays neutral rather than accusing a vault of being unrecognisable.
 */
import { describe, expect, it } from 'vitest'
import { vaultFamilyLabel } from './useVaultOverview'

describe('vaultFamilyLabel', () => {
  it('labels each family the protocol ships', () => {
    expect(vaultFamilyLabel('AaveEndowment')).toBe('Endowment')
    expect(vaultFamilyLabel('UniswapV4LP')).toBe('Uni-V4 LP')
    expect(vaultFamilyLabel('ZAMMLP')).toBe('ZAMM LP')
  })

  it('does not echo a type it does not know', () => {
    // The retired venue is the case this rule was written for: a vault still answering `CypherLP`
    // must not put that string on a badge as though it named something a visitor can align to.
    expect(vaultFamilyLabel('CypherLP')).toBe('unknown family')
    // It is not a rule about one retired name, though — any unrecognised type reads the same way.
    expect(vaultFamilyLabel('SomeFutureLP')).toBe('unknown family')
  })

  it('stays neutral while the type is unread', () => {
    expect(vaultFamilyLabel(undefined)).toBe('Vault')
    expect(vaultFamilyLabel('')).toBe('Vault')
  })
})
