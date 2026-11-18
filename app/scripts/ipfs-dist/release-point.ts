/**
 * `pnpm release:point <cid> [--broadcast]`: points noesis.gwei and noesis.wei at a release.
 *
 * Both names are NameNFT tokens on Ethereum mainnet whose contenthash only the names' owner can set,
 * so this runs `contracts/script/PointNoesisNames.s.sol` signed by a Foundry keystore account that
 * owns both: one command, one password prompt, one transaction per name. The script refuses a signer
 * that does not own both names or a name that has expired. After a broadcast this reads both records
 * from the chain and fails unless they equal the new contenthash.
 *
 * Without `--broadcast` forge only simulates the run against mainnet state and signs nothing; run
 * that first. The shell supplies:
 *
 *   MAINNET_RPC_URL       an Ethereum mainnet RPC endpoint
 *   NOESIS_NAMES_ACCOUNT  the name of the Foundry keystore account (`cast wallet list`) that owns
 *                         both names
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { CID } from 'multiformats/cid'

const DAG_PB = 0x70
const SHA2_256 = 0x12

/** The varint of the `ipfs` namespace (0xe3) that prefixes an ENSIP-7 IPFS contenthash. */
const IPFS_NAMESPACE = '0xe301'

const CONTRACTS_DIR = resolve(import.meta.dirname, '..', '..', '..', 'contracts')

/** Each name's NameNFT contract and token id, as PointNoesisNames.s.sol states them. */
export const NAMES = [
  {
    name: 'noesis.gwei',
    contract: '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6',
    tokenId: '0x13f9141e9f9a586ce7d30fd429baa7462c85f6d8715610ff9259843ccb5f358a',
  },
  {
    name: 'noesis.wei',
    contract: '0x0000000000696760E15f265e828DB644A0c242EB',
    tokenId: '0x2cf2bc9ace67c3ca4a9abed6121b9c7dcb19cfc9df7a911e45283ffb71e27b27',
  },
]

/**
 * The ENSIP-7 contenthash for `cid`: the `ipfs` namespace followed by the binary CID. Throws unless
 * `cid` is a CIDv1 dag-pb sha2-256 CID, the only shape `release:sepolia` produces and the only one
 * the forge script accepts.
 */
export function contenthashFor(cid: string): string {
  let parsed: CID
  try {
    parsed = CID.parse(cid)
  } catch {
    throw new Error(`${cid} is not a CID`)
  }
  if (parsed.version !== 1) throw new Error(`${cid} is CIDv${parsed.version}, not CIDv1`)
  if (parsed.code !== DAG_PB) {
    throw new Error(`${cid} has codec 0x${parsed.code.toString(16)}, not dag-pb (0x70)`)
  }
  if (parsed.multihash.code !== SHA2_256 || parsed.multihash.size !== 32) {
    throw new Error(`${cid} is not hashed with sha2-256`)
  }
  return IPFS_NAMESPACE + Buffer.from(parsed.bytes).toString('hex')
}

export interface PointOptions {
  contenthash: string
  rpcUrl: string
  account: string
  broadcast: boolean
}

/** The `forge` arguments that run PointNoesisNames for `options`. */
export function forgeArgs(options: PointOptions): string[] {
  const args = [
    'script',
    'script/PointNoesisNames.s.sol',
    '--sig',
    'run(bytes)',
    options.contenthash,
    '--rpc-url',
    options.rpcUrl,
    '--account',
    options.account,
  ]
  if (options.broadcast) args.push('--broadcast')
  return args
}

/** Why the records read from the chain are not `contenthash`; empty when both names carry it. */
export function recordReasons(records: Record<string, string>, contenthash: string): string[] {
  return NAMES.flatMap(({ name }) =>
    records[name]?.toLowerCase() === contenthash.toLowerCase()
      ? []
      : [`${name} carries ${records[name] ?? 'nothing readable'}, not ${contenthash}`],
  )
}

/** Each name's contenthash as the chain at `rpcUrl` returns it now. */
function readRecords(rpcUrl: string): Record<string, string> {
  const records: Record<string, string> = {}
  for (const { name, contract, tokenId } of NAMES) {
    const result = spawnSync(
      'cast',
      ['call', contract, 'contenthash(uint256)(bytes)', tokenId, '--rpc-url', rpcUrl],
      { encoding: 'utf8' },
    )
    if (result.status === 0) records[name] = result.stdout.trim()
  }
  return records
}

/** What is wrong with the command line and environment; empty when the run can start. */
export function usageReasons(argv: string[], env: NodeJS.ProcessEnv): string[] {
  const reasons: string[] = []
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const flags = argv.filter((arg) => arg.startsWith('--'))
  if (positional.length !== 1) reasons.push('give exactly one CID')
  for (const flag of flags) if (flag !== '--broadcast') reasons.push(`unknown option ${flag}`)
  if (!env.MAINNET_RPC_URL) reasons.push('MAINNET_RPC_URL is not set')
  if (!env.NOESIS_NAMES_ACCOUNT) reasons.push('NOESIS_NAMES_ACCOUNT is not set')
  return reasons
}

function main(): void {
  const argv = process.argv.slice(2)
  const reasons = usageReasons(argv, process.env)
  if (reasons.length > 0) {
    console.error('usage: pnpm release:point <cid> [--broadcast]')
    for (const reason of reasons) console.error(`  - ${reason}`)
    process.exit(1)
  }
  const cid = argv.find((arg) => !arg.startsWith('--')) as string
  const broadcast = argv.includes('--broadcast')

  const contenthash = contenthashFor(cid)
  console.log(`point: ${cid}`)
  console.log(`point: contenthash ${contenthash}`)

  const result = spawnSync(
    'forge',
    forgeArgs({
      contenthash,
      rpcUrl: process.env.MAINNET_RPC_URL as string,
      account: process.env.NOESIS_NAMES_ACCOUNT as string,
      broadcast,
    }),
    { cwd: CONTRACTS_DIR, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error('point: FAILED — forge script exited', result.status)
    process.exit(1)
  }
  if (!broadcast) {
    console.log('point: simulated only, nothing was signed; run again with --broadcast to send')
    return
  }
  const mismatches = recordReasons(readRecords(process.env.MAINNET_RPC_URL as string), contenthash)
  if (mismatches.length > 0) {
    console.error('point: FAILED — the chain does not carry the new record')
    for (const reason of mismatches) console.error(`  - ${reason}`)
    process.exit(1)
  }
  console.log(`point: ok — both names carry ${cid} on chain; next: pnpm release:verify ${cid}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main()
  } catch (error: unknown) {
    console.error('point: FAILED —', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
