/**
 * TierSupplyHelper — the live "total IDs" math shown beside the tier-reveal table (noesis-133).
 *
 * The tier table and the ERC404 `nftCount` are independent wizard inputs; nothing in the form makes
 * the coupling visible, so a creator can set supply 4000 with a tier ending at 4400 and silently mint
 * DEAD ids. This surfaces the running breakdown — base (untiered) ids + the tier ranges → the total,
 * and whether the ranges fit within supply — updating as the creator types. It is the in-context
 * answer to "does my tier range fit?"; the hard block lives in `validateMetadataConfig` (which this
 * mirrors), this just shows the math so the error is never a surprise.
 */
import { tierSupplySummary } from '../../lib/wizard/metadataConfig'
import styles from './TierSupplyHelper.module.css'

export function TierSupplyHelper({
  nftCount,
  values,
}: {
  /** ERC404 core supply (0 when not yet entered). */
  nftCount: bigint
  /** The metadata-stack form values bag (the parallel tier lists live here). */
  values: Record<string, string>
}) {
  const s = tierSupplySummary(values, nftCount)

  const supply = s.supplyKnown ? s.nftCount.toString() : '—'
  const coverage = s.hasTiers
    ? `tiers cover ${s.minId.toString()}–${s.maxId.toString()} (${s.tierIdCount.toString()} ids)`
    : 'no tier ranges yet'

  // Verdict: only assert fit once BOTH a supply and tier rows exist.
  const showVerdict = s.supplyKnown && s.hasTiers
  const ok = s.withinSupply

  return (
    <div
      className={styles.root}
      data-testid="tier-supply-helper"
      data-within={showVerdict ? String(ok) : 'unknown'}
    >
      <p className={styles.head}>total ids</p>
      <p className={styles.math}>
        <span className={styles.term}>NFT supply: {supply}</span>
        <span className={styles.sep}> · </span>
        <span className={styles.term}>{coverage}</span>
        {showVerdict && ok && s.untieredCount > 0n && (
          <>
            <span className={styles.sep}> · </span>
            <span className={styles.term}>{s.untieredCount.toString()} untiered</span>
          </>
        )}
        {showVerdict && (
          <>
            <span className={styles.sep}> · </span>
            <span className={ok ? styles.ok : styles.warn}>
              {ok ? '✓ within supply' : '✗ exceeds supply'}
            </span>
          </>
        )}
      </p>
      {showVerdict && !ok && (
        <p className={styles.note}>
          A tier range ends past the {s.nftCount.toString()} supply — those ids never mint. Raise
          the NFT supply or lower the range.
        </p>
      )}
    </div>
  )
}
