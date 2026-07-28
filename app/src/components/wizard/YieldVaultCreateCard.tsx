/**
 * YieldVaultCreateCard (noesis-077) — permissionless Aave endowment-vault creation from the wizard.
 *
 * When a community (alignment target) has no Yield vault yet, this replaces the static "coming soon"
 * card with a working Create affordance: any connected wallet paying its own gas can deploy the vault
 * for an approved token. The AlignmentEndowmentVaultFactory SELF-REGISTERS the new vault in the
 * MasterRegistry with an on-chain-derived name + hardcoded metadataURI (nothing caller-supplied), so
 * this UI never sends a name/URI. On success we invalidate the registered-vaults query so the
 * `VaultRegistered` re-scan surfaces the new Yield venue as selectable.
 *
 * LP venues (Uni/ZAMM/Cypher) stay "coming soon" — they need the priceValidator/pool-config lockdown
 * first (spec §4.2), and are intentionally NOT wired here.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

/**
 * Hand-written ABI fragment for the one factory method this card calls — mirrors the inline-ABI pattern
 * in `useRegisteredVaults` (avoids a wagmi regen just to reach a single function). The factory address
 * is exported to `forkAddresses.AaveEndowmentVaultFactory` by the deploy bridge.
 */
const AAVE_FACTORY_ABI = [
  {
    type: 'function',
    name: 'deployVault',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'salt', type: 'bytes32' },
      { name: 'alignmentToken', type: 'address' },
      { name: 'alignmentTargetId', type: 'uint256' },
    ],
    outputs: [{ name: 'vault', type: 'address' }],
  },
] as const

interface TargetAsset {
  token: `0x${string}`
  symbol: string
}

/** A fresh 32-byte random salt — the factory binds it to msg.sender, so uniqueness per attempt is enough. */
function randomSalt(): `0x${string}` {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` as `0x${string}`
}

export function YieldVaultCreateCard({
  targetId,
  targetTitle,
  onCreated,
}: {
  targetId: bigint
  targetTitle: string
  onCreated: () => void
}) {
  const factory = forkAddresses.AaveEndowmentVaultFactory
  const { address: account } = useAccount()
  const publicClient = usePublicClient({ chainId: forkChainId })
  const queryClient = useQueryClient()

  // Resolve the approved token(s) for this target. Single asset auto-selects; multi renders a chooser.
  const { data: assetsRaw } = useReadContract({
    address: forkAddresses.AlignmentRegistryV1,
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

  // Live gas estimate for the exact deployVault the button will send.
  const { data: gas } = useQuery({
    queryKey: ['aave-deploy-gas', forkChainId, factory, targetId.toString(), token, account],
    enabled: !!publicClient && !!account && !!token && factory !== undefined,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<bigint> => {
      if (!publicClient || !account || !token) throw new Error('not ready')
      return publicClient.estimateContractGas({
        address: factory,
        abi: AAVE_FACTORY_ABI,
        functionName: 'deployVault',
        args: [randomSalt(), token, targetId],
        account,
      })
    },
  })

  const { writeContract, data: hash, isPending, isError: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // When the deploy mines, re-scan the roster so the new Yield venue becomes selectable.
  useEffect(() => {
    if (isSuccess) {
      void queryClient.invalidateQueries({ queryKey: ['registered-vaults'] })
      onCreated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const busy = isPending || isConfirming
  const canDeploy = !!account && !!token && !busy

  function deploy() {
    if (!token) return
    reset()
    writeContract({
      address: factory,
      abi: AAVE_FACTORY_ABI,
      functionName: 'deployVault',
      args: [randomSalt(), token, targetId],
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
          ? `Yield · connect a wallet to create for ${targetTitle}`
          : isSuccess
            ? 'Vault created — now selectable above'
            : busy
              ? 'Deploying…'
              : assets.length > 1 && !token
                ? `Yield · pick a token to create for ${targetTitle}`
                : writeError
                  ? 'Deploy failed — try again'
                  : gasNote
                    ? `Yield · deploy for ${targetTitle} · ${gasNote}`
                    : `Yield · deploy for ${targetTitle}`}
      </span>

      <button
        type="button"
        className="btn btn-primary"
        onClick={deploy}
        disabled={!canDeploy}
        data-testid="yield-vault-create"
      >
        {busy ? 'Creating…' : 'Create vault'}
      </button>
    </div>
  )
}
