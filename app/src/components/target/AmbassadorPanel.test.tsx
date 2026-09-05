/**
 * AmbassadorPanel — the appointed ambassador's surface for `updateAlignmentTarget`.
 *
 * The behaviours asserted here are the ones that make it a usable seat rather than a second copy of
 * the admin console's row: it appears for the ambassador (who is not the registry owner) and only
 * for the targets they actually hold, it seeds the fields from the chain so a description edit does
 * not silently erase the logo pointer, and it refuses a pointer the registry would refuse rather
 * than spending a transaction to find out.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AmbassadorPanel } from './AmbassadorPanel'
import type { AlignmentTargetRow } from '../../lib/vaults/useAlignmentTargets'

const REGISTRY = vi.hoisted(() => '0x0000000000000000000000000000000000000aa1' as const)

const send = vi.hoisted(() => vi.fn())
const seats = vi.hoisted(() => ({ targetIds: [] as bigint[] }))

vi.mock('../../lib/vaults/useAmbassadorTargets', () => ({
  useAmbassadorTargets: () => ({ targetIds: seats.targetIds, isPending: false }),
}))

vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send,
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
  txErrorReason: () => undefined,
}))

vi.mock('../../lib/addresses', () => ({
  forkAddresses: { AlignmentRegistryV1: REGISTRY },
  forkChainId: 1337,
}))

vi.mock('../../generated/contracts', () => ({ alignmentRegistryV1Abi: [] }))

const UNI: AlignmentTargetRow = {
  id: 7n,
  title: 'CULT',
  description: 'the community, as it stands',
  metadataURI: 'ipfs://bafyoriginal',
  token: '0x00000000000000000000000000000000000c01',
}
// Same community, second venue — a separate registry target, and a separate appointment.
const ZAMM: AlignmentTargetRow = { ...UNI, id: 8n }

const VENUES = new Map<string, number>([
  ['7', 1],
  ['8', 2],
])

afterEach(() => {
  cleanup()
  send.mockReset()
  seats.targetIds = []
})

describe('AmbassadorPanel', () => {
  test('renders nothing when the connected wallet holds no seat on this community', () => {
    const { container } = render(<AmbassadorPanel targets={[UNI, ZAMM]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows only the targets the wallet is an ambassador of, named by venue', () => {
    seats.targetIds = [8n]
    render(<AmbassadorPanel targets={[UNI, ZAMM]} venueByTargetId={VENUES} />)

    expect(screen.getByTestId('target-ambassador')).toBeTruthy()
    expect(screen.getByTestId('ambassador-update-8')).toBeTruthy()
    expect(screen.queryByTestId('ambassador-update-7')).toBeNull()
    expect(screen.getByTestId('ambassador-update-8').textContent).toMatch(/update ZAMM/i)
  })

  test('says when the seat held is not the target the community page renders', () => {
    seats.targetIds = [8n]
    render(<AmbassadorPanel targets={[UNI, ZAMM]} venueByTargetId={VENUES} />)
    expect(screen.getByText(/lowest-numbered target/i)).toBeTruthy()
  })

  test('a single-target community needs no such caveat', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)
    expect(screen.queryByText(/lowest-numbered target/i)).toBeNull()
    expect(screen.getByTestId('ambassador-update-7').textContent).toMatch(/update this community/i)
  })

  test('seeds both fields from the chain, so an edit cannot silently erase the other', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)

    const uri = screen.getByLabelText('metadata pointer for target 7') as HTMLInputElement
    expect((screen.getByLabelText('description for target 7') as HTMLInputElement).value).toBe(
      'the community, as it stands',
    )
    expect(uri.value).toBe('ipfs://bafyoriginal')

    fireEvent.change(screen.getByLabelText('description for target 7'), {
      target: { value: 'a fresh description' },
    })
    fireEvent.click(screen.getByTestId('ambassador-update-7'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      address: REGISTRY,
      functionName: 'updateAlignmentTarget',
      args: [7n, 'a fresh description', 'ipfs://bafyoriginal'],
    })
  })

  test('the submit is inert until something actually changes', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)

    const button = screen.getByTestId('ambassador-update-7') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(send).not.toHaveBeenCalled()
  })

  test('refuses a pointer the registry would refuse, without sending a transaction', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)

    fireEvent.change(screen.getByLabelText('metadata pointer for target 7'), {
      target: { value: 'http://example.org/target.json' },
    })

    const button = screen.getByTestId('ambassador-update-7') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toMatch(/refused on-chain/i)
    fireEvent.click(button)
    expect(send).not.toHaveBeenCalled()

    // The same field, corrected, is accepted — so the guard is the scheme and not the edit.
    fireEvent.change(screen.getByLabelText('metadata pointer for target 7'), {
      target: { value: 'ar://replacement' },
    })
    expect((screen.getByTestId('ambassador-update-7') as HTMLButtonElement).disabled).toBe(false)
  })

  test('emptying a stored pointer is allowed, and says what it costs', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)

    fireEvent.change(screen.getByLabelText('metadata pointer for target 7'), {
      target: { value: '' },
    })

    expect(screen.getByText(/loses its logo/i)).toBeTruthy()
    const button = screen.getByTestId('ambassador-update-7') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      args: [7n, 'the community, as it stands', ''],
    })
  })

  test('states the authority the seat carries that this surface does not offer', () => {
    seats.targetIds = [7n]
    render(<AmbassadorPanel targets={[UNI]} />)
    const panel = screen.getByTestId('ambassador-seat').textContent ?? ''
    expect(panel).toMatch(/vested/i)
    expect(panel).toMatch(/not offered here/i)
    expect(panel).toMatch(/title is sealed at registration/i)
  })
})
