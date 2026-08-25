/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { precacheGlobs } from './precache.globs'

// --- Distribution target -----------------------------------------------------------------------
// One source tree, two build targets, selected by `VITE_DIST_TARGET` (see `pnpm build:ipfs`):
//
//   default   → ms2.fun. Server-backed static host, root-anchored (`base: '/'`), history routing,
//               service worker on. Unchanged by this file's IPFS branch.
//   'ipfs'    → the pinned distribution reached through noesis.gwei.domains. Served from under a
//               gateway path prefix (`/ipfs/<cid>/...`), so:
//                 * `base: './'`   — every emitted asset URL is relative to the document.
//                 * hash routing   — see `src/App.tsx`; a public gateway has no SPA fallback, so a
//                                    history-mode deep link is a 404 from the gateway itself.
//                 * no service worker — a Workbox precache installed under one CID's scope
//                   outlives a contenthash repoint, which is a stale-pin trap on a distribution
//                   whose whole update mechanism is "publish a new CID". The ms2.fun target keeps
//                   the SW, where a deploy replaces the bytes at a stable URL.
//               Output goes to `dist/ipfs/` (inside the already-ignored `dist/`, so build output
//               never reaches git, prettier or eslint), packaged by `scripts/ipfs-dist/pack.ts`.
const isIpfsTarget = process.env.VITE_DIST_TARGET === 'ipfs'

// Build identity. The pinned distribution is repointed on its own cadence, so it can lag ms2.fun;
// stamping the commit into BOTH builds makes that skew observable from a bug report instead of
// guessed at. Read once at config time and inlined via `define`, which keeps the value constant
// for a given commit — the CAR/CID packaging depends on the build being reproducible.
function buildCommit(): string {
  if (process.env.VITE_BUILD_COMMIT) return process.env.VITE_BUILD_COMMIT
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // A tarball export or a CI checkout without git history still has to build.
    return 'unknown'
  }
}

// GitHub Pages / static-host SPA fallback: mirrors the built index.html to 404.html so a host that
// answers unknown paths with its own 404 page serves the app shell (and its og:/twitter: tags)
// instead. Build-only — a dev server has no 404.html convention to satisfy. Copies the *emitted*
// file (hashed asset URLs already rewritten), not the source, and resolves the output directory
// from the resolved config rather than hardcoding `dist`.
function spaFallback404(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
    },
    closeBundle() {
      const resolvedOutDir = resolve(root, outDir)
      copyFileSync(resolve(resolvedOutDir, 'index.html'), resolve(resolvedOutDir, '404.html'))
    },
  }
}

export default defineConfig({
  // `/` reproduces the pre-existing default for ms2.fun; `./` makes every emitted URL relative to
  // the document so the build survives a gateway's `/ipfs/<cid>/` path prefix.
  base: isIpfsTarget ? './' : '/',
  // `__BUILD_COMMIT__` is a define (a constant of the build, not of the environment). The routing
  // mode is deliberately NOT a define: it is read from `import.meta.env.VITE_DIST_TARGET` at render
  // time so the routing-mode matrix in `src/ipfs-routing.test.tsx` can exercise both modes in one
  // suite instead of asserting against whichever one the test run happened to be compiled for.
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  ...(isIpfsTarget ? { build: { outDir: 'dist/ipfs', emptyOutDir: true } } : {}),
  plugins: [
    react(),
    spaFallback404(),
    // Service worker for the app shell (ADR-0010). A static/IPFS client reloads a lot; Workbox
    // precaches the built JS/CSS/HTML so repeat loads paint instantly (and work offline) instead of
    // re-fetching the bundle from a gateway. Content-addressed hosting makes this safe: a new deploy
    // is a new CID/URL, so there's no stale-cache-across-deploys problem; `autoUpdate` swaps in a new
    // SW the moment one is served. `manifest: false` — this is app-shell caching, not an installable
    // PWA (no icon set yet); add a manifest + 192/512 icons later if we want install.
    //
    // OFF in the IPFS target (see the target notes at the top of this file): a precache installed
    // under one CID's scope survives a contenthash repoint, so the pinned site would keep serving
    // the release it first cached.
    ...(isIpfsTarget
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            injectRegister: 'auto',
            includeAssets: [
              'favicon.svg',
              'favicon-16.png',
              'favicon-32.png',
              'apple-touch-icon.png',
            ],
            manifest: {
              name: 'noesis',
              short_name: 'noesis',
              description:
                'noesis — onchain alignment launchpad. Curated art/token releases bound to the communities that inspired them.',
              theme_color: '#0a0a0a',
              background_color: '#0a0a0a',
              display: 'standalone',
              start_url: '/',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: 'icon-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              ...precacheGlobs,
              navigateFallback: 'index.html', // SPA: unknown routes serve the cached shell (wouter routes client-side)
              cleanupOutdatedCaches: true,
            },
            devOptions: { enabled: false }, // SW only in production build; dev server is untouched
          }),
        ]),
  ],
  // Dev over Tailscale (walking the app from another machine): allow any host and let the HMR
  // client dial the same host:port it loaded from, so the live-reload WebSocket upgrades cleanly
  // instead of logging "Connection header did not include 'upgrade'". Dev-only.
  server: {
    host: true,
    allowedHosts: true,
    hmr: { clientPort: 5173 },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}'],
    css: true,
  },
})
