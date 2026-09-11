/**
 * The share round trip under the hash distribution target (noesis-450).
 *
 * `ShareLink` copies whatever URL the visitor is actually on — it hardcodes no origin, so the link
 * is already constructive to whichever host served the page. What used to make a copied link die
 * was the *routing shape*, not the origin: under history routing a deep path only resolves if the
 * host rewrites unknown paths back to the app, and a host that does not answers its own 404.
 *
 * Under `VITE_DIST_TARGET=ipfs` the route lives in the fragment, which never reaches the server.
 * This test pins the whole round trip end to end: copy a link mid-session, throw the session away,
 * open the copied URL cold, and land on the same view — with the server asked for nothing but the
 * document it already served. That is the property that makes a share link safe at *any* origin,
 * with no rewrite rule anywhere, which is why it is asserted rather than argued.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { navigate as hashNavigate } from 'wouter/use-hash-location'
import { App } from '../../App'
import { ShareLink } from './ShareLink'

/** A gateway-shaped document path: the app is served from under a deep prefix, not the root. */
const DOCUMENT_PATH = '/ipfs/bafyplaceholdercid/'

/** Text rendered only by the `/learn` route, and by no other route in the shell. */
const LEARN_VIEW = 'How the launchpad works'

/** Text rendered only by the catch-all route — what a link that failed to resolve would show. */
const NOT_FOUND = 'Not on view'

function setUrl(url: string) {
  window.history.replaceState(null, '', url)
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setUrl('/')
})

test('ipfs target: a link copied mid-session opens cold on the same view, with no server rewrite', async () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')

  // --- The live session: land on the document, then navigate in-app to a deep route. ----------
  setUrl(DOCUMENT_PATH)
  render(<App />)
  act(() => {
    hashNavigate('/learn')
  })
  expect(await screen.findByText(LEARN_VIEW, { exact: false })).toBeInTheDocument()

  // --- The share: no `url` prop, so the visitor's own location is what gets copied. -----------
  const writeText = vi.fn((_text: string) => Promise.resolve())
  stubClipboard(writeText)
  render(<ShareLink />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
  })
  const shared = writeText.mock.calls[0]?.[0] ?? ''
  expect(shared).toBe(window.location.href)

  // The route is entirely in the fragment, so the only thing a server is ever asked for is the
  // document it already served. There is no unknown path for a host to rewrite, or to 404.
  const parsed = new URL(shared)
  expect(parsed.pathname).toBe(DOCUMENT_PATH)
  expect(parsed.search).toBe('')
  expect(parsed.hash).toBe('#/learn')

  // --- The cold open: nothing of the session survives but the copied string. ------------------
  cleanup()
  setUrl('/') // clears both the deep prefix and the fragment the session left behind
  setUrl(parsed.pathname + parsed.hash)

  render(<App />)
  expect(await screen.findByText(LEARN_VIEW, { exact: false })).toBeInTheDocument()
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
})

test('ipfs target: the same copied link resolves from a different origin and path prefix', async () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')

  // Same fragment, a document served from somewhere else entirely — a second gateway, a local
  // file server, a plain static host. The origin is not part of what makes the link resolve.
  setUrl('/some/other/prefix/index.html#/learn')
  render(<App />)

  expect(await screen.findByText(LEARN_VIEW, { exact: false })).toBeInTheDocument()
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
})
