/**
 * YieldVaultRequestCard (noesis-367) — ask the protocol for a curated Aave endowment vault.
 *
 * When a community (alignment target) has no Yield vault yet, this card lets any connected wallet
 * register an ASK: `AlignmentRegistryV1.requestVault(targetId, token)` emits `VaultRequested` and
 * nothing more. Vault deployment is owner-only (noesis-366), because every parameter that defines a
 * vault — its price validator, pool and acquisition route — is curated by the protocol rather than
 * supplied by whoever asks for it. So the card sends a target and a token, and no vault parameters.
 *
 * A request creates no vault, so there is nothing to add to the roster on success: the card shows an
 * "awaiting review" state instead of invalidating the registered-vaults query.
 *
 * LP venues (Uni/ZAMM/Cypher) stay "coming soon" — they need the priceValidator/pool-config lockdown
 * first (spec §4.2), and are intentionally NOT wired here.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { alignmentRegistryV1Abi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { humanEth, humanGas, REF_GWEI } from '../../lib/wizard/embedGas'
import { truncateAddress } from '../../lib/format'
import styles from './AlignmentTargetPicker.module.css'

interface TargetAsset {
  token: `0x${string}`
  symbol: string
}

export function YieldVaultRequestCard({
  targetId,
  targetTitle,
  onRequested,
}: {
  targetId: bigint
  targetTitle: string
  onRequested: () => void
}) {
  const registry = forkAddresses.AlignmentRegistryV1
  const { address: account } = useAccount()
  const publicClient = usePublicClient({ chainId: forkChainId })

  // Resolve the approved token(s) for this target. Single asset auto-selects; multi renders a chooser.
  const { data: assetsRaw } = useReadContract({
    address: registry,
    abi: alignmentRegistryV1Abi,
    functionName: 'getAlignmentTargetAssets',
    args: [targetId],
    chainId: forkChainId,
  })
  const assets = useMemo<TargetAsset[]>(
    () =>
      (assetsRaw ?? []).map((a) => ({
        token: a.token as `0x${string}`,
        symbol: a.symbol,
      })),
    [assetsRaw],
  )

  const [chosenToken, setChosenToken] = useState<`0x${string}` | undefined>(undefined)
  const token = assets.length === 1 ? assets[0]?.token : chosenToken

  // Live gas estimate for the exact requestVault the button will send. A request is one validated
  // event, so this is deliberately priced against that call and not against any deploy.
  const { data: gas } = useQuery({
    queryKey: ['vault-request-gas', forkChainId, registry, targetId.toString(), token, account],
    enabled: !!publicClient && !!account && !!token,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<bigint> => {
      if (!publicClient || !account || !token) throw new Error('not ready')
      return publicClient.estimateContractGas({
        address: registry,
        abi: alignmentRegistryV1Abi,
        functionName: 'requestVault',
        args: [targetId, token],
        account,
      })
    },
  })

  const { writeContract, data: hash, isPending, isError: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // The request mines. No vault exists yet, so there is nothing to re-scan — the roster is unchanged
  // until the protocol deploys one. Notify the parent and leave the card in its "awaiting review" state.
  useEffect(() => {
    if (isSuccess) onRequested()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const busy = isPending || isConfirming
  const canRequest = !!account && !!token && !busy && !isSuccess

  function request() {
    if (!token) return
    reset()
    writeContract({
      address: registry,
      abi: alignmentRegistryV1Abi,
      functionName: 'requestVault',
      args: [targetId, token],
      chainId: forkChainId,
    })
  }

  const gasNote =
    gas !== undefined
      ? `~${humanGas(Number(gas))} (${humanEth(Number(gas))} @ ${REF_GWEI}gwei)`
      : null

  return (
    <div className={`${styles.venueCard} ${styles.venueCreate}`}>
      <span className={styles.venueName}>Aave Endowment</span>

      {assets.length > 1 && (
        <div className={styles.venueGrid} role="radiogroup" aria-label="alignment token">
          {assets.map((a) => (
            <button
              key={a.token}
              type="button"
              className={`${styles.venueCard} ${token === a.token ? styles.venueSelected : ''}`}
              onClick={() => setChosenToken(a.token)}
              aria-pressed={token === a.token}
            >
              <span className={styles.venueName}>{a.symbol || truncateAddress(a.token)}</span>
            </button>
          ))}
        </div>
      )}

      <span className={styles.venueNote}>
        {!account
          ? `Yield · connect a wallet to request one for ${targetTitle}`
          : isSuccess
            ? 'Requested — awaiting review. The protocol deploys curated vaults; a request is not a guarantee.'
            : busy
              ? 'Sending request…'
              : assets.length > 1 && !token
                ? `Yield · pick a token to request for ${targetTitle}`
                : writeError
                  ? 'Request failed — try again'
                  : gasNote
                    ? `Yield · request one for ${targetTitle} · ${gasNote}`
                    : `Yield · request one for ${targetTitle}`}
      </span>

      <button
        type="button"
        className="btn btn-primary"
        onClick={request}
        disabled={!canRequest}
        data-testid="yield-vault-request"
      >
        {busy ? 'Requesting…' : isSuccess ? 'Requested' : 'Request vault'}
      </button>
    </div>
  )
}
