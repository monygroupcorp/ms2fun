/**
 * SwapQuickFill — a row of preset buttons that fill a swap amount input (S4). No one types an exact
 * amount on a swap UI: buys pick an ETH amount to SPEND (.005/.01/.05/.1), sells pick a % of the
 * held balance (25/50/75/100). Purely presentational — the parent owns the amount state and passes
 * the resolved presets (see `swapPresets`).
 */
import type { QuickPreset } from './swapPresets'

export function SwapQuickFill({
  presets,
  onPick,
  disabled,
  className,
}: {
  presets: readonly QuickPreset[]
  onPick: (value: string) => void
  disabled?: boolean | undefined
  className?: string | undefined
}) {
  return (
    <div className={className} role="group" aria-label="quick amounts">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => p.value !== undefined && onPick(p.value)}
          disabled={disabled || p.value === undefined}
          data-testid={`swap-quick-${p.label}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
