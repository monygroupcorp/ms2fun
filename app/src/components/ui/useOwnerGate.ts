/**
 * useOwnerGate (Phase 0) — reads an instance's `owner()` and reports whether the connected wallet is
 * it. Every per-instance creator-admin surface gates on this. Generic across all instance types (they
 * all expose the Solady `owner()`), so it reads via a minimal inline ABI rather than a per-type hook.
 */
import { useAccount, useReadContract } from 'wagmi'
import { forkChainId } from '../../lib/addresses'

const ownerAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export interface OwnerGate {
  owner: `0x${string}` | undefined
  connected: `0x${string}` | undefined
  /** Connected wallet is the instance owner (creator-admin actions are allowed). */
  isOwner: boolean
}

export function useOwnerGate(instance: `0x${string}` | undefined): OwnerGate {
  const { address: connected } = useAccount()
  const { data: owner } = useReadContract({
    address: instance,
    abi: ownerAbi,
    functionName: 'owner',
    chainId: forkChainId,
    query: { enabled: !!instance },
  })
  const isOwner = !!connected && !!owner && connected.toLowerCase() === owner.toLowerCase()
  return { owner, connected, isOwner }
}
