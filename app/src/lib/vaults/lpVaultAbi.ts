/**
 * The three liquidity vault families' protocol-cut surface, as one hand-written ABI slice.
 *
 * UniAlignmentVault, ZAMMAlignmentVault and CypherAlignmentVault declare this counter and this push
 * identically. They have no generated bindings (the wizard never creates one directly; the liquidity
 * module deploys them at graduation, and the app finds them through the registry), so this slice is
 * how the app addresses them, and `contract-surface.json` records which contracts it speaks to.
 *
 * The community's leg of the same split — `accumulatedTargetFees` / `withdrawTargetFees`, and the
 * endowment family's `flushTargetFees` — is addressed through `communityPayoutAbi` instead, next to
 * the registry reads that name the sink it is paid to. The endowment family has no protocol-cut push
 * at all, so it is out of scope here entirely.
 *
 * The write is permissionless by design and takes no destination: `withdrawProtocolFees` sends to
 * the vault's pinned treasury. A caller can only pay the gas to move an already-accrued cut to the
 * sink it was always going to. That is what makes a public button safe: there is no redirect surface
 * to abuse, and leaving the cut undelivered helps nobody.
 */
export const lpVaultAbi = [
  {
    type: 'function',
    name: 'accumulatedProtocolFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdrawProtocolFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
