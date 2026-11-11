import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { isHostedArtUri } from '../../lib/art/hostClient'
import { artPointerError } from '../../lib/wizard/artPointer'
import { ArtUploadPanel } from './ArtUploadPanel'

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}))

afterEach(cleanup)

const HOST = 'https://art.example'
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

function png(name: string): File {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    name,
    {
      type: 'image/png',
    },
  )
}

describe('the upload option', () => {
  test('tells the creator plainly that hosting is temporary and the art should move to IPFS', () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    const notice = screen.getByText(/Hosting is temporary\./).closest('p')!
    expect(notice.textContent).toMatch(/art\.example/)
    expect(notice.textContent).toMatch(/Move it to IPFS once your collection graduates/)
    expect(notice.textContent).toMatch(/deleted after 7 days/)
  })

  test('lists what it cannot host before anything is signed or sent', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByLabelText('Choose image files'), {
      target: { files: [png('1.png'), svg] },
    })
    expect(await screen.findByText(/logo\.svg: only PNG, JPEG, WebP and GIF/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in and upload' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  test('warns when there are fewer images than NFTs', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} supply="10" />)
    fireEvent.change(screen.getByLabelText('Choose image files'), {
      target: { files: [png('a.png'), png('b.png')] },
    })
    expect(await screen.findByText(/pieces past #2 will have no art/)).toBeTruthy()
  })

  test('asks for a wallet before it builds anything', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    fireEvent.change(screen.getByLabelText('Choose image files'), {
      target: { files: [png('a.png')] },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in and upload' }))
    expect(await screen.findByText(/Connect a wallet first/)).toBeTruthy()
  })
})

describe('the hosted base it writes', () => {
  test('is a pointer the wizard accepts and the renderer keeps', () => {
    expect(artPointerError(`${HOST}/ipfs/${CID}/`)).toBeNull()
  })

  test('is recognised as hosted, so a deploy binds it', () => {
    expect(isHostedArtUri(`${HOST}/ipfs/${CID}/`, HOST)).toBe(true)
    expect(isHostedArtUri(`ipfs://${CID}/`, HOST)).toBe(false)
    expect(isHostedArtUri(`https://elsewhere.example/ipfs/${CID}/`, HOST)).toBe(false)
    expect(isHostedArtUri(`${HOST}/ipfs/${CID}/`, null)).toBe(false)
  })
})
