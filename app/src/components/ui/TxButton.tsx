/**
 * TxButton (Phase 0) — the standard button + status line for a `useTxAction`. Shows the right label
 * per tx state (idle → signing → confirming), an error line on failure, and an optional success
 * state (a message + "ok"/reset). Pairs with useTxAction so every action looks/behaves the same.
 */
import type { TxState } from './useTxAction'
import { formatReceipt, type MoneyReceipt } from './receipt'
import styles from './TxButton.module.css'

export interface TxButtonProps {
  state: TxState
  onClick: () => void
  /** Idle (ready) label, e.g. "withdraw". */
  label: string
  signingLabel?: string
  confirmingLabel?: string
  /** When set (with the tx in success state), render this confirmation instead of the button. */
  successLabel?: string | undefined
  /**
   * When set (with the tx in success state), render this MONEY receipt instead of `successLabel`.
   * Use this for any action where ETH actually left or arrived at the acting wallet — `net` is
   * required on `MoneyReceipt`, so a money action cannot compile a confirmation that omits the
   * figure. Reserve `successLabel` for genuinely amountless actions (a config toggle, a delegation
   * change). Takes precedence over `successLabel` when both are set. A money surface computing its
   * receipt from data that may still be loading legitimately passes `undefined` here (falling back
   * to `successLabel`, if any) — `exactOptionalPropertyTypes` is why this is spelled out explicitly
   * rather than left as a bare optional.
   */
  receipt?: MoneyReceipt | undefined
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
  receipt,
  onReset,
  disabled = false,
  className = 'btn btn-primary',
  errorText = 'transaction failed — try again',
  disabledHint,
  testId,
}: TxButtonProps) {
  const busy = state === 'signing' || state === 'confirming'
  const successText = receipt !== undefined ? formatReceipt(receipt) : successLabel

  if (state === 'success' && (successText !== undefined || onReset !== undefined)) {
    return (
      <div className={styles.result}>
        {successText !== undefined && (
          <p className={styles.status} data-testid={testId ? `${testId}-success` : undefined}>
            {successText}
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
