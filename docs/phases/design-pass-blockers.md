# Design-pass blockers — write-path walkthrough (2026-07-01)

Captured from Mony's manual walkthrough of the seeded anvil fork as ADMIN
(`0x54Ef…9C86`). These are the write paths the e2e suite does **not** cover
(mint / free-claim / bid / settle / reclaim / bonding-swap) — the "remaining
write paths not fully walked" gap. **High priority — part of the design pass.**

Severity: **P0** = transaction reverts / core action broken · **P1** = missing
capability · **P2** = IA/UX confusion.

Legend for Status: `open` → `investigating` → `root-caused` → `fixed` → `verified`.

---

## ► STEP 1 — embed graduated-token swaps (B19) — **BUILT + VERIFIED (ZAMM), Uni-V4 blocked**

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

**Verification (fresh fork redeploy):**
- **ZAMM: fully verified end-to-end.** `molten-ready` graduates → real ZAMM pool. New `@fork`
  `graduated-swap.spec.ts` drives the UI buy (quote→write→receipt); on-chain balance grew (1e23→2.5e23).
  Full non-archive e2e suite 19/19 green. swapVZ quote == executed delta exactly (cast-verified).
- **Fossil swapV2: cast-verified** (0.05 ETH → 3.36e25 EXEC buy succeeds on the fork).
- **Uni-V4: BLOCKED — pre-existing contract bug (NOT B19).** Graduating a Uni-V4 instance reverts:
  `LiquidityDeployerModule.unlockCallback` initializes the pool + adds liquidity, then reverts at
  `sync(WETH)` during settlement. Also `CurrencySettler.settle` is called with `payer=ctx.instance`
  while the WETH is held by the **module** (`address(this)`) — looks like the settle should pay from
  the module, plus a V4 PoolManager version/sync issue. The **swapV4 UI path is built + encoding-correct**
  (matches the fork-verified `UniAlignmentVault` swapV4 signature) — it just can't be exercised on the
  fork until the graduation module's V4 settle is fixed. **Next task: fix `LiquidityDeployerModule` V4
  settle**, then a Uni-V4 `@fork` graduated-swap assertion drops in trivially.

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
