import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from './App'

test('renders the app shell with brand and home route', () => {
  render(<App />)
  expect(screen.getByText('ms2fun')).toBeInTheDocument()
  expect(screen.getByText('ms2.fun')).toBeInTheDocument()
})
