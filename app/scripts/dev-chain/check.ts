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
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, isAddressEqual, zeroAddress, type Address } from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const configPath = resolve(appDir, 'src/config/local-deployment.json')

const RPC = 'http://127.0.0.1:8545'

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
  //    the same (`chain:deploy`) but the diagnosis is different.
  const entries = Object.entries(config.contracts)
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
    if (byteLength > 0) {
      console.log(`[PASS] ${name} ${address} has code (${byteLength} bytes)`)
    } else {
      console.log(`[FAIL] ${name} ${address} no code on chain`)
      failed = true
    }
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
