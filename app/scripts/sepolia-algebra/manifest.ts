/**
 * The Algebra Integral 1.2.1 set as deployed on Ethereum mainnet, by role.
 *
 * This file holds ADDRESSES ONLY. No source, no bytecode, no ABI JSON of the Algebra/Cypher set is
 * committed to this repository — the fetch tool pulls those into `artifacts/`, which is gitignored.
 * The addresses below are the same ones `contracts/script/DeployMainnet.s.sol` already carries.
 *
 * Three further roles (the token-descriptor implementation behind the proxy, its linked
 * NFTDescriptor library, and the original deployer account) are NOT listed here: they are resolved
 * at fetch time from on-chain state and explorer metadata, and land in `artifacts/resolved.json`.
 */

export type Role =
  | 'nftDescriptorLibrary'
  | 'tokenDescriptorImpl'
  | 'tokenDescriptor'
  | 'algebraFactory'
  | 'poolDeployer'
  | 'positionManager'
  | 'swapRouter'
  | 'pluginFactory'

export interface RoleSpec {
  readonly role: Role
  readonly label: string
  /** Mainnet address, when it is a fixed part of the published set. Resolved at fetch time if absent. */
  readonly mainnet?: `0x${string}`
  /** Verified on the mainnet explorer? A proxy shell may not be; its creation input is still exact. */
  readonly verified: boolean
  readonly note?: string
}

/** The published set (Algebra Integral v1.2.1-integral, commit 662252ef, solc 0.8.20). */
export const PUBLISHED_SET: readonly RoleSpec[] = [
  {
    role: 'algebraFactory',
    label: 'AlgebraFactory',
    mainnet: '0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0',
    verified: true,
  },
  {
    role: 'poolDeployer',
    label: 'AlgebraPoolDeployer',
    mainnet: '0x42ac1BeF3F25c29Bbe5E06ef5DF3D00Ead7cF20f',
    verified: true,
  },
  {
    role: 'positionManager',
    label: 'NonfungiblePositionManager',
    mainnet: '0x0a984a446A116335ac90425d2D1E69A7199A2f7c',
    verified: true,
  },
  {
    role: 'swapRouter',
    label: 'SwapRouter',
    mainnet: '0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab',
    verified: true,
  },
  {
    role: 'pluginFactory',
    label: 'CypherBasePluginFactory',
    mainnet: '0xb6e39Ac5476FEfF07933b5424204DE95c95068a2',
    verified: true,
  },
  {
    role: 'tokenDescriptor',
    label: 'TokenDescriptorProxy',
    mainnet: '0x6E80E39BF2fD98bbBCA67Fe6c9967E01dFB84f74',
    verified: false,
    note: 'Transparent proxy shell; its constructor arguments are read out of the creation input.',
  },
] as const

/** Resolved at fetch time from chain/explorer, not committed. */
export const RESOLVED_ROLES: readonly RoleSpec[] = [
  {
    role: 'tokenDescriptorImpl',
    label: 'TokenDescriptorImplementation',
    verified: true,
    note: 'Read from the proxy ERC-1967 implementation slot.',
  },
  {
    role: 'nftDescriptorLibrary',
    label: 'NFTDescriptorLibrary',
    verified: true,
    note: 'Read from the implementation’s linked-library metadata.',
  },
] as const

/**
 * Deployment order. Every address is CREATE-derived from one sequential deployer account, so the
 * whole set is predicted before the first transaction and cross-references never need patching
 * after the fact.
 */
export const DEPLOY_ORDER: readonly Role[] = [
  'nftDescriptorLibrary',
  'tokenDescriptorImpl',
  'tokenDescriptor',
  'algebraFactory',
  'poolDeployer',
  'positionManager',
  'swapRouter',
  'pluginFactory',
] as const

export const ALL_ROLES: readonly Role[] = DEPLOY_ORDER

/** ERC-1967 implementation slot: keccak256('eip1967.proxy.implementation') - 1. */
export const ERC1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const

export const DEFAULT_MAINNET_EXPLORER = 'https://eth.blockscout.com'
export const DEFAULT_MAINNET_RPC = 'https://ethereum-rpc.publicnode.com'

export function specFor(role: Role): RoleSpec {
  const found = [...PUBLISHED_SET, ...RESOLVED_ROLES].find((s) => s.role === role)
  if (!found) throw new Error(`unknown role: ${role}`)
  return found
}
