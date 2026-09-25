import { describe, expect, it } from 'vitest'
import { VAULT_SUMMARY_CALLS, vaultSummaryAbi } from './useVaultsSummary'

/**
 * The vault summary is one `useReadContracts` batch: a flat array of
 * `addresses.length * VAULT_SUMMARY_CALLS.length` results, where nothing in a result says which
 * vault or which function produced it. Position is the only link, so a request that disagrees with
 * how the results are walked does not throw — it reads the NEXT vault's fields and renders
 * confident, wrong numbers.
 *
 * That is not hypothetical. The stride was a hand-written 7 while the request built 5 calls, so
 * every vault after the first read a neighbour's results: target ids came back as nonsense and
 * those vaults rendered as "Unattributed", which reads like a protocol state rather than the
 * display failure it was. Endowment vaults after the first were also misread as LP vaults, so the
 * endowment TVL on the page was short.
 *
 * Both ends now derive from `VAULT_SUMMARY_CALLS`, and TypeScript makes an unknown field name
 * unwritable. What remains able to drift is this list against the ABI it is called with, since a
 * name absent from the ABI fails only at runtime, on a chain, in a number nobody double-checks.
 */
describe('vault summary batch', () => {
  const abiFunctions = vaultSummaryAbi
    .filter((entry) => entry.type === 'function')
    .map((entry) => entry.name)

  it('calls only functions the ABI declares', () => {
    for (const name of VAULT_SUMMARY_CALLS) {
      expect(abiFunctions).toContain(name)
    }
  })

  it('calls every function the ABI declares, so a read is never silently dropped', () => {
    for (const name of abiFunctions) {
      expect(VAULT_SUMMARY_CALLS).toContain(name)
    }
  })

  it('names each function exactly once, so the stride matches the calls sent', () => {
    expect(new Set(VAULT_SUMMARY_CALLS).size).toBe(VAULT_SUMMARY_CALLS.length)
  })

  it('carries both families of target getter, since neither vault family has both', () => {
    // An endowment vault answers `targetId`; an LP vault answers `alignmentTargetId`. Dropping
    // either one sends every vault of that family to the unattributed bucket.
    expect(VAULT_SUMMARY_CALLS).toContain('targetId')
    expect(VAULT_SUMMARY_CALLS).toContain('alignmentTargetId')
  })
})
