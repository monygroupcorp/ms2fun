/**
 * Fetch everything a holder's MetadataOverlayModule panel needs for one token id: its current
 * selection pointer, commission state, and every published wave with this holder's eligibility/paid
 * flag — refetched on tx success. A variable-length wave list rules out the generated per-function
 * hooks (fixed hook count per render), so this follows the multicall+useQuery idiom already used for
 * per-token reads (see `TokenDetailPage`'s `Erc404Token`).
 *
 * Reads are split into per-function calls (rather than one big heterogeneous multicall) because a
 * struct return (`commissionTerms`/`waves`) only keeps its named-field typing when every call in a
 * `client.multicall` batch shares one `functionName` (cf. `useAuctions`' homogeneous `getAuction`
 * multicall) — mixing it with scalar reads widens the result to an untyped tuple. The individual
 * `readContract` calls still coalesce into as few round-trips as the transport allows via the
 * public client's `batch: { multicall: true }` config (lib/wagmi.ts).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { metadataOverlayModuleAbi } from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'

export const SEL_AUTO = 0n
export const SEL_BASE = 1n
export const SEL_COMMISSION = 2n
export const WAVE_OFFSET = 3n

export interface OverlayWaveView {
  index: number
  baseURI: string
  cond: number // WaveCond: 0 NONE, 1 STAKE, 2 PAY
  threshold: bigint
  price: bigint
  payout: number
  eligible: boolean
  paid: boolean
}

export interface OverlayHolderState {
  selection: bigint
  autoLatest: boolean
  commissionURI: string
  commissionCond: number // CommCond: 0 NONE, 1 PAY
  commissionPrice: bigint
  commissionPayout: number
  commissionPaid: boolean
  commissionVisible: boolean
  waves: OverlayWaveView[]
}

export function useOverlayHolderState(
  overlay: `0x${string}` | undefined,
  instance: `0x${string}` | undefined,
  id: bigint | undefined,
  holder: `0x${string}` | undefined,
): UseQueryResult<OverlayHolderState> {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })

  const query = useQuery({
    queryKey: ['overlay-holder-state', overlay, instance, id?.toString(), holder],
    enabled: !!client && !!overlay && !!instance && id !== undefined && !!holder,
    staleTime: 15_000,
    queryFn: async (): Promise<OverlayHolderState> => {
      if (!client || !overlay || !instance || id === undefined || !holder) {
        throw new Error('overlay holder state: missing inputs')
      }
      const base = { address: overlay, abi: metadataOverlayModuleAbi } as const

      const [
        selection,
        autoLatest,
        waveCount,
        commissionURI,
        commissionTerms,
        commissionPaid,
        commissionVisible,
      ] = await Promise.all([
        client.readContract({ ...base, functionName: 'selection', args: [instance, id] }),
        client.readContract({ ...base, functionName: 'autoLatest', args: [instance] }),
        client.readContract({ ...base, functionName: 'waveCount', args: [instance] }),
        client.readContract({ ...base, functionName: 'commissionURI', args: [instance, id] }),
        client.readContract({ ...base, functionName: 'commissionTerms', args: [instance, id] }),
        client.readContract({ ...base, functionName: 'paid', args: [instance, id] }),
        client.readContract({ ...base, functionName: 'commissionVisible', args: [instance, id] }),
      ])

      const indices = Array.from({ length: Number(waveCount) }, (_, i) => i)

      const [wavesRes, eligibleRes, paidRes] =
        indices.length > 0
          ? await Promise.all([
              client.multicall({
                allowFailure: false,
                contracts: indices.map(
                  (i) => ({ ...base, functionName: 'waves', args: [instance, BigInt(i)] }) as const,
                ),
              }),
              client.multicall({
                allowFailure: false,
                contracts: indices.map(
                  (i) =>
                    ({
                      ...base,
                      functionName: 'waveEligible',
                      args: [instance, id, BigInt(i), holder],
                    }) as const,
                ),
              }),
              client.multicall({
                allowFailure: false,
                contracts: indices.map(
                  (i) =>
                    ({
                      ...base,
                      functionName: 'wavePaid',
                      args: [instance, id, BigInt(i)],
                    }) as const,
                ),
              }),
            ])
          : [[], [], []]

      // `waves(inst, i)` is a public-mapping-of-struct auto-getter — Solidity unrolls its fields into
      // SEPARATE top-level outputs (not one `tuple`), so viem decodes it as a positional tuple, not a
      // named object (unlike `getAuction`'s single named-tuple return). Same for `commissionTerms`.
      const waves: OverlayWaveView[] = indices.map((i) => {
        const w = wavesRes[i]
        if (!w) throw new Error(`overlay holder state: missing wave ${i}`)
        const [baseURI, cond, threshold, price, payout] = w
        return {
          index: i,
          baseURI,
          cond,
          threshold,
          price,
          payout,
          eligible: eligibleRes[i] ?? false,
          paid: paidRes[i] ?? false,
        }
      })

      const [commissionCond, commissionPrice, commissionPayout] = commissionTerms

      return {
        selection,
        autoLatest,
        commissionURI,
        commissionCond,
        commissionPrice,
        commissionPayout,
        commissionPaid,
        commissionVisible,
        waves,
      }
    },
  })

  return query
}
