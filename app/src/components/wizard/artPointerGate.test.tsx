import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ALLOW_REMOTE_HTTP_URIS, sanitizeImageUri } from '@/lib/metadata'
import { buildDeployBlockers } from '../../routes/WizardPage'
import { ImageSourceInput } from './ImageSourceInput'

afterEach(cleanup)

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

/** A well-formed blocker input (nothing wrong) — each test perturbs only the art pointers. */
function okInput() {
  return {
    metadataName: 'My Collection',
    nameError: null,
    nameTaken: false,
    walletConnected: true,
    ownerNeedsAgent: false,
    vaultSelected: true,
    coreErrors: {},
    metaErrors: {},
  }
}

// The item is REFUSE, not warn: a pointer the renderer would blank must make the Deploy button
// unreachable, which `buildDeployBlockers` alone decides (it gates `disabled=` and the surfaced
// list). Deleting the validation call in `buildDeployBlockers` fails every test in this block.
describe('a pointer the app would refuse cannot reach deploy', () => {
  for (const uri of [
    'javascript:alert(1)',
    'blob:https://example.test/1234',
    'file:///etc/passwd',
    'data:text/html,<script>x</script>',
  ]) {
    test(`${uri} blocks deploy from the step that owns the input`, () => {
      const blockers = buildDeployBlockers({
        ...okInput(),
        artPointers: [{ label: 'Cover image', uri, step: 'page' }],
      })
      expect(blockers).toHaveLength(1)
      expect(blockers[0]?.step).toBe('page')
      expect(blockers[0]?.message).toMatch(/^Cover image: /)
    })
  }

  test('each bad pointer contributes its own line, routed to its own step', () => {
    const blockers = buildDeployBlockers({
      ...okInput(),
      artPointers: [
        { label: 'Cover image', uri: 'javascript:alert(1)', step: 'page' },
        { label: 'Banner image', uri: `ipfs://${CID}`, step: 'page' },
        { label: 'Piece art', uri: 'blob:https://example.test/1', step: 'contract' },
      ],
    })
    expect(blockers.map((b) => [b.step, b.message.split(':')[0]])).toEqual([
      ['page', 'Cover image'],
      ['contract', 'Piece art'],
    ])
  })

  test('blank and well-formed pointers block nothing — art stays optional', () => {
    expect(
      buildDeployBlockers({
        ...okInput(),
        artPointers: [
          { label: 'Cover image', uri: '', step: 'page' },
          { label: 'Banner image', uri: '   ', step: 'page' },
          { label: 'Piece art', uri: `ipfs://${CID}/`, step: 'contract' },
        ],
      }),
    ).toEqual([])
  })

  // Against the constant, not the literal: if the remote-art ruling flips, the gate must flip with
  // it rather than this test needing an edit.
  test('a https:// pointer blocks deploy exactly when the renderer would blank it', () => {
    const blockers = buildDeployBlockers({
      ...okInput(),
      artPointers: [{ label: 'Cover image', uri: 'https://example.test/art.png', step: 'page' }],
    })
    expect(blockers.length).toBe(ALLOW_REMOTE_HTTP_URIS ? 0 : 1)
    expect(blockers.length === 0).toBe(sanitizeImageUri('https://example.test/art.png') !== '')
  })
})

describe('the input says so at authoring time', () => {
  test('a refused pointer shows an error and marks the input invalid', () => {
    render(
      <ImageSourceInput id="cover" label="Cover" value="javascript:alert(1)" onChange={() => {}} />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/^Cover: /)
    expect(screen.getByLabelText('Cover link')).toHaveAttribute('aria-invalid', 'true')
  })

  test('a refused pointer is not previewed — the form never shows art the app would drop', () => {
    render(
      <ImageSourceInput
        id="cover"
        label="Cover"
        value="data:text/html,<script>x</script>"
        onChange={() => {}}
      />,
    )
    expect(screen.queryByAltText('Cover preview')).toBeNull()
  })

  test('an accepted pointer produces no error and still previews', () => {
    render(
      <ImageSourceInput id="cover" label="Cover" value={`ipfs://${CID}`} onChange={() => {}} />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByAltText('Cover preview')).toBeInTheDocument()
  })

  test('clearing a refused pointer clears the error', () => {
    const { rerender } = render(
      <ImageSourceInput id="cover" label="Cover" value="javascript:alert(1)" onChange={() => {}} />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<ImageSourceInput id="cover" label="Cover" value="" onChange={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('typing a bad pointer into the field surfaces the refusal', () => {
    let current = ''
    const { rerender } = render(
      <ImageSourceInput
        id="cover"
        label="Cover"
        value={current}
        onChange={(v) => {
          current = v
        }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Cover link'), {
      target: { value: 'file:///etc/passwd' },
    })
    rerender(<ImageSourceInput id="cover" label="Cover" value={current} onChange={() => {}} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
