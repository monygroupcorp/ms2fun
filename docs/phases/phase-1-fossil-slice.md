# Phase 1 — Prove the Stack on the Fossil

**Status:** ✅ DONE 2026-06-23 — deploy bridge (viem) + read-only EXEC404 fossil slice live on the fork (G8 green); V2 market price + Uniswap link-out shipped.
**Depends on:** Phase 0 (foundation green)

> **Phase 1, task ZERO (carried from Phase 0): ✅ DONE 2026-06-22 — code complete, live G8
> pending a fork run.** Ported the anvil **deploy bridge** ethers-v5 → viem. Scope decided with
> the architect = **deploy bridge only**: the demo-seed scenario zoo is NOT ported (rebuilt in
> Phase 3 on the typed domain layer + real create flows). New loop lives at
> `app/scripts/dev-chain/` (`pnpm chain:fork` starts the anvil mainnet-fork; `pnpm chain:deploy`
> runs `DeployAnvil.s.sol` and writes the FRESH `app/src/config/local-deployment.json`). Root
> cause of the "non-deterministic addresses" rot pinned: `DeployAnvil` derives CreateX salts from
> `block.timestamp`, so the bridge regenerates the config every deploy (never a committed
> snapshot) — the committed file is a zero-address placeholder for typecheck/build. The
> `createInstance(...)` ABI drift lived purely in the seed layer (now quarantined in
> `legacy/scripts/local-chain/`), so it is moot for the deploy-only scope. **Live G8** (hello-chain
> reading `MasterRegistryV1.getTotalFactories` off the fork) is code-ready but still needs one
> real `chain:fork` + `chain:deploy` run against `MAINNET_RPC_URL` to flip green.
**Exit gate owner:** Mony

> EXEC404 / Cult Execs can be viewed and traded (buy/sell) from the new frontend on the anvil
> fork — beautiful, zero stubs — proving the entire pipeline against a real deployed contract.

---

## Goal
Validate wallet → typed read → typed write → brutalist UI end-to-end against **real contract
state with zero new contract risk**, by building the first vertical on the grandfathered fossil.

## Scope
> **Revised 2026-06-23 (G-D):** the fossil's bonding curve is CLOSED (graduated). The "buy/sell on
> the bonding curve" scope below was based on a wrong premise; corrected to **read-only + Uniswap
> link-out**. The typed-WRITE→UI proof moves to Phase-3 real mint/create flows (contracts we own).

**In:**
- EXEC404 collection page: live state (real V2 market price, supply, user balance, graduated) via
  the fossil's hand-curated ABI + the Uniswap V2 router (`getAmountsOut`).
- ~~Trade: buy and sell on the bonding curve~~ → **read-only + "Trade on Uniswap ↗" link-out**
  (graduated fossil; in-app AMM swap not worth building, see G-D).
- Port the Gallery Brutalism design for this surface from `docs/examples/` (CSS Modules + tokens).
- The first real use of the typed read pattern (even if thin here).

**Out (deferred):**
- New contracts, the Aave vault, the wizard, profiles → Phase 2/3.
- The unified message feed UI → Phase 3 (but don't preclude it).
- Generalized collection page → Phase 3; this one may be EXEC404-specific.

## Design decisions
**Locked:**
- First slice = EXEC404 view + trade. *(WAR_PATH — proves stack on the fossil.)*

**Open:**
1. How much of the design domain layer to build now vs Phase 2 (avoid over-abstracting from one example).
2. Tx UX pattern (optimistic vs confirmed; toast vs inline) — set the convention here, reused everywhere.
3. Read strategy: multicall batching + TanStack Query cache keys convention.

## Task units
- [x] T1 — EXEC404 read model (typed) + collection page render. `lib/exec404.ts` (as-const ABI +
  V2 router) + `Exec404Stats.tsx` (one-multicall live state, real V2 price) + `Exec404Page`.
- [x] T2/T3 — ~~bonding buy/sell~~ → **read-only + Uniswap link-out** (`Exec404TradeLink.tsx`),
  after discovering the bonding curve is closed (graduated). Real trade path (V2 fee-on-transfer
  swap) verified working by a cast round-trip; in-app swap declined for a fossil (G-D).
- [x] T4 — Brutalist styles for the page (CSS Modules + tokens); graduated/market state surfaced.
- [x] T5 — Tx-state + multicall/query-cache conventions documented in ARCHITECTURE §7 (the write
  convention will be first exercised by Phase-3 mint flows, not the now read-only fossil).

## Exit criteria (revised 2026-06-23 — fossil is read-only after G-D)
1. On the fork, the EXEC404 page shows real live state — **market price from the graduated V2
   pool**, supply, graduated status, and (when connected) user balance — zero stubs.
2. Trading links out to Uniswap with EXEC preselected (no broken in-app trade).
3. The page visually matches the brutalist intent.
4. Definition of Done gates green; `@archive` e2e asserts the live V2 price.

## Verification
- `cd app && pnpm chain:fork` + `pnpm chain:deploy` (archive RPC), then `pnpm test:e2e:archive`
  (live V2 price read) and `pnpm test:e2e` (5/5). Real V2 buy/sell round-trip confirmed at the
  contract level via a cast script (the actual graduated trade path).
- Side-by-side screenshot vs demo.

## Slice status (current — superseded the 2026-06-22 bonding draft)
**Done. Read-only fossil page, real V2 market price, Uniswap link-out; all gates green.**
- Surface: `/exec404` (linked from home) — `Exec404Page` (project-header + 2-col layout) =
  `Exec404Stats` (live market price/supply/balance via one multicall) + `Exec404TradeLink`
  (Uniswap link-out). Bonding `Exec404Trade` was removed when the fossil proved graduated (G-D).
- **Verified on an archive fork:** `getTotalFactories`→3 (G8); EXEC404 reads real
  (CULT EXECUTIVES / EXEC, ~1.5 gwei/EXEC **V2 market** price, 4.44e9 supply); e2e 5/5 default +
  `@archive` 1/1 (EXEC404 live V2 price). The graduated V2 trade path (fee-on-transfer swap) is
  verified working by a cast round-trip — the actual trade happens on Uniswap, which we link to.
- **Exit criterion #1 was revised** (the original "in-app buy/sell on the bonding curve" was
  premised on a live curve that no longer exists). Current criteria are met; see above.
  The archive-RPC gate (G-A) is **cleared** — Mony supplied a working key.

## Decision log
- **2026-06-22 — task-zero scope = deploy bridge only (architect call).** Port the deploy +
  fresh-config write to viem; defer the ~1800-line ethers seed scenario zoo to Phase 3 (rebuilt on
  the typed viem domain layer). Rationale: leanest path that unblocks live G8; porting legacy seed
  now would be remnant work Phase 3's wizard largely reshapes.
- **2026-06-22 — fork bridge regenerates config; never a committed snapshot.** `DeployAnvil` uses
  `block.timestamp`-derived CreateX salts → non-deterministic addresses. Committed
  `local-deployment.json` is a zero-address placeholder so static gates pass without a fork.
- **2026-06-22 — new loop is app-native (pnpm/viem/tsx) under `app/scripts/dev-chain/`,** killing
  the root-`ethers` dependency. Old ethers loop quarantined in `legacy/scripts/local-chain/`.

## Open questions
- ~~Is EXEC404 pre- or post-graduation, and does it change the calls?~~ **Resolved (corrected
  2026-06-23):** EXEC404 is a DN404 genesis contract that **graduated** and its **bonding curve is
  CLOSED** — `buyBonding` reverts `"Presale ended"` (earlier "still live" claim was wrong: it was
  inferred from `calculateCost` returning a *view* value, but a buy was never executed until archive
  access landed). It now trades on a **Uniswap V2** pool (`liquidityPair` 0xd158…), via fee-on-
  transfer swap variants (~4% DN404 tax). `reserve()` reverts (custom error) — never read it.
  → The slice's `buyBonding`/`sellBonding` path is wrong for current state; trade-UX direction is
  **[[../HUMAN_GATES.md]] G-D** (read-only + Uniswap link-out vs full in-app V2 swap).
