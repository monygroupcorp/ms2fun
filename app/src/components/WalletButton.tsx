import { useState } from 'react'
import { Link } from 'wouter'
import { useAccount, useDisconnect } from 'wagmi'
import { WalletModal } from './WalletModal'
import styles from './WalletButton.module.css'

function truncate(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Brutalist wallet UI on wagmi's headless hooks.  When disconnected, renders a
 * single CONNECT WALLET button that opens WalletModal — which lists connectors
 * de-duplicated so EIP-6963 wallets don't appear alongside the generic
 * 'injected' fallback.  When connected, the truncated address links to the
 * holder's /portfolio, and a compact ⏏ (eject) button disconnects.
 * See docs/decisions/0001-web3-stack.md.
 */
export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [modalOpen, setModalOpen] = useState(false)

  if (isConnected && address) {
    return (
      <div className={styles.wallet}>
        <Link href="/portfolio" className={styles.address} title="view portfolio">
          {truncate(address)}
        </Link>
        <button
          type="button"
          className={styles.eject}
          onClick={() => disconnect()}
          title="disconnect"
          aria-label="disconnect wallet"
        >
          ⏏
        </button>
      </div>
    )
  }

  return (
    <>
      <div className={styles.wallet}>
        <button type="button" className={styles.button} onClick={() => setModalOpen(true)}>
          CONNECT WALLET
        </button>
      </div>
      {modalOpen && <WalletModal onClose={() => setModalOpen(false)} />}
    </>
  )
}
