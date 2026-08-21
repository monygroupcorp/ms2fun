<!-- GENERATED FILE — DO NOT EDIT.
     Prose lives in data/alignment/narrative.md; numbers live in data/alignment/collections/*.json.
     Regenerate with: node tools/render-catalog.mjs -->

# ALIGNMENT CATALOG — the derivative census behind the testnet seed

**Purpose:** the anvil-fork and testnet seed stops being seven invented instances and becomes a
catalog of *real* derivative collections replayed as if they had launched aligned. A visitor pokes
the testnet and sees, against names they know, the ETH the parent community never got.

**{{RECORD_COUNT}} schema-valid records, harvested {{HARVEST_WINDOW}}.** Every figure on this page
is computed at render time from exact wei in those records. Nothing here is hand-entered, and a
record that cannot state the block range it covered does not reach this page at all.

---

## 1. What the protocol will and will not accept as a target

Two facts from the contracts bound the whole catalog. Both were read, not assumed.

**An alignment target is an ERC20 with live ETH liquidity — never an NFT collection.**
`IAlignmentRegistry.AlignmentAsset` is `{token, symbol, info, metadataURI}`, and a target is only
usable once the owner has set BOTH an `AcquireRoute` (venue ∈ `UNI_V4` | `ZAMM` | `ALGEBRA`) and a
`ReferencePool` (a Uniswap V3 or Algebra pool paired with the injected WETH, whose own on-chain TWAP
is the anti-sandwich floor authority). Every vault family swaps ETH → that ERC20. So a derivative
enters the program only if its parent has a token with a real ETH pool.

Note the gap that costs a row: **Uniswap V3 is a valid *reference* pool but NOT a valid *acquire*
venue.** A target whose only real depth is V3 can be priced but not bought.

**The counterfactual is arithmetic, not marketing.** `RevenueSplitLib` fixes it:

| path | protocol | vault → alignment target | creator / LP |
|---|---|---|---|
| mint, liquidity-family vault (`UniswapV4LP`/`ZAMMLP`/`CypherLP`) | 1% | **19%** | 80% |
| mint, yield-family vault (`AaveEndowment`) | 1% | **80%** — permanent principal, never refundable | 19% |
| ERC404 graduation | 1% | **19%** | 80% to LP |

So every row carries two headline numbers and both are defensible: 19% bought and LP'd into the
parent's token, or 80% endowed forever with only the yield spent.

---

## 2. Method — measured, not sourced

Discovery is community-curated; **economics are on-chain and nothing else.**

- `tools/resolve-slugs.mjs` — OpenSea API v2 (no key) resolves a collection slug to its mainnet
  contract, so no address is ever hand-copied into this file. A slug that hit the rate limit reports
  `RATE-LIMITED`, never a blank — an exhausted run and an unresolvable slug are different results.
- `tools/resolve-slugs-scrape.mjs` — the fallback when the keyless API is exhausted. A candidate is
  accepted only when the contract's own `name()` agrees with the expected name; a merely similar
  name is reported `WEAK` and is a human's problem, not the catalog's.
- `tools/harvest-collection.mjs` — per contract: `name`/`symbol`/`totalSupply`, `tokenURI` (which IS
  the metadata-host answer), the deploy block by code bisect, then every `Transfer` from `0x0`
  grouped by transaction and joined to that transaction's value.
- `tools/harvest-secondary.mjs` — every marketplace over a fixed block range, via Alchemy
  `getNFTSales`: sale volume and the royalty **actually paid**.
- `tools/validate-records.mjs` — the gate. A record without complete provenance never renders.
- `tools/verify-record.mjs` — the independent re-harvest, diffed exactly.

**What the mint-ETH column is, exactly.** It is the ETH minters spent in the transactions that
created the tokens. It therefore INCLUDES overpayment that a contract refunded, and EXCLUDES both
secondary royalties and any revenue that never touched the mint transaction. It is a floor on
"take-home", not a full P&L — which is the honest framing anyway, because it is the number a visitor
can verify on Etherscan themselves.

**What the secondary volume column is, exactly.** It is the whole sale price: seller proceeds plus
marketplace protocol fee plus royalty, summed across ETH, WETH and Blur's BETH at 1:1. Sales settled
in any other currency are recorded per token and never folded in. The effective rate is royalties
over that whole price — dividing by seller proceeds alone would flatter a number the census exists
to show is small.

**Where this measurement is known to be wrong, stated rather than absorbed.**

{{FLAGGED_NOTE}}

---

## 3. Provenance — who counts as a derivative

A first-party collection is the **target** side of alignment. Putting one in the derivative census
inverts the argument: Remilio is not a collection that should have aligned, it is part of what others
should have aligned *to*. The split is sourced from remilia.org's own property links and the Remilia
wiki, then adjudicated. Machine-readable: `tools/provenance.json`.

**Rulings, rth, 2026-08-21:**

- **Cigawrette Packs — DERIVATIVE.** They maintain they are not a Milady derivative. Ruled in
  anyway, deliberately, and the catalog holds them to it.
- **Radbro Webring and SchizoPosters — DERIVATIVE.** The wiki's "parallel umbrella" framing does not
  exempt them. R3DBRO follows.

These are peers being put on the spot on purpose. The numbers are the whole argument, so every one
of them is measured on chain and re-derivable by anyone who doubts it.

---

## 4. The catalog — the Milady/Remilia tranche

### The derivative census — the collections that would align

{{CENSUS_TABLE}}

### First-party Remilia — the TARGET side, shown for scale, never counted as owing

{{FIRSTPARTY_TABLE}}

**`404 base` reads whether the collection's own art drops into an ERC404 instance verbatim.**
`ERC404BondingInstance._tokenURI` concatenates `base + tokenId` with no suffix, so a `tokenURI`
ending in the bare id (`…/1`) is reusable as-is; one ending `…/1.json` needs a resolver and is a
different seed shape. The seed can show real art, not placeholders.

**Collections that took zero ETH stay in.** They are the answer to "you only picked the extractive
ones," and the free-mint half is what makes the paid half legible.

---

## 5. Vault-family assignment — rth's ruling, 2026-08-21

**The default is the liquidity family: 19% to the aligned community, 1% protocol — 20% off the top.**
The 80% endowment is reserved, not spread.

**Why this is the stronger claim, not the weaker one.** The 80% number was always going to invite the
objection that the platform is confiscatory. 20% off the top, with 19 of it going to the community the
collection derived from, is a number a creator can look at and still launch. The census keeps its
force while every row stays defensible.

**The endowment instance is Pixelady Figmata** (`0xe61443f7db3ca8b7fc083602dcc52726db3d5ff6`),
auction-native, and it carries the 80% because it is the collection whose own mechanism matches
`ERC721AuctionInstance`. MiladyStation was the original pick and is **dropped** — Figmata is both the
better mechanical fit and a far larger number.

**A constraint that decided this, verified in the tree:** ERC404 graduation routes through
`RevenueSplitLib.splitGraduation` → `split()`, which is 1/19/80 with no family branch. The 80%
endowment leg is `splitMintFor(amount, liquidityFamily = false)`, whose only call sites are
`ERC1155Instance.sol:567` and `ERC721AuctionInstance.sol:360`. **An ERC404 instance cannot express an
80% endowment at all.** The family choice is forced by the code, not by taste.

---

## 6. Mint was the small half — the secondary measurement

Mint revenue is the small half of what these collections earned. Royalties on secondary are paid
continuously and, for a collection that kept trading, dwarf the mint.

{{SECONDARY_TABLE}}

### The argument this actually makes, and it is a better one

The story is not "derivatives took N ETH at mint." It is:

**A very large amount of ETH moved through this ecosystem and almost none of it was capturable by
anyone.** Royalties are opt-in, marketplace-enforced, and were competed to nothing. That is a
structural failure, not a run of bad luck, and no amount of goodwill fixes it — a majority of the
largest collections' sales run through a zero-royalty venue.

**Alignment does not rely on a royalty.** The vault's claim is taken at settlement (the 19%/80% at
mint) and held as an LP position that earns from the pool itself. There is no marketplace that can
route around it and no toggle that switches it off. That is the difference worth putting on the site:
not a bigger percentage, an **uncircumventable** one.

**State this honestly and the numbers hold.** Do NOT claim the protocol would have captured 19% of
total ecosystem volume — it would not. The 19% applies to mint settlement, and the LP leg earns pool
fees, not a share of NFT secondary. The defensible claims are: the mint-settlement figure in the
table above, plus a permanent LP position, against the royalties that actually got delivered.

---

## 7. Scope — closed

The Milady/Remilia tranche IS the catalog. BAYC→`APE`, Azuki→`ANIME`, Doodles→`DOOD`, Pepe→`PEPE`,
mfers→`MFER` are **dropped** (rth, 2026-08-21): those families have no real alignment need and the
point is already made. This is a scope decision, recorded so a later seat does not re-open it as an
oversight.

## 8. The alignment target — $CULT, measured

**LADYS is OUT (rth, 2026-08-21).** Milady Meme Coin launched on Solana as an extractive grift coin
and is out of our jurisprudence. It is not a candidate and should not be re-proposed by a later seat
on the strength of its ETH liquidity — the objection is to what it is, not to how deep it trades.

**The target is `$CULT` — Milady Cult Coin, `0x0000000000c5dc95539589fbD24BE07c6C14eCa4`.** Remilia
Corporation's own ERC20, launched December 2024, linked from remilia.org itself (`cult.inc`).
Verified on chain: `name()` = "Milady Cult Coin", `symbol()` = "CULT", 18 decimals, 100B supply.
First-party, which is the whole point — the derivatives align back to the parent's real token.

**Both registry legs are satisfied, measured on a mainnet fork:**

| leg | venue | parameters |
|---|---|---|
| `AcquireRoute` | `Venue.UNI_V4` | native ETH / CULT, **fee 10000, tickSpacing 200**, hookless |
| `ReferencePool` | Uniswap V3 (kind 0) | `0xC4ce8E63921b8B6cBdB8fCB6Bd64cC701Fb926f2`, 1% tier |

The V4 0.3% pool (`fee 3000 / spacing 60`) is initialized but holds ZERO liquidity — do not wire it.
The V3 0.3% pool (`0x044d1610e600D041229407Fb6e514D259276e3b3`) is likewise empty.

**How this was measured, and why not with the tool built for it.**
`ScanAlignmentPools.s.sol` reported "NO native-ETH V4 pool found for this token across standard
tiers" — which is FALSE, and false by construction. An unconditional `continue` outside its `if`
makes every statement after it dead code, so `best.found` can never be set and an initialized tier
logs nothing at all. The output shows only the empty tiers and reads like a complete scan. The
numbers above come from `extsload` against the PoolManager
(`keccak256(abi.encode(poolId, 6))` for slot0, `+3` for liquidity) and `getPool`/`liquidity` on the
V3 factory.

That defect was one report away from disqualifying the correct target for the entire catalog. It is
the `IMPROVEMENTS #16` shape exactly: the green was a statement about the tool, never about the chain.

---

## 9. The item list — what is measured and what is not

{{STATE_TABLE}}

Full detail, one entry per collection, in `data/alignment/index.json`. That file is the census's
work list: a record with no entry there is not in the census, and the renderer refuses it.

## 10. Residual — what remains unchecked

- **Rows still to harvest.** See the state table above. A `needs-address` row is one whose mainnet
  address was only ever written down truncated; re-resolve it by name before harvesting.
- **9 slugs unresolved.** Their OpenSea pages render no collection and the scraper's on-chain
  `name()` check refused them rather than guessing. Likely delisted; each needs a hand check.
- **9 of the 83 listed collections are not on Ethereum** (Avalanche, Polygon, chain 900), out of
  scope for a mainnet-fork seed, and not yet individually enumerated.
- **Auction-native collections are undercounted by the mint-tx method** and are flagged, not fixed.
  See §2.
- **The CULT scan covers the four standard fee tiers only.** A non-standard tier, a hooked V4 pool,
  or a ZAMM pool under an unprobed fee selector is still invisible.
- **{{SKIPPED_COUNT}} record(s) were skipped by this render** for failing the schema gate or for
  having no entry in the item list.
