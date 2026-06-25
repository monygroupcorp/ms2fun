import styles from './HomeStats.module.css'

interface Stat {
  label: string
  value: string
  pending?: boolean
}

/**
 * Stats bar for the home landing surface. Pure presentational — the page owns the data so home
 * paints from the fast featured path first and the (slower) full-registry scan fills in its number
 * when ready, without blocking the rest of the page.
 */
export function HomeStats({ stats }: { stats: Stat[] }) {
  return (
    <dl className={styles.bar} data-testid="home-stats">
      {stats.map((s) => (
        <div key={s.label} className={styles.stat}>
          <dt className={styles.label}>{s.label}</dt>
          <dd className={`${styles.value} ${s.pending ? styles.pending : ''}`}>
            {s.pending ? '··' : s.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
