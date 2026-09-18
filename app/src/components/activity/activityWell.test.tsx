/**
 * The floor of the activity box — noesis-427 clause 1, "one component … one state device".
 *
 * The chrome, the line and the zero-state were unified; the well was not, and four surfaces
 * answered "may I speak here, and what does it cost me" four ways. These pin the two answers that
 * were actually wrong, and the one that is the same everywhere.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityComposer } from './ActivityComposer'

const wallet = vi.hoisted(() => ({ address: undefined as `0x${string}` | undefined }))

vi.mock('wagmi', () => ({ useAccount: () => ({ address: wallet.address }) }))

// The composer itself is a form over the board cart; this is about the well around it.
vi.mock('../MessageComposer', () => ({
  MessageComposer: ({ channel }: { channel: `0x${string}` }) => (
    <form data-testid="composer" data-channel={channel} />
  ),
}))

afterEach(cleanup)
beforeEach(() => {
  wallet.address = undefined
})

const CHANNEL = '0x1234567890abcdef1234567890abcdef12345678' as const
const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const

describe('a well nobody can speak in', () => {
  // The vault page docked a live composer unconditionally, so a visitor with no wallet could type a
  // post and queue it into the board cart with nothing able to sign it. Every surface asks first.
  it('asks for a wallet instead of offering a composer that cannot post', () => {
    render(<ActivityComposer channel={CHANNEL} lands="in this vault's channel" />)

    expect(screen.queryByTestId('composer')).toBeNull()
    expect(screen.getByText(/connect your wallet to post/)).toBeInTheDocument()
  })

  it('asks the same way whatever the surface is', () => {
    const { container: vault } = render(
      <ActivityComposer channel={CHANNEL} lands="in this vault's channel" />,
    )
    const vaultText = vault.textContent
    cleanup()

    const { container: collection } = render(
      <ActivityComposer channel={CHANNEL} lands="in this collection's activity" />,
    )

    expect(collection.textContent).toBe(vaultText)
  })

  // The salon's channel IS the connected wallet, so it has no channel to offer when there is no
  // wallet — the same prompt, reached by the other route.
  it('asks when the surface has no channel to post to either', () => {
    render(<ActivityComposer channel={undefined} lands="in the feed and on your profile" />)

    expect(screen.queryByTestId('composer')).toBeNull()
    expect(screen.getByText(/connect your wallet to post/)).toBeInTheDocument()
  })
})

describe('a well you can speak in', () => {
  beforeEach(() => {
    wallet.address = WALLET
  })

  it('posts to the channel the surface named', () => {
    render(<ActivityComposer channel={CHANNEL} lands="in this collection's activity" />)

    expect(screen.getByTestId('composer')).toHaveAttribute('data-channel', CHANNEL)
  })

  // The vault channel and the profile wall carried no note at all, so the same act was permanent
  // and attributed on two surfaces and unremarked on two others.
  it('says who signs it and that it is permanent, wherever it is docked', () => {
    render(<ActivityComposer channel={CHANNEL} lands="in this vault's channel" />)

    const note = screen.getByText(/signed by/)
    expect(note).toHaveTextContent('0xabcd…abcd')
    expect(note).toHaveTextContent('permanent')
    expect(note).toHaveTextContent("posts appear in this vault's channel")
  })

  it('leaves only where a post lands to the surface', () => {
    render(<ActivityComposer channel={CHANNEL} lands="in the feed and on your profile" />)

    expect(screen.getByText(/signed by/)).toHaveTextContent(
      'permanent — posts appear in the feed and on your profile',
    )
  })
})

describe('who may dock a composer', () => {
  // The rule the well exists to hold. Every surface that reached for `MessageComposer` itself had
  // to decide the wallet gate and the signature note on its own, and each decided differently —
  // the vault page's answer being that it simply never asked. `ActivityComposer` is the one caller
  // now, so a surface cannot acquire its own opinion about either without this saying so.
  //
  // Asserted on the SOURCE, the way `lib/vaults/alignmentWordingSurfaces.test.ts` is: a render test
  // pins the surfaces that exist today and says nothing about the next one to dock its own form.
  // (Project-root relative keys, root = `app/`; `import.meta.glob` keeps this inside the browser
  // tsconfig, which configures no `node:fs` types.)
  it('is ActivityComposer, and nothing else', () => {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    const importers = Object.entries(sources)
      .filter(
        ([path]) => path !== '/src/components/MessageComposer.tsx' && !/\.test\.tsx?$/.test(path),
      )
      .filter(([, src]) => /from '[^']*\/MessageComposer'/.test(src))
      .map(([path]) => path)
      .sort()

    expect(importers).toEqual(['/src/components/activity/ActivityComposer.tsx'])
  })
})
