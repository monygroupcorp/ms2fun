/**
 * EditionDetailPage (W-D1 shell → filled by W-D2). Shareable per-edition route
 * `/collection/:instance/edition/:id` for an ERC1155 edition: hero art, stats, inline mint, and
 * metadata-driven theming. The shell validates params; D2 builds the surface.
 */
import { Link, useParams } from 'wouter'
import styles from './EditionDetailPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : undefined
}

export function EditionDetailPage() {
  const params = useParams<{ instance?: string; id?: string }>()
  const instance = toAddress(params.instance)
  const id = params.id !== undefined && /^\d+$/.test(params.id) ? BigInt(params.id) : undefined

  if (!instance || id === undefined) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <p className={styles.note}>invalid edition reference</p>
      </div>
    )
  }

  return (
    <div className={styles.page} data-testid="edition-detail">
      <nav className={styles.crumb}>
        <Link href={`/collection/${instance}`} className={styles.back}>
          ← collection
        </Link>
      </nav>
      <p className={styles.note}>edition detail — W-D2</p>
    </div>
  )
}
