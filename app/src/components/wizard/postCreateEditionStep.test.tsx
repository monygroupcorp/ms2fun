/**
 * The wizard's post-create Editions step (noesis/open-edition-cannot-close clause 4).
 *
 * `ProjectTypeSchema.postCreate` has declared this step — its title and all nine of its fields,
 * `closeTime` and `maxPerWallet` among them — since it was written, and until now nothing rendered
 * it: `WizardPage` read `coreFields` at nine call sites and `postCreate` at none, so a creator's
 * only way to schedule a drop was to deploy, leave, find the collection page and come back to it.
 *
 * What these cases hold to:
 *   - the step is generated from the SCHEMA, so a field added there reaches the creator without a
 *     second edit here — which is the only reason rendering the declaration beats hand-writing a
 *     second form,
 *   - skipping is a real answer and lands the creator on the collection page,
 *   - the transaction it sends is `addEdition` with the schedule the creator typed, built by the
 *     same `editionDraft.ts` the collection page's `AddEditionForm` builds its call with.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PostCreateEditionStep } from './PostCreateEditionStep'
import { getProjectType } from '../../lib/wizard/projectTypes'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const

const writeContract = vi.fn()

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
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

afterEach(() => {
  cleanup()
  writeContract.mockReset()
})

/** The step as the wizard mounts it: the erc1155 project type's own declaration, nothing local. */
function renderStep(onDone = vi.fn()) {
  const postCreate = getProjectType('erc1155')?.postCreate
  if (!postCreate) throw new Error('erc1155 declares no postCreate step')
  render(
    <PostCreateEditionStep
      instance={INSTANCE}
      chainId={1337}
      title={postCreate.title}
      fields={postCreate.fields}
      onDone={onDone}
    />,
  )
  return { onDone, postCreate }
}

test('the step is the declared one: its title and every visible field come from the schema', () => {
  const { postCreate } = renderStep()

  expect(screen.getByText(postCreate.title)).toBeTruthy()
  // `supply` and `priceIncreaseRate` are `visibleWhen`-gated on the pricing model and start hidden,
  // so the assertion is over the fields the schema shows at the default, not over all nine.
  const alwaysVisible = postCreate.fields.filter((f) => !f.visibleWhen)
  for (const field of alwaysVisible) {
    expect(screen.getByLabelText(new RegExp(field.label, 'i'))).toBeTruthy()
  }
})

test('the schedule is collected here — close time and per-wallet limit are both on the step', () => {
  renderStep()
  expect(screen.getByLabelText(/close time/i)).toBeTruthy()
  expect(screen.getByLabelText(/per-wallet limit/i)).toBeTruthy()
})

test('skipping is an answer: the creator leaves for the collection page, and nothing is sent', () => {
  const { onDone } = renderStep()

  fireEvent.click(screen.getByTestId('postcreate-skip'))

  expect(onDone).toHaveBeenCalledTimes(1)
  expect(writeContract).not.toHaveBeenCalled()
})

test('a filled step sends addEdition carrying the close time and the per-wallet cap', () => {
  renderStep()

  const closeAt = Math.floor(Date.now() / 1000) + 86_400
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Genesis' } })
  fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '0.05' } })
  fireEvent.change(screen.getByLabelText(/edition metadata uri/i), {
    target: { value: 'ipfs://cid' },
  })
  fireEvent.change(screen.getByLabelText(/close time/i), { target: { value: String(closeAt) } })
  fireEvent.change(screen.getByLabelText(/per-wallet limit/i), { target: { value: '3' } })

  fireEvent.submit(screen.getByRole('button', { name: /add edition/i }))

  expect(writeContract).toHaveBeenCalledTimes(1)
  const call = writeContract.mock.calls[0]?.[0]
  if (!call) throw new Error('writeContract was called with nothing')
  expect(call.address).toBe(INSTANCE)
  expect(call.functionName).toBe('addEdition')
  // `addEdition(pieceTitle, basePrice, supply, metadataURI, pricingModel, rate, openTime,
  //  freeMintAllocation, closeTime, maxPerWallet)` — the last two are what this goal is about.
  expect(call.args[0]).toBe('Genesis')
  expect(call.args[8]).toBe(BigInt(closeAt))
  expect(call.args[9]).toBe(3n)
})

test('a close time before the open is refused here, exactly as the collection page refuses it', () => {
  renderStep()

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Genesis' } })
  fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '0.05' } })
  fireEvent.change(screen.getByLabelText(/edition metadata uri/i), {
    target: { value: 'ipfs://cid' },
  })
  fireEvent.change(screen.getByLabelText(/^open time/i), { target: { value: '2000' } })
  fireEvent.change(screen.getByLabelText(/close time/i), { target: { value: '1000' } })

  fireEvent.submit(screen.getByRole('button', { name: /add edition/i }))

  expect(screen.getByRole('alert').textContent).toMatch(/close time must be after the open time/i)
  expect(writeContract).not.toHaveBeenCalled()
})
