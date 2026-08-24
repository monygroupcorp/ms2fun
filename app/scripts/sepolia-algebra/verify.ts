/**
 * Byte-fidelity and fee-regime verifier for an Algebra Integral 1.2.1 standup. Read-only.
 *
 *   pnpm exec tsx scripts/sepolia-algebra/verify.ts --rpc <url> [--deployment <path>]
 *
 * For every contract in the deployment record it fetches the runtime code at the deployed address
 * and byte-compares it against the mainnet runtime, masking only the ranges that are allowed to
 * differ. Exit 0 means byte-identical outside the masked ranges; exit 1 prints a hex diff summary.
 *
 * How the masks are derived — no compiler metadata, no hand-written offsets:
 *
 *  1. Solidity carries the runtime code verbatim inside the creation input, with every immutable
 *     slot left as zero bytes. Locating that window and diffing it against the mainnet runtime
 *     yields the immutable ranges exactly. The window is accepted only if every differing byte is
 *     zero in the template, so a template that does not correspond to the deployed code fails
 *     rather than masking a real difference.
 *  2. Addresses the runner substituted (linked library, and cross-references baked into code) are
 *     located by searching the mainnet runtime for the mainnet address.
 *
 * Every masked range is printed with its mainnet value. Where the mainnet value is one of the
 * addresses the runner substituted, the range is checked positively — the deployment must hold the
 * substituted address, not merely something different. Ranges that cannot be pinned that way
 * (chain-dependent immutables) are printed as unconstrained so the claim stays auditable.
 *
 * Byte fidelity covers the code; the community-fee regime lives in storage, so it is additionally
 * asserted on the target chain against the values fetched from mainnet: the factory points at the
 * deployed vault factory, the stub points back at the deployed community vault, the factory's
 * default community fee matches mainnet, and the vault's Algebra fee share matches mainnet. The
 * three vault role holders are operator addresses by design and are printed, not asserted against
 * mainnet.
 */
import { createPublicClient, http, parseAbi } from 'viem'

import type { Role } from './manifest.ts'
import {
  type Hex,
  type MaskRange,
  type Substitution,
  deriveMasks,
  latestDeployment,
  parseArgs,
  readArtifact,
  readResolved,
  requireString,
  scopedTo,
  strip0x,
  toBytes,
  toHex,
} from './lib.ts'

const FACTORY_ABI = parseAbi([
  'function vaultFactory() view returns (address)',
  'function defaultCommunityFee() view returns (uint16)',
])

const VAULT_FACTORY_ABI = parseAbi([
  'function defaultAlgebraCommunityVault() view returns (address)',
])

const VAULT_ABI = parseAbi([
  'function algebraFee() view returns (uint16)',
  'function algebraFeeManager() view returns (address)',
  'function algebraFeeReceiver() view returns (address)',
  'function communityFeeReceiver() view returns (address)',
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function describe(mask: MaskRange): string {
  const where = `[${mask.start}..${mask.end}]`.padEnd(16)
  const kind = mask.kind.padEnd(12)
  const target = mask.expected ? `-> ${mask.expected} (${mask.expectedWhat})` : '-> unconstrained'
  return `    ${where} ${kind} ${mask.mainnetValue} ${target}`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const rpc = requireString(args, 'rpc', 'the RPC endpoint the set was deployed to')
  const record = latestDeployment(typeof args.deployment === 'string' ? args.deployment : undefined)
  const resolved = readResolved()

  const client = createPublicClient({ transport: http(rpc) })
  const chainId = await client.getChainId()
  if (chainId !== record.chainId) {
    throw new Error(`record is for chain ${record.chainId} but --rpc is chain ${chainId}`)
  }

  const subs: Substitution[] = record.contracts.map((c) => ({
    what: c.role,
    from: readArtifact(c.role).address,
    to: c.address,
  }))
  subs.push({ what: 'wnative', from: resolved.mainnetWNative, to: record.wnative })
  subs.push({
    what: 'proxyAdmin',
    from: resolved.originalDeployer,
    to: record.proxyAdmin,
    only: 'tokenDescriptor',
  })
  subs.push({
    what: 'algebraFeeManager',
    from: resolved.vaultConfig.constructorFeeManager,
    to: record.algebraFeeManager,
    only: 'communityVault',
  })

  console.log(`chain     ${chainId}`)
  console.log(`deployer  ${record.deployer}`)
  console.log(`wnative   ${record.wnative}`)
  console.log('fidelity:')

  let failures = 0
  for (const deployed of record.contracts) {
    const artifact = readArtifact(deployed.role as Role)
    let derived: ReturnType<typeof deriveMasks>
    try {
      derived = deriveMasks(artifact, scopedTo(subs, deployed.role))
    } catch (err: unknown) {
      // A mask that cannot be derived is a failure of this contract, not of the run: the remaining
      // contracts are still checked and reported.
      console.log(`  FAIL ${artifact.label.padEnd(30)} ${deployed.address}`)
      console.log(`    !! ${err instanceof Error ? err.message : String(err)}`)
      failures++
      continue
    }
    const { masks, templateOffset } = derived

    const onChain = await client.getCode({ address: deployed.address })
    if (!onChain) {
      console.log(`  FAIL ${artifact.label}: no code at ${deployed.address}`)
      failures++
      continue
    }
    const actual = toBytes(onChain)
    const expected = toBytes(artifact.runtime)

    const problems: string[] = []
    if (actual.length !== expected.length) {
      problems.push(`length ${actual.length}B, mainnet ${expected.length}B`)
    }

    const masked = new Uint8Array(expected.length)
    for (const mask of masks) for (let i = mask.start; i <= mask.end; i++) masked[i] = 1

    const diffs: number[] = []
    const limit = Math.min(actual.length, expected.length)
    for (let i = 0; i < limit; i++) {
      if (masked[i]) continue
      if (actual[i] !== expected[i]) diffs.push(i)
    }
    if (diffs.length > 0) {
      const shown = diffs.slice(0, 8)
      const detail = shown
        .map(
          (i) =>
            `@${i} mainnet=${toHex(expected.subarray(i, i + 1)).slice(2)} ` +
            `deployed=${toHex(actual.subarray(i, i + 1)).slice(2)}`,
        )
        .join(', ')
      problems.push(
        `${diffs.length} unmasked byte(s) differ: ${detail}${diffs.length > 8 ? ', …' : ''}`,
      )
    }

    for (const mask of masks) {
      if (!mask.expected) continue
      if (mask.end >= actual.length) {
        problems.push(
          `masked range [${mask.start}..${mask.end}] is past the end of the deployed code`,
        )
        continue
      }
      const got = toHex(actual.subarray(mask.start, mask.end + 1)) as Hex
      if (strip0x(got) !== strip0x(mask.expected)) {
        problems.push(
          `masked range [${mask.start}..${mask.end}] (${mask.expectedWhat}) holds ${got}, expected ${mask.expected}`,
        )
      }
    }

    const status = problems.length === 0 ? 'OK  ' : 'FAIL'
    if (problems.length > 0) failures++
    console.log(
      `  ${status} ${artifact.label.padEnd(30)} ${deployed.address}  ${expected.length}B  ` +
        `${masks.length} masked range(s), template @${templateOffset}`,
    )
    for (const mask of masks) console.log(describe(mask))
    for (const problem of problems) console.log(`    !! ${problem}`)
  }

  // Byte fidelity says the code is right; it says nothing about the configuration the code reads.
  // The fee regime lives entirely in storage, so it is asserted here against the values fetched
  // from mainnet rather than narrated in the runbook.
  console.log('fee regime:')
  const factory = record.contracts.find((c) => c.role === 'algebraFactory')
  const vaultFactory = record.contracts.find((c) => c.role === 'vaultFactory')
  const communityVault = record.contracts.find((c) => c.role === 'communityVault')
  if (!factory || !vaultFactory || !communityVault) {
    console.log('  !! the deployment record has no factory / vault factory / community vault')
    failures++
  } else {
    const check = (what: string, got: string, want: string): void => {
      const ok = got.toLowerCase() === want.toLowerCase()
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what.padEnd(30)} ${got}${ok ? '' : ` != ${want}`}`)
      if (!ok) failures++
    }

    const wiredVaultFactory = await client.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'vaultFactory',
    })
    if (wiredVaultFactory === ZERO_ADDRESS) {
      console.log('  FAIL vaultFactory is unset — the factory cannot carry a community fee')
      failures++
    } else {
      check('factory.vaultFactory', wiredVaultFactory, vaultFactory.address)
    }

    check(
      'stub.defaultCommunityVault',
      await client.readContract({
        address: vaultFactory.address,
        abi: VAULT_FACTORY_ABI,
        functionName: 'defaultAlgebraCommunityVault',
      }),
      communityVault.address,
    )

    check(
      'factory.defaultCommunityFee',
      String(
        await client.readContract({
          address: factory.address,
          abi: FACTORY_ABI,
          functionName: 'defaultCommunityFee',
        }),
      ),
      String(resolved.factoryConfig.defaultCommunityFee),
    )

    check(
      'vault.algebraFee',
      String(
        await client.readContract({
          address: communityVault.address,
          abi: VAULT_ABI,
          functionName: 'algebraFee',
        }),
      ),
      String(resolved.vaultConfig.algebraFee),
    )

    // The role holders are operator addresses by design — mainnet's are third-party accounts with
    // no test-network counterpart. They are printed, not asserted against mainnet.
    for (const [role, want] of [
      ['vault.algebraFeeManager', record.algebraFeeManager],
      ['vault.algebraFeeReceiver', record.algebraFeeReceiver],
      ['vault.communityFeeReceiver', record.communityFeeReceiver],
    ] as const) {
      const got = await client.readContract({
        address: communityVault.address,
        abi: VAULT_ABI,
        functionName: role.split('.')[1] as
          | 'algebraFeeManager'
          | 'algebraFeeReceiver'
          | 'communityFeeReceiver',
      })
      const ok = got.toLowerCase() === want.toLowerCase()
      console.log(`  ${ok ? 'OK  ' : 'note'} ${role.padEnd(30)} ${got}`)
      if (!ok) console.log(`       requested ${want} — the role was not applied`)
    }
  }

  if (record.deviations.length > 0) {
    console.log('recorded configuration deviations:')
    for (const d of record.deviations) console.log(`  - ${d}`)
  }

  if (failures > 0) {
    console.log(`FAIL: ${failures} check(s) do not match mainnet.`)
    process.exitCode = 1
    return
  }
  console.log(
    `OK: ${record.contracts.length} contracts are byte-identical to mainnet outside the masked ranges ` +
      'printed above, and the fee regime matches the values read from mainnet.',
  )
}

main().catch((err: unknown) => {
  console.error(`verify failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
