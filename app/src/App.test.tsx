import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from './App'

test('renders the app shell with the hero and nav', () => {
  render(<App />)
  // Hero title (home route).
  expect(screen.getByRole('heading', { level: 1, name: 'ms2.fun' })).toBeInTheDocument()
  // Top-bar nav surfaces.
  expect(screen.getByRole('link', { name: 'COLLECTIONS' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'BOARD' })).toBeInTheDocument()
})
