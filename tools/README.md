# Alignment census tooling

The census measures real NFT collections and replays them as if they had launched aligned, so the
testnet seed shows the ETH a parent community never got against names people know. Everything here
is measured on chain; nothing is sourced from a listing site.

Full write-up and the argument: [`docs/ALIGNMENT-CATALOG.md`](../docs/ALIGNMENT-CATALOG.md) —
**a generated file, never hand-edited.**

## The shape

| path | what it is |
|---|---|
| `data/alignment/index.json` | the item list: one entry per collection with its state. A record with no entry here is not in the census |
| `data/alignment/collections/<address>.json` | one record per collection — the mint half, the secondary half, and the provenance of each |
| `data/alignment/narrative.md` | the catalog's prose, with `{{PLACEHOLDER}}` slots for the generated tables |
| `docs/ALIGNMENT-CATALOG.md` | the rendered catalog |

**One file per collection, never one shared table.** Thirty workers appending rows to a single
markdown table is a pile of colliding PRs; per-collection records dissolve that at the source.

## Running it

```sh
export MAINNET_RPC_URL=...                    # Alchemy: both the chain reads and the NFT API key

node tools/resolve-slugs.mjs slugs.txt        # slug -> contract (keyless OpenSea; 401s after ~12)
node tools/resolve-slugs-scrape.mjs slugs.tsv # the fallback when that is exhausted

node tools/harvest-collection.mjs <addr> --label "Name" --write    # the mint half
node tools/harvest-secondary.mjs  <addr> --label "Name" --write    # volume + royalties paid

node tools/validate-records.mjs               # the gate. exit 1 = findings
node tools/verify-record.mjs <addr>           # independent re-harvest, diffed exactly
node tools/sync-index.mjs --apply             # move item states to match what is on disk
node tools/render-catalog.mjs                 # regenerate docs/ALIGNMENT-CATALOG.md
```

## Four things to know before you run a batch

**1. Concurrency is capped by the RPC, not the CPU.** `getNFTSales` paginated over a large
collection's full history is genuinely expensive in Alchemy compute units. **Cap concurrent harvests
at 3–4.** A 429 is backpressure to wait on, never an item failure to retry against — both harvesters
back off and then give up loudly rather than reporting what they managed to read.

**2. A record without provenance is discarded unread.** Every section carries its block range, the
chain head at harvest, the tool name and version, and a timestamp. `validate-records.mjs` enforces
it. The risk this guards is not a wrong number, it is an invented one: an agent that cannot reach
the chain will produce a plausible figure rather than stop.

**3. Verification is part of the design, not a later pass.** Chain reads over a fixed block range
are deterministic, so a re-harvest of the same range must match **exactly**. A row that does not
reproduce is a discard, not a disagreement to average out. A second non-reproducing row in a batch
stops the run.

**4. Two measurements here are known to be imperfect, and both are reported rather than absorbed.**
- **Auction-native collections are undercounted, badly.** An auction winner pays in bids and the
  settlement transaction carries no value, so a mint-transaction census reads those mints as free.
  Pixelady Figmata measures 7.20 ETH this way against 90.27 ETH of real winning bids — off by 12.5×.
  Records that look auction-shaped are flagged `undercount-suspected`; a flagged row is not a wrong
  row, it is one that has not been measured with the right instrument yet.
- **A bundled mint overstates.** When a mint routes through an aggregator that mints from several
  collections in one transaction, `tx.value` covers all of them and this attributes the whole of it
  to one. `indirectMintTxs` counts the population that can suffer it.

## What the two headline columns mean, exactly

**Mint ETH** is what minters spent in the transactions that created the tokens. It INCLUDES
overpayment a contract refunded and EXCLUDES secondary royalties and anything that never touched the
mint transaction. It is a floor on take-home — the honest framing, because it is the number anyone
can re-derive on Etherscan.

**Secondary volume** is the whole sale price: seller proceeds **plus** marketplace protocol fee
**plus** royalty, summed across ETH, WETH and Blur's BETH at 1:1. Sales settled in any other currency
are recorded per token and never folded in. The effective royalty rate is royalties over that whole
price; dividing by seller proceeds alone inflates a rate the census exists to show is small.
