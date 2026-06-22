import { useAccount, useConnect, useDisconnect } from 'wagmi'
import styles from './WalletButton.module.css'

function truncate(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Brutalist wallet UI on wagmi's headless hooks. Connectors are discovered via EIP-6963
 * (multiInjectedProviderDiscovery); we render the pixels, wagmi owns the plumbing, and we never
 * custody keys. See docs/decisions/0001-web3-stack.md.
 */
export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, status } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <div className={styles.wallet}>
        <span className={styles.address}>{truncate(address)}</span>
        <button type="button" className={styles.button} onClick={() => disconnect()}>
          DISCONNECT
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wallet}>
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          className={styles.button}
          disabled={status === 'pending'}
          onClick={() => connect({ connector })}
        >
          CONNECT{connector.name ? ` · ${connector.name}` : ''}
        </button>
      ))}
    </div>
  )
}
