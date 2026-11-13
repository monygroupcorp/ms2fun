/**
 * Best-effort LIVE total-gas estimate for the assembled `createInstance` call, for the Review step.
 * Runs `estimateContractGas` against the fork from the connected account — the same tx the wizard is
 * about to send — so the total reflects the real contract creation + modules + embeddings, not a
 * guessed constant. CREATE3 deploys the full instance bytecode (no clone), so this is the only honest
 * way to price the base deploy.
 *
 * Debounced — this read goes through the connected wallet's own RPC first (`decentralizedTransport`),
 * the same node that has to answer the deploy send a moment later. Re-estimating on every keystroke
 * (a name, a description, a swapped cover image) burns that node's quota on reads nobody asked for,
 * right when the sender needs it most; `useNameAvailability` settles the same way for the same reason.
 *
 * Degrades gracefully: no wallet, an estimate that would revert, or a down fork → `gas: undefined`.
 * The caller shows the deterministic embedding breakdown regardless; the live total is the bonus.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import {
  erc1155FactoryAbi,
  erc404FactoryAbi,
  erc721AuctionFactoryAbi,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import type { CreateCall } from '../../lib/wizard/submit'

const FACTORY = {
  ERC1155Factory: { address: forkAddresses.ERC1155Factory, abi: erc1155FactoryAbi },
  ERC721AuctionFactory: {
    address: forkAddresses.ERC721AuctionFactory,
    abi: erc721AuctionFactoryAbi,
  },
  ERC404Factory: { address: forkAddresses.ERC404Factory, abi: erc404FactoryAbi },
} as const

/** How long an edit has to sit still before it earns a fresh estimate. */
export const DEBOUNCE_MS = 500

/** bigint isn't JSON-serialisable, so stringify with a bigint-aware replacer. */
function callKey(call: CreateCall | undefined): string | undefined {
  if (!call) return undefined
  return `${call.factory}|${JSON.stringify(call.args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}|${call.value?.toString()}`
}

export interface DeployGasEstimate {
  gas: bigint | undefined
  isLoading: boolean
  isError: boolean
}

export function useDeployGasEstimate(
  call: CreateCall | undefined,
  account: `0x${string}` | undefined,
): DeployGasEstimate {
  const client = usePublicClient({ chainId: forkChainId })

  const key = callKey(call)
  const [settledCall, setSettledCall] = useState(call)
  useEffect(() => {
    const t = setTimeout(() => setSettledCall(call), DEBOUNCE_MS)
    return () => clearTimeout(t)
    // `call` is a fresh object every render; `key` is the primitive that actually identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const settledKey = callKey(settledCall)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deploy-gas', account, settledKey],
    enabled: !!client && !!settledCall && !!account,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<bigint> => {
      if (!client || !settledCall || !account) throw new Error('not ready')
      const f = FACTORY[settledCall.factory]
      return client.estimateContractGas({
        address: f.address,
        abi: f.abi,
        functionName: 'createInstance',
        // The abi↔args correlation is guaranteed by CreateCall's discriminant; the union widens here.
        args: settledCall.args as never,
        value: settledCall.value,
        account,
      })
    },
  })

  // Still waiting for the debounce to catch up with the latest edit — the figure on screen is the
  // last settled estimate, not yet one for what's on screen now.
  return { gas: data, isLoading: isLoading || key !== settledKey, isError }
}
