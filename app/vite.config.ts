/// <reference types="vitest/config" />
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
  plugins: [
    react(),
    spaFallback404(),
    // Service worker for the app shell (ADR-0010). A static/IPFS client reloads a lot; Workbox
    // precaches the built JS/CSS/HTML so repeat loads paint instantly (and work offline) instead of
    // re-fetching the bundle from a gateway. Content-addressed hosting makes this safe: a new deploy
    // is a new CID/URL, so there's no stale-cache-across-deploys problem; `autoUpdate` swaps in a new
    // SW the moment one is served. `manifest: false` — this is app-shell caching, not an installable
    // PWA (no icon set yet); add a manifest + 192/512 icons later if we want install.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
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
        globPatterns: ['**/*.{js,css,html,woff2,wasm,svg,png}'],
        // The flagship card art is ~2 MB and is only ever drawn as a grid tile and a 180px banner.
        // Precaching fetches it at SW-install time on EVERY first visit — including deep links to
        // routes that never render it — which overrides the `loading="lazy"` on the element itself.
        // Let it be an ordinary lazy image request instead. Excluded from the PRECACHE, not the build.
        globIgnores: ['**/exec-executives.png'],
        navigateFallback: 'index.html', // SPA: unknown routes serve the cached shell (wouter routes client-side)
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false }, // SW only in production build; dev server is untouched
    }),
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
