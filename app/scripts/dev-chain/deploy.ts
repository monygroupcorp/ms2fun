/**
 * Dev-chain deploy bridge (viem).
 *
 * Replaces the legacy ethers-v5 loop (scripts/local-chain/{deploy-contracts,run-local,
 * write-config}.mjs). Assumes an anvil mainnet-fork is already running on :8545
 * (start it with `pnpm chain:fork`). It:
 *
 *   1. Clears EIP-7702 delegations from anvil's default accounts (a mainnet fork carries
 *      them; they make _safeMint and other deploys revert).
 *   2. Runs `forge script DeployAnvil.s.sol --broadcast` — Solidity owns the deploy.
 *   3. Reads the FRESH contracts/deployments/anvil.json. Addresses are NON-deterministic
 *      (DeployAnvil derives CreateX salts from block.timestamp), so we never trust a
 *      committed snapshot — we rewrite the frontend config every deploy.
 *   4. Writes the slim app/src/config/local-deployment.json the frontend consumes
 *      (see src/lib/addresses.ts): chainId + the 9 contracts the app reads today.
 *
 * Run: `pnpm chain:deploy` (tsx). No secrets needed here — forge talks to the local
 * anvil, not the mainnet RPC.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestClient, defineChain, http, type Address } from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')
const anvilJsonPath = resolve(contractsDir, 'deployments/anvil.json')
const configPath = resolve(appDir, 'src/config/local-deployment.json')

const RPC = 'http://127.0.0.1:8545'
const CHAIN_ID = 1337
// Anvil's well-known account #0 (public test key — safe to hardcode for a local fork).
const ANVIL_DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Anvil default accounts that may carry EIP-7702 delegations from the mainnet fork.
const ANVIL_ACCOUNTS: Address[] = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
]

const anvilFork = defineChain({
  id: CHAIN_ID,
  name: 'Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

/** The forge anvil.json shape (subset we read). */
interface AnvilDeployment {
  chainId: number
  deployer: Address
  contracts: Record<string, Address>
  factories: Record<string, Address>
}

async function main(): Promise<void> {
  // 1. Clear EIP-7702 delegations.
  const test = createTestClient({ mode: 'anvil', chain: anvilFork, transport: http(RPC) })
  try {
    for (const address of ANVIL_ACCOUNTS) {
      await test.setCode({ address, bytecode: '0x' })
    }
  } catch (err) {
    console.error(`\n✗ Cannot reach anvil at ${RPC}. Start it first: pnpm chain:fork`)
    throw err
  }
  console.log(`✓ Cleared EIP-7702 code from ${ANVIL_ACCOUNTS.length} anvil accounts`)

  // 2. Deploy via forge (Solidity owns the deploy).
  console.log('\n▶ forge script DeployAnvil.s.sol --broadcast')
  execSync(
    `forge script script/DeployAnvil.s.sol --rpc-url ${RPC} --broadcast --chain-id ${CHAIN_ID} --code-size-limit 30000`,
    {
      cwd: contractsDir,
      stdio: 'inherit',
      env: { ...process.env, PRIVATE_KEY: ANVIL_DEPLOYER_KEY },
    },
  )

  // 2b. Seed anvil-only sample data (collections + profiles) so discovery cards, images, and
  //     profile pages light up with real on-chain data. Backend-free (inline data: metadata).
  //     Anvil-only — never part of DeployCore / a production deploy.
  console.log('\n▶ forge script SeedAnvil.s.sol --broadcast')
  execSync(
    `forge script script/SeedAnvil.s.sol --rpc-url ${RPC} --broadcast --chain-id ${CHAIN_ID} --code-size-limit 30000`,
    {
      cwd: contractsDir,
      stdio: 'inherit',
      env: { ...process.env, PRIVATE_KEY: ANVIL_DEPLOYER_KEY },
    },
  )

  // 2c. Advance the anvil clock +2h. The seed creates time-relative states (auctions with a 1h
  //     duration, bonding open +1h, maturity +90m) but vm.warp is a no-op under --broadcast, so we
  //     advance the LIVE chain here instead. After this: gallery auctions are ended (settle-ready +
  //     no-bid), ember stays preopen, vapor is mid-curve, cinder is bonding + matured (graduate
  //     unlocked), live-salon (1-day) stays active. The UI is chain-anchored (useNowSec reads
  //     block.timestamp) so countdowns agree with the advanced chain.
  const TWO_HOURS = 2 * 60 * 60
  await test.increaseTime({ seconds: TWO_HOURS })
  await test.mine({ blocks: 1 })
  console.log(`✓ Advanced anvil clock +${TWO_HOURS}s so seeded auction/bonding states materialize`)

  // 3. Read the FRESH deployment output. Guard against a stale anvil.json from another chain.
  const deployed = JSON.parse(readFileSync(anvilJsonPath, 'utf8')) as AnvilDeployment
  if (deployed.chainId !== CHAIN_ID) {
    throw new Error(`anvil.json chainId ${deployed.chainId} != expected ${CHAIN_ID} (stale file?)`)
  }
  const c = deployed.contracts
  const f = deployed.factories

  const required = (record: Record<string, Address>, key: string): Address => {
    const value = record[key]
    if (!value) throw new Error(`anvil.json missing expected address: ${key}`)
    return value
  }

  // 4. Write the slim config the frontend consumes (src/lib/addresses.ts).
  const config = {
    generatedAt: new Date().toISOString(),
    chainId: deployed.chainId,
    deployer: deployed.deployer,
    contracts: {
      MasterRegistryV1: required(c, 'MasterRegistry'),
      AlignmentRegistryV1: required(c, 'AlignmentRegistry'),
      GlobalMessageRegistry: required(c, 'GlobalMessageRegistry'),
      FeaturedQueueManager: required(c, 'FeaturedQueueManager'),
      QueryAggregator: required(c, 'QueryAggregator'),
      ERC404Factory: required(f, 'ERC404'),
      ERC1155Factory: required(f, 'ERC1155'),
      ERC721AuctionFactory: required(f, 'ERC721'),
      ComponentRegistry: required(c, 'ComponentRegistry'),
      ProfileRegistry: required(c, 'ProfileRegistry'),
    },
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  console.log(`\n✓ Wrote ${configPath}`)
  console.log('  MasterRegistryV1:', config.contracts.MasterRegistryV1)
  console.log('\n✅ Dev chain ready. Addresses change every deploy — this file is regenerated, not')
  console.log('   committed. To keep it out of git noise:')
  console.log('   git update-index --skip-worktree app/src/config/local-deployment.json')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
