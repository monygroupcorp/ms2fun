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
              <Link href="/collections" className={styles.navLink}>
                FEATURED
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
              <Route path="/collections" component={CollectionsPage} />
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
