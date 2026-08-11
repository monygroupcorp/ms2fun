/**
 * tierErrorCopy — maps a decoded tier-op revert reason (from `txErrorReason`, see useTxAction.ts) to
 * a holder-actionable sentence. `txErrorReason` may return the bare selector name (`"TierOpFailed()"`)
 * or a composite `"<shortMessage> (<Name>())"`, so this matches on the name appearing anywhere in the
 * reason, not on equality against a whole string.
 *
 * `TierOpFailed` is ambiguous by design — the Ops module is reached through a delegatecall trampoline
 * that discards returndata, so every specific Ops revert arrives as this one selector. Its copy names
 * what to check, never a cause; do not add one.
 *
 * An unrecognised or absent reason returns `undefined` so the caller falls back to the raw reason —
 * that is strictly more useful than a wrong guess, so this never returns a generic "something went
 * wrong" placeholder.
 */
const TIER_ERROR_COPY: Array<[name: string, copy: string]> = [
  [
    'TierOpFailed',
    'The op did not go through and no cause is reported. Check that the ladder is still sealed as ' +
      'expected, that you still own the id, and that your balance covers the escrow the op needs — ' +
      'coin already escrowed behind a band NFT cannot fund another.',
  ],
  [
    'NotTierZeroId',
    'The id given is not an ordinary id you own, or it sits above the ordinary range.',
  ],
  ['NotBandId', 'That id is not a band NFT you own.'],
  ['InvalidBand', "The tier chosen is not on this collection's ladder."],
  ['TiersNotConfigured', 'This collection has no tier ladder; nothing to mint up or down into.'],
  [
    'NothingToClaim',
    'No escrow is waiting; a claim already landed, or nothing has been released yet.',
  ],
  [
    'EscrowReleaseFailed',
    'The release could not be paid out; the claim can be retried and the credit is not lost.',
  ],
  [
    'UnapprovedResolver',
    'The metadata resolver this collection points at is not approved, so the launch or metadata ' +
      'write cannot proceed.',
  ],
]

export function tierErrorCopy(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined
  return TIER_ERROR_COPY.find(([name]) => reason.includes(name))?.[1]
}
