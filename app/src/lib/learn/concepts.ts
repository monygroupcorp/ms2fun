/**
 * Concept registry (spec-launchpad-docs-and-explainers §2.1). One entry per load-bearing wizard
 * concept, keyed by a stable slug. Content is authored as Markdown strings so it ships bundled,
 * greppable, and reviewable in PRs — no external docs host (ADR-0010: the docs are part of the app
 * read path and must stand alone with the static bundle).
 *
 * The schema carries only a `learnMore` slug; the prose lives here. A unit test walks every schema
 * `learnMore` and asserts it resolves (dead-link guard), so a typo fails CI, not production.
 */
export interface LearnConcept {
  /** Stable; used in `/learn/:slug` URLs and schema `learnMore` refs. */
  slug: string
  title: string
  /** One sentence; the docs-page lede. Inline field `help` stays hand-written (may differ). */
  summary: string
  /** Markdown, rendered read-only by lib/learn/markdown. Never rendered as raw HTML. */
  body: string
  /** Other slugs, for "see also". */
  related?: string[]
}

const RAW: Record<string, Omit<LearnConcept, 'slug'>> = {
  'token-standard': {
    title: 'Choosing a token standard',
    summary:
      'ERC-404, ERC-1155, and ERC-721 are three different shapes of collection — what each is for, and what you give up.',
    body: `
The contract you pick is **fixed on deploy** — it decides how your collection is minted, priced, and traded, and you can't change it later. Three choices:

## ERC-404 — bonding-curve collection
A hybrid token: every piece is both an NFT and a slice of a fungible token. Buyers mint along a **bonding curve** (price rises as supply sells), and at a funding target the collection **graduates** — liquidity is deployed to a DEX and it trades like any token. Best when you want price discovery and a liquid market, not a fixed edition.

## ERC-1155 — edition collection
Classic editions: you define pieces, each with its own supply and price. Buyers mint the edition they want at a set price. Best for straightforward drops where you know the pieces up front.

## ERC-721 — auction collection
One-of-one pieces sold by timed auction. Best for scarce, individually-valued work.

Every standard binds the same **~20% alignment** to a vault and settles fees the same way — the difference is purely how minting and pricing work.
`,
    related: ['erc404', 'erc1155', 'erc721', 'alignment-vault', 'bonding-curve-graduation'],
  },
  erc404: {
    title: 'ERC-404 — bonding-curve collection',
    summary:
      'A hybrid NFT/fungible token that mints along a bonding curve and graduates to a live DEX market.',
    body: `
**What it is.** ERC-404 is a hybrid: every piece is at once an NFT and a slice of a fungible token. Buyers mint along a **bonding curve** — the price of the next mint rises as supply sells — and there is no fixed edition price. When the curve reaches its funding target the collection **graduates**: liquidity is deployed to the DEX you chose (Uniswap V4, ZAMM, or Cypher) and the token trades openly. It also supports an optional **free-mint reserve**.

**Who it's for.** Creators who want **price discovery and a liquid market** rather than a fixed-price drop — a launch that funds itself as it fills and then trades like any token.

**What you gain.** A market-driven price, automatic DEX liquidity at graduation, and one token that is both collectible and tradable.

**What you give up.** Predictability. There is no set price per piece, nothing can be minted or claimed until the curve opens, and a curve that never reaches its target never graduates — so it only works with real demand.

**This is fixed on deploy.** The standard is chosen when you create the collection and **cannot be changed later** — you can't convert an ERC-404 into editions or an auction after the fact.
`,
    related: ['token-standard', 'bonding-curve-graduation', 'free-mint-reserve', 'alignment-vault'],
  },
  erc1155: {
    title: 'ERC-1155 — edition collection',
    summary:
      'Classic open editions: you define pieces up front, each with its own supply and fixed price.',
    body: `
**What it is.** ERC-1155 is a straightforward **edition** collection. You define pieces up front, each with its own **supply** (unlimited or a fixed limit) and its own **price** (fixed, or dynamic within rules you set). Buyers mint the edition they want at that price — no curve, no auction. Gating and an optional free mint work the same as the other standards.

**Who it's for.** Creators running a **clear, known drop** — you already know the pieces and what each should cost, and you want buyers to mint them directly.

**What you gain.** Control and simplicity: set prices, per-edition supply caps, and a mint that behaves exactly as configured, with no market mechanics to reason about.

**What you give up.** The market machinery of ERC-404 — there is no bonding-curve price discovery and no automatic graduation to a DEX pool. Price is what you set, not what a curve finds.

**This is fixed on deploy.** The standard is chosen when you create the collection and **cannot be changed later** — editions can't be converted into a bonding curve or an auction afterward.
`,
    related: ['token-standard', 'alignment-vault'],
  },
  erc721: {
    title: 'ERC-721 — auction collection',
    summary:
      'One-of-one pieces sold by timed English auction, with 1–3 parallel lines and an anti-snipe buffer.',
    body: `
**What it is.** ERC-721 here is a **1/1 auction** collection. You queue individual pieces, each with metadata and a starting deposit (its minimum bid), and buyers compete in a **timed English auction** — the high bid wins when the clock runs out. It runs **1–3 parallel auction lines** at once, assigning tokens round-robin, and an **anti-snipe buffer** extends the clock when a late bid lands. The auction parameters are immutable after creation.

**Who it's for.** Creators of **scarce, individually-valued work** — one-of-ones where each piece should find its own price through open bidding rather than a set list price.

**What you gain.** True per-piece price discovery via competitive bidding, and anti-snipe protection so a last-second bid can't steal a lot without giving others a chance to respond.

**What you give up.** Instant, fixed-price buying and fungible liquidity. Buyers must bid and wait for settlement; there is no bonding curve and no shared tradable token.

**This is fixed on deploy.** The standard is chosen when you create the collection and **cannot be changed later** — an auction collection can't become editions or a bonding curve afterward.
`,
    related: ['token-standard', 'alignment-vault'],
  },
  'alignment-vault': {
    title: 'Alignment vaults',
    summary:
      'Every collection binds ~20% of its fees to a vault aligned with an established community — the thing that makes it not a grift.',
    body: `
Every launch here is **bound to an alignment vault**. On mint and on every resale, forever, roughly **20% of the fees** flow to that vault, which holds or LPs the target community's token.

This is the core idea of the launchpad: a derivative collection that **materially supports** the community it draws from, instead of extracting from it. You pick the community you're aligning to, then one of its vaults.

- The binding is **contract-enforced and permanent** — it can't be undone after deploy.
- The capital is **not custodial to us** — it lives in the vault contract.
- Benefactor collections earn a proportional share of the vault's LP yield.

If the community you want isn't listed, you can request a new alignment target.
`,
    related: ['bonding-curve-graduation', 'token-standard'],
  },
  'bonding-curve-graduation': {
    title: 'Bonding curves & graduation',
    summary:
      'ERC-404 only: how the curve prices mints, and what "graduation" deploys when the funding target is hit.',
    body: `
An ERC-404 collection sells along a **bonding curve**: the price of the next mint rises as supply is bought. There's no fixed edition price — early buyers pay less, and the curve funds the collection as it fills.

When the curve reaches its **funding target**, the collection **graduates**:

- Liquidity is deployed into the DEX you chose (Uniswap V4, ZAMM, or Cypher), so the token trades openly.
- The revenue split settles: **1% protocol · 19% alignment vault · 80% liquidity/creator**.
- A creator carve-out is tithed at graduation, within the allowance you declared at create.

Before the curve opens, nothing can be minted or claimed — including free mints. After graduation, the bonding phase is over and the token trades on its pool.
`,
    related: ['alignment-vault', 'free-mint-reserve'],
  },
  'free-mint-reserve': {
    title: 'Free-mint reserve',
    summary:
      'Reserve a slice of supply to hand out at zero cost — claimable once the mint opens, never before.',
    body: `
A free-mint reserve sets aside part of your supply to be claimed at **zero ETH cost**. Set the allocation to **0 to disable** it.

- Reserved pieces come **out of the sellable supply** — they don't inflate it.
- Free mints are part of the launch, not a pre-sale: they are **claimable only once the mint opens**, never before.
- The gating **scope** decides whether your allowlist applies to free claims, paid buys, or both.

Use it for a community round, contributors, or a giveaway — but remember every reserved piece is one fewer sold on the curve.
`,
    related: ['gating-overview', 'bonding-curve-graduation'],
  },
  'mint-fee-and-supply': {
    title: 'Supply & presets',
    summary: 'How supply and the funding target are sized, and who each preset suits.',
    body: `
Your **supply** is the number of pieces the collection can ever mint. For ERC-404 the **preset** sets the curve's funding target and shape:

- **Starter** — a small target; good for a first drop or a tight community.
- **Standard** — a mid-sized target for a typical public launch.
- **Whale** — a large target for an established audience expecting real depth.

Bigger targets need more demand to graduate. Size to the audience you actually have, not the one you hope for — a curve that never fills never graduates.
`,
    related: ['bonding-curve-graduation'],
  },
  'gating-overview': {
    title: 'Gating the mint',
    summary: 'What gating does, and how a wrong choice can brick minting — so choose deliberately.',
    body: `
Gating restricts **who** can mint. You can leave the mint **open**, or gate it behind:

- **Password tiers** — buyers present a secret (hashed before it touches the chain), with per-tier volume caps or unlock times.
- **A merkle allowlist** — only wallets on a list you publish can mint.

Gating is applied at create and stored on the collection. Choose deliberately: a gate that no one can satisfy means **no one can mint**, including you. If you just want an open launch, leave gating off.
`,
    related: ['password-tier-gating', 'merkle-allowlist', 'free-mint-reserve'],
  },
  'password-tier-gating': {
    title: 'Password tiers',
    summary:
      'Volume-cap or time-based tiers gated by a secret; per-wallet caps are not shared supply.',
    body: `
Password-tier gating lets holders of a **secret** mint under rules you set per tier:

- **Volume-cap tiers** — each tier has a per-wallet cap on how much it can mint. Caps are **per wallet**, not a shared pool.
- **Time-based tiers** — each tier unlocks at a set time, so you can stage access.

Passwords are **keccak-hashed before they reach the chain** — the raw secret is never stored. Distribute the secret to the wallets you want to admit.
`,
    related: ['gating-overview'],
  },
  'merkle-allowlist': {
    title: 'Allowlist minting',
    summary:
      'Host your address list and give us the link — we store only its fingerprint on-chain.',
    body: `
An allowlist restricts minting to a set of wallets you choose. Because the list can be huge, you don't type it in — you **host it** (IPFS, Arweave, or any URL you control) and give us the **link**. We read the list, compute its cryptographic fingerprint (the *merkle root*), and store only that root on-chain — tiny and tamper-proof.

**Keep the file hosted.** When someone on your list mints, their browser fetches the list, finds their entry, and builds a short proof of membership that's checked against the on-chain root. If the file disappears, allowlisted buyers can't prove membership — so host it somewhere **permanent**.

The list is a simple JSON array of \`{ address, maxQuantity }\`. Re-host an updated file and point a new tier at it to change the allowlist.
`,
    related: ['gating-overview'],
  },
  'tier-upgrade': {
    title: 'Tier upgrades',
    summary:
      'Reach a higher tier two ways: mint into it directly, or trade up by burning several lower-tier pieces.',
    body: `
Your collection can define tiers, and there are **two ways to hold a higher-tier piece**:

- **Mint it directly.** You can mint straight into a higher tier — burning lower pieces is not required.
- **Trade up.** A holder can exchange several ordinary pieces for one higher-tier piece — say, **10** tier-0 for **1** tier-1. This is a convenience path for someone who already holds the lower pieces, not the only way in.

When pieces are burned to trade up, they are **not destroyed**. This is an ERC-404 collection: the burned pieces return to the collection's **mintable pool** and can be minted again. Total supply is conserved — the mechanic is **not deflationary**; it moves pieces between tiers and back into circulation, rather than shrinking the supply.

A tier-1 can itself be a stepping stone to tier-2 under the same rule.
`,
    related: ['token-standard'],
  },
  'onchain-image-cost': {
    title: 'Embedding art on-chain',
    summary:
      'What it really costs to store a cover on-chain, and when to host it externally instead.',
    body: `
You can either **paste a link** to art you host (IPFS, Arweave, or any HTTPS URL) or **embed a small copy on-chain**. Embedding writes the image bytes into your deploy transaction:

- It costs **real gas**, proportional to the byte size — a large image can be a meaningful fraction of a block.
- Embedded bytes are **permanent** — they live in the collection forever, with no host to disappear.
- The wizard shows the live gas cost as you crop and compress, and offers "fit to" targets.

Rule of thumb: **host it and paste a link** for anything but a tiny thumbnail. Embed only when permanence matters more than the gas.
`,
    related: ['cover-vs-banner', 'withholding-art'],
  },
  'cover-vs-banner': {
    title: 'Cover vs banner',
    summary: 'The cover is your collection image; the banner is the wide image DEX charts read.',
    body: `
Two images, two jobs:

- **Cover** — the square-ish image shown on cards and the collection header. This is your collection's face.
- **Banner** — a wide image whose main purpose is to populate the on-chain metadata that **DEX charts** (DEXScreener, DEXtools) read. A banner there means your chart shows artwork without paying for a listing upgrade.

Both are optional, and both can be hosted or embedded.
`,
    related: ['onchain-image-cost', 'withholding-art'],
  },
  'withholding-art': {
    title: 'Launching without art',
    summary:
      'You can launch with no art and add or reveal it anytime — art is never required to deploy.',
    body: `
Art is **not required** to launch. You can deploy a collection with no cover image and **add or reveal it anytime after**.

A collection with art ready tends to do better — but that's your call as the creator, not a gate we impose. Some launches deliberately withhold art and reveal later as part of the drop.

Nothing about deploying without art is second-class: the contract, the alignment, and the mint all work identically. Add the art when you're ready.
`,
    related: ['onchain-image-cost'],
  },
}

export const CONCEPTS: Record<string, LearnConcept> = Object.fromEntries(
  Object.entries(RAW).map(([slug, c]) => [slug, { slug, ...c }]),
)

export function getConcept(slug: string): LearnConcept | undefined {
  return CONCEPTS[slug]
}

/** Grouped for the /learn index. Order is authored, not alphabetical. */
export const CONCEPT_GROUPS: { title: string; slugs: string[] }[] = [
  {
    title: 'Getting started',
    slugs: ['token-standard', 'erc404', 'erc1155', 'erc721', 'alignment-vault'],
  },
  {
    title: 'ERC-404 mechanics',
    slugs: ['bonding-curve-graduation', 'mint-fee-and-supply', 'free-mint-reserve'],
  },
  { title: 'Gating', slugs: ['gating-overview', 'password-tier-gating', 'merkle-allowlist'] },
  { title: 'Modules', slugs: ['tier-upgrade'] },
  { title: 'Collection page', slugs: ['onchain-image-cost', 'cover-vs-banner', 'withholding-art'] },
]
