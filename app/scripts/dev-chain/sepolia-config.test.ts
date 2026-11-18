import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORK_STAMP_KEY, TARGETS, liveProjectionReasons, projectConfig } from './sepolia-config'

const here = dirname(fileURLToPath(import.meta.url))

/** A minimal record in the shape `DeploySepolia` writes, with every name the bridge requires. */
function forgeRecord(overrides: Record<string, unknown> = {}) {
  const address = (n: number) => `0x${String(n).padStart(2, '0').repeat(20)}`.slice(0, 42)
  return {
    chainId: 11155111,
    deployer: '0x000888695d3e361434f67D9dbd110f1A443822b9',
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
      CurationRegistry: address(21),
      AlignmentTargetRequestRegistry: address(10),
      MetadataResolverRouter: address(11),
      MetadataOverlayModule: address(12),
      TokenTierBandResolver: address(13),
      zRouter: address(14),
      ModuleUniV4Deployer: address(15),
      ModuleZAMMDeployer: address(16),
      AlignmentHookSwapRouter: address(22),
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

describe('the mainnet target', () => {
  const repoRoot = resolve(here, '..', '..', '..')
  const rehearsal = JSON.parse(
    readFileSync(
      resolve(repoRoot, 'contracts/deployments/fork-rehearsal-2026-11-13/mainnet.json'),
      'utf8',
    ),
  )

  it('reads and writes the mainnet record under chain 1', () => {
    expect(TARGETS.mainnet.chainId).toBe(1)
    expect(TARGETS.mainnet.record).toBe('contracts/deployments/mainnet.json')
    expect(TARGETS.mainnet.config).toBe('src/config/mainnet-deployment.json')
  })

  it('accepts a live-claiming chain-1 record only when chain 1 is expected', () => {
    const live = forgeRecord({ chainId: 1 })
    expect(liveProjectionReasons(live, 1)).toEqual([])
    expect(liveProjectionReasons(live)[0]).toContain('names chain 1')
  })

  it("refuses the fork rehearsal's record as a live one", () => {
    const reasons = liveProjectionReasons(rehearsal, 1)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain(FORK_STAMP_KEY)
  })

  it('projects every name the app reads out of what DeployMainnet writes', () => {
    const config = projectConfig(rehearsal, 0, 'fork-rehearsal-2026-11-13/mainnet.json')
    expect(config.chainId).toBe(1)
    expect(config.contracts.MasterRegistryV1).toBe(rehearsal.contracts.MasterRegistry)
    expect(config.contracts.ERC1155Factory).toBe(rehearsal.factories.ERC1155)
  })
})
