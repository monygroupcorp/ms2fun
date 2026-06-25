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
import { PortfolioPage } from './routes/PortfolioPage'
import { AdminPage } from './routes/AdminPage'
import { useOwnerGate } from './components/ui/useOwnerGate'
import { forkAddresses } from './lib/addresses'
import styles from './App.module.css'

/** The site's primary navigation links. Rendered twice — once inline in the desktop top bar, once
 * stacked in the mobile overlay — so the link set lives in exactly one place. `linkClassName` styles
 * each link for its context; `onNavigate` (overlay only) closes the menu after a tap. */
function NavLinks({
  linkClassName,
  onNavigate,
}: {
  linkClassName: string | undefined
  onNavigate?: (() => void) | undefined
}) {
  return (
    <>
      <Link href="/launch" className={linkClassName} onClick={onNavigate}>
        LAUNCH
      </Link>
      <Link href="/collections" className={linkClassName} onClick={onNavigate}>
        COLLECTIONS
      </Link>
      <Link href="/board" className={linkClassName} onClick={onNavigate}>
        BOARD
      </Link>
      <Link href="/portfolio" className={linkClassName} onClick={onNavigate}>
        PORTFOLIO
      </Link>
      <AdminNavLink linkClassName={linkClassName} onNavigate={onNavigate} />
      <Link href="/exec404" className={linkClassName} onClick={onNavigate}>
        CULT EXECUTIVES
      </Link>
      <Link href="/profile" className={linkClassName} onClick={onNavigate}>
        PROFILE
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
        <div className={styles.app}>
          <header className={styles.topBar}>
            <Link href="/" className={styles.logo} onClick={closeMenu}>
              ms2<span className={styles.logoTld}>.fun</span>
            </Link>
            <nav className={styles.nav}>
              <NavLinks linkClassName={styles.navLink} />
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
              <Route path="/portfolio" component={PortfolioPage} />
              <Route path="/admin" component={AdminPage} />
              <Route path="/collection/:instance/edition/:id" component={EditionDetailPage} />
              <Route path="/collection/:instance/token/:id" component={TokenDetailPage} />
              <Route path="/collection/:instance" component={CollectionPage} />
              <Route path="/profile" component={ProfilePage} />
              <Route path="/profile/:address" component={ProfilePage} />
              <Route>
                <section className={styles.notFound}>404 · NOT FOUND</section>
              </Route>
            </Switch>
          </main>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
