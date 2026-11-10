import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { anvilChainId, sepoliaChainId } from '../../lib/addresses'
import { SEPOLIA_FAUCET_URL } from '../../lib/wizard/testnetFunds'

const balance = vi.hoisted(() => ({ value: undefined as bigint | undefined }))
vi.mock('wagmi', () => ({
  useBalance: () => ({ data: balance.value === undefined ? undefined : { value: balance.value } }),
}))

import { BeforeYouStart, TestnetFundsNotice } from './LaunchPrereqs'

const WALLET = '0x00000000000000000000000000000000000000a1' as const

afterEach(() => {
  cleanup()
  balance.value = undefined
})

describe('BeforeYouStart', () => {
  test('on Sepolia it names Sepolia ETH and links the faucet in a new tab', () => {
    render(<BeforeYouStart chainId={sepoliaChainId} />)
    expect(screen.getByTestId('wizard-before-start')).toHaveTextContent(/Sepolia ETH/)
    const link = screen.getByRole('link', { name: /faucet/i })
    expect(link).toHaveAttribute('href', SEPOLIA_FAUCET_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test.each([
    ['mainnet', 1],
    ['the local fork', anvilChainId],
  ])('on %s it still lists the checklist but shows no faucet', (_name, chainId) => {
    render(<BeforeYouStart chainId={chainId} />)
    const box = screen.getByTestId('wizard-before-start')
    expect(box).toHaveTextContent(/hosted/i)
    expect(box).not.toHaveTextContent(/testnet|Sepolia|faucet/i)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('TestnetFundsNotice', () => {
  test('on Sepolia an empty wallet is told to visit the faucet', () => {
    balance.value = 0n
    render(<TestnetFundsNotice wallet={WALLET} costWei={undefined} chainId={sepoliaChainId} />)
    expect(screen.getByTestId('wizard-testnet-funds')).toHaveTextContent(/no Sepolia ETH/)
    expect(screen.getByRole('link', { name: /faucet/i })).toHaveAttribute(
      'href',
      SEPOLIA_FAUCET_URL,
    )
  })

  test('on Sepolia a wallet below the known cost is warned', () => {
    balance.value = 5n
    render(<TestnetFundsNotice wallet={WALLET} costWei={10n} chainId={sepoliaChainId} />)
    expect(screen.getByTestId('wizard-testnet-funds')).toHaveTextContent(/won't cover/)
  })

  test('on Sepolia a funded wallet sees nothing', () => {
    balance.value = 10n ** 18n
    render(<TestnetFundsNotice wallet={WALLET} costWei={10n} chainId={sepoliaChainId} />)
    expect(screen.queryByTestId('wizard-testnet-funds')).toBeNull()
  })

  test('on mainnet an empty wallet sees no faucet notice', () => {
    balance.value = 0n
    render(<TestnetFundsNotice wallet={WALLET} costWei={undefined} chainId={1} />)
    expect(screen.queryByTestId('wizard-testnet-funds')).toBeNull()
  })

  test('with no wallet connected nothing renders', () => {
    balance.value = 0n
    render(<TestnetFundsNotice wallet={undefined} costWei={undefined} chainId={sepoliaChainId} />)
    expect(screen.queryByTestId('wizard-testnet-funds')).toBeNull()
  })
})
