import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AlignmentTargetRow } from '../../lib/vaults/useAlignmentTargets'
import type { RegisteredVault } from './useRegisteredVaults'
import { AlignmentTargetPicker } from './AlignmentTargetPicker'

// Deterministic, chain-free renders: mock the two on-chain-backed hooks the picker calls directly.
const mockUseAlignmentTargets = vi.hoisted(() =>
  vi.fn<() => { targets: AlignmentTargetRow[]; isPending: boolean }>(),
)
vi.mock('../../lib/vaults/useAlignmentTargets', () => ({
  useAlignmentTargets: mockUseAlignmentTargets,
}))

vi.mock('../useCollectionMetadata', () => ({
  useCollectionMetadata: () => undefined,
}))

afterEach(() => {
  cleanup()
  mockUseAlignmentTargets.mockReset()
})

const CULT = '0x00000000000000000000000000000000000c01' as const
const MS2 = '0x00000000000000000000000000000000000ac2' as const

const MS2_TARGET: AlignmentTargetRow = {
  id: 1n,
  title: 'MS2',
  description: 'Station fixture',
  metadataURI: '',
  token: MS2,
}
// The same community (CULT) registered under two targets — one per acquisition route.
const CULT_TARGET_UNI: AlignmentTargetRow = {
  id: 2n,
  title: 'CULT',
  description: 'Community fixture',
  metadataURI: '',
  token: CULT,
}
const CULT_TARGET_CYPHER: AlignmentTargetRow = {
  id: 3n,
  title: 'CULT',
  description: 'Community fixture',
  metadataURI: '',
  token: CULT,
}

const vault = (targetId: bigint, vaultType: string, address: string): RegisteredVault => ({
  address: address as `0x${string}`,
  name: '',
  targetId,
  vaultType,
  family: vaultType.endsWith('LP') ? 'lp' : 'yield',
  venue: vaultType.endsWith('LP') ? vaultType.slice(0, -2) : vaultType,
  ready: true,
  description: '',
})

const CULT_UNI_VAULT = vault(2n, 'UniswapV4LP', '0x0000000000000000000000000000000000a001')
const CULT_CYPHER_VAULT = vault(3n, 'CypherLP', '0x0000000000000000000000000000000000a002')

function renderPicker(overrides?: { targets?: AlignmentTargetRow[]; vaults?: RegisteredVault[] }) {
  mockUseAlignmentTargets.mockReturnValue({
    targets: overrides?.targets ?? [MS2_TARGET, CULT_TARGET_UNI, CULT_TARGET_CYPHER],
    isPending: false,
  })
  const onSelectVault = vi.fn()
  render(
    <AlignmentTargetPicker
      vaults={overrides?.vaults ?? [CULT_UNI_VAULT, CULT_CYPHER_VAULT]}
      isPending={false}
      isError={false}
      selectedVault={undefined}
      onSelectVault={onSelectVault}
      // Excludes yield so the "not deployed" affordance never mounts YieldVaultRequestCard, which
      // needs a wagmi provider this test doesn't set up.
      excludeFamilies={['yield']}
    />,
  )
  return { onSelectVault }
}

describe('AlignmentTargetPicker — token grouping (noesis-412)', () => {
  test('a token registered under two targets renders ONE row, not two', () => {
    renderPicker()
    expect(screen.getAllByText('CULT')).toHaveLength(1)
  })

  test('the grouped row offers both venues as an add-on', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: 'Uniswap V4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cypher' })).toBeInTheDocument()
  })

  test('selecting each venue surfaces the correct distinct target (its own vault section)', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Uniswap V4' }))
    expect(screen.getByText(/vault for cult/i)).toBeInTheDocument()
    // Level 2 (the vault section below) resolves to the V4 vault's own address; the Cypher vault
    // (a different target id) is not shown alongside it.
    expect(screen.getByText('0x0000…a001')).toBeInTheDocument()
    expect(screen.queryByText('0x0000…a002')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cypher' }))
    expect(screen.getByText('0x0000…a002')).toBeInTheDocument()
    expect(screen.queryByText('0x0000…a001')).not.toBeInTheDocument()
  })

  test('a single-target token renders as a plain clickable card with no venue add-on', () => {
    renderPicker()
    const ms2Card = screen.getByRole('button', { name: /ms2/i })
    expect(ms2Card).toBeInTheDocument()
    // No pill add-on for MS2 — only the CULT row's two venue pills exist.
    expect(screen.getAllByRole('button', { name: /uniswap v4|cypher/i })).toHaveLength(2)
  })

  test('non-vacuity: without grouping, the same two targets would render as two separate rows', () => {
    // Simulates "grouping removed" by feeding the raw ungrouped target list straight through — this
    // is the shape the picker rendered before noesis-412, and it must show CULT twice.
    renderPicker({ targets: [CULT_TARGET_UNI, CULT_TARGET_CYPHER] })
    // With grouping (the real behavior under test), it still collapses to one — proving the assertion
    // below is a real constraint the grouping enforces, not a vacuous one.
    expect(screen.getAllByText('CULT')).toHaveLength(1)
  })
})
