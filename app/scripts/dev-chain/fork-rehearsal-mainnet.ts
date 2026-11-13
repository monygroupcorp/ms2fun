/**
 * The mainnet fork rehearsal (`docs/MAINNET-DEPLOY-RUNBOOK.md` §3), as one command.
 *
 * It starts its own anvil fork of mainnet and runs, against it, the scripts the launch-day broadcast
 * runs, in the launch-day order:
 *
 *   1. `DeployMainnet`, from the vanity deployer the salt set is bound to (not `DeployAnvil`);
 *   2. `DeployTimelock`, administered by the mainnet Safe at the 24h mainnet delay;
 *   3. `MigrateOwnership` phase 1 AS THE TIMELOCK: the Safe proposes the `requestOwnershipHandover()`
 *      batch, the delay is crossed, and the open executor role executes it;
 *   4. `MigrateOwnership` phase 2 as the deployer, then `verify()`;
 *   5. an independent ownership sweep over every contract the deploy created;
 *   6. the alignment tithe switched on through the same governed path (ruled live at launch, see the
 *      `DeployMainnet` header), unless `--no-tithe`;
 *   7. `ForkRehearsalCollections`: one ERC-1155 created, minted once and withdrawn; one ERC-404
 *      bought out and graduated, with the liquidity module's residual (A-C5) measured;
 *
 * and writes the record to `contracts/deployments/fork-rehearsal-<date>/`. Any failed step exits
 * non-zero, and so does any registry whose owner is not the Timelock.
 *
 * WHAT DIFFERS FROM THE LIVE BROADCAST, stated rather than implied:
 *
 *   - NOTHING IS SIGNED. The fork runs `--auto-impersonate`; the deployer, the Safe and the collection
 *     wallets are impersonated and funded with `anvil_setBalance`, and forge sends `--unlocked`. No
 *     key is read, and the fork is a local process: nothing here can reach mainnet.
 *   - THE SAFE IS NOT SIGNED THROUGH. The Safe is impersonated as the Timelock's proposer, so its own
 *     signing flow is not exercised; the Timelock's propose / delay / execute path is.
 *   - THE DELAY IS WARPED. The 24h Timelock delay is crossed with `evm_increaseTime`, as is the
 *     minute before the bonding curve opens.
 *   - ADDRESSES BELOW THE SIX REGISTRIES ARE FORK-EPHEMERAL, as on the Sepolia rehearsal.
 *
 * WHAT IS THE SAME, on purpose: the fork keeps chain id 1, and the code-size limit is mainnet's. The
 * dev channels raise it to 30000; a rehearsal that did would pass a contract mainnet refuses.
 *
 * Nothing in the working tree outside the record directory is left changed. `DeployMainnet` writes
 * `contracts/deployments/mainnet.json`, the live record's path, so the run refuses to start if that
 * file exists and moves what it writes into the record directory, stamped as a rehearsal. Forge's
 * broadcast logs go to an ignored cache directory, not `contracts/broadcast/`, where the live run's
 * logs will land.
 *
 * Run (from `app/`; reads MAINNET_RPC_URL from the environment or the repo-root .env, never prints it):
 *
 *   pnpm chain:rehearse:mainnet [--port 8547] [--fork-block <n>] [--no-tithe] [--overwrite] [--keep-fork]
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')

const LIVE_RECORD = resolve(contractsDir, 'deployments/mainnet.json')
const BROADCAST_DIR = resolve(contractsDir, 'cache/fork-rehearsal-broadcast')

/** The neutral wallets the collection half runs as. Derived, not keyed: the fork impersonates them. */
const CREATOR = labelAddress('fork-rehearsal.creator')
const BUYER = labelAddress('fork-rehearsal.buyer')
/** Executes the Timelock's ready operations. The executor role is open, so anyone can. */
const EXECUTOR = labelAddress('fork-rehearsal.executor')

/** The launch-day funding the runbook names (§3): the 30 gwei case with margin. */
const DEPLOYER_FUNDING = parseEther('4.3')

/** ERC-1967's implementation slot: where a UUPS proxy keeps the address it delegates to. */
const IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex

/** ERC-7821 single-batch execution mode, the one Solady's Timelock proposes and executes. */
const BATCH_MODE = `0x01${'00'.repeat(31)}` as Hex

const timelockAbi = parseAbi([
  'function propose(bytes32 mode, bytes executionData, uint256 delay) returns (bytes32 id)',
  'function execute(bytes32 mode, bytes executionData) payable',
  'function minDelay() view returns (uint256)',
])
const ownableAbi = parseAbi([
  'function owner() view returns (address)',
  'function ownershipHandoverExpiresAt(address) view returns (uint256)',
])

function labelAddress(label: string): Address {
  return `0x${keccak256(toHex(label)).slice(-40)}` as Address
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

const port = Number(option('port') ?? 8547)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error(`--port ${port} is not a port`)
const rpcUrl = `http://127.0.0.1:${port}`
const forkBlock = option('fork-block')
const titheOn = !flag('no-tithe')
const keepFork = flag('keep-fork')
const date = new Date().toISOString().slice(0, 10)
const recordDir = resolve(contractsDir, `deployments/fork-rehearsal-${date}`)

const chain = defineChain({
  id: 1,
  name: 'Mainnet Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const testClient = createTestClient({ mode: 'anvil', chain, transport: http(rpcUrl) })
const walletClient = createWalletClient({ chain, transport: http(rpcUrl) })

/**
 * Every forge child: storage caching off (the fork reports chain id 1, so a cached read would answer
 * from mainnet rather than the fork), broadcast logs out of `broadcast/`, and the Timelock delay at
 * the mainnet default whatever the calling shell exported.
 */
const forgeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  FOUNDRY_NO_STORAGE_CACHING: 'true',
  FOUNDRY_BROADCAST: BROADCAST_DIR,
}
// Set rather than deleted: forge loads `contracts/.env` itself, and an unset variable there would be
// filled back in. The rehearsal asserts the deployed Timelock carries it.
const MAINNET_TIMELOCK_DELAY = 86_400n
forgeEnv.TIMELOCK_MIN_DELAY = MAINNET_TIMELOCK_DELAY.toString()

// ───────────────────────────── helpers ─────────────────────────────

function solidityLiteral(path: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(readFileSync(resolve(contractsDir, path), 'utf8'))
  if (!match?.[1]) throw new Error(`could not read ${what} out of contracts/${path}`)
  return match[1]
}

function forge(args: string[], env: NodeJS.ProcessEnv = forgeEnv): void {
  console.log(`\n▶ forge ${args.slice(0, 4).join(' ')}`)
  execFileSync('forge', args, { cwd: contractsDir, stdio: 'inherit', env })
}

/** `forge script <path> --broadcast` from one impersonated sender. */
function broadcast(script: string, sender: Address, extra: string[] = [], env = forgeEnv): void {
  forge(
    [
      'script',
      script,
      ...extra,
      '--rpc-url',
      rpcUrl,
      '--broadcast',
      '--slow',
      '--unlocked',
      '--sender',
      sender,
    ],
    env,
  )
}

interface BroadcastLog {
  transactions: {
    transactionType: string
    contractName?: string
    contractAddress?: string
    additionalContracts?: { address: string }[]
  }[]
  receipts: { gasUsed: string; transactionHash: string; contractAddress?: string | null }[]
}

/** The run log forge wrote for one script: `run-latest.json`, or `<fn>-latest.json` under `--sig`. */
function broadcastLog(script: string, sig?: string): BroadcastLog {
  const dir = resolve(BROADCAST_DIR, script, '1')
  const named = sig ? resolve(dir, `${sig.replace(/\(.*$/, '')}-latest.json`) : undefined
  const path = named && existsSync(named) ? named : resolve(dir, 'run-latest.json')
  return JSON.parse(readFileSync(path, 'utf8')) as BroadcastLog
}

const gasLedger: { step: string; txs: number; gas: bigint }[] = []
function ledger(step: string, log: BroadcastLog): void {
  const gas = log.receipts.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n)
  gasLedger.push({ step, txs: log.receipts.length, gas })
  console.log(`  ⛽ ${step}: ${log.receipts.length} tx, ${gas} gas`)
}

async function send(step: string, from: Address, to: Address, data: Hex): Promise<void> {
  const hash = await walletClient.sendTransaction({ account: from, to, data, chain })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${step}: transaction ${hash} reverted`)
  gasLedger.push({ step, txs: 1, gas: receipt.gasUsed })
  console.log(`  ⛽ ${step}: 1 tx, ${receipt.gasUsed} gas`)
}

/** Propose a batch as the Safe, cross the Timelock's delay, execute it from the open executor role. */
async function governed(
  step: string,
  safe: Address,
  timelock: Address,
  calls: { to: Address; data: Hex }[],
) {
  const executionData = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [calls.map((c) => ({ to: c.to, value: 0n, data: c.data }))],
  )
  const delay = await publicClient.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: 'minDelay',
  })
  await send(
    `${step}: Safe proposes`,
    safe,
    timelock,
    encodeFunctionData({
      abi: timelockAbi,
      functionName: 'propose',
      args: [BATCH_MODE, executionData, delay],
    }),
  )
  await testClient.increaseTime({ seconds: Number(delay) + 1 })
  await testClient.mine({ blocks: 1 })
  console.log(`  [FORK ONLY] crossed the ${delay}s Timelock delay with evm_increaseTime`)
  await send(
    `${step}: Timelock executes`,
    EXECUTOR,
    timelock,
    encodeFunctionData({
      abi: timelockAbi,
      functionName: 'execute',
      args: [BATCH_MODE, executionData],
    }),
  )
}

function stamp(record: Record<string, unknown>, forkBlockNumber: bigint): Record<string, unknown> {
  return {
    forkRehearsal: {
      channel: 'mainnet-fork',
      forkBlock: forkBlockNumber.toString(),
      stampedAt: new Date().toISOString(),
      note: 'Written against a local mainnet FORK. Every address below the six registries is fork-ephemeral and does not exist on mainnet.',
    },
    ...record,
  }
}

function startAnvil(rpc: string): ChildProcess {
  const args = [
    '--fork-url',
    rpc,
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    '--auto-impersonate',
    '--silent',
  ]
  if (forkBlock) args.push('--fork-block-number', forkBlock)
  const child = spawn('anvil', args, { stdio: ['ignore', 'ignore', 'ignore'], detached: keepFork })
  if (keepFork) child.unref()
  return child
}

async function waitForRpc(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await publicClient.getChainId()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`anvil did not answer on ${rpcUrl}`)
}

async function portIsFree(): Promise<boolean> {
  try {
    await publicClient.getChainId()
    return false
  } catch {
    return true
  }
}

// ───────────────────────────── the rehearsal ─────────────────────────────

/** `MigrateOwnership`'s inputs, read off the deploy record. The script's own table is the source. */
function migrationEnv(record: DeployRecord, timelock: Address): NodeJS.ProcessEnv {
  const c = record.contracts
  const f = record.factories
  const env: Record<string, string> = {
    TIMELOCK_ADDRESS: timelock,
    PROTOCOL_TREASURY: c.ProtocolTreasury,
    FEATURED_QUEUE_MANAGER: c.FeaturedQueueManager,
    QUERY_AGGREGATOR: c.QueryAggregator,
    GLOBAL_MESSAGE_REGISTRY: c.GlobalMessageRegistry,
    COMPONENT_REGISTRY: c.ComponentRegistry,
    ALIGNMENT_REGISTRY: c.AlignmentRegistry,
    MASTER_REGISTRY: c.MasterRegistry,
    TARGET_REQUEST_REGISTRY: c.AlignmentTargetRequestRegistry,
    LAUNCH_MANAGER: c.LaunchManager,
    CURVE_PARAMS_COMPUTER: c.CurveParamsComputer,
    ERC404_FACTORY: f.ERC404,
    DEPLOY_BOND_ESCROW: c.DeployBondEscrow,
    ERC1155_FACTORY: f.ERC1155,
    ERC721_FACTORY: f.ERC721,
    DYNAMIC_PRICING_MODULE: c.DynamicPricingModule,
    MODULE_MERKLE_GATING: c.ModuleMerkleGating,
    MODULE_UNIV4_DEPLOYER: c.ModuleUniV4Deployer,
    MODULE_ZAMM_DEPLOYER: c.ModuleZAMMDeployer,
    ERC404_STAKING_MODULE: c.ERC404StakingModule,
    METADATA_RESOLVER_ROUTER: c.MetadataResolverRouter,
    METADATA_OVERLAY_MODULE: c.MetadataOverlayModule,
    TOKEN_TIER_BAND_RESOLVER: c.TokenTierBandResolver,
    UNI_VAULT_FACTORY: f.UNI,
    AAVE_VAULT_FACTORY: f.AAVE,
    ZAMM_VAULT_FACTORY: f.ZAMM,
    UNI_TITHE_HOOK_FACTORY: c.UniTitheHookFactory,
    // ZROUTER is left unset: mainnet reuses the canonical router, which the deployer does not own.
  }
  const out: NodeJS.ProcessEnv = { ...forgeEnv }
  for (const [k, v] of Object.entries(env)) if (v && BigInt(v) !== 0n) out[k] = v
  delete out.ZROUTER
  return out
}

interface DeployRecord {
  chainId: number
  deployer: Address
  contracts: Record<string, Address>
  factories: Record<string, Address>
  vaults: { address: Address; type: string }[]
}

/** The six CREATE3 registries, by the record's names. */
const REGISTRIES = [
  'MasterRegistry',
  'ProtocolTreasury',
  'FeaturedQueueManager',
  'GlobalMessageRegistry',
  'AlignmentRegistry',
  'ComponentRegistry',
] as const

async function ownerOf(address: Address): Promise<Address | undefined> {
  try {
    return await publicClient.readContract({ address, abi: ownableAbi, functionName: 'owner' })
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  if (existsSync(LIVE_RECORD)) {
    throw new Error(
      `${relative(repoRoot, LIVE_RECORD)} exists. It is the live record's path, and DeployMainnet would overwrite it; refusing.`,
    )
  }
  if (existsSync(recordDir) && !flag('overwrite')) {
    throw new Error(`${relative(repoRoot, recordDir)} exists; pass --overwrite to replace it`)
  }

  if (!process.env.MAINNET_RPC_URL && existsSync(resolve(repoRoot, '.env'))) {
    for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split('\n')) {
      const m = /^\s*MAINNET_RPC_URL\s*=\s*"?([^"\s]+)"?\s*$/.exec(line)
      if (m) process.env.MAINNET_RPC_URL = m[1]
    }
  }
  const upstream = process.env.MAINNET_RPC_URL
  if (!upstream)
    throw new Error('MAINNET_RPC_URL not set (export it or add it to the repo-root .env)')
  if (!(await portIsFree()))
    throw new Error(`something already answers on ${rpcUrl}; pick another --port`)

  const deployer = solidityLiteral(
    'script/SepoliaSalts.sol',
    /address internal constant DEPLOYER = (0x[0-9a-fA-F]{40});/,
    'the deployer',
  ) as Address
  const safe = solidityLiteral(
    'script/DeployMainnet.s.sol',
    /cfg\.safe = (0x[0-9a-fA-F]{40});/,
    'the governance Safe',
  ) as Address
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  const dirty =
    execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim() !==
    ''

  console.log('🌐 starting anvil: mainnet fork, chain id 1, mainnet code-size limit')
  const anvil = startAnvil(upstream)
  const stop = () => {
    if (!keepFork) anvil.kill('SIGTERM')
  }
  process.on('exit', stop)
  process.on('SIGINT', () => process.exit(130))

  let deployRecord: DeployRecord | undefined
  let forkBlockNumber = 0n
  const startedAt = new Date().toISOString()
  try {
    await waitForRpc()
    const chainId = await publicClient.getChainId()
    if (chainId !== 1) throw new Error(`the fork reports chain ${chainId}, expected 1`)
    forkBlockNumber = await publicClient.getBlockNumber()
    const baseFee = (await publicClient.getBlock()).baseFeePerGas ?? 0n

    console.log('══════════════════════════════════════════════════════════')
    console.log('MAINNET FORK REHEARSAL')
    console.log(
      `  fork       : ${rpcUrl} at block ${forkBlockNumber}, base fee ${formatEther(baseFee, 'gwei')} gwei`,
    )
    console.log(`  commit     : ${commit}${dirty ? ' (working tree dirty)' : ''}`)
    console.log(`  deployer   : ${deployer} (impersonated)`)
    console.log(`  safe       : ${safe} (impersonated as the Timelock's proposer)`)
    console.log(
      `  tithe      : ${titheOn ? 'switched on through governance before the graduation' : 'left off'}`,
    )
    console.log('══════════════════════════════════════════════════════════')

    // ── Preflight, as launch day's (Sepolia §3): nonce 0, the salt set unspent ──
    const nonce = await publicClient.getTransactionCount({ address: deployer })
    if (nonce !== 0) throw new Error(`the deployer's mainnet nonce is ${nonce}, not 0`)
    const saltSource = readFileSync(resolve(contractsDir, 'script/SepoliaSalts.sol'), 'utf8')
    const registryAddrs = [...saltSource.matchAll(/=> (0x[0-9a-fA-F]{40})/g)].map(
      (m) => m[1] as Address,
    )
    for (const a of registryAddrs) {
      if (((await publicClient.getCode({ address: a })) ?? '0x') !== '0x') {
        throw new Error(`${a} already holds code on mainnet; the salt set is spent`)
      }
    }
    console.log(`✓ preflight: deployer nonce 0, ${registryAddrs.length} registry addresses empty`)

    await testClient.setBalance({ address: deployer, value: DEPLOYER_FUNDING })
    for (const a of [safe, CREATOR, BUYER, EXECUTOR])
      await testClient.setBalance({ address: a, value: parseEther('20') })
    console.log(
      `✓ funded the deployer with ${formatEther(DEPLOYER_FUNDING)} ETH (the runbook's launch funding)`,
    )

    // ── 1. DeployMainnet ──
    try {
      broadcast('script/DeployMainnet.s.sol', deployer)
    } finally {
      if (existsSync(LIVE_RECORD)) {
        mkdirSync(recordDir, { recursive: true })
        const raw = JSON.parse(readFileSync(LIVE_RECORD, 'utf8')) as Record<string, unknown>
        writeFileSync(
          resolve(recordDir, 'mainnet.json'),
          `${JSON.stringify(stamp(raw, forkBlockNumber), null, 2)}\n`,
        )
        rmSync(LIVE_RECORD)
        console.log(
          `✓ moved the deploy record to ${relative(repoRoot, recordDir)}/mainnet.json, stamped`,
        )
      }
    }
    ledger('DeployMainnet', broadcastLog('DeployMainnet.s.sol'))
    deployRecord = JSON.parse(
      readFileSync(resolve(recordDir, 'mainnet.json'), 'utf8'),
    ) as DeployRecord
    const record = deployRecord

    // ── 2. DeployTimelock ──
    broadcast('script/DeployTimelock.s.sol', deployer, [], { ...forgeEnv, SAFE_ADDRESS: safe })
    const timelockLog = broadcastLog('DeployTimelock.s.sol')
    ledger('DeployTimelock', timelockLog)
    const timelock = timelockLog.receipts.find((r) => r.contractAddress)?.contractAddress as
      | Address
      | undefined
    if (!timelock) throw new Error('DeployTimelock created no contract')
    const delay = await publicClient.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: 'minDelay',
    })
    if (delay !== MAINNET_TIMELOCK_DELAY)
      throw new Error(
        `the Timelock's delay is ${delay}s, not the mainnet ${MAINNET_TIMELOCK_DELAY}s`,
      )
    console.log(`✓ Timelock at ${timelock}, delay ${delay}s`)

    // ── 3. Phase 1, as the Timelock ──
    const safeOwnable = [
      record.contracts.ProtocolTreasury,
      record.contracts.FeaturedQueueManager,
      record.contracts.QueryAggregator,
      record.contracts.GlobalMessageRegistry,
      record.contracts.ComponentRegistry,
      record.contracts.AlignmentRegistry,
      record.contracts.MasterRegistry,
    ]
    await governed(
      'MigrateOwnership phase 1',
      safe,
      timelock,
      safeOwnable.map((to) => ({
        to,
        data: encodeFunctionData({
          abi: parseAbi(['function requestOwnershipHandover()']),
          functionName: 'requestOwnershipHandover',
        }),
      })),
    )
    for (const a of safeOwnable) {
      const expires = await publicClient.readContract({
        address: a,
        abi: ownableAbi,
        functionName: 'ownershipHandoverExpiresAt',
        args: [timelock],
      })
      if (expires === 0n) throw new Error(`phase 1: no handover request from the Timelock on ${a}`)
    }
    console.log(
      `✓ phase 1: the Timelock holds a handover request on all ${safeOwnable.length} SafeOwnableUUPS contracts`,
    )

    // ── 4. Phase 2 as the deployer, then verify() ──
    const migrate = migrationEnv(record, timelock)
    broadcast('script/MigrateOwnership.s.sol', deployer, [], migrate)
    ledger('MigrateOwnership phase 2', broadcastLog('MigrateOwnership.s.sol'))
    forge(
      ['script', 'script/MigrateOwnership.s.sol', '--sig', 'verify()', '--rpc-url', rpcUrl],
      migrate,
    )

    // ── 5. The ownership sweep ──
    //
    // verify() asserts the contracts it was told about. This asks every contract the deploy created,
    // which is how a contract the record leaves out is caught.
    const created = new Set<Address>()
    // CREATE transactions and the contracts created inside any transaction; a CALL's
    // `contractAddress` is its target, which the deploy did not create.
    for (const t of broadcastLog('DeployMainnet.s.sol').transactions) {
      if (t.transactionType.startsWith('CREATE') && t.contractAddress)
        created.add(t.contractAddress as Address)
      for (const c of t.additionalContracts ?? []) created.add(c.address as Address)
    }
    for (const a of Object.values(record.contracts)) if (BigInt(a) !== 0n) created.add(a)
    for (const a of Object.values(record.factories)) if (BigInt(a) !== 0n) created.add(a)
    const registryOwners: Record<string, Address | undefined> = {}
    for (const name of REGISTRIES) registryOwners[name] = await ownerOf(record.contracts[name])
    // The UUPS implementations behind the proxies are MigrateOwnership's stated exclusion: their
    // owner powers are unreachable (`upgradeToAndCall` is `onlyProxy`) and they hold no state.
    const implementations = new Set<string>()
    for (const a of created) {
      const slot = await publicClient.getStorageAt({ address: a, slot: IMPLEMENTATION_SLOT })
      if (slot && BigInt(slot) !== 0n) implementations.add(`0x${slot.slice(-40)}`.toLowerCase())
    }
    const stillDeployer: Address[] = []
    for (const a of created) {
      if (implementations.has(a.toLowerCase())) continue
      if ((await ownerOf(a))?.toLowerCase() === deployer.toLowerCase()) stillDeployer.push(a)
    }
    const badRegistries = REGISTRIES.filter(
      (n) => registryOwners[n]?.toLowerCase() !== timelock.toLowerCase(),
    )
    if (badRegistries.length > 0)
      throw new Error(`registry owner is not the Timelock: ${badRegistries.join(', ')}`)
    console.log(`✓ all ${REGISTRIES.length} registries are owned by the Timelock`)
    if (stillDeployer.length > 0) {
      console.error(
        `✗ ${stillDeployer.length} contract(s) the deploy created are still owned by the deployer:`,
      )
      for (const a of stillDeployer) console.error(`    ${a}`)
    } else {
      console.log(
        `✓ none of the ${created.size - implementations.size} contracts the deploy created (less ${implementations.size} proxy implementations) is still owned by the deployer`,
      )
    }

    // ── 6. The tithe, through governance ──
    if (titheOn) {
      await governed('alignment tithe on', safe, timelock, [
        {
          to: record.contracts.ModuleUniV4Deployer,
          data: encodeFunctionData({
            abi: parseAbi(['function setAlignmentHookFactory(address)']),
            functionName: 'setAlignmentHookFactory',
            args: [record.contracts.UniTitheHookFactory],
          }),
        },
      ])
      forge(
        ['script', 'script/EnableAlignmentTithe.s.sol', '--sig', 'verify()', '--rpc-url', rpcUrl],
        {
          ...forgeEnv,
          MODULE_UNIV4_DEPLOYER: record.contracts.ModuleUniV4Deployer,
          COMPONENT_REGISTRY: record.contracts.ComponentRegistry,
        },
      )
    }

    // ── 7. The collections ──
    const statePath = resolve(recordDir, 'collections.json')
    const collectionsEnv = {
      ...forgeEnv,
      REHEARSAL_RECORD: resolve(recordDir, 'mainnet.json'),
      REHEARSAL_STATE: statePath,
      REHEARSAL_CREATOR: CREATOR,
      REHEARSAL_BUYER: BUYER,
    }
    broadcast(
      'script/ForkRehearsalCollections.s.sol',
      CREATOR,
      ['--sig', 'create()'],
      collectionsEnv,
    )
    ledger('collections: create', broadcastLog('ForkRehearsalCollections.s.sol', 'create()'))
    await testClient.increaseTime({ seconds: 120 })
    await testClient.mine({ blocks: 1 })
    console.log('  [FORK ONLY] crossed the bonding open time with evm_increaseTime')
    // The graduation deploys the tithe hook at a CREATE2 salt mined from a block-derived offset, so
    // the gas it needs varies from block to block: forge's default limit (the simulated use x1.3),
    // taken one block early, has been seen to starve the hook's creation. 4x covers the scan.
    broadcast(
      'script/ForkRehearsalCollections.s.sol',
      CREATOR,
      ['--sig', 'exercise()', '--gas-estimate-multiplier', '400'],
      collectionsEnv,
    )
    ledger(
      'collections: mint, withdraw, buy out, graduate',
      broadcastLog('ForkRehearsalCollections.s.sol', 'exercise()'),
    )
    const collections = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    // The script's figures come from its own simulation. The residual is read back off the chain
    // after the broadcast too, and the two must agree.
    const module = record.contracts.ModuleUniV4Deployer
    const coin = collections.erc404 as Address
    const chainEth = await publicClient.getBalance({ address: module })
    const chainCoin = await publicClient.readContract({
      address: coin,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [module],
    })
    collections.moduleEthResidualOnChain = chainEth.toString()
    collections.moduleCoinResidualOnChain = chainCoin.toString()
    if (
      chainEth.toString() !== collections.moduleEthResidual ||
      chainCoin.toString() !== collections.moduleCoinResidual
    ) {
      throw new Error(
        `A-C5: the chain reads ${chainEth} wei / ${chainCoin} coin in the module, the simulation said otherwise`,
      )
    }
    console.log(
      `✓ A-C5 read back off the chain: the module holds ${chainEth} wei and ${chainCoin} coin`,
    )

    // ── The record ──
    const deployerSpent = DEPLOYER_FUNDING - (await publicClient.getBalance({ address: deployer }))
    const deployerSteps = ['DeployMainnet', 'DeployTimelock', 'MigrateOwnership phase 2']
    const deployerGas = gasLedger
      .filter((g) => deployerSteps.includes(g.step))
      .reduce((s, g) => s + g.gas, 0n)
    const deployerTxs = gasLedger
      .filter((g) => deployerSteps.includes(g.step))
      .reduce((s, g) => s + g.txs, 0)
    const rehearsal = {
      forkRehearsal: {
        channel: 'mainnet-fork',
        note: 'Fork only. Nothing here was broadcast to mainnet.',
      },
      startedAt,
      finishedAt: new Date().toISOString(),
      commit,
      workingTreeDirty: dirty,
      forkBlock: forkBlockNumber.toString(),
      forkBaseFeeWei: baseFee.toString(),
      deployer,
      safe,
      timelock,
      titheOn,
      registryOwners,
      contractsStillOwnedByDeployer: stillDeployer,
      gas: {
        steps: gasLedger.map((g) => ({ ...g, gas: g.gas.toString() })),
        deployer: {
          txs: deployerTxs,
          gas: deployerGas.toString(),
          spentAtForkBaseFeeWei: deployerSpent.toString(),
          at1GweiEth: formatEther(deployerGas * 10n ** 9n),
          at30GweiEth: formatEther(deployerGas * 30n * 10n ** 9n),
        },
        total: gasLedger.reduce((s, g) => s + g.gas, 0n).toString(),
      },
      collections,
    }
    writeFileSync(resolve(recordDir, 'rehearsal.json'), `${JSON.stringify(rehearsal, null, 2)}\n`)
    rmSync(statePath)
    console.log(`\n✓ record written to ${relative(repoRoot, recordDir)}/`)
    console.log(
      `  deployer: ${deployerTxs} tx, ${deployerGas} gas (${formatEther(deployerGas * 30n * 10n ** 9n)} ETH at 30 gwei)`,
    )

    if (stillDeployer.length > 0) {
      throw new Error(
        `${stillDeployer.length} contract(s) left owned by the deployer after the handover`,
      )
    }
    console.log('\nREHEARSAL GREEN')
  } finally {
    stop()
  }
}

main().then(
  () => {
    if (keepFork) console.log(`fork left running on ${rpcUrl} (--keep-fork); stop it with kill`)
  },
  (err: unknown) => {
    console.error(err instanceof Error ? `\n✗ ${err.message}` : err)
    if (keepFork) console.error(`fork left running on ${rpcUrl} (--keep-fork) for inspection`)
    process.exit(1)
  },
)
