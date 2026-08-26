/**
 * Sepolia showcase seed orchestrator.
 *
 * The Sepolia analogue of `scripts/dev-chain/deploy.ts`, and it differs from it in exactly one
 * place, which is the whole reason it exists: THE CLOCK.
 *
 * The seed is two `forge script` runs with an arm window between them, because one script cannot
 * both arm a curve and buy into it (`setBondingOpenTime` rejects a non-future timestamp,
 * `buyBonding` reverts `TooEarly` before it, and forge simulates a whole script at one timestamp).
 * On the local chain, `deploy.ts` closes that gap by TELLING anvil to advance. A public testnet
 * cannot be told anything, so this orchestrator WAITS: it polls the chain's own block timestamp
 * until the instant phase 1 recorded as `phase2NotBefore` has actually arrived.
 *
 * Usage:
 *
 *   # Rehearsal against a local fork of Sepolia (no real transactions, ever):
 *   anvil --fork-url <sepolia-rpc> --port 8545
 *   pnpm exec tsx scripts/sepolia-seed/seed.ts --dry --sender <deployment-owner>
 *
 *   # The real thing. Interactive, prompts before every broadcast leg:
 *   pnpm exec tsx scripts/sepolia-seed/seed.ts --broadcast --rpc-url <sepolia-rpc> \
 *     --sender <deployment-owner> --account <keystore>
 *
 * `--broadcast` is never implied. Without it the run targets the local fork and the fork-only
 * affordances below are enabled; with it, nothing is fast-forwarded and every leg is confirmed by a
 * human first.
 *
 * SIGNING. This orchestrator holds no key material. It passes forge a `--sender` and either
 * `--account <keystore>` (the live run) or `--unlocked` (a fork rehearsal, where anvil impersonates).
 * The seed scripts themselves resolve their sender from `msg.sender`, so nothing here reads or logs a
 * private key.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createTestClient,
  defineChain,
  formatEther,
  http,
  type Address,
} from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')
const deploymentPath = resolve(contractsDir, 'deployments/sepolia.json')
const seedStatePath = resolve(contractsDir, 'deployments/sepolia-seed.json')
const venuePath = resolve(contractsDir, 'deployments/sepolia-venues.json')
const broadcastDir = resolve(contractsDir, 'broadcast')

const SEPOLIA_CHAIN_ID = 11155111
const LOCAL_FORK_RPC = 'http://127.0.0.1:8545'
/** How often the wall-clock wait re-reads the chain's head. */
const POLL_INTERVAL_MS = 15_000

interface Args {
  broadcast: boolean
  rpcUrl: string
  assumeYes: boolean
  /** The account that owns the deployment's registries. Required — the seed's writes are owner-only. */
  sender: Address
  /** Keystore account name for the live run. Absent in a rehearsal, where `--unlocked` signs instead. */
  account?: string
}

function parseArgs(argv: string[]): Args {
  const broadcast = argv.includes('--broadcast')
  const dry = argv.includes('--dry')
  if (broadcast && dry) throw new Error('--dry and --broadcast are mutually exclusive')
  const rpcIndex = argv.indexOf('--rpc-url')
  const rpcUrl = rpcIndex >= 0 ? argv[rpcIndex + 1] : LOCAL_FORK_RPC
  if (!rpcUrl) throw new Error('--rpc-url needs a value')
  if (broadcast && rpcUrl === LOCAL_FORK_RPC) {
    throw new Error(
      '--broadcast against the local fork URL is almost certainly a mistake; pass --rpc-url explicitly',
    )
  }
  const senderIndex = argv.indexOf('--sender')
  const sender = senderIndex >= 0 ? argv[senderIndex + 1] : process.env.SEPOLIA_SEED_SENDER
  if (!sender) {
    throw new Error('--sender <address> is required: the seed writes as the deployment owner')
  }
  const accountIndex = argv.indexOf('--account')
  const account = accountIndex >= 0 ? argv[accountIndex + 1] : undefined
  if (broadcast && !account) {
    throw new Error(
      '--account <keystore> is required for a live broadcast (no raw keys are accepted)',
    )
  }
  return {
    broadcast,
    rpcUrl,
    assumeYes: argv.includes('--yes'),
    sender: sender as Address,
    account,
  }
}

const args = parseArgs(process.argv.slice(2))

const sepolia = defineChain({
  id: SEPOLIA_CHAIN_ID,
  name: args.broadcast ? 'Sepolia' : 'Sepolia Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [args.rpcUrl] } },
})

const publicClient = createPublicClient({ chain: sepolia, transport: http(args.rpcUrl) })

async function confirm(question: string): Promise<void> {
  if (args.assumeYes) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [type "yes" to continue] `)
  rl.close()
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('✗ Aborted at the operator prompt. Nothing further was sent.')
    process.exit(1)
  }
}

function runForge(script: string, label: string): void {
  // Both legs broadcast; what differs is WHICH chain and who signs. On a rehearsal the target is a
  // local fork and `--unlocked` lets anvil impersonate the deployment owner, whose key nobody has.
  const signing = args.account ? `--account ${args.account}` : '--unlocked'
  console.log(`\n▶ forge script ${script}   (${label})`)
  execSync(
    `forge script script/${script} --rpc-url ${args.rpcUrl} --broadcast --slow ` +
      `--sender ${args.sender} ${signing} --chain-id ${SEPOLIA_CHAIN_ID} --code-size-limit 30000`,
    { cwd: contractsDir, stdio: 'inherit', env: { ...process.env } },
  )
}

/** ETH actually burned as gas by a script's most recent broadcast, read off forge's own receipts. */
function gasSpentEth(script: string): string {
  const runLatest = resolve(broadcastDir, script, String(SEPOLIA_CHAIN_ID), 'run-latest.json')
  if (!existsSync(runLatest)) return 'unknown (no broadcast receipts found)'
  const run = JSON.parse(readFileSync(runLatest, 'utf8')) as {
    receipts?: { gasUsed: string; effectiveGasPrice: string }[]
  }
  const total = (run.receipts ?? []).reduce(
    (acc, r) => acc + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? '0'),
    0n,
  )
  return `${formatEther(total)} ETH across ${(run.receipts ?? []).length} transactions`
}

/// The instant every seeded V3 reference pool can first answer a window-long TWAP, read from the
/// pools themselves.
///
/// Phase 1 records `referenceReadyAt` off its own SIMULATION clock — a forge script is simulated at
/// one timestamp and only then broadcast, so the pools are actually written a whole broadcast later
/// and the recorded instant under-states readiness by exactly that long. `phase2NotBefore`'s slack
/// is sized for block-time jitter, not for broadcast duration, so on a slow phase 1 the wait can end
/// before the pools can serve the window and phase 2 hits `OLD` inside the registry's own probe.
/// The pool's oldest observation plus the window is the instant, exactly; this reads it back.
async function referencePoolsReadyAt(pools: Address[], validator: Address): Promise<number> {
  const window = await publicClient.readContract({
    address: validator,
    abi: [
      {
        type: 'function',
        name: 'twapSecondsAgo',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint32' }],
      },
    ] as const,
    functionName: 'twapSecondsAgo',
  })
  const poolAbi = [
    {
      type: 'function',
      name: 'slot0',
      stateMutability: 'view',
      inputs: [],
      outputs: [
        { type: 'uint160' },
        { type: 'int24' },
        { type: 'uint16' },
        { type: 'uint16' },
        { type: 'uint16' },
        { type: 'uint8' },
        { type: 'bool' },
      ],
    },
    {
      type: 'function',
      name: 'observations',
      stateMutability: 'view',
      inputs: [{ type: 'uint256' }],
      outputs: [{ type: 'uint32' }, { type: 'int56' }, { type: 'uint160' }, { type: 'bool' }],
    },
  ] as const

  let readyAt = 0
  for (const pool of pools) {
    const slot0 = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
    const index = Number(slot0[2])
    const cardinality = Number(slot0[3])
    let obs = await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'observations',
      args: [BigInt((index + 1) % cardinality)],
    })
    // The ring has not wrapped yet — the oldest observation is still slot 0.
    if (!obs[3])
      obs = await publicClient.readContract({
        address: pool,
        abi: poolAbi,
        functionName: 'observations',
        args: [0n],
      })
    const poolReady = Number(obs[0]) + Number(window)
    if (poolReady > readyAt) readyAt = poolReady
  }
  return readyAt
}

async function waitForPhaseTwo(
  notBefore: number,
  referenceReadyAt: number,
  pools: Address[],
  validator: Address,
): Promise<void> {
  // WHY THE WAIT CAN BE LONGER THAN THE ARM WINDOW. Phase 1 creates the pools whose TWAP is the
  // price authority for every alignment vault's -5% floor, and phase 2 PINS them. The registry
  // refuses to pin a pool that cannot yet answer a window-long TWAP, so a whole TWAP window has to
  // pass between the two phases — and a public testnet cannot be told to advance. Phase 1 folds that
  // instant into the same `phase2NotBefore` the arm window already produces, so there is one wait
  // rather than two, and only one number anyone has to know about.
  //
  // The pools are then asked directly, and the LATER of the two instants is what is waited out: the
  // number phase 1 recorded is a lower bound (see `referencePoolsReadyAt`), and pinning is judged
  // against what the pools hold rather than against what phase 1 predicted.
  if (pools.length > 0) {
    const measured = await referencePoolsReadyAt(pools, validator)
    if (measured > notBefore) {
      console.log(
        `\n  the seeded reference pools can serve a TWAP from unix ${measured}` +
          ` (${new Date(measured * 1000).toISOString()}), later than the recorded` +
          ` ${notBefore} — phase 1's broadcast ran past the instant it was able to record.` +
          `\n  waiting for the pools rather than for the record.`,
      )
      notBefore = measured
    } else if (referenceReadyAt > 0) {
      console.log(
        `\n  reference pools can serve a TWAP from unix ${measured}` +
          ` (${new Date(measured * 1000).toISOString()})` +
          `\n  phase 2 pins them, so this instant is folded into the wait below.`,
      )
    }
  }
  const head = await publicClient.getBlock()
  if (Number(head.timestamp) >= notBefore) {
    console.log('✓ The arm window had already elapsed.')
    return
  }

  if (!args.broadcast) {
    // FORK-ONLY AFFORDANCE, and it is stated as one. A local fork can be told to advance; the real
    // testnet cannot, which is the entire reason the branch below exists. A rehearsal that skipped
    // the wait by warping and then claimed the wall-clock path works would be testing the wrong
    // thing — so the wait is what runs in `--broadcast`, and only the rehearsal warps.
    const advance = notBefore - Number(head.timestamp) + 60
    const test = createTestClient({ mode: 'anvil', chain: sepolia, transport: http(args.rpcUrl) })
    await test.increaseTime({ seconds: advance })
    await test.mine({ blocks: 1 })
    console.log(
      `✓ [FORK ONLY] Advanced the forked chain +${advance}s in place of the wall-clock wait`,
    )
    return
  }

  const waitSeconds = notBefore - Number(head.timestamp)
  console.log(
    `\n⏳ Waiting out the arm window: ~${Math.ceil(waitSeconds / 60)} minutes of REAL time.` +
      `\n   Phase 2 becomes legal at unix ${notBefore} (${new Date(notBefore * 1000).toISOString()}).` +
      `\n   This polls the chain rather than the local clock, so it agrees with what the buys are judged against.`,
  )
  for (;;) {
    const block = await publicClient.getBlock()
    const remaining = notBefore - Number(block.timestamp)
    if (remaining <= 0) break
    console.log(
      `   … ${remaining}s remaining (chain head ${block.number}, timestamp ${block.timestamp})`,
    )
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  console.log('✓ The arm window has elapsed on-chain.')
}

async function main(): Promise<void> {
  // ── Preflight ──
  if (!existsSync(deploymentPath)) {
    throw new Error(`No deployment file at ${deploymentPath} — run DeploySepolia first.`)
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
    chainId: number
    deployer: Address
    contracts: Record<string, Address>
    factories: Record<string, Address>
  }
  if (deployment.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`sepolia.json chainId ${deployment.chainId} != ${SEPOLIA_CHAIN_ID}`)
  }
  for (const key of ['ModuleUniV4Deployer', 'MasterRegistry', 'AlignmentRegistry']) {
    if (!deployment.contracts[key]) {
      throw new Error(
        `sepolia.json is missing ${key} — it predates the current DeployCore output. Redeploy first.`,
      )
    }
  }

  const chainId = await publicClient.getChainId()
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC at ${args.rpcUrl} reports chain ${chainId}, expected ${SEPOLIA_CHAIN_ID}`)
  }

  if (deployment.deployer && deployment.deployer.toLowerCase() !== args.sender.toLowerCase()) {
    console.warn(
      `⚠ --sender ${args.sender} is not the address that deployed this file (${deployment.deployer}).` +
        '\n  The seed performs owner-only writes; if this sender does not own the registries it will revert.',
    )
  }

  console.log('══════════════════════════════════════════════════════════')
  console.log(
    args.broadcast
      ? 'SEPOLIA SHOWCASE SEED — LIVE BROADCAST'
      : 'SEPOLIA SHOWCASE SEED — FORK REHEARSAL',
  )
  console.log(`  rpc            : ${args.rpcUrl}`)
  console.log(
    `  sender         : ${args.sender}${args.account ? ` (keystore ${args.account})` : ' (unlocked)'}`,
  )
  console.log(`  deployment     : ${deploymentPath}`)
  console.log(
    `  arm window     : ${process.env.SEPOLIA_ARM_WINDOW_SECONDS ?? '1200 (default)'} seconds`,
  )
  console.log('  phase 1        : create + arm + stand the venues up  (spends the venue depth budget)')
  console.log(
    '  phase 2        : pin the reference pools, buy, graduate, convert on every venue' +
      '  (prints its own ETH projection before spending)',
  )
  if (existsSync(venuePath)) {
    const venues = JSON.parse(readFileSync(venuePath, 'utf8')) as {
      chainId: number
      zammVaultFactory: Address
      cypherVaultFactory: Address
    }
    if (venues.chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`sepolia-venues.json chainId ${venues.chainId} != ${SEPOLIA_CHAIN_ID}`)
    }
    console.log(`  zamm family    : ${venues.zammVaultFactory}`)
    console.log(`  cypher family  : ${venues.cypherVaultFactory}`)
  } else {
    console.warn(
      `⚠ No ${venuePath} — the ZAMM and Cypher legs will be reported unavailable and skipped.` +
        '\n  It is written by DeploySepolia; redeploy if this deployment predates it.',
    )
  }
  console.log('══════════════════════════════════════════════════════════')

  if (args.broadcast) {
    console.log('\n⚠ This spends REAL Sepolia ETH from the sender forge is configured with.')
    console.log("  Read each phase's printed ETH projection before confirming it.")
  }

  // ── Phase 1 ──
  await confirm('Run PHASE 1 (create + arm)?')
  runForge('SeedSepolia.s.sol', 'phase 1: create + arm')
  console.log(`✓ phase 1 gas: ${gasSpentEth('SeedSepolia.s.sol')}`)

  // ── The wait ──
  const seedState = JSON.parse(readFileSync(seedStatePath, 'utf8')) as {
    chainId: number
    phase2NotBefore: number
    referenceReadyAt?: number
    ms2ReferencePool?: Address
    cultReferencePool?: Address
    ms2ZammVault?: Address
    cultCypherVault?: Address
    cypher404?: Address
    instances: Record<string, Address>
  }
  if (seedState.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `sepolia-seed.json chainId ${seedState.chainId} != ${SEPOLIA_CHAIN_ID} (stale hand-off?)`,
    )
  }
  console.log('\nArmed rows:')
  for (const [slug, address] of Object.entries(seedState.instances))
    console.log(`  ${slug.padEnd(20)} ${address}`)

  console.log('\nVenues phase 1 stood up:')
  console.log(`  uniswap v4     : seeded (both alignment targets)`)
  console.log(`  zamm           : ${seedState.ms2ZammVault ?? '(not available on this deployment)'}`)
  console.log(`  cypher/algebra : ${seedState.cultCypherVault ?? '(rail not wired on this deployment)'}`)

  const referencePools = [seedState.ms2ReferencePool, seedState.cultReferencePool].filter(
    (p): p is Address => !!p && p !== '0x0000000000000000000000000000000000000000',
  )
  await waitForPhaseTwo(
    seedState.phase2NotBefore,
    seedState.referenceReadyAt ?? 0,
    referencePools,
    deployment.contracts.UniswapVaultPriceValidator,
  )

  // ── Phase 2 ──
  await confirm('Run PHASE 2 (buys + graduation)? This one spends ETH on the curves.')
  runForge('SeedSepoliaBuys.s.sol', 'phase 2: buys + graduation')
  console.log(`✓ phase 2 gas: ${gasSpentEth('SeedSepoliaBuys.s.sol')}`)

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('SEED COMPLETE')
  console.log(`  phase 1 gas : ${gasSpentEth('SeedSepolia.s.sol')}`)
  console.log(`  phase 2 gas : ${gasSpentEth('SeedSepoliaBuys.s.sol')}`)
  console.log('  curve ETH   : printed by phase 2 above (projection + measured spend)')
  console.log(`  state file  : ${seedStatePath}`)
  console.log('══════════════════════════════════════════════════════════')

  // A missing broadcast directory here means the receipts above were read from an older run.
  if (!existsSync(broadcastDir) || readdirSync(broadcastDir).length === 0) {
    console.warn('⚠ No broadcast receipts directory — gas totals above are not from this run.')
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
