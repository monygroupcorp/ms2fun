/**
 * The share card's origin, as a build input rather than a string in the markup.
 *
 * A share card is fetched by a scraper with no page context, so `og:url`, `og:image` and
 * `twitter:image` have to name an absolute origin — and until now that origin was typed into
 * `index.html` three times. It was typed wrong: the markup pointed at `noesis.gwei.domains`, an
 * ENS-gateway front that answers 404 and is not ours, so every shared link rendered a title beside
 * a picture nobody could fetch. A typed origin also has no way to differ between a deploy that
 * serves the brand domain and one that serves a preview or a pin.
 *
 * So the markup carries a placeholder, this resolves it from deployment config, and the build
 * substitutes it at all three sites from one value — which is what makes the three-site split the
 * card guard checks for (`findOriginSplit` in `./card`) impossible to reach by editing markup.
 */

/** The token `index.html` carries in place of an origin, at every site that needs one. */
export const PUBLIC_ORIGIN_PLACEHOLDER = '%VITE_PUBLIC_ORIGIN%'

/** The deployment-config key that overrides the default. */
export const PUBLIC_ORIGIN_ENV_KEY = 'VITE_PUBLIC_ORIGIN'

/**
 * Where the default build target is served. `CNAME` at the repository root names this host, and
 * `vite.config.ts` builds root-anchored (`base: '/'`) for it, so a build given no origin cards the
 * host this repository already publishes to rather than one nobody chose.
 */
export const DEFAULT_PUBLIC_ORIGIN = 'https://ms2.fun'

/**
 * Resolve the configured origin, or fall back to the default.
 *
 * Throws rather than degrading: an origin that is unparseable, not http(s), or carries a path,
 * query or fragment would emit a card that points somewhere the deployer did not mean, and a
 * misdirected card is worse than a failed build because nothing goes red until someone shares a
 * link. The returned value is `URL.origin` — scheme, host and port with no trailing slash — so
 * `https://ms2.fun/` and `https://ms2.fun` cannot produce two different sets of tags.
 */
export function resolvePublicOrigin(configured: string | undefined): string {
  const raw = configured?.trim() ?? ''
  if (raw === '') return DEFAULT_PUBLIC_ORIGIN

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${PUBLIC_ORIGIN_ENV_KEY} is not a url: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${PUBLIC_ORIGIN_ENV_KEY} must be http(s): ${raw}`)
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `${PUBLIC_ORIGIN_ENV_KEY} must be a bare origin, with no path, query or fragment: ${raw}`,
    )
  }
  return url.origin
}

/**
 * Substitute the origin into emitted HTML.
 *
 * Throws when the placeholder is absent: that means someone typed an origin back into the markup,
 * which is the defect this module exists to remove, and a silent no-op here would ship it.
 */
export function injectPublicOrigin(html: string, origin: string): string {
  if (!html.includes(PUBLIC_ORIGIN_PLACEHOLDER)) {
    throw new Error(
      `index.html carries no ${PUBLIC_ORIGIN_PLACEHOLDER} — the share card's origin belongs in ` +
        `deployment config (${PUBLIC_ORIGIN_ENV_KEY}), not in the markup`,
    )
  }
  return html.split(PUBLIC_ORIGIN_PLACEHOLDER).join(origin)
}
