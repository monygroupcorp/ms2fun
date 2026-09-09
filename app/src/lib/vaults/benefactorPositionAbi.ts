/**
 * The three liquidity vault families' per-benefactor surface, as one hand-written ABI slice.
 *
 * UniAlignmentVault, ZAMMAlignmentVault and CypherAlignmentVault all implement `IAlignmentVault`,
 * so they declare these reads and these writes identically. None of the three has a generated
 * binding — the wizard never creates a vault directly, the liquidity module deploys one at
 * graduation and the app finds it through the registry — so a slice is how the app addresses them,
 * and `contract-surface.json`'s `aliases` records which contracts it speaks to.
 *
 * The endowment family is deliberately NOT in that alias list even though it declares the same
 * three writes. It implements all three by reverting `NotSupported`: an endowment has no tradable
 * shares to pay a per-caller claim against and no delegation, and its real payout path is
 * `claimYieldPurse` / `vest`, which `VaultPanel` already offers. Pointing a claim button at an
 * endowment would be a button that cannot do anything but revert, so the panel this slice feeds
 * renders for the liquidity families only.
 *
 * `getUnclaimedFees` is Uni's alone. Keeping it here is safe rather than sloppy: a slice credits a
 * contract only for selectors that contract's own ABI actually carries, so ZAMM and Cypher are not
 * credited for a function they do not have.
 */
export const benefactorPositionAbi = [
  {
    type: 'function',
    name: 'getBenefactorContribution',
    inputs: [{ name: 'benefactor', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBenefactorShares',
    inputs: [{ name: 'benefactor', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBenefactorDelegate',
    inputs: [{ name: 'benefactor', type: 'address' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'calculateClaimableAmount',
    inputs: [{ name: 'benefactor', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUnclaimedFees',
    inputs: [{ name: 'benefactor', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimFees',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimFeesAsDelegate',
    inputs: [{ name: 'benefactors', type: 'address[]' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'delegateBenefactor',
    inputs: [{ name: 'delegate', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
