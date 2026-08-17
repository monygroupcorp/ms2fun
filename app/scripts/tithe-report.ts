/**
 * Tithe report — prints, per alignment target, the ETH tithed on chain across every registered
 * collection. A thin runner: it makes the RPC calls and hands already-decoded data to
 * `../src/lib/tithe/aggregate.ts`, which does all the grouping and hazard accounting. Nothing in
 * this file is worth a unit test (`app/scripts/` is outside the typecheck/vitest project — see the
 * lib module doc) — if a line here needs testing, it belongs in `lib/tithe` instead.
 *
 * Enumeration walks the master registry, never the vault factories (their addresses are not in the
 * deployment JSON and a factory-log scan would silently miss any vault created after one snapshot):
 *   1. `InstanceRegistered` on `MasterRegistry` → every registered collection instance, retroactively.
 *   2. `getInstanceVaults(instance)` → every vault ever bound to that instance (migrations included).
 *   3. Probe both `alignmentTargetId()` (liquidity family) and `targetId()` (endowment family) on each
 *      vault — the field name differs by family and there is no other way to tell them apart from the
 *      vault address alone.
 *   4. Scan `ContributionReceived` on each vault (the receipt event, emitted on every delivered path).
 *   5. Scan the hazard events — `VaultCutRedirected` and `VaultContributionFailed` — on every
 *      instance from the ERC1155/ERC721 factories (they emit these directly; the emitting contract
 *      IS the benefactor) and on the three liquidity deployer modules + `MetadataOverlayModule`
 *      (singleton addresses from the deployment JSON; the module shape carries an explicit
 *      `instance` field for `VaultContributionFailed`, but `VaultCutRedirected` carries none, so a
 *      module-routed redirect is reported with `benefactor: null` — an honest gap, not a guess).
 *   6. Resolve target titles via `AlignmentRegistry.getAlignmentTarget`.
 *
 * Run: `pnpm tithe:report [rpcUrl] [network]` (tsx). Defaults to the local dev chain
 * (`http://127.0.0.1:8545`, `contracts/deployments/anvil.json`) — same idiom as `chain:deploy`.
 * Env overrides: `RPC_URL`, `NETWORK`, `FROM_BLOCK` (decimal block number; default `0`, which is a
 * real cost on a network forked/synced from genesis — pass the protocol's actual deploy block for
 * anything but a fresh local chain).
 *
 * A zero report is a legitimate result — there is no deployment with real settlements to read yet.
 * This script ships the instrument, not a claim about what it will print.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, defineChain, http, type Address } from 'viem'

import {
  alignmentEndowmentVaultAbi,
  alignmentRegistryV1Abi,
  masterRegistryV1Abi,
} from '../src/generated/contracts'
import {
  aggregateContributions,
  attributeVaults,
  formatReport,
  type ContributionLog,
  type HazardLog,
  type HazardScanCoverage,
} from '../src/lib/tithe/aggregate'
import {
  alignmentTargetIdAbi,
  contributionReceivedAbi,
  vaultContributionFailedInstanceAbi,
  vaultContributionFailedModuleAbi,
  vaultCutRedirectedAbi,
} from '../src/lib/tithe/abis'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const repoRoot = resolve(appDir, '..')

const rpcUrl = process.argv[2] ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const network = process.argv[3] ?? process.env.NETWORK ?? 'anvil'
const fromBlock = BigInt(process.env.FROM_BLOCK ?? '0')

const deploymentPath = resolve(repoRoot, 'contracts/deployments', `${network}.json`)

/** The subset of `contracts/deployments/<network>.json` this script reads. */
interface Deployment {
  chainId: number
  contracts: Record<string, Address>
  factories: Record<string, Address>
}

function requiredAddress(record: Record<string, Address>, key: string): Address {
  const value = record[key]
  if (!value) {
    throw new Error(
      `${deploymentPath} is missing expected address "${key}" — cannot build the tithe report from it.`,
    )
  }
  return value
}

async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as Deployment
  const masterRegistry = requiredAddress(deployment.contracts, 'MasterRegistry')
  const alignmentRegistry = requiredAddress(deployment.contracts, 'AlignmentRegistry')

  // Singleton hazard-event emitters that are not per-instance (see module doc, step 5). Optional:
  // omitted from the deployment (e.g. a network with no live AMM venue for that family — see
  // DeployCore's fallback-to-stub branches) means that family's redirects/pending simply aren't
  // scanned, not that the run fails.
  // The omission is deliberate, but it has to reach the OUTPUT: an unscanned source and a
  // scanned-and-empty one both render `redirected: 0`, so the report declares its own coverage.
  const moduleKeys = [
    'ModuleUniV4Deployer',
    'ModuleZAMMDeployer',
    'ModuleCypherDeployer',
    'MetadataOverlayModule',
  ] as const
  const moduleEntries = moduleKeys.map((key) => [key, deployment.contracts[key]] as const)
  const moduleAddresses = moduleEntries
    .map(([, address]) => address)
    .filter((a): a is Address => Boolean(a))
  const hazardCoverage: HazardScanCoverage = {
    scanned: moduleEntries.filter(([, address]) => Boolean(address)).map(([key]) => key),
    skipped: moduleEntries.filter(([, address]) => !address).map(([key]) => key),
  }

  const client = createPublicClient({
    chain: defineChain({
      id: deployment.chainId,
      name: `ms2fun-${network}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }),
    transport: http(rpcUrl),
  })

  const toBlock = await client.getBlockNumber()

  // 1. Every registered collection instance, retroactively.
  const registeredLogs = await client.getLogs({
    address: masterRegistry,
    event: masterRegistryV1Abi.find((e) => e.type === 'event' && e.name === 'InstanceRegistered')!,
    fromBlock,
    toBlock,
  })
  const instances = [
    ...new Set(registeredLogs.map((log) => (log.args as { instance: Address }).instance)),
  ]
  const instanceFactory = new Map(
    registeredLogs.map((log) => {
      const args = log.args as { instance: Address; factory: Address }
      return [args.instance, args.factory] as const
    }),
  )

  // ERC1155/ERC721 instances emit VaultCutRedirected/VaultContributionFailed directly (the emitting
  // instance IS the benefactor). ERC404/AAVE instances never call receiveContribution themselves —
  // ERC404 graduation routes through the liquidity deployer modules instead (scanned separately below).
  const instanceHazardFactories = new Set(
    [deployment.factories.ERC1155, deployment.factories.ERC721].filter((a): a is Address =>
      Boolean(a),
    ),
  )
  const instanceHazardScanTargets = instances.filter((instance) => {
    const factory = instanceFactory.get(instance)
    return factory !== undefined && instanceHazardFactories.has(factory)
  })

  // 2. Every vault ever bound to each instance.
  const vaultLists = await Promise.all(
    instances.map((instance) =>
      client.readContract({
        address: masterRegistry,
        abi: masterRegistryV1Abi,
        functionName: 'getInstanceVaults',
        args: [instance],
      }),
    ),
  )
  const vaults = [...new Set(vaultLists.flat())]

  // 3. Probe both target-id field names per vault; retain (unattributed) rather than drop on failure.
  const targetIds = await Promise.all(
    vaults.map(async (vault) => {
      try {
        return await client.readContract({
          address: vault,
          abi: alignmentTargetIdAbi,
          functionName: 'alignmentTargetId',
        })
      } catch {
        // fall through to the endowment-family field name
      }
      try {
        return await client.readContract({
          address: vault,
          abi: alignmentEndowmentVaultAbi,
          functionName: 'targetId',
        })
      } catch {
        return null
      }
    }),
  )
  const vaultRecords = attributeVaults(vaults, targetIds)

  // 4. ContributionReceived on every vault.
  const contributionLogsByVault = await Promise.all(
    vaults.map((vault) =>
      client.getLogs({ address: vault, event: contributionReceivedAbi[0], fromBlock, toBlock }),
    ),
  )
  const contributionLogs: ContributionLog[] = contributionLogsByVault.flat().map((log) => {
    const args = log.args as { benefactor: Address; amount: bigint }
    return { vault: log.address as Address, benefactor: args.benefactor, amount: args.amount }
  })

  // 5a. VaultCutRedirected — same shape on every emitter, so one scan covers instances + modules.
  const redirectAddresses = [...instanceHazardScanTargets, ...moduleAddresses]
  const redirectLogsByAddress = await Promise.all(
    redirectAddresses.map((address) =>
      client.getLogs({ address, event: vaultCutRedirectedAbi[0], fromBlock, toBlock }),
    ),
  )
  const instanceHazardSet = new Set(instanceHazardScanTargets)
  const redirectLogs: HazardLog[] = redirectLogsByAddress.flat().map((log) => {
    const args = log.args as { vault: Address; amount: bigint }
    const address = log.address as Address
    // Instance-emitted redirect: the emitting instance IS the benefactor. Module-emitted redirect:
    // the event carries no instance/benefactor field at all — reported unattributed, not guessed.
    const benefactor = instanceHazardSet.has(address) ? address : null
    return { vault: args.vault, benefactor, amount: args.amount }
  })

  // 5b. VaultContributionFailed — two incompatible shapes (see abis.ts), scanned separately.
  const failedInstanceLogsByAddress = await Promise.all(
    instanceHazardScanTargets.map((address) =>
      client.getLogs({ address, event: vaultContributionFailedInstanceAbi[0], fromBlock, toBlock }),
    ),
  )
  const failedInstanceLogs: HazardLog[] = failedInstanceLogsByAddress.flat().map((log) => {
    const args = log.args as { vault: Address; amount: bigint }
    return { vault: args.vault, benefactor: log.address as Address, amount: args.amount }
  })

  const failedModuleLogsByAddress = await Promise.all(
    moduleAddresses.map((address) =>
      client.getLogs({ address, event: vaultContributionFailedModuleAbi[0], fromBlock, toBlock }),
    ),
  )
  const failedModuleLogs: HazardLog[] = failedModuleLogsByAddress.flat().map((log) => {
    const args = log.args as { vault: Address; instance: Address; amount: bigint }
    return { vault: args.vault, benefactor: args.instance, amount: args.amount }
  })

  const report = aggregateContributions(vaultRecords, contributionLogs, redirectLogs, [
    ...failedInstanceLogs,
    ...failedModuleLogs,
  ])

  // 6. Resolve target titles.
  const targetIdsWithData = [
    ...new Set(report.targets.map((g) => g.targetId).filter((id): id is bigint => id !== null)),
  ]
  const targetTitleEntries = await Promise.all(
    targetIdsWithData.map(async (id) => {
      const target = await client.readContract({
        address: alignmentRegistry,
        abi: alignmentRegistryV1Abi,
        functionName: 'getAlignmentTarget',
        args: [id],
      })
      return [id.toString(), target.title] as const
    }),
  )

  console.log(formatReport(report, new Map(targetTitleEntries), hazardCoverage))
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
