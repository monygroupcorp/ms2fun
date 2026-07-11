/**
 * Best-effort LIVE total-gas estimate for the assembled `createInstance` call, for the Review step.
 * Runs `estimateContractGas` against the fork from the connected account — the same tx the wizard is
 * about to send — so the total reflects the real contract creation + modules + embeddings, not a
 * guessed constant. CREATE3 deploys the full instance bytecode (no clone), so this is the only honest
 * way to price the base deploy.
 *
 * Degrades gracefully: no wallet, an estimate that would revert, or a down fork → `gas: undefined`.
 * The caller shows the deterministic embedding breakdown regardless; the live total is the bonus.
 */
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
  ERC721AuctionFactory: { address: forkAddresses.ERC721AuctionFactory, abi: erc721AuctionFactoryAbi },
  ERC404Factory: { address: forkAddresses.ERC404Factory, abi: erc404FactoryAbi },
} as const

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

  const { data, isLoading, isError } = useQuery({
    // Args are part of the key so a changed image / name / module re-estimates. bigint isn't
    // JSON-serialisable, so stringify with a bigint-aware replacer.
    queryKey: [
      'deploy-gas',
      account,
      call?.factory,
      call ? JSON.stringify(call.args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : null,
      call?.value?.toString(),
    ],
    enabled: !!client && !!call && !!account,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<bigint> => {
      if (!client || !call || !account) throw new Error('not ready')
      const f = FACTORY[call.factory]
      return client.estimateContractGas({
        address: f.address,
        abi: f.abi,
        functionName: 'createInstance',
        // The abi↔args correlation is guaranteed by CreateCall's discriminant; the union widens here.
        args: call.args as never,
        value: call.value,
        account,
      })
    },
  })

  return { gas: data, isLoading, isError }
}
