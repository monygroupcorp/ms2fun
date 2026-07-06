# Spec / handoff — N12: post-value threshold (spam lever)

**Status: DONE (2026-07-06) — contract + frontend both shipped on `main`.** Design-walk note N12.

**Frontend (shipped):**
- Feed `value` threaded through `FeedMessage` + all four feed readers (`useMessageFeed`,
  BoardPage `useGlobalFeed`, home `useGlobalActivity`).
- `usePostThreshold()` hook reads the on-chain lever; `meetsThreshold` + `visibleThreads` pure helpers
  in `threadMessages.ts` (top-level posts type 0/2 are value-gated; replies/reactions and
  orphan-promoted rows are exempt — a dropped post takes its nested replies with it). Applied in
  `MessageFeed`, `BoardPage` (threaded + raw activity views), and `ActivityPreview`, each with a
  "spam lever on" notice.
- Composer (`MessageComposer`) gained an ETH amount field defaulting to the current threshold, with a
  below/meets-threshold hint; cart carries per-post `value` (`boardCart.CartAction.value`);
  `BoardCartBar` sums per-post values into `msg.value` and shows the attached total. Reply/react carry 0.
- Admin: `PlatformConfigPanel` "message board" section (owner-gated on GlobalMessageRegistry) reads the
  current threshold and calls `setPostThreshold` (enter 0 to show all).
- Tests: 8 new vitest cases for `meetsThreshold`/`visibleThreads` (thread + reply preservation, orphan
  exemption). Full app suite green (456); `pnpm build` + typecheck clean.
- **Demoing needs a redeploy + reseed** (the contract changed); seed already posts varied-value messages.

Original build spec (contract half also done) below.

Locked product decisions (Mony, 2026-07-06): (1) postBatch = **per-post value array**,
`require(sum(values) == msg.value)`; (2) ETH **stays in the registry**, swept by existing
`withdrawETH()`; (3) **display-filter only** — posting below the threshold is NOT rejected on-chain;
(4) no hard floor.

**Shipped on `main` (contract + bindings + tests):**
- `GlobalMessageRegistry`: `post` / `postBatch` / `postForAction` are now `payable`; `MessagePosted`
  + `PostParams` carry a `value` field; `postBatch` enforces `sum == msg.value` (new `ValueMismatch`);
  added `uint256 public postThreshold` (appended after `masterRegistry`, UUPS-safe) + `setPostThreshold`
  (onlyOwner) + `PostThresholdSet`. Interface `IGlobalMessageRegistry.postForAction` → `payable`.
- Tests: value recorded on all 3 paths, batch sum enforcement (over/under/all-zero-with-ETH), mixed
  batch, withdraw round-trip, fuzz on value + sum, threshold set/emit/onlyOwner. Full suite green (445).
- `SeedAnvil.s.sol`: `_postValued` helper + two varied-value seed posts (0.02 / 0.25 ETH); seeded
  threshold left at 0 so the feed shows everything until the lever is raised.
- Bindings regenerated (`app/src/generated/contracts.ts`): `postThreshold` / `setPostThreshold` /
  `PostThresholdSet` hooks present.
- Frontend shim only: `BoardCartBar.tsx` passes `value: 0n` per post to keep the build green.

**STILL PENDING — the frontend (§3 below):** composer amount field, feed threshold filter (thread
`value` through `useMessageFeed`/`useGlobalFeed`/`MessageFeed`, filter `value >= postThreshold`,
replies/reactions exempt), admin `PlatformConfigPanel` control, and the e2e. Demoing needs a
**redeploy + reseed** (the contract changed).

Original spec below.

---

## The idea (from Mony)

Every post can carry a **payable amount**. The site has a **threshold** that starts at `0`. Raising
the threshold is a **spam lever**: the feed then shows **only posts whose attached value meets the
threshold**. The filter is an **indexing/display filter**, not a hard on-chain revert — a post that
paid less than the current threshold still exists on-chain, it just doesn't surface in the feed once
the bar is raised. (So old sub-threshold posts drop out of view when the lever goes up, and cheap
spam is filtered without censoring the chain.)

## Current reality (verified 2026-07-02)

There is **no** value/threshold mechanism anywhere today:

- `contracts/src/registry/GlobalMessageRegistry.sol`
  - `post(...)` (line ~106), `postBatch(...)` (~143), `postForAction(...)` (~84) are all
    **`nonpayable`**.
  - `event MessagePosted` (line ~42) has fields: `messageId, instance, sender, messageType, refId,
    actionRef, metadata, content` — **no `value`**.
  - `withdrawETH()` (onlyOwner) already exists, so the contract can already hold + sweep ETH.
- Generated ABI (`app/src/generated/contracts.ts`) confirms `post` `stateMutability: 'nonpayable'`.
- Front-end never sends value: `app/src/components/MessageComposer.tsx` calls
  `useWriteGlobalMessageRegistryPost()` with `args` only, no `value`. The batch path
  (`app/src/components/board/BoardCartBar.tsx` → `postBatch`) likewise sends no value.

## Build plan

### 1. Contract (`GlobalMessageRegistry.sol`)

- Make `post`, `postBatch`, `postForAction` **`payable`**.
- Add a **`value`** field to `MessagePosted` set to `msg.value` (for `postBatch`, decide the split —
  simplest: the whole `msg.value` attaches to *each* message is wrong; instead either (a) require the
  batch to carry a per-post value array summing to `msg.value`, or (b) attach `msg.value` to the
  batch as a whole and index the batch. **Recommended:** add `uint256 value` to `PostParams` and
  `require(sum(values) == msg.value)`, emitting each post's own `value`.) Keep it simple for the
  single `post` path: `value = msg.value`.
- Add an **owner-settable threshold** as a real protocol lever:
  ```solidity
  uint256 public postThreshold;            // default 0
  event PostThresholdSet(uint256 threshold);
  function setPostThreshold(uint256 v) external onlyOwner { postThreshold = v; emit PostThresholdSet(v); }
  ```
  NOTE: because the filter is display-side, `post` does NOT need to `require(msg.value >= postThreshold)`.
  Storing the threshold on-chain (vs. a client config) is preferred so it's auditable, has one source
  of truth, and drives an admin panel. Do NOT gate posting on it unless product later wants a hard
  floor — the spec is "index only qualifying posts," not "reject cheap posts."
- ETH accumulates in the registry; `withdrawETH()` already sweeps it to the owner. Confirm the
  treasury/owner is the intended recipient (or route to `ProtocolTreasuryV1`).
- **Security review** this change: payable entrypoints + value accounting in `postBatch` + reentrancy
  on withdraw (already `onlyOwner`, but re-audit). Add forge tests: value recorded in event, batch
  value-sum enforcement, threshold set/emit, withdraw.

### 2. Regenerate bindings + redeploy

- `forge build`, regenerate `app/src/generated/contracts.ts` (wagmi codegen), redeploy the fork,
  reseed. The seed (`contracts/script/SeedAnvil.s.sol`) should post a few messages at **varying
  values** (some 0, some above a test threshold) so the filter is demonstrable.

### 3. Front-end

- **Read** `postThreshold` (new `useReadGlobalMessageRegistryPostThreshold`).
- **Composer** (`MessageComposer.tsx`): add an amount field (reuse `AmountField` + `parseAmount`),
  default to the current threshold, send it as `value` in the `writeContract` call. Show a line:
  "posts below the current threshold (X ETH) are hidden from the feed." Do the same in the batch
  path (`BoardCartBar.tsx` / `boardCart.ts` — the cart item needs a per-post `value`).
- **Feed indexing**: `MessagePosted` now carries `value`. Thread the `value` through
  `FeedMessage` (`app/src/components/useMessageFeed.ts`) and the board's `useGlobalFeed`
  (`app/src/routes/BoardPage.tsx`) and `MessageFeed.tsx`, and **filter** to `value >= postThreshold`
  before rendering. Keep reactions/replies (types 1/3) exempt or thresholded per product call —
  recommend exempt so conversation isn't broken by the lever.
- **Admin panel**: add a "post threshold" control to `app/src/components/admin/PlatformConfigPanel.tsx`
  (owner-gated) → `setPostThreshold`. This is the "raise the lever" surface.

### 4. Tests

- Forge: as above.
- Vitest: a pure filter helper `qualifiesForFeed(msg, threshold)` + thread-preservation (a reply to a
  qualifying post still shows even if the reply paid 0, if you choose the "replies exempt" rule).
- E2E (`@fork`, serial): post at value 0 and at value > threshold; raise threshold via admin; assert
  the sub-threshold post drops from the feed and the qualifying one remains.

## Open product decisions (flag to Mony before building)

1. **postBatch value model** — per-post value array (recommended) vs. one value for the batch.
2. **Replies/reactions** — exempt from the threshold (recommended) or also thresholded.
3. **ETH destination** — owner via existing `withdrawETH`, or route to `ProtocolTreasuryV1`.
4. **Hard floor?** — spec says display-filter only (no revert). Confirm we never want to *reject*
   cheap posts on-chain.

## Files to touch (summary)

- `contracts/src/registry/GlobalMessageRegistry.sol` (+ interface `IGlobalMessageRegistry.sol`)
- `contracts/script/SeedAnvil.s.sol` (seed varied-value posts)
- `contracts/test/...` (new forge tests)
- `app/src/generated/contracts.ts` (regen)
- `app/src/components/MessageComposer.tsx`, `board/BoardCartBar.tsx`, `board/boardCart.ts`
- `app/src/components/useMessageFeed.ts`, `MessageFeed.tsx`, `routes/BoardPage.tsx`
- `app/src/components/admin/PlatformConfigPanel.tsx`
- `app/e2e/` (new spec)
