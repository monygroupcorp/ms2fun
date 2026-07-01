# Design-pass blockers — write-path walkthrough (2026-07-01)

Captured from Mony's manual walkthrough of the seeded anvil fork as ADMIN
(`0x54Ef…9C86`). These are the write paths the e2e suite does **not** cover
(mint / free-claim / bid / settle / reclaim / bonding-swap) — the "remaining
write paths not fully walked" gap. **High priority — part of the design pass.**

Severity: **P0** = transaction reverts / core action broken · **P1** = missing
capability · **P2** = IA/UX confusion.

Legend for Status: `open` → `investigating` → `root-caused` → `fixed` → `verified`.

---

## P0 — transaction failures (glaring; must patch)

> **Diagnosis (2026-07-01):** reproduced every P0 on the fork via `simulateContract`
> AND a real-UI mint. **The contracts + frontend are correct** — every path
> succeeds with the right args:
> - `mint(1)` ✅, `claimFreeMint(1)` ✅ (ghost-mint), `settleAuction(1)` ✅
>   (gallery-relics, ended-with-bids). A real-UI mint (account #0) **succeeded**,
>   no console error.
> - Editions **and** auctions are **1-indexed**; id `0` → `EditionNotFound()` /
>   `AuctionDoesNotExist()`. The frontend reads the correct ids
>   (`getAllEditionIds=[1]`; QueryAggregator returns `id:1`), so it isn't the app
>   passing `0`.
> - live-salon settle correctly rejects `AuctionNotEnded()` (still active);
>   reclaim rejects `HasBids()` — both correct.
>
> **Conclusion:** B1–B4 are **not reproducible as code bugs**. The most likely cause
> of the walkthrough failures is **environmental — the tester's wallet was on a
> different chain than 1337** (reads use a fixed fork transport and keep working;
> writes go through the wallet with `chainId:1337` and fail). **B5 was masking the
> reason.** Re-test with B5 fixed: the panel will now name the cause (e.g.
> "Chain mismatch", "nonce too high", or the decoded revert).

### B1 — Ghost-mint free-claim eligibility + claim revert
- Free-mint eligibility is `allocation>0 && !exhausted && !alreadyClaimed` — a
  **global first-come pool, no per-wallet allowlist**, so *anyone* connected sees
  "unclaimed free mint" until the 5-slot pool is exhausted. That's by-design, not a
  false positive. The claim itself **succeeds** on-chain (`claimFreeMint(1)` ✅).
- **Status:** root-caused (not a code bug) — re-verify via B5.

### B2 — ERC-1155 mint — **works** (`mint(1)` ✅, real-UI mint ✅)
- **Status:** root-caused (not a code bug) — re-verify via B5.

### B3 — Auction settle — **works** where valid (`settleAuction(1)` ✅ on ended-with-bids)
- **Status:** root-caused (not a code bug) — re-verify via B5.

### B4 — Auction reclaim — **works** where valid (rejects `HasBids()` on bid auctions, correct)
- **Status:** root-caused (not a code bug) — re-verify via B5.

### B5 — Transaction errors are swallowed (cross-cutting) — **FIXED**
- **Symptom:** every failing write showed "try again" with **nothing in console**.
- **Root cause:** `useTxAction`, `TxButton`, and the raw-hook panels (MintPanel /
  FreeMintClaimPanel / AuctionCard) kept only an `isError` **boolean** and discarded
  the viem error.
- **Fix:** new `txErrorReason(error)` extracts viem's `shortMessage` **and** the
  decoded custom error from `metaMessages` (verified: `mint(0)` → *'The contract
  function "mint" reverted. (EditionNotFound())'*; live settle → *'…(AuctionNotEnded())'*).
  Exposed from `useTxAction` (`reason`) and rendered in the three P0 panels in place
  of the generic text. Unit-tested.
- **Status:** **fixed + verified.** This is the key that makes B1–B4 diagnosable.

---

## P1 — missing capability

### B6 — No way to post to a collection's board/activity
- **Symptom:** collection shows "no activity yet" with no composer to write a post
  to that collection's channel.
- **Status:** open

### B7 — EXEC404 (cult execs) shows no legacy activity/messages
- **Symptom:** the fossil's historical messages aren't rendered.
- **Status:** open

### B8 — Featured buttons "look dead" — **FIXED**
- **Symptom:** boost/rent/renew read as unavailable capabilities; they're actually
  disabled **until you enter an amount/duration** (featured is permissionless — the
  panel renders for every collection). User picked "buttons look dead" as the issue.
- **Fix:** shared `TxButton` gained a `disabledHint` that renders under the button
  while it's idle+disabled; wired into the three featured actions ("enter an ETH
  amount above to boost", etc.). Verified the hint renders. (Not a capability block —
  the model stays permissionless.)
- **Status:** **fixed + verified.**

### B9 — ERC-404: no trading after graduation + no DEX chart
- **Symptom:** post-graduation the panel says "graduated / unable to trade" and the
  piece gallery is dumped below the bonding block. We should (a) keep a **trade
  affordance after graduation** (route to the DEX/pool) and (b) **show the DEX
  chart** post-graduation, not a dead bonding chart.
- **Status:** open

---

## P2 — information architecture / UX

### B10 — Creator-admin actions bleed into the mint page as naked forms
- **Symptom:** creator-admin controls roll directly under the displayed edition,
  indistinguishable from the buyer mint UI. Admin should be a **separate flow /
  menu (disclosure or dedicated panel)**, not raw forms stacked on the page.
- **Status:** open

### B11 — Editions are confusing / below the fold; cover art mistaken for a piece
- **Symptom:** on ghost-mint it was unclear whether editions existed; the
  collection cover image was mistaken for a mintable piece, and reaching editions
  requires scrolling. Editions/pieces need clearer hierarchy and placement.
- **Status:** open

---

## New feature — network failsafe (from the wrong-chain incident)
The walkthrough's silent failures were the tester's wallet being on the wrong chain
(reads use the app's own transport; writes go through the wallet). To catch this for
everyone: **`WrongNetworkBanner`** — mounted app-wide under the top bar, renders only
when a connected wallet's `chainId` ≠ the deployed chain (`forkChainId`). Loud inverted
bar + one-click `switchChain`, with a manual fallback (chain id + RPC) when the wallet
rejects the programmatic switch (e.g. smart-account wallets). Verified: shows on chain
mismatch, offers switch, shows fallback on rejection. **Done.**

## Copy / UX fixes (this session)
- Mint success button "reset" → **"mint again"** (B: "reset is a strange CTA").
- Free-claim success "reset" → **"done"**; the "you have an unclaimed free mint" copy →
  **"Open free-mint pool — first come, first served · N/M claimed"** (it's an open
  pool, not a per-wallet allowlist — answers "how were we free-claim listed?").

## Confirmed working after the chain fix (were environmental)
Board post ✓, free-mint claim ✓, mint-with-message ✓, settle auction ✓.

## Round-2 feedback (walkthrough 2)

### B12 — Featured CTA needs plain-language clarification — **FIXED**
- Added a plain-language explainer atop the FEATURED QUEUE panel: "Featuring puts this
  collection on the **front-page featured row** — paid placement, ranked by how much ETH
  is boosted. Permissionless: anyone can rent a slot or boost."
- **Status:** **fixed.**

### B13 — Board should batch actions into a transaction "cart" (BIG)
- **Ask:** board writes (post/reply/react) are cheap and foldable — use the contract's
  native multi-op capability so a session of board actions becomes **one** finalizing
  transaction. Adding an action opens a **cart**; you execute when ready. Warn on page
  leave that there's un-finalized work / that you haven't yet hit the chain.
- **Needs:** confirm the registry's batch/multicall entrypoint; cart state; a
  `beforeunload` guard; clear "pending / not yet on-chain" affordances.
- **Status:** open — **scope + propose before building.**

### B14 — Creator-admin must leave the mint headline, get its own dropdown — **FIXED**
- Wrapped the owner-only creator-admin (all 3 types) in a collapsed `CREATOR ADMIN`
  `<Disclosure>` — now grouped with COMMUNITY ENDOWMENT / FEATURED QUEUE instead of
  bleeding as naked forms under the mints. Verified as owner (no double-boxing). (= old B10.)
- **Status:** **fixed + verified.**

### B15 — "Request target" doesn't belong in the top nav — **FIXED**
- Removed REQUEST TARGET from the nav (route intact). Now linked from the wizard's
  Alignment step ("Don't see the community you want to align to? Request a new alignment
  target →"). Nav is now COLLECTIONS · BOARD · LAUNCH · CONNECT (+ ADMIN for the owner).
- **Status:** **fixed + verified.**

### B16 — Confirm: ADMIN nav only shows for the protocol admin — **CONFIRMED**
- Yes. `AdminNavLink` uses `useOwnerGate(MasterRegistryV1)` → `if (!isOwner) return null`.
  Only the MasterRegistry owner (the platform operator) sees ADMIN.
- **Status:** **confirmed.**

### B17 — EXEC404 (Cult Executives) should be the first *featured* entry, not a special card
- **Ask:** write the fossil into the featured queue (contract/seed) so it flows as
  featured #1 instead of a hardcoded sore-thumb card. (Relates to B7.)
- **Status:** open (moderate — seed/contract wiring).

### B18 — Launch wizard: STYLE URI belongs on the "Collection page" step — **FIXED**
- Filtered `styleUri` out of the Contract-step Details form; rendered it under a "Page
  style (optional)" block on the Collection-page step (same `values` state, submit
  unchanged). Verified it's no longer on step 1.
- **Status:** **fixed + verified.**

## Notes
- Root causes + fixes are appended under each item as we work them.
- The e2e suite gains a `@fork` write-path spec for each P0 as it's fixed, so these
  paths stop being untested.
