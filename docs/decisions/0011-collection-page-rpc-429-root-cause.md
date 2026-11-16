# ADR-0011 — Collection-page RPC load: root cause and proposed fix

**Status:** Proposed (2026-11-16) — findings and a design, not yet a decision.
**Context owner:** Mony

## Why this exists

A collection creator hit a 429 shortly after launch ("attempting to set the bonding start time").
That error happens strictly after the collection already exists on chain — `setBondingStartTime`
only succeeds on a registered instance — so the launch itself did not fail. The 429 traces to what
happens the moment a collection's own page is first opened: several panels each independently
replay a large slice of chain history that is guaranteed, for a brand-new collection, to contain
nothing. This is a deep dive into why, how much traffic it generates, what it does under concurrent
load, and a concrete design to stay under public RPC limits.

This follows on ADR-0010, which already shipped batching (Tier 0) and deploy-block-floored,
reverse-windowed scanning (Tier 1B) and declared itself "fully executed." Tier 1B is real and
working as designed — the gap this ADR documents is narrower than "redo ADR-0010": the floor it
uses is the **protocol's** deploy block, not the **instance's own creation block**, and one feed
that could early-stop (like the home activity preview does) does not.

## Call-path inventory

### Collection page (`routes/CollectionPage.tsx` → `CollectionBody`)

Independently-mounted panels that each run their own `scanBackward` (reverse-windowed
`getLogs`/`getContractEvents`, floored at the **global** `deployBlock`, `app/src/lib/logScan.ts`):

| Panel | Hook | Scan shape | Floor |
|---|---|---|---|
| Price chart (ERC404) | `useBondingTrades.ts:42` | 1 scan, no early-stop | global `deployBlock` |
| Bid history (ERC721) | `useBidHistory.ts:43` | 1 scan, no early-stop | global `deployBlock` |
| Holder portfolio (ERC404) | `useErc404OwnedPieces.ts:109-121` | **2 scans** (inbound + outbound `Transfer`, run via `Promise.all`), no early-stop | global `deployBlock` |
| Comment feed | `useMessageFeed.ts:63-74` | 1 scan, topic-filtered to `instance` but still walks every window, no early-stop | global `deployBlock` |

These four fire on every mount regardless of whether the collection has ever had a trade, a
transfer, or a comment — the registry-wide `deployBlock` is months older than almost any given
collection's own creation block, so most of the walk is windows that are mathematically guaranteed
to return zero logs. `useMessageFeed` additionally runs unconditionally (no wallet needed); the
portfolio scan only runs for a connected wallet, but then runs **two** full scans at once.

None of these four set `retry: false` — they inherit `@tanstack/react-query`'s default
(`retry: 3`, i.e. up to 4 attempts) and viem's `http` transport default retry (`retryCount: 3`,
i.e. up to 4 attempts per window, retried on 429/5xx) with no override anywhere in the repo
(checked `grep -rn "retry:" app/src`). react-query's retry restarts the **whole** `queryFn` —
there is no per-window checkpoint — so a chain that fails late still re-walks every window from
window 0.

Other sites sharing the same `scanBackward` + global-floor shape, lower volume / lower frequency:
discovery browse (`lib/discovery/scanInstances.ts:79`, once per `/collections` or creator-profile
visit), registered vaults (`components/wizard/useRegisteredVaults.ts:86`, launch wizard step),
EXEC404 owned-NFT mirror (`components/exec404/useExec404Nfts.ts:88`, floored at its own fixed
`EXEC404_DEPLOY_BLOCK` — correct, since that's an external immutable mainnet contract, not ours).
The **board** (`routes/BoardPage.tsx`) and the **home activity preview**
(`components/home/useGlobalActivity.ts:50`) already early-stop (`maxWindows`) — this is the pattern
the four collection-page panels above are missing.

### Launch / bonding-start flow

Collection creation (`useCreateSubmit.ts`) and `setBondingStartTime` are themselves cheap: one
write tx each, plus cheap, debounced `eth_call`s (`useNameAvailability.ts` — one call per
350 ms-debounced keystroke, not a scan). They do not hammer the RPC on their own. The hammering
starts the instant the resulting collection page is opened (which it typically is, immediately —
the owner's own report shows the 429 landing right after the bonding-start step), because:

`invalidateInstanceQueries` (`components/ui/useTxAction.ts:96-101`) fires on **every** confirmed
write that names an `instance` (buy, sell, reroll, post, launch-adjacent admin actions) and
invalidates **every** cached query whose key contains that address — which includes all four
scanning panels above. So each mutating action against a collection re-triggers a full burst of
every panel's full history walk, on top of whatever the initial page mount already did.

### Polling / background load

`wagmi`'s default `pollingInterval` (4 s) only drives `watch: true` hooks. The only one in the app
is `Erc404AdminPanel.tsx:231`'s `useBlock({ watch: true })`, which self-hides for everyone except
the connected owner of that specific collection — not a visitor-facing cost. The RPC-ranking
pinger that used to cost ~2 req/s idle (`rpc.ts`) was already fixed 2026-09-29
(`45cb48a8`, 30 s interval). No other continuous poller was found.

## Measured volume

Sepolia deploy block (`app/src/config/sepolia-deployment.json`): `11,802,006`, recorded
2026-09-28. Today (2026-11-16) is ~49 days later; at Sepolia's ~12 s block time that's
≈352,800 elapsed blocks. `DEFAULT_LOG_WINDOW = 50_000` blocks
(`app/src/lib/logScan.ts:19`) ⇒ **8 windows** to walk the full floor→latest range today — and
this number only grows as the protocol ages, for every collection regardless of how recently it
was created.

**One connected visitor, one ERC404 collection page, no rate-limiting (best case):**

- Charts: 8 getLogs
- Portfolio: 2 × 8 = 16 getLogs
- Comment feed: 8 getLogs
- **32 `getLogs` requests**, plus a handful of batched `eth_call`s (Tier 0 already keeps these to ~1-2 HTTP round trips) — for a collection that may have zero trades, zero transfers, and zero comments.

A disconnected visitor still costs 16 (`Charts` + feed). Every one of these requests is a real
HTTP round trip — `scanBackward` awaits each window **sequentially** (`lib/logScan.ts:58`,
a `for` loop, not `Promise.all`), so JSON-RPC batching (Tier 0) cannot fold them together; batching
only helps calls issued in the same tick, and consecutive scan windows never are.

## Simulation: concurrent visitors on a shared public RPC budget

A static/serverless site has no per-user isolation — every visitor draws on the **same** small
pool of public endpoints (`app/src/lib/rpc.ts`), so the right mental model is a shared rate-limit
budget, not an isolated one. A discrete-time simulation (token bucket modeling one public
endpoint's allowance, replaying the exact retry shape above: viem retries a failing window up to
3 times with exponential backoff, then react-query restarts the whole chain up to 3 more times)
gives:

| Scenario | Visitors | Total requests sent | 429s | Chains abandoned (visible error) | Users who ever finish |
|---|---|---|---|---|---|
| A — 1 visitor, current code | 1 | 32 | 0 | 0 | 1 / 1 |
| B — 5 visitors land at once | 5 | 198 | 64 (32%) | 0 | 5 / 5 (slow) |
| C — 15 visitors (raid/announcement) | 15 | 939 | 542 (**58%**) | 5 | 11 / 15 |
| D — same as C, floor scoped to collection creation (1 window instead of 8) | 15 | 103 | 55 | 0 | **15 / 15** |

(Script: ask-deep-dive-why-site-hammers scratch sim, token bucket `capacity=20, refill=15/s`,
RTT 120 ms — parameters are illustrative, not a measurement of any specific provider's real limit;
the qualitative result — a retry storm that gets *worse*, not better, under load, and a ~90%
reduction in both total requests and 429s from scoping the floor alone — is the point.)

Scenario C is the actual failure mode: once the shared endpoint starts returning 429, viem's
retries and react-query's chain-restarts don't back off the total load — they **add** more
requests against the same already-saturated endpoint, which is a classic retry storm. Total
requests under contention (939) run ~15x the minimum useful work for that traffic (60 — one window
per chain if every collection were correctly treated as having no prior history). Scenario D shows
that scoping the floor alone — no retry/backoff change — already fixes nearly all of it.

## Why `fallback` doesn't save this

`rpc.ts`'s `fallback([...])` with `rank: true` re-sorts the public pool on a periodic
`eth_blockNumber` health ping (every 30 s), not on the outcome of real traffic. A 429 from heavy
`getLogs` load doesn't necessarily fail that cheap ping, so the endpoint can keep ranking first
and keep absorbing retries from every panel on the page, every visitor, until the next ping cycle
happens to catch it — and viem's `fallback` only moves to the next transport *within one call*
after that transport's own retry budget is exhausted, so a single stuck window-fetch burns through
one endpoint's full retry count before trying the next. Failover exists; it isn't 429-aware.

## Proposed design

1. **Scope every collection-page scan's floor to the instance's own creation block, not the
   global `deployBlock`.** The data already exists — `scanLiveInstances`
   (`lib/discovery/scanInstances.ts:68`) reads each `CreatorInstanceAdded` log's `blockNumber` and
   then throws it away, keeping only the address. Thread that block number through
   (`useCollection`/the card hydration path, or a small `useInstanceCreatedBlock` cached once per
   instance) and pass it as `floor` to `useBondingTrades`, `useBidHistory`,
   `useErc404OwnedPieces`, and `useMessageFeed` in place of `deployBlock`. This is the single
   highest-leverage fix (Scenario D) and needs no contract change — the creation block is already
   emitted, just not plumbed to the panels that need it.

2. **Early-stop the comment feed like the home preview already does.** `useMessageFeed` is a
   recency feed exactly like `useGlobalActivity`, which already uses `maxWindows: 2`
   (`components/home/useGlobalActivity.ts:50`). There's no reason the collection-page feed walks to
   the floor on first paint instead of showing recent activity and loading older on demand
   (`useInfiniteQuery`, the same shape `BoardPage.tsx` already uses).

3. **Stop retrying the whole chain on a scan failure.** Give the four scanning hooks
   `retry: false` (or a small fixed `retry: 1`) at the react-query layer, the same way
   `useKeepAlive.ts`, `useSwapTithe.ts`, and the other "a retry here just delays a deterministic
   answer" hooks already do. A scan that fails should surface a retry **button**, not silently
   re-walk 8 windows 3 more times. This alone removes the compounding half of the retry storm
   (Scenario C's 939 total requests vs. its 60 minimum).

4. **Make the 429 itself the failover signal.** Treat an HTTP 429 from the currently-ranked
   endpoint as an immediate demotion (penalize its rank score / mark it down until the next ping),
   instead of waiting for the next scheduled `eth_blockNumber` probe to happen to notice. This is
   what makes "RPC fallback" actually protective under the exact load pattern that triggers it,
   rather than just under slow organic decay.

5. **Cross-visitor shared caching stays out of the serverless/no-backend constraint (ADR-0010)
   as a *requirement*, but is worth revisiting as an *option*.** Nothing here needs a cache
   shared across different visitors' browsers to fix the 429 — per-visitor IndexedDB persistence
   (already shipped, ADR-0010 Tier 0) only helps a *returning* visitor, not the first wave hitting
   a freshly-launched collection. If a launch-driven traffic spike (the actual trigger here) stays
   a real concern after items 1–4 land, the next lever is a public, read-only edge cache in front
   of the RPC pool (a small Cloudflare Worker or similar fronting the same public endpoints with a
   short TTL) or a decentralized indexer for the two "set" scans that can't early-stop (price
   history, ownership) — ADR-0010 already permits an indexer as an optional, non-critical-path
   accelerator for exactly this kind of time-series read. Either is new infrastructure and a
   decision Mony hasn't made; it is **not** needed to fix the 429 in the reported case.

6. **Batching/dedup:** already in place for independent `eth_call`s (Tier 0, `batch: {multicall:
   true}` + `http(_, {batch:true})`) and doesn't apply to the log scans — `scanBackward`'s windows
   are inherently sequential (each window's range depends on nothing from the previous one, but the
   call site awaits them one at a time rather than firing them with `Promise.all`). Item 1 (scoping
   the floor) shrinks window count enough that this mostly stops mattering; if it's still worth
   doing afterward, the portfolio hook's inbound/outbound scans already run via `Promise.all` and
   could extend that pattern per-window with a bounded concurrency (2-3 in flight) once the floor
   fix lands — concurrency without a matching floor fix would make a 429 storm worse, not better,
   so this should land *after*, not instead of, item 1.

## Scope note

Items 1–4 are a contained frontend change (no contract change, no new infrastructure) and are
where essentially all of the win is, per the simulation. Item 5's edge-cache/indexer option is a
materially larger piece of work and a product decision (keyless/decentralized constraints apply,
per ADR-0010) — it is **not** filed as a goal here; this ADR records the finding and the option
for whoever picks it up next.
