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
import styles from './App.module.css'

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className={styles.app}>
          <header className={styles.topBar}>
            <Link href="/" className={styles.logo}>
              ms2<span className={styles.logoTld}>.fun</span>
            </Link>
            <nav className={styles.nav}>
              <Link href="/launch" className={styles.navLink}>
                LAUNCH
              </Link>
              <Link href="/collections" className={styles.navLink}>
                COLLECTIONS
              </Link>
              <Link href="/board" className={styles.navLink}>
                BOARD
              </Link>
              <Link href="/portfolio" className={styles.navLink}>
                PORTFOLIO
              </Link>
              <Link href="/exec404" className={styles.navLink}>
                CULT EXECUTIVES
              </Link>
              <Link href="/profile" className={styles.navLink}>
                PROFILE
              </Link>
              <WalletButton />
            </nav>
          </header>
          <main className={styles.main}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/exec404" component={Exec404Page} />
              <Route path="/launch" component={WizardPage} />
              <Route path="/collections" component={CollectionsPage} />
              <Route path="/board" component={BoardPage} />
              <Route path="/portfolio" component={PortfolioPage} />
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
