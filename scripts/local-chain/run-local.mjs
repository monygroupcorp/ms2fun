#!/usr/bin/env node
// scripts/local-chain/run-local.mjs
// Main entrypoint for local chain seeding. Called by start-chain.sh.
// Usage: node scripts/local-chain/run-local.mjs [--scenario <name>]

import { deployContracts, MAINNET_ADDRESSES } from './deploy-contracts.mjs'
import { writeConfig } from './write-config.mjs'
import { TEST_ACCOUNTS } from './seed-common.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Validate required environment
// ─────────────────────────────────────────────────────────────────────────────

const USER_ADDRESS = process.env.USER_ADDRESS
if (!USER_ADDRESS) {
  console.error('❌ USER_ADDRESS environment variable is required')
  console.error('   Set it to your wallet address to interact with the local chain')
  console.error('   Example: USER_ADDRESS=0x... npm run chain:start')
  console.error('')
  console.error('   Add to .env:')
  console.error('     USER_ADDRESS=0xYourWalletAddressHere')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse --scenario argument
// ─────────────────────────────────────────────────────────────────────────────

const scenarioArg = process.argv.indexOf('--scenario')
const scenarioName = scenarioArg !== -1 ? process.argv[scenarioArg + 1] : 'default'

if (!scenarioName || scenarioName.startsWith('--')) {
  console.error('❌ --scenario requires a value (e.g. --scenario busy)')
  process.exit(1)
}

console.log(`\n🚀 Starting local chain deployment (scenario: ${scenarioName})`)
console.log(`   USER_ADDRESS: ${USER_ADDRESS}`)

// ─────────────────────────────────────────────────────────────────────────────
// Load scenario module
// ─────────────────────────────────────────────────────────────────────────────

let scenario
try {
  scenario = await import(`./scenarios/${scenarioName}.mjs`)
} catch (e) {
  console.error(`❌ Unknown scenario: "${scenarioName}"`)
  console.error('   Available: default, empty, busy, proposal')
  console.error(`   Error: ${e.message}`)
  process.exit(1)
}

if (typeof scenario.seed !== 'function') {
  console.error(`❌ Scenario "${scenarioName}" does not export a seed() function`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy contracts
// ─────────────────────────────────────────────────────────────────────────────

const { core, factories, vaults, provider, deployer } = await deployContracts()

// ─────────────────────────────────────────────────────────────────────────────
// Run scenario seed
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n════════════════════════════════════════════════════`)
console.log(`SEEDING: scenario=${scenarioName}`)
console.log(`════════════════════════════════════════════════════`)

const seedResult = await scenario.seed(
  { core, factories },
  provider,
  deployer,
  USER_ADDRESS,
  vaults
)

const { instances, userHoldings, messages } = seedResult

// ─────────────────────────────────────────────────────────────────────────────
// Build testAccounts map (address strings only, plus user)
// ─────────────────────────────────────────────────────────────────────────────

const testAccounts = {
  ...Object.fromEntries(
    Object.entries(TEST_ACCOUNTS).map(([k, v]) => [k, v.address])
  ),
  user: USER_ADDRESS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Write config
// ─────────────────────────────────────────────────────────────────────────────

await writeConfig({
  core,
  factories,
  vaults,
  instances,
  testAccounts,
  mainnetAddresses: MAINNET_ADDRESSES,
  userHoldings,
  scenario: scenarioName,
})

// ─────────────────────────────────────────────────────────────────────────────
// Success summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n✅ Local chain ready!')
console.log(`   Scenario:     ${scenarioName}`)
console.log(`   RPC:          http://127.0.0.1:8545`)
console.log(`   Chain ID:     1337`)
console.log(`   User address: ${USER_ADDRESS}`)
if (messages) {
  console.log(`   Messages seeded: ${messages.total ?? 0}`)
}
console.log(`   Vaults:       ${vaults.length}`)
if (instances) {
  const erc404Count = Array.isArray(instances.erc404) ? instances.erc404.length : 0
  const erc1155Count = Array.isArray(instances.erc1155) ? instances.erc1155.length : 0
  console.log(`   ERC404 instances:  ${erc404Count}`)
  console.log(`   ERC1155 instances: ${erc1155Count}`)
}
console.log('')
