/**
 * TierSupplyHelper — the live supply/band math shown beside the tier-band table (noesis-133/141).
 *
 * Token Tiers ids are RESERVED: a band must sit entirely above the ERC404 `nftCount`, because the
 * auto-mint never emits an id past the id ceiling — that is exactly what makes band ids unbuyable
 * and mintable only through the tier path. The band table and `nftCount` are independent wizard
 * inputs and nothing in the form makes the coupling visible, so a creator can set supply 4400 and a
 * band at 4001–4400 that silently collides with ordinary ids. This surfaces the running breakdown —
 * mintable supply, the reserved band range, and whether the bands clear the supply — updating as the
 * creator types. It is the in-context answer to "where do my tier ids go?"; the hard block lives in
 * `validateMetadataConfig` (which this mirrors), this just shows the math so the error is never a
 * surprise.
 */
import { tierSupplySummary } from '../../lib/wizard/metadataConfig'
import styles from './TierSupplyHelper.module.css'

export function TierSupplyHelper({
  nftCount,
  values,
}: {
  /** ERC404 core supply (0 when not yet entered). */
  nftCount: bigint
  /** The metadata-stack form values bag (the parallel band lists live here). */
  values: Record<string, string>
}) {
  const s = tierSupplySummary(values, nftCount)

  const supply = s.supplyKnown ? s.nftCount.toString() : '—'
  const coverage = s.hasBands
    ? `bands reserve ${s.minId.toString()}–${s.maxId.toString()} (${s.bandIdCount.toString()} ids)`
    : 'no tier bands yet'

  // Verdict: only assert placement once BOTH a supply and band rows exist.
  const showVerdict = s.supplyKnown && s.hasBands
  const ok = s.aboveSupply

  return (
    <div
      className={styles.root}
      data-testid="tier-supply-helper"
      data-above={showVerdict ? String(ok) : 'unknown'}
    >
      <p className={styles.head}>tier ids</p>
      <p className={styles.math}>
        <span className={styles.term}>NFT supply: {supply}</span>
        <span className={styles.sep}> · </span>
        <span className={styles.term}>{coverage}</span>
        {showVerdict && ok && (
          <>
            <span className={styles.sep}> · </span>
            <span className={styles.term}>{s.nftCount.toString()} mintable</span>
          </>
        )}
        {showVerdict && (
          <>
            <span className={styles.sep}> · </span>
            <span className={ok ? styles.ok : styles.warn}>
              {ok ? '✓ above supply' : '✗ overlaps supply'}
            </span>
          </>
        )}
      </p>
      {showVerdict && !ok && (
        <p className={styles.note}>
          A tier band starts at or below the {s.nftCount.toString()} supply — those ids are ordinary
          mintable ids, so the band would collide with them. Start the band above the NFT supply, or
          lower the supply.
        </p>
      )}
    </div>
  )
}
