/**
 * TxButton (Phase 0) — the standard button + status line for a `useTxAction`. Shows the right label
 * per tx state (idle → signing → confirming), an error line on failure, and an optional success
 * state (a message + "ok"/reset). Pairs with useTxAction so every action looks/behaves the same.
 */
import type { TxState } from './useTxAction'
import styles from './TxButton.module.css'

export interface TxButtonProps {
  state: TxState
  onClick: () => void
  /** Idle (ready) label, e.g. "withdraw". */
  label: string
  signingLabel?: string
  confirmingLabel?: string
  /** When set (with the tx in success state), render this confirmation instead of the button. */
  successLabel?: string
  /** When provided, the success state shows an "ok" button that calls this (e.g. tx.reset). */
  onReset?: () => void
  disabled?: boolean
  /** Global button classes; defaults to the primary CTA. */
  className?: string
  errorText?: string
  /**
   * Shown under the button while it's disabled and idle — so a button that's greyed *pending an
   * input* (e.g. "enter an amount") reads as "here's what to do", not "this capability is unavailable".
   */
  disabledHint?: string
  testId?: string
}

export function TxButton({
  state,
  onClick,
  label,
  signingLabel = 'confirm in wallet…',
  confirmingLabel = 'confirming…',
  successLabel,
  onReset,
  disabled = false,
  className = 'btn btn-primary',
  errorText = 'transaction failed — try again',
  disabledHint,
  testId,
}: TxButtonProps) {
  const busy = state === 'signing' || state === 'confirming'

  if (state === 'success' && (successLabel !== undefined || onReset !== undefined)) {
    return (
      <div className={styles.result}>
        {successLabel !== undefined && (
          <p className={styles.status} data-testid={testId ? `${testId}-success` : undefined}>
            {successLabel}
          </p>
        )}
        {onReset !== undefined && (
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            ok
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.action}>
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={disabled || busy}
        data-testid={testId}
      >
        {state === 'signing' ? signingLabel : state === 'confirming' ? confirmingLabel : label}
      </button>
      {state === 'error' && <p className={`${styles.status} ${styles.error}`}>{errorText}</p>}
      {disabled && !busy && state === 'idle' && disabledHint !== undefined && (
        <p className={styles.hint}>{disabledHint}</p>
      )}
    </div>
  )
}
