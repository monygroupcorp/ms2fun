/**
 * AmountField (Phase 0) — a standardized numeric amount input (ETH or token units) used by every
 * value/quantity action (bids, buys, stakes, withdrawals, edition prices). Pair with `parseAmount`
 * (./parseAmount) to turn the raw string into base units.
 */
import styles from './AmountField.module.css'

export interface AmountFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Short unit suffix shown beside the field, e.g. "ETH". */
  unit?: string
  ariaLabel: string
  testId?: string
}

export function AmountField({
  value,
  onChange,
  placeholder,
  disabled = false,
  unit,
  ariaLabel,
  testId,
}: AmountFieldProps) {
  return (
    <div className={styles.field}>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
      />
      {unit !== undefined && <span className={styles.unit}>{unit}</span>}
    </div>
  )
}
