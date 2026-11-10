import { describe, expect, test } from 'vitest'
import { anvilChainId, sepoliaChainId } from '../addresses'
import { SEPOLIA_FAUCET_URL, isDeployUnderfunded, testnetFaucetFor } from './testnetFunds'

describe('testnetFaucetFor', () => {
  test('Sepolia points at the Sepolia faucet', () => {
    expect(testnetFaucetFor(sepoliaChainId)).toEqual({
      network: 'Sepolia',
      url: SEPOLIA_FAUCET_URL,
    })
  })

  test('mainnet has no faucet', () => {
    expect(testnetFaucetFor(1)).toBeUndefined()
  })

  test('the local fork has no faucet (its dev accounts are pre-funded)', () => {
    expect(testnetFaucetFor(anvilChainId)).toBeUndefined()
  })
})

describe('isDeployUnderfunded', () => {
  test('an unknown balance is never short', () => {
    expect(isDeployUnderfunded(undefined, 10n)).toBe(false)
  })

  test('an empty wallet is short even before the cost is known', () => {
    expect(isDeployUnderfunded(0n, undefined)).toBe(true)
  })

  test('a funded wallet with an unknown cost is not short', () => {
    expect(isDeployUnderfunded(1n, undefined)).toBe(false)
  })

  test('compares against the known cost', () => {
    expect(isDeployUnderfunded(9n, 10n)).toBe(true)
    expect(isDeployUnderfunded(10n, 10n)).toBe(false)
  })
})
