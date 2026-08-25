import { Suspense, lazy, useState } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Link, Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { WagmiProvider } from 'wagmi'
import { WalletButton } from './components/WalletButton'
import { WrongNetworkBanner } from './components/ui/WrongNetworkBanner'
import { GatewayThrottleNotice } from './components/ui/GatewayThrottleNotice'
import { BoardCartProvider } from './components/board/BoardCartProvider'
import { BoardCartBar } from './components/board/BoardCartBar'
import { config } from './lib/wagmi'
import { queryClient } from './lib/queryClient'
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryPersister } from './lib/queryPersister'
// HomePage stays eager — it's the landing route, so we don't want a chunk round-trip before first
// paint. Every other page is a lazy chunk (route code-splitting, ADR-0010) fetched on navigation,
// so the initial bundle is just the shell + web3 core, not all 13 pages.
import { HomePage } from './routes/HomePage'
const Exec404Page = lazy(() =>
  import('./routes/Exec404Page').then((m) => ({ default: m.Exec404Page })),
)
const CollectionsPage = lazy(() =>
  import('./routes/CollectionsPage').then((m) => ({ default: m.CollectionsPage })),
)
const ProfilePage = lazy(() =>
  import('./routes/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const CollectionPage = lazy(() =>
  import('./routes/CollectionPage').then((m) => ({ default: m.CollectionPage })),
)
const LegacyCollectionRedirect = lazy(() =>
  import('./routes/CollectionPage').then((m) => ({ default: m.LegacyCollectionRedirect })),
)
const EditionDetailPage = lazy(() =>
  import('./routes/EditionDetailPage').then((m) => ({ default: m.EditionDetailPage })),
)
const LegacyEditionRedirect = lazy(() =>
  import('./routes/EditionDetailPage').then((m) => ({ default: m.LegacyEditionRedirect })),
)
const TokenDetailPage = lazy(() =>
  import('./routes/TokenDetailPage').then((m) => ({ default: m.TokenDetailPage })),
)
const LegacyTokenRedirect = lazy(() =>
  import('./routes/TokenDetailPage').then((m) => ({ default: m.LegacyTokenRedirect })),
)
const WizardPage = lazy(() =>
  import('./routes/WizardPage').then((m) => ({ default: m.WizardPage })),
)
const BoardPage = lazy(() => import('./routes/BoardPage').then((m) => ({ default: m.BoardPage })))
const VaultsPage = lazy(() =>
  import('./routes/VaultsPage').then((m) => ({ default: m.VaultsPage })),
)
const VaultPage = lazy(() => import('./routes/VaultPage').then((m) => ({ default: m.VaultPage })))
const RequestTargetPage = lazy(() =>
  import('./routes/RequestTargetPage').then((m) => ({ default: m.RequestTargetPage })),
)
const AdminPage = lazy(() => import('./routes/AdminPage').then((m) => ({ default: m.AdminPage })))
const LearnPage = lazy(() => import('./routes/LearnPage').then((m) => ({ default: m.LearnPage })))
import { useOwnerGate } from './components/ui/useOwnerGate'
import { forkAddresses } from './lib/addresses'
import styles from './App.module.css'

/** The commit the bundle was built from, inlined by vite `define` (see vite.config.ts). Both
 * distribution targets carry it. */
declare const __BUILD_COMMIT__: string

/** Which distribution target this bundle is serving.
 *
 * `'ipfs'` is the pinned distribution reached through noesis.gwei.domains, served from under a
 * gateway path prefix. Read at render time rather than inlined as a build constant so the routing
 * matrix in `ipfs-routing.test.tsx` can drive both modes; in a production build vite has already
 * folded `import.meta.env.VITE_DIST_TARGET` to a literal, so the dead branch is dropped. */
function isIpfsTarget(): boolean {
  return import.meta.env.VITE_DIST_TARGET === 'ipfs'
}

// Build identity in the console, on every target, once per load. The pinned distribution is
// repointed on its own cadence and can lag ms2.fun, so a bug report has to be able to name the
// build it was found on.
console.info(
  `noesis build ${__BUILD_COMMIT__} · target ${isIpfsTarget() ? 'ipfs' : 'web'} · ${
    typeof document === 'undefined' ? '' : document.baseURI
  }`,
)

/** The visible half of the build identity — a quiet footer line, present on both targets, so the
 * version is readable from the page itself and not only from a console a reporter may never open.
 * Styled inline: this is a fixed one-line surface, not a design-system element. */
function BuildStamp() {
  return (
    <footer
      data-testid="build-stamp"
      data-build={__BUILD_COMMIT__}
      data-target={isIpfsTarget() ? 'ipfs' : 'web'}
      style={{
        padding: '2rem 1rem',
        textAlign: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        letterSpacing: '0.08em',
        opacity: 0.4,
      }}
    >
      build {__BUILD_COMMIT__}
      {isIpfsTarget() ? ' · ipfs' : ''}
    </footer>
  )
}

/** The NOESIS brand lockup — the picture-frame symbol (the platform frames the work) + the lowercase
 * `noesis` wordmark. Monochrome `currentColor` so it adapts to the bar's text colour. */
function NoesisLogo() {
  return (
    <span className={styles.logoLockup}>
      <svg className={styles.logoMark} viewBox="0 0 48 48" aria-hidden="true">
        <path fillRule="evenodd" fill="currentColor" d="M5,5 H43 V43 H5 Z M15,15 H33 V33 H15 Z" />
      </svg>
      <span className={styles.logoWord}>noesis</span>
    </span>
  )
}

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

/** The app shell and route table. Router-agnostic by construction — every navigation goes through
 * wouter's `Link`/`useLocation`, which read the location hook from the `Router` above, so the same
 * tree serves both routing modes with no per-route branching. */
function AppShell() {
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
                <NoesisLogo />
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
            {/* Renders only while every gateway is in cooldown. Non-blocking by construction: it
                sits above the routes and never unmounts them, so cached art stays on screen. */}
            <GatewayThrottleNotice />
            {menuOpen && (
              <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="menu">
                <div className={styles.overlayBar}>
                  <Link href="/" className={styles.logo} onClick={closeMenu}>
                    <NoesisLogo />
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
                  <Route path="/learn/:slug" component={LearnPage} />
                  <Route path="/learn" component={LearnPage} />
                  {/* Portfolio merged into the profile plate (Held/Vaults tabs) — /portfolio shows
                  the connected wallet's own plate. */}
                  <Route path="/portfolio" component={ProfilePage} />
                  <Route path="/admin" component={AdminPage} />
                  {/* Legacy address-keyed routes — kept PERMANENTLY as 301 redirects to the
                      slug URL below (every address link in the wild stays alive). Listed BEFORE
                      the chain-scoped routes: this wouter version's matcher (regexparam@3) does
                      NOT support the `:param(regex)` inline-constraint syntax the spec assumed —
                      `:chainId(\d+)` parses the WHOLE `chainId(\d+)` string as one literal param
                      key, silently breaking `params.chainId` (discovered in test — see
                      noesis-079). `/:chainId/:slug` below is a plain, unconstrained 2-segment
                      match, so every OTHER 2-/4-segment literal-prefixed route (this block,
                      /vault/:address, /learn/:slug, /profile/:address) must come first in the
                      `Switch` to avoid being shadowed; `useResolvedCollectionRoute` validates
                      `chainId` is actually numeric at runtime as the real guard. */}
                  <Route
                    path="/collection/:instance/edition/:id"
                    component={LegacyEditionRedirect}
                  />
                  <Route path="/collection/:instance/token/:id" component={LegacyTokenRedirect} />
                  <Route path="/collection/:instance" component={LegacyCollectionRedirect} />
                  <Route path="/profile" component={ProfilePage} />
                  <Route path="/profile/:address" component={ProfilePage} />
                  {/* Chain-scoped collection routes (chain-scoped-slug-routes noesis-079) — MUST
                      stay below every other literal-prefixed route above (see comment above). */}
                  <Route path="/:chainId/:slug/edition/:id" component={EditionDetailPage} />
                  <Route path="/:chainId/:slug/token/:id" component={TokenDetailPage} />
                  <Route path="/:chainId/:slug" component={CollectionPage} />
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
                            There&rsquo;s nothing hung at this address. The piece may have been
                            moved, or the link mistyped. Nothing here left the building — it was
                            never on this wall.
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
            <BuildStamp />
          </div>
        </BoardCartProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  )
}

/** Routing mode selection — the one place the two distribution targets diverge at runtime.
 *
 * ms2.fun is a server-backed static host with an SPA fallback (`public/_redirects`, and the
 * `404.html` mirror the build emits), so history routing gives clean shareable paths.
 *
 * The IPFS distribution has no such fallback: a public gateway serves the files that exist under
 * the CID and answers anything else with its own 404, and the gwei.domains subdomain gateway
 * reverse-proxies that behaviour unchanged. Hash routing keeps the whole route in the fragment,
 * which no gateway ever sees — every deep link resolves to the one document that is actually
 * pinned. `useHashLocation.hrefs` also rewrites every `Link` href to `#/...`, so no call site
 * changes. */
export function App() {
  return isIpfsTarget() ? (
    <Router hook={useHashLocation}>
      <AppShell />
    </Router>
  ) : (
    <Router>
      <AppShell />
    </Router>
  )
}
