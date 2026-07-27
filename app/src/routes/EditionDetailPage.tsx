/**
 * EditionDetailPage (W-D2). Shareable, standalone "drop" page for ONE ERC1155 edition at
 * `/collection/:instance/edition/:id`: hero art, stats, inline mint (shared MintPanel), and
 * metadata-driven theming.
 *
 * Theming convention (see ./components/collection/erc1155/editionTheme.ts): the edition's metadata
 * JSON may carry `theme: { accent, background }` (strict hex). When present they recolor a single
 * seam — accent on the title underline + mint-CTA border, background tint on the stats panel — so
 * editions look distinct. Absent/invalid → the default monochrome Gallery Brutalism look.
 *
 * Note: the on-chain EditionView (QueryAggregator batch) does NOT expose `openTime`, so this page
 * does not render an "opens <when>" stat — it works only from the fields the aggregator returns.
 */
import { useState } from 'react'
import { Link, Redirect, useParams } from 'wouter'
import { formatEther } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../components/useCollection'
import { useEditions, type EditionView } from '../components/collection/useEditions'
import { MintPanel } from '../components/collection/erc1155/MintPanel'
import { editionThemeStyle, type EditionTheme } from '../components/collection/erc1155/editionTheme'
import { fetchJson, isResolvableUri } from '../lib/metadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { StateBlock } from '../components/ui/StateBlock'
import { MintBar } from '../components/ui/MintBar'
import {
  CollectionChainProvider,
  useCollectionChainId,
  useCollectionSlug,
} from '../components/collection/useCollectionChain'
import { forkChainId } from '../lib/addresses'
import {
  RouteWrongChainBanner,
  collectionRoutePath,
  renderCollectionRouteState,
  useResolvedCollectionRoute,
} from './CollectionPage'
import styles from './EditionDetailPage.module.css'

interface EditionMetadata {
  name?: string
  description?: string
  image?: string
  theme?: EditionTheme
}

const PRICING_MODEL_LABELS: Record<number, string> = {
  0: 'fixed',
  1: 'limited',
  2: 'dynamic',
}

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : undefined
}

function useEditionMetadata(uri: string | undefined): EditionMetadata | undefined {
  const { data } = useQuery({
    queryKey: ['edition-metadata', uri],
    enabled: isResolvableUri(uri),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => (await fetchJson<EditionMetadata>(uri as string, signal)) ?? {},
  })
  return data
}

function invalidReferenceState() {
  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
        </Link>
      </nav>
      <StateBlock variant="empty">invalid edition reference</StateBlock>
    </div>
  )
}

/** Chain-scoped route: `/:chainId/:slug/edition/:id`. Resolves the slug, then renders the existing
 * `EditionDetail` body inside a `<CollectionChainProvider>` (chain-scoped-slug-routes noesis-079). */
export function EditionDetailPage() {
  const params = useParams<{ chainId?: string; slug?: string; id?: string }>()
  const resolution = useResolvedCollectionRoute(params.chainId, params.slug)
  const id = params.id !== undefined && /^\d+$/.test(params.id) ? BigInt(params.id) : undefined

  const state = renderCollectionRouteState(resolution, `/edition/${params.id ?? ''}`)
  if (state !== undefined) return state
  if (resolution.status !== 'ok') return null // unreachable — narrows the type below

  if (id === undefined) return invalidReferenceState()

  return (
    <CollectionChainProvider chainId={resolution.chainId} slug={resolution.slug}>
      <RouteWrongChainBanner chainId={resolution.chainId} />
      <EditionDetail instance={resolution.instance} id={id} />
    </CollectionChainProvider>
  )
}

/** Legacy address-keyed route (`/collection/:instance/edition/:id`) — permanently redirects to the
 * slug URL (chain-scoped-slug-routes noesis-079 step 8). Chain-blind by design; see
 * `LegacyCollectionRedirect` in `./CollectionPage`. */
export function LegacyEditionRedirect() {
  const params = useParams<{ instance?: string; id?: string }>()
  const instance = toAddress(params.instance)
  const { data: card, isPending, isError } = useCollection(instance)

  if (!instance || params.id === undefined) return invalidReferenceState()

  if (isPending) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← noesis
          </Link>
        </nav>
        <StateBlock variant="loading">hanging the work…</StateBlock>
      </div>
    )
  }

  if (isError || !card || card.instance === '0x0000000000000000000000000000000000000000') {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← noesis
          </Link>
        </nav>
        <StateBlock variant="empty">edition not found</StateBlock>
      </div>
    )
  }

  return (
    <Redirect
      to={collectionRoutePath(forkChainId, card.name.toLowerCase(), `/edition/${params.id}`)}
      replace
    />
  )
}

interface EditionDetailProps {
  instance: `0x${string}`
  id: bigint
}

function EditionDetail({ instance, id }: EditionDetailProps) {
  const chainId = useCollectionChainId()
  const slug = useCollectionSlug()
  const { data: editions, isPending, isError, refetch } = useEditions(instance)
  const edition: EditionView | undefined = editions.find((e) => e.id === id)

  const meta = useEditionMetadata(edition?.metadataURI)

  const [copied, setCopied] = useState(false)
  function handleShare(): void {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      },
      () => setCopied(false),
    )
  }

  const crumb = (
    <nav className={styles.crumb}>
      <Link href={collectionRoutePath(chainId, slug)} className={styles.back}>
        ← collection
      </Link>
    </nav>
  )

  if (isPending) {
    return (
      <div className={styles.page} data-testid="edition-detail">
        {crumb}
        <StateBlock variant="loading">loading edition…</StateBlock>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.page} data-testid="edition-detail">
        {crumb}
        <StateBlock variant="error">couldn't load edition — is the fork up?</StateBlock>
      </div>
    )
  }

  if (!edition) {
    return (
      <div className={styles.page} data-testid="edition-detail">
        {crumb}
        <StateBlock variant="empty">edition not found</StateBlock>
      </div>
    )
  }

  const title = meta?.name || edition.pieceTitle || `edition #${edition.id}`
  const fallbackGlyph = (meta?.name || edition.pieceTitle || '✦').slice(0, 1).toUpperCase()
  const pricingLabel = PRICING_MODEL_LABELS[edition.pricingModel] ?? `model-${edition.pricingModel}`
  const supplyLabel = edition.supply === 0n ? 'unlimited' : edition.supply.toString()
  const limited = edition.supply > 0n
  const remaining = limited ? edition.supply - edition.minted : 0n
  const fillPct = limited ? Math.min(100, Number((edition.minted * 100n) / edition.supply)) : 0

  return (
    <div
      className={`noesis-edition ${styles.page}`}
      data-testid="edition-detail"
      style={editionThemeStyle(meta?.theme)}
    >
      {crumb}

      <div className={styles.plate}>
        {/* The work, hung — the placard family's framed idiom, edge-to-edge on mobile. */}
        <div className={styles.framewrap}>
          <div className={`noesis-frame ${styles.frame}`}>
            <span className="noesis-tick tl" />
            <span className="noesis-tick tr" />
            <span className="noesis-tick bl" />
            <span className="noesis-tick br" />
            <div className={styles.artInner}>
              <IpfsImage
                uri={meta?.image ?? ''}
                alt={title}
                className={styles.art}
                loading="eager"
                fallback={<div className={styles.artGlyph}>{fallbackGlyph}</div>}
              />
            </div>
          </div>
        </div>

        {/* The wall label — identity is the NUMBER, so the counter leads. */}
        <div className={styles.label}>
          <header className={styles.header}>
            <h1 className={`ed-title ${styles.title}`}>{title}</h1>
            <button
              type="button"
              className={styles.share}
              onClick={handleShare}
              data-testid="edition-share"
            >
              {copied ? 'link copied' : 'copy link'}
            </button>
          </header>

          {meta?.description && <p className={styles.description}>{meta.description}</p>}

          <div className={styles.counterWrap}>
            <div className="noesis-counter">
              <span className="n">{edition.minted.toString()}</span>
              <span className="of">/ {supplyLabel}</span>
              {limited && <span className="left">{remaining.toString()} remaining</span>}
            </div>
            {limited && (
              <div className="track">
                <div className="fill" style={{ width: `${fillPct}%` }} />
              </div>
            )}
          </div>

          <div className="ed-stats">
            <div className="r">
              <span className="k">price</span>
              <span className="v">{formatEther(edition.currentPrice)} ETH</span>
            </div>
            <div className="r">
              <span className="k">pricing</span>
              <span className="v">{pricingLabel}</span>
            </div>
          </div>

          <section className={styles.mint} id="mint" data-testid="edition-mint">
            <MintPanel instance={instance} edition={edition} refetch={refetch} />
          </section>
        </div>
      </div>

      {/* Mobile: the sticky mint bar keeps the impression in thumb reach. */}
      <MintBar
        price={`${formatEther(edition.currentPrice)} ETH`}
        sub={limited ? `${remaining.toString()} left` : 'open'}
        action={<a href="#mint">Mint</a>}
      />
    </div>
  )
}
