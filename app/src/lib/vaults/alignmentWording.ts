/**
 * What the 19% actually IS, worded per vault family.
 *
 * The split itself is one law and does not vary: 1% protocol / 19% community / 80% remainder, the
 * same weights in every family (`UniAlignmentVault._splitAndAccrueVaultFees`,
 * `AlignmentEndowmentVault.PROTOCOL_BPS`/`TARGET_BPS`). What DOES vary is the thing being split, and
 * a single sentence cannot be true of both:
 *
 *  - LP families (Uniswap V4 / ZAMM / Cypher) hold a liquidity position and split the TRADING FEES
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
