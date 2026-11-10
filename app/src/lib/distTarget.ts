/**
 * Which distribution target this bundle is serving (see App.tsx's routing-mode comment: ms2.fun is
 * history-routed behind a server SPA fallback, the IPFS pin behind noesis.gwei.domains is
 * hash-routed because its gateway 404s on anything that isn't the fragment).
 *
 * `wouter`'s `Link` already rewrites its own hrefs for the hash target, so most call sites need no
 * change. A raw `<a>` — used where a click must open a new tab rather than navigate the SPA, which
 * `Link` does not support — bypasses that rewrite and needs {@link appHref} instead.
 */
export function isIpfsTarget(): boolean {
  return import.meta.env.VITE_DIST_TARGET === 'ipfs'
}

/**
 * A root-anchored in-app path (`/learn`, `/learn/erc404`), rewritten to a hash fragment on the IPFS
 * target so a raw `<a>` resolves inside the pinned document instead of walking out to the gateway's
 * own 404.
 */
export function appHref(path: string): string {
  return isIpfsTarget() ? `#${path}` : path
}
