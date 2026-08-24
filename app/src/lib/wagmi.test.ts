import { expect, test } from 'vitest'
import { mainnet, sepolia } from 'wagmi/chains'
import { addressesByChain } from './addresses'
import { anvilFork, config } from './wagmi'

test('wagmi config exposes mainnet, Sepolia, and the anvil fork chain', () => {
  const ids = config.chains.map((chain) => chain.id)
  expect(ids).toContain(mainnet.id)
  expect(ids).toContain(sepolia.id)
  expect(ids).toContain(anvilFork.id)
})

test('the anvil fork chain is id 1337', () => {
  expect(anvilFork.id).toBe(1337)
})

test('the Sepolia chain is id 11155111', () => {
  expect(sepolia.id).toBe(11155111)
})

/**
 * A chain the app carries addresses for but cannot reach has no read path at all: every hook on a
 * route scoped to it fails at transport selection rather than at the contract call. Pin the two
 * lists against each other so adding a deployment file without a chain entry is a red test, not a
 * runtime discovery.
 */
test('every chain with an address bundle is a chain wagmi can reach', () => {
  const reachable = new Set<number>(config.chains.map((chain) => chain.id))
  for (const chainId of Object.keys(addressesByChain).map(Number)) {
    expect(reachable.has(chainId)).toBe(true)
  }
})
