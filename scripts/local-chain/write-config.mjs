// scripts/local-chain/write-config.mjs
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const CONFIG_PATH = path.resolve(__dirname, '../../src/config/contracts.local.json')

/**
 * Write contracts.local.json with all deployed addresses and state.
 *
 * @param {object} params
 * @param {object} params.core - Core contract addresses
 * @param {string} params.core.masterRegistry
 * @param {string} params.core.globalMessageRegistry
 * @param {string} params.core.featuredQueueManager
 * @param {string} params.core.queryAggregator
 * @param {string} params.core.hookFactory
 * @param {object} params.factories - Factory addresses { erc1155, erc404 }
 * @param {string} params.factories.erc1155
 * @param {string} params.factories.erc404
 * @param {object[]} params.vaults - Array of vault info objects
 * @param {object} params.instances - Instance info { erc404: [], erc1155: [] }
 * @param {object} params.testAccounts - Test account addresses
 * @param {object} params.mainnetAddresses - Mainnet fork addresses (uniswap, tokens, etc.)
 * @param {object} params.userHoldings - Summary of what USER_ADDRESS holds
 * @param {string} [params.scenario] - Scenario name (e.g. "default")
 * @param {string} [params.grandCentral] - GrandCentral DAO address (optional, zero address if not deployed)
 * Note: a `messages` field (total global message count etc.) is intentionally NOT written here.
 * It is populated by the seeding scenario after seeding completes, then merged in via run-local.mjs.
 */
export async function writeConfig({
  core,
  factories,
  vaults,
  instances,
  testAccounts,
  mainnetAddresses,
  userHoldings,
  scenario,
  grandCentral,
}) {
  const config = {
    generatedAt: new Date().toISOString(),
    chainId: 1337,
    mode: 'local-fork',
    scenario: scenario ?? 'default',
    deployer: testAccounts.owner,
    contracts: {
      MasterRegistryV1: core.masterRegistry,
      GlobalMessageRegistry: core.globalMessageRegistry,
      FeaturedQueueManager: core.featuredQueueManager,
      QueryAggregator: core.queryAggregator,
      ERC404Factory: factories.erc404,
      ERC1155Factory: factories.erc1155,
      UltraAlignmentHookFactory: core.hookFactory,
      GrandCentral: grandCentral ?? '0x0000000000000000000000000000000000000000',
    },
    factories: [
      {
        address: factories.erc404,
        type: 'ERC404',
        title: 'ERC404-Bonding-Curve-Factory',
        displayTitle: 'ERC404 Bonding Curve',
        factoryId: 1,
        registered: true,
      },
      {
        address: factories.erc1155,
        type: 'ERC1155',
        title: 'ERC1155-Edition-Factory',
        displayTitle: 'ERC1155 Editions',
        factoryId: 2,
        registered: true,
      },
    ],
    vaults,
    instances,
    uniswap: {
      v4PoolManager: mainnetAddresses.uniswapV4PoolManager,
      v4PositionManager: mainnetAddresses.uniswapV4PositionManager,
      v4Quoter: mainnetAddresses.uniswapV4Quoter,
      v3Router: mainnetAddresses.uniswapV3Router,
      v3Factory: mainnetAddresses.uniswapV3Factory,
      v2Router: mainnetAddresses.uniswapV2Router,
      v2Factory: mainnetAddresses.uniswapV2Factory,
      weth: mainnetAddresses.weth,
    },
    tokens: {
      exec: mainnetAddresses.execToken,
    },
    testAccounts,
    userAddress: testAccounts.user ?? testAccounts.owner,
    governance: {
      dictator: testAccounts.owner,
      abdicationInitiated: false,
      mode: 'dictator',
    },
    userHoldings,
  }

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log(`   ✓ Configuration written to ${CONFIG_PATH}`)
  return config
}
