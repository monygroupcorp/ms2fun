/**
 * useAlignmentTargets — the approved alignment targets (Milady-Station-2, Cult-DAO, …) that vaults
 * bind to. There's no array read, but ids are dense: `registerAlignmentTarget` does
 * `++nextAlignmentTargetId`, so valid ids are 1..nextAlignmentTargetId. We read the count then
 * multicall `getAlignmentTarget(id)` for each and keep the active ones. Display metadata (logo) lives
 * in each target's `metadataURI` (resolved per-card via useCollectionMetadata).
 */
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import {
  alignmentRegistryV1Abi,
  useReadAlignmentRegistryV1NextAlignmentTargetId,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../addresses'

export interface AlignmentTargetRow {
  id: bigint
  title: string
  description: string
  metadataURI: string
}

export function useAlignmentTargets(): { targets: AlignmentTargetRow[]; isPending: boolean } {
  const { data: next } = useReadAlignmentRegistryV1NextAlignmentTargetId({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
  })
  const count = next !== undefined ? Number(next) : 0
  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i + 1)), [count])

  const { data, isPending } = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: forkAddresses.AlignmentRegistryV1,
      abi: alignmentRegistryV1Abi,
      functionName: 'getAlignmentTarget' as const,
      args: [id] as const,
      chainId: forkChainId,
    })),
    query: { enabled: ids.length > 0 },
  })

  const targets = useMemo((): AlignmentTargetRow[] => {
    const out: AlignmentTargetRow[] = []
    data?.forEach((r) => {
      if (r.status !== 'success' || !r.result) return
      const t = r.result as {
        id: bigint
        title: string
        description: string
        metadataURI: string
        active: boolean
      }
      if (t.active)
        out.push({
          id: t.id,
          title: t.title,
          description: t.description,
          metadataURI: t.metadataURI,
        })
    })
    return out
  }, [data])

  return { targets, isPending: isPending && ids.length > 0 }
}
