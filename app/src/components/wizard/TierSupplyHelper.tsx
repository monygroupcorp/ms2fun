/**
 * TierSupplyHelper — the derived tier geometry shown beside the ladder form (noesis-133/141/160).
 *
 * The creator supplies a LADDER (denomination, how many, art prefix); the factory derives every id
 * range from it and seals both the instance's economic ladder and the resolver's art table from the
 * same ranges. Band ids are packed above the ERC404 `nftCount`, because the auto-mint never emits an
 * id past the id ceiling — that is exactly what makes band ids unbuyable and reachable only through
 * the tier path. Nothing in the form makes that geometry visible, so this reproduces the contract's
 * derivation read-only: per tier, the denomination, the id range it will get, how many ids that is,
 * and the most the supply could back. A tier capped below that maximum is shown as scarce — it can
 * sell out while coin remains, and reopens when a holder mints down.
 *
 * Read-out only. The ranges here are never submitted; `validateMetadataConfig` owns the hard blocks.
 */
import { tierSupplySummary } from '../../lib/wizard/metadataConfig'
import styles from './TierSupplyHelper.module.css'

export function TierSupplyHelper({
  nftCount,
  values,
}: {
  /** ERC404 core supply (0 when not yet entered). It is also the instance's id ceiling. */
  nftCount: bigint
  /** The metadata-stack form values bag (the parallel ladder lists live here). */
  values: Record<string, string>
}) {
  const s = tierSupplySummary(values, nftCount)

  const supply = s.supplyKnown ? s.nftCount.toString() : '—'
  const derived = s.tiers.length > 0

  return (
    <div
      className={styles.root}
      data-testid="tier-supply-helper"
      data-derived={derived ? 'true' : 'false'}
    >
      <p className={styles.head}>tier ids</p>
      <p className={styles.math}>
        <span className={styles.term}>NFT supply: {supply}</span>
        <span className={styles.sep}> · </span>
        <span className={styles.term}>
          {derived
            ? `bands reserve ${s.bandIdCount.toString()} ids above the supply`
            : s.hasTiers
              ? 'enter an NFT supply to see the derived ids'
              : 'no tiers yet'}
        </span>
      </p>
      {derived && (
        <ul className={styles.rows}>
          {s.tiers.map((t) => (
            <li key={t.tierNumber} className={styles.row} data-scarce={String(t.scarce)}>
              <span className={styles.term}>
                tier {t.tierNumber} · ×{t.weight}
              </span>
              <span className={styles.sep}> · </span>
              <span className={styles.term}>
                ids {t.idStart.toString()}–{t.idEnd.toString()}
              </span>
              <span className={styles.sep}> · </span>
              <span className={t.scarce ? styles.scarce : styles.ok}>
                {t.count.toString()} of {t.maxCount.toString()} possible
              </span>
            </li>
          ))}
        </ul>
      )}
      {derived && s.tiers.some((t) => t.scarce) && (
        <p className={styles.note}>
          A capped tier is deliberately scarce: it sells out while coin remains, and reopens when a
          holder mints back down. Leave the count blank for the largest band the supply can back.
        </p>
      )}
    </div>
  )
}
