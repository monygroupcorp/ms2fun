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
