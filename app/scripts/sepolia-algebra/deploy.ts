/**
 * Replay the mainnet Algebra Integral 1.2.1 creation transactions on another chain.
 *
 *   PRIVATE_KEY=0x... pnpm exec tsx scripts/sepolia-algebra/deploy.ts \
 *     --rpc <url> --wnative <address> [--proxy-admin <address>] \
 *     [--algebra-fee-manager <address>] [--community-fee-receiver <address>] \
 *     [--algebra-fee-receiver <address>]
 *
 * The exact creation input fetched from mainnet is broadcast unchanged except for address
 * substitution: the wrapped-native token becomes `--wnative`, and every cross-reference inside the
 * set (factory, pool deployer, descriptor, linked library, proxy admin, community vault, vault
 * factory) becomes the corresponding address on the target chain. Every address is CREATE-derived
 * from one sequential account, so the whole set is predicted before the first transaction and each
 * receipt is asserted against its prediction.
 *
 * The community vault's three role accounts are operator addresses, all defaulting to the deployer:
 * mainnet's fee-manager and receiver accounts are third parties with no test-network counterpart,
 * so the runner reproduces the fee MECHANISM (a wired vault factory, the mainnet default community
 * fee, the mainnet Algebra fee share) rather than the mainnet accounts.
 *
 * The private key is read from the environment, never from the command line. The deployed
 * addresses and transaction hashes are written to the gitignored `artifacts/deployments/`.
 *
 * This tool does not choose a network. Pass the RPC you intend to deploy to.
 */
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { DEPLOY_ORDER, type Role } from './manifest.ts'
import {
  ARTIFACT_DIR,
  type DeployedContract,
  type DeploymentRecord,
  type Hex,
  type Substitution,
  normalizeAddress,
  parseArgs,
  readArtifact,
  readResolved,
  requireString,
  scopedTo,
  strip0x,
  substituteAddresses,
  writeJson,
} from './lib.ts'

const FACTORY_ABI = parseAbi([
  'function defaultPluginFactory() view returns (address)',
  'function vaultFactory() view returns (address)',
  'function defaultFee() view returns (uint16)',
  'function defaultTickspacing() view returns (int24)',
  'function defaultCommunityFee() view returns (uint16)',
  'function setDefaultPluginFactory(address newDefaultPluginFactory)',
  'function setVaultFactory(address newVaultFactory)',
  'function setDefaultFee(uint16 newDefaultFee)',
  'function setDefaultTickspacing(int24 newDefaultTickspacing)',
  'function setDefaultCommunityFee(uint16 newDefaultCommunityFee)',
])

const VAULT_ABI = parseAbi([
  'function algebraFee() view returns (uint16)',
  'function changeCommunityFeeReceiver(address newCommunityFeeReceiver)',
  'function changeAlgebraFeeReceiver(address newAlgebraFeeReceiver)',
  'function proposeAlgebraFeeChange(uint16 newAlgebraFee)',
  'function acceptAlgebraFeeChangeProposal(uint16 newAlgebraFee)',
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function requirePrivateKey(envName: string): Hex {
  const raw = process.env[envName]
  if (!raw)
    throw new Error(`${envName} is not set (the key is read from the environment, never from argv)`)
  const key = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error(`${envName} is not a 32-byte hex private key`)
  return key as Hex
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const rpc = requireString(args, 'rpc', 'the RPC endpoint to deploy against')
  const wnative = normalizeAddress(
    requireString(args, 'wnative', 'wrapped-native token on the target chain'),
  )
  const keyEnv =
    typeof args['private-key-env'] === 'string' ? args['private-key-env'] : 'PRIVATE_KEY'
  const account = privateKeyToAccount(requirePrivateKey(keyEnv))
  const proxyAdmin =
    typeof args['proxy-admin'] === 'string'
      ? normalizeAddress(args['proxy-admin'])
      : normalizeAddress(account.address)
  const operatorAddress = (key: string): Hex =>
    typeof args[key] === 'string' ? normalizeAddress(args[key]) : normalizeAddress(account.address)
  const algebraFeeManager = operatorAddress('algebra-fee-manager')
  const communityFeeReceiver = operatorAddress('community-fee-receiver')
  const algebraFeeReceiver = operatorAddress('algebra-fee-receiver')

  const publicClient = createPublicClient({ transport: http(rpc) })
  const wallet = createWalletClient({ account, transport: http(rpc) })
  const chainId = await publicClient.getChainId()
  const resolved = readResolved()

  const artifacts = new Map(DEPLOY_ORDER.map((role) => [role, readArtifact(role)]))

  // Every contract is deployed by one account with sequential nonces, so every address in the set is
  // known before the first transaction and no cross-reference has to be patched afterwards.
  const startNonce = await publicClient.getTransactionCount({ address: account.address })
  const predicted = new Map<Role, Hex>()
  DEPLOY_ORDER.forEach((role, i) => {
    predicted.set(
      role,
      normalizeAddress(
        getContractAddress({ from: account.address, nonce: BigInt(startNonce + i) }),
      ),
    )
  })

  const subs: Substitution[] = DEPLOY_ORDER.map((role) => {
    const artifact = artifacts.get(role)
    const to = predicted.get(role)
    if (!artifact || !to) throw new Error(`missing artifact or prediction for ${role}`)
    return { what: role, from: artifact.address, to }
  })
  subs.push({ what: 'wnative', from: resolved.mainnetWNative, to: wnative })
  subs.push({
    what: 'proxyAdmin',
    from: resolved.originalDeployer,
    to: proxyAdmin,
    only: 'tokenDescriptor',
  })
  subs.push({
    what: 'algebraFeeManager',
    from: resolved.vaultConfig.constructorFeeManager,
    to: algebraFeeManager,
    only: 'communityVault',
  })

  const targets = new Set(subs.map((s) => strip0x(s.to)))
  for (const sub of subs) {
    if (targets.has(strip0x(sub.from))) throw new Error(`substitution collision on ${sub.from}`)
  }

  console.log(`chain     ${chainId}`)
  console.log(`rpc       ${rpc}`)
  console.log(`deployer  ${account.address} (nonce ${startNonce})`)
  console.log(`wnative   ${wnative}`)
  console.log(`proxy admin ${proxyAdmin}`)
  console.log('vault roles (operator addresses, not mainnet accounts):')
  console.log(`  algebra fee manager   ${algebraFeeManager}`)
  console.log(`  algebra fee receiver  ${algebraFeeReceiver}`)
  console.log(`  community fee receiver ${communityFeeReceiver}`)
  console.log('deploying:')

  const contracts: DeployedContract[] = []
  for (const [i, role] of DEPLOY_ORDER.entries()) {
    const artifact = artifacts.get(role)
    const expected = predicted.get(role)
    if (!artifact || !expected) throw new Error(`missing artifact or prediction for ${role}`)

    const nonce = await publicClient.getTransactionCount({ address: account.address })
    if (nonce !== startNonce + i) {
      throw new Error(
        `nonce moved under the run (expected ${startNonce + i}, got ${nonce}) — addresses would shift`,
      )
    }

    const { out: data, counts } = substituteAddresses(artifact.creationInput, scopedTo(subs, role))
    const applied = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([what, n]) => `${what}x${n}`)
      .join(' ')

    const hash = await wallet.sendTransaction({ account, chain: null, data, to: null })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success')
      throw new Error(`${artifact.label}: creation transaction reverted (${hash})`)
    const address = normalizeAddress(receipt.contractAddress ?? '0x')
    if (address !== expected)
      throw new Error(`${artifact.label}: deployed to ${address}, predicted ${expected}`)

    contracts.push({
      role,
      label: artifact.label,
      address,
      txHash: hash,
      creationInputHash: keccak256(data),
    })
    console.log(`  ${artifact.label.padEnd(30)} ${address}  [${applied || 'no substitutions'}]`)
  }

  const factory = contracts.find((c) => c.role === 'algebraFactory')
  const pluginFactory = contracts.find((c) => c.role === 'pluginFactory')
  const communityVault = contracts.find((c) => c.role === 'communityVault')
  const vaultFactory = contracts.find((c) => c.role === 'vaultFactory')
  if (!factory || !pluginFactory || !communityVault || !vaultFactory)
    throw new Error('factory, plugin factory or vault pair missing after deploy')

  console.log('wiring:')
  const wiringTxs: { call: string; txHash: Hex }[] = []
  const deviations: string[] = []
  const send = async (call: string, request: Parameters<typeof wallet.writeContract>[0]) => {
    const hash = await wallet.writeContract(request)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${call} reverted (${hash})`)
    wiringTxs.push({ call, txHash: hash })
    console.log(`  ${call}`)
  }

  const cfg = resolved.factoryConfig
  if (cfg.defaultPluginFactory !== ZERO_ADDRESS) {
    await send(`setDefaultPluginFactory(${pluginFactory.address})`, {
      account,
      chain: null,
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'setDefaultPluginFactory',
      args: [pluginFactory.address],
    })
  }

  // The factory rejects a non-zero default community fee while no vault factory is wired, so the
  // vault factory must be pointed at before the fee is set.
  if (cfg.vaultFactory !== ZERO_ADDRESS) {
    await send(`setVaultFactory(${vaultFactory.address})`, {
      account,
      chain: null,
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'setVaultFactory',
      args: [vaultFactory.address],
    })
  } else {
    deviations.push('mainnet has no vault factory wired, so the standup leaves it unset too.')
  }

  const freshFee = Number(
    await publicClient.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultFee',
    }),
  )
  if (freshFee !== cfg.defaultFee) {
    await send(`setDefaultFee(${cfg.defaultFee})`, {
      account,
      chain: null,
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'setDefaultFee',
      args: [cfg.defaultFee],
    })
  }

  const freshTickspacing = Number(
    await publicClient.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultTickspacing',
    }),
  )
  if (freshTickspacing !== cfg.defaultTickspacing) {
    await send(`setDefaultTickspacing(${cfg.defaultTickspacing})`, {
      account,
      chain: null,
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'setDefaultTickspacing',
      args: [cfg.defaultTickspacing],
    })
  }

  const freshCommunityFee = Number(
    await publicClient.readContract({
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'defaultCommunityFee',
    }),
  )
  if (freshCommunityFee !== cfg.defaultCommunityFee) {
    await send(`setDefaultCommunityFee(${cfg.defaultCommunityFee})`, {
      account,
      chain: null,
      address: factory.address,
      abi: FACTORY_ABI,
      functionName: 'setDefaultCommunityFee',
      args: [cfg.defaultCommunityFee],
    })
  }

  // Community vault roles. The receivers are set by the factory owner and the fee manager
  // respectively; the Algebra fee itself is a two-step propose/accept across those two roles. Where
  // an operator hands the fee-manager role to an account this runner does not control, the calls
  // that role owns are recorded as deviations rather than attempted.
  const vaultCfg = resolved.vaultConfig
  const feeManagerIsDeployer = algebraFeeManager === normalizeAddress(account.address)

  await send(`changeCommunityFeeReceiver(${communityFeeReceiver})`, {
    account,
    chain: null,
    address: communityVault.address,
    abi: VAULT_ABI,
    functionName: 'changeCommunityFeeReceiver',
    args: [communityFeeReceiver],
  })

  if (feeManagerIsDeployer) {
    await send(`changeAlgebraFeeReceiver(${algebraFeeReceiver})`, {
      account,
      chain: null,
      address: communityVault.address,
      abi: VAULT_ABI,
      functionName: 'changeAlgebraFeeReceiver',
      args: [algebraFeeReceiver],
    })
  } else {
    deviations.push(
      'algebraFeeReceiver is unset: only the fee manager can set it, and the fee-manager role was ' +
        'handed to an account this runner does not hold. Call changeAlgebraFeeReceiver from it.',
    )
  }

  const freshAlgebraFee = Number(
    await publicClient.readContract({
      address: communityVault.address,
      abi: VAULT_ABI,
      functionName: 'algebraFee',
    }),
  )
  if (freshAlgebraFee !== vaultCfg.algebraFee) {
    if (feeManagerIsDeployer) {
      await send(`proposeAlgebraFeeChange(${vaultCfg.algebraFee})`, {
        account,
        chain: null,
        address: communityVault.address,
        abi: VAULT_ABI,
        functionName: 'proposeAlgebraFeeChange',
        args: [vaultCfg.algebraFee],
      })
      await send(`acceptAlgebraFeeChangeProposal(${vaultCfg.algebraFee})`, {
        account,
        chain: null,
        address: communityVault.address,
        abi: VAULT_ABI,
        functionName: 'acceptAlgebraFeeChangeProposal',
        args: [vaultCfg.algebraFee],
      })
    } else {
      deviations.push(
        `algebraFee stays ${freshAlgebraFee} (mainnet: ${vaultCfg.algebraFee}); the change is proposed by ` +
          'the fee manager, and the fee-manager role was handed to an account this runner does not hold.',
      )
    }
  }

  const record: DeploymentRecord = {
    chainId,
    rpc,
    deployer: normalizeAddress(account.address),
    wnative,
    proxyAdmin,
    algebraFeeManager,
    algebraFeeReceiver,
    communityFeeReceiver,
    startedAt: new Date().toISOString(),
    contracts,
    wiringTxs,
    deviations,
  }
  const outPath = `${ARTIFACT_DIR}/deployments/${chainId}-${record.startedAt.replace(/[:.]/g, '-')}.json`
  writeJson(outPath, record)

  if (deviations.length > 0) {
    console.log('deviations from the mainnet configuration:')
    for (const d of deviations) console.log(`  - ${d}`)
  }
  console.log(`record    ${outPath}`)
  console.log(
    'deploy complete — run verify.ts against this record before wiring the addresses anywhere.',
  )
}

main().catch((err: unknown) => {
  console.error(`deploy failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
