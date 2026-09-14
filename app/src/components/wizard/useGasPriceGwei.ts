/**
 * Live gas price, in gwei, for the chain this build talks to — the price behind every ~ETH figure
 * the wizard renders.
 *
 * The gas in those readouts is measured (the embedding byte model, `estimateContractGas`); without
 * this the price multiplying it was a constant, so the ETH column was a real number times an
 * invented one, shown as an estimate. `eth_gasPrice` is the one fee call every chain here answers —
 * anvil fork, Sepolia fork, public Sepolia — and on an EIP-1559 chain the node already folds the
 * base fee and a suggested tip into the single per-unit price a sender actually pays.
 *
 * When no fee can be read the caller still has gas worth showing, so the price falls back to
 * `REF_GWEI` and `isLive` goes false. Every caller must render that difference: a fallback that
 * looks like a read is the defect this exists to remove.
 */
import { useGasPrice } from 'wagmi'
import { forkChainId } from '../../lib/addresses'
import { REF_GWEI } from '../../lib/wizard/embedGas'

export interface GasPriceGwei {
  /** Price to multiply gas by. Live when `isLive`, otherwise the REF_GWEI fallback. */
  gwei: number
  /** True only when `gwei` came off the chain. */
  isLive: boolean
  isLoading: boolean
}

export function useGasPriceGwei(): GasPriceGwei {
  const { data, isLoading } = useGasPrice({
    chainId: forkChainId,
    // A fee moves block to block; re-reading it faster than that buys nothing but RPC calls.
    query: { staleTime: 30_000, retry: false },
  })

  if (data === undefined) return { gwei: REF_GWEI, isLive: false, isLoading }
  return { gwei: Number(data) / 1e9, isLive: true, isLoading: false }
}
