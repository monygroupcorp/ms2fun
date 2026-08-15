/**
 * moneySurfaces.ts (noesis-212) — the ratchet guard for terminal money receipts. Rule: an
 * audit ships a gate, so this list doesn't need re-walking by hand next time.
 *
 * `MONEY_SURFACES` is every component this item's audit found where value leaves or arrives the
 * acting wallet — hand-kept, because judging "does this call move value" is not a lint's job.
 * `UNCONVERTED` is the subset that still confirms with a bare, amountless `successLabel` instead
 * of a `MoneyReceipt`. This list may only SHRINK — see `moneySurfaces.test.ts`.
 *
 * Known weakness, stated rather than hidden: a hand-kept list is only as good as the hand. A
 * brand-new money surface nobody adds here is invisible to this guard — the disk-existence check
 * catches a rename, not an omission. An ABI-level check (does this `functionName` carry a nonzero
 * `value`, or move ETH per the contract's own accounting) would catch that class and is explicitly
 * out of scope for this item.
 */

export const MONEY_SURFACES: string[] = [
  // Converted this item — a money receipt is now required and enforced (see UNCONVERTED below).
  'app/src/components/collection/erc404/Erc404AdminPanel.tsx',
  'app/src/components/collection/erc721/AuctionCard.tsx',
  'app/src/components/collection/erc1155/MintPanel.tsx',
  'app/src/components/admin/TreasuryPanel.tsx',
  'app/src/components/featured/FeaturedPanel.tsx',
  // Not yet converted — still confirm with a bare successLabel.
  'app/src/components/collection/erc404/SwapPanel.tsx',
  'app/src/components/collection/erc404/GraduatedSwapPanel.tsx',
  'app/src/components/Exec404SwapPanel.tsx',
  'app/src/components/collection/erc721/Erc721AdminPanel.tsx',
  'app/src/components/board/BoardCartBar.tsx',
  'app/src/components/collection/erc404/MetadataHolderPanel.tsx',
  'app/src/components/admin/AlignmentPanel.tsx',
  'app/src/components/collection/erc404/StakingPanel.tsx',
]

/** Money surfaces not yet converted. This list may only SHRINK. */
export const UNCONVERTED: string[] = [
  'app/src/components/collection/erc404/SwapPanel.tsx',
  'app/src/components/collection/erc404/GraduatedSwapPanel.tsx',
  'app/src/components/Exec404SwapPanel.tsx',
  'app/src/components/collection/erc721/Erc721AdminPanel.tsx',
  'app/src/components/board/BoardCartBar.tsx',
  'app/src/components/collection/erc404/MetadataHolderPanel.tsx',
  'app/src/components/admin/AlignmentPanel.tsx',
  'app/src/components/collection/erc404/StakingPanel.tsx',
]

/** `UNCONVERTED.length` at merge. Raising this is a visible one-line diff a reviewer must justify. */
export const UNCONVERTED_BUDGET = 8
