/**
 * Fetch the mainnet Algebra Integral 1.2.1 set into `artifacts/` (gitignored).
 *
 *   pnpm exec tsx scripts/sepolia-algebra/fetch.ts [--explorer <url>] [--rpc <url>]
 *
 * For each contract it records the creation input, the runtime code, the constructor arguments and
 * the linked-library metadata. The runtime code is taken from the explorer AND from `eth_getCode`
 * on an independent RPC, and the two must agree — a single source is not enough to base a
 * byte-fidelity claim on.
 *
 * It also resolves the parts of the set that are not pinned in the manifest: the token-descriptor
 * implementation behind the proxy, the NFTDescriptor library that implementation is linked
 * against, the account that created the set, the wrapped-native token it was built against, and
 * the factory configuration a re-deployment has to reproduce.
 *
 * Output is never committed. See RUNBOOK.md.
 */
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

import {
  DEFAULT_MAINNET_EXPLORER,
  DEFAULT_MAINNET_RPC,
  ERC1967_IMPLEMENTATION_SLOT,
  PUBLISHED_SET,
  type Role,
} from './manifest.ts'
import {
  ARTIFACT_DIR,
  type Hex,
  type MainnetArtifact,
  type ResolvedFacts,
  artifactPath,
  normalizeAddress,
  parseArgs,
  resolvedPath,
  strip0x,
  writeJson,
} from './lib.ts'

const FACTORY_ABI = parseAbi([
  'function defaultPluginFactory() view returns (address)',
  'function vaultFactory() view returns (address)',
  'function defaultFee() view returns (uint16)',
  'function defaultTickspacing() view returns (int24)',
  'function defaultCommunityFee() view returns (uint16)',
  'function owner() view returns (address)',
  'function POOL_INIT_CODE_HASH() view returns (bytes32)',
])

interface ExplorerContract {
  name: string | null
  is_verified: boolean
  compiler_version: string | null
  optimization_runs: number | null
  creation_bytecode: string | null
  deployed_bytecode: string | null
  constructor_args: string | null
  decoded_constructor_args: [string, { name?: string; type?: string }][] | null
  external_libraries: { name: string; address_hash: string }[] | null
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return (await res.json()) as T
}

async function explorerContract(explorer: string, address: string): Promise<ExplorerContract> {
  return getJson<ExplorerContract>(`${explorer}/api/v2/smart-contracts/${address}`)
}

async function explorerCreator(explorer: string, address: string): Promise<Hex> {
  const info = await getJson<{ creator_address_hash?: string }>(
    `${explorer}/api/v2/addresses/${address}`,
  )
  if (!info.creator_address_hash) throw new Error(`no creator recorded for ${address}`)
  return normalizeAddress(info.creator_address_hash)
}

function decodeArgs(raw: ExplorerContract['decoded_constructor_args']) {
  if (!raw) return null
  return raw.map(([value, meta]) => ({
    name: meta?.name ?? '',
    type: meta?.type ?? '',
    value: String(value),
  }))
}

async function fetchOne(opts: {
  role: Role
  label: string
  address: Hex
  explorer: string
  rpc: string
  blockNumber: bigint
  client: ReturnType<typeof createPublicClient>
}): Promise<MainnetArtifact> {
  const { role, label, address, explorer, rpc, blockNumber, client } = opts
  const meta = await explorerContract(explorer, address)
  if (!meta.creation_bytecode)
    throw new Error(`${label}: explorer has no creation input for ${address}`)
  if (!meta.deployed_bytecode)
    throw new Error(`${label}: explorer has no runtime code for ${address}`)

  const onChain = await client.getCode({ address })
  if (!onChain) throw new Error(`${label}: no code at ${address}`)
  if (strip0x(onChain) !== strip0x(meta.deployed_bytecode)) {
    throw new Error(`${label}: explorer runtime and eth_getCode disagree at ${address}`)
  }

  const artifact: MainnetArtifact = {
    role,
    label,
    address: normalizeAddress(address),
    contractName: meta.name,
    verified: Boolean(meta.is_verified),
    compilerVersion: meta.compiler_version,
    optimizationRuns: meta.optimization_runs,
    creationInput: `0x${strip0x(meta.creation_bytecode)}`,
    runtime: `0x${strip0x(onChain)}`,
    constructorArgs: meta.constructor_args ? `0x${strip0x(meta.constructor_args)}` : null,
    decodedConstructorArgs: decodeArgs(meta.decoded_constructor_args),
    linkedLibraries: (meta.external_libraries ?? []).map((l) => ({
      name: l.name,
      address: normalizeAddress(l.address_hash),
    })),
    fetchedAt: new Date().toISOString(),
    source: { explorer, rpc, blockNumber: blockNumber.toString() },
  }
  writeJson(artifactPath(role), artifact)
  const bytes = strip0x(artifact.runtime).length / 2
  console.log(
    `  ${label.padEnd(30)} ${artifact.address}  runtime ${String(bytes).padStart(6)}B  ` +
      `solc ${artifact.compilerVersion ?? '?'}  runs ${artifact.optimizationRuns ?? '?'}`,
  )
  return artifact
}

function findArg(artifact: MainnetArtifact, name: string): string {
  const hit = artifact.decodedConstructorArgs?.find((a) => a.name === name)
  if (!hit) throw new Error(`${artifact.label}: no constructor argument named ${name}`)
  return hit.value
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const explorer = (
    typeof args.explorer === 'string' ? args.explorer : DEFAULT_MAINNET_EXPLORER
  ).replace(/\/$/, '')
  const rpc = typeof args.rpc === 'string' ? args.rpc : DEFAULT_MAINNET_RPC

  const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
  const blockNumber = await client.getBlockNumber()
  console.log(`explorer ${explorer}`)
  console.log(`rpc      ${rpc} (block ${blockNumber})`)
  console.log(`out      ${ARTIFACT_DIR}`)
  console.log('published set:')

  const fetched = new Map<Role, MainnetArtifact>()
  for (const spec of PUBLISHED_SET) {
    if (!spec.mainnet) throw new Error(`manifest entry ${spec.role} has no address`)
    fetched.set(
      spec.role,
      await fetchOne({
        role: spec.role,
        label: spec.label,
        address: normalizeAddress(spec.mainnet),
        explorer,
        rpc,
        blockNumber,
        client,
      }),
    )
  }

  const proxy = fetched.get('tokenDescriptor')
  if (!proxy) throw new Error('token descriptor proxy missing from the fetched set')

  console.log('resolved roles:')
  const slotValue = await client.getStorageAt({
    address: proxy.address,
    slot: ERC1967_IMPLEMENTATION_SLOT,
  })
  if (!slotValue) throw new Error('could not read the descriptor implementation slot')
  const implAddress = normalizeAddress(`0x${strip0x(slotValue).slice(-40)}`)
  const impl = await fetchOne({
    role: 'tokenDescriptorImpl',
    label: 'TokenDescriptorImplementation',
    address: implAddress,
    explorer,
    rpc,
    blockNumber,
    client,
  })

  if (impl.linkedLibraries.length !== 1) {
    throw new Error(
      `expected exactly one linked library on the descriptor, got ${impl.linkedLibraries.length}`,
    )
  }
  const library = await fetchOne({
    role: 'nftDescriptorLibrary',
    label: impl.linkedLibraries[0].name.split(':').pop() ?? 'NFTDescriptorLibrary',
    address: impl.linkedLibraries[0].address,
    explorer,
    rpc,
    blockNumber,
    client,
  })

  const positionManager = fetched.get('positionManager')
  const swapRouter = fetched.get('swapRouter')
  const factory = fetched.get('algebraFactory')
  if (!positionManager || !swapRouter || !factory) throw new Error('published set incomplete')

  const wnatives = [
    findArg(positionManager, '_WNativeToken'),
    findArg(swapRouter, '_WNativeToken'),
    findArg(impl, '_WNativeToken'),
  ].map(normalizeAddress)
  if (new Set(wnatives).size !== 1) {
    throw new Error(
      `the set was built against more than one wrapped-native token: ${wnatives.join(', ')}`,
    )
  }

  const config = await Promise.all([
    client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultPluginFactory',
    }),
    client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'vaultFactory',
    }),
    client.readContract({ address: factory.address, abi: FACTORY_ABI, functionName: 'defaultFee' }),
    client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultTickspacing',
    }),
    client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultCommunityFee',
    }),
    client.readContract({ address: factory.address, abi: FACTORY_ABI, functionName: 'owner' }),
    client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'POOL_INIT_CODE_HASH',
    }),
  ])

  const resolved: ResolvedFacts = {
    addresses: { tokenDescriptorImpl: impl.address, nftDescriptorLibrary: library.address },
    originalDeployer: await explorerCreator(explorer, proxy.address),
    mainnetWNative: wnatives[0],
    nativeCurrencySymbol: findArg(impl, '_nativeCurrencySymbol_'),
    factoryConfig: {
      defaultPluginFactory: normalizeAddress(config[0]),
      vaultFactory: normalizeAddress(config[1]),
      defaultFee: Number(config[2]),
      defaultTickspacing: Number(config[3]),
      defaultCommunityFee: Number(config[4]),
      owner: normalizeAddress(config[5]),
      poolInitCodeHash: config[6],
    },
  }
  writeJson(resolvedPath(), resolved)

  console.log('mainnet factory configuration:')
  console.log(`  defaultPluginFactory  ${resolved.factoryConfig.defaultPluginFactory}`)
  console.log(`  vaultFactory          ${resolved.factoryConfig.vaultFactory}`)
  console.log(`  defaultFee            ${resolved.factoryConfig.defaultFee}`)
  console.log(`  defaultTickspacing    ${resolved.factoryConfig.defaultTickspacing}`)
  console.log(`  defaultCommunityFee   ${resolved.factoryConfig.defaultCommunityFee}`)
  console.log(`  POOL_INIT_CODE_HASH   ${resolved.factoryConfig.poolInitCodeHash}`)
  console.log('fetch complete — artifacts are gitignored and must not be committed.')
}

main().catch((err: unknown) => {
  console.error(`fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
