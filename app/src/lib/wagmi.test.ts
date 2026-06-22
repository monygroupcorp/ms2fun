import { expect, test } from 'vitest'
import { anvil, mainnet } from 'wagmi/chains'
import { config } from './wagmi'

test('wagmi config exposes mainnet and the anvil fork chain', () => {
  const ids = config.chains.map((chain) => chain.id)
  expect(ids).toContain(mainnet.id)
  expect(ids).toContain(anvil.id)
})
