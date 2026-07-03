import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from './App'

test('renders the app shell with the canonical nav', () => {
  render(<App />)
  // The NOESIS wordmark (frame symbol + lowercase "noesis") is the top-bar logo.
  expect(screen.getByRole('link', { name: /noesis/i })).toBeInTheDocument()
  // Canonical NOESIS nav (ADR-019): COLLECTIONS · BOARD · LAUNCH.
  expect(screen.getByRole('link', { name: 'COLLECTIONS' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'BOARD' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'LAUNCH' })).toBeInTheDocument()
})
