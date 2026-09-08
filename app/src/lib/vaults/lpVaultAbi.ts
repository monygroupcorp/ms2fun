/**
 * The three liquidity vault families' shared delivery surface, as one hand-written ABI slice.
 *
 * UniAlignmentVault, ZAMMAlignmentVault and CypherAlignmentVault declare these four identically —
 * the two accrued-cut counters and the two permissionless pushes that empty them. They have no
 * generated bindings (the wizard never creates one directly; the liquidity module deploys them at
 * graduation, and the app finds them through the registry), so this slice is how the app addresses
 * them, and `contract-surface.json` records which contracts it speaks to.
 *
 * The endowment family is deliberately NOT in scope here: it splits yield on different weights and
 * delivers its target leg through `flushTargetFees`, which the collection's vault panel calls.
 *
 * Both writes are permissionless by design and neither takes a destination: `withdrawProtocolFees`
 * sends to the vault's pinned treasury and `withdrawTargetFees` to
 * `alignmentRegistry.getCommunityPayout(alignmentTargetId)`. A caller can only pay the gas to move
 * an already-accrued cut to the sink it was always going to. That is what makes a public button
 * safe: there is no redirect surface to abuse, and leaving the cut undelivered helps nobody.
 */
export const lpVaultAbi = [
  {
    type: 'function',
    name: 'accumulatedTargetFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'accumulatedProtocolFees',
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
    name: 'withdrawProtocolFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
