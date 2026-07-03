# ADR-0010 — Serverless read-path performance strategy

**Status:** Accepted (2026-07-03)
**Context owner:** Mony

## Hard requirement

ms2.fun ships as a **serverless, client-only, statically-hosted** app: the build is pinned to IPFS and
served from a `.gwei.domains` name. There is **no backend we run** — no API, no relayer, and **no
self-hosted indexer**. Additional constraint from Mony: **resistant to keyed RPC endpoints and any
centralization** in the read path. Everything the UI needs must come from plain reads against a chain
that any public RPC (or the user's own wallet node) can serve.

This ADR is the read-path performance strategy under those constraints.

## The cost model — state vs history

Every read the app does is one of three shapes. Only one is a problem on a real network:

1. **Individual `eth_call`** (e.g. `useBondingData` fires ~10). Cheap; flattened by batching (Tier 0).
2. **On-chain lens read** — `QueryAggregator.getHomePageData / getProjectCardsBatch / getPortfolioData`.
   Already in use. This is the serverless superpower: `eth_call` is free, provider-agnostic, and one
   call returns a whole page.
3. **`fromBlock: 0` log scan** — rebuilds state by replaying every historical event. **11 sites today**
   (`grep -rln "fromBlock: 0n" app/src`): board feed, global activity, discovery `scanInstances`,
   owned-NFT enumeration (incl. EXEC on the mainnet-forked mirror), bonding trades, bid history,
   registered vaults, request-target. Real networks cap `eth_getLogs` by block range / result size, so a
   genesis→now scan paginates into dozens of requests or fails — and it re-runs on every load. **This is
   the only pattern that breaks off a local anvil.**

Measured on the local fork: sub-millisecond `eth_call` processing; ~10 ms HTTP round-trip; 10 calls
batched into one request = ~22 ms. So per-call latency is a non-issue — the strategy is entirely about
**batching the cheap reads and eliminating the log scans**.

## Decisions

### Tier 0 — transport + caching (committed; no contract changes)

Do these regardless; they're pure client config and give the biggest win per effort.

- **JSON-RPC batching** — `http(url, { batch: true })`: coalesce independent `eth_call`s into one HTTP
  POST.
- **Multicall batch scheduler** — `batch: { multicall: true }` on the config: viem auto-aggregates
  *independent* `readContract`s across hooks into a single Multicall3 call within a tick (our
  Multicall3 address is already declared on the chain).
- **`fallback([...])` transport across PUBLIC endpoints + the wallet's own RPC** — ranked, auto-failover,
  racing. See RPC decision below. **No keyed endpoints.**
- **Persist react-query to IndexedDB** — warm reloads/revisits come back instantly and only fetch
  deltas. High value for a static IPFS site (users reload often). Long `staleTime` for immutable data
  (confirmed trades, contract metadata → effectively permanent).

### Tier 1 — eliminate the log scans → **Option A (on-chain state, no indexer)**

We choose Option A: **stop replaying history; expose current state on-chain and read it.** Whether that's
possible per-surface depends on whether the contract *stored* the data or only *emitted* it. Our 11 scan
sites split three ways:

1. **Free wins — re-add enumeration.** `MasterRegistryV1` used to hold `address[] allInstances` (still
   in `MasterRegistryV1.sol.backup`); it was removed, so discovery + registered-vaults fall back to the
   `CreatorInstanceAdded` scan. Re-add the array + `count()` + a paginated getter → the client reads the
   list and hands it to `QueryAggregator` → whole discovery page in ~1–2 `eth_call`s, no logs. Gas is
   trivial (paid once at collection creation).

2. **Real tradeoff — append-only storage.** The board / activity. `GlobalMessageRegistry` is
   **emit-only**: it keeps a `messageCount` and nothing else — message content lives *only* in the event
   log. To go scan-free it must **store** messages on-chain (as EXEC404 already does with
   `getMessagesBatch`). That is **gas per post** in exchange for **instant, indexer-free reads**, and it
   makes the board a first-class on-chain object — consistent with a permanent, no-server record.
   *This is a product decision, not just perf* — pending Mony's call on the gas tradeoff.

3. **Can't lens — bounded incremental scan (Tier 1B), indexer optional.**
   - **Immutable external contracts:** EXEC404 is a live mainnet DN404 we don't control — no enumeration
     can be added, and its `Transfer` history is real and long. Owned-set reconstruction stays a
     **bounded, incremental, cached** scan: pin `fromBlock` to a known block (never `0n`), page the
     range, persist to IndexedDB, and on reload scan only `lastSeenBlock → latest`.
   - **Inherently historical series:** price candles / trade / bid history are time-series; a `view`
     gives "now", not the shape over time. Either the contract stores a compact history (gas), or we keep
     a bounded scan. A decentralized indexer (The Graph) is allowed **only** as an optional enhancement
     for charts — never in the critical path.

### RPC provider — fully decentralized, no keys

**Rejected:** keyed / referrer-restricted endpoints (Alchemy/Infura/dRPC keys), on centralization
grounds (Mony).
**Chosen:** `fallback([ ...public endpoints ])` with the **connected wallet's transport preferred** when
available. Public endpoints (e.g. publicnode, llamarpc, ankr, drpc-public) are ranked and raced; the
wallet's own node is the ideal path since it's the user's chosen RPC. No secrets ship in the IPFS bundle.
Accept the tradeoff: public endpoints have looser rate limits, which is exactly why Tier 0 (batching) and
Tier 1 (fewer/aggregated reads, no genesis scans) matter — they keep us well under any public limit.

### Indexer — dependency rejected

No hosted/decentralized indexer in the critical read path. The chain is the database. An indexer is
permitted only as an *optional* accelerator for time-series charts (bucket 3), gated so the app fully
functions without it.

## Adjacent — site-load latency on IPFS (separate from chain latency)

To make the whole thing feel instant: pin the build to a fast pinning service + dnslink, ship a **service
worker** to cache the app shell (instant repeat loads), code-split routes to keep the bundle lean, and
precache critical CSS. The IPFS gateway rotator already handles art; do the equivalent for the shell via
the SW. Tracked separately from this ADR.

## Consequences

- Tier 0 ships now with zero contract changes and is measurable.
- Tier 1 Option A needs contract additions (enumeration array on the registry; message storage on the
  board **if** we accept the gas tradeoff) + a `QueryAggregator`/lens redeploy — a **contract change**,
  specced separately per surface.
- EXEC's history and price charts remain bounded incremental scans; that's an accepted, permanent shape,
  not a stopgap.
- Per-post gas rises **if** we move the board on-chain (bucket 2) — explicit product decision pending.

## Work items / sequence

1. **Tier 0** — `wagmi.ts` (`batch: true` + `batch: { multicall: true }` + `fallback` scaffold) +
   react-query IndexedDB persistence. No contract changes. *(this ADR's companion commit)*
2. **Tier 1A free wins** — re-add `allInstances` enumeration to `MasterRegistryV1`; point discovery +
   registered-vaults at it via the aggregator. Retire those two log scans.
3. **Tier 1B** — pin `fromBlock` (deploy block, build-config constant) + IndexedDB incremental persistence
   for the EXEC mirror + any remaining scans.
4. **Board decision** — decide the on-chain-storage gas tradeoff (bucket 2); if yes, add message storage
   + `getMessagesBatch`, retire the board/activity scans.
5. **RPC + SW** — `fallback` public-endpoint list + wallet-preferred; service worker for the app shell.
