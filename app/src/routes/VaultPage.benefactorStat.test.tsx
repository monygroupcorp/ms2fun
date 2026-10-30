/**
 * The vault page's benefactor stat, across the four vault families.
 *
 * `totalShares()` is one selector on `IAlignmentVault`, but the number behind it is not one unit:
 * the endowment vault and the two ETH-settled LP vaults accumulate it out of wei, the Uniswap v4
 * vault accumulates raw v4 liquidity units. The stat used to print that integer bare under a single
 * "Benefactor shares" label, between two figures that were both ETH — so a vault holding 1 ETH of
 * support announced 1000000000000000000 of something. These pin the unit and the label to the
 * family, including the case where the family is not one we know.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultOverview } from '../components/vault/useVaultOverview'

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const ONE_ETH = 10n ** 18n

const mockUseVaultOverview = vi.hoisted(() => vi.fn<() => VaultOverview>())
vi.mock('../components/vault/useVaultOverview', () => ({
  useVaultOverview: mockUseVaultOverview,
  vaultFamilyLabel: (t: string | undefined) => t ?? 'Vault',
}))

vi.mock('wouter', () => ({
  useParams: () => ({ address: VAULT }),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('../lib/discovery', () => ({ useAllCollections: () => ({ data: [] }) }))
vi.mock('../components/useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))
vi.mock('../components/vault/CommunityPayoutPanel', () => ({ CommunityPayoutPanel: () => null }))
vi.mock('../components/vault/VaultDeliveries', () => ({ VaultDeliveries: () => null }))
vi.mock('../components/vault/BenefactorPosition', () => ({ BenefactorPosition: () => null }))
vi.mock('../components/MessageFeed', () => ({ MessageFeed: () => null }))
vi.mock('../components/MessageComposer', () => ({ MessageComposer: () => null }))

const { VaultPage } = await import('./VaultPage')

function overview(vaultType: string | undefined, totalShares: bigint | undefined): VaultOverview {
  return {
    vaultType,
    isEndowment: vaultType === 'AaveEndowment',
    totalPrincipal: vaultType === 'AaveEndowment' ? totalShares : undefined,
    accumulatedFees: 0n,
    totalShares,
    name: 'A vault',
    creator: VAULT,
    targetId: 1n,
    target: undefined,
    isPending: false,
  }
}

/** The stat's label and its value, in that order. */
function stat(vaultType: string | undefined, totalShares: bigint | undefined): [string, string] {
  mockUseVaultOverview.mockReturnValue(overview(vaultType, totalShares))
  render(<VaultPage />)
  const cell = screen.getByTestId('vault-benefactor-stat')
  const [label, value] = Array.from(cell.children).map((c) => c.textContent ?? '')
  return [label ?? '', value ?? '']
}

afterEach(() => {
  cleanup()
  mockUseVaultOverview.mockReset()
})

describe('the benefactor stat carries its family unit', () => {
  it.each(['AaveEndowment', 'CypherLP', 'ZAMMLP'])(
    'denominates %s in ETH, because the number is wei',
    (family) => {
      expect(stat(family, ONE_ETH)).toEqual(['Benefactor principal', '1 ETH'])
    },
  )

  it('leaves the Uniswap v4 vault in liquidity units and says so in the label', () => {
    // Not wei: formatEther here would silently divide v4 liquidity by 1e18.
    expect(stat('UniswapV4LP', 12_345n)).toEqual(['LP shares', '12345'])
  })

  it('claims no unit for a family it does not recognise', () => {
    expect(stat('SomeFutureLP', 12_345n)).toEqual(['Benefactor shares', '12345'])
  })

  it('shows an em dash rather than a bare zero before the read lands', () => {
    expect(stat('AaveEndowment', undefined)).toEqual(['Benefactor principal', '—'])
  })

  it('never prints the raw wei integer beside the ETH stats', () => {
    mockUseVaultOverview.mockReturnValue(overview('AaveEndowment', ONE_ETH))
    render(<VaultPage />)
    const stats = screen.getByTestId('vault-stats')
    expect(within(stats).queryByText(ONE_ETH.toString())).toBeNull()
  })
})
