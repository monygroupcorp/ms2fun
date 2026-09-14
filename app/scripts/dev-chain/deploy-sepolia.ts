/**
 * Sepolia-fork channel: the deploy orchestrator.
 *
 * The mainnet channel's `deploy.ts` runs the ANVIL deploy path (`DeployAnvil` + `SeedAnvil`). This
 * one runs, against a Sepolia fork on :8546, exactly what the real Sepolia broadcast will run and in
 * the same order:
 *
 *   1. the Algebra Integral standup (`scripts/sepolia-algebra/`) — Sepolia carries no Algebra
 *      deployment, so the Cypher rail is stood up from mainnet bytecode before anything reads it;
 *   2. `DeploySepolia`, with the standup's three periphery addresses supplied through the
 *      `SEPOLIA_CYPHER_*` environment overlay the script already reads, and the zRouter self-deployed;
 *   3. the two-phase showcase seed (`scripts/sepolia-seed/seed.ts`), unchanged.
 *
 * NOTHING HERE IS REWRITTEN — this file only sequences tools that already exist and are the same
 * tools the live run uses. That is the point: what the fork shows is what the testnet will hold.
 *
 * WHAT DIFFERS FROM THE LIVE BROADCAST, stated rather than implied:
 *
 *   - THE WAIT IS WARPED. Between the seed's two phases the live run waits out a real arm window
 *     (and the reference pools' TWAP window) on the wall clock. On a fork the orchestrator advances
 *     the chain instead — `seed.ts` does that itself on its non-`--broadcast` branch and prints
 *     `[FORK ONLY]` when it does. Everything else in both phases is genuinely executed.
 *   - THE DEPLOYER IS IMPERSONATED. `DeploySepolia.run()` requires `msg.sender` to be the address the
 *     CreateX salt set is bound to; nobody holds that key. The fork runs with `--auto-impersonate`,
 *     this script funds the address with `anvil_setBalance`, and forge signs `--unlocked`.
 *   - THE SALT SET IS CLEARED FIRST. A CreateX CREATE3 salt is consumed by the deploy that used it,
 *     so once this set has been spent on live Sepolia a fork at latest would revert
 *     `CreateCollision`. IT IS NOT SPENT YET — verified 2026-09-04 against live Sepolia: none of the
 *     six CREATE2 proxies, nor the six addresses they produce, holds code. So this step currently
 *     clears six empty accounts and becomes load-bearing only after the first live deploy; do not
 *     read it passing as evidence that a live deploy has happened. The six proxies (and the
 *     addresses they produce) are re-derived from `script/SepoliaSalts.sol` rather than restated, so
 *     a wrong constant fails loudly instead of clearing the wrong accounts.
 *   - ADDRESSES ARE FORK-EPHEMERAL. Everything below the salt set comes out of a fresh nonce
 *     sequence on the fork and will differ on the real network. Every artifact this run writes is
 *     STAMPED as a rehearsal (see `stampForkArtifact`), because a fork record and a live one are
 *     otherwise identical in shape, chain id and path.
 *
 * Run (from `app/`, with the channel up — `pnpm chain:fork:sepolia`):
 *
 *   pnpm chain:deploy:sepolia [--skip-algebra] [--rpc-url <url>]
 *
 * `--skip-algebra` reuses the newest standup record for this chain instead of standing Algebra up
 * again, which is what you want when re-deploying against a fork that already carries one.
 *
 * Writes `src/config/local-deployment.sepolia.json` — the channel's own app config artifact. It does
 * NOT touch `src/config/local-deployment.json` (the mainnet channel's) or
 * `src/config/sepolia-deployment.json` (the committed placeholder for the real network).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createTestClient,
  defineChain,
  encodePacked,
  getContractAddress,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')
const saltsPath = resolve(contractsDir, 'script/SepoliaSalts.sol')
const deploySepoliaPath = resolve(contractsDir, 'script/DeploySepolia.s.sol')
const algebraArtifactDir = resolve(appDir, 'scripts/sepolia-algebra/artifacts')

const CHAIN_ID = 11155111
const DEFAULT_RPC = 'http://127.0.0.1:8546'
const APP_CONFIG_REL = 'src/config/local-deployment.sepolia.json'

/**
 * CreateX and its CREATE2 proxy's init-code hash — the two fixed inputs of the CREATE3 derivation
 * documented in `script/SepoliaSalts.sol`. Both are checked implicitly: if either were wrong the
 * derived addresses would not match the ones the salt set documents, and the run stops there.
 */
const CREATEX = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed' as const
const CREATEX_PROXY_INITCODE_HASH =
  '0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f' as const

/**
 * Anvil's well-known account #0. It funds the Algebra standup only — a public test key for a local
 * fork, and it is NOT the protocol deployer (that address is impersonated, see above).
 */
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ANVIL_KEY_ENV = 'DEV_CHAIN_ANVIL_KEY'

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const rpcUrl = option('rpc-url') ?? DEFAULT_RPC

const sepoliaFork = defineChain({
  id: CHAIN_ID,
  name: 'Sepolia Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const publicClient = createPublicClient({ chain: sepoliaFork, transport: http(rpcUrl) })
const testClient = createTestClient({ mode: 'anvil', chain: sepoliaFork, transport: http(rpcUrl) })

/**
 * Every `forge` child runs with the fork state cache OFF.
 *
 * forge caches forked accounts and storage per chain id, and this fork reports 11155111 — so a
 * cached read would answer from the real Sepolia rather than from the fork, and the salt-set
 * clearing below would be invisible to it. The seed's own forge runs inherit this too.
 */
const forgeEnv = { ...process.env, FOUNDRY_NO_STORAGE_CACHING: 'true' }

function run(command: string, args: string[], cwd: string, env = process.env): void {
  execFileSync(command, args, { cwd, stdio: 'inherit', env })
}

/** One `<name> = 0x…` literal out of a Solidity source file. Reading beats duplicating. */
function solidityLiteral(source: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(source)
  if (!match?.[1]) throw new Error(`could not read ${what} out of the contracts tree`)
  return match[1]
}

interface SaltEntry {
  name: string
  salt: Hex
  /** The address the salt set documents for this salt — re-derived below, never trusted. */
  documented: Address
}

/** Read the salt set from its single source of truth rather than restating it here. */
function readSaltSet(): { deployer: Address; salts: SaltEntry[] } {
  const source = readFileSync(saltsPath, 'utf8')
  const deployer = solidityLiteral(
    source,
    /address internal constant DEPLOYER = (0x[0-9a-fA-F]{40});/,
    'the Sepolia deployer address',
  ) as Address
  const salts: SaltEntry[] = []
  const saltPattern =
    /bytes32 internal constant (\w+) = (0x[0-9a-fA-F]{64});\s*\/\/ => (0x[0-9a-fA-F]{40})/g
  for (const match of source.matchAll(saltPattern)) {
    salts.push({ name: match[1], salt: match[2] as Hex, documented: match[3] as Address })
  }
  if (salts.length === 0) throw new Error(`no salts found in ${saltsPath}`)
  return { deployer, salts }
}

/**
 * The CREATE2 proxy a CreateX CREATE3 salt deploys, and the address that proxy's first CREATE
 * produces. Both carry code after a deploy, and both must be clear for the salt to be reusable.
 */
function create3Addresses(deployer: Address, salt: Hex): { proxy: Address; deployed: Address } {
  const guardedSalt = keccak256(encodePacked(['uint256', 'bytes32'], [BigInt(deployer), salt]))
  const proxy = getContractAddress({
    opcode: 'CREATE2',
    from: CREATEX,
    salt: guardedSalt,
    bytecodeHash: CREATEX_PROXY_INITCODE_HASH,
  })
  return { proxy, deployed: getContractAddress({ from: proxy, nonce: 1n }) }
}

/** Clear code and nonce at one address on the fork, so a spent CREATE3 salt is reusable. */
async function clearAccount(address: Address): Promise<void> {
  await testClient.setCode({ address, bytecode: '0x' })
  await testClient.setNonce({ address, nonce: 0 })
}

/**
 * The deployment artifacts this channel produces, at the paths the LIVE broadcast writes too.
 * `DeploySepolia` writes the first two; the seed's phase 1 writes the third.
 */
const FORK_ARTIFACTS = [
  'deployments/sepolia.json',
  'deployments/sepolia-venues.json',
  'deployments/sepolia-seed.json',
] as const

/**
 * Mark one artifact as this channel's output.
 *
 * A fork record and a live record are written by the same scripts, to the same path, and both carry
 * chain id 11155111 — the fork keeps Sepolia's id on purpose, so the app and the wallet behave
 * exactly as they will on the real network. Nothing in the file itself therefore says which network
 * it describes, and the one bridge that turns such a record into the config the LIVE SITE ships
 * (`sepolia-config.ts`) would otherwise have no way to tell them apart.
 *
 * So the run that knows says so. The stamp is written after each producing step rather than once at
 * the end, so a run that fails partway still leaves its artifacts marked.
 */
function stampForkArtifact(relPath: string): void {
  const path = resolve(contractsDir, relPath)
  if (!existsSync(path)) return
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  record.forkRehearsal = {
    channel: 'sepolia-fork',
    rpc: rpcUrl,
    stampedAt: new Date().toISOString(),
    note: 'Written against a local Sepolia FORK. These addresses do not exist on public Sepolia.',
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
}

/** Stamp every artifact that exists, after a step that may have written some of them. */
function stampForkArtifacts(): void {
  for (const rel of FORK_ARTIFACTS) stampForkArtifact(rel)
  console.log("✓ Stamped this run's deployment artifacts as a fork rehearsal")
}

interface AlgebraRecord {
  chainId: number
  contracts: { role: string; address: Address }[]
  deviations: string[]
}

/** The newest Algebra standup record written for this chain. */
function newestAlgebraRecord(): AlgebraRecord {
  const dir = resolve(algebraArtifactDir, 'deployments')
  if (!existsSync(dir)) throw new Error(`no Algebra standup records under ${dir}`)
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith(`${CHAIN_ID}-`) && name.endsWith('.json'))
    .sort()
  const newest = candidates.at(-1)
  if (!newest) throw new Error(`no Algebra standup record for chain ${CHAIN_ID} under ${dir}`)
  return JSON.parse(readFileSync(resolve(dir, newest), 'utf8')) as AlgebraRecord
}

function algebraAddress(record: AlgebraRecord, role: string): Address {
  const hit = record.contracts.find((c) => c.role === role)
  if (!hit) throw new Error(`Algebra standup record carries no ${role}`)
  return hit.address
}

async function main(): Promise<void> {
  // ── Preflight ──
  let chainId: number
  try {
    chainId = await publicClient.getChainId()
  } catch (err) {
    console.error(`\n✗ Cannot reach the channel at ${rpcUrl}. Start it: pnpm chain:fork:sepolia`)
    throw err
  }
  if (chainId !== CHAIN_ID) {
    throw new Error(
      `${rpcUrl} reports chain ${chainId}, expected ${CHAIN_ID}.` +
        ' The Sepolia channel keeps the forked chain id — do not pass --chain-id to anvil.',
    )
  }
  const { deployer, salts } = readSaltSet()
  const wnative = solidityLiteral(
    readFileSync(deploySepoliaPath, 'utf8'),
    /cfg\.weth = (0x[0-9a-fA-F]{40});/,
    "the network's wrapped-native token",
  ) as Address

  console.log('══════════════════════════════════════════════════════════')
  console.log('SEPOLIA-FORK CHANNEL — DEPLOY')
  console.log(`  rpc        : ${rpcUrl} (chain ${chainId})`)
  console.log(`  deployer   : ${deployer} (impersonated; no key exists for it)`)
  console.log(`  wnative    : ${wnative}`)
  console.log('  the mainnet channel on :8545 is not touched by this run')
  console.log('══════════════════════════════════════════════════════════')

  // ── Fund the impersonated deployer ──
  await testClient.setBalance({ address: deployer, value: parseEther('10000') })
  console.log(`✓ Funded the deployer on the fork`)

  // ── 1. Algebra Integral standup (the Cypher rail) ──
  if (flag('skip-algebra')) {
    console.log('\n▶ Algebra standup skipped (--skip-algebra) — reusing the newest record')
  } else {
    if (!existsSync(resolve(algebraArtifactDir, 'resolved.json'))) {
      console.log('\n▶ sepolia-algebra/fetch.ts   (pull the mainnet set — gitignored artifacts)')
      run('pnpm', ['exec', 'tsx', 'scripts/sepolia-algebra/fetch.ts'], appDir)
    } else {
      console.log('\n▶ Algebra artifacts already fetched — reusing them')
    }
    console.log('\n▶ sepolia-algebra/deploy.ts   (ten contracts + the fee regime)')
    run(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/sepolia-algebra/deploy.ts',
        '--rpc',
        rpcUrl,
        '--wnative',
        wnative,
        '--private-key-env',
        ANVIL_KEY_ENV,
      ],
      appDir,
      { ...process.env, [ANVIL_KEY_ENV]: ANVIL_KEY },
    )
  }
  const algebra = newestAlgebraRecord()
  const cypher = {
    positionManager: algebraAddress(algebra, 'positionManager'),
    router: algebraAddress(algebra, 'swapRouter'),
    factory: algebraAddress(algebra, 'algebraFactory'),
  }
  console.log(`✓ Cypher rail: factory ${cypher.factory}`)
  if (algebra.deviations.length > 0) {
    for (const d of algebra.deviations) console.log(`  ⚠ standup deviation: ${d}`)
  }

  // ── 2. Clear the spent CREATE3 salt set ──
  //
  // Re-derive rather than restate: each salt must reproduce the address `SepoliaSalts.sol`
  // documents, so a wrong CreateX constant or a wrong derivation fails here instead of producing a
  // confident clearing of the wrong accounts.
  for (const entry of salts) {
    const { proxy, deployed } = create3Addresses(deployer, entry.salt)
    if (deployed.toLowerCase() !== entry.documented.toLowerCase()) {
      throw new Error(
        `${entry.name}: derived ${deployed} but the salt set documents ${entry.documented}`,
      )
    }
    await clearAccount(proxy)
    await clearAccount(deployed)
  }
  console.log(
    `✓ Cleared ${salts.length} CREATE3 salts on the fork (proxy + address).` +
      ' The live set is NOT spent — this clears empty accounts until the first live deploy.',
  )

  // ── 3. DeploySepolia ──
  //
  // The log-scan floor (ADR-0010 Tier 1B): read before the first protocol transaction, so the app
  // never scans the fork from genesis.
  const deployBlock = await publicClient.getBlockNumber()
  console.log(`✓ deploy-block floor: ${deployBlock}`)

  console.log('\n▶ forge script DeploySepolia.s.sol --broadcast   (self-deployed zRouter)')
  run(
    'forge',
    [
      'script',
      'script/DeploySepolia.s.sol',
      '--rpc-url',
      rpcUrl,
      '--broadcast',
      '--slow',
      '--unlocked',
      '--sender',
      deployer,
      '--code-size-limit',
      '30000',
    ],
    contractsDir,
    {
      ...forgeEnv,
      SEPOLIA_CYPHER_POSITION_MANAGER: cypher.positionManager,
      SEPOLIA_CYPHER_ROUTER: cypher.router,
      SEPOLIA_CYPHER_ALGEBRA_FACTORY: cypher.factory,
    },
  )
  stampForkArtifacts()

  // ── 4. The showcase seed, both phases ──
  //
  // Run without `--broadcast`, which is what puts the orchestrator on its fork branch: the arm
  // window and the reference pools' TWAP window are crossed with `evm_increaseTime` instead of
  // waited out. `seed.ts` prints `[FORK ONLY]` at the moment it does that. Everything else — the
  // creates, the arms, the venue standup, the buys, the graduations, the conversions — is executed.
  console.log('\n▶ sepolia-seed/seed.ts   (phase 1 → warped wait → phase 2)')
  console.log('   the live run waits this window out on the wall clock; here it is warped.')
  run(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/sepolia-seed/seed.ts',
      '--yes',
      '--sender',
      deployer,
      '--rpc-url',
      rpcUrl,
    ],
    appDir,
    forgeEnv,
  )
  stampForkArtifacts()

  // ── 5. The channel's app config artifact ──
  //
  // The same bridge the live deploy uses, pointed at the channel's own output file. It is a separate
  // artifact on purpose: `local-deployment.json` belongs to the mainnet channel and
  // `sepolia-deployment.json` is the committed placeholder for the real network.
  //
  // `--fork` is what lets the bridge accept the stamped record written above: it says the caller
  // means to write the CHANNEL's config, so the live-network code check is neither run nor needed.
  // Without it the bridge refuses a stamped record outright, which is the point of the stamp.
  console.log(`\n▶ dev-chain/sepolia-config.ts   (→ ${APP_CONFIG_REL})`)
  run(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/dev-chain/sepolia-config.ts',
      '--fork',
      '--out',
      APP_CONFIG_REL,
      '--deploy-block',
      String(deployBlock),
    ],
    appDir,
  )

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('CHANNEL READY')
  console.log(`  config     : app/${APP_CONFIG_REL}`)
  console.log('  verify it  : pnpm chain:check:sepolia')
  console.log('  drive it   : VITE_SEPOLIA_FORK=1 VITE_CHAIN_ID=11155111 pnpm dev')
  console.log('  wallet     : add a network at chain id 11155111, rpc http://localhost:8546')
  console.log("  warped     : the seed's arm window (the live run waits it out)")
  console.log('  ephemeral  : every address below the salt set is fork-local')
  console.log('══════════════════════════════════════════════════════════')
  console.log(
    '\nAddresses change every run — this config is regenerated, not committed. To keep it',
  )
  console.log('out of git noise:')
  console.log(`   git update-index --skip-worktree app/${APP_CONFIG_REL}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
