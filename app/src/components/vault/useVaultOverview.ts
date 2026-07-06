/**
 * useVaultOverview — vault-global reads for the detail page (`/vault/:address`). Unlike `useEndowment`
 * (which is per-benefactor and endowment-only), this reads the vault as a whole across families:
 *
 *  - `vaultType()`        — branch the UI (AaveEndowment / UniswapV4LP / ZAMMLP / CypherLP). The
 *                           selector is shared across families (IAlignmentVault), so the endowment
 *                           ABI hook resolves it for any vault.
 *  - `accumulatedFees()`  — fees accrued (all families expose it via IAlignmentVault).
 *  - `totalShares()`      — benefactor shares (all families).
 *  - `totalPrincipal()`   — endowment TVL. Only endowment vaults have it; gated on isEndowment.
 *  - MasterRegistry `getVaultInfo(vault)` → name / creator / targetId (may revert for an
 *    unregistered vault; tolerated).
 *  - AlignmentRegistry `getAlignmentTarget(targetId)` → the bound community's display metadata.
 */
import {
  useReadAlignmentEndowmentVaultAccumulatedFees,
  useReadAlignmentEndowmentVaultTotalPrincipal,
  useReadAlignmentEndowmentVaultTotalShares,
  useReadAlignmentEndowmentVaultVaultType,
  useReadAlignmentRegistryV1GetAlignmentTarget,
  useReadMasterRegistryV1GetVaultInfo,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'

export interface AlignmentTargetView {
  title: string
  description: string
  metadataURI: string
}

export interface VaultOverview {
  vaultType: string | undefined
  isEndowment: boolean
  /** Endowment TVL (total principal). Undefined for LP vaults (no principal read). */
  totalPrincipal: bigint | undefined
  accumulatedFees: bigint | undefined
  totalShares: bigint | undefined
  /** Registered vault name (empty/undefined if unregistered). */
  name: string | undefined
  creator: `0x${string}` | undefined
  targetId: bigint | undefined
  target: AlignmentTargetView | undefined
  isPending: boolean
}

export function useVaultOverview(vault: `0x${string}` | undefined): VaultOverview {
  const enabled = !!vault
  const at = vault ? { address: vault } : {}

  const { data: vaultType, isPending: typePending } = useReadAlignmentEndowmentVaultVaultType({
    ...at,
    chainId: forkChainId,
    query: { enabled },
  })
  const isEndowment = vaultType === 'AaveEndowment'

  const { data: accumulatedFees } = useReadAlignmentEndowmentVaultAccumulatedFees({
    ...at,
    chainId: forkChainId,
    query: { enabled },
  })
  const { data: totalShares } = useReadAlignmentEndowmentVaultTotalShares({
    ...at,
    chainId: forkChainId,
    query: { enabled },
  })
  const { data: totalPrincipal } = useReadAlignmentEndowmentVaultTotalPrincipal({
    ...at,
    chainId: forkChainId,
    query: { enabled: enabled && isEndowment },
  })

  // Registry name + alignment target. getVaultInfo reverts for an unregistered vault — tolerated
  // (data stays undefined, the page falls back to the address).
  const { data: vaultInfo } = useReadMasterRegistryV1GetVaultInfo({
    address: forkAddresses.MasterRegistryV1,
    chainId: forkChainId,
    args: vault ? [vault] : undefined,
    query: { enabled },
  })
  const targetId = vaultInfo?.targetId

  const { data: targetRaw } = useReadAlignmentRegistryV1GetAlignmentTarget({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
    args: targetId !== undefined ? [targetId] : undefined,
    query: { enabled: enabled && targetId !== undefined && targetId > 0n },
  })

  const target: AlignmentTargetView | undefined = targetRaw
    ? {
        title: targetRaw.title,
        description: targetRaw.description,
        metadataURI: targetRaw.metadataURI,
      }
    : undefined

  return {
    vaultType,
    isEndowment,
    totalPrincipal: isEndowment ? totalPrincipal : undefined,
    accumulatedFees,
    totalShares,
    name: vaultInfo?.name,
    creator: vaultInfo?.creator,
    targetId,
    target,
    isPending: typePending,
  }
}

/** Short human label for a vaultType() string. */
export function vaultFamilyLabel(vaultType: string | undefined): string {
  switch (vaultType) {
    case 'AaveEndowment':
      return 'Endowment'
    case 'UniswapV4LP':
      return 'Uni-V4 LP'
    case 'ZAMMLP':
      return 'ZAMM LP'
    case 'CypherLP':
      return 'Cypher LP'
    default:
      return vaultType || 'Vault'
  }
}
