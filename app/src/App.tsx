import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Link, Route, Switch } from 'wouter'
import { WagmiProvider } from 'wagmi'
import { WalletButton } from './components/WalletButton'
import { config } from './lib/wagmi'
import { queryClient } from './lib/queryClient'
import { HomePage } from './routes/HomePage'
import { Exec404Page } from './routes/Exec404Page'
import { CollectionsPage } from './routes/CollectionsPage'
import { ProfilePage } from './routes/ProfilePage'
import { CollectionPage } from './routes/CollectionPage'
import { EditionDetailPage } from './routes/EditionDetailPage'
import { TokenDetailPage } from './routes/TokenDetailPage'
import { WizardPage } from './routes/WizardPage'
import { BoardPage } from './routes/BoardPage'
import { AdminPage } from './routes/AdminPage'
import { useOwnerGate } from './components/ui/useOwnerGate'
import { forkAddresses } from './lib/addresses'
import styles from './App.module.css'

/** The site's primary navigation. Canonical NOESIS nav (ADR-019): COLLECTIONS · BOARD · LAUNCH ·
 * CONNECT, with LAUNCH as the single black filled CTA — the platform's job is to get creators to
 * launch. The wallet button (CONNECT) is rendered alongside in the header. PROFILE / PORTFOLIO are
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
      <QueryClientProvider client={queryClient}>
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
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/exec404" component={Exec404Page} />
              <Route path="/launch" component={WizardPage} />
              <Route path="/collections" component={CollectionsPage} />
              <Route path="/board" component={BoardPage} />
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
                        There&rsquo;s nothing hung at this address. The piece may have been moved, or
                        the link mistyped. Nothing here left the building — it was never on this
                        wall.
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
          </main>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
