/**
 * Post-create merkle-allowlist authoring + resolution (noesis-080). Pure TS (no React/wagmi), mirrors
 * `app/src/lib/merkle.ts` (the byte-identical leaf/root/proof primitives, done in #26) one layer up: this
 * module turns owner input (a hosted listURI OR a small pasted list) into the on-chain `MerkleConfig` +
 * the `allowlists` row persisted in `CollectionMetadata`, and turns a persisted row back into a connected
 * wallet's proof at mint time.
 *
 * Two owner input paths (spec §2):
 *   - HOSTED: the owner already hosts `{address,maxQty}[]` at a URL (ipfs://, ar://, https://) — we
 *     fetch + parse + root it, and `listURI` is that same URL (the mint page re-fetches it identically).
 *   - PASTE: the owner types/pastes a small list inline — we build the SAME root in-memory and self-host
 *     the entries as a `data:application/json,` URI so the mint page's fetch path is identical either
 *     way. Keep this to TINY lists — a large list as a data-URI in `metadataURI` is gas-heavy (persisted
 *     on-chain via `MasterRegistry.updateInstanceMetadata`).
 *
 * DENOMINATION (noesis-266). A creator authors caps in NFTs and the hosted list states them in NFTs, but
 * `MerkleGatingModule` compares the leaf's cap against whatever the calling instance forwards — an NFT
 * count on ERC-1155, coin at wei scale on ERC-404. So every entry point here takes an explicit
 * `qtyScale` (`merkle.ts`'s `NO_QTY_SCALE` for ERC-1155, the instance's `unit()` for ERC-404) and the
 * leaves are built through `scaleQty`. Build and resolve MUST be handed the same scale: disagree and
 * every proof fails to verify, which is indistinguishable from the bug the scaling exists to fix.
 */
import { getAddress, isAddress, type Hex } from 'viem'
import { fetchJson, jsonOrNull, type CollectionMetadata, type AllowlistRow } from '../metadata'
import {
  buildMerkleRoot,
  getProof,
  parseAllowlist,
  scaleAllowlist,
  type AllowlistEntry,
} from '../merkle'

/** The `MerkleConfig` shape `MerkleGatingModule.configureFor` expects (uint256 fields → bigint). */
export interface MerkleConfigInput {
  editionId: bigint
  roots: Hex[]
  tierOpenTimes: bigint[]
}

/** Successful build: a rooted allowlist ready to submit on-chain + persist. */
export interface AllowlistBuildResult {
  /** Entries as the creator authored them — caps in NFTs, matching what `listURI` serves. */
  entries: AllowlistEntry[]
  /**
   * The same entries with every cap put through `scaleQty` into the instance's own denomination. These
   * are what `root` commits to and what a mint-time proof is checked against; on ERC-404 they are coin
   * wei, not NFTs. Never render these to a creator.
   */
  leafEntries: AllowlistEntry[]
  /** The scale applied (see `qtyScale` on the build functions) — `NO_QTY_SCALE` when none was. */
  qtyScale: bigint
  root: Hex
  count: number
  /** The URI to persist in `CollectionMetadata.allowlists[].listURI` (hosted URL or self-hosted data:). */
  listURI: string
  invalid: string[]
  duplicates: number
}

/** Failed build: nothing parsed to a usable non-empty allowlist. */
export interface AllowlistBuildError {
  error: string
  invalid: string[]
}

export type AllowlistBuildOutcome = AllowlistBuildResult | AllowlistBuildError

export function isAllowlistBuildError(
  outcome: AllowlistBuildOutcome,
): outcome is AllowlistBuildError {
  return 'error' in outcome
}

function fromParsed(
  parsed: ReturnType<typeof parseAllowlist>,
  listURI: string,
  qtyScale: bigint,
): AllowlistBuildOutcome {
  if (parsed.entries.length === 0) {
    return { error: 'no valid address,maxQty rows found', invalid: parsed.invalid }
  }
  const leafEntries = scaleAllowlist(parsed.entries, qtyScale)
  const { root, count } = buildMerkleRoot(leafEntries)
  return {
    entries: parsed.entries,
    leafEntries,
    qtyScale,
    root,
    count,
    listURI,
    invalid: parsed.invalid,
    duplicates: parsed.duplicates,
  }
}

/**
 * HOSTED path: fetch `uri` (ipfs:///ar:///https:///data:, via the same resolver the collection page
 * uses), parse it as an allowlist, and root it. `listURI` on the result is the SAME `uri` passed in —
 * the mint page fetches this exact pointer. Network/parse failure → `AllowlistBuildError`.
 */
export async function buildAllowlistFromUri(
  uri: string,
  qtyScale: bigint,
  signal?: AbortSignal,
): Promise<AllowlistBuildOutcome> {
  const trimmed = uri.trim()
  if (trimmed === '') return { error: 'enter a listURI', invalid: [] }
  const json = jsonOrNull(await fetchJson(trimmed, signal))
  if (json === null) return { error: `could not fetch or parse ${trimmed}`, invalid: [] }
  return fromParsed(parseAllowlist(json), trimmed, qtyScale)
}

/**
 * PASTE path: `raw` is owner-typed text (see `parseAllowlist` for the accepted shapes). Builds the SAME
 * root as the hosted path would for the identical entries, and self-hosts the entries as a
 * `data:application/json,` URI so the mint page's fetch path is identical either way. Keep to tiny
 * lists — this URI round-trips through `MasterRegistry.updateInstanceMetadata`.
 */
export function buildAllowlistFromPaste(raw: string, qtyScale: bigint): AllowlistBuildOutcome {
  const parsed = parseAllowlist(raw)
  if (parsed.entries.length === 0) {
    return { error: 'no valid address,maxQty rows found', invalid: parsed.invalid }
  }
  // Self-host the entries AS TYPED, in NFTs. The scale is re-applied on the resolve path from the
  // instance's own `unit()`, so the hosted list stays readable and stays valid if it is ever re-rooted.
  const listURI = selfHostDataUri(parsed.entries)
  return fromParsed(parsed, listURI, qtyScale)
}

/** Self-host a small entry list as an inline `data:application/json,` URI (fetchable by `fetchJson`). */
function selfHostDataUri(entries: AllowlistEntry[]): string {
  const json = JSON.stringify(
    entries.map((e) => ({ address: e.address, maxQty: e.maxQty.toString() })),
  )
  return `data:application/json,${encodeURIComponent(json)}`
}

/**
 * Build the `MerkleConfig` argument for `MerkleGatingModule.configureFor` from a computed root — a
 * single-tier, open-immediately configuration (`tierOpenTimes: [0n]`). `editionId` defaults to `0n`
 * (ERC404's single curve; ERC1155 single-list authoring also targets edition 0 — spec's out-of-scope
 * multi-edition/multi-tier authoring is future work).
 */
export function toMerkleConfig(root: Hex, editionId = 0n): MerkleConfigInput {
  return { editionId, roots: [root], tierOpenTimes: [0n] }
}

/**
 * Add/replace the `(editionId,tierIndex)` allowlist row in a parsed `CollectionMetadata`, returning a
 * new object (idempotent — re-running with the same key replaces, not duplicates). Callers re-emit via
 * `buildCollectionJson`/`collectionToDataUri` and write the result with `updateInstanceMetadata`.
 */
export function patchAllowlistRow(
  metadata: CollectionMetadata,
  row: AllowlistRow,
): CollectionMetadata {
  const existing = metadata.allowlists ?? []
  const filtered = existing.filter(
    (r) => !(r.editionId === row.editionId && r.tierIndex === row.tierIndex),
  )
  return { ...metadata, allowlists: [...filtered, row] }
}

/** A resolved member's proof: what to encode on-chain, and what to say to the holder. */
export interface MemberProof {
  proof: Hex[]
  /** The cap committed in the leaf, in the instance's own denomination — encode this, never render it. */
  maxQty: bigint
  /** The same cap in NFTs, as the creator authored it — render this, never encode it. */
  maxQtyNfts: bigint
}

/** Look up the `listURI` for a given (editionId,tierIndex) — `undefined` when not yet configured. */
export function findAllowlistListURI(
  metadata: CollectionMetadata | undefined,
  editionId: number,
  tierIndex = 0,
): string | undefined {
  return metadata?.allowlists?.find((r) => r.editionId === editionId && r.tierIndex === tierIndex)
    ?.listURI
}

/**
 * Mint-side resolution: fetch `listURI`, parse it, scale it with the SAME `qtyScale` the root was built
 * under, and return the connected wallet's proof — or `null` when the wallet isn't on the list (or the
 * list can't be fetched/parsed). Callers ABI-encode `{proof, maxQty}` into `gatingData` (see
 * `erc1155/gatingMint.ts` / `erc404/gating.ts`'s merkle encoders) and show `maxQtyNfts` to the holder.
 */
export async function resolveMemberProof(
  listURI: string,
  address: `0x${string}`,
  qtyScale: bigint,
  signal?: AbortSignal,
): Promise<MemberProof | null> {
  if (!isAddress(address, { strict: false })) return null
  const json = jsonOrNull(await fetchJson(listURI, signal))
  if (json === null) return null
  const { entries } = parseAllowlist(json)
  if (entries.length === 0) return null
  const target = getAddress(address)
  const authored = entries.find((e) => e.address.toLowerCase() === target.toLowerCase())
  if (authored === undefined) return null
  const proven = getProof(scaleAllowlist(entries, qtyScale), target)
  if (proven === null) return null
  return { proof: proven.proof, maxQty: proven.maxQty, maxQtyNfts: authored.maxQty }
}
