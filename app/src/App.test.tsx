import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { App } from './App'

// This suite does not run with vitest globals, so React Testing Library's automatic teardown is
// not registered — without this each render would stack another shell into the same document.
afterEach(cleanup)

test('renders the app shell with the canonical nav', () => {
  render(<App />)
  // The NOESIS wordmark (frame symbol + lowercase "noesis") is the top-bar logo.
  expect(screen.getByRole('link', { name: /noesis/i })).toBeInTheDocument()
  // Canonical NOESIS nav (ADR-019): COLLECTIONS · BOARD · LAUNCH.
  expect(screen.getByRole('link', { name: 'COLLECTIONS' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'BOARD' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'LAUNCH' })).toBeInTheDocument()
})

test('the shell carries a build-identity stamp', () => {
  render(<App />)
  // The pinned IPFS distribution is repointed on its own cadence and can lag ms2.fun, so a report
  // from either surface has to be able to name the build it came from. Both targets stamp it.
  const stamp = screen.getByTestId('build-stamp')
  expect(stamp.getAttribute('data-build')).toBeTruthy()
  expect(stamp.getAttribute('data-target')).toBe('web')
})
