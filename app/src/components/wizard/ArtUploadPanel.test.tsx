import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { hashLips, png, text, zipOf } from '../../test/artFixtures'
import { isHostedArtUri } from '../../lib/art/hostClient'
import { artPointerError } from '../../lib/wizard/artPointer'
import { ArtUploadPanel } from './ArtUploadPanel'

const mocks = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  upload: vi.fn(),
  signIn: vi.fn(async () => 'token'),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mocks.address }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}))
vi.mock('../../lib/art/hostClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/art/hostClient')>()),
  signIn: () => mocks.signIn(),
  uploadResumable: (...args: unknown[]) => mocks.upload(...args),
}))

beforeEach(() => {
  mocks.address = undefined
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const HOST = 'https://art.example'
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

function file(path: string, bytes: Uint8Array): File {
  return new File([bytes as BlobPart], path.slice(path.lastIndexOf('/') + 1))
}

function choose(files: File[]) {
  fireEvent.change(screen.getByLabelText('Choose files or a zip'), { target: { files } })
}

describe('the upload option', () => {
  test('tells the creator plainly that hosting is a convenience and the art belongs on IPFS', () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    const notice = screen.getByText(/Hosting is a convenience/).closest('p')!
    expect(notice.textContent).toMatch(/art\.example/)
    expect(notice.textContent).toMatch(/not a promise to keep your art forever/)
    expect(notice.textContent).toMatch(/Art belongs on IPFS/)
    expect(notice.textContent).toMatch(/once your collection graduates, we recommend moving it/)
    expect(notice.textContent).not.toMatch(/\d+ days after/)
    expect(notice.textContent).toMatch(/deleted after 7 days/)
  })

  test('links the instructions for preparing files, and takes folders as well as files', () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    expect(screen.getByRole('link', { name: /Preparing your files/ }).getAttribute('href')).toBe(
      '/learn/preparing-your-files',
    )
    expect(screen.getByLabelText('Choose a folder').hasAttribute('webkitdirectory')).toBe(true)
  })

  test('reviews a HashLips zip: pieces, traits and the placeholder links it will replace', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} supply="3" />)
    choose([file('collection.zip', zipOf(hashLips(3)))])
    const review = await screen.findByTestId('art-review')
    expect(review.textContent).toMatch(/3 pieces/)
    expect(review.textContent).toMatch(/one JSON file per piece/)
    expect(review.textContent).toMatch(/#1 Sprite #1/)
    expect(review.textContent).toMatch(/Background: Red · Eyes: Laser/)
    expect(review.textContent).toMatch(/Red \(2\)/)
    expect(review.textContent).toMatch(/placeholder/)
    expect(screen.getByRole('button', { name: 'Sign in and upload' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  test('lists what it cannot use and blocks what it cannot host, before anything is sent', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    choose([
      file('1.png', png(1)),
      file('2.png', text('<html></html>')),
      file('logo.svg', text('<svg/>')),
    ])
    expect(await screen.findByText(/2\.png is not really a PNG image/)).toBeTruthy()
    expect(screen.getByText(/logo\.svg: SVG cannot be hosted/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in and upload' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  test('blocks a collection with fewer pieces than NFTs, naming the token ids', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} supply="10" />)
    choose([file('a.png', png(1)), file('b.png', png(2))])
    expect(await screen.findByText(/10 NFTs but 8 of them would have no art: #3–#10/)).toBeTruthy()
  })

  test('asks for a name pattern when the images come without metadata', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} supply="1" />)
    choose([file('a.png', png(1))])
    expect(await screen.findByLabelText('Name pattern')).toBeTruthy()
  })

  test('asks for a wallet before it builds anything', async () => {
    render(<ArtUploadPanel host={HOST} onUploaded={() => {}} />)
    choose([file('a.png', png(1))])
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in and upload' }))
    expect(await screen.findByText(/Connect a wallet first/)).toBeTruthy()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  test('shows a resumed upload as resumed, then fills the piece-art link', async () => {
    mocks.address = '0x00000000000000000000000000000000000000aa'
    let finish!: () => void
    mocks.upload.mockImplementation(
      async (
        _host: string,
        token: (fresh: boolean) => Promise<string>,
        source: { size: number },
        onProgress: (p: unknown) => void,
      ) => {
        await token(false)
        onProgress({
          stage: 'uploading',
          sent: Math.floor(source.size / 2),
          total: source.size,
          resumedFrom: Math.floor(source.size / 2),
          retrying: null,
        })
        await new Promise<void>((resolve) => (finish = resolve))
        return { draft: { expiresAt: null }, duplicate: false }
      },
    )
    const onUploaded = vi.fn()
    render(<ArtUploadPanel host={HOST} onUploaded={onUploaded} supply="2" />)
    choose([file('a.png', png(1)), file('b.png', png(2))])
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in and upload' }))
    expect(await screen.findByText(/Resumed: .* was already uploaded/)).toBeTruthy()
    finish()
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(onUploaded.mock.calls[0]![0]).toMatch(new RegExp(`^${HOST}/ipfs/baf[a-z0-9]+/$`))
  })

  test('offers metadata already on IPFS as it is, and fills the paste field with its base', async () => {
    const onUploaded = vi.fn()
    render(<ArtUploadPanel host={HOST} onUploaded={onUploaded} supply="2" />)
    choose([
      file('1.json', text(`{"name":"One","image":"ipfs://${CID}/1.png"}`)),
      file('2.json', text(`{"name":"Two","image":"ipfs://${CID}/2.png"}`)),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Already on IPFS: use it as-is' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /^Use ipfs:\/\/.* as the piece-art link$/ }),
    )
    expect(onUploaded.mock.calls[0]![0]).toMatch(/^ipfs:\/\/baf[a-z0-9]+\/$/)
    expect(screen.queryByRole('button', { name: 'Sign in and upload' })).toBeNull()
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
