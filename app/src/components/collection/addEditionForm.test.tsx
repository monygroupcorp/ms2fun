/**
 * `AddEditionForm`'s one-shot on a confirmed receipt.
 *
 * The form clears itself and tells the collection page an edition has landed. The caller it tells
 * is `queryClient.invalidateQueries()` (`types/Erc1155Collection.tsx`), so running it from the
 * render body started refetches and updated other components mid-render — the case React answers
 * with "Cannot update a component while rendering a different component". It is an effect now, and
 * this holds it there.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { AddEditionForm } from './AddEditionForm'
import { localInputFromEpoch } from '../../lib/time/scheduleInput'

const INSTANCE = '0x2222222222222222222222222222222222222222' as const

const { writeContract, receipt } = vi.hoisted(() => ({
  writeContract: vi.fn(),
  receipt: { isLoading: false, isSuccess: false, isError: false, error: null as Error | null },
}))

const IDLE_RECEIPT = { isLoading: false, isSuccess: false, isError: false, error: null }

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useWriteContract: () => ({
    writeContract,
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: () => {},
  }),
  useWaitForTransactionReceipt: () => ({ ...receipt }),
}))

vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 1337 }))

afterEach(() => {
  cleanup()
  writeContract.mockReset()
  Object.assign(receipt, IDLE_RECEIPT)
})

test('a confirmed receipt clears the form and notifies the page once, outside of render', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const onAdded = vi.fn()

  // The form is mounted under a component that answers `onAdded` with its own `setState`. That
  // stands in for the real caller, `queryClient.invalidateQueries()`, which updates every component
  // subscribed to the collection's queries — and it is the only way the fault shows: a bare
  // `vi.fn()` callback touches no other component, so React has nothing to complain about.
  function Page() {
    const [added, setAdded] = useState(0)
    return (
      <>
        <span data-testid="added">{added}</span>
        <AddEditionForm
          instance={INSTANCE}
          onAdded={() => {
            onAdded()
            setAdded((n) => n + 1)
          }}
        />
      </>
    )
  }

  const { rerender } = render(<Page />)

  const title = screen.getByLabelText(/piece title/i) as HTMLInputElement
  fireEvent.change(title, { target: { value: 'Genesis' } })
  expect(title.value).toBe('Genesis')

  Object.assign(receipt, IDLE_RECEIPT, { isSuccess: true })
  rerender(<Page />)
  // A third render proves the one-shot holds: `onAdded` is a new function on every render, so the
  // effect re-runs each time and must not notify twice.
  rerender(<Page />)

  expect(onAdded).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('added').textContent).toBe('1')
  expect((screen.getByLabelText(/piece title/i) as HTMLInputElement).value).toBe('')
  const renderPhaseUpdates = consoleError.mock.calls.filter((call) =>
    String(call[0]).includes('while rendering a different component'),
  )
  expect(renderPhaseUpdates).toEqual([])
  consoleError.mockRestore()
})

// ── The schedule is stated, not computed (noesis/drop-window-in-epoch-seconds) ──

test('the schedule fields are calendars, and what they send is unix seconds', () => {
  // Minute-aligned: a `datetime-local` picker steps by the minute, so this is the finest moment a
  // creator can state on either surface.
  const opensAt = Math.floor((Math.floor(Date.now() / 1000) + 3_600) / 60) * 60
  const closesAt = opensAt + 86_400

  render(<AddEditionForm instance={INSTANCE} />)

  const opens = screen.getByLabelText(/^opens/i) as HTMLInputElement
  const closes = screen.getByLabelText(/^closes/i) as HTMLInputElement
  expect(opens.getAttribute('type')).toBe('datetime-local')
  expect(closes.getAttribute('type')).toBe('datetime-local')
  // Nothing typed yet is an empty picker, and an empty picker is the open-ended edition.
  expect(opens.value).toBe('')
  expect(closes.value).toBe('')

  fireEvent.change(screen.getByLabelText(/piece title/i), { target: { value: 'Genesis' } })
  fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '0.05' } })
  fireEvent.change(screen.getByLabelText(/metadata uri/i), { target: { value: 'ipfs://cid' } })
  fireEvent.change(opens, { target: { value: localInputFromEpoch(opensAt) } })
  fireEvent.change(closes, { target: { value: localInputFromEpoch(closesAt) } })
  fireEvent.submit(screen.getByRole('button', { name: /add edition/i }))

  const call = writeContract.mock.calls[0]?.[0]
  if (!call) throw new Error('writeContract was called with nothing')
  // `addEdition(pieceTitle, basePrice, supply, metadataURI, pricingModel, rate, openTime,
  //  freeMintAllocation, closeTime, maxPerWallet)`.
  expect(call.args[6]).toBe(BigInt(opensAt))
  expect(call.args[8]).toBe(BigInt(closesAt))
})

test('a creator who fills in no schedule still gets an open-ended edition', () => {
  render(<AddEditionForm instance={INSTANCE} />)

  fireEvent.change(screen.getByLabelText(/piece title/i), { target: { value: 'Genesis' } })
  fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '0.05' } })
  fireEvent.change(screen.getByLabelText(/metadata uri/i), { target: { value: 'ipfs://cid' } })
  fireEvent.submit(screen.getByRole('button', { name: /add edition/i }))

  const call = writeContract.mock.calls[0]?.[0]
  if (!call) throw new Error('writeContract was called with nothing')
  expect(call.args[6]).toBe(0n)
  expect(call.args[8]).toBe(0n)
})
