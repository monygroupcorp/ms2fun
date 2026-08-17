// Precache glob configuration. Its own module, not an inline literal in `vite.config.ts`, so that
// `scripts/check-precache.ts` can assert the *emitted* manifest against the same values that
// configured the build instead of against a second copy of them. Adding an entry to `globIgnores`
// here is the whole edit — the guard picks it up with no other change, and then enforces it.
export const precacheGlobs = {
  globPatterns: ['**/*.{js,css,html,woff2,wasm,svg,png}'],

  // The flagship card art is ~2 MB and is only ever drawn as a grid tile and a 180px banner.
  // Precaching fetches it at SW-install time on EVERY first visit — including deep links to
  // routes that never render it — which overrides the `loading="lazy"` on the element itself.
  // Let it be an ordinary lazy image request instead. Excluded from the PRECACHE, not the build.
  globIgnores: ['**/exec-executives.png'],
}
