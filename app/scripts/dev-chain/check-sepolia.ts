/**
 * Sepolia-fork channel preflight: does the fork actually hold what the seed claims?
 *
 * The sibling of `check.ts`, for the second channel. `check.ts` reads
 * `src/config/local-deployment.json` against :8545; this reads
 * `src/config/local-deployment.sepolia.json` against :8546 and additionally asserts the SEED's own
 * hand-off, because the whole point of the channel is walking the showcase the seed built.
 *
 * It fixes nothing and refreshes nothing — it names the problem and exits non-zero. Bring the
 * channel up with `pnpm chain:fork:sepolia` / `pnpm chain:deploy:sepolia`.
 *
 * PRESENCE IS NOT IDENTITY. Code at an address only says something was deployed there. Where a
 * cheap typed view call can corroborate that the code behaves like the thing it is named after, one
 * is made — see `MasterRegistry` and the curve rows below.
 *
 * Run: `pnpm chain:check:sepolia` (tsx).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, zeroAddress, type Address, type PublicClient } from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')
const configPath = resolve(appDir, 'src/config/local-deployment.sepolia.json')
const seedStatePath = resolve(contractsDir, 'deployments/sepolia-seed.json')
const venuePath = resolve(contractsDir, 'deployments/sepolia-venues.json')
const saltsPath = resolve(contractsDir, 'script/SepoliaSalts.sol')

const CHAIN_ID = 11155111
const DEFAULT_RPC = 'http://127.0.0.1:8546'

const rpcIndex = process.argv.indexOf('--rpc-url')
const rpcUrl = rpcIndex === -1 ? DEFAULT_RPC : (process.argv[rpcIndex + 1] ?? DEFAULT_RPC)

const MASTER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isFactoryRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'factory', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const BONDING_ABI = [
  {
    type: 'function',
    name: 'graduated',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
] as const

interface AppConfig {
  chainId: number
  deployBlock?: number
  contracts: Record<string, Address>
}

interface SeedState {
  chainId: number
  instances: Record<string, Address>
  ms2Vault?: Address
  cultVault?: Address
  ms2ZammVault?: Address
  cultCypherVault?: Address
  ms2ReferencePool?: Address
  cultReferencePool?: Address
  cultAlgebraPool?: Address
  ms2TargetId?: number
  cultTargetId?: number
  ms2ZammTargetId?: number
  cultAlgebraTargetId?: number
}

const failures: string[] = []

function check(condition: boolean, ok: string, bad: string): void {
  if (condition) {
    console.log(`  ✓ ${ok}`)
  } else {
    console.log(`  ✗ ${bad}`)
    failures.push(bad)
  }
}

async function hasCode(client: PublicClient, address: Address): Promise<boolean> {
  if (address === zeroAddress) return false
  const code = await client.getCode({ address })
  return code !== undefined && code !== '0x'
}

function readJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    throw new Error(`cannot read ${what} at ${path} — run pnpm chain:deploy:sepolia first`)
  }
}

/** The six CREATE3 registry addresses the salt set documents, by name. */
function documentedSaltAddresses(): { name: string; address: Address }[] {
  const source = readFileSync(saltsPath, 'utf8')
  const pattern =
    /bytes32 internal constant (\w+) = 0x[0-9a-fA-F]{64};\s*\/\/ => (0x[0-9a-fA-F]{40})/g
  return [...source.matchAll(pattern)].map((m) => ({ name: m[1], address: m[2] as Address }))
}

async function main(): Promise<void> {
  const config = readJson<AppConfig>(configPath, "the channel's app config")
  const client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient

  console.log(`chain config : ${configPath}`)
  console.log(`rpc          : ${rpcUrl}`)
  console.log('')

  // ── The chain the config claims ──
  console.log('chain')
  let liveChainId = 0
  try {
    liveChainId = await client.getChainId()
  } catch {
    console.log(`  ✗ cannot reach ${rpcUrl} — start the channel: pnpm chain:fork:sepolia`)
    process.exit(1)
  }
  check(
    liveChainId === CHAIN_ID,
    `rpc reports chain ${liveChainId}`,
    `rpc reports chain ${liveChainId}, expected ${CHAIN_ID}`,
  )
  check(
    config.chainId === CHAIN_ID,
    `config names chain ${config.chainId}`,
    `config names chain ${config.chainId}, expected ${CHAIN_ID}`,
  )
  check(
    (config.deployBlock ?? 0) > 0,
    `deploy-block floor ${config.deployBlock}`,
    'deploy-block floor is 0 — the app would scan the fork from genesis',
  )

  // ── The protocol addresses the app reads ──
  console.log('\nprotocol addresses (app config)')
  for (const [name, address] of Object.entries(config.contracts)) {
    if (address === zeroAddress) {
      // A zero here is a statement the deploy made about this network, not a failure of the check.
      console.log(`  · ${name} is unset on this network`)
      continue
    }
    check(await hasCode(client, address), `${name} ${address}`, `${name} ${address} holds NO code`)
  }

  const masterRegistry = config.contracts.MasterRegistryV1
  const erc404Factory = config.contracts.ERC404Factory
  if (masterRegistry !== zeroAddress && erc404Factory !== zeroAddress) {
    const registered = await client
      .readContract({
        address: masterRegistry,
        abi: MASTER_REGISTRY_ABI,
        functionName: 'isFactoryRegistered',
        args: [erc404Factory],
      })
      .catch(() => false)
    check(
      registered,
      'MasterRegistry knows the ERC-404 factory (identity corroborated)',
      'MasterRegistry does not report the ERC-404 factory as registered — wrong instance, or a partial deploy',
    )
  }

  // ── The CREATE3 registry set ──
  console.log('\nCREATE3 registry set')
  for (const { name, address } of documentedSaltAddresses()) {
    check(
      await hasCode(client, address),
      `${name} ${address}`,
      `${name} ${address} holds NO code — the salt set did not deploy`,
    )
  }

  // ── What the seed claims it built ──
  const seed = readJson<SeedState>(seedStatePath, "the seed's hand-off")
  console.log('\nseed hand-off')
  check(
    seed.chainId === CHAIN_ID,
    `seed hand-off names chain ${seed.chainId}`,
    `seed hand-off names chain ${seed.chainId}, expected ${CHAIN_ID} (stale file?)`,
  )

  console.log('\ncurve rows')
  for (const [slug, address] of Object.entries(seed.instances)) {
    check(await hasCode(client, address), `${slug} ${address}`, `${slug} ${address} holds NO code`)
  }

  // The graduated row is the one the walk is FOR: the curve closed and the raise moved into a live
  // pool. Its neighbour is asserted the other way, so a chain where everything graduated fails too.
  const graduatedRow = seed.instances['flare-graduated']
  if (graduatedRow) {
    const isGraduated = await client
      .readContract({ address: graduatedRow, abi: BONDING_ABI, functionName: 'graduated' })
      .catch(() => false)
    check(
      isGraduated,
      'flare-graduated has graduated',
      'flare-graduated reports NOT graduated — the graduated row is not walkable',
    )
  }
  const readyRow = seed.instances['cinder-ready']
  if (readyRow) {
    const isGraduated = await client
      .readContract({ address: readyRow, abi: BONDING_ABI, functionName: 'graduated' })
      .catch(() => true)
    check(
      !isGraduated,
      'cinder-ready is still ungraduated (graduation left uncrossed)',
      'cinder-ready has already graduated — the ready-to-graduate state is not walkable',
    )
  }

  // ── The four alignment targets and their venues ──
  console.log('\nalignment targets')
  const targets: [string, number | undefined][] = [
    ['MS2 / UNI_V4', seed.ms2TargetId],
    ['CULT / UNI_V4', seed.cultTargetId],
    ['MS2 / ZAMM', seed.ms2ZammTargetId],
    ['CULT / ALGEBRA', seed.cultAlgebraTargetId],
  ]
  for (const [label, id] of targets) {
    check(
      id !== undefined && id > 0,
      `${label} target id ${id}`,
      `${label} has no target id — that venue is missing from the showcase`,
    )
  }

  console.log('\nvaults and pools')
  const addressChecks: [string, Address | undefined][] = [
    ['MS2 alignment vault', seed.ms2Vault],
    ['CULT alignment vault', seed.cultVault],
    ['MS2 ZAMM vault', seed.ms2ZammVault],
    ['CULT Cypher vault', seed.cultCypherVault],
    ['MS2 reference pool', seed.ms2ReferencePool],
    ['CULT reference pool', seed.cultReferencePool],
    ['CULT Algebra pool', seed.cultAlgebraPool],
  ]
  for (const [label, address] of addressChecks) {
    if (!address || address === zeroAddress) {
      check(false, '', `${label} is unset in the seed hand-off`)
      continue
    }
    check(
      await hasCode(client, address),
      `${label} ${address}`,
      `${label} ${address} holds NO code`,
    )
  }

  // The venue hand-off is what a later script reads to reach the ZAMM and Cypher families.
  const venues = readJson<{
    chainId: number
    zammVaultFactory: Address
    cypherVaultFactory: Address
  }>(venuePath, 'the venue hand-off')
  console.log('\nvenue factories')
  check(
    venues.chainId === CHAIN_ID,
    `venue hand-off names chain ${venues.chainId}`,
    `venue hand-off names chain ${venues.chainId}, expected ${CHAIN_ID}`,
  )
  for (const [label, address] of [
    ['ZAMM vault factory', venues.zammVaultFactory],
    ['Cypher vault factory', venues.cypherVaultFactory],
  ] as const) {
    check(
      await hasCode(client, address),
      `${label} ${address}`,
      `${label} ${address} holds NO code`,
    )
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`✗ ${failures.length} check(s) failed on the Sepolia-fork channel.`)
    process.exit(1)
  }
  console.log('✅ The Sepolia-fork channel holds what the seed claims.')
  console.log('   Drive it: VITE_SEPOLIA_FORK=1 VITE_CHAIN_ID=11155111 pnpm dev')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
