/**
 * Routing-mode matrix for the two distribution targets (noesis-409).
 *
 * The app ships twice from one tree: ms2.fun (history routing, server-backed SPA fallback) and the
 * IPFS pin behind noesis.gwei.domains (hash routing, because a public gateway answers an unknown
 * path with its own 404 and the subdomain gateway proxies that unchanged). The mode is selected by
 * `VITE_DIST_TARGET`, so both modes are drivable from one suite.
 *
 * What each assertion would catch if the wiring regressed:
 *   * `Link` hrefs — drop the `hook` from `<Router>` in `App.tsx` and the ipfs-mode cases fail:
 *     hrefs come back as `/collections`, which on a gateway walks out of the CID.
 *   * unknown-route resolution under each mode — proves the location hook the router is actually
 *     reading, not just the href the anchor renders.
 *   * the cross case (a history path present while in hash mode) — proves the hash hook is in
 *     charge, which a `<Router>` rendered with no hook would silently get wrong.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { navigate as hashNavigate } from 'wouter/use-hash-location'
import { App } from './App'

/** Text rendered only by the catch-all `<Route>` in the app shell. */
const NOT_FOUND = 'Not on view'

function setUrl(path: string) {
  window.history.replaceState(null, '', path)
}

function collectionsHref(): string | null {
  return screen.getAllByRole('link', { name: 'COLLECTIONS' })[0]?.getAttribute('href') ?? null
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  setUrl('/')
})

test('web target: links are root-relative paths and the path drives the route', () => {
  setUrl('/no-such-route')
  render(<App />)
  expect(collectionsHref()).toBe('/collections')
  expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
})

test('web target: a stray fragment does not route', () => {
  setUrl('/#/no-such-route')
  render(<App />)
  // The path is `/`, so the home route matches — the fragment is inert in history mode.
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
})

test('ipfs target: every link href is a fragment, so no navigation leaves the pinned document', () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')
  render(<App />)
  expect(collectionsHref()).toBe('#/collections')
  for (const link of screen.getAllByRole('link')) {
    const href = link.getAttribute('href')
    if (href === null) continue
    // Absolute URLs are allowed (outbound links); what must never appear is a root-anchored path,
    // which resolves against the gateway origin instead of the CID directory.
    expect(href.startsWith('/')).toBe(false)
  }
})

test('ipfs target: the fragment drives the route', () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')
  setUrl('/#/no-such-route')
  render(<App />)
  expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
})

test('ipfs target: an empty fragment is the home route, whatever the path prefix is', () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')
  // What a gateway actually serves: the document lives at a deep path, and the route is the
  // fragment alone. The path must not reach the router.
  setUrl('/ipfs/bafyplaceholdercid/')
  render(<App />)
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
})

test('ipfs target: in-app navigation updates the fragment and re-routes live', () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')
  setUrl('/ipfs/bafyplaceholdercid/')
  render(<App />)
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()

  act(() => {
    hashNavigate('/no-such-route')
  })

  expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
  // The document path is untouched — only the fragment moved.
  expect(window.location.pathname).toBe('/ipfs/bafyplaceholdercid/')
  expect(window.location.hash).toBe('#/no-such-route')
})
