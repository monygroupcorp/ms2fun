import { Suspense, lazy, useState } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Link, Route, Switch } from 'wouter'
import { WagmiProvider } from 'wagmi'
import { WalletButton } from './components/WalletButton'
import { WrongNetworkBanner } from './components/ui/WrongNetworkBanner'
import { BoardCartProvider } from './components/board/BoardCartProvider'
import { BoardCartBar } from './components/board/BoardCartBar'
import { config } from './lib/wagmi'
import { queryClient } from './lib/queryClient'
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryPersister } from './lib/queryPersister'
// HomePage stays eager — it's the landing route, so we don't want a chunk round-trip before first
// paint. Every other page is a lazy chunk (route code-splitting, ADR-0010) fetched on navigation,
// so the initial bundle is just the shell + web3 core, not all 13 pages.
import { HomePage } from './routes/HomePage'
const Exec404Page = lazy(() => import('./routes/Exec404Page').then((m) => ({ default: m.Exec404Page })))
const CollectionsPage = lazy(() =>
  import('./routes/CollectionsPage').then((m) => ({ default: m.CollectionsPage })),
)
const ProfilePage = lazy(() => import('./routes/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const CollectionPage = lazy(() =>
  import('./routes/CollectionPage').then((m) => ({ default: m.CollectionPage })),
)
const EditionDetailPage = lazy(() =>
  import('./routes/EditionDetailPage').then((m) => ({ default: m.EditionDetailPage })),
)
const TokenDetailPage = lazy(() =>
  import('./routes/TokenDetailPage').then((m) => ({ default: m.TokenDetailPage })),
)
const WizardPage = lazy(() => import('./routes/WizardPage').then((m) => ({ default: m.WizardPage })))
const BoardPage = lazy(() => import('./routes/BoardPage').then((m) => ({ default: m.BoardPage })))
const VaultsPage = lazy(() => import('./routes/VaultsPage').then((m) => ({ default: m.VaultsPage })))
const VaultPage = lazy(() => import('./routes/VaultPage').then((m) => ({ default: m.VaultPage })))
const RequestTargetPage = lazy(() =>
  import('./routes/RequestTargetPage').then((m) => ({ default: m.RequestTargetPage })),
)
const AdminPage = lazy(() => import('./routes/AdminPage').then((m) => ({ default: m.AdminPage })))
import { useOwnerGate } from './components/ui/useOwnerGate'
import { forkAddresses } from './lib/addresses'
import styles from './App.module.css'

/** The site's primary navigation. NOESIS nav (ADR-019 base COLLECTIONS · BOARD · LAUNCH · CONNECT),
 * plus VAULTS (S3) so the alignment vaults / TVL surface is discoverable — a TVL page nobody can
 * reach defeats the point. LAUNCH stays the single black filled CTA — the platform's job is to get
 * creators to launch. The wallet button (CONNECT) is rendered alongside in the header. PROFILE / PORTFOLIO are
 * reached via the connected wallet (the merged profile plate); the EXEC404 fossil is linked from
 * Home; ADMIN stays owner-only. Rendered twice — desktop top bar + mobile overlay — so the link set
 * lives in one place. `linkClassName` styles each link for its context; `ctaClassName` (desktop)
 * gives LAUNCH the filled treatment; `onNavigate` (overlay only) closes the menu after a tap. */
function NavLinks({
  linkClassName,
  ctaClassName,
  onNavigate,
}: {
  linkClassName: string | undefined
  ctaClassName?: string | undefined
  onNavigate?: (() => void) | undefined
}) {
  return (
    <>
      <Link href="/collections" className={linkClassName} onClick={onNavigate}>
        COLLECTIONS
      </Link>
      <Link href="/board" className={linkClassName} onClick={onNavigate}>
        BOARD
      </Link>
      <Link href="/vaults" className={linkClassName} onClick={onNavigate}>
        VAULTS
      </Link>
      {/* REQUEST TARGET intentionally NOT in the top nav (ADR-019 canonical set is
          COLLECTIONS · BOARD · LAUNCH · CONNECT). The /request-target route stays; it's linked
          from the launch flow instead. */}
      <AdminNavLink linkClassName={linkClassName} onNavigate={onNavigate} />
      <Link
        href="/launch"
        className={[linkClassName, ctaClassName].filter(Boolean).join(' ')}
        onClick={onNavigate}
      >
        LAUNCH
      </Link>
    </>
  )
}

/** ADMIN nav link — shown only to the platform operator (MasterRegistry owner). Lives inside the
 * WagmiProvider so it can read on-chain ownership. */
function AdminNavLink({
  linkClassName,
  onNavigate,
}: {
  linkClassName: string | undefined
  onNavigate?: (() => void) | undefined
}) {
  const { isOwner } = useOwnerGate(forkAddresses.MasterRegistryV1)
  if (!isOwner) return null
  return (
    <Link href="/admin" className={linkClassName} onClick={onNavigate}>
      ADMIN
    </Link>
  )
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <WagmiProvider config={config}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          // Only persist settled, successful reads — never errors or in-flight queries.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => query.state.status === 'success',
          },
        }}
      >
        <BoardCartProvider>
          <div className={styles.app} data-brand="noesis">
            <header className={styles.topBar}>
              <Link href="/" className={styles.logo} onClick={closeMenu}>
                ms2<span className={styles.logoTld}>.fun</span>
              </Link>
              <nav className={styles.nav}>
                <NavLinks linkClassName={styles.navLink} ctaClassName={styles.navCta} />
                <WalletButton />
              </nav>
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => setMenuOpen(true)}
                aria-label="open menu"
              >
                MENU <span aria-hidden>☰</span>
              </button>
            </header>
            <WrongNetworkBanner />
            {menuOpen && (
              <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="menu">
                <div className={styles.overlayBar}>
                  <Link href="/" className={styles.logo} onClick={closeMenu}>
                    ms2<span className={styles.logoTld}>.fun</span>
                  </Link>
                  <button
                    type="button"
                    className={styles.menuButton}
                    onClick={closeMenu}
                    aria-label="close menu"
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </div>
                <nav className={styles.overlayNav}>
                  <NavLinks linkClassName={styles.overlayLink} onNavigate={closeMenu} />
                  <div className={styles.overlayWallet}>
                    <WalletButton />
                  </div>
                </nav>
              </div>
            )}
            <main className={styles.main}>
              {/* Suspense boundary for the lazy route chunks — shows a light placeholder while a
                  page chunk loads on navigation. */}
              <Suspense fallback={<div className={styles.routeLoading}>loading…</div>}>
                <Switch>
                <Route path="/" component={HomePage} />
                <Route path="/exec404" component={Exec404Page} />
                <Route path="/launch" component={WizardPage} />
                <Route path="/collections" component={CollectionsPage} />
                <Route path="/board" component={BoardPage} />
                <Route path="/vaults" component={VaultsPage} />
                <Route path="/vault/:address" component={VaultPage} />
                <Route path="/request-target" component={RequestTargetPage} />
                {/* Portfolio merged into the profile plate (Held/Vaults tabs) — /portfolio shows
                  the connected wallet's own plate. */}
                <Route path="/portfolio" component={ProfilePage} />
                <Route path="/admin" component={AdminPage} />
                <Route path="/collection/:instance/edition/:id" component={EditionDetailPage} />
                <Route path="/collection/:instance/token/:id" component={TokenDetailPage} />
                <Route path="/collection/:instance" component={CollectionPage} />
                <Route path="/profile" component={ProfilePage} />
                <Route path="/profile/:address" component={ProfilePage} />
                <Route>
                  <section className={styles.notFound}>
                    <div className="noesis-404">
                      <div className="plate">
                        <span className="k">Wall label</span>
                        <span className="e">404 · not found</span>
                      </div>
                      <div className="inner">
                        <div className="big">404</div>
                        <div className="ttl">Not on view</div>
                        <p className="cap">
                          There&rsquo;s nothing hung at this address. The piece may have been moved,
                          or the link mistyped. Nothing here left the building — it was never on
                          this wall.
                        </p>
                        <div className={styles.recoverActions}>
                          <Link href="/collections" className={styles.recoverPrimary}>
                            ← Back to collections
                          </Link>
                          <Link href="/board" className={styles.recoverSecondary}>
                            Open the board
                          </Link>
                        </div>
                      </div>
                    </div>
                  </section>
                </Route>
                </Switch>
              </Suspense>
            </main>
            <BoardCartBar />
          </div>
        </BoardCartProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  )
}
