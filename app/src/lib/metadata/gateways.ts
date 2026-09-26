/**
 * The IPFS gateway roster, and how a CID becomes a URL on one.
 *
 * Split out of `uri.ts` and DEPENDENCY-FREE ON PURPOSE. `uri.ts` reaches `localStorage` through the
 * health and custom-gateway stores, which exist only in a browser; the art delivery service in
 * `services/art/` runs in a worker and needs exactly this much — which gateways there are, and how
 * to address one. Duplicating the roster into that service would give the two halves of the same
 * decision two places to drift apart, and drifting claims about this roster are what made the art
 * load slowly in the first place (see the ordering note below).
 *
 * Nothing here may import anything that touches a browser global.
 */

/** How a gateway addresses a CID. */
export type GatewayForm = 'path' | 'subdomain'

/** One public gateway endpoint. */
export interface IpfsGateway {
  /**
   * The organisation that runs the endpoint. This is the field that matters: entries sharing an
   * operator share a budget, a CDN config and an outage, so a roster that has re-converged on one
   * operator is a one-entry roster wearing several hostnames. Check this before adding a host.
   */
  operator: string
  /**
   * `path`      — base ending in `/ipfs/`; the CID is appended.
   * `subdomain` — bare host; the URL is built as `https://<cid>.ipfs.<host>/`.
   */
  form: GatewayForm
  base: string
}

/**
 * Public IPFS gateways, tried in sequence. No backend, account, API key or dashboard of ours —
 * public endpoints only, so the list stays walkawayable.
 *
 * Deliberately spans three independent operators, and kept short: under sequential rotation a long
 * roster is a long tail of failures to walk before giving up.
 *
 * ORDERED BY MEASURED LATENCY, and the measurement is a command rather than a memory:
 * `pnpm ipfs:latency` times every entry here against art we pin and exits non-zero when a later
 * entry is meaningfully faster than an earlier one. This comment used to read "ordered by observed
 * retrieval reliability" with nothing holding it to anything, and by 2026-09-24 it was false — the
 * first entry answered in 5.69 s and the second in 0.02 s, so every cold load paid a 369x penalty
 * before reaching the fast gateway. Re-run the harness when this list is edited.
 *
 * Each entry was checked against a live CID in a real browser (a real Chrome, not a spoofed
 * user-agent) before being listed; documentation alone is not evidence a gateway serves bytes.
 */
export const IPFS_GATEWAYS: readonly IpfsGateway[] = [
  // Filebase. Path form only — subdomain requests to this host do not resolve to content.
  // First because it is measurably first: 0.02 s median against 5.69 s, 2026-09-25.
  { operator: 'Filebase', form: 'path', base: 'https://ipfs.filebase.io/ipfs/' },
  // Pinata. Path form only — the public gateway has no wildcard subdomain host. This is the PUBLIC
  // endpoint, metered against the viewer's own address; it shares an operator with the account that
  // pins our art but none of that account's quota.
  { operator: 'Pinata', form: 'path', base: 'https://gateway.pinata.cloud/ipfs/' },
  // 4EVERLAND. Subdomain form: the path endpoint 301s here, and the subdomain host lower-cases the
  // label, so a CIDv0 sent here comes back as a client error. See `isSubdomainSafeCid` — CIDv0
  // pointers skip this entry rather than emitting a URL that 400s.
  //
  // MEASURED DEAD 2026-09-25 and kept only until its replacement is ruled on: it answers 410 Gone
  // for the canonical zero-byte file and accepts-then-never-answers for our art (3/3 runs past the
  // 12 s timeout, both forms). It is last, so a healthy load never reaches it, and `gatewayHealth`
  // demotes a silent gateway rather than spending the full timeout on it every load.
  { operator: '4EVERLAND', form: 'subdomain', base: '4everland.io' },
] as const

/**
 * True when a CID can be carried in a DNS label without changing meaning.
 *
 * Subdomain form gives every CID its own web origin, so anything active in the content can only
 * reach storage belonging to that CID rather than to everything else the gateway serves. It is the
 * form to prefer — but a DNS label is case-insensitive, so only a case-insensitive multibase
 * encoding survives it: base32 (`b…`) and base36 (`k…`) CIDv1. A CIDv0 (`Qm…`) is base58btc and
 * case-SENSITIVE; expressing it as a subdomain requires converting it to CIDv1 first. That
 * conversion needs a multiformats dependency we do not carry here, so CIDv0 pointers stay on
 * path-form gateways instead of being silently mangled.
 */
export function isSubdomainSafeCid(cid: string): boolean {
  return /^(b[a-z2-7]+|k[a-z0-9]+)$/.test(cid)
}

/** Build the URL for one gateway, or null when this gateway cannot address this CID. */
export function gatewayUrl(gateway: IpfsGateway, path: string): string | null {
  if (gateway.form === 'path') return `${gateway.base}${path}`
  const slash = path.indexOf('/')
  const cid = slash === -1 ? path : path.slice(0, slash)
  const rest = slash === -1 ? '' : path.slice(slash + 1)
  if (!isSubdomainSafeCid(cid)) return null
  return `https://${cid}.ipfs.${gateway.base}/${rest}`
}
