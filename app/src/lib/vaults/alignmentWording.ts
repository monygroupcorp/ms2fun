/**
 * What the 19% actually IS, worded per vault family.
 *
 * The split itself is one law and does not vary: 1% protocol / 19% community / 80% remainder, the
 * same weights in every family (`UniAlignmentVault._splitAndAccrueVaultFees`,
 * `AlignmentEndowmentVault.PROTOCOL_BPS`/`TARGET_BPS`). What DOES vary is the thing being split, and
 * a single sentence cannot be true of both:
 *
 *  - LP families (Uniswap V4 / ZAMM) hold a liquidity position and split the TRADING FEES
 *    it collects. The 80% remainder accrues to the benefactor collections bound to the vault.
 *  - The endowment family (Aave) takes each aligned collection's 19% graduation tithe as CORPUS and
 *    splits the YIELD that corpus earns. So the community's 19% here is 19% of the yield on a
 *    principal that is itself the 19% — and the 80% remainder is the creator's, paid out of
 *    `yieldPurse`, not a share of trading fees.
 *
 * Saying "19% of every collection's fees route to the community" on an endowment vault is therefore
 * wrong twice over: the flow is yield rather than fees, and it conceals that the creator is taking
 * 80% of that same yield. These strings are the per-family answer.
 */
import { formatBps } from '../format'
import type { VaultFamily } from '../wizard/vaultFlavor'

/** The weights, stated once. Every string below is a reading of these three numbers. */
export const ALIGNMENT_SPLIT = {
  protocolBps: 100,
  communityBps: 1_900,
  remainderBps: 8_000,
} as const

/**
 * The community's cut on one vault, worded for its family. `community` is the target's own title
 * when it is known, so the sentence names who is being paid rather than saying "the community".
 */
export function communityCutSentence(family: VaultFamily, community?: string): string {
  const who = community?.trim() ? community.trim() : 'the community'
  return family === 'yield'
    ? `Each aligned collection tithes 19% of its raise here as corpus. 19% of the yield that corpus earns routes to ${who} — the creators take the other 80%.`
    : `19% of the trading fees this vault's liquidity earns route to ${who}. The collections bound to it take the other 80%.`
}

/**
 * The law across families, for surfaces that span more than one vault (the index page). It states
 * the ratio, which genuinely is invariant, and declines to name one source for it — a summary page
 * that says "of every collection's fees" is asserting the LP reading over every endowment vault on
 * it.
 */
export const ALIGNMENT_LAW_SENTENCE =
  'Every collection is bound to a community and pays it 19%, at a ratio nobody can change.'

/** The same claim under the index page's section heading, where the list is already in view. */
export const ALIGNMENT_LAW_SECTION_SENTENCE =
  'The communities collections bind to, each paid 19% at a ratio nobody can change.'

/**
 * The law on ONE collection, where the payee is known and the family is not.
 *
 * A collection page and a token page see the vault a collection is bound to, but `ProjectCard`
 * carries `vault`/`vaultName` and no `vaultType()` — nothing on those surfaces can tell an LP vault
 * from an endowment one, and the vault's own page is the first that can. So they may state the
 * ratio and name the payee, and must not name a source: "19% of every fee" is the LP reading
 * asserted over an endowment collection, and "19% of every resale" claims a royalty the contracts
 * do not implement at all. "On every mint" is wrong on every family besides, because the bind lands
 * at edition mint, auction close, or ERC404 graduation depending on the standard.
 */
export function alignmentLawSentence(community?: string): string {
  const who = community?.trim() ? community.trim() : 'the community'
  return `Bound to ${who}, which is paid 19% on-chain — at a ratio nobody can change.`
}

/**
 * The same law in a caption-width slot — the landing ledger's row note, where a full sentence does
 * not fit. Source-blind for the same reason the index page's sentence is: the landing page spans
 * every family.
 */
export const ALIGNMENT_LAW_NOTE =
  '19% to the community — a contract constant, not a creator setting'

// ── What each standard actually settles, and what it does not ────────────────

/**
 * The three launch standards, keyed as the wizard keys them.
 *
 * The alignment claim is NOT one sentence across these. Each standard captures the community's
 * share at a different moment, out of a different base, and only one of them carries anything at
 * all after the primary sale:
 *
 *   erc404  `ERC404BondingOps.deployLiquidity` → `RevenueSplitLib.splitGraduation(raise, …)`:
 *           19% of the WHOLE raise at graduation, before the pool is funded. Curve buys are
 *           fee-free (`ERC404BondingInstance.buyBonding`, "No buy-side fee"); the 1% on curve
 *           exits is a protocol fee to the treasury, not the community's.
 *   erc1155 `ERC1155Instance.withdraw` → `RevenueSplitLib.split(amount)`: 19% of each withdrawal
 *           of mint proceeds.
 *   erc721  `ERC721AuctionInstance.settleAuction` → `RevenueSplitLib.split(auction.highBid)`:
 *           19% of the winning bid, after the creator's reserve deposit is refunded.
 *
 * In every case the base is the SALE, not a fee levied on top of one — which is why "19% of fees"
 * was wrong on all three at once.
 */
export type LaunchStandard = 'erc404' | 'erc1155' | 'erc721'

/** Where the community's 19% is taken, per standard. */
const SETTLEMENT_MOMENT: Record<LaunchStandard, string> = {
  erc404:
    'When the curve fills and the collection graduates, 19% of the whole raise goes to the community before a single wei reaches the pool.',
  erc1155:
    'Every withdrawal of mint proceeds pays the community 19% — out of the mint price itself, not a fee added on top of it.',
  erc721:
    'Every auction that settles pays the community 19% of the winning bid — out of the bid itself, not a fee added on top of it. Your reserve comes back to you first.',
}

export function settlementMomentSentence(standard: LaunchStandard): string {
  return SETTLEMENT_MOMENT[standard]
}

/**
 * What happens after the primary sale, per standard — the half the old copy got wrong.
 *
 * Editions and auctions have no after of any kind. There is no `royaltyInfo` and no ERC-2981 in any
 * file under `contracts/src`, so nothing here takes a share of a resale, and both may say so flat.
 *
 * ERC-404 is the one standard with an after, and it is `null` here on purpose: its answer is not a
 * property of the standard but of the deployer the launch graduates through, so it cannot be
 * written down in advance. `swapTitheSentence` answers it from what that deployer actually says.
 */
const SECONDARY_EARN: Record<LaunchStandard, string | null> = {
  erc404: null,
  erc1155:
    'Nothing is taken after that. An edition pays the community on the way out of the primary sale and never again — not on a resale, not on a transfer.',
  erc721:
    'Nothing is taken after that. An auction collection pays the community when a piece sells here and never again — not on a resale, not on a transfer.',
}

export function secondaryEarnSentence(standard: LaunchStandard): string | null {
  return SECONDARY_EARN[standard]
}

// ── The ERC-404 swap tithe, as the chain reports it ──────────────────────────

/**
 * What the selected liquidity deployer says about the perpetual swap tithe.
 *
 * The tithe is `UniAlignmentV4Hook`: it takes `hookFeeBips` of the ETH side of each swap and
 * forwards it to the vault (`beforeSwap`/`afterSwap` → `_collectAndForward`). Whether a graduation
 * mints that hook at all is `LiquidityDeployerModule.alignmentHookFactory` — `address(0)` (the
 * ship default) means the pool graduates with `hooks: address(0)` and a static fee, untaxed.
 *
 * Three answers, and the third is not a failure mode to be papered over:
 *
 *  - `taxed`   the deployer names a hook factory, so every graduation through it mints a hook at
 *              `feeBips`. The claim can be made flat, with the real number.
 *  - `untaxed` the deployer names `address(0)`. The pool takes nothing after graduation, and a
 *              creator must hear that rather than be left hoping.
 *  - `unknown` nothing was asked, or the answer did not come back. The ZAMM deployer is the plain
 *              case: it declares neither getter (the tithe is Uni-V4-only by decision, see
 *              `ZAMMLiquidityDeployerModule`'s header and `docs/phases/vault-flavors.md`), so the
 *              call hits no function and reverts. An unreachable node reverts too, and the two are
 *              indistinguishable from here — which is exactly why this branch says nothing at all
 *              instead of guessing `untaxed`. Telling a Uniswap creator their pool is untaxed
 *              because the RPC was down is the same lie as the overclaim, pointed the other way.
 *  - `pending` the read is in flight. Also silent: a step that shows "untaxed" for half a second
 *              and then flips has already told the creator something false.
 */
export type SwapTithe =
  | { kind: 'pending' }
  | { kind: 'unknown' }
  | { kind: 'untaxed' }
  | { kind: 'taxed'; feeBips: bigint }

/**
 * The after-market sentence for an ERC-404 launch, or `null` when the honest output is silence.
 *
 * `feeBips` is basis points against a 10_000 denominator — `formatBps` is the only thing that reads
 * it, and 100 bips renders "1%". A hook wired at zero bips is worded as untaxed: it exists, but it
 * moves no money, and "every swap pays 0%" is a sentence that informs nobody.
 */
export function swapTitheSentence(tithe: SwapTithe): string | null {
  if (tithe.kind === 'pending' || tithe.kind === 'unknown') return null
  if (tithe.kind === 'untaxed' || tithe.feeBips === 0n) {
    return 'After graduation the token trades in an untaxed pool: no swap through it pays the community anything. The share taken at graduation is the whole of it — count on that, and do not count on a cut of the trading that follows.'
  }
  return `After graduation the token trades in a pool that charges for the community: every swap through it pays ${formatBps(tithe.feeBips)} of the ETH side into the vault — buys and sells alike — for as long as the pool trades. The rate is fixed in the pool's own hook at deploy and cannot be raised afterwards, and no marketplace is asked to honour it: the pool takes it.`
}

/**
 * The no, said once and without apology.
 *
 * A creator arriving from Manifold, Zora or objkt expects a royalty percentage field and must meet
 * its absence at the moment they are choosing, not after they have deployed. ERC-2981's
 * `royaltyInfo(tokenId, salePrice)` is a read-only lookup that moves no money: a marketplace is
 * free not to call it, and since 2022 most do not. Nothing under `contracts/src` implements it.
 */
export const NO_ROYALTY_SENTENCE =
  'There is no royalty field here, on any standard, and that is a position rather than a gap: a royalty written into NFT metadata is a request a marketplace can decline, and most now do. What this protocol takes, it takes at settlement, inside the contract that moves the money — so it cannot be declined.'

/** The same no in a caption-width slot, for the review panel. */
export const NO_ROYALTY_NOTE =
  'No secondary royalty — a metadata royalty is a request marketplaces can ignore. The alignment share is taken at settlement instead.'
