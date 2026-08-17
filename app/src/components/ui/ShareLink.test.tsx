import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ShareLink } from './ShareLink'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText } })
}

test('renders a button with an accessible name', () => {
  stubClipboard(() => Promise.resolve())
  render(<ShareLink url="https://example.test/piece" />)
  expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
})

test('click copies the expected URL and shows the confirmation', async () => {
  const writeText = vi.fn(() => Promise.resolve())
  stubClipboard(writeText)
  render(<ShareLink url="https://example.test/piece" />)

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
  })

  expect(writeText).toHaveBeenCalledWith('https://example.test/piece')
  expect(screen.getByRole('button', { name: /link copied/i })).toBeInTheDocument()
})

test('confirmation reverts to the resting label after the timeout', async () => {
  vi.useFakeTimers()
  const writeText = vi.fn(() => Promise.resolve())
  stubClipboard(writeText)
  render(<ShareLink url="https://example.test/piece" />)

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
  })
  expect(screen.getByRole('button', { name: /link copied/i })).toBeInTheDocument()

  await act(async () => {
    vi.advanceTimersByTime(2000)
  })

  expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
})

test('falls back to a selectable input when navigator.clipboard is unavailable', () => {
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: undefined })

  expect(() => render(<ShareLink url="https://example.test/piece" />)).not.toThrow()

  const input = screen.getByTestId('share-link-fallback') as HTMLInputElement
  expect(input).toBeInTheDocument()
  expect(input.readOnly).toBe(true)
  expect(input.value).toBe('https://example.test/piece')
})

test('an explicit url prop overrides window.location.href', () => {
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: undefined })
  render(<ShareLink url="https://example.test/explicit" />)
  const input = screen.getByTestId('share-link-fallback') as HTMLInputElement
  expect(input.value).toBe('https://example.test/explicit')
  expect(input.value).not.toBe(window.location.href)
})
