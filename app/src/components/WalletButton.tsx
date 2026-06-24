import { useState } from 'react'
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
 * 'injected' fallback.  When connected, shows the truncated address and a
 * DISCONNECT button.  See docs/decisions/0001-web3-stack.md.
 */
export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [modalOpen, setModalOpen] = useState(false)

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
