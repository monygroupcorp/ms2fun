/**
 * WrongNetworkBanner — the network failsafe. If a connected wallet is on a different chain than the
 * one the contracts are deployed on (`forkChainId` — the anvil fork in dev, the target chain in
 * prod), EVERY write silently goes nowhere (reads use the app's own transport and keep working, so
 * nothing looks broken until a tx vanishes). This surfaces the mismatch loudly and offers a one-click
 * switch, with the manual network details as a fallback for wallets that reject programmatic
 * `wallet_switchEthereumChain` (e.g. some smart-account wallets).
 *
 * Renders nothing when disconnected or already on the right chain — so it's safe to always mount.
 */
import { useAccount, useSwitchChain } from 'wagmi'
import { forkChainId } from '../../lib/addresses'
import { config } from '../../lib/wagmi'
import { txErrorReason } from './useTxAction'
import styles from './WrongNetworkBanner.module.css'

const expectedChain = config.chains.find((chain) => chain.id === forkChainId)
const expectedName = expectedChain?.name ?? `chain ${forkChainId}`
const expectedRpc = expectedChain?.rpcUrls.default.http[0]

export function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()

  // Only warn on a CONFIRMED mismatch — `chainId` is briefly undefined mid-connect, and warning then
  // would flicker a false alarm.
  if (!isConnected || chainId === undefined || chainId === forkChainId) return null

  const switchReason = txErrorReason(error)

  return (
    <div className={styles.banner} role="alert" data-testid="wrong-network">
      <div className={styles.row}>
        <div className={styles.text}>
          <span className={styles.label}>Wrong network</span>
          <span className={styles.msg}>
            Your wallet is on chain {chainId}. This app runs on <b>{expectedName}</b> (chain{' '}
            {forkChainId}) — transactions will fail silently until you switch.
          </span>
        </div>
        <button
          type="button"
          className={styles.switchBtn}
          onClick={() => switchChain({ chainId: forkChainId })}
          disabled={isPending}
          data-testid="wrong-network-switch"
        >
          {isPending ? 'switching…' : `switch to ${expectedName}`}
        </button>
      </div>
      {switchReason !== undefined && (
        <p className={styles.fallback}>
          Couldn&apos;t switch automatically ({switchReason}). Add the network in your wallet: chain
          id {forkChainId}
          {expectedRpc !== undefined ? `, RPC ${expectedRpc}` : ''}.
        </p>
      )}
    </div>
  )
}
