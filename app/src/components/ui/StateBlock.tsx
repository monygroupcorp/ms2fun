import type { ReactNode } from 'react'
import styles from './StateBlock.module.css'

type StateVariant = 'loading' | 'empty' | 'error'

/**
 * The shared loading / empty / error state. Every surface used to hand-roll a
 * `<p className={styles.note}>…</p>` with a per-page `.note` rule; this unifies the
 * styling (and the loading pulse + error contrast + reduced-motion handling) in one
 * place. Messages stay caller-supplied — they're contextual ("is the fork up?").
 *
 *   <StateBlock variant="loading">loading collections…</StateBlock>
 *   <StateBlock variant="error">discovery unreachable — is the fork up?</StateBlock>
 *   <StateBlock variant="empty" boxed>nothing registered yet.</StateBlock>
 *
 * `boxed` frames large zero-states (empty lists/galleries). `testId` passes through
 * to data-testid so existing tests keep their hooks.
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
  const classes = [styles.block, styles[variant], boxed ? styles.boxed : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <p className={classes} data-testid={testId} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}
