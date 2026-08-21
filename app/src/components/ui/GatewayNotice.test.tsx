import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GatewayNotice } from './GatewayNotice'
import { IPFS_GATEWAYS, noteGatewayFault, resetGatewayHealth } from '../../lib/metadata'
import { customGatewayStore } from '../../lib/storage'
import { installLocalStorageMock } from '../../lib/storage/testLocalStorage'

function throttleEveryGateway(): void {
  for (const gateway of IPFS_GATEWAYS) noteGatewayFault(gateway, 'throttled', 300_000)
}

beforeEach(() => {
  installLocalStorageMock()
  resetGatewayHealth()
  customGatewayStore.remove()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetGatewayHealth()
  customGatewayStore.remove()
})

test('renders nothing while any gateway is still askable', () => {
  noteGatewayFault(IPFS_GATEWAYS[0], 'throttled', 300_000)
  render(<GatewayNotice />)
  expect(screen.queryByTestId('gateway-notice')).not.toBeInTheDocument()
})

test('explains the throttle in plain language once every gateway is cooling', () => {
  throttleEveryGateway()
  render(<GatewayNotice />)
  const notice = screen.getByTestId('gateway-notice')
  expect(notice).toHaveTextContent(/rate-limiting this browser/i)
  expect(notice).toHaveTextContent(/not a problem with this app/i)
  expect(notice).toHaveTextContent(/about 5 minutes/i)
})

test('can be dismissed, so a casual visitor is never walled off', () => {
  throttleEveryGateway()
  render(<GatewayNotice />)
  fireEvent.click(screen.getByTestId('gateway-notice-dismiss'))
  expect(screen.queryByTestId('gateway-notice')).not.toBeInTheDocument()
})

test('rejects a value that is not a URL without spending a request', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  throttleEveryGateway()
  render(<GatewayNotice />)

  fireEvent.change(screen.getByTestId('gateway-notice-input'), { target: { value: 'my gateway' } })
  await act(async () => {
    fireEvent.click(screen.getByTestId('gateway-notice-save'))
  })

  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByTestId('gateway-notice-error')).toBeInTheDocument()
  expect(customGatewayStore.get()).toBeNull()
})

test('does not save a gateway that fails the content check', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status: 502 } as unknown as Response)),
  )
  throttleEveryGateway()
  render(<GatewayNotice />)

  fireEvent.change(screen.getByTestId('gateway-notice-input'), {
    target: { value: 'https://typo.example' },
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('gateway-notice-save'))
  })

  expect(customGatewayStore.get()).toBeNull()
  expect(screen.getByTestId('gateway-notice-error')).toBeInTheDocument()
})

test('saves a gateway that serves the probe block, and the notice clears', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('hello\n'),
      } as unknown as Response),
    ),
  )
  throttleEveryGateway()
  render(<GatewayNotice />)

  fireEvent.change(screen.getByTestId('gateway-notice-input'), {
    target: { value: 'https://my.gw' },
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('gateway-notice-save'))
  })

  // Normalised to the form the resolver appends a CID to, and live immediately — the notice is gone
  // because a ready gateway now exists.
  expect(customGatewayStore.get()).toBe('https://my.gw/ipfs/')
  expect(screen.queryByTestId('gateway-notice')).not.toBeInTheDocument()
})

test('offers a way to remove a saved gateway', () => {
  customGatewayStore.set('https://my.gw/ipfs/')
  throttleEveryGateway()
  noteGatewayFault('https://my.gw/ipfs/', 'throttled', 300_000)
  render(<GatewayNotice />)

  expect(screen.getByTestId('gateway-notice-current')).toHaveTextContent('https://my.gw/ipfs/')
  fireEvent.click(screen.getByTestId('gateway-notice-remove'))
  expect(customGatewayStore.get()).toBeNull()
})
