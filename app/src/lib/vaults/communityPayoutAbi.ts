/**
 * Hand-written ABI slice for the community-payout surface (`components/vault/CommunityPayoutPanel`).
 *
 * Two reasons it is hand-written rather than generated. The liquidity-family vaults
 * (`UniAlignmentVault`, `CypherAlignmentVault`, `ZAMMAlignmentVault`) have no generated bindings at
 * all — `wagmi.config.ts` does not include them, and pulling three large ABIs in would swamp this
 * change with an unrelated regen diff, the same reasoning `lib/tithe/abis.ts` records. And the
 * endowment vault's generated ABI is now large enough that inferring over it inside a batched read
 * trips TS2589, which is why `useVaultsSummary` keeps its own slice too.
 *
 * The names below are uniform across the four vault families where they exist at all:
 *   - `accumulatedTargetFees()` — every family: the target's cut that accrued while the community
 *     sink was unset, held by the vault rather than dropped.
 *   - `withdrawTargetFees()` — liquidity families only: delivers that balance to the registry's
 *     `getCommunityPayout(targetId)`, resolved at send time.
 *   - `flushTargetFees()` — the endowment vault's equivalent of the above.
 *   - `deployableCorpus()` / `releaseCorpusToCommunity()` — endowment only: the vested corpus an
 *     ambassador may deploy while the target is curated, and the one exit it has once the target is
 *     de-curated and `execute` is frozen.
 *   - `communityPayout()` — endowment only: the clone's own stored sink, seeded from the registry at
 *     deploy. The vault's `_targetSink()` prefers the registry's live answer and falls back to this,
 *     so a reader that consults only the registry calls an endowment vault unwired when it is not.
 *
 * Every write here is permissionless and takes no destination argument — the sink is read from the
 * registry inside the call — so exposing them is a delivery button, not an authority.
 */
export const communityPayoutAbi = [
  {
    type: 'function',
    name: 'accumulatedTargetFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'communityPayout',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deployableCorpus',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdrawTargetFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'flushTargetFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'releaseCorpusToCommunity',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const
