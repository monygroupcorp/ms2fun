/**
 * GatewayThrottleNotice — what the viewer is told when public IPFS gateways start refusing them,
 * and the one action that actually fixes it.
 *
 * Public gateways meter by client IP. A viewer who browses enough art eventually hits that limit,
 * and the failure has no honest reading from inside a card: the art goes grey and the app looks
 * broken, or the collection does. Neither is true — the limit is per-browser and temporary. So it
 * is stated once, at app level, in plain language, with roughly how long it lasts.
 *
 * Two tiers, per the product ruling:
 *
 *  - **Tier 1**, for everyone: the honest notice. Non-blocking, dismissible, and it never blanks the
 *    page — art already held in the art cache keeps rendering while this is up.
 *  - **Tier 2**, inside it: the door. A viewer who has their own gateway (their own node, or a
 *    pinning provider's free tier) can paste it and it takes priority immediately, no reload. The
 *    gateway is probed against a known-good CID before it is saved, because a typo'd gateway sits in
 *    front of the public set and fails every load.
 *
 * Tier 2 is deliberately not a wall. Someone who will never run a gateway must be able to dismiss
 * this, keep browsing what is cached, and wait the window out.
 */
import { useEffect, useState, type FormEvent } from 'react'
import {
  CUSTOM_GATEWAY_PRIVACY_NOTICE,
  getIpfsGateways,
  probeGateway,
  subscribeGatewayHealth,
  throttleSnapshot,
} from '../../lib/metadata'
import { customGatewayStore } from '../../lib/storage'
import styles from './GatewayThrottleNotice.module.css'

/** "about 4 minutes" / "under a minute" — a window, not a countdown to the second. */
function describeWindow(retryAt: number, now: number): string {
  const ms = retryAt - now
  if (ms <= 60_000) return 'under a minute'
  const minutes = Math.round(ms / 60_000)
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * Subscribes to gateway health AND to the cooldown simply elapsing — a window expiring is a state
 * change with no event behind it. `throttleSnapshot` returns the same object while nothing has
 * changed, so a re-read that finds no change does not re-render.
 */
function useThrottleState(): { cooling: boolean; retryAt: number } {
  const [state, setState] = useState(() => throttleSnapshot(getIpfsGateways()))

  useEffect(() => {
    const read = () => setState(throttleSnapshot(getIpfsGateways()))
    read()
    return subscribeGatewayHealth(read)
  }, [])

  useEffect(() => {
    if (!state.cooling) return
    const delay = Math.max(1_000, state.retryAt - Date.now() + 250)
    const timer = setTimeout(() => setState(throttleSnapshot(getIpfsGateways())), delay)
    return () => clearTimeout(timer)
  }, [state])

  return state
}

export function GatewayThrottleNotice() {
  const { cooling, retryAt } = useThrottleState()
  /** The window the viewer already dismissed; a NEW window re-shows the notice. */
  const [dismissedFor, setDismissedFor] = useState(0)
  const [custom, setCustom] = useState<string | null>(() => customGatewayStore.get())
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => customGatewayStore.subscribe(setCustom), [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setChecking(true)
    try {
      const result = await probeGateway(draft)
      if (!result.ok) {
        setError(result.reason)
        return
      }
      // Stored normalized, so it is already in the form the resolver expects and takes effect on
      // the next load with no reload: the store notifies same-tab subscribers.
      customGatewayStore.set(result.base)
      setDraft('')
    } finally {
      setChecking(false)
    }
  }

  if (!cooling || dismissedFor === retryAt) return null

  return (
    <div className={styles.notice} role="status" data-testid="gateway-throttle-notice">
      <div className={styles.row}>
        <div className={styles.text}>
          <span className={styles.label}>Loading slowly</span>
          <span className={styles.msg}>
            The public IPFS gateways are rate-limiting this browser, so new art and metadata
            can&rsquo;t load for {describeWindow(retryAt, Date.now())}. This is a limit on your
            connection, not a problem with this app or the collection, and it clears on its own.
            Anything already loaded stays visible.
          </span>
        </div>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setDismissedFor(retryAt)}
          data-testid="gateway-throttle-dismiss"
        >
          dismiss
        </button>
      </div>

      <div className={styles.door}>
        {custom ? (
          <div className={styles.currentRow}>
            <span className={styles.current} data-testid="gateway-throttle-current">
              Using your gateway: <code>{custom}</code>
            </span>
            <button
              type="button"
              className={styles.remove}
              onClick={() => customGatewayStore.remove()}
              data-testid="gateway-throttle-remove"
            >
              remove
            </button>
          </div>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => {
              void save(event)
            }}
          >
            <label className={styles.help} htmlFor="custom-gateway">
              Have your own gateway? Paste it and it will be used first — your own IPFS node, or a
              personal gateway from a pinning service&rsquo;s free tier.
            </label>
            <div className={styles.inputRow}>
              <input
                id="custom-gateway"
                className={styles.input}
                type="url"
                inputMode="url"
                placeholder="https://your-gateway.example"
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                disabled={checking}
                data-testid="gateway-throttle-input"
              />
              <button
                type="submit"
                className={styles.save}
                disabled={checking || draft.trim() === ''}
                data-testid="gateway-throttle-save"
              >
                {checking ? 'checking…' : 'use it'}
              </button>
            </div>
            {error !== null && (
              <p className={styles.error} data-testid="gateway-throttle-error">
                {error}
              </p>
            )}
            <p className={styles.privacy}>{CUSTOM_GATEWAY_PRIVACY_NOTICE}</p>
          </form>
        )}
      </div>
    </div>
  )
}
