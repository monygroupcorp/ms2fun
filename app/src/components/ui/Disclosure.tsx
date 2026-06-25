import type { ReactNode } from 'react'
import styles from './Disclosure.module.css'

/**
 * A collapsible section built on native <details>/<summary> — no JS state, keyboard-
 * and screen-reader-accessible for free. Used to demote secondary panels (vault, featured
 * queue) below a page's primary CTA without removing them. Collapsed by default; pass
 * `defaultOpen` to start expanded.
 *
 *   <Disclosure summary="COMMUNITY ENDOWMENT">…</Disclosure>
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  testId,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  testId?: string
}) {
  // Spread `open` only when starting expanded, so the element stays uncontrolled
  // (toggles freely) in the common collapsed case.
  return (
    <details className={styles.disclosure} data-testid={testId} {...(defaultOpen ? { open: true } : {})}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.content}>{children}</div>
    </details>
  )
}
