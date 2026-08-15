/**
 * moneySurfaces.ts (noesis-212, hardened noesis-215) — the ratchet guard for terminal money
 * receipts. Rule: an audit ships a gate, so this list doesn't need re-walking by hand next
 * time.
 *
 * `MONEY_SURFACES` is every component this item's audit found where value leaves or arrives the
 * acting wallet — hand-kept, because judging "does this call move value" is not a lint's job.
 * `UNCONVERTED` is the subset that still confirms with a bare, amountless `successLabel` instead
 * of a `MoneyReceipt`. This list may only SHRINK, and `MONEY_SURFACES` may only GROW — see
 * `moneySurfaces.test.ts`.
 *
 * `CONVERTED_ACTIONS` is the per-money-action census noesis-215 added. A converted FILE can hold
 * several independent money-moving actions (AuctionCard has three: bid, settle, reclaim) plus
 * several non-money config actions (migrate vault, toggle delegation, …) — checking "does this file
 * contain a `formatReceipt` call ANYWHERE" (the original noesis-212 check) is satisfied by exactly
 * one converted action and says nothing about the rest, and a hand-rolled confirmation that never
 * touches `TxButton`'s `successLabel` prop at all was invisible to a regex keyed on that prop. Both
 * were real gaps found on this item's audit (AuctionCard's `createBid` bid confirmation). Each entry
 * here is `{ file, testId }`: `testId` is the `TxButton`'s own `testId` prop (which auto-renders its
 * confirmation as `data-testid="${testId}-success"`, see `TxButton.tsx`) OR, for a hand-rolled
 * confirmation that doesn't use `TxButton`, a `data-testid="${testId}-success"` added directly to the
 * confirmation element so the same lookup convention finds it either way.
 *
 * A few actions inside a `MONEY_SURFACES` file are deliberately NOT in `CONVERTED_ACTIONS` because
 * they don't move value to/from the acting wallet at all, even though a sibling action in the same
 * file does: `Erc404AdminPanel`'s `claimAllFees` sweeps into the INSTANCE's own balance (see the
 * in-file comment on `ClaimAllFeesRow`), and `FeaturedPanel`'s `pruneExpired` is non-payable
 * permissionless cleanup. Both keep a plain `successLabel` on purpose.
 *
 * Known weakness, stated rather than hidden: a hand-kept list is only as good as the hand. A
 * brand-new money surface — or a brand-new money ACTION inside an already-censused file — that
 * nobody adds here is invisible to this guard; the disk-existence check catches a rename, not an
 * omission. An ABI-level check (does this `functionName` carry a nonzero `value`, or move ETH per
 * the contract's own accounting) would catch that class and is explicitly out of scope for this
 * item, same as it was for noesis-212.
 */

export interface MoneyAction {
  /** repo-root-relative path to the component file (must be a MONEY_SURFACES member, not in UNCONVERTED). */
  file: string
  /** The TxButton `testId` prop, or the `data-testid` base for a hand-rolled confirmation — the
   *  guard looks for `data-testid="${testId}-success"` in source either way. */
  testId: string
}

export const MONEY_SURFACES: string[] = [
  // Converted — a money receipt is now required and enforced per-action (see CONVERTED_ACTIONS).
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
  // noesis-215 Step 4: an existing surface the noesis-212 audit missed, in a directory it DID
  // convert (ERC-1155 creator withdraw / claimVaultFees / claimAllFees, real ETH out under the
  // 1/19/80 split — ERC1155Instance.sol:550+). Not the documented "brand-new surface" residual; the
  // first pass's census was not exhaustive. Placed in UNCONVERTED rather than converted in this item
  // (budget raised below) — see the PR body for the re-walk this item did before adding it.
  'app/src/components/collection/erc1155/CreatorAdminPanel.tsx',
  // noesis-215 census re-walk (`git grep` for `value:`/`smartTransferETH` across
  // app/src/components, see the PR body for the count): collection creation pays an optional
  // creation fee (`useCreateSubmit.ts` → factory `createInstance(..., { value: call.value })`) and
  // on success the wizard simply redirects to the new collection page — no confirmation text at
  // all, not even a bare successLabel. Outside this item's scope_dirs to convert (routes/ isn't a
  // component), so recorded here rather than silently dropped.
  'app/src/routes/WizardPage.tsx',
]

/** `MONEY_SURFACES.length` at merge. Deleting a path from both this list and `UNCONVERTED` used to
 *  pass all four ratchet assertions and *shrink* `UNCONVERTED` for free — a two-line diff that reads
 *  as cleanup and burying an inconvenient surface look identical. Raising `MONEY_SURFACES_FLOOR` is
 *  a visible one-line diff a reviewer must justify, same mechanism as `UNCONVERTED_BUDGET` below. */
export const MONEY_SURFACES_FLOOR = 15

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
  'app/src/components/collection/erc1155/CreatorAdminPanel.tsx',
  'app/src/routes/WizardPage.tsx',
]

/** `UNCONVERTED.length` at merge. Raising this is a visible one-line diff a reviewer must justify. */
export const UNCONVERTED_BUDGET = 10

/** Every money-moving action inside a CONVERTED file (a `MONEY_SURFACES` member not in
 *  `UNCONVERTED`). See the module doc comment for why this is keyed per-action, not per-file, and
 *  for the two exemptions (`Erc404AdminPanel` claimAllFees, `FeaturedPanel` pruneExpired) that are
 *  deliberately absent. */
export const CONVERTED_ACTIONS: MoneyAction[] = [
  {
    file: 'app/src/components/collection/erc404/Erc404AdminPanel.tsx',
    testId: 'erc404-admin-deploy-liquidity',
  },
  {
    file: 'app/src/components/collection/erc404/Erc404AdminPanel.tsx',
    testId: 'erc404-admin-reclaim-bond',
  },
  { file: 'app/src/components/collection/erc721/AuctionCard.tsx', testId: 'erc721-bid' },
  { file: 'app/src/components/collection/erc721/AuctionCard.tsx', testId: 'erc721-settle' },
  { file: 'app/src/components/collection/erc721/AuctionCard.tsx', testId: 'erc721-reclaim' },
  { file: 'app/src/components/collection/erc1155/MintPanel.tsx', testId: 'erc1155-mint' },
  { file: 'app/src/components/admin/TreasuryPanel.tsx', testId: 'admin-treasury-withdraw-eth' },
  { file: 'app/src/components/admin/TreasuryPanel.tsx', testId: 'admin-treasury-withdraw-erc20' },
  { file: 'app/src/components/admin/TreasuryPanel.tsx', testId: 'admin-treasury-withdraw-erc721' },
  { file: 'app/src/components/featured/FeaturedPanel.tsx', testId: 'featured-rent' },
  { file: 'app/src/components/featured/FeaturedPanel.tsx', testId: 'featured-boost' },
  { file: 'app/src/components/featured/FeaturedPanel.tsx', testId: 'featured-renew' },
]

/**
 * Does the source of a converted file's ONE money action carry a receipt? `block` is the substring
 * around that action's confirmation — from a `<TxButton … testId="X" … />` element, or from a
 * hand-rolled `data-testid="X-success"` element, up through its close. Content-based, not
 * syntax-based (noesis-215 Step 2): the noesis-212 regex matched only the bare-string-literal
 * ATTRIBUTE form (`successLabel="…"`) and missed the identical defect spelled
 * `successLabel={'…'}` — braces around the same literal — which is exactly the evasion the first
 * pass's own rewrite produced on ten labels while reporting it as a syntactic no-op.
 *
 * PASS when any of:
 *   - the block contains a `receipt=` prop (TxButton) — `MoneyReceipt.net` is compile-required, so
 *     its presence alone proves a number is shown; a bare `successLabel` alongside it is read only
 *     as a fallback for the rare case the receipt itself couldn't be built, and is not judged here.
 *   - the block contains a `formatReceipt(` call (a hand-rolled confirmation built the string
 *     itself, e.g. AuctionCard's bid form).
 *   - the block's `successLabel` value contains `${` (a template literal / interpolation — a
 *     dynamically computed value, not a bare verb phrase).
 *   - every plain string literal found inside the block's `successLabel` value contains a digit.
 * FAIL otherwise — including when no `successLabel` or `receipt` is found at all.
 */
export function blockHasMoneyReceipt(block: string): boolean {
  if (/\breceipt\s*=/.test(block)) return true
  if (/\bformatReceipt\s*\(/.test(block)) return true
  const successLabelMatch = block.match(/successLabel\s*=\s*([\s\S]*)/)
  const captured = successLabelMatch?.[1]
  if (captured === undefined) return false
  // The value runs from just after `successLabel=` to the next prop on its own line (this
  // codebase's consistent one-prop-per-line JSX formatting) or the tag's end.
  const valueChunk = captured.split(/\n\s*[a-zA-Z]+=/)[0] ?? ''
  if (valueChunk.includes('${')) return true
  const literals = [...valueChunk.matchAll(/["']([^"']*)["']/g)].map((m) => m[1] ?? '')
  if (literals.length === 0) return false
  return literals.every((s) => /\d/.test(s))
}

/**
 * Extract the source block for `testId`'s confirmation from a file's full source text — either a
 * `<TxButton … testId="X" … />` element (or the `{'X'}` / `{"X"}` brace-wrapped spelling), or a
 * hand-rolled element carrying `data-testid="X-success"`. Returns undefined when neither anchor is
 * found (the action moved or was deleted — a real finding, not a pass).
 *
 * Locates the attribute first and walks OUTWARD from it (nearest preceding `<TxButton` /
 * `<tagname`, nearest following `/>` / matching close tag) rather than matching `<TxButton` at the
 * start of the file forward — a file with several `TxButton`s before the target one would otherwise
 * let a non-greedy `[\s\S]*?` span every intervening tag to reach a testId many elements later,
 * picking up an unrelated button's `receipt=` prop along the way.
 */
export function findActionBlock(source: string, testId: string): string | undefined {
  const esc = testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const testIdAttr = new RegExp(`testId=(?:"${esc}"|'${esc}'|\\{'${esc}'\\}|\\{"${esc}"\\})`)
  const attrMatch = testIdAttr.exec(source)
  if (attrMatch !== null) {
    const tagStart = source.lastIndexOf('<TxButton', attrMatch.index)
    const tagEnd = source.indexOf('/>', attrMatch.index)
    if (tagStart !== -1 && tagEnd !== -1) return source.slice(tagStart, tagEnd + 2)
  }

  const handAttr = new RegExp(`data-testid=(?:"${esc}-success"|'${esc}-success')`)
  const handMatch = handAttr.exec(source)
  if (handMatch !== null) {
    const tagStart = source.lastIndexOf('<', handMatch.index)
    const tagName = /^<([a-zA-Z][a-zA-Z0-9.]*)/.exec(source.slice(tagStart))?.[1]
    if (tagStart !== -1 && tagName !== undefined) {
      const closeTag = `</${tagName}>`
      const closeIdx = source.indexOf(closeTag, handMatch.index)
      if (closeIdx !== -1) return source.slice(tagStart, closeIdx + closeTag.length)
    }
  }

  return undefined
}
