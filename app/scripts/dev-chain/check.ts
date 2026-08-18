/**
 * Chain-config preflight: verifies `src/config/local-deployment.json` actually matches the chain
 * it claims to describe, before the app ever loads it.
 *
 * `addresses.ts` imports that file as a build-time static and nothing else re-reads the chain —
 * once written, the config is trusted forever. A stale or placeholder config produces no error and
 * no console message: every `getLogs`/`readContract` call just returns empty and the app renders
 * an empty shell. Run this to get a one-line diagnosis instead of a silent blank page.
 *
 * THE SKIP-WORKTREE TRAP: `addresses.ts` recommends (and `deploy.ts` prints) running
 * `git update-index --skip-worktree src/config/local-deployment.json` to keep the regenerated file
 * out of git noise. Once set, `git` will never update, overwrite, or report that file again — a
 * `git pull`, a branch switch, or a `git checkout` all leave it exactly as stale as it was. No git
 * operation will ever correct a stale config; `chain:check` is how you find out it happened.
 *
 * Run: `pnpm chain:check` (tsx). Exits non-zero on any failure. Fixes nothing and refreshes no
 * config — it only names the problem. Bring the chain up with `pnpm chain:fork` / `pnpm chain:deploy`.
 *
 * PRESENCE IS NOT IDENTITY: local dev addresses come from `(deployer, nonce)`, so two different
 * deploy runs by the same deployer produce the SAME address list holding DIFFERENT contracts. A
 * config read against the wrong instance does not fail cleanly — every address whose nonce happens
 * to line up reports code and reads as a pass. For a small named set of hub contracts we corroborate
 * identity with one typed view call each (see `corroborateIdentity`) instead of trusting
 * `code.length > 0` alone.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  http,
  isAddressEqual,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type PublicClient,
} from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const configPath = resolve(appDir, 'src/config/local-deployment.json')

const RPC = 'http://127.0.0.1:8545'

// Minimal identity-check ABIs — one view function per hub contract, just enough to corroborate
// that the deployed code behaves like the named contract rather than merely occupying the address.
// Kept local (not imported from `src/generated/contracts.ts`) so this diagnostic script carries no
// dependency on the wagmi codegen output.
const MASTER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isFactoryRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'factory', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const COMPONENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isApprovedForTag',
    stateMutability: 'view',
    inputs: [
      { name: 'component', type: 'address' },
      { name: 'tag', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ERC404_FACTORY_ABI = [
  {
    type: 'function',
    name: 'masterRegistry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// Matches FeatureUtils.TIER on-chain (see contracts/src/master/libraries/FeatureUtils.sol).
const TIER_TAG = keccak256(toBytes('tier'))

/**
 * The slim config shape `deploy.ts` writes and `addresses.ts` reads (see src/lib/addresses.ts).
 * `deployBlock` is optional because the committed placeholder predates that field — `addresses.ts`
 * falls back to 0n for the same reason, and we mirror that here rather than treating it as an error.
 */
interface LocalDeploymentConfig {
  generatedAt: string
  chainId: number
  deployBlock?: number
  deployer: Address
  contracts: Record<string, Address>
}

function loadConfig(): LocalDeploymentConfig {
  return JSON.parse(readFileSync(configPath, 'utf8')) as LocalDeploymentConfig
}

/**
 * One typed view call per hub contract, asserting the deployed code behaves like the named
 * contract AND agrees with another address already in this config — not merely that code exists.
 * A wrong contract at the right address either reverts on the call or decodes to a value the
 * config does not contain; both come back `false` here. Contracts outside this small named set
 * return `null` — presence alone stays sufficient for them (deep identity is out of scope; see the
 * item spec).
 */
async function corroborateIdentity(
  client: PublicClient,
  name: string,
  address: Address,
  config: LocalDeploymentConfig,
): Promise<boolean | null> {
  try {
    switch (name) {
      case 'MasterRegistryV1': {
        const registered = await client.readContract({
          address,
          abi: MASTER_REGISTRY_ABI,
          functionName: 'isFactoryRegistered',
          args: [config.contracts.ERC404Factory],
        })
        return registered
      }
      case 'ComponentRegistry': {
        const approved = await client.readContract({
          address,
          abi: COMPONENT_REGISTRY_ABI,
          functionName: 'isApprovedForTag',
          args: [config.contracts.TokenTierBandResolver, TIER_TAG],
        })
        return approved
      }
      case 'ERC404Factory': {
        const registry = await client.readContract({
          address,
          abi: ERC404_FACTORY_ABI,
          functionName: 'masterRegistry',
        })
        return isAddressEqual(registry, config.contracts.MasterRegistryV1)
      }
      default:
        return null
    }
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const client = createPublicClient({ transport: http(RPC) })

  let failed = false

  // 1. The RPC must answer at all. If it does not, every other check is meaningless noise — say
  //    the chain is down and stop, rather than reporting every address as dead.
  let liveChainId: number
  try {
    liveChainId = await client.getChainId()
  } catch {
    console.log(`[FAIL] RPC unreachable at ${RPC}`)
    console.log('\nRemedy: the chain is not running — run `pnpm chain:fork`.')
    process.exit(1)
  }
  console.log(`[PASS] RPC reachable at ${RPC} (chainId ${liveChainId})`)

  // 2. chainId agreement.
  if (liveChainId === config.chainId) {
    console.log(`[PASS] chainId matches (${config.chainId})`)
  } else {
    console.log(
      `[FAIL] chainId mismatch — chain reports ${liveChainId}, config says ${config.chainId}`,
    )
    failed = true
  }

  // 3. Every configured address must have code on the running chain. A zero address is reported as
  //    its own state (the committed placeholder), never conflated with "no code" — the remedy is
  //    the same (`chain:deploy`) but the diagnosis is different. Code alone is not identity: for
  //    the hub contracts, corroborate with a typed view call before calling it a [PASS] — an
  //    uncorroborated-but-present address is its own [WARN] state, never a silent [PASS].
  const entries = Object.entries(config.contracts)
  let codeCount = 0
  let corroboratedCount = 0
  for (const [name, address] of entries) {
    if (isAddressEqual(address, zeroAddress)) {
      console.log(
        `[FAIL] ${name} ${address} placeholder (committed default) — run \`pnpm chain:deploy\``,
      )
      failed = true
      continue
    }
    const code = await client.getCode({ address })
    const byteLength = code ? (code.length - 2) / 2 : 0
    if (byteLength === 0) {
      console.log(`[FAIL] ${name} ${address} no code on chain`)
      failed = true
      continue
    }
    codeCount++
    const identity = await corroborateIdentity(client, name, address, config)
    if (identity === false) {
      console.log(
        `[WARN] ${name} ${address} has code (${byteLength} bytes), identity not corroborated`,
      )
      continue
    }
    if (identity === true) corroboratedCount++
    console.log(`[PASS] ${name} ${address} has code (${byteLength} bytes)`)
  }

  console.log(
    `\n${codeCount} of ${entries.length} addresses have code, ${corroboratedCount} corroborated.`,
  )
  if (codeCount > 0 && codeCount < entries.length) {
    console.log(
      'Partially deployed or cross-instance chain: some configured addresses have code and some do ' +
        'not on this RPC — this is not simply a missing deploy.',
    )
  }

  // 4. The live chain must be at or past the config's deploy-block floor. If it is behind, the
  //    config was generated against a DIFFERENT fork instance, not merely an old one. A missing
  //    `deployBlock` (the committed placeholder predates the field) is treated as 0 — same
  //    fallback `addresses.ts` uses — and trivially passes.
  const deployBlock = config.deployBlock ?? 0
  const liveBlock = await client.getBlockNumber()
  if (liveBlock >= BigInt(deployBlock)) {
    console.log(`[PASS] deployBlock ${deployBlock} <= current block ${liveBlock}`)
  } else {
    console.log(
      `[FAIL] deployBlock ${deployBlock} is ahead of current block ${liveBlock} — config is from a different fork instance`,
    )
    failed = true
  }

  if (failed) {
    console.log(
      '\nRemedy: the chain is up but the config does not match — run `pnpm chain:deploy`.',
    )
    process.exit(1)
  }

  console.log(
    `\n✓ Config is live: generatedAt ${config.generatedAt}, deployBlock ${deployBlock}, ` +
      `current block ${liveBlock}, ${entries.length} addresses verified.`,
  )
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
