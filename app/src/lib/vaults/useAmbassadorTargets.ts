/**
 * useAmbassadorTargets — which of a community's alignment targets the connected wallet holds the
 * ambassador seat on.
 *
 * The seat is per (targetId, address): `AlignmentRegistryV1.addAmbassador` is owner-only and stores
 * `_isAmbassador[targetId][account]`. A community curated on two venues therefore has two target
 * ids, and an appointment on one says nothing about the other — so this asks the registry once per
 * id rather than inferring the community from any single answer.
 *
 * Auth is read LIVE (no caching of the appointment beyond React Query's own window) for the same
 * reason the endowment vault resolves it live: `removeAmbassador` is the platform owner's only
 * backstop against a rogue seat, and a surface that kept serving a revoked ambassador their controls
 * would be showing them authority the chain has already taken back.
 */
import { useMemo } from 'react'
import { useAccount, useReadContracts } from 'wagmi'
import { alignmentRegistryV1Abi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../addresses'

export interface AmbassadorSeats {
  /** The subset of `targetIds` the connected wallet is an appointed ambassador of, input order. */
  targetIds: bigint[]
  /** True while the registry reads are outstanding (never true when there is nothing to ask). */
  isPending: boolean
}

export function useAmbassadorTargets(targetIds: readonly bigint[]): AmbassadorSeats {
  const { address: connected } = useAccount()
  // Stable across renders for the query key: the caller rebuilds the id array every render.
  const key = targetIds.map((id) => id.toString()).join(',')
  // `key` is the value identity of the id list — the caller rebuilds the array every render, so
  // memoising on the string keeps the query's contract list stable.
  const ids = useMemo(() => (key === '' ? [] : key.split(',').map((s) => BigInt(s))), [key])

  const enabled = !!connected && ids.length > 0
  const { data, isPending } = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: forkAddresses.AlignmentRegistryV1,
      abi: alignmentRegistryV1Abi,
      functionName: 'isAmbassador' as const,
      args: [id, connected ?? '0x0000000000000000000000000000000000000000'] as const,
      chainId: forkChainId,
    })),
    query: { enabled },
  })

  const seats = useMemo(
    () => ids.filter((_, i) => data?.[i]?.status === 'success' && data[i]?.result === true),
    [ids, data],
  )

  return { targetIds: seats, isPending: enabled && isPending }
}
