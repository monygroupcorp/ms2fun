import type { ReactNode } from 'react'

type StateVariant = 'loading' | 'empty' | 'error'

/**
 * The shared loading / empty / error state. Every surface used to hand-roll a
 * `<p className={styles.note}>…</p>` with a per-page `.note` rule; this unifies the
 * styling (and the loading pulse + error contrast + reduced-motion handling) in one
 * place. Messages stay caller-supplied — they're contextual ("is the fork up?").
 *
 * Visual layer is the NOESIS `.noesis-state` device (vendored signature.css), which
 * maps 1:1 onto these props: `loading`→pulse+▪, `error`→✕+left accent (`role=alert`),
 * `empty`→muted inline, `boxed`→the reserved 2px dashed frame for large zero-states.
 * Both the keyframe and the `prefers-reduced-motion` guard live with the device.
 *
 *   <StateBlock variant="loading">hanging the work…</StateBlock>
 *   <StateBlock variant="error">discovery unreachable — is the fork up?</StateBlock>
 *   <StateBlock variant="empty" boxed>this wall is empty</StateBlock>
 *
 * For rich boxed zero-states, callers may pass structured children using the device's
 * `.big` / `.cap` / `.act` sub-classes (headline + caption + a way in).
 * `testId` passes through to data-testid so existing tests keep their hooks.
 */
export function StateBlock({
  variant = 'empty',
  boxed = false,
  children,
  testId,
  className,
}: {
  variant?: StateVariant
  boxed?: boolean
  children: ReactNode
  testId?: string | undefined
  className?: string | undefined
}) {
  // `empty` is the base device (no modifier); loading/error add their modifier class.
  const variantClass = variant === 'empty' ? '' : variant
  const classes = ['noesis-state', variantClass, boxed ? 'boxed' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <p className={classes} data-testid={testId} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}
