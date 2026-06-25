import { useEffect, useRef } from 'react'
import { useConnect } from 'wagmi'
import { dedupeConnectors } from '../lib/dedupeConnectors'
import styles from './WalletModal.module.css'

interface WalletModalProps {
  onClose: () => void
}

export function WalletModal({ onClose }: WalletModalProps) {
  const { connect, connectors, status, variables } = useConnect({
    mutation: {
      onSuccess() {
        onClose()
      },
    },
  })

  const modalRef = useRef<HTMLDivElement>(null)

  // Close on Esc
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Focus the modal on mount for keyboard accessibility
  useEffect(() => {
    modalRef.current?.focus()
  }, [])

  const display = dedupeConnectors(connectors)

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        className={styles.modal}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id="wallet-modal-title" className={styles.title}>
            Connect Wallet
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close wallet modal"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {display.length === 0 ? (
          <p className={styles.empty}>No wallet detected.</p>
        ) : (
          <ul className={styles.list}>
            {display.map((connector) => {
              const isPending = status === 'pending' && variables?.connector === connector
              return (
                <li key={connector.id}>
                  <button
                    type="button"
                    className={styles.connectorBtn}
                    disabled={status === 'pending'}
                    onClick={() => connect({ connector })}
                  >
                    {connector.icon && (
                      <img src={connector.icon} alt="" aria-hidden="true" className={styles.icon} />
                    )}
                    <span className={styles.name}>{connector.name}</span>
                    {isPending && <span className={styles.pending}>Connecting…</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
