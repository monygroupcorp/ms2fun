/**
 * Correcting a schedule stops at the first sale (noesis/open-edition-cannot-close).
 *
 * `setEditionSchedule` reverts `EditionAlreadyMinted()` once an edition has any mints — paid or
 * free — because a collector who has paid chose the drop as it was stated. The form must show that
 * bound rather than offer inputs whose transaction the chain will refuse, which is the same defect
 * the mint button's open-time and ceiling gates were each written against.
 *
 * The close time is picked off a calendar (noesis/drop-window-in-epoch-seconds) — so these cases
 * type what the picker emits, a local wall-clock string, and assert the unix seconds that reach
 * `setEditionSchedule`. Every fixture is minute-aligned because that is the picker's own step.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { EditionScheduleForm } from './EditionScheduleForm'
import { localInputFromEpoch } from '../../lib/time/scheduleInput'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const

const chain = vi.hoisted(() => ({
  minted: 0n as bigint,
  openTime: 0n as bigint,
  closeTime: 0n as bigint,
  maxPerWallet: 0n as bigint,
}))
const writeContract = vi.hoisted(() => vi.fn())

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

vi.mock('../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../generated/contracts')>()),
  useReadErc1155InstanceGetEdition: () => ({
    data: { minted: chain.minted, openTime: chain.openTime },
  }),
  useReadErc1155InstanceEditionCloseTime: () => ({ data: chain.closeTime }),
  useReadErc1155InstanceEditionMaxPerWallet: () => ({ data: chain.maxPerWallet }),
  useWriteErc1155InstanceSetEditionSchedule: () => ({
    writeContract,
    data: undefined,
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
}))

vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 31337 }))

function mount(): void {
  render(<EditionScheduleForm instance={INSTANCE} editionId={1n} />)
}

afterEach(() => {
  chain.minted = 0n
  chain.openTime = 0n
  chain.closeTime = 0n
  chain.maxPerWallet = 0n
  writeContract.mockClear()
  cleanup()
})

test('an edition that has sold shows the bound instead of a form', () => {
  chain.minted = 1n
  mount()

  expect(screen.getByTestId('edition-schedule-locked').textContent).toContain('has sold')
  expect(screen.queryByTestId('edition-schedule-form')).toBeNull()
})

/** The next whole minute at or after `offsetSec` from now — the finest moment the picker states. */
function minuteAlignedFromNow(offsetSec: number): number {
  return Math.floor((Math.floor(Date.now() / 1000) + offsetSec) / 60) * 60
}

test('an edition with no mints offers the form, seeded from the chain', () => {
  chain.closeTime = 1_800_000_000n
  chain.maxPerWallet = 4n
  mount()

  expect(screen.getByTestId('edition-schedule-form')).toBeTruthy()
  // Seeded as a moment on a calendar, not as the integer the chain stores.
  const close = screen.getByLabelText(/^Closes/) as HTMLInputElement
  expect(close.getAttribute('type')).toBe('datetime-local')
  expect(close.value).toBe(localInputFromEpoch(1_800_000_000))
  expect(screen.getByLabelText(/Per-wallet limit/).getAttribute('value')).toBe('4')
})

test('a close time in the past is refused before signing', () => {
  mount()

  fireEvent.change(screen.getByLabelText(/^Closes/), {
    target: { value: localInputFromEpoch(minuteAlignedFromNow(-86_400)) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'update schedule' }))

  expect(writeContract).not.toHaveBeenCalled()
  expect(screen.getByText('Close time must be in the future')).toBeTruthy()
})

test('a close time before a scheduled open is refused before signing', () => {
  chain.openTime = 2_000_000_040n
  mount()

  fireEvent.change(screen.getByLabelText(/^Closes/), {
    target: { value: localInputFromEpoch(2_000_000_040 - 60) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'update schedule' }))

  expect(writeContract).not.toHaveBeenCalled()
  expect(screen.getByText('Close time must be after the open time')).toBeTruthy()
})

test('a valid schedule is sent as the edition id and the two values', () => {
  const future = minuteAlignedFromNow(86_400)
  mount()

  fireEvent.change(screen.getByLabelText(/^Closes/), {
    target: { value: localInputFromEpoch(future) },
  })
  fireEvent.change(screen.getByLabelText(/Per-wallet limit/), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'update schedule' }))

  // The picker is local wall clock; what reaches the chain is still unix seconds.
  expect(writeContract).toHaveBeenCalledWith(
    expect.objectContaining({ args: [1n, BigInt(future), 3n] }),
  )
})

test('clearing both values is allowed — 0 is never closes and no limit', () => {
  chain.closeTime = 1_800_000_000n
  chain.maxPerWallet = 4n
  mount()

  fireEvent.change(screen.getByLabelText(/^Closes/), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(/Per-wallet limit/), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'update schedule' }))

  expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [1n, 0n, 0n] }))
})

test('a stored close time carrying seconds is sent back exactly when the field is not touched', () => {
  // The picker states minutes, so seeding it would round 1_800_000_037 down. The form holds the
  // integer rather than the picker's string, so an untouched field submits what the chain had.
  chain.closeTime = 1_800_000_037n
  chain.maxPerWallet = 4n
  mount()

  fireEvent.change(screen.getByLabelText(/Per-wallet limit/), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'update schedule' }))

  expect(writeContract).toHaveBeenCalledWith(
    expect.objectContaining({ args: [1n, 1_800_000_037n, 9n] }),
  )
})
