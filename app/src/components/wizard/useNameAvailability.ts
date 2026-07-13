import { useEffect, useState } from 'react'
import { useReadMasterRegistryV1IsNameTaken } from '../../generated/contracts'
import { forkAddresses } from '../../lib/addresses'
import { validateCollectionName } from '../../lib/wizard/collectionName'

export type NameAvailability =
  | { state: 'idle' }
  | { state: 'invalid'; reason: string }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken' }

/**
 * Live availability of a collection name against `MasterRegistryV1.isNameTaken`. Names are claimed
 * case-insensitively and forever (`registerInstance` reverts `NameAlreadyTaken`), so the wizard has
 * to ask before the deploy tx rather than after it.
 *
 * Debounced — a keystroke shouldn't be an RPC call. Returns `invalid` without hitting the chain when
 * the name can't be registered at all.
 */
export function useNameAvailability(name: string, debounceMs = 350): NameAvailability {
  const [settled, setSettled] = useState(name)

  useEffect(() => {
    const t = setTimeout(() => setSettled(name), debounceMs)
    return () => clearTimeout(t)
  }, [name, debounceMs])

  const invalidReason = validateCollectionName(settled)
  const trimmed = settled.trim()
  const shouldQuery = !invalidReason

  const { data, isPending, isError } = useReadMasterRegistryV1IsNameTaken({
    address: forkAddresses.MasterRegistryV1,
    args: shouldQuery ? [trimmed] : undefined,
    query: { enabled: shouldQuery },
  })

  if (!name.trim()) return { state: 'idle' }
  // Still waiting for the debounce to catch up with what's on screen.
  if (settled !== name) return { state: 'checking' }
  if (invalidReason) return { state: 'invalid', reason: invalidReason }
  if (isError) return { state: 'idle' }
  if (isPending) return { state: 'checking' }
  return data ? { state: 'taken' } : { state: 'available' }
}
