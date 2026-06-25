/**
 * AdminSection / ActionRow (Phase 0) — the consistent layout for an admin panel (per-instance creator
 * admin AND the protocol admin console): a titled section of labelled action rows. Keeps every admin
 * surface visually identical; the gating (owner/role) is the caller's responsibility (useOwnerGate).
 */
import type { ReactNode } from 'react'
import styles from './AdminSection.module.css'

export function AdminSection({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section className={styles.section} data-testid={testId}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

/** One labelled action: a label (+ optional hint) on the left, the control (input/TxButton) right. */
export function ActionRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className={styles.row}>
      <div className={styles.meta}>
        <span className={styles.label}>{label}</span>
        {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  )
}
