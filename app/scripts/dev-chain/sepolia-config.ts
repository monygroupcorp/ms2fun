/**
 * Sepolia deploy-config bridge.
 *
 * The local sibling of this script (`deploy.ts`) runs the anvil deploy AND writes the frontend
 * config. A public testnet deploy is not ours to run from a script — it is broadcast by hand, with a
 * keystore — so this half stands alone: it takes the `DeploySepolia` output that already exists on
 * disk and projects it onto the slim per-chain config the app reads (`src/lib/addresses.ts`).
 *
 * The two files have different shapes on purpose. `contracts/deployments/sepolia.json` is forge's
 * full record of a deploy (registries, factories, vaults, venue addresses). The app config is the
 * subset the frontend reads, under the names the frontend reads them by.
 *
 * Run (from `app/`), after `forge script script/DeploySepolia.s.sol` has written its JSON:
 *
 *   pnpm exec tsx scripts/dev-chain/sepolia-config.ts --deploy-block <block>
 *
 * `--deploy-block` is the block the deploy landed at; it becomes the log-scan floor (ADR-0010 Tier
 * 1B) so the app never scans Sepolia from genesis. Omitted, it keeps whatever the current config
 * carries — 0 for the committed placeholder, which is correct-but-slow rather than wrong.
 *
 * The written file is COMMITTED, unlike its local counterpart: a Sepolia deploy is broadcast once
 * and its addresses are then a fact about the network, so the build carries them rather than
 * regenerating them. The committed placeholder is all-zero until that broadcast happens.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')

const SEPOLIA_CHAIN_ID = 11155111

/** The forge deployment JSON shape (the subset this bridge reads). */
interface ForgeDeployment {
  chainId: number
  deployer?: string
  contracts: Record<string, string>
  factories: Record<string, string>
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const inPath = resolve(repoRoot, arg('in') ?? 'contracts/deployments/sepolia.json')
const outPath = resolve(appDir, arg('out') ?? 'src/config/sepolia-deployment.json')

const deployed = JSON.parse(readFileSync(inPath, 'utf8')) as ForgeDeployment
if (deployed.chainId !== SEPOLIA_CHAIN_ID) {
  throw new Error(
    `${inPath} names chain ${deployed.chainId}, expected ${SEPOLIA_CHAIN_ID} (wrong file, or a stale one)`,
  )
}

const c = deployed.contracts ?? {}
const f = deployed.factories ?? {}

/**
 * Read one address, by the name the DEPLOY writes it under. Missing is fatal: a silent zero here
 * would present a contract the app then reads from the zero address, which fails as an unrelated
 * decode error at the call site rather than here, where the cause is legible.
 */
const required = (record: Record<string, string>, key: string): string => {
  const value = record[key]
  if (!value) throw new Error(`${inPath} is missing an expected address: ${key}`)
  return value
}

// Keep the existing deploy-block unless this run supplies one.
let previousDeployBlock = 0
try {
  const existing = JSON.parse(readFileSync(outPath, 'utf8')) as { deployBlock?: number }
  previousDeployBlock = existing.deployBlock ?? 0
} catch {
  // No prior config — nothing to carry forward.
}
const deployBlockArg = arg('deploy-block')
const deployBlock = deployBlockArg === undefined ? previousDeployBlock : Number(deployBlockArg)
if (!Number.isInteger(deployBlock) || deployBlock < 0) {
  throw new Error(`--deploy-block must be a non-negative integer, got: ${String(deployBlockArg)}`)
}

const config = {
  generatedAt: new Date().toISOString(),
  chainId: deployed.chainId,
  deployBlock,
  deployer: deployed.deployer ?? '0x0000000000000000000000000000000000000000',
  contracts: {
    MasterRegistryV1: required(c, 'MasterRegistry'),
    AlignmentRegistryV1: required(c, 'AlignmentRegistry'),
    GlobalMessageRegistry: required(c, 'GlobalMessageRegistry'),
    FeaturedQueueManager: required(c, 'FeaturedQueueManager'),
    ProtocolTreasuryV1: required(c, 'ProtocolTreasury'),
    QueryAggregator: required(c, 'QueryAggregator'),
    ERC404Factory: required(f, 'ERC404'),
    DeployBondEscrow: required(c, 'DeployBondEscrow'),
    ERC1155Factory: required(f, 'ERC1155'),
    ERC721AuctionFactory: required(f, 'ERC721'),
    AaveEndowmentVaultFactory: required(f, 'AAVE'),
    ComponentRegistry: required(c, 'ComponentRegistry'),
    ProfileRegistry: required(c, 'ProfileRegistry'),
    AlignmentTargetRequestRegistry: required(c, 'AlignmentTargetRequestRegistry'),
    MetadataResolverRouter: required(c, 'MetadataResolverRouter'),
    MetadataOverlayModule: required(c, 'MetadataOverlayModule'),
    TokenTierBandResolver: required(c, 'TokenTierBandResolver'),
    zRouter: required(c, 'zRouter'),
    ModuleUniV4Deployer: required(c, 'ModuleUniV4Deployer'),
    ModuleZAMMDeployer: required(c, 'ModuleZAMMDeployer'),
    // Cypher has no Sepolia deployment to point at, so DeployCore leaves these at the zero address
    // rather than reusing another network's Algebra addresses. The app reads that as "no Cypher
    // venue here" and says so instead of offering a trade (noesis-349).
    ModuleCypherDeployer: required(c, 'ModuleCypherDeployer'),
    CypherSwapRouter: required(c, 'CypherSwapRouter'),
  },
}

writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`)
console.log(`✓ Wrote ${outPath}`)
console.log(`  chainId:          ${config.chainId}`)
console.log(`  deployBlock:      ${config.deployBlock}`)
console.log(`  MasterRegistryV1: ${config.contracts.MasterRegistryV1}`)
