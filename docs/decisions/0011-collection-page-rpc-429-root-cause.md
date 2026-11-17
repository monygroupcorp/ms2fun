# ADR-0011 — Collection-page RPC load: root cause and fix

**Status:** Accepted (2026-11-17). Proposed 2026-11-16. The proposal's first three items (creation
block floor, feed early-stop, no whole-scan retries) shipped with this acceptance, along with fixes
for three transport causes the proposal had not found; see [What shipped](#what-shipped). Its
fourth (a 429 as the failover signal) stays open, and its fifth (shared caching) is an option, not a
decision.
**Context owner:** Mony

## Why this exists

A collection creator hit a 429 shortly after launch ("attempting to set the bonding start time").
That error happens strictly after the collection already exists on chain — `setBondingStartTime`
only succeeds on a registered instance — so the launch itself did not fail. The 429 traces to what
happens the moment a collection's own page is first opened: several panels each independently
replay a large slice of chain history that is guaranteed, for a brand-new collection, to contain
nothing. This is a deep dive into why, how much traffic it generates, what it does under concurrent
load, and what was changed to stay under public RPC limits.

This follows on ADR-0010, which already shipped batching (Tier 0) and deploy-block-floored,
reverse-windowed scanning (Tier 1B) and declared itself "fully executed." Tier 1B is real and
working as designed — the gap this ADR documents is narrower than "redo ADR-0010": the floor it
uses is the **protocol's** deploy block, not the **instance's own creation block**, and one feed
that could early-stop (like the home activity preview does) does not. Measuring the fix turned up
three transport-level causes that made the same load land harder than the scan counts alone
suggest; they are under [What the transport was doing](#what-the-transport-was-doing).

## Call-path inventory

### Collection page (`routes/CollectionPage.tsx` → `CollectionBody`)

Independently-mounted panels that each ran their own `scanBackward` (reverse-windowed
`getLogs`/`getContractEvents`, floored at the **global** `deployBlock`, `app/src/lib/logScan.ts`):

| Panel | Hook | Scan shape | Floor (before) |
|---|---|---|---|
| Price chart (ERC404) | `useBondingTrades.ts` | 1 scan, no early-stop | global `deployBlock` |
| Bid history (ERC721) | `useBidHistory.ts` | 1 scan per token (enabled only with a `tokenId`), no early-stop | global `deployBlock` |
| Holder portfolio (ERC404) | `useErc404OwnedPieces.ts` | **2 scans** (inbound + outbound `Transfer`, run via `Promise.all`), no early-stop | global `deployBlock` |
| Comment feed | `useMessageFeed.ts` | 1 scan, topic-filtered to `instance` but still walks every window, no early-stop | global `deployBlock` |

These four fired on every mount regardless of whether the collection had ever had a trade, a
transfer, or a comment — the registry-wide `deployBlock` is months older than almost any given
collection's own creation block, so most of the walk was windows that are mathematically guaranteed
to return zero logs. `useMessageFeed` runs unconditionally (no wallet needed); the portfolio scan
only runs for a connected wallet, but then runs **two** full scans at once.

None of these four set `retry: false`, and `queryClient.ts` sets no default, so each inherited
`@tanstack/react-query`'s `retry: 3`. react-query's retry restarts the **whole** `queryFn` — there is
no per-window checkpoint — so a scan that fails late re-walks every window from window 0. How many
HTTP requests sit under each of those attempts is a transport question, answered below.

Other sites sharing the same `scanBackward` + global-floor shape, lower volume / lower frequency:
discovery browse (`lib/discovery/scanInstances.ts`, once per `/collections` or creator-profile
visit, 2 calls per window: added and revoked), registered vaults
(`components/wizard/useRegisteredVaults.ts`, launch wizard step), the graduation carve receipt
(`lib/carveReceipt.ts`, 2 calls per window, only after graduation), the target request page
(`routes/RequestTargetPage.tsx`), and the EXEC404 owned-NFT mirror
(`components/exec404/useExec404Nfts.ts`, floored at its own fixed `EXEC404_DEPLOY_BLOCK` — correct,
since that is an external immutable mainnet contract, not ours). The **board**
(`routes/BoardPage.tsx`) and the **home activity preview** (`components/home/useGlobalActivity.ts`)
already early-stop (`maxWindows`) — the pattern the four collection-page panels above were missing.

### Launch / bonding-start flow

Collection creation (`useCreateSubmit.ts`) and `setBondingStartTime` are themselves cheap: one
write tx each, plus cheap, debounced `eth_call`s (`useNameAvailability.ts` — one call per
350 ms-debounced keystroke, not a scan). They do not hammer the RPC on their own. The hammering
starts the instant the resulting collection page is opened (which it typically is, immediately —
the owner's own report shows the 429 landing right after the bonding-start step), because:

`invalidateInstanceQueries` (`components/ui/useTxAction.ts`) fires on **every** confirmed write
that names an `instance` (buy, sell, reroll, post, launch-adjacent admin actions) and invalidates
**every** cached query whose key contains that address — which includes all four scanning panels
above. So each mutating action against a collection re-triggers every panel's scan, on top of
whatever the initial page mount already did.

### Polling / background load

`wagmi`'s default `pollingInterval` (4 s) only drives `watch: true` hooks. The only one in the app
is `Erc404AdminPanel.tsx`'s `useBlock({ watch: true })`, which self-hides for everyone except the
connected owner of that specific collection — not a visitor-facing cost. The ranking pinger in
`rpc.ts` was moved to a 30 s interval on 2026-09-29 (`45cb48a8`), but that interval only held for
one ranking loop; see [the ranked pool started a new pinger per request](#the-ranked-pool-started-a-new-pinger-per-request).

## Measured volume

Sepolia deploy block (`app/src/config/sepolia-deployment.json`): `11,802,006`, recorded
2026-09-28. On 2026-11-16 the Sepolia head was 12,152,060: 350,054 blocks. With
`DEFAULT_LOG_WINDOW = 50_000` blocks that is **8 windows** to walk the full floor→latest range — and
this number only grows as the protocol ages, for every collection regardless of how recently it
was created. A collection created that day sat 3,287 blocks below the head: **1 window** from its
own creation block.

**One connected visitor, one ERC404 collection page, no rate-limiting (best case), counting scans:**

- Charts: 8 getLogs
- Portfolio: 2 × 8 = 16 getLogs
- Comment feed: 8 getLogs
- **32 `getLogs` requests**, plus a handful of batched `eth_call`s — for a collection that may have
  zero trades, zero transfers, and zero comments.

The proposal put a disconnected visitor at 16 (charts + feed). Measured against the public Sepolia
site before this change, one disconnected tab on a new collection's page sent **36 `getLogs` to the
public pool and 20 more to the injected wallet in about 60 s**, and the pool also received 625
`eth_blockNumber`. The counting above was right about the scans and wrong about what the transport
did with them. Every one of these is a real HTTP round trip — `scanBackward` awaits each window
**sequentially** (a `for` loop, not `Promise.all`), so JSON-RPC batching cannot fold them together;
batching only helps calls issued in the same tick, and consecutive scan windows never are.

## Simulation: concurrent visitors on a shared public RPC budget

A static/serverless site has no per-user isolation — every visitor draws on the **same** small
pool of public endpoints (`app/src/lib/rpc.ts`), so the right mental model is a shared rate-limit
budget, not an isolated one. The table below is a **simulation**, not a measurement: a
discrete-time token bucket standing in for one public endpoint's allowance, replaying a retry
shape of up to 3 retries per window with exponential backoff and then up to 3 whole-chain restarts
from react-query.

| Scenario (simulated) | Visitors | Total requests sent | 429s | Chains abandoned (visible error) | Users who ever finish |
|---|---|---|---|---|---|
| A — 1 visitor, code before this change | 1 | 32 | 0 | 0 | 1 / 1 |
| B — 5 visitors land at once | 5 | 198 | 64 (32%) | 0 | 5 / 5 (slow) |
| C — 15 visitors (raid/announcement) | 15 | 939 | 542 (**58%**) | 5 | 11 / 15 |
| D — same as C, floor scoped to collection creation (1 window instead of 8) | 15 | 103 | 55 | 0 | **15 / 15** |

Token bucket `capacity=20, refill=15/s`, RTT 120 ms. **These parameters are illustrative and do not
model any specific provider's limit, and 939 → 103 is the simulation's output, not a gain expected
in production.** What the simulation shows is qualitative: retries that do not back off total load
**add** requests against an already-saturated endpoint (a retry storm), so load gets worse, not
better, as visitors arrive; and cutting the windows per scan cuts both requests and 429s roughly in
proportion. The per-window retry count it assumed was itself wrong (next section): the real shape
multiplies faster.

## What the transport was doing

### Retries came from the `fallback` layers, not from `http`

The read transport was `fallback([wallet, fallback([...public http], { rank })])`. viem's `fallback`
calls every inner transport with `retryCount: 0`, so the `http` transports never retry on their own
and `fallback` moves to the next endpoint at once. The retries come from the two `fallback` layers
themselves: each is built by `createTransport` with the default `retryCount: 3` and a backoff of
150 ms·2ⁿ, and each retry of the outer layer starts again at the wallet. Measured on a mock, one
`getLogs` window with every endpoint answering HTTP 429 produced **4 wallet requests and 64 pool
requests (16 per endpoint) before erroring after 5.4 s**; HTTP 403 behaves the same. A JSON-RPC
`-32601` (how `0xrpc.io` refuses a range it will not serve) is not retried: 1 request per endpoint.
react-query's 3 retries then repeated the whole scan on top of that.

### The ranked pool started a new pinger per request

`rank` on the public `fallback` was meant to re-sort the pool on a 30 s `eth_blockNumber` ping.
Ranking never reached real traffic. The outer `fallback` calls the inner ranked `fallback` factory on
every request (and once more for each remaining transport for its method-`includes` check when the
wallet fails). Each call to that factory starts a ranking loop, the loop reschedules itself forever,
and each new instance starts in URL order and only applies a ranking after its own first ping. So a
request that fell past the wallet left behind a perpetual pinger and was itself served in list
order. Measured on a mock: 20 `getLogs` created 41 ranking loops that sent 492 `eth_blockNumber`
pings in the next 3 s; with the first endpoint made 80x slower, all 10 test reads still went to it.
Measured on the public site, one idle tab kept sending about 4.5 requests per second to the pool
after its scans had finished.

### The wallet hop carried every read, connected or not

The first transport was wagmi's `unstable_connector(injected)`, which declares no method filter and
resolves the injected provider whether or not the site is connected. Every read, `eth_getLogs`
included, went to `window.ethereum` first (plus an `eth_chainId` before each request), whichever
wallet that was and whether or not it was the one the user connected; each failure then fell
through to the pool. A wallet's node is sized for one person signing, so a history walk through it
can rate-limit the user's next signature as well as the page.

## What shipped

1. **Every collection-page scan floors at the instance's own creation block.** The block comes from
   a per-instance cache (`lib/discovery/instanceCreatedBlock.ts`) seeded by discovery's
   `CreatorInstanceAdded` scan and by the deploy receipt in `useCreateSubmit.ts`; on a direct visit
   with nothing cached, one `untilFound` scan of `CreatorInstanceAdded` filtered on the indexed
   `instance` finds it. Only found blocks are cached; if none is found the floor stays the global
   `deployBlock`. `useBondingTrades`, `useBidHistory`, `useErc404OwnedPieces` and `useMessageFeed`
   take it through `useInstanceFloor` and wait for it before scanning. (The ERC404 mirror's
   `Transfer` scan shares the floor: the mirror is deployed inside the same `createInstance` call.)
2. **The comment feed early-stops.** `useMessageFeed` takes `maxWindows` covering about 100,000
   blocks (2 windows on Sepolia, 10 on mainnet), the `useGlobalActivity` shape. Loading older
   comments on demand (`useInfiniteQuery`, as on the board) was not needed to fix the load and is
   not done.
3. **The four scanning hooks set `retry: false`.** A failed scan surfaces as an error instead of
   re-walking every window three more times.
4. **The wallet hop carries only what belongs to the wallet, and only when connected.**
   `connectedWallet()` in `rpc.ts` reads wagmi's tracked connection (the connector the user actually
   connected), throws `ProviderDisconnectedError` with no connection or on a chain mismatch so the
   request goes straight to the pool, and lists its methods: `eth_call`, `eth_estimateGas`,
   `eth_sendTransaction`, `eth_sendRawTransaction`. Log scans and block reads never touch it. The
   3.5 s hop timeout is unchanged.
5. **The ranked pool is built once per chain** (`oncePerChain`): one ranking loop at the 30 s
   interval, and requests see its ranking. A test (`src/lib/rpc.leak.test.ts`) drives 20 reads
   through the transport and bounds the pings; the transport before this change sends 164.
6. **The log window follows the chain a build targets** (`lib/logWindow.ts`): 10,000 blocks on
   mainnet, 50,000 elsewhere, used by every caller of `DEFAULT_LOG_WINDOW`. It is chosen per build,
   not per scan, which is the same thing while each build serves one chain.
7. **The pool lists only what serves it.** The Sepolia thirdweb entry is removed. Entries that
   serve calls but refuse the app's log window stay in the pool with `eth_getLogs` excluded
   (`NARROW_LOG_RANGE`): `0xrpc.io/sep` and mainnet `eth.drpc.org`.
8. **`pnpm rpc:check` measures `eth_getLogs` range.** It sends one address-filtered `eth_getLogs`
   per entry at the app's window (a refusal fails the run unless the entry is in
   `NARROW_LOG_RANGE`) and one at 50,000 blocks, printed as measured.

## Measured after

**Connected, one tab, Sepolia** (a production build of this change, a scripted EIP-1193 wallet that
counts what reaches it; wizard from an empty form to a priced ERC404 deploy on the review step, then
a collection page mount, about 85 s): the wallet received **23 `eth_call` and 2 `eth_estimateGas`**,
no `eth_getLogs` and no block reads; no step of the walk averaged more than about one a second.
The deploy itself adds one `eth_sendTransaction` to the wallet; its receipt is polled through the
pool. That leg was inferred, not run. In the 30 s after the collection page's scans finished, the pool received one
ranking round (3 `eth_blockNumber`) and 8 `eth_getBlockByNumber`.

**Range caps, address-filtered `eth_getLogs` ending at the head** (`pnpm rpc:check`, 2026-11-17):

| chain | endpoint | app window | 50,000 blocks |
|---|---|---|---|
| mainnet | publicnode | ok (10,000) | HTTP 403, `-32602 Archive requests require a personal token` |
| mainnet | drpc | refused at every width tried from 200 up (HTTP 400, code 35, "ranges over 10000 blocks are not supported on free plan"), including 1,000 and 10,000 on an address with no logs; 100 served | refused |
| mainnet | tenderly gateway | ok (10,000) | `-32602 invalid params` |
| mainnet | 0xrpc.io/eth | ok (10,000) | `-32601 Request contains invalid block params` |
| Sepolia | publicnode | ok (50,000) in 2 of 8 tries; `4444 pruned history unavailable` in 6 | same |
| Sepolia | tenderly gateway | ok (50,000) | ok |
| Sepolia | 0xrpc.io/sep | excluded from log scans | `-32601` |

Sepolia publicnode always served 10,000 and 1,000 blocks ending at the head. Its refusal at 50,000
is a history-depth limit on some of the backends behind it, not a range cap, so a narrower window
would not help any scan that reaches further back. viem's `fallback` moves past that error to the
next endpoint without retrying it, so a scan costs one wasted request per window that lands on such a
backend, and on Sepolia deep history is served by one endpoint.

## Still open

- **A 429 as the failover signal (item 4 of the proposal).** Not done. viem's `rank` takes only
  `ping`, `interval`, `sampleCount`, `timeout` and `weights`; there is no way to feed a real request's
  outcome into the ranking, so demoting an endpoint on a 429 needs a ranking of our own (`fallback`
  does expose `onResponse` and `shouldThrow`). With one ranking loop now actually ranking, an
  endpoint that rate-limits real traffic but answers its ping still keeps its place until the ping
  catches it.
- **The `fallback` retry multiplier.** Both `fallback` layers keep viem's default `retryCount: 3`,
  so one window that every endpoint answers with a 429 still costs up to 64 pool requests before it
  errors. `retry: false` removed react-query's layer on top, and the creation-block floor makes most
  scans one window, but the per-window multiplier itself is unchanged.
- **Shared caching across visitors (item 5) stays an option, not a requirement.** Nothing here needs
  a cache shared across different visitors' browsers to fix the 429 — per-visitor IndexedDB
  persistence (already shipped, ADR-0010 Tier 0) only helps a *returning* visitor, not the first wave
  hitting a freshly-launched collection. If a launch-driven traffic spike stays a real concern, the
  next lever is a public, read-only edge cache in front of the RPC pool (a small Cloudflare Worker or
  similar fronting the same public endpoints with a short TTL) or a decentralized indexer for the two
  "set" scans that cannot early-stop (price history, ownership) — ADR-0010 already permits an indexer
  as an optional, non-critical-path accelerator for this kind of time-series read. Either is new
  infrastructure and a decision not yet made.
- **Scan sites outside the collection page** (`useRegisteredVaults.ts`, `carveReceipt.ts`,
  `RequestTargetPage.tsx`) still floor at the global `deployBlock`. They run once per wizard visit,
  after graduation, or on one form, and were left as they are.
- **Per-window concurrency.** `scanBackward` still awaits windows one at a time. With the floor at
  the creation block most scans are one window, so this rarely matters; adding concurrency without
  that floor would make a 429 storm worse, so it should only ever come after it.
