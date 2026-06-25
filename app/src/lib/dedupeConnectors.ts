import { type Connector } from 'wagmi'

/**
 * De-duplicate the connector list surfaced by wagmi.
 *
 * When `multiInjectedProviderDiscovery: true`, wagmi adds one connector per
 * EIP-6963 wallet (unique id = rdns, e.g. "io.ambire.wallet").  It also keeps
 * the explicit `injected()` connector (id === 'injected') which maps to
 * window.ethereum — the same wallet as whichever EIP-6963 provider is active.
 *
 * Rule: show all EIP-6963 connectors.  Include the generic 'injected' fallback
 * ONLY when no EIP-6963 connectors are present, so users without a listed
 * wallet can still connect via window.ethereum.
 */
export function dedupeConnectors(connectors: readonly Connector[]): Connector[] {
  const discovered = connectors.filter((c) => c.id !== 'injected')
  if (discovered.length > 0) {
    // De-dupe by id in case the same rdns appears twice (edge case)
    const seen = new Set<string>()
    return discovered.filter((c) => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }
  // No EIP-6963 wallets found — surface the generic injected fallback
  const fallback = connectors.find((c) => c.id === 'injected')
  return fallback ? [fallback] : []
}
