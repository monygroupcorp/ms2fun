/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        navigateFallback: 'index.html', // SPA: unknown routes serve the cached shell (wouter routes client-side)
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false }, // SW only in production build; dev server is untouched
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
})
