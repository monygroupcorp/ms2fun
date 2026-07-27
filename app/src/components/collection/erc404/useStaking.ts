/**
 * Read aggregation for the ERC404 staking surface. The INSTANCE holds stake/unstake/claim
 * entrypoints plus `stakingActive` / `stakingModule` / `owner`; the separate ERC404StakingModule
 * holds the per-user position READS. `getStakingInfo(instance, user)` already returns userStaked /
 * globalTotalStaked / pendingRewards in one call, so it is the primary read here.
 */
import { useCallback } from 'react'
import { useAccount } from 'wagmi'
import {
  useReadErc404BondingInstanceBalanceOf,
  useReadErc404BondingInstanceOwner,
  useReadErc404BondingInstanceStakingActive,
  useReadErc404BondingInstanceStakingModule,
  useReadErc404StakingModuleGetStakingInfo,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'

/** Placeholder for the module read while `stakingModule` is still resolving (query gated off). */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export interface StakingData {
  /** Whether staking has been activated on this instance. */
  stakingActive: boolean | undefined
  /** True once the connected wallet is confirmed to be the instance owner. */
  isOwner: boolean
  /** Connected wallet's free (un-staked) token balance — caps the stake input. */
  tokenBalance: bigint | undefined
  /** Connected wallet's currently staked balance — caps the unstake input. */
  userStaked: bigint | undefined
  /** Global total staked across all users on this instance. */
  globalTotalStaked: bigint | undefined
  /** Connected wallet's pending (claimable) rewards, in wei. */
  pendingRewards: bigint | undefined
  /** Refetch every read after a successful tx. */
  refetch: () => void
}

export function useStaking(instance: `0x${string}`): StakingData {
  const chainId = useCollectionChainId()
  const { address } = useAccount()

  const stakingActive = useReadErc404BondingInstanceStakingActive({
    address: instance,
    chainId: chainId,
  })

  const owner = useReadErc404BondingInstanceOwner({
    address: instance,
    chainId: chainId,
  })

  const stakingModule = useReadErc404BondingInstanceStakingModule({
    address: instance,
    chainId: chainId,
  })

  const balance = useReadErc404BondingInstanceBalanceOf({
    address: instance,
    chainId: chainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const moduleAddress = stakingModule.data
  const stakingInfo = useReadErc404StakingModuleGetStakingInfo({
    address: moduleAddress ?? ZERO_ADDRESS,
    chainId: chainId,
    args: address && moduleAddress ? [instance, address] : undefined,
    query: { enabled: Boolean(address) && Boolean(moduleAddress) },
  })

  const info = stakingInfo.data
  const isOwner =
    address !== undefined &&
    owner.data !== undefined &&
    owner.data.toLowerCase() === address.toLowerCase()

  const refetchStakingActive = stakingActive.refetch
  const refetchOwner = owner.refetch
  const refetchModule = stakingModule.refetch
  const refetchBalance = balance.refetch
  const refetchInfo = stakingInfo.refetch

  const refetch = useCallback(() => {
    void refetchStakingActive()
    void refetchOwner()
    void refetchModule()
    void refetchBalance()
    void refetchInfo()
  }, [refetchStakingActive, refetchOwner, refetchModule, refetchBalance, refetchInfo])

  return {
    stakingActive: stakingActive.data,
    isOwner,
    tokenBalance: balance.data,
    userStaked: info ? info[1] : undefined,
    globalTotalStaked: info ? info[2] : undefined,
    pendingRewards: info ? info[4] : undefined,
    refetch,
  }
}
