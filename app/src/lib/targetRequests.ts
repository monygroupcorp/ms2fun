/**
 * Pure helpers for the "request an alignment target" flow (AlignmentTargetRequestRegistry).
 * No React/wagmi — validation + status/label derivation + "my requests" filtering live here so the
 * UI stays thin and the logic is unit-testable (see targetRequests.test.ts).
 *
 * The request contract mirrors AlignmentRegistryV1.registerAlignmentTarget's validation at submit time
 * so a later approve→register can't revert on the proposed data: nonzero token, non-empty title
 * (≤256 bytes), ≥1 asset, every asset token nonzero, and msg.value == requestDeposit().
 */

/** On-chain Request.status enum (AlignmentTargetRequestRegistry.Status). */
export const RequestStatus = {
  None: 0,
  Pending: 1,
  Approved: 2,
  Rejected: 3,
  Expired: 4,
} as const

/** Human label for a Request.status value — the requester's "my requests" status column. */
export function requestStatusLabel(status: number): string {
  switch (status) {
    case RequestStatus.Pending:
      return 'Pending'
    case RequestStatus.Approved:
      return 'Approved'
    case RequestStatus.Rejected:
      return 'Rejected'
    case RequestStatus.Expired:
      return 'Expired'
    default:
      return 'None'
  }
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** True for a well-formed, nonzero 20-byte address (the contract reverts InvalidAddress on 0x0). */
export function isNonzeroAddress(raw: string): boolean {
  const t = raw.trim()
  return ADDR_RE.test(t) && t.toLowerCase() !== ZERO_ADDRESS
}

/** Title mirrors the contract: non-empty (after trim) and ≤256 UTF-8 bytes. */
export function titleValid(raw: string): boolean {
  const t = raw.trim()
  if (t === '') return false
  return new TextEncoder().encode(t).length <= 256
}

/** One proposed alignment asset as captured by the form (raw strings). */
export interface AssetInput {
  token: string
  symbol: string
  info: string
  metadataURI: string
}

/** An asset is submit-valid iff its token is a nonzero address (symbol/info/URI are free-form). */
export function assetTokenValid(a: AssetInput): boolean {
  return isNonzeroAddress(a.token)
}

export interface RequestFormInput {
  token: string
  title: string
  assets: AssetInput[]
  /** requestDeposit() read from chain — undefined until the read resolves. */
  requestDeposit: bigint | undefined
}

export interface RequestFormValidation {
  tokenOk: boolean
  titleOk: boolean
  /** ≥1 asset AND every asset carries a nonzero token. */
  assetsOk: boolean
  /** requestDeposit() has resolved, so we know the exact value to send. */
  depositReady: boolean
  canSubmit: boolean
}

/** Validate the request form against the contract's submit-time rules. */
export function validateRequestForm(input: RequestFormInput): RequestFormValidation {
  const tokenOk = isNonzeroAddress(input.token)
  const titleOk = titleValid(input.title)
  const assetsOk = input.assets.length > 0 && input.assets.every(assetTokenValid)
  const depositReady = input.requestDeposit !== undefined
  return {
    tokenOk,
    titleOk,
    assetsOk,
    depositReady,
    canSubmit: tokenOk && titleOk && assetsOk && depositReady,
  }
}

/** An alignment asset in the exact tuple shape the contract expects (trimmed). */
export interface ContractAsset {
  token: `0x${string}`
  symbol: string
  info: string
  metadataURI: string
}

/** Trim + cast the form's asset rows into the contract argument shape. */
export function toContractAssets(assets: AssetInput[]): ContractAsset[] {
  return assets.map((a) => ({
    token: a.token.trim() as `0x${string}`,
    symbol: a.symbol.trim(),
    info: a.info.trim(),
    metadataURI: a.metadataURI.trim(),
  }))
}

/**
 * From decoded RequestSubmitted entries, the request ids owned by `me` (case-insensitive),
 * newest first, deduped. RequestSubmitted indexes `requester`, so the log query already filters
 * server-side — this is the pure fallback/guard and the unit-tested core of "my requests".
 */
export function pickMyRequestIds(
  entries: { id: bigint; requester: string }[],
  me: string | undefined,
): bigint[] {
  if (!me) return []
  const meLc = me.toLowerCase()
  const seen = new Set<bigint>()
  const ids: bigint[] = []
  for (const e of entries) {
    if (e.requester.toLowerCase() !== meLc) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    ids.push(e.id)
  }
  ids.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
  return ids
}
