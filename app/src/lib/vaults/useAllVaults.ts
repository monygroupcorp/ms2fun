/**
 * useAllVaults — the set of distinct alignment vaults, derived from the collections that reference
 * them. There is no `getAllVaults` array read on any registry (enumeration is per-instance / event
 * scan only), but every ProjectCard already carries `vault` + `vaultName`, and `useAllCollectionsRaw`
 * hydrates them all in one batch. So we dedupe by vault address — no extra contract calls — and count
 * how many collections align to each. TVL / type / target are read per-vault on the detail page
 * (`useVaultOverview`); this hook is just the browsable index.
 */
import { useMemo } from 'react'
import { useAllCollections } from '../discovery'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export interface VaultRow {
  address: `0x${string}`
  /** Registered vault name from the collection card (may be empty). */
  name: string
  /** How many collections align to this vault. */
  collectionCount: number
}

/**
 * Pure: dedupe collections to their distinct vaults, counting alignments and keeping the first
 * non-empty name. Skips the zero address. Most-aligned first, then by name (stable).
 */
export function dedupeVaults(
  cards: readonly { vault?: `0x${string}` | undefined; vaultName?: string | undefined }[],
): VaultRow[] {
  const byAddr = new Map<string, VaultRow>()
  for (const c of cards) {
    const vault = c.vault
    if (!vault || vault.toLowerCase() === ZERO_ADDRESS) continue
    const key = vault.toLowerCase()
    const existing = byAddr.get(key)
    if (existing) {
      existing.collectionCount += 1
      if (!existing.name && c.vaultName) existing.name = c.vaultName
    } else {
      byAddr.set(key, { address: vault, name: c.vaultName ?? '', collectionCount: 1 })
    }
  }
  return [...byAddr.values()].sort(
    (a, b) => b.collectionCount - a.collectionCount || a.name.localeCompare(b.name),
  )
}

export function useAllVaults(): {
  vaults: VaultRow[]
  isPending: boolean
  isError: boolean
} {
  const { data, isPending, isError } = useAllCollections()
  const vaults = useMemo(() => (data ? dedupeVaults(data) : []), [data])
  return { vaults, isPending, isError }
}
