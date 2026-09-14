import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORK_STAMP_KEY, liveProjectionReasons, projectConfig } from './sepolia-config'

const here = dirname(fileURLToPath(import.meta.url))

/** A minimal record in the shape `DeploySepolia` writes, with every name the bridge requires. */
function forgeRecord(overrides: Record<string, unknown> = {}) {
  const address = (n: number) => `0x${String(n).padStart(2, '0').repeat(20)}`.slice(0, 42)
  return {
    chainId: 11155111,
    deployer: '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6',
    contracts: {
      MasterRegistry: address(1),
      AlignmentRegistry: address(2),
      GlobalMessageRegistry: address(3),
      FeaturedQueueManager: address(4),
      ProtocolTreasury: address(5),
      QueryAggregator: address(6),
      DeployBondEscrow: address(7),
      ComponentRegistry: address(8),
      ProfileRegistry: address(9),
      AlignmentTargetRequestRegistry: address(10),
      MetadataResolverRouter: address(11),
      MetadataOverlayModule: address(12),
      TokenTierBandResolver: address(13),
      zRouter: address(14),
      ModuleUniV4Deployer: address(15),
      ModuleZAMMDeployer: address(16),
      ModuleCypherDeployer: '0x0000000000000000000000000000000000000000',
      CypherSwapRouter: '0x0000000000000000000000000000000000000000',
    },
    factories: {
      ERC404: address(17),
      ERC1155: address(18),
      ERC721: address(19),
      AAVE: address(20),
    },
    ...overrides,
  }
}

describe('liveProjectionReasons', () => {
  it('accepts a record that claims to be a live Sepolia deploy', () => {
    expect(liveProjectionReasons(forgeRecord())).toEqual([])
  })

  it('refuses a record the fork channel stamped', () => {
    const stamped = forgeRecord({
      [FORK_STAMP_KEY]: { channel: 'sepolia-fork', rpc: 'http://127.0.0.1:8546' },
    })
    const reasons = liveProjectionReasons(stamped)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain(FORK_STAMP_KEY)
    expect(reasons[0]).toContain('--fork')
  })

  it('refuses another chain, and a shape that is not a record at all', () => {
    expect(liveProjectionReasons(forgeRecord({ chainId: 1337 }))[0]).toContain('names chain 1337')
    expect(liveProjectionReasons(null)).toHaveLength(1)
    expect(liveProjectionReasons('sepolia.json')).toHaveLength(1)
  })
})

describe('projectConfig', () => {
  it('projects every name the app config carries, and keeps the deploy block', () => {
    const config = projectConfig(forgeRecord(), 9_000_000, 'fixture')
    expect(config.chainId).toBe(11155111)
    expect(config.deployBlock).toBe(9_000_000)
    expect(config.contracts.MasterRegistryV1).toBe(forgeRecord().contracts.MasterRegistry)
    expect(config.contracts.ERC404Factory).toBe(forgeRecord().factories.ERC404)
  })

  it('names the missing address rather than writing a silent zero', () => {
    const record = forgeRecord()
    delete (record.contracts as Record<string, string>).QueryAggregator
    expect(() => projectConfig(record, 0, 'fixture')).toThrow(/QueryAggregator/)
  })

  it('covers every contract key the committed placeholder declares', () => {
    const placeholder = JSON.parse(
      readFileSync(resolve(here, '../../src/config/sepolia-deployment.json'), 'utf8'),
    ) as { contracts: Record<string, string> }
    const projected = projectConfig(forgeRecord(), 0, 'fixture')
    expect(Object.keys(projected.contracts).sort()).toEqual(
      Object.keys(placeholder.contracts).sort(),
    )
  })
})
