/**
 * Wizard submit-builder (Phase 3 / T2) — turns the ADR-0005 option-schema field values into a real,
 * ABI-typed `createInstance` call for each factory. This is the seam the T3 review flagged: the
 * generic schema describes the FORM; here we map its `key`-addressed values onto each factory's
 * actual ABI arg layout (which differs — ERC404 puts `salt` inside `params` and lifts
 * `metadataURI`/`liquidityDeployer`/`gatingModule`/`freeMint` to top-level args).
 *
 * Pure TS (no React/wagmi) so it's unit-testable and reusable by NOEMA. The caller resolves the
 * dynamic context (connected wallet, selected vault, assembled metadata URI, a fresh salt, chosen
 * module addresses) and dispatches the returned args to the matching generated write hook.
 *
 * Integer coercion matches viem's ABI inference: uint8/uint40 → `number`, uint256 → `bigint`.
 */
import type { ContractFunctionArgs } from 'viem'
import {
  erc1155FactoryAbi,
  erc404FactoryAbi,
  erc721AuctionFactoryAbi,
} from '../../generated/contracts'
import type { ProjectTypeSchema } from './schema'
import type { TierConfigValue } from './gatingConfig'
import { EMPTY_TIER_CONFIG } from './gatingConfig'
import { hasMetadataConfig, type MetadataConfigValue } from './metadataConfig'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Module addresses chosen in the wizard's module slots (undefined → none → zero address). */
export interface SelectedModules {
  vault: `0x${string}` // required slot
  liquidityDeployer?: `0x${string}` // ERC404 only (required there)
  gatingModule?: `0x${string}`
  stakingModule?: `0x${string}` // ERC404 only
  // ── Metadata-resolution stack (ERC404 only, ADR-0006/0007) — all optional ──
  resolver?: `0x${string}` // MetadataResolverRouter
  overlay?: `0x${string}` // MetadataOverlayModule
  tier?: `0x${string}` // TierRevealModule
}

/** Everything the builder needs beyond the raw form values. */
export interface CreateContext {
  /** Form values keyed by the schema field `key` (raw strings from inputs). */
  values: Record<string, string>
  /** Connected wallet — the `creator`/`owner` of the instance. */
  creator: `0x${string}`
  /** Assembled collection metadata pointer (data:/ipfs URI). */
  metadataURI: string
  /** Fresh CREATE3 salt (the wizard generates it; bound to the creator on-chain). */
  salt: `0x${string}`
  modules: SelectedModules
  /**
   * Optional tier-gating config, applied to `modules.gatingModule` in the SAME create tx via the
   * factory's gated `createInstance` overload. Omitted / empty (no passwordHashes) → the legacy
   * overload is used and the instance is open/unconfigured.
   */
  gatingConfig?: TierConfigValue
  /**
   * Optional metadata-resolution stack (ADR-0006/0007), applied to the ERC404 instance in the SAME
   * create tx via the factory's 7-arg overload. Omitted / off (resolver == zero) → a non-metadata
   * overload is used and the instance has no metadata augmentation. Build it with
   * `encodeMetadataConfig`. Ignored by the ERC1155/721 builders.
   */
  metadataConfig?: MetadataConfigValue
}

type Erc1155Args = ContractFunctionArgs<typeof erc1155FactoryAbi, 'payable', 'createInstance'>
type Erc721Args = ContractFunctionArgs<typeof erc721AuctionFactoryAbi, 'payable', 'createInstance'>
type Erc404Args = ContractFunctionArgs<typeof erc404FactoryAbi, 'payable', 'createInstance'>

/**
 * Discriminated by project type so the caller picks the matching write hook. `value` is the ETH to
 * send (0 for a basic create; any fee is forwarded to the treasury by the factory).
 */
export type CreateCall =
  | { type: 'erc1155'; factory: 'ERC1155Factory'; args: Erc1155Args; value: bigint }
  | { type: 'erc721'; factory: 'ERC721AuctionFactory'; args: Erc721Args; value: bigint }
  | { type: 'erc404'; factory: 'ERC404Factory'; args: Erc404Args; value: bigint }

// ── coercion (viem-aligned) ──────────────────────────────────────────────────
const str = (v: string | undefined): string => v ?? ''
/** uint256 → bigint. Empty/garbage → 0n. */
function big(v: string | undefined): bigint {
  const t = (v ?? '').trim()
  if (t === '') return 0n
  try {
    return BigInt(t)
  } catch {
    return 0n
  }
}
/** uint8/uint40 → number. Empty/garbage → 0. */
function num(v: string | undefined): number {
  const n = Number(v ?? '')
  return Number.isFinite(n) ? n : 0
}
const addr = (a: `0x${string}` | undefined): `0x${string}` => a ?? ZERO_ADDRESS

/**
 * Tier config to thread through the gated overload, or undefined to use the legacy overload.
 * Only threaded when a gating module is selected AND at least one tier was configured.
 */
function gating(c: CreateContext): TierConfigValue | undefined {
  if (!c.modules.gatingModule || c.modules.gatingModule === ZERO_ADDRESS) return undefined
  if (!c.gatingConfig || c.gatingConfig.passwordHashes.length === 0) return undefined
  return c.gatingConfig
}

function freeMint(c: CreateContext): { allocation: bigint; scope: number } {
  return {
    allocation: big(c.values['freeMint.allocation']),
    scope: num(c.values['freeMint.scope']),
  }
}

// ── per-factory builders ─────────────────────────────────────────────────────

export function buildErc1155Create(c: CreateContext): CreateCall {
  const params = {
    name: str(c.values.name),
    metadataURI: c.metadataURI,
    creator: c.creator,
    vault: c.modules.vault,
    styleUri: str(c.values.styleUri),
    gatingModule: addr(c.modules.gatingModule),
    freeMint: freeMint(c),
  }
  const cfg = gating(c)
  // Gated overload threads the tier config; otherwise the 2-arg legacy create.
  const args: Erc1155Args = cfg ? [c.salt, params, cfg] : [c.salt, params]
  return { type: 'erc1155', factory: 'ERC1155Factory', args, value: 0n }
}

export function buildErc721Create(c: CreateContext): CreateCall {
  const args: Erc721Args = [
    c.salt,
    {
      name: str(c.values.name),
      metadataURI: c.metadataURI,
      creator: c.creator,
      vault: c.modules.vault,
      symbol: str(c.values.symbol),
      lines: num(c.values.lines), // uint8
      baseDuration: num(c.values.baseDuration), // uint40
      timeBuffer: num(c.values.timeBuffer), // uint40
      bidIncrement: big(c.values.bidIncrement), // uint256
    },
  ]
  return { type: 'erc721', factory: 'ERC721AuctionFactory', args, value: 0n }
}

export function buildErc404Create(c: CreateContext): CreateCall {
  // ERC404 lifts metadataURI/liquidityDeployer/gatingModule/freeMint to top-level args; salt lives
  // inside params. liquidityDeployer is REQUIRED (the DEX the bonding curve graduates into).
  const params = {
    salt: c.salt,
    name: str(c.values.name),
    symbol: str(c.values.symbol),
    styleUri: str(c.values.styleUri),
    tokenBaseURI: str(c.values.tokenBaseURI),
    owner: c.creator,
    vault: c.modules.vault,
    nftCount: big(c.values.nftCount), // uint256
    presetId: num(c.values.presetId), // uint8
    stakingModule: addr(c.modules.stakingModule),
  }
  const cfg = gating(c)
  const head = [
    params,
    c.metadataURI,
    addr(c.modules.liquidityDeployer),
    addr(c.modules.gatingModule),
    freeMint(c),
  ] as const
  // Overload selection by arity:
  //   - metadata stack on  → 7-arg overload (gating + metadata). The 7-arg form REQUIRES the gating
  //     slot too, so an empty TierConfig is passed when no gating is configured.
  //   - gating only        → 6-arg overload.
  //   - neither            → 5-arg legacy create.
  const meta = c.metadataConfig
  let args: Erc404Args
  if (meta && hasMetadataConfig(meta)) {
    args = [...head, cfg ?? EMPTY_TIER_CONFIG, meta] as Erc404Args
  } else {
    args = (cfg ? [...head, cfg] : [...head]) as Erc404Args
  }
  return { type: 'erc404', factory: 'ERC404Factory', args, value: 0n }
}

/** Dispatch by project type to the matching factory builder. */
export function buildCreateInstance(
  projectType: ProjectTypeSchema['key'],
  c: CreateContext,
): CreateCall {
  switch (projectType) {
    case 'erc1155':
      return buildErc1155Create(c)
    case 'erc721':
      return buildErc721Create(c)
    case 'erc404':
      return buildErc404Create(c)
  }
}
