/**
 * TokenDetailPage (W-D1 shell → filled by W-D3). Shareable per-token route
 * `/collection/:instance/token/:id` for a single NFT: the DN404 mirror token (ERC404) or an ERC721
 * auction piece. Shows the art (tokenURI), owner, and type-specific context (auction history for
 * ERC721). The shell validates params + resolves the collection type; D3 builds the art surface.
 */
import { Link, useParams } from 'wouter'
import { useCollection } from '../components/useCollection'
import styles from './EditionDetailPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : undefined
}

export function TokenDetailPage() {
  const params = useParams<{ instance?: string; id?: string }>()
  const instance = toAddress(params.instance)
  const id = params.id !== undefined && /^\d+$/.test(params.id) ? BigInt(params.id) : undefined
  const { data: card } = useCollection(instance)

  if (!instance || id === undefined) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <p className={styles.note}>invalid token reference</p>
      </div>
    )
  }

  return (
    <div className={styles.page} data-testid="token-detail" data-type={card?.contractType}>
      <nav className={styles.crumb}>
        <Link href={`/collection/${instance}`} className={styles.back}>
          ← collection
        </Link>
      </nav>
      <p className={styles.note}>token #{id.toString()} — W-D3</p>
    </div>
  )
}
