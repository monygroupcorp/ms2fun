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
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

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

  // Capture the block BEFORE any deploy tx — our contracts' events all land after this, so it's the
  // log-scan floor the frontend uses instead of `fromBlock: 0n` (ADR-0010 Tier 1B). No anvil_setCode
  // above mines a block, so this is still the fork block.
  const publicClient = createPublicClient({ chain: anvilFork, transport: http(RPC) })
  const deployBlock = await publicClient.getBlockNumber()
  console.log(`✓ deploy-block floor: ${deployBlock}`)

  // 2. Deploy via forge (Solidity owns the deploy).
  console.log('\n▶ forge script DeployAnvil.s.sol --broadcast')
  execSync(
    `forge script script/DeployAnvil.s.sol --rpc-url ${RPC} --broadcast --slow --chain-id ${CHAIN_ID} --code-size-limit 30000`,
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
    `forge script script/SeedAnvil.s.sol --rpc-url ${RPC} --broadcast --slow --chain-id ${CHAIN_ID} --code-size-limit 30000`,
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

  // 3b. Hand the platform REGISTRIES to the testing wallet (ADMIN) so it can drive /admin. They're
  //     Solady-Ownable with the 2-STEP handover (direct transferOwnership reverts UseRequest…), and
  //     the incoming owner must initiate — so we anvil-impersonate ADMIN to requestOwnershipHandover,
  //     then the deployer completes it. (Instances were handed over directly in the seed; ADMIN is
  //     already funded there for gas.) Per-registry try/catch so one odd registry can't fail deploy.
  const ADMIN = '0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86' as const
  const handoverAbi = [
    {
      type: 'function',
      name: 'requestOwnershipHandover',
      inputs: [],
      outputs: [],
      stateMutability: 'payable',
    },
    {
      type: 'function',
      name: 'completeOwnershipHandover',
      inputs: [{ name: 'pendingOwner', type: 'address' }],
      outputs: [],
      stateMutability: 'payable',
    },
  ] as const
  const deployerWallet = createWalletClient({
    account: privateKeyToAccount(ANVIL_DEPLOYER_KEY),
    chain: anvilFork,
    transport: http(RPC),
  })
  const adminWallet = createWalletClient({ account: ADMIN, chain: anvilFork, transport: http(RPC) })
  for (const name of [
    'MasterRegistry',
    'AlignmentRegistry',
    'ComponentRegistry',
    'FeaturedQueueManager',
    'AlignmentTargetRequestRegistry',
  ]) {
    const addr = c[name]
    if (!addr) continue
    try {
      await test.impersonateAccount({ address: ADMIN })
      await adminWallet.writeContract({
        address: addr,
        abi: handoverAbi,
        functionName: 'requestOwnershipHandover',
      })
      await test.mine({ blocks: 1 })
      await test.stopImpersonatingAccount({ address: ADMIN })
      await deployerWallet.writeContract({
        address: addr,
        abi: handoverAbi,
        functionName: 'completeOwnershipHandover',
        args: [ADMIN],
      })
      await test.mine({ blocks: 1 })
    } catch (err) {
      console.warn(
        `⚠ ownership handover skipped for ${name}: ${(err as Error).message.split('\n')[0]}`,
      )
    }
  }
  console.log(
    `✓ Handed platform registries to ADMIN (${ADMIN}) — /admin operable as the testing wallet`,
  )

  // 3c. Graduate the seeded `carved-demo` 404 WITH a nonzero creator carve. The seed creates it
  //     with declaredMaxAllowanceBps=10000 and a >=3 ETH reserve, but cannot graduate in-script
  //     (openTime is strictly-future at seed time and vm.warp is a no-op under --broadcast). The
  //     +2h advance above crossed its open/maturity, so the now-ADMIN-owned instance graduates
  //     here with deployLiquidity(10000) — full allowance requested, clamped live by the factory
  //     brackets + pool floor — standing up a real Uni-V4 pool with the carve actually paid.
  //     Non-fatal: a missing/already-graduated instance must not fail the deploy.
  try {
    const erc404Factory = f['ERC404']
    if (!erc404Factory) throw new Error('anvil.json missing factories.ERC404')
    const instanceAbi = [
      {
        type: 'function',
        name: 'name',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'string' }],
      },
      {
        type: 'function',
        name: 'graduated',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bool' }],
      },
      {
        type: 'function',
        name: 'previewCarve',
        stateMutability: 'view',
        inputs: [{ name: 'carveRequestBps', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'deployLiquidity',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'carveRequestBps', type: 'uint256' }],
        outputs: [],
      },
    ] as const
    // keccak256("InstanceCreated(address,address,address,string,string)") — instance is topic[1].
    const INSTANCE_CREATED = '0xef385e577da1427cc970a482e2560d72afabebdae40f0b84044f73fe332117cb'
    const logs = await publicClient.getLogs({ address: erc404Factory, fromBlock: deployBlock })
    let carved: Address | undefined
    for (const log of logs) {
      if (log.topics[0] !== INSTANCE_CREATED || !log.topics[1]) continue
      const candidate = `0x${log.topics[1].slice(26)}` as Address
      const name = await publicClient
        .readContract({ address: candidate, abi: instanceAbi, functionName: 'name' })
        .catch(() => '')
      if (name === 'carved-demo') {
        carved = candidate
        break
      }
    }
    if (!carved) throw new Error('seeded carved-demo instance not found in factory logs')
    const already = await publicClient.readContract({
      address: carved,
      abi: instanceAbi,
      functionName: 'graduated',
    })
    if (!already) {
      const carveEth = await publicClient.readContract({
        address: carved,
        abi: instanceAbi,
        functionName: 'previewCarve',
        args: [10_000n],
      })
      await test.impersonateAccount({ address: ADMIN })
      const hash = await adminWallet.writeContract({
        address: carved,
        abi: instanceAbi,
        functionName: 'deployLiquidity',
        args: [10_000n],
        gas: 9_000_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      await test.stopImpersonatingAccount({ address: ADMIN })
      console.log(
        `✓ Graduated carved-demo (${carved}) WITH carve ${carveEth} wei — Uni-V4 pool live`,
      )
    } else {
      console.log(`✓ carved-demo (${carved}) already graduated`)
    }
  } catch (err) {
    console.warn(`⚠ carved-demo graduation skipped: ${(err as Error).message.split('\n')[0]}`)
  }

  const required = (record: Record<string, Address>, key: string): Address => {
    const value = record[key]
    if (!value) throw new Error(`anvil.json missing expected address: ${key}`)
    return value
  }

  // 4. Write the slim config the frontend consumes (src/lib/addresses.ts).
  const config = {
    generatedAt: new Date().toISOString(),
    chainId: deployed.chainId,
    // Log-scan floor (ADR-0010): frontend reads events from here, never block 0.
    deployBlock: Number(deployBlock),
    deployer: deployed.deployer,
    contracts: {
      MasterRegistryV1: required(c, 'MasterRegistry'),
      AlignmentRegistryV1: required(c, 'AlignmentRegistry'),
      GlobalMessageRegistry: required(c, 'GlobalMessageRegistry'),
      FeaturedQueueManager: required(c, 'FeaturedQueueManager'),
      ProtocolTreasuryV1: required(c, 'ProtocolTreasury'),
      QueryAggregator: required(c, 'QueryAggregator'),
      ERC404Factory: required(f, 'ERC404'),
      // Refundable creator deploy-bond escrow (N12) — the wizard reads bondAmount() off it.
      DeployBondEscrow: required(c, 'DeployBondEscrow'),
      ERC1155Factory: required(f, 'ERC1155'),
      ERC721AuctionFactory: required(f, 'ERC721'),
      ComponentRegistry: required(c, 'ComponentRegistry'),
      ProfileRegistry: required(c, 'ProfileRegistry'),
      AlignmentTargetRequestRegistry: required(c, 'AlignmentTargetRequestRegistry'),
      // Metadata-resolution stack singletons (ADR-0006/0007) — the wizard lists them live via
      // ComponentRegistry, but surfacing the addresses here lets e2e/tests reach them directly.
      MetadataResolverRouter: required(c, 'MetadataResolverRouter'),
      MetadataOverlayModule: required(c, 'MetadataOverlayModule'),
      TierRevealModule: required(c, 'TierRevealModule'),
      // Graduated-swap (B19): the zRouter singleton drives the embedded post-graduation swaps, and
      // the per-family LP deployer modules identify a graduated instance's venue + carry its pool
      // params (Uni-V4 poolFee/tickSpacing, ZAMM feeOrHook).
      zRouter: required(c, 'zRouter'),
      ModuleUniV4Deployer: required(c, 'ModuleUniV4Deployer'),
      ModuleZAMMDeployer: required(c, 'ModuleZAMMDeployer'),
      ModuleCypherDeployer: required(c, 'ModuleCypherDeployer'),
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
