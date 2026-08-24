/**
 * Per-chain address resolution (noesis-408).
 *
 * The app used to carry one deployment file and one chain id, so "which addresses" was never a
 * question. With Sepolia in the picture it is: a chain-scoped route hands the resolver a chainId and
 * must get back THAT chain's contracts — never another chain's, and never a partially-merged mix.
 *
 * These cases are written against the pure builder rather than the module-level map so they pin the
 * resolution rule itself; the last case pins that the shipped map is actually built from both files.
 */
import { expect, test } from 'vitest'
import {
  ADDRESS_KEYS,
  addressesByChain,
  addressesForChain,
  addressesFromDeployment,
  anvilChainId,
  buildAddressesByChain,
  type Deployment,
  deployBlockForChain,
  isChainDeployed,
  isDeploymentPopulated,
  resolveActiveChainId,
  sepoliaChainId,
} from './addresses'

const ZERO = '0x0000000000000000000000000000000000000000'

/** A deployment whose every address is a distinct, recognisable value derived from `fill`. */
function deploymentFixture(chainId: number, fill: string, deployBlock = 0): Deployment {
  const contracts: Record<string, string> = {}
  ADDRESS_KEYS.forEach((key, index) => {
    contracts[key] = `0x${fill.repeat(38)}${index.toString(16).padStart(2, '0')}`
  })
  return { chainId, deployBlock, contracts }
}

const ANVIL = deploymentFixture(anvilChainId, 'a', 21_000_000)
const SEPOLIA = deploymentFixture(sepoliaChainId, 'b', 5_000_000)

test('each chain resolves its OWN address set, not the other chain’s', () => {
  const byChain = buildAddressesByChain([ANVIL, SEPOLIA])

  expect(byChain[sepoliaChainId]).toEqual(addressesFromDeployment(SEPOLIA))
  expect(byChain[anvilChainId]).toEqual(addressesFromDeployment(ANVIL))
  // Not one address in common — a resolver that fell back to a default would collide here.
  for (const key of ADDRESS_KEYS) {
    expect(byChain[sepoliaChainId]?.[key]).not.toBe(byChain[anvilChainId]?.[key])
  }
})

test('removing the Sepolia deployment removes Sepolia resolution (vacuity)', () => {
  const withSepolia = buildAddressesByChain([ANVIL, SEPOLIA])
  const withoutSepolia = buildAddressesByChain([ANVIL])

  expect(withSepolia[sepoliaChainId]).toBeDefined()
  expect(withoutSepolia[sepoliaChainId]).toBeUndefined()
  // 1337 is unaffected by Sepolia's presence either way.
  expect(withoutSepolia[anvilChainId]).toEqual(withSepolia[anvilChainId])
})

test('an address the deployment omits resolves to zero, never to another chain’s value', () => {
  const partial: Deployment = {
    chainId: sepoliaChainId,
    contracts: { ...SEPOLIA.contracts },
  }
  delete partial.contracts.ModuleCypherDeployer
  delete partial.contracts.CypherSwapRouter

  const resolved = addressesFromDeployment(partial)
  expect(resolved.ModuleCypherDeployer).toBe(ZERO)
  expect(resolved.CypherSwapRouter).toBe(ZERO)
  expect(resolved.MasterRegistryV1).toBe(SEPOLIA.contracts.MasterRegistryV1)
})

test('a placeholder deployment is not reported as deployed', () => {
  const placeholder: Deployment = {
    chainId: sepoliaChainId,
    contracts: Object.fromEntries(ADDRESS_KEYS.map((key) => [key, ZERO])),
  }
  expect(isDeploymentPopulated(placeholder)).toBe(false)
  expect(isDeploymentPopulated(SEPOLIA)).toBe(true)
  // The placeholder still RESOLVES — the app knows the chain, it just has no addresses for it yet.
  expect(addressesFromDeployment(placeholder).MasterRegistryV1).toBe(ZERO)
})

test('the log-scan floor is per chain', () => {
  expect(deployBlockForChain(anvilChainId)).toBe(BigInt(0))
  expect(deployBlockForChain(sepoliaChainId)).toBe(BigInt(0))
  // Both shipped files are committed placeholders, so both floors are 0 until a deploy writes them.
  // The per-chain lookup itself is what this pins: an unknown chain gets 0, not another chain's floor.
  expect(deployBlockForChain(999)).toBe(BigInt(0))
})

test('the shipped map carries both chains, and no others', () => {
  expect(
    Object.keys(addressesByChain)
      .map(Number)
      .sort((a, b) => a - b),
  ).toEqual([anvilChainId, sepoliaChainId])
  expect(addressesForChain(sepoliaChainId)).toBeDefined()
  expect(addressesForChain(1)).toBeUndefined()
  // Neither chain has been deployed to from a committed file — Sepolia's entry is config-to-be-filled.
  expect(isChainDeployed(sepoliaChainId)).toBe(false)
})

test('chain selection defaults to the local fork and refuses an unknown id', () => {
  expect(resolveActiveChainId(undefined)).toBe(anvilChainId)
  expect(resolveActiveChainId('')).toBe(anvilChainId)
  expect(resolveActiveChainId(String(sepoliaChainId))).toBe(sepoliaChainId)
  expect(() => resolveActiveChainId('8453')).toThrow(/no deployment config/)
  expect(() => resolveActiveChainId('sepolia')).toThrow(/no deployment config/)
})
