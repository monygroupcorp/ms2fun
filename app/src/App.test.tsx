import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from './App'

test('renders the app shell with the canonical nav', () => {
  render(<App />)
  // The ms2.fun wordmark stays in the top-bar logo (NOESIS visual system, name retained).
  expect(screen.getByRole('link', { name: /ms2/i })).toBeInTheDocument()
  // Canonical NOESIS nav (ADR-019): COLLECTIONS · BOARD · LAUNCH.
  expect(screen.getByRole('link', { name: 'COLLECTIONS' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'BOARD' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'LAUNCH' })).toBeInTheDocument()
})
