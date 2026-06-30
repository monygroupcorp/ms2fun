import styles from './HomeStats.module.css'

interface Stat {
  label: string
  value: string
  pending?: boolean
}

/**
 * Stats bar for the home landing surface — the room's vital signs. Pure presentational: the page
 * owns the data so home paints from the fast featured path first and the (slower) full-registry
 * scan fills its number when ready (`pending` → `··`) without blocking the rest of the page.
 * Visual layer is the `.noesis-stats` device (vendored signature.css): mono cells, one rule
 * between them, the value in display type over a mono label.
 */
export function HomeStats({ stats }: { stats: Stat[] }) {
  return (
    <dl className="noesis-stats" data-testid="home-stats">
      {stats.map((s) => (
        <div key={s.label} className="s">
          <dd className={`v ${s.pending ? styles.pending : ''}`}>{s.pending ? '··' : s.value}</dd>
          <dt className="k">{s.label}</dt>
        </div>
      ))}
    </dl>
  )
}
