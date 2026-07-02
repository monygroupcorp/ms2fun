# Design-pass blockers — write-path walkthrough (2026-07-01)

Captured from Mony's manual walkthrough of the seeded anvil fork as ADMIN
(`0x54Ef…9C86`). These are the write paths the e2e suite does **not** cover
(mint / free-claim / bid / settle / reclaim / bonding-swap) — the "remaining
write paths not fully walked" gap. **High priority — part of the design pass.**

Severity: **P0** = transaction reverts / core action broken · **P1** = missing
capability · **P2** = IA/UX confusion.

Legend for Status: `open` → `investigating` → `root-caused` → `fixed` → `verified`.

---

## ► STEP 1 — embed graduated-token swaps (B19) — **DONE + VERIFIED (Uni-V4 + ZAMM + fossil)**

**Scope locked + shipped (2026-07-02):** cut 1 = **Uni-V4 + ZAMM via zRouter**, **Cypher fast-follow**
(link-out); **fossil (EXEC404) embedded via swapV2** too. What landed:
- **`GraduatedSwapPanel`** (new) — SwapPanel-shaped embedded swap: direction toggle · amount · live
  **sim quote** (`eth_call` the swap with `amountLimit=0` → returns amountOut; no view-quoter) ·
  slippage → `amountLimit` min-out · **approve-then-swap** for token→ETH sells (buys need no approval).
  ETH = zRouter sentinel `address(0)`. Wired into `BondingSurface.tsx` graduated branch; Cypher/unknown
  fall back to the Uniswap link-out.
- **`useGraduatedVenue`** (new) — reads `instance.liquidityDeployer()`, matches the 3 module singletons
  (surfaced in `addresses.ts` + the deploy bridge + `wagmi.config.ts` codegen), reads pool params
  (Uni poolFee/tickSpacing, ZAMM feeOrHook). Degrades to link-out if a module can't answer (mock).
- **`Exec404SwapPanel`** (new, replaces `Exec404TradeLink`) — fossil swapV2 in-site. FoT-aware (~4%
  DN404 tax → wider default slippage; zRouter reads received balance so sells are FoT-safe). **Gotcha
  baked in:** zRouter reads `deadline==max` as a *Sushi* selector → we pass a finite deadline to hit
  the real Uniswap V2 pool. Uniswap link-out kept as a secondary escape hatch.
- **Seed diversified** (`SeedAnvil` + `DeployCore`): the 5 seeded ERC-404s now span **all 3 AMMs**
  (ember=cypher, vapor=uniV4, cinder=uniV4, molten=zamm[NEW], prism=zamm) and **all 4 vault flavors**
  (aave/uni/zamm/cypher). **DeployCore now deploys the REAL Uni-V4 + ZAMM LP deployer modules** (was
  `MockComponentModule` stubs — which is why graduation was a no-op + module getters reverted); gated on
  AMM config so Sepolia/mainnet unaffected. Cypher stays the stub (fast-follow + needs an Algebra
  factory addr not in cfg).

**Verification (fresh fork redeploy) — all three venues green:**
- **ZAMM + Uni-V4: fully verified end-to-end via the UI.** `molten-ready` (ZAMM) + `cinder-ready`
  (Uni-V4) both graduate → real pools; `graduated-swap.spec.ts` (@fork) drives the UI buy for each
  (quote→write→receipt); on-chain balances grow; swap quote == executed delta exactly (cast). Full
  non-archive e2e suite 20/21 (1 skipped). swapV4: 0.02 ETH → 8.23e22 CINDER; swapVZ likewise.
- **Fossil swapV2: cast-verified** (0.05 ETH → 3.36e25 EXEC buy succeeds on the fork).
- **Uni-V4 graduation fix (2 contract bugs, both fixed in `LiquidityDeployerModule`, see the handoff
  doc + `worktree` agent):** (1) settled the V4 deltas against `ctx.instance` but the **module** holds
  the funds → settle/take against `address(this)`; (2) graduated into a **WETH-keyed** pool while the
  system trades **native-ETH** pools → build a native-ETH pool (`Currency.wrap(address(0))`, no WETH
  wrap, native settle), mirroring `UniAlignmentVault`. Both carry a mainnet-fork test proving a live
  pool + a real `swapV4` buy.

Original grounding notes retained below.

**Where it goes:** the ERC-404 `graduated` branch of
`app/src/components/collection/erc404/BondingSurface.tsx` (currently a "Trade on
Uniswap ↗" link-out — replace with an embedded swap; keep the link-out only as a
fallback for a venue not yet embedded).

**Router = zRouter** (mainnet singleton `0x0000000000404FECAf36E6184245475eE1254835`,
present on the fork; ABI at `contracts/out/zRouter.sol/zRouter.json`):
- Uni-V4 graduate → `swapV4(to,exactOut,swapFee,tickSpace,tokenIn,tokenOut,swapAmount,amountLimit,deadline)` → returns `(amountIn,amountOut)`.
- ZAMM graduate → `swapVZ(...)`; Uni-V2 (the EXEC404 fossil) → `swapV2(...)`.
- **Quote by `eth_call`-simulating the swap** (it returns the output) — no manual V4/tick math. Slippage = `amountLimit`.

**Pool params (readable):** `instance.liquidityDeployer()` → the deployer;
`LiquidityDeployerModule.poolFee()` (uint24) + `.tickSpacing()` (int24). The tradable
token is the **instance itself** (DN404 base ERC-20), paired with ETH (zRouter ETH
sentinel — confirm `address(0)` vs WETH from `IzRouterV4` usage in
`contracts/src/vaults/uni/UniAlignmentVault.sol`).

**Venue detection:** three deployer families — `factories/erc404` (Uni V4),
`factories/erc404zamm` (ZAMM), `factories/erc404cypher` (Cypher/**Algebra** — NOT
zRouter; needs Algebra `IAlgebraSwapRouter.exactInputSingle`, a separate path).

**UI:** clone the bonding `SwapPanel` shape (direction toggle · amount · live quote ·
slippage · approve-then-swap for token→ETH). New component, e.g. `GraduatedSwapPanel`.

**Scope options put to Mony (unanswered):** (1) Uni-V4 + ZAMM now via zRouter, Cypher
fast-follow [recommended]; (2) all three now (adds Algebra router); (3) Uni-V4 only
first. Fossil (EXEC404) is a Uni-V2 pool → `swapV2` could embed it too.

**Verify:** de-risked but NOT yet proven end-to-end — simulate a `swapV4` for a
graduated Uni-V4 instance (e.g. Vapor) on the fork to confirm quote + execute before
wiring the UI. Add an `@fork` e2e.

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

### B6 — No way to post to a collection's board/activity — **FIXED**
- **Symptom:** collection shows "no activity yet" with no composer to write a post
  to that collection's channel.
- **Fix:** mounted the existing `MessageComposer` (channel = the instance) above the
  collection's `MessageFeed`, gated on a connected wallet (connect prompt otherwise).
  Posts land in the collection's activity + the poster's profile.
- **Status:** **fixed.**

### B7 — EXEC404 (cult execs) shows no legacy activity/messages — **FIXED**
- **Symptom:** the fossil's historical messages aren't rendered.
- **Fix:** the genesis DN404 baked a trade-message log into its curve
  (`totalMessages()` / `getMessagesBatch(start,end)` — end INCLUSIVE). New
  `Exec404Activity` reads the tail + renders it read-only on the fossil page. `@archive`
  e2e asserts a known genesis message ("War. War never changes."). 31 messages on the fork.
- **Status:** **fixed + verified.**

### B8 — Featured buttons "look dead" — **FIXED**
- **Symptom:** boost/rent/renew read as unavailable capabilities; they're actually
  disabled **until you enter an amount/duration** (featured is permissionless — the
  panel renders for every collection). User picked "buttons look dead" as the issue.
- **Fix:** shared `TxButton` gained a `disabledHint` that renders under the button
  while it's idle+disabled; wired into the three featured actions ("enter an ETH
  amount above to boost", etc.). Verified the hint renders. (Not a capability block —
  the model stays permissionless.)
- **Status:** **fixed + verified.**

### B9 — ERC-404: no trading after graduation + no DEX chart — **FIXED (chart deferred)**
- Graduated state now carries a **"Trade on Uniswap ↗"** link-out (token preselected
  via `outputCurrency`), like the EXEC404 fossil. Banner reframed; candles relabelled
  **"bonding history"** (pre-graduation trades). `Erc404NftGallery` pulled **above** the
  collapsed creator-admin so the work leads post-graduation.
- **Deferred:** a live DEX price chart needs a pool data source (subgraph) we don't have
  on the fork — the link-out carries live price/depth for now. Verified on graduated Vapor.
- **Status:** **fixed** (live DEX chart deferred, documented).

---

## P2 — information architecture / UX

### B10 — Creator-admin actions bleed into the mint page as naked forms
- **Symptom:** creator-admin controls roll directly under the displayed edition,
  indistinguishable from the buyer mint UI. Admin should be a **separate flow /
  menu (disclosure or dedicated panel)**, not raw forms stacked on the page.
- **Status:** open

### B11 — Editions are confusing / below the fold; cover art mistaken for a piece — **FIXED**
- **Symptom:** on ghost-mint it was unclear whether editions existed; the
  collection cover image was mistaken for a mintable piece, and reaching editions
  requires scrolling. Editions/pieces need clearer hierarchy and placement.
- **Fix:** wrapped the cover in a `figure`/`figcaption` — "Collection cover — scroll
  for the mintable pieces below" (auction-aware wording for ERC721) — so it stops
  reading as a mintable piece and points at the editions/pieces (already under an
  EDITIONS heading in the type section).
- **Status:** **fixed.**

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

### B13 — Board transaction "cart" (opt-in) — **BUILT + verified**
- The registry has a native `postBatch(tuple[])` (preserves `msg.sender` — Multicall3
  would not), so batching is a pure frontend build.
- **Opt-in model:** each composer keeps its immediate action (Post / Reply / Endorse);
  a secondary **"add to batch"** queues it instead. `boardCart.ts` (context/hook) +
  `BoardCartProvider` (state + `beforeunload` guard) + `<BoardCartBar>` (sticky
  bottom-right plate: "BATCH · N NOT YET ON-CHAIN", removable items, "FINALIZE N
  ON-CHAIN →") commit the whole queue in ONE `postBatch` tx, then clear + refetch.
- Wired into MessageComposer (post), ReplyComposer (reply), ReactButton (endorse,
  with a queued-guard so you can't double-add). Mounted app-wide.
- **Verified:** `e2e/board-cart.spec.ts` — two queued posts finalize in one tx and
  both land. Full serial suite 18/19 green.
- **Status:** **built + verified.**

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

### B17 — EXEC404 should read as a first-class featured entry, not a sore thumb — **FIXED**
- The fossil stuck out (light tile + faint ✕ vs the black-tile monogram cards). Restyled
  `execArt`/`execGlyph` to a black tile + white ✕ so it reads as a normal pinned-first
  featured card; FOSSIL chip + "Uniswap ↗" keep its identity. Verified on home.
- **Note:** kept frontend-side — the grandfathered DN404 isn't a registered platform
  instance, so it can't join the on-chain featured queue without a factory/registry change.
- **Status:** **fixed + verified.**

### B18 — Launch wizard: STYLE URI belongs on the "Collection page" step — **FIXED**
- Filtered `styleUri` out of the Contract-step Details form; rendered it under a "Page
  style (optional)" block on the Collection-page step (same `values` state, submit
  unchanged). Verified it's no longer on step 1.
- **Status:** **fixed + verified.**

## Notes
- Root causes + fixes are appended under each item as we work them.
- The e2e suite gains a `@fork` write-path spec for each P0 as it's fixed, so these
  paths stop being untested.

---

## Design-walk pass (Mony's live notes N1–N13) — 2026-07-02

Verified per change: `tsc --noEmit` + `eslint` + `vitest` (409 unit tests green). Layout/render
changes not e2e-run against the live fork (Mony was mid-walk on it; write-path specs would mutate
his state). Commits noted inline.

- **N9 (fix, `5d831e3`)** — the ERC404 phase machine reported **every** instance as graduated.
  `isGraduated` OR'd in `liquidityDeployer != 0`, but that's the venue module set at construction
  (always non-zero), not a graduation signal. Keyed off the real `graduated` flag; dropped the field.
  Restores bonding/graduate/preopen across all 404s (prism/vapor→bonding, cinder/molten→graduate btn).
- **N4/N5/N10/N11 (refactor, `3016c9a`)** — CollectionPage split into 3 regions via
  `resolveCollectionSurfaces → {Primary, Gallery, Admin}`: pieces render as a uniform grid BELOW the
  shell (global; Mony chose uniform grid over hero), creator admin drops below the featured queue
  (outside the shell), the composer moved INSIDE the activity section (empty "no activity yet" now
  sits directly above "write something"). 1155 editions decoupled from admin via query invalidation.
- **N7** — resolved by the N10 grid choice (721 piece gallery below the shell). No separate work.
- **N8** — not a bug. FeaturedPanel greys its action buttons until you enter a duration/amount, and
  gallery-relics is already featured (seed rents it) so it shows "featured" rather than a CTA.
  Possible polish: clearer waiting-for-input affordance (not done).
- **N6 (fix, `7617d0f`)** — general-board posts linked to a dead `/collection/<wallet>`. A wall post
  has `instance == sender`; `channelRef()` now links wall posts to the sender PROFILE ("· on the
  salon") and only real collection channels to `/collection/…`. Post header, quote card, register.
- **N2 + N3-swap (fix, `a527181`)** — new shared `formatTokenAmount(v, dec, maxFrac)` caps the EXEC
  receive quote + balance to 4 decimals (was raw 18-dec overflow). EXEC balance now shows in both
  directions and refetches on each confirmed swap; the dead-end "trade again" button replaced by a
  natural reset + one-line confirmation. Unit-tested.
- **N13 (feat, `d9a349a`)** — inline bid/settle/reclaim on the ERC721 token page (exported
  `AuctionAction`, fed an ActiveAuction rebuilt from the page's getAuction read + useAuctions config).
  Edition-mint already existed inline on the 1155 edition page.
- **N12 (SPEC/HANDOFF, `46908d5`)** — the "post-value threshold / spam lever" does NOT exist in this
  tree (post() is nonpayable, MessagePosted has no value field). Full build spec written:
  `docs/phases/spec-N12-post-value-threshold.md`. Someone else builds it (contract change + redeploy).

- **N1 + N3-portfolio (feat, `f39b9af`)** — EXEC "Your position" panel. CORRECTION: my first pass
  wrongly said the fossil couldn't reroll or enumerate. Both work: reroll = `base.transfer(self,
  balanceOf(self))` (DN404 self-send churns ids); enumeration = replay the **mirror**'s
  (`0x9e75…09BD`, from `mirrorERC721()`) Transfer log filtered to the wallet — no `owned()`/enumerable
  view, but `mirror.balanceOf` gives count + pure `ownedIdsFromTransfers` gives ids (6 unit tests);
  art via `base.tokenURI`. Panel = balance + NFT count + reroll + send EXEC + pieces gallery w/
  per-NFT send (`mirror.transferFrom`). **NOT runtime-verified**: dev wallet holds 0 EXEC + skip-NFT
  on, so the gallery/reroll need a live check with a real holder (buy ≥1 EXEC, skipNFT off).

### ALL 13 NOTES CLOSED (first design-walk batch). Follow-ups: N12 build (spec'd), and a live
### holder check of the EXEC portfolio gallery/reroll.

## Design-walk pass — second batch (M1–M4) — 2026-07-02

- **M1 (feat, `30e68b8`)** — surfaced EXEC's `balanceMint(count)` (materialize NFTs from fungible
  balance) as a "mint pieces from balance" control in the portfolio. New bonding instances already
  expose the equivalent as buyBonding's "mint NFT on buy" toggle (`SwapPanel.tsx:262`).
- **M2 (feat, `a605e84`)** — linkify http(s) URLs in board posts, replies, and the EXEC legacy
  chatter (pure `splitLinks` + `<Linkify>`, safe external anchors; never javascript:/data:). Unit-tested.
- **M3 (feat, `a4b104d`)** — 1155 edition cards now LEAD with their cover art in a responsive grid
  (were text-only); 404 mirror + 721 piece gallery tiles bumped 120px→200px min. Art-forward below shell.
- **M4 (refactor, `bcdb2b0`)** — all board actions AUTO-BATCH: endorse/reply/post each queue into the
  app-global cart (toggle for endorse) and the sticky <BoardCartBar> is the one postBatch commit. Dropped
  the redundant "+ batch"/"add to batch" buttons + the now-dead per-action refetch threading. e2e updated.

Verify: tsc + eslint + 420 unit tests green. Not run against the live fork (M4 e2e would post to it;
EXEC balanceMint needs a real EXEC holder). Both need a live eyeball on the running app.

## Design-walk pass — third batch (P1–P6) — 2026-07-02

- **P1 (feat, `fa6d7fc`)** — IPFS gateway ROTATOR. `resolveUri` only pointed <img> at gateway 0, so a
  timing-out public gateway blanked art (the EXEC pieces etc.). New `<IpfsImage>` + pure
  `resolveUriCandidates` rotate every gateway on onError (custom→public), fallback only when all fail.
  Swapped all 12 raw-img sites; removed their per-component imgError state. Unit-tested.
- **P4 (feat, `fa6d7fc`)** — live auction piece tiles span 2×2 (feature); ended/settled stay small.
- **P2 (feat, `80e145d`)** — EXEC portfolio moved sidebar→main column, between market stats + legacy activity.
- **P3 (feat, `80e145d`)** — removed all user-facing "fossil"/"grandfathered"; EXEC now reads as the
  GENESIS / origin collection (home badge, stat label, page kicker/meta, activity intro).
- **P5 (fix, `99dd691`)** — profile link/social rows: `.input{width:100%}` made the label claim the row;
  added `.rowLabel` (fixed 8rem) so the value input gets the width.
- **P6 (fix, `961f9a1`)** — the own-profile "You haven't hung anything" prompt was FALSE when the wallet
  had made collections (they render in the Made tab below). Reworded to be about profile setup only.
  VERIFIED the created-collections path is correct: for the deployer 0xf39F (anvil #0) the hook returns
  all 10 seed collections. An empty Made tab just means the connected wallet isn't that creator.

Verify: tsc + eslint + 423 unit tests green. IPFS rotator / auction sizing / profile form need a live
eyeball; P6 collections show only when connected as the seed deployer 0xf39F.

### Follow-up refinements
- EXEC portfolio (`ef6e39c`): renamed "Your position"→"Portfolio"; pieces lead (gallery ABOVE the
  mint/reroll/send actions); each piece click-opens a detail modal with large art + on-chain metadata
  (name/description/traits) + per-NFT send. `useExec404Nfts` now fetches full metadata.
- Collection pieces gallery (`2082667`): `.gallerySlot` margin so the grid breathes before the vault
  + featured-queue panels.
