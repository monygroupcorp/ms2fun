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
import { parseBps } from '../carve'
import type { ProjectTypeSchema } from './schema'
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
   * Refundable creator deploy-bond (N12) to escrow at create, in wei. The ERC404 factory requires
   * `msg.value >= bondAmount` when the lever is ON and forwards the excess to the treasury. Omitted /
   * 0 → lever OFF → create sends no bond (today's behavior). Only the ERC404 builder consumes it.
   */
  bondAmount?: bigint
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
  // The gating module is attached at create (params.gatingModule); its config is authored post-create
  // by the owner. The factory threads no gating config at create.
  const args: Erc1155Args = [c.salt, params]
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
    // uint16, 0–10000. IMMUTABLE creator-carve disclosure. An untouched form submits the schema's
    // displayed default (10000 = full protocol allowance); the field may lower it, down to 0.
    declaredMaxAllowanceBps: parseBps(c.values.declaredMaxAllowanceBps, 10_000),
  }
  const head = [
    params,
    c.metadataURI,
    addr(c.modules.liquidityDeployer),
    addr(c.modules.gatingModule),
    freeMint(c),
  ] as const
  // Overload selection by arity (create-time gating config was removed with PasswordTierGating; the
  // gating module is attached via the slot above and configured post-create by the owner):
  //   - metadata stack on → 6-arg overload (adds MetadataConfig).
  //   - metadata stack off → 5-arg base create.
  const meta = c.metadataConfig
  const args: Erc404Args =
    meta && hasMetadataConfig(meta) ? ([...head, meta] as Erc404Args) : ([...head] as Erc404Args)
  // Lever ON (bondAmount > 0) → send the bond as msg.value; the factory escrows it and forwards any
  // excess to the treasury. Lever OFF → 0n, byte-identical to today's create.
  return { type: 'erc404', factory: 'ERC404Factory', args, value: c.bondAmount ?? 0n }
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
