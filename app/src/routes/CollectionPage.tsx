import type { ReactNode } from 'react'
import { Link, Redirect, useParams } from 'wouter'
import { formatGwei } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'
import { useReadMasterRegistryV1ResolveName } from '../generated/contracts'
import { useCollection } from '../components/useCollection'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { MessageComposer } from '../components/MessageComposer'
import { MessageFeed } from '../components/MessageFeed'
import { VaultPanel } from '../components/collection/VaultPanel'
import { FeaturedPanel } from '../components/featured/FeaturedPanel'
import { resolveCollectionSurfaces } from '../components/collection/types/collectionSurfaces'
import { ProjectStyle } from '../components/collection/ProjectStyle'
import { CollectionHero } from '../components/collection/CollectionHero'
import {
  CollectionChainProvider,
  useCollectionAddresses,
  useCollectionChainId,
} from '../components/collection/useCollectionChain'
import { addressesForChain, forkChainId, type SupportedChainId } from '../lib/addresses'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
import { MintBar } from '../components/ui/MintBar'
import { txErrorReason } from '../components/ui/useTxAction'
import styles from './CollectionPage.module.css'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw as `0x${string}`
  return undefined
}

function CrumbBack() {
  return (
    <nav className={styles.crumb}>
      <Link href="/" className={styles.back}>
        ← noesis
      </Link>
    </nav>
  )
}

/** Discriminated result of resolving a `(chainId, slug)` route param pair to a collection. */
export type CollectionRouteResolution =
  | { status: 'unknown-network'; chainId: number }
  | { status: 'case-redirect'; chainId: number; slug: string }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ok'; instance: `0x${string}`; chainId: SupportedChainId; slug: string }

/**
 * Shared resolver for the three chain-scoped collection routes (`/:chainId/:slug[/edition|/token]`,
 * chain-scoped-slug-routes noesis-079). Always calls `useReadMasterRegistryV1ResolveName`
 * unconditionally (Rules of Hooks) — invalid states disable the read via `query.enabled` rather
 * than skipping the hook call.
 */
export function useResolvedCollectionRoute(
  rawChainId: string | undefined,
  rawSlug: string | undefined,
): CollectionRouteResolution {
  const chainId = rawChainId !== undefined && /^\d+$/.test(rawChainId) ? Number(rawChainId) : NaN
  const slug = rawSlug ?? ''
  const lower = slug.toLowerCase()
  const addresses = Number.isNaN(chainId) ? undefined : addressesForChain(chainId)
  const needsCaseRedirect = addresses !== undefined && slug !== '' && slug !== lower

  const {
    data: resolved,
    isPending,
    isError,
  } = useReadMasterRegistryV1ResolveName({
    address: addresses?.MasterRegistryV1 ?? ZERO_ADDRESS,
    chainId: (addresses ? chainId : forkChainId) as SupportedChainId,
    args: [lower],
    query: { enabled: !!addresses && slug !== '' && !needsCaseRedirect },
  })

  if (!addresses) return { status: 'unknown-network', chainId }
  if (slug === '') return { status: 'not-found' }
  if (needsCaseRedirect) return { status: 'case-redirect', chainId, slug: lower }
  if (isPending) return { status: 'loading' }
  if (isError) return { status: 'error' }
  if (!resolved || resolved === ZERO_ADDRESS) return { status: 'not-found' }
  return { status: 'ok', instance: resolved, chainId: chainId as SupportedChainId, slug: lower }
}

/** Builds a chain-scoped collection path, appending an optional path suffix (`/edition/:id`,
 * `/token/:id`) the caller already validated. */
export function collectionRoutePath(chainId: number, slug: string, suffix = ''): string {
  return `/${chainId}/${slug}${suffix}`
}

/**
 * Renders the unknown-network / case-redirect / loading / error / not-found states shared by all
 * three chain-scoped collection routes. Returns `undefined` when resolution is `ok` — the caller
 * then renders its own body inside a `<CollectionChainProvider>`.
 */
export function renderCollectionRouteState(
  resolution: CollectionRouteResolution,
  suffix = '',
): ReactNode | undefined {
  switch (resolution.status) {
    case 'unknown-network':
      return (
        <div className={styles.page}>
          <CrumbBack />
          <p className={styles.kicker}>Collections</p>
          <h1 className={styles.title}>Collection</h1>
          <StateBlock variant="empty">
            this app doesn&apos;t serve chain {resolution.chainId}.{' '}
            <Link href="/collections">back to collections</Link>
          </StateBlock>
        </div>
      )
    case 'case-redirect':
      return (
        <Redirect to={collectionRoutePath(resolution.chainId, resolution.slug, suffix)} replace />
      )
    case 'loading':
      return (
        <div className={styles.page}>
          <CrumbBack />
          <StateBlock variant="loading">hanging the work…</StateBlock>
        </div>
      )
    case 'error':
      return (
        <div className={styles.page}>
          <CrumbBack />
          <StateBlock variant="error">
            couldn&apos;t resolve this collection — is the fork up?
          </StateBlock>
        </div>
      )
    case 'not-found':
      return (
        <div className={styles.page}>
          <CrumbBack />
          <StateBlock variant="empty">no collection by that name</StateBlock>
        </div>
      )
    case 'ok':
      return undefined
  }
}

/**
 * Read-only wrong-chain prompt for a chain-scoped route — reads already pass the route chainId
 * explicitly, so the page stays correct regardless; this only offers a one-click switch (reusing
 * WrongNetworkBanner's `useSwitchChain` logic, scoped to the route's chain rather than the module
 * default). Renders nothing when disconnected or already on the route's chain.
 */
export function RouteWrongChainBanner({ chainId }: { chainId: SupportedChainId }) {
  const { isConnected, chainId: connectedChainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()

  if (!isConnected || connectedChainId === undefined || connectedChainId === chainId) return null

  const switchReason = txErrorReason(error)

  return (
    <div className={styles.wrongChain} role="alert" data-testid="route-wrong-chain">
      <span>
        Your wallet is on chain {connectedChainId}. This collection lives on chain {chainId} —
        switch to view live balances and act.
      </span>
      <button
        type="button"
        onClick={() => switchChain({ chainId })}
        disabled={isPending}
        data-testid="route-wrong-chain-switch"
      >
        {isPending ? 'switching…' : `switch to chain ${chainId}`}
      </button>
      {switchReason !== undefined && <p>couldn&apos;t switch automatically ({switchReason}).</p>}
    </div>
  )
}

export function CollectionPage() {
  const params = useParams<{ chainId?: string; slug?: string }>()
  const resolution = useResolvedCollectionRoute(params.chainId, params.slug)
  const state = renderCollectionRouteState(resolution)
  if (state !== undefined) return state
  if (resolution.status !== 'ok') return null // unreachable — narrows the type below

  return (
    <CollectionChainProvider chainId={resolution.chainId} slug={resolution.slug}>
      <RouteWrongChainBanner chainId={resolution.chainId} />
      <CollectionBody instance={resolution.instance} />
    </CollectionChainProvider>
  )
}

function CollectionBody({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data: card, isPending, isError } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)
  const { address: connected } = useAccount()

  const isNotFound = !isPending && !isError && (!card || card.instance === ZERO_ADDRESS)

  // Mint-state readout for the mobile MintBar (the hero owns the desktop readout).
  const minted = card?.totalSupply ?? 0n
  const cap = card?.maxSupply ?? 0n

  // Per-type surfaces, split across the page's three regions: Primary (in the shell), Gallery
  // (pieces grid below the shell, N10), Admin (below the featured queue, N5).
  const surfaces = card ? resolveCollectionSurfaces(card.contractType) : undefined

  return (
    <div className={styles.page} data-testid="collection-detail">
      <CrumbBack />

      {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}
      {isError && (
        <StateBlock variant="error">couldn't load collection — is the fork up?</StateBlock>
      )}

      {isNotFound && <StateBlock variant="empty">collection not found</StateBlock>}

      {!isPending && !isError && card && card.instance !== ZERO_ADDRESS && (
        <>
          {/* Creator-supplied page CSS (ERC1155 + ERC404 carry styleUri). Renders nothing; injects
              scoped CSS + the `has-project-style` body flag while this page is mounted. */}
          {(card.contractType === 'ERC1155' || card.contractType === 'ERC404') && (
            <ProjectStyle instance={instance} />
          )}

          {/* The gallery hang: a specimen rail (the disclosure) beside the works (the goods).
              Transparency-forward — the mechanic is read before you acquire. Extracted to
              CollectionHero so the launch-wizard style preview renders the SAME markup with mock
              data. The type-specific primary action (buy/sell for 404, bid for 721) is slotted in;
              the 1155 has none — minting is per-edition down in the gallery. */}
          <CollectionHero
            instance={instance}
            card={card}
            metadata={metadata}
            primary={
              surfaces?.Primary ? (
                <surfaces.Primary instance={instance} creator={card.creator} />
              ) : undefined
            }
          />

          {/* ERC404 curve + candles, full-width below the shell (they made the trading column tower
              over the specimen rail). Above the gallery. */}
          {surfaces?.Charts && (
            <div className={styles.chartSlot}>
              <surfaces.Charts instance={instance} creator={card.creator} />
            </div>
          )}

          {/* Holder portfolio: your own pieces + reroll (multiselect keep), above the full gallery.
              Renders with no wrapper — it self-hides (returns null) when disconnected / you hold none,
              so there's no empty spacer; the card owns its own top margin. */}
          {surfaces?.Portfolio && <surfaces.Portfolio instance={instance} creator={card.creator} />}

          {/* N10: the pieces as a uniform grid, full-width below the shell (global treatment). */}
          {surfaces?.Gallery && (
            <div className={styles.gallerySlot}>
              <surfaces.Gallery instance={instance} creator={card.creator} />
            </div>
          )}

          {/* Secondary, demoted below the hang and collapsed by default (self-rendered as
              <Disclosure> inside each panel, so a null vault doesn't leave an empty box). */}
          {instance && <VaultPanel vault={card.vault} benefactor={instance} />}
          {/* W-H: user-facing featured-queue economics (rent / boost / renew / prune). */}
          <FeaturedPanel instance={instance} />

          {/* N5: creator admin, below the featured queue and outside the shell. Self-hides unless
              the connected wallet owns the instance. */}
          {surfaces?.Admin && <surfaces.Admin instance={instance} creator={card.creator} />}

          {/* N11: the "write something" composer lives INSIDE the activity section (as its footer),
              so an empty "no activity yet" reads directly above it. B6: posts to THIS collection's
              channel (channel = instance address); attributed on-chain, gated on a connected wallet. */}
          <MessageFeed
            filter={{ instance }}
            footer={
              connected !== undefined ? (
                <section className={styles.composeSection}>
                  <MessageComposer channel={instance} />
                  <p className={styles.composeNote}>
                    signed by {truncateAddress(connected)} · posts to this collection's activity
                  </p>
                </section>
              ) : (
                <StateBlock variant="empty" boxed>
                  connect your wallet to post to this collection's activity.
                </StateBlock>
              )
            }
          />

          {/* Mobile: the mint moment stays in thumb reach (the rail's job on desktop). */}
          {/* ERC721 collections are auctions — the action is a bid, not a mint (the same #mint
              section wraps the auction surface, so the anchor is still correct). */}
          <MintBar
            price={`${formatGwei(card.currentPrice)} gwei`}
            sub={cap > 0n ? `${(cap - minted).toString()} left` : card.isActive ? 'open' : 'ended'}
            action={<a href="#mint">{card.contractType === 'ERC721' ? 'Bid' : 'Mint'}</a>}
          />
        </>
      )}
    </div>
  )
}

/**
 * Legacy address-keyed route (`/collection/:instance[/edition|/token]`) — permanently redirects to
 * the slug URL (chain-scoped-slug-routes noesis-079 step 8). Chain-blind by design: legacy links
 * predate multi-chain, so they resolve against the default fork chain via `useCollection`'s
 * fallback scope. While the card is pending, shows a light loading state; on an unresolvable
 * instance, falls through to the existing invalid/not-found copy.
 */
export function LegacyCollectionRedirect() {
  const params = useParams<{ instance?: string }>()
  const instance = toAddress(params.instance)
  const { data: card, isPending, isError } = useCollection(instance)

  if (!instance) {
    return (
      <div className={styles.page}>
        <CrumbBack />
        <StateBlock variant="empty">invalid collection address</StateBlock>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className={styles.page}>
        <CrumbBack />
        <StateBlock variant="loading">hanging the work…</StateBlock>
      </div>
    )
  }

  if (isError || !card || card.instance === ZERO_ADDRESS) {
    return (
      <div className={styles.page}>
        <CrumbBack />
        <StateBlock variant="empty">collection not found</StateBlock>
      </div>
    )
  }

  return <Redirect to={collectionRoutePath(forkChainId, card.name.toLowerCase())} replace />
}
