/**
 * Wizard write glue (Phase 3 / T2): execute a typed `CreateCall` from the submit-builder and surface
 * the deployed instance address. Dispatches `createInstance` to the matching factory, awaits the
 * receipt, and parses the `InstanceCreated` event for the new instance (so the wizard can redirect to
 * `/collection/:instance`).
 *
 * The config-apply seam: `submit` takes the `CreateCall` only for now; follow-on module-config calls
 * (e.g. `configureFor(instance, TierConfig)`) attach here once the per-`configType` encoders land —
 * they run after `instance` is known, keyed by the chosen module's configType.
 */
import { useState } from 'react'
import { parseEventLogs } from 'viem'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import {
  erc1155FactoryAbi,
  erc404FactoryAbi,
  erc721AuctionFactoryAbi,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import type { CreateCall } from '../../lib/wizard/submit'

const FACTORY_ABI = {
  ERC1155Factory: erc1155FactoryAbi,
  ERC721AuctionFactory: erc721AuctionFactoryAbi,
  ERC404Factory: erc404FactoryAbi,
} as const

export interface CreateSubmit {
  submit: (call: CreateCall) => void
  /** The deployed instance address, once the `InstanceCreated` event is mined. */
  instance: `0x${string}` | undefined
  isPending: boolean // awaiting wallet signature
  isConfirming: boolean // tx mining
  isSuccess: boolean
  isError: boolean
  reset: () => void
}

export function useCreateSubmit(): CreateSubmit {
  const [factory, setFactory] = useState<CreateCall['factory'] | undefined>(undefined)
  const {
    writeContract,
    data: hash,
    isPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteContract()
  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash })

  function submit(call: CreateCall): void {
    setFactory(call.factory)
    // Switch per variant so the abi ↔ args correlation stays type-checked.
    switch (call.type) {
      case 'erc1155':
        writeContract({
          address: forkAddresses.ERC1155Factory,
          abi: erc1155FactoryAbi,
          functionName: 'createInstance',
          args: call.args,
          chainId: forkChainId,
          value: call.value,
        })
        return
      case 'erc721':
        writeContract({
          address: forkAddresses.ERC721AuctionFactory,
          abi: erc721AuctionFactoryAbi,
          functionName: 'createInstance',
          args: call.args,
          chainId: forkChainId,
          value: call.value,
        })
        return
      case 'erc404':
        writeContract({
          address: forkAddresses.ERC404Factory,
          abi: erc404FactoryAbi,
          functionName: 'createInstance',
          args: call.args,
          chainId: forkChainId,
          value: call.value,
        })
        return
    }
  }

  let instance: `0x${string}` | undefined
  if (receipt && factory) {
    const events = parseEventLogs({
      abi: FACTORY_ABI[factory],
      eventName: 'InstanceCreated',
      logs: receipt.logs,
    })
    const first = events[0]
    if (first && 'instance' in first.args) {
      instance = first.args.instance
    }
  }

  function reset(): void {
    setFactory(undefined)
    resetWrite()
  }

  return {
    submit,
    instance,
    isPending,
    isConfirming,
    isSuccess,
    isError: writeError || waitError,
    reset,
  }
}
