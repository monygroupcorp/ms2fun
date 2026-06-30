import type { ReactNode } from 'react'
import styles from './MintBar.module.css'

/**
 * Sticky mobile mint/action bar (`.noesis-mintbar`) — the thumb-reach rule: the primary action
 * (mint / bid) lives in a rail on desktop and a fixed bottom bar on phones, never scrolled away.
 * Mobile-only: the wrapper is `display:none` above 960px so the fixed bar is hidden on desktop.
 * The `action` must be an `<a>`/`<Link>` (the device styles `.noesis-mintbar > a` as the full-width
 * CTA) — point it at the in-page mint section (`#mint`) or the route that carries the action.
 */
export function MintBar({
  price,
  sub,
  action,
}: {
  price: ReactNode
  sub?: ReactNode
  action: ReactNode
}) {
  return (
    <div className={styles.wrap}>
      <div className="noesis-mintbar">
        <div className="info">
          <span className={styles.price}>{price}</span>
          {sub != null && <span className={styles.sub}>{sub}</span>}
        </div>
        {action}
      </div>
    </div>
  )
}
