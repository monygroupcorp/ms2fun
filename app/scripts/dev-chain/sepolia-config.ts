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
 *   SEPOLIA_RPC_URL=<sepolia rpc> pnpm exec tsx scripts/dev-chain/sepolia-config.ts \
 *     --deploy-block <block>
 *
 * `--deploy-block` is the block the deploy landed at; it becomes the log-scan floor (ADR-0010 Tier
 * 1B) so the app never scans Sepolia from genesis. Omitted, it keeps whatever the current config
 * carries — 0 for the committed placeholder, which is correct-but-slow rather than wrong.
 *
 * The written file is COMMITTED, unlike its local counterpart: a Sepolia deploy is broadcast once
 * and its addresses are then a fact about the network, so the build carries them rather than
 * regenerating them. The committed placeholder is all-zero until that broadcast happens.
 *
 * ── WHY THIS SCRIPT REFUSES TO RUN BLIND ──────────────────────────────────────────────────────
 *
 * The Sepolia-fork dev channel runs this same deploy against a LOCAL FORK that keeps chain id
 * 11155111, and its `DeploySepolia` writes the SAME `contracts/deployments/sepolia.json`. A fork
 * record and a live record are therefore identical in shape, carry the same chain id, and sit at
 * the same path — so the file alone cannot say which network it describes, and projecting the wrong
 * one lands fork-ephemeral addresses in the config the live site ships.
 *
 * Two independent guards close that, and neither can be waived:
 *
 *   1. THE FORK CHANNEL STAMPS ITS OUTPUT. `scripts/dev-chain/deploy-sepolia.ts` writes a
 *      `forkRehearsal` block into every artifact it produces. A stamped record is refused here
 *      unless `--fork` says the caller means to write the channel's own config.
 *   2. A LIVE PROJECTION IS CHECKED AGAINST THE LIVE CHAIN. Without `--fork`, every address about to
 *      be written must hold code at `--rpc-url` (or `SEPOLIA_RPC_URL`). That is the decisive test a
 *      file read cannot be: it catches a record that predates the stamp, and a record written by a
 *      deploy that reverted partway. There is no flag to skip it — an unverifiable projection is
 *      refused, because a config nobody checked is worth less than no config.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, type Address } from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')

const SEPOLIA_CHAIN_ID = 11155111

/**
 * The key `deploy-sepolia.ts` stamps into every artifact a fork rehearsal produces. Its presence is
 * the record saying, in its own words, that it describes a fork and not the public network.
 */
export const FORK_STAMP_KEY = 'forkRehearsal'

/** The forge deployment JSON shape (the subset this bridge reads). */
interface ForgeDeployment {
  chainId: number
  deployer?: string
  contracts: Record<string, string>
  factories: Record<string, string>
  [FORK_STAMP_KEY]?: unknown
}

/**
 * Returns every reason `deployment` must not be projected onto the LIVE config. An empty array means
 * the record is at least claiming to be a live Sepolia deploy — which the on-chain check then has to
 * confirm. Never throws on a malformed shape: an unexpected value is itself a reason.
 */
export function liveProjectionReasons(deployment: unknown): string[] {
  if (typeof deployment !== 'object' || deployment === null) {
    return [`deployment record is not an object (got ${JSON.stringify(deployment)})`]
  }
  const d = deployment as Record<string, unknown>
  const reasons: string[] = []

  if (d.chainId !== SEPOLIA_CHAIN_ID) {
    reasons.push(
      `names chain ${JSON.stringify(d.chainId)}, expected ${SEPOLIA_CHAIN_ID} (wrong file, or a stale one)`,
    )
  }
  if (d[FORK_STAMP_KEY] !== undefined) {
    reasons.push(
      `carries a "${FORK_STAMP_KEY}" stamp — it was produced by the Sepolia-fork dev channel, ` +
        "and its addresses exist only on that fork. Pass --fork to write the channel's own config, " +
        'or re-run the live broadcast to produce a live record',
    )
  }
  return reasons
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/**
 * Read one address, by the name the DEPLOY writes it under. Missing is fatal: a silent zero here
 * would present a contract the app then reads from the zero address, which fails as an unrelated
 * decode error at the call site rather than here, where the cause is legible.
 */
function requiredAddress(record: Record<string, string>, key: string, inPath: string): string {
  const value = record[key]
  if (!value) throw new Error(`${inPath} is missing an expected address: ${key}`)
  return value
}

/** The slim per-chain config the app reads, projected out of forge's full deployment record. */
export function projectConfig(
  deployed: ForgeDeployment,
  deployBlock: number,
  inPath: string,
): {
  generatedAt: string
  chainId: number
  deployBlock: number
  deployer: string
  contracts: Record<string, string>
} {
  const c = deployed.contracts ?? {}
  const f = deployed.factories ?? {}
  const required = (record: Record<string, string>, key: string) =>
    requiredAddress(record, key, inPath)

  return {
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
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Every address in `contracts` that does NOT hold code at `rpcUrl`. The zero address is skipped: it
 * is how `DeployCore` says "this network has no such venue", and it is never expected to hold code.
 */
export async function addressesWithoutCode(
  contracts: Record<string, string>,
  rpcUrl: string,
): Promise<{ chainId: number; empty: string[] }> {
  const client = createPublicClient({ transport: http(rpcUrl) })
  const chainId = await client.getChainId()
  const empty: string[] = []
  for (const [name, address] of Object.entries(contracts)) {
    if (address.toLowerCase() === ZERO_ADDRESS) continue
    const code = await client.getCode({ address: address as Address })
    if (!code || code === '0x') empty.push(`${name} (${address})`)
  }
  return { chainId, empty }
}

async function main(): Promise<void> {
  const isFork = flag('fork')
  const inPath = resolve(repoRoot, arg('in') ?? 'contracts/deployments/sepolia.json')
  const outPath = resolve(appDir, arg('out') ?? 'src/config/sepolia-deployment.json')

  const deployed = JSON.parse(readFileSync(inPath, 'utf8')) as ForgeDeployment

  if (isFork) {
    // The channel's own config. The record still has to be a Sepolia-shaped one, but its addresses
    // are fork-local by definition and there is no live chain to check them against.
    if (deployed.chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(
        `${inPath} names chain ${deployed.chainId}, expected ${SEPOLIA_CHAIN_ID} (wrong file, or a stale one)`,
      )
    }
  } else {
    const reasons = liveProjectionReasons(deployed)
    if (reasons.length > 0) {
      throw new Error(
        [`Refusing to write ${outPath} from ${inPath}:`, ...reasons.map((r) => `  - ${r}`)].join(
          '\n',
        ),
      )
    }
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

  const config = projectConfig(deployed, deployBlock, inPath)

  if (!isFork) {
    // The decisive test, and the one a file cannot fake: does the public network actually hold what
    // this record claims? Fail-closed — with no endpoint there is nothing to check against, and a
    // config written on the strength of a filename is exactly the mistake this guard exists for.
    const rpcUrl = arg('rpc-url') ?? process.env.SEPOLIA_RPC_URL
    if (!rpcUrl) {
      throw new Error(
        `Refusing to write ${outPath} unverified: pass --rpc-url <sepolia rpc> or set ` +
          'SEPOLIA_RPC_URL so the projected addresses can be checked on the live network. ' +
          "(A fork rehearsal's config is written with --fork and is not checked.)",
      )
    }
    const { chainId, empty } = await addressesWithoutCode(config.contracts, rpcUrl)
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`the endpoint reports chain ${chainId}, expected ${SEPOLIA_CHAIN_ID}`)
    }
    if (empty.length > 0) {
      throw new Error(
        [
          `Refusing to write ${outPath}: ${empty.length} of ${
            Object.keys(config.contracts).length
          } addresses in ${inPath} hold no code on chain ${chainId}.`,
          'That record does not describe this network — a fork rehearsal, or a deploy that did not land:',
          ...empty.map((e) => `  - ${e}`),
        ].join('\n'),
      )
    }
    console.log(`✓ Verified on chain ${chainId}: every projected address holds code`)
  }

  writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`✓ Wrote ${outPath}${isFork ? '  (fork rehearsal — not the live network)' : ''}`)
  console.log(`  chainId:          ${config.chainId}`)
  console.log(`  deployBlock:      ${config.deployBlock}`)
  console.log(`  MasterRegistryV1: ${config.contracts.MasterRegistryV1}`)
}

// Only run the CLI when this file is invoked directly, not when its helpers are imported for tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
