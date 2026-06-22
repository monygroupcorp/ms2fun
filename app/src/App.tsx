import { QueryClientProvider } from '@tanstack/react-query'
import { Route, Switch } from 'wouter'
import { WagmiProvider } from 'wagmi'
import { WalletButton } from './components/WalletButton'
import { config } from './lib/wagmi'
import { queryClient } from './lib/queryClient'
import { HomePage } from './routes/HomePage'
import styles from './App.module.css'

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className={styles.app}>
          <header className={styles.header}>
            <span className={styles.brand}>ms2fun</span>
            <WalletButton />
          </header>
          <main className={styles.main}>
            <Switch>
              <Route path="/" component={HomePage} />
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
