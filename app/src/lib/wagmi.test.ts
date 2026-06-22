import { expect, test } from 'vitest'
import { mainnet } from 'wagmi/chains'
import { anvilFork, config } from './wagmi'

test('wagmi config exposes mainnet and the anvil fork chain', () => {
  const ids = config.chains.map((chain) => chain.id)
  expect(ids).toContain(mainnet.id)
  expect(ids).toContain(anvilFork.id)
})

test('the anvil fork chain is id 1337', () => {
  expect(anvilFork.id).toBe(1337)
})
