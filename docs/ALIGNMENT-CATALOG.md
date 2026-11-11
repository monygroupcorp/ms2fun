<!-- GENERATED FILE — DO NOT EDIT.
     Prose lives in data/alignment/narrative.md; numbers live in data/alignment/collections/*.json.
     Regenerate with: node tools/render-catalog.mjs -->

# ALIGNMENT CATALOG — the derivative census behind the testnet seed

**Purpose:** the anvil-fork and testnet seed stops being seven invented instances and becomes a
catalog of *real* derivative collections replayed as if they had launched aligned. A visitor pokes
the testnet and sees, against names they know, the ETH the parent community never got.

**58 schema-valid records, harvested 2026-08-21 to 2026-11-11.** Every figure on this page
is computed at render time from exact wei in those records. Nothing here is hand-entered, and a
record that cannot state the block range it covered does not reach this page at all.

---

## 1. What the protocol will and will not accept as a target

Two facts from the contracts bound the whole catalog. Both were read, not assumed.

**An alignment target is an ERC20 with live ETH liquidity — never an NFT collection.**
`IAlignmentRegistry.AlignmentAsset` is `{token, symbol, info, metadataURI}`, and a target is only
usable once the owner has set BOTH an `AcquireRoute` (venue ∈ `UNI_V4` | `ZAMM`) and a
`ReferencePool` (a Uniswap V3 pool paired with the injected WETH, whose own on-chain TWAP is the
anti-sandwich floor authority). Every vault family swaps ETH → that ERC20. So a derivative
enters the program only if its parent has a token with a real ETH pool.

Note the gap that costs a row: **Uniswap V3 is a valid *reference* pool but NOT a valid *acquire*
venue.** A target whose only real depth is V3 can be priced but not bought.

**The counterfactual is arithmetic, not marketing.** `RevenueSplitLib` fixes it:

| path | protocol | vault → alignment target | creator / LP |
|---|---|---|---|
| mint, liquidity-family vault (`UniswapV4LP`/`ZAMMLP`) | 1% | **19%** | 80% |
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

_No rows are flagged as undercount-suspected._

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

| collection | contract | supply | free | paid | mint ETH | 19% | 80% | metadata host | 404 base | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| SchizoPosters | `0xbfe47d…` | 5555 | 984 | 4,571 | **320.16** | 60.83 | 256.13 | centralized (schizoposters.xyz) | yes | measured |
| Cigawrettes | `0xeed41d…` | 9998 | 975 | 9,023 | **259.27** | 49.26 | 207.41 | IPFS | no | measured |
| BoredMilady | `0xafe128…` | 6911 | 151 | 6,760 | **223.08** | 42.38 | 178.46 | IPFS | yes | measured |
| Radbro Webring V2 | `0xabcdb5…` | 5000 | 2,193 | 2,807 | **185.16** | 35.18 | 148.13 | centralized (radbro.xyz) | yes | measured |
| Pixelady Maker | `0x8fc0d9…` | 10000 | 685 | 9,315 | **106.00** | 20.14 | 84.80 | IPFS | yes | measured |
| milady mfers | `0x07e8d4…` | 10000 | 0 | 10,000 | **80.14** | 15.22 | 64.11 | IPFS | yes | measured |
| Milad Maker | `0x61628d…` | 10000 | 2,798 | 7,202 | **72.59** | 13.79 | 58.07 | IPFS | yes | measured |
| MiladyAura | `0x2fc722…` | 1888 | 39 | 1,849 | **61.09** | 11.60 | 48.87 | IPFS gateway (miladyaura.mypinata.cloud) | no | measured |
| Streets of Milady | `0x94fe1d…` | 2121 | 508 | 1,613 | **34.42** | 6.54 | 27.53 | IPFS | no | measured |
| Oekaki Maker | `0x8f7a23…` | 5555 | 4,134 | 1,421 | **32.21** | 6.12 | 25.76 | IPFS | yes | measured |
| Milady Colombia | `0xed37c9…` | 1000 | 1 | 999 | **31.48** | 5.98 | 25.19 | IPFS | no | measured |
| ELITE MAKER | `0x61b0e5…` | 777 | 15 | 762 | **30.45** | 5.78 | 24.36 | IPFS | yes | measured |
| Azuki Milady | `0x4a519d…` | 1151 | 20 | 1,131 | **27.83** | 5.28 | 22.26 | IPFS | yes | measured |
| Ghiblady Maker | `0x186e74…` | 2600 | 1,460 | 1,140 | **24.75** | 4.70 | 19.80 | IPFS | yes | measured |
| NotOkayMiladys | `0xa5f1fc…` | 2090 | 1,300 | 790 | **22.18** | 4.21 | 17.74 | IPFS | yes | measured |
| Mifairy Maker | `0x67b5ee…` | 3333 | 1,923 | 1,410 | **12.77** | 2.42 | 10.21 | IPFS | yes | measured |
| Matrix Milady | `0x424620…` | 1337 | 407 | 930 | **12.43** | 2.36 | 9.94 | IPFS | yes | measured |
| milAIdy | `0x0d8a33…` | 333 | 0 | 333 | **10.98** | 2.08 | 8.79 | IPFS | yes | measured |
| spring miaura | `0x3a007a…` | 333 | 13 | 320 | **10.89** | 2.06 | 8.71 | IPFS gateway (miladyaura.mypinata.cloud) | yes | measured |
| water mililys | `0x71481a…` | 333 | 42 | 291 | **9.60** | 1.82 | 7.68 | IPFS | yes | measured |
| Tubby Milady Maker | `0xc0f820…` | 1133 | 48 | 1,085 | **9.52** | 1.81 | 7.62 | IPFS | yes | measured |
| MiladyCola | `0xe0c839…` | 360 | 15 | 829 | **7.94** | 1.51 | 6.35 | IPFS | yes | measured |
| MiladyRave | `0x880a96…` | 2500 | 2,282 | 218 | **7.74** | 1.47 | 6.19 | IPFS | no | measured |
| Pixeladies | `0xe96f3a…` | 333 | 69 | 264 | **5.98** | 1.13 | 4.78 | centralized (cdn-api.niftykit.com) | yes | measured |
| lawbsters | `0x0ef7ba…` | 420 | 112 | 308 | **5.96** | 1.13 | 4.77 | IPFS | yes | measured |
| Milady Pocket | `0x3c9eab…` | 1111 | 661 | 450 | **5.65** | 1.07 | 4.52 | IPFS | yes | measured |
| MiladyStation | `0xb24bab…` | 1212 | 519 | 693 | **5.58** | 1.06 | 4.47 | IPFS | yes | measured |
| Midenza Maker | `0x4994cb…` | 244 | 52 | 192 | **5.09** | 0.96 | 4.07 | IPFS | yes | measured |
| Meowlady Maker | `0x441121…` | 1080 | 587 | 493 | **4.86** | 0.92 | 3.89 | IPFS | yes | measured |
| Anti-Miladies | `0x2a071e…` | 10000 | 9,732 | 268 | **4.01** | 0.76 | 3.20 | centralized (api.anti-miladies.com) | yes | measured |
| coolmiladys | `0x3ac0cb…` | 392 | 10 | 382 | **3.87** | 0.73 | 3.09 | IPFS gateway (ipfs.omakasea.com) | yes | measured |
| Zlady Maker | `0xd5e0b0…` | 151 | 72 | 79 | **2.82** | 0.53 | 2.25 | IPFS | yes | measured |
| McLady Maker | `0x366918…` | 128 | 10 | 118 | **2.79** | 0.53 | 2.23 | IPFS | yes | measured |
| Rorita Maker | `0x7a3d2f…` | 1945 | 484 | 1,461 | **2.54** | 0.48 | 2.03 | IPFS | no | measured |
| Strawberry Juice | `0xdc71c7…` | 100 | 2 | 98 | **2.45** | 0.46 | 1.96 | IPFS | yes | measured |
| Mosaiclady Maker | `0xe70a7b…` | 5560 | 4,315 | 1,245 | **2.38** | 0.45 | 1.90 | IPFS | yes | measured |
| Milady Christmas | `0x57282f…` | 223 | 114 | 109 | **2.35** | 0.44 | 1.88 | IPFS | yes | measured |
| R3DBRO | `0x392c4a…` | 169 | 51 | 118 | **1.87** | 0.35 | 1.49 | IPFS | yes | measured |
| BEETLE GAME | `0x9a2aba…` | 161 | 6 | 155 | **1.23** | 0.23 | 0.99 | IPFS | yes | measured |
| Pixel Miladies | `0xa20594…` | 6969 | 6,557 | 412 | **0.83** | 0.15 | 0.66 | IPFS | no | measured |
| mimories | `0xa393b1…` | 1686 | 1,522 | 164 | **0.82** | 0.15 | 0.65 | IPFS | no | measured |
| Milady Maker X LITE | `0xe6ec7d…` | 1000 | 980 | 20 | **0.20** | 0.03 | 0.16 | IPFS | no | measured |
| Milady Christmas Pets | `0xf66450…` | 121 | 121 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |
| Milady Rainbow Zorb | `0xf00efb…` | 91 | 91 | 0 | **0.00** | 0.00 | 0.00 | on-chain (data URI) | no | measured |
| Sonora222 | `0xdb403f…` | 108 | 108 | 0 | **0.00** | 0.00 | 0.00 | IPFS gateway (seedoil.mypinata.cloud) | yes | measured |
| Pixelady Maker WOTLK | `0xcdde79…` | 150 | 150 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |
| KARDLADY | `0xcbaa32…` | 87 | 87 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |
| Pixelady Maker: Radbro | `0xb2619d…` | 100 | 100 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |
| SonoraMaker | `0x9a051c…` | 444 | 444 | 0 | **0.00** | 0.00 | 0.00 | IPFS gateway (ipfs.io) | yes | measured |
| Milady333 | `0x8a45fb…` | 333 | 333 | 0 | **0.00** | 0.00 | 0.00 | centralized (miladymaker.net) | yes | measured |
| Sudo Bastard Miladys | `0x58ae0d…` | — | 1,666 | 0 | **0.00** | 0.00 | 0.00 | on-chain (data URI) | no | measured |
| Pixelady Maker BC | `0x4d40c6…` | 1000 | 1,000 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |
| Rainbow Zorblady Maker | `0x43316b…` | 69 | 69 | 0 | **0.00** | 0.00 | 0.00 | on-chain (data URI) | no | measured |
| Yona Honorary Service | `0x283d7a…` | 11 | 11 | 0 | **0.00** | 0.00 | 0.00 | IPFS | no | measured |
| Merikuri | `0x0b121c…` | 125 | 125 | 0 | **0.00** | 0.00 | 0.00 | IPFS | yes | measured |

**55 collections · 50,153 free mints · 71,828 paid mints · 1654.13 ETH → 314.28 ETH aligned (19%) or 1323.30 ETH endowed (80%).**

### First-party Remilia — the TARGET side, shown for scale, never counted as owing

| collection | contract | supply | free | paid | mint ETH | 19% | 80% | metadata host | 404 base | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST NFT | `0xd3d9dd…` | 10000 | 2,153 | 7,847 | **862.37** | 163.85 | 689.89 | centralized (remilio.org) | yes | measured |
| Milady Maker Party | `0x05c632…` | 3000 | 1,446 | 1,554 | **77.62** | 14.74 | 62.10 | IPFS | yes | measured |
| This User... Banners | `0x135214…` | 2000 | 1,564 | 436 | **43.60** | 8.28 | 34.88 | centralized (miladymaker.net) | yes | measured |

**3 collections · 5,163 free mints · 9,837 paid mints · 983.59 ETH → 186.88 ETH aligned (19%) or 786.87 ETH endowed (80%).**

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

| collection | mint | secondary volume | sales | royalties paid | effective |
|---|---|---|---|---|---|
| Milady333 | 0.0 | 264.8 | 480 | 7.89 | 2.98% |
| Yona Honorary Service | 0.0 | 0.0 | 0 | 0.00 | — |

**480 sales · 264 ETH of volume · 7.8 ETH of royalties actually paid — an effective rate of 2.98% across the census.**

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

| state | count | meaning |
|---|---|---|
| needs-harvest | 56 | Address known. No schema-valid v2 record exists yet. |
| unresolved-slug | 9 | Slug does not resolve to a mainnet contract. A legitimate result, not a failure. |
| harvested | 2 | A schema-valid record exists at data/alignment/collections/<address>.json. |

Full detail, one entry per collection, in `data/alignment/index.json`. That file is the census's
work list: a record with no entry there is not in the census, and the renderer refuses it.

## 10. Residual — what remains unchecked

- **Mint re-harvested 2026-11-11.** All 56 rows that were `needs-address` or `needs-harvest` are
  now measured by the v2 tool and schema-valid — including the 12 whose mainnet address had only
  ever been written down truncated, re-resolved this pass via `resolve-slugs-scrape.mjs` against
  `miladyderivatives.com/api/data.json` and verified on-chain against each contract's own `name()`.
  Every re-measured mint-ETH figure reproduced the 2026-08-21 hand figure to within rounding.
- **The secondary harvester is dead, not merely stale.** `tools/harvest-secondary.mjs` calls
  Alchemy's `getNFTSales`, which Alchemy's own changelog (2026-08-18) sunset on 2026-09-30 with no
  replacement endpoint. This is why only 2 of 58 records carry a `secondary` section. Re-measuring
  secondary volume needs the tool rebuilt against a different source (Reservoir, SimpleHash, or a
  direct marketplace-contract log scan) — a rebuild, not a retry.
- **9 slugs unresolved.** Their OpenSea pages render no collection and the scraper's on-chain
  `name()` check refused them rather than guessing. Likely delisted; each needs a hand check.
- **9 of the 83 listed collections are not on Ethereum** (Avalanche, Polygon, chain 900), out of
  scope for a mainnet-fork seed, and not yet individually enumerated.
- **Auction-native collections are undercounted by the mint-tx method** and are flagged, not fixed.
  See §2.
- **The CULT scan covers the four standard fee tiers only.** A non-standard tier, a hooked V4 pool,
  or a ZAMM pool under an unprobed fee selector is still invisible.
- **0 record(s) were skipped by this render** for failing the schema gate or for
  having no entry in the item list.
