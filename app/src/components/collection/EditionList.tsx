/**
 * EditionList — renders all ERC1155 editions for a given instance with per-edition mint panels.
 * Reads editions via useEditions (batched), reads live mint cost on-demand, and writes via
 * ERC1155Instance.mint with msg.value equal to the calculated cost.
 */
import { formatEther } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { FreeMintClaimPanel } from './erc1155/FreeMintClaimPanel'
import { MintPanel } from './erc1155/MintPanel'
import { useEditions, type EditionView } from './useEditions'
import { fetchJson, isResolvableUri } from '../../lib/metadata'
import { IpfsImage } from '../ui/IpfsImage'
import styles from './EditionList.module.css'

/** Fetch an edition's cover image from its metadata JSON (cached; skipped for unresolvable URIs). */
function useEditionArt(uri: string | undefined): string | undefined {
  const { data } = useQuery({
    queryKey: ['edition-art', uri],
    enabled: isResolvableUri(uri),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) =>
      (await fetchJson<{ image?: string }>(uri as string, signal))?.image ?? '',
  })
  return data || undefined
}

const PRICING_MODEL_LABELS: Record<number, string> = {
  0: 'fixed',
  1: 'limited',
  2: 'dynamic',
}

interface EditionListProps {
  instance: `0x${string}`
}

export function EditionList({ instance }: EditionListProps) {
  const { data, isPending, isError, refetch } = useEditions(instance)

  if (isPending) {
    return <p className={styles.note}>loading editions…</p>
  }

  if (isError) {
    return <p className={styles.note}>could not load editions — is the fork up?</p>
  }

  const firstEdition = data[0]
  if (firstEdition === undefined) {
    return (
      <p className={styles.note} data-testid="editions-empty">
        no editions yet
      </p>
    )
  }

  return (
    <div className={styles.editions}>
      {/* Free-mint claim is per-instance (allocation is a single tranche); target the first
          edition. The panel renders nothing unless the connected wallet is eligible. */}
      <FreeMintClaimPanel instance={instance} editionId={firstEdition.id} />
      <ul className={styles.list} data-testid="editions">
        {data.map((edition) => (
          <li key={edition.id.toString()} className={styles.card}>
            <EditionCard edition={edition} instance={instance} refetch={refetch} />
          </li>
        ))}
      </ul>
    </div>
  )
}

interface EditionCardProps {
  edition: EditionView
  instance: `0x${string}`
  refetch: () => void
}

function EditionCard({ edition, instance, refetch }: EditionCardProps) {
  const pricingLabel = PRICING_MODEL_LABELS[edition.pricingModel] ?? `model-${edition.pricingModel}`
  const supplyLabel = edition.supply === 0n ? 'unlimited' : edition.supply.toString()
  const title = edition.pieceTitle || `edition #${edition.id}`
  const image = useEditionArt(edition.metadataURI)
  const editionHref = `/collection/${instance}/edition/${edition.id}`

  return (
    <>
      {/* M3: lead with the art — the edition cover, big, linking to its page (not just a text link). */}
      <Link href={editionHref} className={styles.artLink} aria-label={title}>
        <IpfsImage
          uri={image ?? ''}
          alt={title}
          className={styles.artImg}
          fallback={
            <div className={styles.artGlyph} aria-hidden>
              {(title[0] ?? '✦').toUpperCase()}
            </div>
          }
        />
      </Link>
      <div className={styles.cardHeader}>
        <Link href={editionHref} className={styles.titleLink}>
          <h3 className={styles.title}>{title}</h3>
        </Link>
        <span className={styles.badge}>{pricingLabel}</span>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>price</span>
          <span className={styles.statValue}>{formatEther(edition.currentPrice)} ETH</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>minted</span>
          <span className={styles.statValue}>{edition.minted.toString()}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>supply</span>
          <span className={styles.statValue}>{supplyLabel}</span>
        </div>
      </div>
      <MintPanel instance={instance} edition={edition} refetch={refetch} />
    </>
  )
}
