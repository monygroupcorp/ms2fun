/**
 * GatewayThrottleNotice — the two things the viewer is owed when gateways start refusing them.
 *
 * Tier 1: they are TOLD, in language that locates the problem correctly (their connection, not this
 * app and not the collection), and they can dismiss it and keep browsing.
 * Tier 2: someone with their own gateway can install it from inside the notice, and a gateway that
 * does not actually serve content is refused before it is saved — a stored typo sits in front of the
 * public set and fails every load.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FAULT_STARVATION_THRESHOLD,
  gatewayKey,
  getIpfsGateways,
  IPFS_GATEWAYS,
  noteRosterFault,
  noteThrottled,
  resetGatewayHealth,
  GATEWAY_PROBE_CID,
} from '../../lib/metadata'
import { customGatewayStore } from '../../lib/storage'
import { GatewayThrottleNotice } from './GatewayThrottleNotice'

const fetchMock = vi.fn()

/** Vitest 4's jsdom localStorage is unavailable; the custom gateway is a persisted value. */
function makeLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

function coolEveryGateway(): void {
  for (const gateway of IPFS_GATEWAYS) noteThrottled(gatewayKey(gateway))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageMock())
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  resetGatewayHealth()
  customGatewayStore.remove()
})

afterEach(() => {
  cleanup()
  resetGatewayHealth()
  customGatewayStore.remove()
  vi.unstubAllGlobals()
})

describe('GatewayThrottleNotice', () => {
  it('renders nothing while any gateway can still be asked', () => {
    render(<GatewayThrottleNotice />)
    expect(screen.queryByTestId('gateway-throttle-notice')).not.toBeInTheDocument()
  })

  it('explains the throttle as the viewer’s connection, not a broken app or collection', () => {
    coolEveryGateway()
    render(<GatewayThrottleNotice />)

    const notice = screen.getByTestId('gateway-throttle-notice')
    expect(notice).toBeInTheDocument()
    expect(notice.textContent).toMatch(/rate-limiting this browser/i)
    expect(notice.textContent).toMatch(/not a problem with this app or the collection/i)
    // A window, so the viewer knows it ends.
    expect(notice.textContent).toMatch(/minute/i)
    // Never the raw status code.
    expect(notice.textContent).not.toMatch(/429/)
  })

  it('can be dismissed, and does not block anything behind it', () => {
    coolEveryGateway()
    render(<GatewayThrottleNotice />)

    fireEvent.click(screen.getByTestId('gateway-throttle-dismiss'))

    expect(screen.queryByTestId('gateway-throttle-notice')).not.toBeInTheDocument()
  })

  it('probes a pasted gateway against a known-good CID before saving it', async () => {
    coolEveryGateway()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
    })
    render(<GatewayThrottleNotice />)

    fireEvent.change(screen.getByTestId('gateway-throttle-input'), {
      target: { value: 'https://my.gw' },
    })
    fireEvent.click(screen.getByTestId('gateway-throttle-save'))

    await waitFor(() => expect(customGatewayStore.get()).toBe('https://my.gw/ipfs/'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://my.gw/ipfs/${GATEWAY_PROBE_CID}`)
  })

  it('refuses a gateway that does not serve content, rather than storing a dead one', async () => {
    coolEveryGateway()
    fetchMock.mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } })
    render(<GatewayThrottleNotice />)

    fireEvent.change(screen.getByTestId('gateway-throttle-input'), {
      target: { value: 'https://typo.gw' },
    })
    fireEvent.click(screen.getByTestId('gateway-throttle-save'))

    await waitFor(() => expect(screen.getByTestId('gateway-throttle-error')).toBeInTheDocument())
    expect(customGatewayStore.get()).toBeNull()
  })

  it('refuses a URL that answers with a web page instead of IPFS content', async () => {
    coolEveryGateway()
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/html' } })
    render(<GatewayThrottleNotice />)

    fireEvent.change(screen.getByTestId('gateway-throttle-input'), {
      target: { value: 'https://not-a-gateway.example' },
    })
    fireEvent.click(screen.getByTestId('gateway-throttle-save'))

    await waitFor(() => expect(screen.getByTestId('gateway-throttle-error')).toBeInTheDocument())
    expect(customGatewayStore.get()).toBeNull()
  })

  it('states the privacy cost of a custom gateway at the input, in the shared wording', () => {
    coolEveryGateway()
    render(<GatewayThrottleNotice />)

    expect(screen.getByTestId('gateway-throttle-notice').textContent).toContain(
      'Only use a gateway you run or trust.',
    )
  })

  it('stays out of the way once a working custom gateway is set', () => {
    coolEveryGateway()
    customGatewayStore.set('https://my.gw/ipfs/')

    render(<GatewayThrottleNotice />)

    // The public set is still cooling, but the viewer has an unmetered route — nothing to report.
    expect(screen.queryByTestId('gateway-throttle-notice')).not.toBeInTheDocument()
  })

  it('offers a way out when even the viewer’s own gateway is refusing them', async () => {
    customGatewayStore.set('https://my.gw/ipfs/')
    // Everything, the custom entry included, is now parked.
    for (const gateway of getIpfsGateways()) noteThrottled(gatewayKey(gateway))
    render(<GatewayThrottleNotice />)

    expect(screen.getByTestId('gateway-throttle-current').textContent).toContain('https://my.gw')
    fireEvent.click(screen.getByTestId('gateway-throttle-remove'))

    await waitFor(() => expect(customGatewayStore.get()).toBeNull())
    expect(screen.getByTestId('gateway-throttle-input')).toBeInTheDocument()
  })
})

describe('GatewayThrottleNotice — fault starvation', () => {
  it('surfaces the notice when the roster has gone fault-only, with no gateway actually cooling', () => {
    // No cooldown anywhere — every gateway is nominally askable — but attempts keep faulting.
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD; i += 1) noteRosterFault()
    render(<GatewayThrottleNotice />)

    const notice = screen.getByTestId('gateway-throttle-notice')
    expect(notice).toBeInTheDocument()
    expect(notice.textContent).toMatch(/responding slowly/i)
    // The starved wording is distinct from the rate-limit wording.
    expect(notice.textContent).not.toMatch(/rate-limiting this browser/i)
    // The Tier-2 door is still offered.
    expect(screen.getByTestId('gateway-throttle-input')).toBeInTheDocument()
  })

  it('does not surface the notice below the starvation threshold', () => {
    for (let i = 0; i < FAULT_STARVATION_THRESHOLD - 1; i += 1) noteRosterFault()
    render(<GatewayThrottleNotice />)

    expect(screen.queryByTestId('gateway-throttle-notice')).not.toBeInTheDocument()
  })

  it('keeps the ordinary throttle wording when a real cooldown is in force', () => {
    coolEveryGateway()
    render(<GatewayThrottleNotice />)

    expect(screen.getByTestId('gateway-throttle-notice').textContent).toMatch(
      /rate-limiting this browser/i,
    )
  })
})
