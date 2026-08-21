import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { IpfsImage } from './IpfsImage'
import {
  gatewayHealth,
  IPFS_GATEWAYS,
  noteGatewayFault,
  noteGatewaySuccess,
  resetGatewayHealth,
} from '../../lib/metadata'
import { customGatewayStore } from '../../lib/storage'
import { installLocalStorageMock } from '../../lib/storage/testLocalStorage'

beforeEach(() => {
  installLocalStorageMock()
  resetGatewayHealth()
  customGatewayStore.remove()
})

afterEach(() => {
  cleanup()
  resetGatewayHealth()
  customGatewayStore.remove()
})

test('starts at the roster head when nothing is known', () => {
  render(<IpfsImage uri="ipfs://QmFoo/a.png" alt="art" testId="art" />)
  expect(screen.getByTestId('art')).toHaveAttribute('src', `${IPFS_GATEWAYS[0]}QmFoo/a.png`)
})

test('starts at the most recently good gateway', () => {
  noteGatewaySuccess(IPFS_GATEWAYS[2])
  render(<IpfsImage uri="ipfs://QmBar/a.png" alt="art" testId="art" />)
  expect(screen.getByTestId('art')).toHaveAttribute('src', `${IPFS_GATEWAYS[2]}QmBar/a.png`)
})

test('never points at a gateway that is inside a rate-limit window', () => {
  noteGatewayFault(IPFS_GATEWAYS[0], 'throttled', 300_000)
  render(<IpfsImage uri="ipfs://QmBaz/a.png" alt="art" testId="art" />)
  expect(screen.getByTestId('art')).not.toHaveAttribute('src', `${IPFS_GATEWAYS[0]}QmBaz/a.png`)
})

test('a load credits the gateway, so the metadata layer starts there too', () => {
  render(<IpfsImage uri="ipfs://QmQux/a.png" alt="art" testId="art" />)
  fireEvent.load(screen.getByTestId('art'))
  expect(gatewayHealth(IPFS_GATEWAYS[0]).lastGood).toBeGreaterThan(0)
})

test('a load error rotates to the next gateway without penalising the failed one', () => {
  render(<IpfsImage uri="ipfs://QmRot/a.png" alt="art" testId="art" />)
  fireEvent.error(screen.getByTestId('art'))
  expect(screen.getByTestId('art')).toHaveAttribute('src', `${IPFS_GATEWAYS[1]}QmRot/a.png`)
  // An <img> error carries no status, so it cannot be told apart from a missing CID and must not
  // cool a gateway for every other pointer on the page.
  expect(gatewayHealth(IPFS_GATEWAYS[0]).cooldownUntil).toBe(0)
})

test('renders the caller fallback once every gateway has failed on this pointer', () => {
  render(
    <IpfsImage
      uri="ipfs://QmGone/a.png"
      alt="art"
      testId="art"
      fallback={<span data-testid="missing">no art</span>}
    />,
  )
  for (let i = 0; i < IPFS_GATEWAYS.length; i += 1) {
    const img = screen.queryByTestId('art')
    if (img) fireEvent.error(img)
  }
  expect(screen.getByTestId('missing')).toBeInTheDocument()
  expect(screen.queryByTestId('ipfs-throttled')).not.toBeInTheDocument()
})

test('renders a DISTINCT marker when the art could not be requested at all', () => {
  for (const gateway of IPFS_GATEWAYS) noteGatewayFault(gateway, 'throttled', 300_000)
  render(
    <IpfsImage
      uri="ipfs://QmHeld/a.png"
      alt="art"
      testId="art"
      fallback={<span data-testid="missing">no art</span>}
    />,
  )
  // Throttled art exists; missing art does not. The card must not say the same thing for both.
  expect(screen.getByTestId('ipfs-throttled')).toBeInTheDocument()
  expect(screen.queryByTestId('missing')).not.toBeInTheDocument()
})
