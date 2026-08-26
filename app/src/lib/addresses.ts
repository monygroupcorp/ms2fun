import localDeployment from '../config/local-deployment.json'
import sepoliaDeployment from '../config/sepolia-deployment.json'
import sepoliaForkDeployment from '../config/local-deployment.sepolia.json'

/**
 * The Sepolia-fork DEV CHANNEL seam (`app/scripts/dev-chain/SEPOLIA-CHANNEL.md`).
 *
 * A second anvil channel forks Sepolia on :8546 and runs the real deploy + seed pipeline against it,
 * so the showcase can be walked before the public testnet carries it. The fork keeps the chain id it
 * forked (11155111) — the seed scripts require it, and matching the real network is the whole point
 * — so the channel cannot be selected by chain id. This flag is the selection instead, and it does
 * exactly two things: it points chain 11155111's transport at the fork (see ./wagmi.ts) and it
 * substitutes the channel's deployment artifact for the committed placeholder below.
 *
 * UNSET IS THE UNCHANGED APP. The comparison is against a statically-replaced `import.meta.env`
 * value, so an ordinary build resolves this to `false`, the branch below folds to the committed
 * `sepoliaDeployment`, and the channel artifact drops out of the bundle. Nothing here reaches a
 * production build: the flag is only ever set by hand, in front of `pnpm dev`.
 */
export const sepoliaForkEnabled: boolean = import.meta.env.VITE_SEPOLIA_FORK === '1'

/** Chain id of the local anvil mainnet-fork (see ./wagmi.ts). */
export const anvilChainId = 1337
/** Chain id of the Sepolia public testnet — the showcase network. */
export const sepoliaChainId = 11155111

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/**
 * A deploy bridge's output for ONE chain (`app/scripts/dev-chain/`). Every deployment file has the
 * same shape whatever chain wrote it: the chain it describes, the block its contracts landed at, and
 * a name -> address map. Names the deployment does not carry (a network with no Cypher/Algebra
 * deployment, say) resolve to the zero address rather than to another chain's value.
 */
export interface Deployment {
  chainId: number
  deployBlock?: number
  contracts: Record<string, string>
}

/** The address bundle the app reads for one chain. Retired DAO contracts are intentionally excluded. */
export interface Addresses {
  MasterRegistryV1: `0x${string}`
  AlignmentRegistryV1: `0x${string}`
  GlobalMessageRegistry: `0x${string}`
  FeaturedQueueManager: `0x${string}`
  ProtocolTreasuryV1: `0x${string}`
  QueryAggregator: `0x${string}`
  ERC404Factory: `0x${string}`
  /** Refundable creator deploy-bond escrow (N12). Lever ships OFF (bondAmount 0). */
  DeployBondEscrow: `0x${string}`
  ERC1155Factory: `0x${string}`
  ERC721AuctionFactory: `0x${string}`
  /**
   * Aave endowment vault factory (noesis-077) — permissionless Yield-vault creation. A vault
   * factory, NOT a wizardable token factory; see VAULT_FACTORY_ADDRESSES below.
   */
  AaveEndowmentVaultFactory: `0x${string}`
  ComponentRegistry: `0x${string}`
  ProfileRegistry: `0x${string}`
  AlignmentTargetRequestRegistry: `0x${string}`
  /** Metadata-resolution stack singletons (ADR-0006/0007). */
  MetadataResolverRouter: `0x${string}`
  MetadataOverlayModule: `0x${string}`
  TokenTierBandResolver: `0x${string}`
  /**
   * Graduated-swap (B19): zRouter drives embedded post-graduation swaps, and the three LP deployer
   * module singletons let the UI detect which venue an instance graduated to (match against
   * instance.liquidityDeployer()) and read that venue's pool params.
   */
  zRouter: `0x${string}`
  ModuleUniV4Deployer: `0x${string}`
  ModuleZAMMDeployer: `0x${string}`
  ModuleCypherDeployer: `0x${string}`
  /**
   * The Cypher (Algebra Integral) periphery swap router — the venue's own router, which the embedded
   * post-graduation swap signs against (noesis-349). It is an EXTERNAL singleton, not one of ours, so
   * it rides the per-chain deploy config rather than a hardcoded constant: on a mainnet fork it is
   * the live mainnet router, and on any other network it is whatever that network's Algebra
   * deployment published. A network with no Algebra deployment carries the zero address here, and the
   * panel says so instead of trading.
   */
  CypherSwapRouter: `0x${string}`
}

/** Every key of {@link Addresses}, in the order the deploy bridges write them. */
export const ADDRESS_KEYS = [
  'MasterRegistryV1',
  'AlignmentRegistryV1',
  'GlobalMessageRegistry',
  'FeaturedQueueManager',
  'ProtocolTreasuryV1',
  'QueryAggregator',
  'ERC404Factory',
  'DeployBondEscrow',
  'ERC1155Factory',
  'ERC721AuctionFactory',
  'AaveEndowmentVaultFactory',
  'ComponentRegistry',
  'ProfileRegistry',
  'AlignmentTargetRequestRegistry',
  'MetadataResolverRouter',
  'MetadataOverlayModule',
  'TokenTierBandResolver',
  'zRouter',
  'ModuleUniV4Deployer',
  'ModuleZAMMDeployer',
  'ModuleCypherDeployer',
  'CypherSwapRouter',
] as const satisfies readonly (keyof Addresses)[]

/**
 * Project a deployment file onto the bundle the app reads. Pure and total: a name the deployment
 * omits resolves to the zero address, never to a value borrowed from another chain.
 */
export function addressesFromDeployment(deployment: Deployment): Addresses {
  const contracts = deployment.contracts
  const bundle = {} as Record<keyof Addresses, `0x${string}`>
  for (const key of ADDRESS_KEYS) {
    bundle[key] = (contracts[key] ?? ZERO_ADDRESS) as `0x${string}`
  }
  return bundle
}

/**
 * True when a deployment file actually names a deployment. A committed placeholder is all-zero —
 * addresses are not known until the chain has been deployed to — and a chain in that state is not
 * live: the registry the whole read path starts from would be the zero address.
 */
export function isDeploymentPopulated(deployment: Deployment): boolean {
  const registry = deployment.contracts.MasterRegistryV1
  return registry !== undefined && registry !== ZERO_ADDRESS
}

/** Build the chain -> addresses map from a set of deployment files, keyed by each file's chainId. */
export function buildAddressesByChain(
  deployments: readonly Deployment[],
): Record<number, Addresses> {
  const byChain: Record<number, Addresses> = {}
  for (const deployment of deployments) {
    byChain[deployment.chainId] = addressesFromDeployment(deployment)
  }
  return byChain
}

/**
 * The deployment files this build carries, one per chain it can talk to.
 *
 * `local-deployment.json` is REGENERATED on every local deploy (`pnpm chain:deploy`) — anvil
 * addresses are non-deterministic, so the committed copy is a zero placeholder and the bridge
 * overwrites it. `sepolia-deployment.json` is written from the `DeploySepolia` output by
 * `scripts/dev-chain/sepolia-config.ts`; its committed copy is likewise a zero placeholder, so a Sepolia build
 * made before that deploy is broadcast resolves zero addresses rather than a guess, and dropping the
 * real file in is config rather than code. Adding a further chain is a file plus a line here.
 *
 * The Sepolia entry is a SUBSTITUTION, never an addition: `local-deployment.sepolia.json` is the
 * dev channel's own artifact and carries the same chain id (11155111), so both files at once would
 * mean two deployments at one key and `buildAddressesByChain` would silently keep the last. With
 * `VITE_SEPOLIA_FORK` unset — every ordinary build — the committed placeholder is what is carried.
 */
const DEPLOYMENTS: readonly Deployment[] = [
  localDeployment,
  sepoliaForkEnabled ? sepoliaForkDeployment : sepoliaDeployment,
]

/**
 * Chain-scoped address map (chain-scoped-slug-routes, noesis-079). Every chain this build carries a
 * deployment file for appears here, populated or not; `isChainDeployed` is the separate question of
 * whether that chain's addresses are known yet.
 */
export const addressesByChain: Record<number, Addresses> = buildAddressesByChain(DEPLOYMENTS)

/** Look up the address bundle for a route-scoped chain id; `undefined` = unknown network. */
export function addressesForChain(chainId: number): Addresses | undefined {
  return addressesByChain[chainId]
}

/** True when this build carries real (non-placeholder) addresses for the chain. */
export function isChainDeployed(chainId: number): boolean {
  const deployment = DEPLOYMENTS.find((d) => d.chainId === chainId)
  return deployment !== undefined && isDeploymentPopulated(deployment)
}

/**
 * Log-scan floor (ADR-0010 Tier 1B): our contracts' events all land at/after their deploy block, so
 * every `getLogs` starts here — NEVER `fromBlock: 0n` (chain genesis: ~20M dead blocks on a mainnet
 * fork, more still on a long-lived testnet). Written by the deploy bridges; falls back to 0n for a
 * file that predates the field (safe — just unoptimised until the next reseed).
 */
export function deployBlockForChain(chainId: number): bigint {
  const deployment = DEPLOYMENTS.find((d) => d.chainId === chainId)
  return BigInt(deployment?.deployBlock ?? 0)
}

/**
 * Chain ids the app's wagmi `config` knows how to talk to (`src/lib/wagmi.ts`:
 * `[mainnet, sepolia, anvilFork]`) — the generated read/write hooks type their `chainId` param
 * against this exact union, so any chain-scoped chainId that reaches them must be narrowed to it
 * (route params arrive as plain `number`).
 */
export type SupportedChainId = 1 | typeof anvilChainId | typeof sepoliaChainId

/**
 * Chain selection. The app has always taken its chain from the deployment config it was built with
 * (one file, one `chainId`); carrying more than one file means the build has to say which one. That
 * is the whole mechanism — `VITE_CHAIN_ID` names the chain and the deployment file keyed to it
 * supplies the addresses:
 *
 *   pnpm dev                          -> 1337, the local anvil fork (unchanged default)
 *   VITE_CHAIN_ID=11155111 pnpm build -> Sepolia
 *
 * An id with no deployment file throws at app load, naming the chains that do have one, rather than
 * falling back silently to another chain's addresses. (The throw is at load, not at build: the
 * selection is read from the environment the bundle is built with, and nothing evaluates it until
 * the module does.) This adds no in-app network switcher: the wallet side is unchanged, with
 * `WrongNetworkBanner` comparing the connected wallet's chain against this selection and offering
 * the switch, exactly as it did when the only alternative was the fork.
 */
export function resolveActiveChainId(raw: string | undefined): SupportedChainId {
  if (raw === undefined || raw.trim() === '') return localDeployment.chainId as SupportedChainId
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || addressesByChain[parsed] === undefined) {
    const known = Object.keys(addressesByChain).join(', ')
    throw new Error(`VITE_CHAIN_ID=${raw} has no deployment config (known chains: ${known})`)
  }
  return parsed as SupportedChainId
}

const env = import.meta.env as unknown as Record<string, string | undefined>

/** The chain this build talks to. */
export const activeChainId: SupportedChainId = resolveActiveChainId(env.VITE_CHAIN_ID)

/** Addresses on the chain this build talks to. */
export const activeAddresses: Addresses = addressesByChain[activeChainId] as Addresses

/** Log-scan floor on the chain this build talks to. */
export const deployBlock = deployBlockForChain(activeChainId)

/**
 * Historical names for the active chain's id and address bundle, from when the only deployment was
 * the local fork. They remain the app-wide default every non-route-scoped read uses.
 */
export const forkChainId = activeChainId
export const forkAddresses = activeAddresses

/**
 * Vault-family factories (noesis-077). These self-register as `IFactory` in the MasterRegistry so any
 * wallet can permissionlessly create an alignment vault — but they are NOT wizardable token factories.
 * Any registry-driven factory enumeration filters these out (so the roster promotion stays cosmetic and
 * a vault factory never appears as a wizard project type). Lowercased for case-insensitive membership,
 * and collected across every chain so the filter does not depend on which chain is being rendered;
 * extend with the LP vault factories when those are promoted (spec §4.2 follow-up).
 */
export const VAULT_FACTORY_ADDRESSES: ReadonlySet<string> = new Set(
  Object.values(addressesByChain)
    .map((a) => a.AaveEndowmentVaultFactory.toLowerCase())
    .filter((a) => a !== ZERO_ADDRESS),
)
